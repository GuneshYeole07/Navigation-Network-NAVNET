/**
 * Geodesic helpers used by routing, monitoring and analytics.
 * Coordinates are [lat, lng] in degrees; distances are metres.
 */

const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

export function haversine(a, b) {
  const [lat1, lng1] = a;
  const [lat2, lng2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, 0–360°. */
export function bearing(a, b) {
  const [lat1, lng1] = a.map(toRad);
  const [lat2, lng2] = b.map(toRad);
  const y = Math.sin(lng2 - lng1) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Cumulative distance at each vertex of a polyline. */
export function cumulativeDistances(line) {
  const out = [0];
  for (let i = 1; i < line.length; i++) out.push(out[i - 1] + haversine(line[i - 1], line[i]));
  return out;
}

export function polylineLength(line) {
  const c = cumulativeDistances(line);
  return c[c.length - 1] || 0;
}

/**
 * Project point p onto a polyline.
 * Uses a local equirectangular projection per segment — accurate to well under
 * a metre at convoy scales, and far cheaper than true geodesic projection.
 * Returns { distance: metres from line, along: metres from line start, index: segment }.
 */
export function projectOnLine(p, line, cum = cumulativeDistances(line), window = null) {
  if (!line || line.length === 0) return { distance: Infinity, along: 0, index: 0 };
  if (line.length === 1) return { distance: haversine(p, line[0]), along: 0, index: 0 };

  let best = { distance: Infinity, along: 0, index: 0 };
  const cosLat = Math.cos(toRad(p[0]));
  const mx = (lng) => toRad(lng) * cosLat * R;
  const my = (lat) => toRad(lat) * R;
  const px = mx(p[1]);
  const py = my(p[0]);

  for (let i = 0; i < line.length - 1; i++) {
    // Optional along-route window: lets callers ignore far-away parts of a route that
    // loops back near itself, so progress doesn't "teleport" between legs.
    if (window && (cum[i + 1] < window.min || cum[i] > window.max)) continue;
    const ax = mx(line[i][1]);
    const ay = my(line[i][0]);
    const bx = mx(line[i + 1][1]);
    const by = my(line[i + 1][0]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const d = Math.hypot(px - cx, py - cy);
    if (d < best.distance) {
      const segLen = cum[i + 1] - cum[i];
      best = { distance: d, along: cum[i] + t * segLen, index: i };
    }
  }
  return best;
}

/** Point at a given distance along a polyline (used by the simulator and seeding). */
export function pointAlong(line, meters, cum = cumulativeDistances(line)) {
  if (meters <= 0) return line[0];
  const total = cum[cum.length - 1];
  if (meters >= total) return line[line.length - 1];
  let i = 1;
  while (cum[i] < meters) i++;
  const seg = cum[i] - cum[i - 1];
  const t = seg === 0 ? 0 : (meters - cum[i - 1]) / seg;
  const [aLat, aLng] = line[i - 1];
  const [bLat, bLng] = line[i];
  return [aLat + (bLat - aLat) * t, aLng + (bLng - aLng) * t];
}

/** Linear densification so straight-line fallback routes still project nicely. */
export function densify(points, stepMeters = 500) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const n = Math.max(1, Math.ceil(haversine(a, b) / stepMeters));
    for (let k = 0; k < n; k++) {
      out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

export const isValidLatLng = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/**
 * Turns derived from route geometry (same algorithm as the client's turn cues).
 * Returns [{ along, type: "slight"|"turn"|"sharp", side, angle }].
 */
export function detectTurns(line, cum = cumulativeDistances(line)) {
  if (!line || line.length < 3) return [];
  const LOOK = 40;
  const turns = [];
  for (let i = 1; i < line.length - 1; i++) {
    const before = pointAlong(line, cum[i] - LOOK, cum);
    const after = pointAlong(line, cum[i] + LOOK, cum);
    if (haversine(before, line[i]) < 10 || haversine(line[i], after) < 10) continue;
    let delta = bearing(line[i], after) - bearing(before, line[i]);
    delta = ((delta + 540) % 360) - 180;
    const a = Math.abs(delta);
    if (a < 30 || a > 170) continue;
    const t = { along: cum[i], angle: Math.round(delta), side: delta > 0 ? "right" : "left", type: a < 55 ? "slight" : a < 125 ? "turn" : "sharp" };
    const last = turns[turns.length - 1];
    if (last && t.along - last.along < 60) {
      if (a > Math.abs(last.angle)) turns[turns.length - 1] = t;
    } else turns.push(t);
  }
  return turns;
}
