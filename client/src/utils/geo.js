/**
 * Client-side route maths. Mirrors server/src/utils/geo.js so the rider's own
 * progress, ETA, off-route state and turn cues work with zero network.
 * Coordinates are [lat, lng]; distances in metres.
 */
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function haversine([lat1, lng1], [lat2, lng2]) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearing(a, b) {
  const [la1, lo1] = [rad(a[0]), rad(a[1])];
  const [la2, lo2] = [rad(b[0]), rad(b[1])];
  const y = Math.sin(lo2 - lo1) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(lo2 - lo1);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export function cumulative(line) {
  const out = [0];
  for (let i = 1; i < line.length; i++) out.push(out[i - 1] + haversine(line[i - 1], line[i]));
  return out;
}

/** Project p onto the polyline: { distance from line, along (m from start), index } */
export function project(p, line, cum, window = null) {
  let best = { distance: Infinity, along: 0, index: 0 };
  if (!line?.length) return best;
  const cosLat = Math.cos(rad(p[0]));
  const X = (lng) => rad(lng) * cosLat * R;
  const Y = (lat) => rad(lat) * R;
  const px = X(p[1]);
  const py = Y(p[0]);
  for (let i = 0; i < line.length - 1; i++) {
    if (window && (cum[i + 1] < window.min || cum[i] > window.max)) continue;
    const ax = X(line[i][1]), ay = Y(line[i][0]), bx = X(line[i + 1][1]), by = Y(line[i + 1][0]);
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best.distance) best = { distance: d, along: cum[i] + t * (cum[i + 1] - cum[i]), index: i };
  }
  return best;
}

export function pointAlong(line, m, cum) {
  if (m <= 0) return line[0];
  const total = cum[cum.length - 1];
  if (m >= total) return line[line.length - 1];
  let i = 1;
  while (cum[i] < m) i++;
  const t = (m - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t];
}

/**
 * Turn-by-turn cues derived from the route geometry itself, so they work offline and
 * with any routing provider. Compares the heading ~40 m before and after each vertex.
 * Returns [{ along, type: "slight"|"turn"|"sharp", side: "left"|"right", angle }].
 */
export function detectTurns(line, cum = cumulative(line)) {
  if (!line || line.length < 3) return [];
  const LOOK = 40;
  const turns = [];
  for (let i = 1; i < line.length - 1; i++) {
    const before = pointAlong(line, cum[i] - LOOK, cum);
    const after = pointAlong(line, cum[i] + LOOK, cum);
    if (haversine(before, line[i]) < 10 || haversine(line[i], after) < 10) continue;
    let delta = bearing(line[i], after) - bearing(before, line[i]);
    delta = ((delta + 540) % 360) - 180; // −180..180, + = right
    const a = Math.abs(delta);
    if (a < 30 || a > 170) continue;
    const t = { along: cum[i], angle: Math.round(delta), side: delta > 0 ? "right" : "left", type: a < 55 ? "slight" : a < 125 ? "turn" : "sharp" };
    const last = turns[turns.length - 1];
    // Vertices of one bend: keep the sharpest within 60 m.
    if (last && t.along - last.along < 60) {
      if (a > Math.abs(last.angle)) turns[turns.length - 1] = t;
    } else turns.push(t);
  }
  return turns;
}

export const turnText = (t) =>
  t.type === "slight" ? `Keep ${t.side}` : t.type === "sharp" ? `Sharp ${t.side}` : `Turn ${t.side}`;

/** Web-Mercator tile containing a point. */
export function tileOf(lat, lng, z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latR = rad(lat);
  const y = Math.floor(((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n);
  return [Math.max(0, Math.min(n - 1, x)), Math.max(0, Math.min(n - 1, y))];
}

/**
 * Tiles covering a corridor around the route. Wider at low zoom (overview),
 * tight at street zoom (only what a rider on the route needs).
 */
export const OFFLINE_ZOOMS = [
  { z: 10, buffer: 8000 },
  { z: 11, buffer: 5000 },
  { z: 12, buffer: 3000 },
  { z: 13, buffer: 1500 },
  { z: 14, buffer: 700 },
  { z: 15, buffer: 350 },
  { z: 16, buffer: 150 },
];

export function corridorTiles(line, zooms = OFFLINE_ZOOMS) {
  const cum = cumulative(line);
  const total = cum[cum.length - 1] || 0;
  const keys = new Set();
  for (const { z, buffer } of zooms) {
    const step = Math.max(50, buffer / 2);
    for (let m = 0; m <= total + step; m += step) {
      const [lat, lng] = pointAlong(line, Math.min(m, total), cum);
      const dLat = buffer / 111320;
      const dLng = buffer / (111320 * Math.cos(rad(lat)));
      const [x1, y1] = tileOf(lat + dLat, lng - dLng, z);
      const [x2, y2] = tileOf(lat - dLat, lng + dLng, z);
      for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) keys.add(`${z}/${x}/${y}`);
    }
  }
  return [...keys];
}

export const boundsOf = (points) => points.filter((p) => p && p[0] != null && p[1] != null);

const CARDINAL = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
export const cardinal = (deg) => CARDINAL[Math.round(deg / 45) % 8];

/**
 * Guidance to an arbitrary target (meet pin, a friend's SOS, a fuel pump).
 * On the route → "1.2 km ahead / behind" along the road; off the route → straight-line
 * distance + compass direction (works with no network, needs only GPS).
 */
export function guideTo(target, fix, route) {
  if (!target || !fix) return null;
  const me = [fix.lat, fix.lng];
  const there = [target.lat, target.lng];
  const straight = haversine(me, there);
  if (route) {
    const t = project(there, route.line, route.cum);
    const m = project(me, route.line, route.cum);
    if (t.distance < 150 && m.distance < 150) {
      const d = t.along - m.along;
      return { distance: Math.abs(d), direction: d >= -30 ? "ahead" : "behind", onRoute: true, straight };
    }
  }
  return { distance: straight, direction: cardinal(bearing(me, there)), onRoute: false, straight };
}
