import { formatClock, formatDistance, formatSpeed } from "../../utils/format";

/** Live convoy analytics. The two numbers an admin scans first get the big type. */
export default function ConvoyStats({ stats, smartEta = null }) {
  if (!stats) return null;
  const cells = [
    ["Active", stats.activeMembers, `of ${stats.totalMembers}`],
    ["Offline", stats.offlineMembers, null, stats.offlineMembers > 0 ? "text-signal" : ""],
    ["Arrived", stats.arrivedMembers, null],
    ["Avg speed", formatSpeed(stats.averageSpeed), null],
    ["Fastest", stats.fastest ? formatSpeed(stats.fastest.speed) : "—", stats.fastest?.name],
    ["Slowest", stats.slowest ? formatSpeed(stats.slowest.speed) : "—", stats.slowest?.name],
  ];
  return (
    <section aria-label="Live convoy dashboard" className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-control bg-asphalt p-3 text-road dark:bg-asphalt-600">
          <p className="text-xs text-road/70">Convoy length</p>
          <p className="font-display text-3xl font-bold leading-tight">{formatDistance(stats.convoyLength)}</p>
          <p className="text-[11px] text-road/60">first to last rider</p>
        </div>
        <div className="rounded-control bg-nh p-3 text-white">
          <p className="text-xs text-white/75">Distance remaining</p>
          <p className="font-display text-3xl font-bold leading-tight">{formatDistance(stats.distanceRemaining)}</p>
          <p className="text-[11px] text-white/70">until the last rider arrives</p>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
        {cells.map(([label, value, sub, cls]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs muted">{label}</dt>
            <dd className={`font-display text-xl font-semibold leading-tight ${cls || ""}`}>{value}</dd>
            {sub && <dd className="truncate text-[11px] muted">{sub}</dd>}
          </div>
        ))}
      </dl>
      {smartEta && (
        <p className="rounded-control bg-road px-3 py-2 text-sm dark:bg-asphalt-600">
          <span className="font-semibold">Smart ETA {formatClock(new Date(smartEta.arrival_at))}</span>
          <span className="muted">
            {" "}
            · {Math.round(smartEta.minutes_left)} min left, learned from past rides (usually within ±{Math.round(smartEta.typical_error_minutes || 0)} min)
          </span>
        </p>
      )}
    </section>
  );
}
