import { useMemo, useRef, useState } from "react";
import { CheckCircle2, Download, MapPinned } from "lucide-react";
import toast from "react-hot-toast";
import { downloadRouteTiles, offlineInfo, offlineSupported, tileCountFor } from "../../utils/offlineMap";
import { formatDateTime } from "../../utils/format";
import { fetchPois } from "../group/Nearby";

/** "Download offline map": saves map tiles along the whole route onto the phone. */
export default function OfflineMapCard({ trip, connected }) {
  const [info, setInfo] = useState(() => offlineInfo(trip.id));
  const [progress, setProgress] = useState(null);
  const ctrl = useRef(null);
  const estimate = useMemo(() => tileCountFor(trip.routeGeometry), [trip.routeGeometry]);
  const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

  if (!offlineSupported()) return null;

  const start = async () => {
    ctrl.current = new AbortController();
    setProgress({ done: 0, total: estimate, failed: 0 });
    try {
      const r = await downloadRouteTiles(trip.id, trip.routeGeometry, { onProgress: setProgress, signal: ctrl.current.signal });
      // Fuel / hospital / mechanic along the route go with the map.
      await fetchPois(trip.id).catch(() => {});
      setInfo(r);
      if (r.failed > r.total * 0.2) toast.error(`Saved ${r.tiles} of ${r.total} map files. Try again on a better connection.`);
      else toast.success("Offline map saved. You can navigate this route with no network.");
    } catch (e) {
      if (e.name !== "AbortError") toast.error(e.message?.includes("vector map") ? e.message : "Download stopped. Check your connection and try again.");
    } finally {
      setProgress(null);
    }
  };

  const ready = info && info.tiles >= info.total * 0.8;

  return (
    <section className={`rounded-control p-3 ring-1 ${ready ? "bg-nh-50 ring-nh/25 dark:bg-nh/15" : "bg-road ring-road-line dark:bg-asphalt-600 dark:ring-asphalt-500"}`}>
      <div className="flex items-start gap-3">
        {ready ? <CheckCircle2 className="mt-0.5 shrink-0 text-nh" size={22} /> : <MapPinned className="mt-0.5 shrink-0 text-mist" size={22} />}
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold">{ready ? "Offline map saved" : "Offline map"}</p>
          <p className="muted">
            {ready
              ? `Map + fuel, hospitals & mechanics saved · ${mb(info.bytes)} · ${formatDateTime(info.at)}`
              : `Save the map along this route (about ${mb(estimate * 30000)}) plus nearby fuel, hospitals and mechanics, so navigation keeps working in dead zones. Do it on Wi-Fi before you leave.`}
          </p>
          {progress && (
            <div className="mt-2">
              <div className="h-2 overflow-hidden rounded-full bg-road-line dark:bg-asphalt-500" role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total} aria-label="Map download progress">
                <div className="h-full bg-nh transition-[width]" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
              <p className="mt-1 text-xs muted">
                {progress.done} / {progress.total} map files
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        {progress ? (
          <button className="btn-secondary !py-2 text-sm" onClick={() => ctrl.current?.abort()}>
            Cancel
          </button>
        ) : (
          <button className={`${ready ? "btn-secondary" : "btn-primary"} !py-2 text-sm`} onClick={start} disabled={!connected && !navigator.onLine}>
            <Download size={15} /> {ready ? "Update offline map" : "Download offline map"}
          </button>
        )}
      </div>
    </section>
  );
}
