import { Fragment } from "react";
import { Marker, Polyline, Popup, Tooltip } from "./gl";
import { checkpointIcon, endpointIcon, waypointIcon } from "./icons";
import { CHECKPOINT_CATEGORIES } from "../../utils/constants";
import { formatClock } from "../../utils/format";

/** Shared route: casing + line, start/destination, waypoints and checkpoints. */
export default function RouteLayer({ trip, visited = [], progressMeters = null, showWaypoints = false }) {
  if (!trip) return null;
  const visitedSet = new Set(visited);
  const geometry = trip.routeGeometry || [];
  return (
    <>
      {geometry.length > 1 && (
        <>
          <Polyline positions={geometry} pathOptions={{ color: "#08402F", weight: 9, opacity: 0.35, lineCap: "round" }} />
          <Polyline positions={geometry} pathOptions={{ color: "#2E9672", weight: 5, opacity: 0.95, lineCap: "round" }} />
        </>
      )}
      <Marker position={[trip.start.lat, trip.start.lng]} icon={endpointIcon("start")}>
        <Tooltip direction="top" offset={[0, -10]}>Start: {trip.start.name}</Tooltip>
      </Marker>
      <Marker position={[trip.destination.lat, trip.destination.lng]} icon={endpointIcon("end")}>
        <Tooltip direction="top" offset={[0, -36]}>Destination: {trip.destination.name}</Tooltip>
      </Marker>
      {showWaypoints &&
        trip.waypoints?.map((w, i) => (
          <Marker key={`w${i}`} position={[w.lat, w.lng]} icon={waypointIcon(i + 1)}>
            <Tooltip>{w.name}</Tooltip>
          </Marker>
        ))}
      {trip.checkpoints?.map((c) => {
        const meta = CHECKPOINT_CATEGORIES[c.category] || CHECKPOINT_CATEGORIES.OTHER;
        const done = visitedSet.has(c.id) || (progressMeters != null && c.along != null && c.along < progressMeters - 200);
        return (
          <Fragment key={c.id || `${c.lat},${c.lng}`}>
            <Marker position={[c.lat, c.lng]} icon={checkpointIcon(c.category, done)}>
              <Popup>
                <div className="space-y-0.5">
                  <div className="font-display text-base font-semibold">{c.name}</div>
                  <div className="text-xs opacity-70">
                    {meta.label}
                    {c.eta ? ` · ETA ${formatClock(c.eta)}` : ""}
                  </div>
                  {done && <div className="text-xs font-semibold text-nh">Visited</div>}
                </div>
              </Popup>
            </Marker>
          </Fragment>
        );
      })}
    </>
  );
}
