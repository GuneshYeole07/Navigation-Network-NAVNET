/**
 * Essentials along the route — fuel, hospitals, mechanics/puncture shops, police —
 * from OpenStreetMap via the Overpass API. Fetched once per trip and cached in Postgres,
 * then saved on riders' phones with the offline map so they work in dead zones.
 */
import { prisma } from "../database/prisma.js";
import { env } from "../config/env.js";
import { cumulativeDistances, haversine, pointAlong, projectOnLine } from "../utils/geo.js";
import { describeError } from "./routing.service.js";
import { assertTripAccess } from "./trip.service.js";

const MAX_AGE_MS = 14 * 24 * 3600 * 1000;
const SEGMENT_M = 20000; // query the route in ~20 km boxes so long trips don't ask for half a state
const PAD_DEG = 0.03; // ≈ 3 km

/** Which OSM tags map to which category, and how far from the route each is worth showing. */
export const CATEGORIES = {
  fuel: { label: "Fuel", maxFromRoute: 2500 },
  hospital: { label: "Hospital", maxFromRoute: 8000 },
  mechanic: { label: "Mechanic", maxFromRoute: 3000 },
  police: { label: "Police", maxFromRoute: 5000 },
};

export function categoryOf(tags = {}) {
  if (tags.amenity === "fuel") return "fuel";
  if (tags.amenity === "hospital" || tags.amenity === "clinic" || tags.healthcare === "hospital") return "hospital";
  if (["car_repair", "motorcycle_repair", "tyres", "bicycle"].includes(tags.shop) || tags.craft === "mechanic") return "mechanic";
  if (tags.amenity === "police") return "police";
  return null;
}

export function buildQuery(line) {
  const cum = cumulativeDistances(line);
  const total = cum[cum.length - 1];
  const boxes = [];
  for (let m = 0; m <= total; m += SEGMENT_M) {
    const a = pointAlong(line, m, cum);
    const b = pointAlong(line, Math.min(total, m + SEGMENT_M), cum);
    const s = Math.min(a[0], b[0]) - PAD_DEG;
    const n = Math.max(a[0], b[0]) + PAD_DEG;
    const w = Math.min(a[1], b[1]) - PAD_DEG;
    const e = Math.max(a[1], b[1]) + PAD_DEG;
    boxes.push(`${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)}`);
  }
  const sel = [
    'nwr["amenity"="fuel"]',
    'nwr["amenity"~"^(hospital|clinic)$"]',
    'nwr["shop"~"^(car_repair|motorcycle_repair|tyres|bicycle)$"]',
    'nwr["craft"="mechanic"]',
    'nwr["amenity"="police"]',
  ];
  const parts = boxes.flatMap((bb) => sel.map((q) => `${q}(${bb});`)).join("");
  return `[out:json][timeout:40];(${parts});out center tags 1500;`;
}

/** Overpass JSON → [{ id, category, name, lat, lng, along, fromRoute, phone }] near the route. */
export function parsePois(json, line) {
  const cum = cumulativeDistances(line);
  const seen = new Set();
  const out = [];
  for (const el of json.elements || []) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    const category = categoryOf(el.tags);
    if (lat == null || !category || seen.has(`${el.type}${el.id}`)) continue;
    seen.add(`${el.type}${el.id}`);
    const proj = projectOnLine([lat, lng], line, cum);
    if (proj.distance > CATEGORIES[category].maxFromRoute) continue;
    const t = el.tags || {};
    out.push({
      id: `${el.type}/${el.id}`,
      category,
      name: t.name || t.brand || t.operator || CATEGORIES[category].label,
      lat,
      lng,
      along: Math.round(proj.along),
      fromRoute: Math.round(proj.distance),
      phone: t.phone || t["contact:phone"] || null,
      open24: t.opening_hours === "24/7",
    });
  }
  return out.sort((a, b) => a.along - b.along).slice(0, 400);
}

export async function getPois(tripId, user, { refresh = false } = {}) {
  await assertTripAccess(tripId, user);
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { routeGeometry: true, pois: true, poisAt: true } });
  if (!refresh && trip.pois && trip.poisAt && Date.now() - trip.poisAt.getTime() < MAX_AGE_MS) {
    return { pois: trip.pois, fetchedAt: trip.poisAt, source: "cache" };
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    const res = await fetch(env.overpassUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": env.geoUserAgent },
      body: `data=${encodeURIComponent(buildQuery(trip.routeGeometry))}`,
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const pois = parsePois(await res.json(), trip.routeGeometry);
    const fetchedAt = new Date();
    await prisma.trip.update({ where: { id: tripId }, data: { pois, poisAt: fetchedAt } });
    return { pois, fetchedAt, source: "overpass" };
  } catch (err) {
    if (!env.isTest) console.warn(`[pois] Overpass failed — ${describeError(err)}`);
    // Serve stale data rather than nothing.
    if (trip.pois) return { pois: trip.pois, fetchedAt: trip.poisAt, source: "stale" };
    return { pois: [], fetchedAt: null, source: "unavailable" };
  }
}

export { haversine };
