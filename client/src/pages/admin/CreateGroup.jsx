import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { Marker, Polyline, Popup, Tooltip } from "../../components/map/gl";
import { ArrowUpDown, Check, ChevronLeft, Copy, Flag, ImagePlus, LocateFixed, MapPin, Plus, RotateCw, Trash2, X } from "lucide-react";
import Field from "../../components/ui/Field";
import Modal from "../../components/ui/Modal";
import BaseMap from "../../components/map/BaseMap.jsx";
import PlaceSearch from "../../components/map/PlaceSearch";
import { ClickHandler, FitBounds, InvalidateOnResize } from "../../components/map/MapHelpers";
import { checkpointIcon, endpointIcon, waypointIcon } from "../../components/map/icons";
import { geoService } from "../../services/geoService";
import { tripService } from "../../services/tripService";
import { communityService } from "../../services/communityService";
import { assetUrl } from "../../services/api";
import { CHECKPOINT_CATEGORIES, ROUTE_PROFILE, VEHICLE_TYPES } from "../../utils/constants";
import { formatDistance, formatDuration } from "../../utils/format";

const STEPS = ["Basics", "Route", "Checkpoints", "Group settings", "Review"];

const toLocalInput = (d) => {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
};
const tomorrowAt = (h) => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(h, 0, 0, 0);
  return d;
};

async function labelFor([lat, lng]) {
  try {
    const r = await geoService.reverse(lat, lng);
    return r.shortName || r.name;
  } catch {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}

function StepBar({ step }) {
  // Real sequence → numbered markers are information here, not decoration.
  return (
    <ol className="flex gap-1.5" aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s} className="flex-1">
          <div className={`h-1.5 rounded-full ${i <= step ? "bg-nh" : "bg-road-line dark:bg-asphalt-500"}`} />
          <p className={`mt-1.5 hidden text-xs sm:block ${i === step ? "font-semibold" : "muted"}`} aria-current={i === step ? "step" : undefined}>
            {i + 1}. {s}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** Best-guess checkpoint category from the OpenStreetMap place type. */
const CATEGORY_BY_TYPE = {
  fuel: "FUEL", charging_station: "FUEL",
  cafe: "BREAKFAST", bakery: "BREAKFAST",
  restaurant: "LUNCH", fast_food: "LUNCH", food_court: "LUNCH",
  drinking_water: "HYDRATION",
  hospital: "HOSPITAL", clinic: "HOSPITAL", doctors: "HOSPITAL",
  hotel: "HOTEL", motel: "HOTEL", guest_house: "HOTEL", hostel: "HOTEL", resort: "HOTEL",
  viewpoint: "SCENIC", attraction: "SCENIC", peak: "SCENIC", waterfall: "SCENIC", fort: "SCENIC", lake: "SCENIC",
  rest_area: "REST", services: "REST", parking: "REST",
};
export const guessCategory = (type) => CATEGORY_BY_TYPE[type] || "OTHER";

function PointRow({ label, point, onPick, onClear, near, extra, autoFocus }) {
  return (
    <div>
      <span className="field-label">{label}</span>
      <div className="flex gap-2">
        <PlaceSearch className="flex-1" label={label} placeholder={`Search ${label.toLowerCase()} (town, landmark, petrol pump…)`} value={point?.name || ""} onPick={onPick} near={near} autoFocus={autoFocus} />
        {extra}
        {onClear && point && (
          <button type="button" onClick={onClear} className="btn-ghost !px-2" aria-label={`Remove ${label}`}>
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

export default function CreateGroup() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [start, setStart] = useState(null);
  const [destination, setDestination] = useState(null);
  const [waypoints, setWaypoints] = useState([]);
  const [checkpoints, setCheckpoints] = useState([]);
  const [route, setRoute] = useState(null);
  const [routing, setRouting] = useState(false);
  const [routeErr, setRouteErr] = useState(null);
  const [routeTry, setRouteTry] = useState(0);
  const [tapped, setTapped] = useState(null); // { lat, lng, name } — where the admin tapped the map
  const [locating, setLocating] = useState(false);
  const [imageUrl, setImageUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [communities, setCommunities] = useState([]);
  const [created, setCreated] = useState(null);
  const [fitKey, setFitKey] = useState("init");

  const {
    register,
    handleSubmit,
    trigger,
    getValues,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: {
      name: "",
      description: "",
      communityId: "",
      groupCode: "",
      groupPassword: "",
      maxMembers: 20,
      vehicleType: "BIKE",
      speedLimitKmh: 80,
      departureTime: toLocalInput(tomorrowAt(6)),
      expectedArrival: toLocalInput(tomorrowAt(10)),
    },
  });
  const vehicleType = watch("vehicleType");

  useEffect(() => {
    communityService.owned().then(setCommunities).catch(() => {});
  }, []);

  // Route preview whenever endpoints / waypoints / vehicle change (debounced: pins get dragged).
  useEffect(() => {
    if (!start || !destination) {
      setRoute(null);
      setRouteErr(null);
      return undefined;
    }
    let alive = true;
    setRouting(true);
    setRouteErr(null);
    const t = setTimeout(() => {
      const coords = [start, ...waypoints, destination].map((p) => [p.lat, p.lng]);
      geoService
        .route(coords, ROUTE_PROFILE[vehicleType] || "driving")
        .then((r) => {
          if (!alive) return;
          setRoute(r);
          setFitKey(`r${Date.now()}`);
        })
        .catch((e) => alive && (setRoute(null), setRouteErr(e.message || "Couldn't calculate the route")))
        .finally(() => alive && setRouting(false));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [start, destination, waypoints, vehicleType, routeTry]);

  // Suggest arrival = departure + route duration + 15% buffer.
  const suggestArrival = () => {
    if (!route) return;
    const dep = new Date(getValues("departureTime"));
    setValue("expectedArrival", toLocalInput(new Date(dep.getTime() + route.duration * 1150)), { shouldValidate: true });
  };

  useEffect(() => setTapped(null), [step]);

  // Tap the map → a small menu at that spot ("Start here", "Destination", …).
  const onMapClick = async ([lat, lng]) => {
    if (step !== 1 && step !== 2) return;
    setTapped({ lat, lng, name: null });
    const name = await labelFor([lat, lng]);
    setTapped((t) => (t && t.lat === lat && t.lng === lng ? { ...t, name } : t));
  };

  const addCheckpoint = (p) =>
    setCheckpoints((c) => [...c, { name: p.name, category: guessCategory(p.type), point: { name: p.name, lat: p.lat, lng: p.lng }, eta: "" }]);
  const updateCheckpoint = (i, patch) => setCheckpoints((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const placeTapped = (kind) => {
    const p = { name: tapped.name || `${tapped.lat.toFixed(4)}, ${tapped.lng.toFixed(4)}`, lat: tapped.lat, lng: tapped.lng };
    if (kind === "start") setStart(p);
    else if (kind === "destination") setDestination(p);
    else if (kind === "waypoint") setWaypoints((w) => [...w, p]);
    else if (kind === "checkpoint") addCheckpoint(p);
    setTapped(null);
  };

  // Drag a pin to fine-tune it; the label follows.
  const dragged = async (e, apply) => {
    const { lat, lng } = e.target.getLatLng();
    apply({ lat, lng, name: "…" });
    const name = await labelFor([lat, lng]);
    apply({ lat, lng, name });
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) return toast.error("This browser can't share location");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const p = { lat: coords.latitude, lng: coords.longitude };
        setStart({ ...p, name: await labelFor([p.lat, p.lng]) });
        setLocating(false);
      },
      () => {
        setLocating(false);
        toast.error("Couldn't get your location. Search for the start instead.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const swapEnds = () => {
    setStart(destination);
    setDestination(start);
  };

  // Bias place search towards where this trip is (start, else destination).
  const near = start || destination || null;
  const routeMid = route?.geometry?.[Math.floor(route.geometry.length / 2)];
  const cpNear = routeMid ? { lat: routeMid[0], lng: routeMid[1] } : near;

  const uploadImage = async (file) => {
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) return toast.error("Image must be 3 MB or smaller");
    setUploading(true);
    try {
      const { url } = await geoService.uploadImage(file);
      setImageUrl(url);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setUploading(false);
    }
  };

  const next = async () => {
    if (step === 0 && !(await trigger(["name", "description"]))) return;
    if (step === 1) {
      if (!start || !destination) return toast.error("Set a starting location and a destination");
      if (routing) return toast.error("Wait for the route preview to finish");
      if (!route) return toast.error(routeErr || "The route couldn't be calculated. Tap “Try again”.");
    }
    if (step === 3 && !(await trigger(["groupCode", "groupPassword", "maxMembers", "speedLimitKmh", "departureTime", "expectedArrival"]))) return;
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const onSubmit = async (v) => {
    try {
      const body = {
        name: v.name,
        description: v.description,
        imageUrl,
        communityId: v.communityId || null,
        start,
        destination,
        waypoints,
        checkpoints: checkpoints.map((c) => ({ name: c.name, category: c.category, lat: c.point.lat, lng: c.point.lng, eta: c.eta ? new Date(c.eta).toISOString() : null })),
        route,
        groupCode: v.groupCode || undefined,
        groupPassword: v.groupPassword,
        maxMembers: Number(v.maxMembers),
        vehicleType: v.vehicleType,
        speedLimitKmh: Number(v.speedLimitKmh),
        departureTime: new Date(v.departureTime).toISOString(),
        expectedArrival: new Date(v.expectedArrival).toISOString(),
      };
      const trip = await tripService.create(body);
      setCreated({ ...trip, password: v.groupPassword });
    } catch (e) {
      toast.error(e.message);
    }
  };

  const mapPoints = useMemo(
    () => [start, destination, ...waypoints, ...checkpoints.map((c) => c.point)].filter(Boolean).map((p) => [p.lat, p.lng]).concat(route?.geometry?.filter((_, i) => i % 20 === 0) || []),
    [start, destination, waypoints, checkpoints, route],
  );

  const values = getValues();

  return (
    <div>
      <Link to="/admin" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-nh">
        <ChevronLeft size={16} /> Admin dashboard
      </Link>
      <h1 className="text-5xl leading-none">Create group</h1>
      <p className="mt-2 muted">Plan the route, mark the stops, and set how riders join.</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <form onSubmit={handleSubmit(onSubmit)} className="panel flex flex-col p-5" noValidate>
          <StepBar step={step} />

          <div className="mt-6 flex-1 space-y-4">
            {step === 0 && (
              <>
                <Field label="Trip name" placeholder="Lonavala Monsoon Ride" error={errors.name?.message} {...register("name", { required: "Name the trip", minLength: { value: 3, message: "At least 3 characters" } })} />
                <Field as="textarea" label="Description" placeholder="What riders should know: pace, gear, meeting point…" error={errors.description?.message} {...register("description", { required: "Add a short description" })} />
                <div>
                  <span className="field-label">Trip image</span>
                  <div className="flex items-center gap-4">
                    <div className="grid h-20 w-28 place-items-center overflow-hidden rounded-control bg-road ring-1 ring-road-line dark:bg-asphalt-600 dark:ring-asphalt-500">
                      {imageUrl ? <img src={assetUrl(imageUrl)} alt="Trip cover preview" className="h-full w-full object-cover" /> : <ImagePlus className="text-mist" />}
                    </div>
                    <label className="btn-secondary cursor-pointer">
                      {uploading ? "Uploading…" : imageUrl ? "Replace image" : "Upload image"}
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => uploadImage(e.target.files?.[0])} />
                    </label>
                  </div>
                  <p className="mt-1 text-xs muted">JPG, PNG or WEBP up to 3 MB. Optional.</p>
                </div>
                {communities.length > 0 && (
                  <Field as="select" label="Show in community (optional)" hint="Listed under the community's upcoming trips." {...register("communityId")}>
                    <option value="">Don't list in a community</option>
                    {communities.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Field>
                )}
              </>
            )}

            {step === 1 && (
              <>
                <Field as="select" label="Vehicle type" hint="Changes how the route is calculated." {...register("vehicleType")}>
                  {Object.entries(VEHICLE_TYPES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Field>
                <PointRow
                  label="Start"
                  point={start}
                  onPick={setStart}
                  near={destination}
                  autoFocus={!start}
                  extra={
                    <button type="button" onClick={useMyLocation} className="btn-secondary !px-3" disabled={locating} title="Use my current location" aria-label="Use my current location">
                      <LocateFixed size={16} className={locating ? "animate-pulse" : ""} />
                    </button>
                  }
                />
                {start && destination && (
                  <div className="-my-2 flex justify-center">
                    <button type="button" onClick={swapEnds} className="btn-ghost !py-1 text-xs" aria-label="Swap start and destination">
                      <ArrowUpDown size={14} /> Swap
                    </button>
                  </div>
                )}
                <PointRow label="Destination" point={destination} onPick={setDestination} near={start} autoFocus={!!start && !destination} />
                <div>
                  <span className="field-label">Stops on the way (optional)</span>
                  {waypoints.length > 0 && (
                    <ol className="mb-2 space-y-1">
                      {waypoints.map((w, i) => (
                        <li key={i} className="flex items-center gap-2 rounded-control bg-road px-3 py-2 text-sm dark:bg-asphalt-600">
                          <span className="font-display font-bold">{i + 1}</span>
                          <span className="flex-1 truncate">{w.name}</span>
                          <button type="button" onClick={() => setWaypoints((ws) => ws.filter((_, j) => j !== i))} aria-label={`Remove waypoint ${w.name}`}>
                            <Trash2 size={14} className="text-signal" />
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                  <PlaceSearch placeholder="Add a place the route must pass through" label="Add a stop on the way" onPick={(p) => setWaypoints((w) => [...w, p])} value="" near={near} clearOnPick />
                </div>
                <div className="rounded-control bg-road p-3 text-sm dark:bg-asphalt-600" aria-live="polite">
                  {routing ? (
                    "Calculating route…"
                  ) : routeErr ? (
                    <div className="flex items-center gap-3">
                      <span className="flex-1 text-signal">{routeErr}</span>
                      <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={() => setRouteTry((n) => n + 1)}>
                        <RotateCw size={14} /> Try again
                      </button>
                    </div>
                  ) : route ? (
                    <div>
                      <span>
                        Route preview: <strong>{formatDistance(route.distance)}</strong>, about <strong>{formatDuration(route.duration)}</strong>
                        <span className="muted"> · via {route.provider === "openrouteservice" ? "OpenRouteService" : route.provider === "osrm" ? "OpenStreetMap roads" : "straight line"}</span>
                      </span>
                      {route.provider === "straight-line" && (
                        <div className="mt-2 flex items-center gap-3 text-xs">
                          <span className="flex-1 text-amber-700 dark:text-amber-300">
                            {route.reason || "Couldn't get a road route."} Showing a straight line; turn-by-turn won't follow roads.
                          </span>
                          <button type="button" className="btn-secondary !py-1 text-xs" onClick={() => setRouteTry((n) => n + 1)}>
                            <RotateCw size={14} /> Try again
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="muted">Search a start and destination, or tap the map. You can drag pins to adjust.</span>
                  )}
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <p className="text-sm muted">Search a stop (or tap the map) to add it. Riders get notified as they reach each one. Optional.</p>
                <PlaceSearch placeholder="Search a stop: petrol pump, dhaba, hospital…" label="Add a checkpoint" onPick={addCheckpoint} value="" near={cpNear} clearOnPick autoFocus />
                {checkpoints.length > 0 && (
                  <ul className="space-y-2">
                    {checkpoints.map((c, i) => (
                      <li key={i} className="rounded-control bg-road p-2 dark:bg-asphalt-600">
                        <div className="flex items-center gap-2">
                          <select
                            className="input !w-auto !px-2"
                            value={c.category}
                            onChange={(e) => updateCheckpoint(i, { category: e.target.value })}
                            aria-label={`Type of ${c.name}`}
                          >
                            {Object.entries(CHECKPOINT_CATEGORIES).map(([k, v]) => (
                              <option key={k} value={k}>
                                {v.emoji} {v.label}
                              </option>
                            ))}
                          </select>
                          <input className="input flex-1" value={c.name} onChange={(e) => updateCheckpoint(i, { name: e.target.value })} aria-label={`Checkpoint ${i + 1} name`} />
                          <button type="button" className="btn-ghost !px-2" onClick={() => setCheckpoints((cs) => cs.filter((_, j) => j !== i))} aria-label={`Remove checkpoint ${c.name}`}>
                            <Trash2 size={14} className="text-signal" />
                          </button>
                        </div>
                        <label className="mt-1.5 flex items-center gap-2 text-xs muted">
                          Arrive by (optional)
                          <input type="datetime-local" className="input !py-1 !text-xs flex-1" value={c.eta} onChange={(e) => updateCheckpoint(i, { eta: e.target.value })} />
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {step === 3 && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Group ID (optional)"
                    placeholder="Auto-generated"
                    hint="Riders type this to join. Letters, numbers, dashes."
                    error={errors.groupCode?.message}
                    {...register("groupCode", { pattern: { value: /^[A-Za-z0-9-]{4,20}$/, message: "4–20 letters, numbers or dashes" } })}
                  />
                  <Field label="Group password" type="text" autoComplete="off" error={errors.groupPassword?.message} {...register("groupPassword", { required: "Set a password riders will use", minLength: { value: 4, message: "At least 4 characters" } })} />
                  <Field label="Maximum members" type="number" min={2} max={500} error={errors.maxMembers?.message} {...register("maxMembers", { required: true, min: { value: 2, message: "At least 2" }, max: { value: 500, message: "At most 500" } })} />
                  <Field label="Speed limit (km/h)" type="number" min={5} max={200} hint="Riders above this trigger an overspeed alert." error={errors.speedLimitKmh?.message} {...register("speedLimitKmh", { required: true, min: { value: 5, message: "Too low" }, max: { value: 200, message: "Too high" } })} />
                  <Field label="Departure time" type="datetime-local" error={errors.departureTime?.message} {...register("departureTime", { required: "Set a departure time" })} />
                  <div>
                    <Field
                      label="Expected arrival"
                      type="datetime-local"
                      error={errors.expectedArrival?.message}
                      {...register("expectedArrival", {
                        required: "Set an expected arrival",
                        validate: (v) => new Date(v) > new Date(getValues("departureTime")) || "Must be after departure",
                      })}
                    />
                    {route && (
                      <button type="button" className="mt-1 text-xs font-semibold text-nh hover:underline" onClick={suggestArrival}>
                        Use route estimate ({formatDuration(route.duration * 1.15)})
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}

            {step === 4 && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="muted">Trip</dt>
                <dd className="font-semibold">{values.name}</dd>
                <dt className="muted">Route</dt>
                <dd>
                  {start?.name} to {destination?.name}
                  {waypoints.length ? ` via ${waypoints.length} waypoint${waypoints.length > 1 ? "s" : ""}` : ""}
                </dd>
                <dt className="muted">Distance</dt>
                <dd>
                  {formatDistance(route?.distance)} · {formatDuration(route?.duration)}
                </dd>
                <dt className="muted">Checkpoints</dt>
                <dd>{checkpoints.length || "None"}</dd>
                <dt className="muted">Vehicle</dt>
                <dd>
                  {VEHICLE_TYPES[values.vehicleType]} · limit {values.speedLimitKmh} km/h
                </dd>
                <dt className="muted">Members</dt>
                <dd>Up to {values.maxMembers}</dd>
                <dt className="muted">Group ID</dt>
                <dd className="font-display text-lg">{values.groupCode?.toUpperCase() || "Generated on create"}</dd>
                <dt className="muted">Departs</dt>
                <dd>{new Date(values.departureTime).toLocaleString()}</dd>
                <dt className="muted">Arrives</dt>
                <dd>{new Date(values.expectedArrival).toLocaleString()}</dd>
              </dl>
            )}
          </div>

          <div className="mt-6 flex justify-between gap-3 border-t border-road-line pt-4 dark:border-asphalt-500">
            <button type="button" className="btn-ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
              Back
            </button>
            {step < STEPS.length - 1 ? (
              // Distinct keys: React must not morph this button into the submit button
              // mid-click, or the browser would submit the form and skip the review step.
              <button key="next" type="button" className="btn-primary" onClick={next}>
                Continue to {STEPS[step + 1].toLowerCase()}
              </button>
            ) : (
              <button key="submit" type="submit" className="btn-primary" disabled={isSubmitting}>
                {isSubmitting ? "Creating…" : "Create group"}
              </button>
            )}
          </div>
        </form>

        <div className="relative h-[420px] overflow-hidden rounded-sheet ring-1 ring-road-line dark:ring-asphalt-500 lg:sticky lg:top-20 lg:h-[calc(100vh-7rem)]">
          {(step === 1 || step === 2) && !tapped && (
            <div className="pointer-events-none absolute inset-x-0 top-3 z-[500] mx-auto w-fit rounded-full bg-asphalt/85 px-4 py-2 text-xs font-semibold text-white shadow-float">
              {step === 1 ? "Tap the map to drop a pin · drag pins to adjust" : "Tap the map to add a checkpoint there"}
            </div>
          )}
          <BaseMap center={[18.6, 73.7]} zoom={9} zoomPosition="bottomright">
            <InvalidateOnResize />
            <ClickHandler onClick={onMapClick} />
            <FitBounds points={mapPoints} fitKey={fitKey} />
            {route && (
              <>
                <Polyline positions={route.geometry} pathOptions={{ color: "#08402F", weight: 9, opacity: 0.35 }} />
                <Polyline positions={route.geometry} pathOptions={{ color: "#2E9672", weight: 5 }} />
              </>
            )}
            {start && (
              <Marker position={[start.lat, start.lng]} icon={endpointIcon("start")} draggable eventHandlers={{ dragend: (e) => dragged(e, setStart) }}>
                <Tooltip>Start: {start.name}</Tooltip>
              </Marker>
            )}
            {destination && (
              <Marker position={[destination.lat, destination.lng]} icon={endpointIcon("end")} draggable eventHandlers={{ dragend: (e) => dragged(e, setDestination) }}>
                <Tooltip>Destination: {destination.name}</Tooltip>
              </Marker>
            )}
            {waypoints.map((w, i) => (
              <Marker
                key={`w${i}`}
                position={[w.lat, w.lng]}
                icon={waypointIcon(i + 1)}
                draggable
                eventHandlers={{ dragend: (e) => dragged(e, (p) => setWaypoints((ws) => ws.map((x, j) => (j === i ? p : x)))) }}
              >
                <Tooltip>{w.name}</Tooltip>
              </Marker>
            ))}
            {checkpoints.map((c, i) => (
              <Marker
                key={`c${i}`}
                position={[c.point.lat, c.point.lng]}
                icon={checkpointIcon(c.category)}
                draggable
                eventHandlers={{ dragend: (e) => dragged(e, (p) => updateCheckpoint(i, { point: p })) }}
              >
                <Tooltip>{c.name}</Tooltip>
              </Marker>
            ))}
            {tapped && (
              <Popup key={`${tapped.lat},${tapped.lng}`} position={[tapped.lat, tapped.lng]} eventHandlers={{ remove: () => setTapped(null) }}>
                <div className="min-w-44 space-y-1.5">
                  <p className="m-0 text-xs font-semibold">{tapped.name || "Finding this place…"}</p>
                  {step === 1 ? (
                    <>
                      <button type="button" className="btn-primary w-full !py-1.5 text-xs" onClick={() => placeTapped(start ? "destination" : "start")}>
                        {start ? <Flag size={14} /> : <MapPin size={14} />} {start ? "Set as destination" : "Start here"}
                      </button>
                      {start && (
                        <button type="button" className="btn-secondary w-full !py-1.5 text-xs" onClick={() => placeTapped("start")}>
                          <MapPin size={14} /> Start here
                        </button>
                      )}
                      {start && destination && (
                        <button type="button" className="btn-secondary w-full !py-1.5 text-xs" onClick={() => placeTapped("waypoint")}>
                          <Plus size={14} /> Add stop on the way
                        </button>
                      )}
                    </>
                  ) : (
                    <button type="button" className="btn-primary w-full !py-1.5 text-xs" onClick={() => placeTapped("checkpoint")}>
                      <Plus size={14} /> Add checkpoint here
                    </button>
                  )}
                </div>
              </Popup>
            )}
          </BaseMap>
        </div>
      </div>

      <Modal open={!!created} onClose={() => navigate("/admin")} title="Group created" size="sm">
        {created && (
          <div className="space-y-4">
            <p className="text-sm">Share these with your riders. They'll need both to join.</p>
            <div className="rounded-control bg-nh p-4 text-white">
              <p className="text-xs text-white/75">Group ID</p>
              <p className="font-display text-4xl font-bold">{created.groupCode}</p>
              <p className="mt-2 text-xs text-white/75">Password</p>
              <p className="font-display text-2xl font-semibold">{created.password}</p>
            </div>
            <button
              className="btn-secondary w-full"
              onClick={() => {
                navigator.clipboard
                  ?.writeText(`Join "${created.name}" on NavNet\nGroup ID: ${created.groupCode}\nPassword: ${created.password}`)
                  .then(() => toast.success("Copied invite"));
              }}
            >
              <Copy size={16} /> Copy invite text
            </button>
            <button className="btn-primary w-full" onClick={() => navigate("/admin")}>
              <Check size={16} /> Back to admin dashboard
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
