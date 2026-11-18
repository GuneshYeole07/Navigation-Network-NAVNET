import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { BatteryLow, Crosshair, Layers, LogOut, Map as MapIcon, Navigation, UserRound, Volume2, VolumeX, Wifi, WifiOff, X } from "lucide-react";
import { Marker } from "../../components/map/gl";
import { useTripLive } from "../../hooks/useTripLive";
import { useGeolocation } from "../../hooks/useGeolocation";
import { useRideNav } from "../../hooks/useRideNav";
import { useLockScreenNav } from "../../native/lockScreenNav";
import { bufferPosition, bufferedCount, flushPositions } from "../../utils/locationBuffer";
import { useSmartEta } from "../../hooks/useSmartEta";
import { useWakeLock } from "../../hooks/useWakeLock";
import { useAuth } from "../../context/AuthContext";
import { useNow } from "../../hooks/useNow";
import { tripService } from "../../services/tripService";
import BaseMap from "../../components/map/BaseMap.jsx";
import RouteLayer from "../../components/map/RouteLayer";
import MemberMarkers from "../../components/map/MemberMarkers";
import { FitBounds, Follow, InvalidateOnResize } from "../../components/map/MapHelpers";
import { useBasemapMode } from "../../components/map/BaseMap.jsx";
import LiveShell from "../../components/layout/LiveShell";
import SosButton from "../../components/trip/SosButton";
import AnnouncementBanner from "../../components/trip/AnnouncementBanner";
import NavStrip from "../../components/ride/NavStrip";
import RideChat from "../../components/ride/RideChat";
import OfflineMapCard from "../../components/ride/OfflineMapCard";
import BatteryGuide from "../../components/ride/BatteryGuide";
import LocationExplainer from "../../components/ride/LocationExplainer";
import Milestone from "../../components/ui/Milestone";
import RoadProgress from "../../components/ui/RoadProgress";
import Avatar from "../../components/ui/Avatar";
import ThemeToggle from "../../components/ui/ThemeToggle";
import { MemberStatusPill, TripStatusPill } from "../../components/ui/StatusPill";
import { FullScreenLoader } from "../../components/ui/Skeleton";
import { CHECKPOINT_CATEGORIES, VEHICLE_TYPES } from "../../utils/constants";
import { formatDateTime, formatDistance, formatSpeed } from "../../utils/format";
import { bearing, cumulative, guideTo, haversine, turnText } from "../../utils/geo";
import { targetIcon } from "../../components/map/icons";
import CaptainBar from "../../components/group/CaptainBar";
import PushToTalk from "../../components/group/PushToTalk";
import StopRequest from "../../components/group/StopRequest";
import Nearby from "../../components/group/Nearby";
import Checklist from "../../components/group/Checklist";
import Expenses from "../../components/group/Expenses";
import Countdown from "../../components/group/Countdown";
import { HelpRequest, ReadyPrompt } from "../../components/group/GroupPrompts";
import { useVoicePlayer } from "../../hooks/useVoicePlayer";
import { setVoiceEnabled, speak, voiceEnabled, voiceSupported } from "../../utils/voice";

// Battery saver: share location less often as the battery drains (a rider who goes dark at
// 5% is worse than one updating every 30 s).
const sendInterval = (battery) => (battery == null ? 3000 : battery < 10 ? 30000 : battery < 25 ? 15000 : 3000);
const PERM_KEY = "navnet-location-explained";

const RoundBtn = ({ active, children, ...p }) => (
  <button className={`grid h-12 w-12 place-items-center rounded-full shadow-float ${active ? "bg-nh text-white" : "glass"}`} {...p}>
    {children}
  </button>
);

export default function TripDashboard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const now = useNow(5000);
  const { trip, members, error, loading, emit, connected, savedAt, alerts, role, readyAsk, clearReadyAsk, helpRequest, clearHelpRequest } = useTripLive(id);
  const isAdminView = user.role === "ADMIN";
  const backTo = isAdminView ? `/admin/monitor/${id}` : "/user";
  const [target, setTarget] = useState(null); // personal guidance: fuel pump, friend's SOS…
  const { enqueue: playVoice } = useVoicePlayer();

  useEffect(() => {
    document.body.classList.add("ride-mode");
    return () => document.body.classList.remove("ride-mode");
  }, []);

  // ── Location permission: explain first, then ask ──
  const [sharing, setSharing] = useState(false);
  const [explain, setExplain] = useState(false);
  useEffect(() => {
    let alive = true;
    const decide = (state) => {
      if (!alive) return;
      if (state === "granted" || localStorage.getItem(PERM_KEY) === "yes") setSharing(true);
      else setExplain(true);
    };
    if (navigator.permissions?.query) navigator.permissions.query({ name: "geolocation" }).then((p) => decide(p.state)).catch(() => decide("prompt"));
    else decide("prompt");
    return () => {
      alive = false;
    };
  }, []);

  const { position, error: gpsError, battery, supported } = useGeolocation(sharing);
  const [follow, setFollow] = useState(true);
  // Navigation view: map turns with your direction of travel and tilts in 3D.
  const [headingUp, setHeadingUp] = useState(() => {
    try {
      return localStorage.getItem("navnet-heading-up") === "1";
    } catch {
      return false;
    }
  });
  const saveHeadingUp = (v) => {
    setHeadingUp(v);
    try {
      localStorage.setItem("navnet-heading-up", v ? "1" : "0");
    } catch {
      /* private mode */
    }
  };
  // One button, three views (like car navigators): free map → follow me → 3D navigation → free map.
  const cycleView = () => {
    if (!follow) {
      setFollow(true);
      saveHeadingUp(false);
    } else if (!headingUp) saveHeadingUp(true);
    else {
      setFollow(false);
      saveHeadingUp(false);
    }
  };
  const [mapMode, toggleMapMode] = useBasemapMode();
  const [view, setView] = useState({ key: "initial", points: null });
  const [voiceOn, setVoiceOn] = useState(voiceEnabled());
  const lastSent = useRef({ at: 0 });
  const latestPosition = useRef(null);

  const me = members[user.id];
  const memberList = useMemo(() => Object.values(members), [members]);
  const ended = trip && (trip.status === "COMPLETED" || trip.status === "CANCELLED");
  const offline = !connected;

  // On-device navigation from GPS alone (works with no network).
  const nav = useRideNav(trip, position);
  const smartEta = useSmartEta(id, { active: trip?.status === "ACTIVE", online: connected });
  // Android app: next turn on the lock screen while the trip is on.
  useLockScreenNav({ nav, trip, active: !!trip && trip.status === "ACTIVE" && sharing });
  const { active: screenOn } = useWakeLock(sharing && !!trip && !ended);
  const routeCtx = useMemo(() => (trip?.routeGeometry ? { line: trip.routeGeometry, cum: cumulative(trip.routeGeometry) } : null), [trip?.routeGeometry]);
  const isCaptain = !!trip && (user.id === trip.adminId || user.id === trip.leaderId);
  // Am I falling behind? Compare my on-device progress with the leader (or the front rider).
  const groupAhead = useMemo(() => {
    if (!trip || trip.status !== "ACTIVE" || !nav || nav.arrived) return 0;
    const others = memberList.filter((m) => m.userId !== user.id && m.lat != null && m.status !== "OFFLINE" && m.status !== "ARRIVED");
    if (!others.length) return 0;
    const lead = others.find((m) => m.isLeader) || others.reduce((a, b) => (b.progress > a.progress ? b : a));
    return lead.progress - nav.progress;
  }, [trip, nav, memberList, user.id]);
  const behind = groupAhead > (trip?.gapAlertMeters || 1500);
  // Personal target wins; otherwise the captain's meet pin (until I'm there).
  const activeTarget = target || (trip?.meet && !(me?.atMeet) ? { ...trip.meet, kind: "meet" } : null);
  const guide = guideTo(activeTarget, position || (me?.lat != null ? { lat: me.lat, lng: me.lng } : null), routeCtx);
  const spokenTarget = useRef(null);
  useEffect(() => {
    if (!activeTarget || !guide) return;
    const key = `${activeTarget.lat},${activeTarget.lng}`;
    if (guide.straight <= 60 && spokenTarget.current !== key) {
      spokenTarget.current = key;
      speak(`You've reached ${activeTarget.name}.`);
      if (target) setTarget(null);
    }
  }, [guide, activeTarget, target]);

  // Stream my position (throttled by battery level). If a fix arrives inside the throttle
  // window, send it when the window ends: the last position must never be dropped, or a
  // rider who stops moving looks stuck at an old spot. With no network, positions are kept
  // on the phone and uploaded as one batch when the signal returns (no gaps in the track).
  const trailing = useRef(null);
  const fixPayload = (p) => ({
    lat: p.lat,
    lng: p.lng,
    speed: p.speed,
    heading: p.heading,
    accuracy: p.raw?.accuracy ?? p.accuracy, // the phone's own accuracy, for GPS-quality checks
    battery,
    recordedAt: p.timestamp || Date.now(),
  });
  useEffect(() => {
    latestPosition.current = position;
  }, [position]);
  useEffect(() => {
    if (!sharing || !position || ended) return undefined;
    if (!connected) {
      bufferPosition(id, fixPayload(position));
      return undefined;
    }
    const send = () => {
      lastSent.current = { at: Date.now() };
      emit("location:update", fixPayload(position)).catch(() => bufferPosition(id, fixPayload(position)));
    };
    const wait = sendInterval(battery) - (Date.now() - lastSent.current.at);
    clearTimeout(trailing.current);
    if (wait <= 0) send();
    else trailing.current = setTimeout(send, wait);
    return () => clearTimeout(trailing.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, sharing, connected, emit, battery, ended, id]);

  // Parked riders: some phones stop reporting when nothing moves. If the last fix said
  // "standing still", re-confirm it every 20 s so the group doesn't see a stale dot. A moving
  // rider whose fixes stop is NOT faked: the map shows "last seen" + an estimate instead.
  useEffect(() => {
    if (!sharing || ended || !connected) return undefined;
    const t = setInterval(() => {
      const p = latestPosition.current;
      if (!p || Date.now() - lastSent.current.at < 20000 || (p.speed ?? 0) > 3) return;
      lastSent.current = { at: Date.now() };
      emit("location:update", { ...fixPayload(p), recordedAt: Date.now() }).catch(() => {});
    }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharing, ended, connected, emit]);

  // Back online: upload the positions recorded while offline, so the track has no gap.
  // Also retries every 15 s if an upload or a live send failed while "connected".
  const [unsent, setUnsent] = useState(0);
  const [syncNote, setSyncNote] = useState(null);
  useEffect(() => {
    const t = setInterval(() => setUnsent(bufferedCount(id)), 3000);
    return () => clearInterval(t);
  }, [id]);
  useEffect(() => {
    if (!connected || ended) return undefined;
    let busy = false;
    const flush = async () => {
      const n = bufferedCount(id);
      if (!n || busy) return;
      busy = true;
      setSyncNote(`Uploading ${n} saved position${n === 1 ? "" : "s"}…`);
      try {
        await flushPositions(id, emit);
        setSyncNote(`Back online: ${n} position${n === 1 ? "" : "s"} uploaded, your track has no gap.`);
        setTimeout(() => setSyncNote(null), 6000);
      } catch {
        setSyncNote(null); // retried below
      } finally {
        busy = false;
        setUnsent(bufferedCount(id));
      }
    };
    flush();
    const t = setInterval(flush, 15000);
    return () => clearInterval(t);
  }, [connected, ended, id, emit]);

  // ── Voice cues: turns, off-route, arrival ──
  const spoken = useRef({ turn300: null, turnNow: null, offRoute: false, arrived: false });
  useEffect(() => {
    if (!nav || ended) return;
    const s = spoken.current;
    if (nav.arrived && !s.arrived) {
      s.arrived = true;
      speak("You have arrived at the destination.");
      return;
    }
    if (nav.offRoute && !s.offRoute) {
      s.offRoute = true;
      speak("You are off the route. Head back to the green line.", { urgent: true });
    } else if (!nav.offRoute && s.offRoute) {
      s.offRoute = false;
      speak("Back on route.");
    }
    const t = nav.nextTurn;
    if (t && !nav.offRoute) {
      if (t.distance <= 300 && t.distance > 80 && s.turn300 !== t.along) {
        s.turn300 = t.along;
        speak(`In ${Math.round(t.distance / 50) * 50} metres, ${turnText(t).toLowerCase()}.`);
      } else if (t.distance <= 60 && s.turnNow !== t.along) {
        s.turnNow = t.along;
        speak(`${turnText(t)} now.`);
      }
    }
  }, [nav, ended]);

  const getFix = useCallback(() => {
    if (position) return { ...position, battery };
    if (me?.lat != null) return { lat: me.lat, lng: me.lng, speed: me.speed, battery: me.battery ?? battery };
    return null;
  }, [position, battery, me]);

  const allowLocation = () => {
    localStorage.setItem(PERM_KEY, "yes");
    setExplain(false);
    setSharing(true);
  };

  const leave = async () => {
    if (!confirm("Leave this trip? You'll stop sharing your location with the group.")) return;
    try {
      await tripService.leave(id);
      toast.success("You left the trip");
      navigate("/user", { replace: true });
    } catch (e) {
      toast.error(e.message);
    }
  };

  // Direction of travel: the GPS compass heading when moving, else worked out from the last fixes.
  const lastFix = useRef(null);
  const [travelHeading, setTravelHeading] = useState(null);
  useEffect(() => {
    if (!position) return;
    if (position.heading != null && (position.speed ?? 0) > 1.5) {
      setTravelHeading(position.heading);
      lastFix.current = [position.lat, position.lng];
      return;
    }
    const here = [position.lat, position.lng];
    if (!lastFix.current) lastFix.current = here;
    else if (haversine(lastFix.current, here) > 12) {
      setTravelHeading(bearing(lastFix.current, here));
      lastFix.current = here;
    }
  }, [position]);

  if (loading && !trip) return <FullScreenLoader label="Loading your trip" />;
  if (error && !trip)
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <h1 className="text-3xl">Can't open this trip</h1>
          <p className="mt-2 muted">{error.message}</p>
          <Link to="/user" className="btn-primary mt-6">
            Back to home
          </Link>
        </div>
      </div>
    );

  // Prefer on-device numbers (instant, offline-proof); fall back to the server's view.
  const progress = nav?.progress ?? me?.progress ?? 0;
  const remaining = nav?.remaining ?? me?.distanceRemaining ?? trip.routeDistance;
  const percent = nav?.percent ?? me?.progressPercent ?? 0;
  const visited = me?.checkpointsVisited ?? [];
  const nextCp = nav?.nextCheckpoint ?? trip.checkpoints.find((c) => c.id === me?.nextCheckpointId);
  const lastCp = [...trip.checkpoints].reverse().find((c) => visited.includes(c.id));
  const myPoint = position ? [position.lat, position.lng] : me?.lat != null ? [me.lat, me.lng] : null;


  // Show *my* marker from local GPS even while offline.
  const shownMembers = memberList.map((m) =>
    m.userId === user.id && position ? { ...m, lat: position.lat, lng: position.lng, heading: position.heading ?? m.heading, status: nav?.arrived ? "ARRIVED" : (position.speed ?? 0) >= 2 ? "MOVING" : "STOPPED" } : m,
  );
  const fitPoints = [...trip.routeGeometry.filter((_, i) => i % 10 === 0), [trip.destination.lat, trip.destination.lng], myPoint].filter(Boolean);

  const panel = (
    <div className="h-full space-y-5 overflow-y-auto p-4 pb-10">
      {ended && (
        <div className="rounded-control bg-[#1F6FB2]/10 p-3 text-sm">
          This trip has ended.{" "}
          <Link to={`/trips/${id}/report`} className="font-semibold text-[#1F6FB2] underline">
            See the trip summary
          </Link>
        </div>
      )}

      <div className="flex items-center gap-4">
        <Milestone place={trip.destination.name.split(",")[0]} value={remaining >= 10000 ? Math.round(remaining / 1000) : (remaining / 1000).toFixed(1)} unit="km to go" size="sm" />
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <TripStatusPill status={trip.status} />
            <span className="font-semibold">{Math.round(percent)}% · {formatDistance(progress)} done</span>
          </div>
          <RoadProgress percent={percent} />
          <p className="mt-1.5 text-xs muted">
            {formatSpeed(position?.speed ?? me?.speed)}
            {nextCp ? ` · next stop ${nextCp.name}` : ""}
          </p>
        </div>
      </div>

      {trip.status === "PLANNED" && me && <Checklist tripId={id} initial={me.checklist} />}

      {!ended && <OfflineMapCard trip={trip} connected={connected} />}
      {!ended && <BatteryGuide sharing={sharing} />}

      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-control bg-road p-3 dark:bg-asphalt-600">
          <p className="text-xs muted">Next checkpoint</p>
          {nextCp ? (
            <>
              <p className="mt-0.5 font-semibold">
                {CHECKPOINT_CATEGORIES[nextCp.category]?.emoji} {nextCp.name}
              </p>
              <p className="text-xs muted">in {formatDistance(Math.max(0, (nextCp.along ?? 0) - progress))}</p>
            </>
          ) : (
            <p className="mt-0.5 text-sm font-semibold">{trip.checkpoints.length ? "All checkpoints done" : "None planned"}</p>
          )}
        </div>
        <div className="rounded-control bg-road p-3 dark:bg-asphalt-600">
          <p className="text-xs muted">Last checkpoint</p>
          <p className="mt-0.5 font-semibold">{lastCp ? `${CHECKPOINT_CATEGORIES[lastCp.category]?.emoji} ${lastCp.name}` : "Not reached yet"}</p>
          <p className="text-xs muted">
            {visited.length} of {trip.checkpoints.length} visited
          </p>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-xl">Your group</h2>
          <span className={`inline-flex items-center gap-1 text-xs ${connected ? "text-nh" : "text-signal"}`}>
            {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
            {connected ? "Live" : "Offline — last known positions"}
          </span>
        </div>
        {!connected && sharing && !ended && (
          <p className="mt-1 text-xs text-signal">
            No signal. Your GPS keeps recording{unsent ? ` (${unsent} saved)` : ""} and uploads when you're back. Faded dots show where others probably are.
          </p>
        )}
        {connected && syncNote && <p className="mt-1 text-xs text-nh">{syncNote}</p>}
        <ul className="mt-2 divide-y divide-road-line dark:divide-asphalt-500">
          {[...shownMembers]
            .sort((a, b) => b.progress - a.progress)
            .map((m) => (
              <li key={m.userId} className="flex items-center gap-3 py-2">
                <Avatar id={m.userId} name={m.name} size={30} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {m.name}
                    {m.userId === user.id && " (you)"}
                    {m.isLeader && " · Leader"}
                    {m.isSweep && " · Sweep"}
                  </p>
                  <span className="flex flex-wrap items-center gap-x-2">
                    <MemberStatusPill status={m.status} />
                    {trip.status === "PLANNED" && m.ready && <span className="text-xs font-semibold text-nh">Ready</span>}
                    {trip.meet && m.atMeet && <span className="text-xs font-semibold text-nh">At stop</span>}
                  </span>
                </div>
                <span className="text-xs muted">{formatDistance(m.userId === user.id ? remaining : m.distanceRemaining)} left</span>
              </li>
            ))}
        </ul>
      </section>

      {me && <Expenses tripId={id} />}

      <section className="space-y-2 text-sm">
        <h2 className="text-xl">About this trip</h2>
        <p className="muted">{trip.description}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="muted">From</dt>
          <dd>{trip.start.name}</dd>
          <dt className="muted">To</dt>
          <dd>{trip.destination.name}</dd>
          <dt className="muted">Departs</dt>
          <dd>{formatDateTime(trip.departureTime)}</dd>
          <dt className="muted">Route</dt>
          <dd>
            {formatDistance(trip.routeDistance)} · {VEHICLE_TYPES[trip.vehicleType]} · limit {trip.speedLimitKmh} km/h
          </dd>
          <dt className="muted">Admin</dt>
          <dd>{trip.adminName}</dd>
        </dl>
      </section>

      <section className="space-y-2">
        <label className="flex items-center justify-between gap-3 rounded-control bg-road p-3 text-sm dark:bg-asphalt-600">
          <span>
            <span className="block font-semibold">Share my live location</span>
            <span className="text-xs muted">
              {!supported
                ? "This device has no GPS access."
                : gpsError
                  ? gpsError
                  : position
                    ? `GPS ±${Math.round(position.accuracy)} m${battery != null ? ` · battery ${battery}%` : ""}${screenOn ? " · screen kept on" : ""}${sendInterval(battery) > 3000 ? ` · battery saver: updates every ${sendInterval(battery) / 1000}s` : ""}`
                    : sharing
                      ? "Waiting for a GPS fix…"
                      : "Off — the admin sees you as offline."}
            </span>
          </span>
          <input type="checkbox" className="h-5 w-5 accent-[#0E6B4E]" checked={sharing} onChange={(e) => (e.target.checked ? allowLocation() : setSharing(false))} />
        </label>
        <div className="flex items-center justify-between rounded-control bg-road p-3 text-sm dark:bg-asphalt-600">
          <span className="font-semibold">Theme</span>
          <ThemeToggle />
        </div>
        <Link to="/profile" className="btn-secondary w-full">
          <UserRound size={16} /> Profile & emergency card
        </Link>
        {!ended && !isAdminView && (
          <button className="btn-ghost w-full text-signal" onClick={leave}>
            <LogOut size={16} /> Leave trip
          </button>
        )}
      </section>
    </div>
  );

  return (
    <div className="h-full">
      <LiveShell
        topBar={
          <div className="flex items-center gap-2 border-b border-road-line p-3 dark:border-asphalt-600">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl leading-tight">{trip.name}</h1>
              <p className="text-xs muted">Admin: {trip.adminName}</p>
            </div>
            <ThemeToggle />
          </div>
        }
        mobileTopBar={null}
        peek="24vh"
        panel={panel}
        mapOverlay={
          <div className="pointer-events-auto w-full max-w-md space-y-2">
            <NavStrip nav={nav} trip={trip} offline={offline} savedAt={savedAt} sharing={sharing} backTo={backTo} smartEta={smartEta} />
            {activeTarget && guide && (
              <div className={`flex items-center gap-2 rounded-control px-3 py-2 text-sm font-semibold shadow-float ${activeTarget.kind === "sos" ? "bg-signal text-white" : activeTarget.kind === "meet" ? "bg-stone-cap text-asphalt" : "bg-[#1F6FB2] text-white"}`} role="status">
                <Navigation size={16} />
                <span className="min-w-0 flex-1 truncate">
                  {activeTarget.kind === "meet" ? "Group stop" : "Guiding to"}: {activeTarget.name} · {formatDistance(guide.distance)}{" "}
                  {guide.onRoute ? guide.direction : `to the ${guide.direction}`}
                </span>
                {target && (
                  <button onClick={() => setTarget(null)} aria-label="Stop guidance" className="-m-1 p-1">
                    <X size={16} />
                  </button>
                )}
              </div>
            )}
            {behind && !isCaptain && (
              <div className="rounded-control bg-stone-cap px-3 py-2 text-center text-sm font-semibold text-asphalt shadow-float" role="status">
                Group is {formatDistance(groupAhead)} ahead — catch up safely or tap ✋ for a stop
              </div>
            )}
            {isCaptain && <CaptainBar trip={trip} members={members} me={me} emit={emit} nav={nav} alerts={alerts} isAdmin={role === "ADMIN"} />}
            {!isCaptain && trip.departAt && (
              <div className="flex justify-center">
                <Countdown departAt={trip.departAt} className="shadow-float" />
              </div>
            )}
            {battery != null && battery < 25 && sharing && (
              <div className="flex justify-center">
                <span className="chip bg-stone-cap text-asphalt shadow-float">
                  <BatteryLow size={13} /> Battery saver on
                </span>
              </div>
            )}
            <AnnouncementBanner tripId={id} />
            {trip.status === "PAUSED" && <div className="rounded-control bg-stone-cap p-2.5 text-center text-sm font-semibold text-asphalt shadow-float">The admin has paused the trip. Hold your position.</div>}
          </div>
        }
        map={
          <BaseMap center={[trip.start.lat, trip.start.lng]} zoom={11} zoomPosition="bottomleft" layerToggle={false} mode={mapMode}>
            <InvalidateOnResize />
            <FitBounds points={view.points || fitPoints} fitKey={view.key} />
            <Follow point={myPoint} enabled={follow && !!position} headingUp={headingUp} heading={travelHeading} onUserMove={() => setFollow(false)} />
            <RouteLayer trip={trip} visited={visited} progressMeters={progress} />
            <MemberMarkers members={shownMembers} selfId={user.id} now={now} route={routeCtx} />
            {trip.meet && <Marker position={[trip.meet.lat, trip.meet.lng]} icon={targetIcon("meet")} zIndexOffset={900} />}
            {target && <Marker position={[target.lat, target.lng]} icon={targetIcon(target.kind)} zIndexOffset={950} />}
          </BaseMap>
        }
        floatingLeft={
          <>
            {!ended && <PushToTalk tripId={id} connected={connected} disabled={trip.status === "CANCELLED"} />}
            <RideChat tripId={id} adminId={trip.adminId} adminName={trip.adminName} disabled={trip.status === "CANCELLED"} groupOnly={isAdminView} onVoice={playVoice} />
          </>
        }
        floating={
          <>
            {voiceSupported() && (
              <RoundBtn
                active={voiceOn}
                onClick={() => {
                  setVoiceEnabled(!voiceOn);
                  setVoiceOn(!voiceOn);
                  if (!voiceOn) setTimeout(() => speak("Voice guidance on."), 50);
                }}
                aria-pressed={voiceOn}
                aria-label={voiceOn ? "Mute voice guidance" : "Turn on voice guidance"}
              >
                {voiceOn ? <Volume2 size={20} /> : <VolumeX size={20} />}
              </RoundBtn>
            )}
            <RoundBtn
              active={follow}
              onClick={cycleView}
              aria-pressed={follow}
              disabled={!myPoint}
              aria-label={!follow ? "Follow my position" : !headingUp ? "Switch to 3D navigation view" : "Stop following my position"}
              title={!follow ? "Follow me" : !headingUp ? "3D navigation view" : "Free map"}
            >
              {follow && headingUp ? <span className="font-display text-sm font-bold">3D</span> : <Navigation size={20} />}
            </RoundBtn>
            <RoundBtn onClick={toggleMapMode} aria-label={mapMode === "satellite" ? "Show map" : "Show satellite view"}>
              {mapMode === "satellite" ? <MapIcon size={20} /> : <Layers size={20} />}
            </RoundBtn>
            <RoundBtn onClick={() => (setFollow(false), setView({ key: `route-${Date.now()}`, points: null }))} aria-label="Show whole route">
              <Crosshair size={20} />
            </RoundBtn>
            <Nearby tripId={id} progress={progress} fix={position} onGuide={(t) => setTarget(t)} />
            {!isCaptain && !ended && <StopRequest emit={emit} getFix={getFix} connected={connected} captainName={memberList.find((m) => m.isLeader)?.name || trip.adminName} />}
            {!ended && (
              <SosButton emit={emit} getFix={getFix} connected={connected} tripId={id} riderName={user.name} adminPhone={trip.adminPhone} adminName={trip.adminName} />
            )}
          </>
        }
      />
      <LocationExplainer open={explain} onAllow={allowLocation} onLater={() => setExplain(false)} />
      <ReadyPrompt
        ask={readyAsk}
        onClose={clearReadyAsk}
        onReady={() => {
          emit("ready:set", { ready: true }).catch((e) => toast.error(e.message));
          clearReadyAsk();
          toast.success("The captain knows you're ready");
        }}
      />
      <HelpRequest
        help={helpRequest}
        onClose={clearHelpRequest}
        onGuide={() => {
          setTarget({ lat: helpRequest.lat, lng: helpRequest.lng, name: `${helpRequest.name} (SOS)`, kind: "sos" });
          setFollow(false);
          setView({ key: `sos-${Date.now()}`, points: [[helpRequest.lat, helpRequest.lng], myPoint].filter(Boolean) });
          clearHelpRequest();
        }}
      />
    </div>
  );
}
