import { Marker, Popup, Polyline } from "./gl";
import { ghostIcon, memberIcon } from "./icons";
import { STALE_AFTER_S, estimatePosition, fixAge } from "../../utils/estimate";
import { MemberStatusPill } from "../ui/StatusPill";
import { formatClock, formatDistance, formatSpeed, timeAgo } from "../../utils/format";

export default function MemberMarkers({ members, selfId, onSelect, now = Date.now(), route = null, selfIsYou = true }) {
  const located = members.filter((m) => m.lat != null && m.lng != null);
  // Riders whose phone has gone quiet: a faded marker where they probably are now.
  const ghosts = located
    .filter((m) => !(selfIsYou && m.userId === selfId)) // your own dot is never a guess
    .map((m) => ({ m, e: estimatePosition(m, now, route) }))
    .filter((g) => g.e);
  return [
    ...ghosts.flatMap(({ m, e }) => [
      <Polyline
        key={`gl-${m.userId}`}
        positions={[[m.lat, m.lng], [e.lat, e.lng]]}
        pathOptions={{ color: "#8A9499", weight: 2, dashArray: "4 6", opacity: 0.8 }}
      />,
      <Marker
        key={`gh-${m.userId}`}
        position={[e.lat, e.lng]}
        icon={ghostIcon(m, Math.round(e.age))}
        zIndexOffset={-100}
        eventHandlers={{ click: () => onSelect?.(m.userId) }}
      >
        <Popup>
          <div className="text-sm">
            <b>{m.name}</b>: estimated position
            <div className="text-xs opacity-70">
              No GPS for {Math.round(e.age)} s. Assumed {formatSpeed(m.speed)} along the route ({formatDistance(e.ahead)} ahead
              of the last fix).
            </div>
          </div>
        </Popup>
      </Marker>,
    ]),
    ...located.map((m) => (
      <Marker
        key={m.userId}
        position={[m.lat, m.lng]}
        icon={memberIcon(m, { self: m.userId === selfId, staleS: selfIsYou && m.userId === selfId ? 0 : fixAge(m, now) })}
        zIndexOffset={m.userId === selfId ? 1000 : m.isLeader ? 500 : 0}
        eventHandlers={{ click: () => onSelect?.(m.userId) }}
      >
        <Popup>
          <div className="min-w-[180px] space-y-1 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="font-display text-base font-semibold">
                {m.name}
                {m.isLeader && " · Leader"}
              </span>
            </div>
            <MemberStatusPill status={m.status} />
            {m.vehicleNumber && <div className="text-xs opacity-70">{m.vehicleNumber}</div>}
            <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 pt-1 text-xs">
              <dt className="opacity-60">Speed</dt>
              <dd>{formatSpeed(m.speed)}</dd>
              <dt className="opacity-60">ETA</dt>
              <dd>{m.eta ? formatClock(m.eta) : "—"}</dd>
              <dt className="opacity-60">To go</dt>
              <dd>{formatDistance(m.distanceRemaining)}</dd>
              {m.battery != null && (
                <>
                  <dt className="opacity-60">Battery</dt>
                  <dd>{m.battery}%</dd>
                </>
              )}
              <dt className="opacity-60">Last GPS fix</dt>
              <dd>{timeAgo(m.lastFixAt ?? m.lastSeenAt, now)}</dd>
              {m.accuracy > 0 && (
                <>
                  <dt className="opacity-60">Accuracy</dt>
                  <dd>±{Math.round(m.accuracy)} m</dd>
                </>
              )}
            </dl>
          </div>
        </Popup>
      </Marker>
    )),
  ];
}

export { STALE_AFTER_S };
