import { Marker, Popup } from "./gl";
import { memberIcon } from "./icons";
import { MemberStatusPill } from "../ui/StatusPill";
import { formatClock, formatDistance, formatSpeed, timeAgo } from "../../utils/format";

export default function MemberMarkers({ members, selfId, onSelect, now }) {
  return members
    .filter((m) => m.lat != null && m.lng != null)
    .map((m) => (
      <Marker
        key={m.userId}
        position={[m.lat, m.lng]}
        icon={memberIcon(m, { self: m.userId === selfId })}
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
              <dt className="opacity-60">Updated</dt>
              <dd>{timeAgo(m.lastSeenAt, now)}</dd>
            </dl>
          </div>
        </Popup>
      </Marker>
    ));
}
