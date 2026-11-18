import { useState } from "react";
import { Crown, MessageSquare, MoreVertical, Phone, ShieldHalf, UserMinus, Battery } from "lucide-react";
import Avatar from "../ui/Avatar";
import { MemberStatusPill } from "../ui/StatusPill";
import { formatClock, formatDistance, formatSpeed, timeAgo } from "../../utils/format";

const ORDER = { MOVING: 0, STOPPED: 1, OFFLINE: 2, ARRIVED: 3 };

export default function MemberTable({ members, now, onFocus, onMessage, onMakeLeader, onMakeSweep, onRemove, focusedId, phones = {} }) {
  const [menu, setMenu] = useState(null);
  const sorted = [...members].sort((a, b) => (b.isLeader - a.isLeader) || ORDER[a.status] - ORDER[b.status] || b.progress - a.progress);

  if (!members.length)
    return <p className="p-4 text-center text-sm muted">No one has joined yet. Share the Group ID and password with your riders.</p>;

  return (
    <ul className="divide-y divide-road-line dark:divide-asphalt-500">
      {sorted.map((m) => (
        <li key={m.userId} className={`relative ${focusedId === m.userId ? "bg-nh-50/70 dark:bg-nh/10" : ""}`}>
          <div className="flex items-start gap-3 p-3">
            <button onClick={() => onFocus(m.userId)} className="flex min-w-0 flex-1 items-start gap-3 text-left" aria-label={`Show ${m.name} on map`}>
              <Avatar id={m.userId} name={m.name} size={36} className={m.status === "OFFLINE" ? "opacity-50" : ""} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-semibold">{m.name}</span>
                  {m.isLeader && <Crown size={14} className="shrink-0 text-stone-capdark" aria-label="Group leader" />}
                  {m.isSweep && <span className="chip bg-asphalt px-1.5 text-[10px] text-white dark:bg-road dark:text-asphalt">Sweep</span>}
                  {m.isAdmin && <span className="chip bg-nh-50 px-1.5 text-[10px] text-nh">You</span>}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 text-xs muted">
                  <MemberStatusPill status={m.status} />
                  {m.vehicleNumber && <span>{m.vehicleNumber}</span>}
                </div>
                <dl className="mt-1.5 grid grid-cols-4 gap-1 text-xs">
                  <div>
                    <dt className="muted">Speed</dt>
                    <dd className="font-semibold">{formatSpeed(m.speed)}</dd>
                  </div>
                  <div>
                    <dt className="muted">ETA</dt>
                    <dd className="font-semibold">{m.status === "ARRIVED" ? "Here" : m.eta ? formatClock(m.eta) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="muted">To leader</dt>
                    <dd className="font-semibold">{m.isLeader ? "—" : formatDistance(m.distanceFromLeader)}</dd>
                  </div>
                  <div>
                    <dt className="muted">Updated</dt>
                    <dd className="font-semibold">{timeAgo(m.lastSeenAt, now)}</dd>
                  </div>
                </dl>
                {m.battery != null && m.battery < 20 && (
                  <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-signal">
                    <Battery size={13} /> {m.battery}% battery
                  </p>
                )}
              </div>
            </button>
            {phones[m.userId] && (
              <a href={`tel:${phones[m.userId]}`} className="btn-ghost !p-1.5 text-nh" aria-label={`Call ${m.name}`} title={`Call ${phones[m.userId]}`}>
                <Phone size={16} />
              </a>
            )}
            <button
              className="btn-ghost !p-1.5"
              onClick={() => setMenu(menu === m.userId ? null : m.userId)}
              aria-label={`Actions for ${m.name}`}
              aria-expanded={menu === m.userId}
            >
              <MoreVertical size={16} />
            </button>
          </div>
          {menu === m.userId && (
            <div className="absolute right-3 top-11 z-20 w-48 overflow-hidden rounded-control bg-white py-1 text-sm shadow-float ring-1 ring-road-line dark:bg-asphalt-700 dark:ring-asphalt-500" role="menu">
              <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 hover:bg-road dark:hover:bg-asphalt-600" onClick={() => (setMenu(null), onMessage(m.userId))}>
                <MessageSquare size={15} /> Message privately
              </button>
              {!m.isLeader && (
                <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 hover:bg-road dark:hover:bg-asphalt-600" onClick={() => (setMenu(null), onMakeLeader(m))}>
                  <Crown size={15} /> Make group leader
                </button>
              )}
              {onMakeSweep && (
                <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 hover:bg-road dark:hover:bg-asphalt-600" onClick={() => (setMenu(null), onMakeSweep(m))}>
                  <ShieldHalf size={15} /> {m.isSweep ? "Remove as sweep" : "Make sweep (rides last)"}
                </button>
              )}
              <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-signal hover:bg-signal-50 dark:hover:bg-signal/10" onClick={() => (setMenu(null), onRemove(m))}>
                <UserMinus size={15} /> Remove from trip
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
