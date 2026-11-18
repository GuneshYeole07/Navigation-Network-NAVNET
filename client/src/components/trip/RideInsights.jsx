import { useEffect, useMemo, useRef, useState } from "react";
import { tripService } from "../../services/tripService";

/**
 * "Ride insights" from the Python analytics service: speed along the route (km by km),
 * the slow stretches, where the group stopped, and how each rider rode.
 * Renders nothing when the analytics service isn't running.
 */
export default function RideInsights({ tripId }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    tripService
      .insights(tripId)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [tripId]);

  if (!data?.available || !data.has_data) return null;
  const s = data.summary;
  return (
    <section className="panel mt-8 p-6" aria-labelledby="insights-title">
      <h2 id="insights-title" className="text-3xl">
        Ride insights
      </h2>
      <p className="mt-1 text-sm muted">
        Moving {s.moving_min} min · stopped {s.stopped_min} min · typical moving speed {s.avg_moving_kmh} km/h (planned {s.planned_kmh} km/h)
      </p>

      <SpeedProfile profile={data.speed_profile} slow={data.slowest_stretches} stops={data.stops} />

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="text-xl">Slowest stretches</h3>
          {data.slowest_stretches.length ? (
            <ul className="mt-2 space-y-1.5 text-sm">
              {data.slowest_stretches.map((x) => (
                <li key={x.from_km} className="flex justify-between gap-3 rounded-control bg-road px-3 py-2 dark:bg-asphalt-600">
                  <span>
                    km {x.from_km}–{x.to_km}
                  </span>
                  <span>
                    <strong>{x.kmh} km/h</strong> <span className="muted">· {x.vs_typical_pct}% slower than usual</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm muted">No unusually slow sections. Steady ride.</p>
          )}
        </div>
        <div>
          <h3 className="text-xl">Where the group stopped</h3>
          {data.stops.length ? (
            <ul className="mt-2 space-y-1.5 text-sm">
              {data.stops.map((x) => (
                <li key={`${x.km}-${x.start}`} className="flex justify-between gap-3 rounded-control bg-road px-3 py-2 dark:bg-asphalt-600">
                  <span>
                    km {x.km} · {new Date(x.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </span>
                  <span>
                    <strong>{x.minutes} min</strong> <span className="muted">· {x.whole_group ? "whole group" : `${x.riders} rider${x.riders > 1 ? "s" : ""}`}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm muted">No stops longer than 3 minutes.</p>
          )}
        </div>
      </div>

      <h3 className="mt-6 text-xl">How everyone rode</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="text-left text-xs muted">
            <tr>
              <th className="py-1.5 font-medium">Rider</th>
              <th className="py-1.5 text-right font-medium">Moving speed</th>
              <th className="py-1.5 text-right font-medium" title="100 = perfectly even pace">
                Steadiness
              </th>
              <th className="py-1.5 text-right font-medium">Avg. behind leader</th>
              <th className="py-1.5 text-right font-medium">Time &gt;1.5 km behind</th>
            </tr>
          </thead>
          <tbody>
            {data.riders.map((r) => (
              <tr key={r.user_id} className="border-t border-road-line dark:border-asphalt-500">
                <td className="py-1.5">{r.name}</td>
                <td className="py-1.5 text-right tabular-nums">{r.avg_moving_kmh} km/h</td>
                <td className="py-1.5 text-right tabular-nums">{r.steadiness}/100</td>
                <td className="py-1.5 text-right tabular-nums">{r.avg_gap_m >= 1000 ? `${(r.avg_gap_m / 1000).toFixed(1)} km` : `${r.avg_gap_m} m`}</td>
                <td className="py-1.5 text-right tabular-nums">{r.time_far_behind_pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs muted">Calculated by NavNet's analytics service from everyone's GPS track.</p>
    </section>
  );
}

const H = 200;
const PAD = { l: 40, r: 12, t: 12, b: 28 };

/** Median group speed for each km, with slow stretches shaded and stops marked on the axis. */
function SpeedProfile({ profile, slow, stops }) {
  const wrap = useRef(null);
  const [w, setW] = useState(640);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const pts = profile.filter((p) => p.kmh != null);
  const km = profile.length;
  const maxV = useMemo(() => Math.max(10, Math.ceil(Math.max(...pts.map((p) => p.kmh), 0) / 10) * 10), [pts]);
  if (pts.length < 2) return null;
  const x = (k) => PAD.l + ((k + 0.5) / km) * (w - PAD.l - PAD.r);
  const y = (v) => PAD.t + (1 - v / maxV) * (H - PAD.t - PAD.b);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.km).toFixed(1)},${y(p.kmh).toFixed(1)}`).join("");
  const area = `${line}L${x(pts[pts.length - 1].km).toFixed(1)},${y(0)}L${x(pts[0].km).toFixed(1)},${y(0)}Z`;
  const ticks = [0, maxV / 2, maxV];
  const kmTicks = Array.from(new Set([0, Math.round(km / 4), Math.round(km / 2), Math.round((3 * km) / 4), km])).filter((k) => k <= km);

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const k = Math.floor(((e.clientX - r.left - PAD.l) / (w - PAD.l - PAD.r)) * km);
    const p = profile[Math.max(0, Math.min(km - 1, k))];
    setHover(p?.kmh != null ? p : null);
  };

  return (
    <figure className="mt-5">
      <figcaption className="text-sm font-semibold">
        Group speed along the route <span className="font-normal muted">(km/h, median of riders who were moving)</span>
      </figcaption>
      <div ref={wrap} className="relative mt-2">
        <svg width={w} height={H} role="img" aria-label="Group speed for each kilometre of the route, with slow stretches shaded and stops marked" onMouseMove={onMove} onMouseLeave={() => setHover(null)} className="block">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} className="stroke-road-line dark:stroke-asphalt-500" strokeWidth="1" />
              <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="fill-current text-[11px] opacity-60">
                {t}
              </text>
            </g>
          ))}
          {slow.map((s) => (
            <rect key={s.from_km} x={x(s.from_km) - (w - PAD.l - PAD.r) / km / 2} width={((s.to_km - s.from_km) / km) * (w - PAD.l - PAD.r)} y={PAD.t} height={H - PAD.t - PAD.b} fill="#F2B705" opacity="0.18" />
          ))}
          <path d={area} fill="#0E6B4F" opacity="0.12" />
          <path d={line} fill="none" stroke="#0E6B4F" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className="dark:stroke-[#4FBF94]" />
          {stops.map((s) => (
            <g key={`${s.km}-${s.start}`}>
              <circle cx={x(Math.min(km - 1, Math.floor(s.km)))} cy={y(0)} r="5" fill="#1E2328" stroke="white" strokeWidth="2" className="dark:fill-[#F5F7F4] dark:stroke-[#1E2328]" />
              <title>{`Stop at km ${s.km}: ${s.minutes} min`}</title>
            </g>
          ))}
          {kmTicks.map((k) => (
            <text key={k} x={PAD.l + (k / km) * (w - PAD.l - PAD.r)} y={H - 8} textAnchor={k === 0 ? "start" : k === km ? "end" : "middle"} className="fill-current text-[11px] opacity-60">
              {k} km
            </text>
          ))}
          {hover && (
            <g pointerEvents="none">
              <line x1={x(hover.km)} x2={x(hover.km)} y1={PAD.t} y2={y(0)} stroke="currentColor" strokeOpacity="0.35" strokeWidth="1" />
              <circle cx={x(hover.km)} cy={y(hover.kmh)} r="4.5" fill="#0E6B4F" stroke="white" strokeWidth="2" />
            </g>
          )}
        </svg>
        {hover && (
          <div className="pointer-events-none absolute -translate-x-1/2 rounded-md bg-asphalt px-2 py-1 text-xs font-semibold text-white shadow-float" style={{ left: x(hover.km), top: Math.max(0, y(hover.kmh) - 34) }}>
            km {hover.km}–{hover.km + 1}: {hover.kmh} km/h
          </div>
        )}
      </div>
      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs muted">
        <span>
          <span className="mr-1 inline-block h-2.5 w-3 rounded-sm align-middle" style={{ background: "#F2B70540", outline: "1px solid #F2B70580" }} />
          Slow stretch
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-asphalt align-middle dark:bg-road" />
          Group stop
        </span>
      </p>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer muted">Show as a table</summary>
        <div className="mt-2 max-h-48 overflow-auto">
          <table className="w-full text-left">
            <thead className="muted">
              <tr>
                <th className="pr-4 font-medium">km</th>
                <th className="font-medium">Group speed</th>
              </tr>
            </thead>
            <tbody>
              {profile.map((p) => (
                <tr key={p.km}>
                  <td className="pr-4 tabular-nums">
                    {p.km}–{p.km + 1}
                  </td>
                  <td className="tabular-nums">{p.kmh == null ? "—" : `${p.kmh} km/h`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
