import { CheckCheck, MapPin, Phone } from "lucide-react";
import { ALERT_META, EMERGENCY_TYPES } from "../../utils/constants";
import { formatClock, timeAgo } from "../../utils/format";

export default function AlertFeed({ alerts, onAck, onLocate, now, phones = {} }) {
  if (!alerts.length)
    return <p className="p-4 text-center text-sm muted">All clear. Route deviations, stops, low battery, speeding and SOS alerts will show up here.</p>;
  return (
    <ul className="space-y-2 p-2">
      {alerts.map((a) => {
        const meta = ALERT_META[a.type] || {};
        const sos = a.type === "SOS";
        const acked = !!a.acknowledgedAt;
        return (
          <li
            key={a.id}
            className={`rounded-control p-3 text-sm ring-1 ${
              sos && !acked ? "bg-signal-50 ring-signal dark:bg-signal/15" : "ring-road-line dark:ring-asphalt-500"
            } ${acked ? "opacity-60" : ""}`}
          >
            <div className="flex items-start gap-2">
              <span aria-hidden="true" className="text-lg leading-none">{meta.emoji}</span>
              <div className="min-w-0 flex-1">
                <p className={`font-semibold ${sos ? "text-signal" : ""}`}>{meta.label}</p>
                <p>{a.message}</p>
                {sos && a.data && (
                  <dl className="mt-1.5 grid grid-cols-2 gap-x-3 text-xs">
                    <dt className="muted">Type</dt>
                    <dd>{EMERGENCY_TYPES[a.data.emergencyType]?.label}</dd>
                    <dt className="muted">Speed</dt>
                    <dd>{a.data.speed != null ? `${Math.round(a.data.speed)} km/h` : "—"}</dd>
                    <dt className="muted">Battery</dt>
                    <dd>{a.data.battery != null ? `${a.data.battery}%` : "—"}</dd>
                    <dt className="muted">GPS</dt>
                    <dd>{a.lat?.toFixed(5)}, {a.lng?.toFixed(5)}</dd>
                    {a.data.note && (
                      <>
                        <dt className="muted">Note</dt>
                        <dd>{a.data.note}</dd>
                      </>
                    )}
                    {a.data.bloodGroup && (
                      <>
                        <dt className="muted">Blood group</dt>
                        <dd className="font-semibold">{a.data.bloodGroup}</dd>
                      </>
                    )}
                    {a.data.emergencyPhone && (
                      <>
                        <dt className="muted">Emergency contact</dt>
                        <dd>
                          {a.data.emergencyName || "Contact"} ·{" "}
                          <a className="font-semibold text-nh underline" href={`tel:${a.data.emergencyPhone}`}>
                            {a.data.emergencyPhone}
                          </a>
                        </dd>
                      </>
                    )}
                    {a.data.medicalNotes && (
                      <>
                        <dt className="muted">Medical</dt>
                        <dd>{a.data.medicalNotes}</dd>
                      </>
                    )}
                  </dl>
                )}
                <p className="mt-1 text-[11px] muted">
                  {formatClock(a.createdAt)} · {timeAgo(a.createdAt, now)}
                  {acked && " · acknowledged"}
                </p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {a.lat != null && (
                <button className="btn-secondary !px-2.5 !py-1.5 text-xs" onClick={() => onLocate([a.lat, a.lng], a.userId)}>
                  <MapPin size={13} /> Show on map
                </button>
              )}
              {sos && phones[a.userId] && (
                <a href={`tel:${phones[a.userId]}`} className="btn-secondary !px-2.5 !py-1.5 text-xs">
                  <Phone size={13} /> Call {a.userName?.split(" ")[0]}
                </a>
              )}
              {!acked && (
                <button className={`${sos ? "btn-danger" : "btn-secondary"} !px-2.5 !py-1.5 text-xs`} onClick={() => onAck(a.id)}>
                  <CheckCheck size={13} /> {sos ? "Acknowledge SOS" : "Mark as seen"}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
