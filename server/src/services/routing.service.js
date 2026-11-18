/**
 * Routing + geocoding over open-source services only (no Google):
 *   1. OpenRouteService (if ORS_API_KEY set) — best quality, free key.
 *   2. OSRM (public demo or self-hosted)      — no key needed.
 *   3. Straight-line fallback                 — keeps the app usable offline / when both are down.
 * Geocoding: Nominatim (OpenStreetMap), cached and proxied server-side so we can set a
 * proper User-Agent and respect the usage policy.
 */
import { env } from "../config/env.js";
import { densify, polylineLength } from "../utils/geo.js";

const TIMEOUT_MS = 10000;

async function fetchJson(url, options = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    if (!res.ok) {
      // OSRM explains "no route" in a JSON body on HTTP 400: pass that through.
      if (res.status === 400 && /json/.test(res.headers.get("content-type") || "")) return await res.json();
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const ORS_PROFILES = { driving: "driving-car", cycling: "cycling-regular", walking: "foot-walking" };
const OSRM_PROFILES = { driving: "driving", cycling: "cycling", walking: "foot" };
const FOSSGIS_PROFILES = { driving: "car", cycling: "bike", walking: "foot" };
const OSRM_DEMO = "https://router.project-osrm.org";

/** Friendly reasons, shown to the admin under the route preview. */
const OSRM_REASONS = {
  NoSegment: "One of your points is too far from any road. Move it closer to a road.",
  NoRoute: "There's no road connection between these points.",
  TooBig: "Too many stops for one route. Remove a few waypoints.",
};

class RouteError extends Error {}

async function viaOrs(coords, profile) {
  const url = `https://api.openrouteservice.org/v2/directions/${ORS_PROFILES[profile]}/geojson`;
  const data = await fetchJson(url, {
    method: "POST",
    headers: { Authorization: env.orsApiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ coordinates: coords.map(([lat, lng]) => [lng, lat]) }),
  });
  const f = data.features?.[0];
  if (!f) throw new Error("ORS returned no route");
  return {
    geometry: f.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distance: f.properties.summary.distance,
    duration: f.properties.summary.duration,
    provider: "openrouteservice",
  };
}

async function viaOsrm(coords, base, profileName) {
  const path = coords.map(([lat, lng]) => `${lng},${lat}`).join(";");
  const url = `${base}/route/v1/${profileName}/${path}?overview=full&geometries=geojson`;
  const data = await fetchJson(url, { headers: { "User-Agent": env.geoUserAgent } });
  const r = data.routes?.[0];
  if (data.code !== "Ok" || !r) throw new RouteError(OSRM_REASONS[data.code] || `OSRM: ${data.code}`);
  return {
    geometry: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distance: r.distance,
    duration: r.duration,
    provider: "osrm",
  };
}

/** Which OSRM servers to try, in order, for a vehicle profile. */
function osrmEndpoints(profile) {
  const custom = env.osrmUrl.replace(/\/$/, "");
  if (custom !== OSRM_DEMO) return [[custom, OSRM_PROFILES[profile]]]; // self-hosted (or tests)
  return [
    [`${env.fossgisRoutingUrl}/routed-${FOSSGIS_PROFILES[profile]}`, "driving"],
    [OSRM_DEMO, "driving"], // car-only demo: still far better than a straight line
  ];
}

const FALLBACK_SPEED_KMH = { driving: 50, cycling: 15, walking: 4.5 };

export function straightLineRoute(coords, profile = "driving") {
  const geometry = densify(coords, 400);
  const distance = polylineLength(geometry);
  return {
    geometry,
    distance,
    duration: distance / ((FALLBACK_SPEED_KMH[profile] * 1000) / 3600),
    provider: "straight-line",
  };
}

export async function getRoute(coords, profile = "driving") {
  const attempts = [];
  if (env.orsApiKey) attempts.push(() => viaOrs(coords, profile));
  for (const [base, name] of osrmEndpoints(profile)) attempts.push(() => viaOsrm(coords, base, name));

  let reason = null;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (err) {
      if (err instanceof RouteError) reason = err.message; // the map data says no; another server won't differ much
      if (!env.isTest) console.warn(`[routing] provider failed — ${describeError(err)}`);
    }
  }
  return {
    ...straightLineRoute(coords, profile),
    noRoute: !!reason, // the map data itself has no road route (vs. servers being unreachable)
    reason: reason || "Couldn't reach the road routing servers.",
  };
}

// ─────────────── Geocoding (Nominatim) with a small LRU cache ───────────────
const cache = new Map();
const CACHE_MAX = 500;
function cached(key, fn) {
  if (cache.has(key)) {
    const v = cache.get(key);
    cache.delete(key);
    cache.set(key, v);
    return v;
  }
  const p = fn().catch((e) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, p);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return p;
}

const headers = () => ({ "User-Agent": env.geoUserAgent, "Accept-Language": "en" });

/** Human-readable reason for a failed request (fetch hides the real cause in err.cause). */
export function describeError(err) {
  if (err?.name === "AbortError") return "timed out";
  const c = err?.cause;
  return [err?.message, c?.code, c?.message].filter(Boolean).join(" · ");
}

// ── Providers: Nominatim first, Photon (komoot, also OSM data, no key) as fallback ──
const nominatim = {
  name: "nominatim",
  async search(q, near) {
    // Prefer results around `near` (the start point / map view) without excluding the rest.
    const box = near ? `&viewbox=${near.lng - 1.5},${near.lat + 1.5},${near.lng + 1.5},${near.lat - 1.5}&bounded=0` : "";
    const url = `${env.nominatimUrl}/search?format=jsonv2&limit=6${box}&q=${encodeURIComponent(q)}`;
    const data = await fetchJson(url, { headers: headers() });
    return data.map((r) => ({
      name: r.display_name,
      shortName: r.name || r.display_name.split(",")[0],
      lat: Number(r.lat),
      lng: Number(r.lon),
      type: r.type,
    }));
  },
  async reverse(lat, lng) {
    const url = `${env.nominatimUrl}/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
    const r = await fetchJson(url, { headers: headers() });
    if (!r.display_name) throw new Error("no result");
    return { name: r.display_name, shortName: r.name || r.display_name.split(",")[0], lat, lng };
  },
};

export function photonToPlace(f) {
  const p = f.properties || {};
  const [lng, lat] = f.geometry.coordinates;
  const parts = [p.name, p.street, p.district, p.city || p.county, p.state, p.country].filter(Boolean);
  const name = [...new Set(parts)].join(", ");
  return { name: name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`, shortName: p.name || parts[0] || "Dropped pin", lat, lng, type: p.osm_value };
}

const photon = {
  name: "photon",
  async search(q, near) {
    const bias = near ? `&lat=${near.lat}&lon=${near.lng}` : "";
    const url = `${env.photonUrl}/api/?limit=6&lang=en${bias}&q=${encodeURIComponent(q)}`;
    const data = await fetchJson(url, { headers: headers() });
    return (data.features || []).map(photonToPlace);
  },
  async reverse(lat, lng) {
    const url = `${env.photonUrl}/reverse?lang=en&lat=${lat}&lon=${lng}`;
    const data = await fetchJson(url, { headers: headers() });
    const f = data.features?.[0];
    if (!f) throw new Error("no result");
    return { ...photonToPlace(f), lat, lng };
  },
};

const GEOCODERS = [nominatim, photon];

async function firstWorking(op, ...args) {
  const failures = [];
  for (const g of GEOCODERS) {
    try {
      return await g[op](...args);
    } catch (err) {
      failures.push(`${g.name}: ${describeError(err)}`);
      if (!env.isTest) console.warn(`[geocode] ${g.name} ${op} failed — ${describeError(err)}`);
    }
  }
  const e = new Error(`All geocoders failed (${failures.join(" | ")})`);
  e.failures = failures;
  throw e;
}

export function geocode(q, near = null) {
  const n = near ? `@${near.lat.toFixed(1)},${near.lng.toFixed(1)}` : "";
  return cached(`s:${q.toLowerCase()}${n}`, () => firstWorking("search", q, near));
}

export function reverseGeocode(lat, lng) {
  return cached(`r:${lat.toFixed(4)},${lng.toFixed(4)}`, () => firstWorking("reverse", lat, lng));
}
