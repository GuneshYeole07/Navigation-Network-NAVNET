import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, Printer } from "lucide-react";
import { tripService } from "../services/tripService";
import { useAuth } from "../context/AuthContext";
import { FullScreenLoader } from "../components/ui/Skeleton";
import EmptyState from "../components/ui/EmptyState";
import Milestone from "../components/ui/Milestone";
import RoadProgress from "../components/ui/RoadProgress";
import Avatar from "../components/ui/Avatar";
import { ALERT_META, CHECKPOINT_CATEGORIES, EMERGENCY_TYPES } from "../utils/constants";
import { formatClock, formatDuration } from "../utils/format";
import RideCard from "../components/group/RideCard";
import Expenses from "../components/group/Expenses";

export default function TripReport() {
  const { id } = useParams();
  const { user } = useAuth();
  const [r, setR] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    tripService.report(id).then(setR).catch((e) => setError(e.message));
  }, [id]);

  const back = user.role === "ADMIN" ? "/admin/monitor" : "/user";
  if (error) return <EmptyState title="Analytics unavailable">{error}</EmptyState>;
  if (!r) return <FullScreenLoader label="Crunching the numbers" />;

  const stat = (label, value, sub) => (
    <div>
      <dt className="text-xs muted">{label}</dt>
      <dd className="font-display text-3xl font-semibold leading-tight">{value}</dd>
      {sub && <dd className="text-xs muted">{sub}</dd>}
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between print:hidden">
        <Link to={back} className="inline-flex items-center gap-1 text-sm font-semibold text-nh">
          <ChevronLeft size={16} /> Back
        </Link>
        <button className="btn-secondary !py-2" onClick={() => window.print()}>
          <Printer size={16} /> Print / save PDF
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-6 sm:flex-row sm:items-end">
        <Milestone place="Covered" value={r.totalDistanceKm >= 100 ? Math.round(r.totalDistanceKm) : r.totalDistanceKm.toFixed(1)} unit="km" size="lg" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-nh">{r.final ? "Trip summary" : "Live preview — the trip is still running"}</p>
          <h1 className="text-5xl leading-none">{r.tripName}</h1>
          <p className="mt-2 muted">
            {r.startedAt ? `${new Date(r.startedAt).toLocaleDateString()} · ${formatClock(r.startedAt)}` : "Not started"}
            {r.endedAt ? ` to ${formatClock(r.endedAt)}` : ""} · planned {r.plannedDistanceKm} km
          </p>
        </div>
      </div>

      <section className="panel mt-8 p-6">
        <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          {stat("Travel duration", formatDuration(r.travelDurationSeconds))}
          {stat("Average speed", `${r.averageSpeedKmh} km/h`, "while moving")}
          {stat("Max speed", `${r.maxSpeedKmh} km/h`)}
          {stat("Total stops", r.totalStops, "convoy halts of 2+ min")}
          {stat("Fuel stops", r.fuelStops)}
          {stat("Checkpoints", `${r.checkpointsVisited}/${r.checkpointsTotal}`, "visited by at least one rider")}
          {stat("Emergencies", r.emergencyEvents.length, "SOS alerts")}
          {stat("Arrived", `${r.membersArrived}/${r.membersTotal}`, "riders")}
        </dl>
        <div className="mt-6">
          <div className="mb-1.5 flex justify-between text-sm">
            <span className="muted">Route completion (average across riders)</span>
            <span className="font-semibold">{r.routeCompletionPercent}%</span>
          </div>
          <RoadProgress percent={r.routeCompletionPercent} label="Route completion" />
        </div>
      </section>

      <section className="mt-8 grid gap-6 print:hidden md:grid-cols-2">
        <div className="panel p-5">
          <h2 className="text-2xl">Share the ride</h2>
          <p className="mb-3 mt-1 text-sm muted">A summary card with the route, distance and everyone who rode, ready for the WhatsApp group.</p>
          <RideCard tripId={id} report={r} />
        </div>
        <Expenses tripId={id} />
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-[2fr_1fr]">
        <section>
          <h2 className="text-3xl">Member participation</h2>
          <div className="panel mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs muted">
                <tr className="border-b border-road-line dark:border-asphalt-500">
                  <th className="p-3 font-medium">Rider</th>
                  <th className="p-3 font-medium">Distance</th>
                  <th className="p-3 font-medium">Avg / max</th>
                  <th className="p-3 font-medium">Stops</th>
                  <th className="p-3 font-medium">Checkpoints</th>
                  <th className="p-3 font-medium">Completion</th>
                  <th className="p-3 font-medium">Alerts</th>
                  <th className="p-3 font-medium">Msgs</th>
                </tr>
              </thead>
              <tbody>
                {r.participation.map((p) => (
                  <tr key={p.userId} className="border-b border-road-line last:border-0 dark:border-asphalt-500">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <Avatar id={p.userId} name={p.name} size={28} />
                        <div>
                          <p className="font-semibold">{p.name}</p>
                          <p className="text-xs muted">{p.arrived ? `Arrived ${formatClock(p.arrivedAt)}` : p.memberStatus === "ACTIVE" ? "Didn't reach destination" : p.memberStatus.toLowerCase()}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-3">{p.distanceKm} km</td>
                    <td className="p-3">
                      {p.avgSpeedKmh} / {p.maxSpeedKmh}
                    </td>
                    <td className="p-3">{p.stops}</td>
                    <td className="p-3">{p.checkpointsVisited}</td>
                    <td className="p-3">{p.completionPercent}%</td>
                    <td className={`p-3 ${p.sosCount ? "font-semibold text-signal" : ""}`}>
                      {p.alerts}
                      {p.sosCount ? ` (${p.sosCount} SOS)` : ""}
                    </td>
                    <td className="p-3">{p.messagesSent}</td>
                  </tr>
                ))}
                {r.participation.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-6 text-center muted">
                      No riders joined this trip.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="space-y-8">
          <section>
            <h2 className="text-3xl">Checkpoints</h2>
            <ul className="mt-3 space-y-2">
              {r.checkpoints.map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-sm">
                  <span aria-hidden="true">{CHECKPOINT_CATEGORIES[c.category]?.emoji}</span>
                  <span className="flex-1">{c.name}</span>
                  <span className={c.visitedBy ? "font-semibold text-nh" : "muted"}>{c.visitedBy} riders</span>
                </li>
              ))}
              {r.checkpoints.length === 0 && <li className="text-sm muted">No checkpoints were planned.</li>}
            </ul>
          </section>
          <section>
            <h2 className="text-3xl">Alerts raised</h2>
            <ul className="mt-3 space-y-1.5 text-sm">
              {Object.entries(r.alertsByType).map(([k, n]) => (
                <li key={k} className="flex justify-between">
                  <span>
                    {ALERT_META[k]?.emoji} {ALERT_META[k]?.label}
                  </span>
                  <span className="font-semibold">{n}</span>
                </li>
              ))}
              {Object.keys(r.alertsByType).length === 0 && <li className="muted">No alerts. A clean ride.</li>}
            </ul>
            {r.emergencyEvents.length > 0 && (
              <ul className="mt-4 space-y-2">
                {r.emergencyEvents.map((e, i) => (
                  <li key={i} className="rounded-control bg-signal-50 p-2.5 text-sm dark:bg-signal/15">
                    <p className="font-semibold text-signal">{EMERGENCY_TYPES[e.emergencyType]?.label || "Emergency"} · {formatClock(e.at)}</p>
                    <p>{e.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
