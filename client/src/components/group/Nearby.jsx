import { useCallback, useEffect, useMemo, useState } from "react";
import { MapPinned, Navigation, Phone, Search } from "lucide-react";
import Modal from "../ui/Modal";
import { tripService } from "../../services/tripService";
import { POI_META } from "../../utils/constants";
import { formatDistance } from "../../utils/format";
import { haversine } from "../../utils/geo";

const KEY = (id) => `navnet-trip-${id}-pois`;

export function savedPois(tripId) {
  try {
    return JSON.parse(localStorage.getItem(KEY(tripId)));
  } catch {
    return null;
  }
}

/** Download fuel/hospital/mechanic/police along the route onto the phone (used by the offline-map download too). */
export async function fetchPois(tripId) {
  const r = await tripService.pois(tripId);
  if (r.pois?.length || r.source !== "unavailable") localStorage.setItem(KEY(tripId), JSON.stringify(r));
  return r;
}

/**
 * Fuel / hospital / mechanic / police near the route — works offline once saved.
 * Sorted by what's ahead of you on the road.
 */
export default function Nearby({ tripId, progress, fix, onGuide }) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState("fuel");
  const [data, setData] = useState(() => savedPois(tripId));
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchPois(tripId));
    } catch {
      setData((d) => d || savedPois(tripId) || { pois: [], source: "unavailable" });
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    if (open && !data?.pois?.length) load();
  }, [open, data, load]);

  const items = useMemo(() => {
    const list = (data?.pois || []).filter((p) => p.category === cat);
    return list
      .map((p) => ({
        ...p,
        ahead: p.along - (progress ?? 0),
        straight: fix ? haversine([fix.lat, fix.lng], [p.lat, p.lng]) : null,
      }))
      .sort((a, b) => {
        // Ahead of me first (nearest first), then the ones behind.
        const ka = a.ahead >= -200 ? a.ahead : 1e9 - a.ahead;
        const kb = b.ahead >= -200 ? b.ahead : 1e9 - b.ahead;
        return ka - kb;
      })
      .slice(0, 25);
  }, [data, cat, progress, fix]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="glass grid h-12 w-12 place-items-center rounded-full shadow-float" aria-label="Nearby fuel, hospital, mechanic" title="Nearby essentials">
        <Search size={20} />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Nearby on the route" size="md">
        <div className="flex gap-1.5 overflow-x-auto pb-2" role="tablist">
          {Object.entries(POI_META).map(([k, v]) => (
            <button
              key={k}
              role="tab"
              aria-selected={cat === k}
              onClick={() => setCat(k)}
              className={`chip shrink-0 !px-3 !py-2 text-sm ${cat === k ? "bg-asphalt text-white dark:bg-road dark:text-asphalt" : "bg-road ring-1 ring-road-line dark:bg-asphalt-600 dark:ring-asphalt-500"}`}
            >
              {v.emoji} {v.label}
            </button>
          ))}
        </div>
        {loading && !items.length ? (
          <p className="py-6 text-center text-sm muted">Finding places along the route…</p>
        ) : !items.length ? (
          <div className="py-6 text-center text-sm muted">
            <MapPinned className="mx-auto mb-2" />
            {data?.source === "unavailable"
              ? "Couldn't load places (no network?). Download the offline map on Wi-Fi to keep these with you."
              : `No ${POI_META[cat].label.toLowerCase()} listed on OpenStreetMap near this route.`}
          </div>
        ) : (
          <ul className="max-h-[50vh] divide-y divide-road-line overflow-y-auto dark:divide-asphalt-500">
            {items.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2.5">
                <span className="text-xl" aria-hidden="true">
                  {POI_META[p.category].emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.name}</p>
                  <p className="text-xs muted">
                    {p.ahead >= -200 ? `${formatDistance(Math.max(0, p.ahead))} ahead` : `${formatDistance(-p.ahead)} behind`}
                    {p.fromRoute > 150 ? ` · ${formatDistance(p.fromRoute)} off route` : " · on the route"}
                    {p.open24 ? " · 24/7" : ""}
                  </p>
                </div>
                {p.phone && (
                  <a href={`tel:${p.phone}`} className="btn-ghost !p-2 text-nh" aria-label={`Call ${p.name}`}>
                    <Phone size={18} />
                  </a>
                )}
                <button
                  className="btn-secondary !px-2.5 !py-1.5 text-xs"
                  onClick={() => {
                    onGuide({ lat: p.lat, lng: p.lng, name: p.name, kind: p.category });
                    setOpen(false);
                  }}
                >
                  <Navigation size={14} /> Guide
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11px] muted">
          Places from OpenStreetMap{data?.fetchedAt ? ` · updated ${new Date(data.fetchedAt).toLocaleDateString()}` : ""}. Saved on your phone for offline use.
        </p>
      </Modal>
    </>
  );
}
