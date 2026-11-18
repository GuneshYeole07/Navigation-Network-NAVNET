/**
 * Which map NavNet draws, and how it keeps working offline.
 *
 * Basemaps, best first (all free, all OpenStreetMap data, no API keys):
 *   1. Self-hosted Protomaps tiles served by our own API (/tiles), if the server has a
 *      PMTiles file configured (PMTILES_PATH). Fully ours: no third party can switch it off.
 *   2. OpenFreeMap vector tiles (light "liberty" / "dark" styles). Sharp at every zoom.
 *   3. Plain OpenStreetMap raster tiles: a last-resort fallback (online only; the OSM tile
 *      policy forbids saving them for offline use).
 * Satellite (Esri World Imagery) is an online-only extra layer.
 *
 * Every vector tile, font and icon sheet is loaded through the "nncache://" protocol below,
 * which reads from / writes to Cache Storage. That is what makes the "Download offline map"
 * button work, without depending on service-worker support inside MapLibre's web workers.
 */
import * as maplibregl from "maplibre-gl";
import { layers, namedFlavor } from "@protomaps/basemaps";
import { API_BASE } from "../../services/api";

export const MAP_CACHE = "navnet-tiles";
const PROTO = "nncache";

const env = import.meta.env;
const OFM = (env.VITE_OPENFREEMAP_URL || "https://tiles.openfreemap.org").replace(/\/$/, "");
const STYLE_OVERRIDE = env.VITE_MAP_STYLE_URL || "";
const STYLE_OVERRIDE_DARK = env.VITE_MAP_STYLE_URL_DARK || STYLE_OVERRIDE;
const PROTOMAPS_ASSETS = (env.VITE_PROTOMAPS_ASSETS_URL || "https://protomaps.github.io/basemaps-assets").replace(/\/$/, "");
export const RASTER_URL = env.VITE_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Absolute URL without percent-encoding the {z}/{x}/{y} placeholders (URL parsing would). */
const abs = (u) => (/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `${location.origin}${u.startsWith("/") ? "" : "/"}${u}`);
const cached = (url) => `${PROTO}://${url}`;
const uncached = (url) => (url.startsWith(`${PROTO}://`) ? url.slice(PROTO.length + 3) : url);
const isTile = (url) => /\/\d+\/\d+\/\d+(\.\w+)?(\?.*)?$/.test(url);

// ───────────────────────── Cache-backed loading ─────────────────────────

let tileIndex = null; // "z/x/y" → cached URL, built lazily when a tile can't be fetched
async function findCachedTile(cache, url) {
  const m = url.match(/\/(\d+)\/(\d+)\/(\d+)\.\w+/);
  if (!m) return null;
  if (!tileIndex) {
    tileIndex = new Map();
    for (const req of await cache.keys()) {
      const k = req.url.match(/\/(\d+)\/(\d+)\/(\d+)\.\w+/);
      if (k) tileIndex.set(`${k[1]}/${k[2]}/${k[3]}`, req.url);
    }
  }
  const hit = tileIndex.get(`${m[1]}/${m[2]}/${m[3]}`);
  return hit ? cache.match(hit) : null;
}

/** Cache-first fetch. Tiles that can't be loaded at all come back empty so the map still draws. */
export async function cacheFirst(url, { signal, store = true } = {}) {
  const cache = await caches.open(MAP_CACHE);
  const hit = await cache.match(url);
  if (hit) return hit;
  try {
    const res = await fetch(url, { signal, mode: "cors" });
    if (res.ok && store) {
      await cache.put(url, res.clone());
      if (tileIndex && isTile(url)) tileIndex.set(url.match(/\/(\d+\/\d+\/\d+)\.\w+/)?.[1], url);
    }
    return res;
  } catch (e) {
    if (e.name === "AbortError") throw e;
    // Offline: the tile may be saved under an older tileset version (OpenFreeMap updates weekly).
    if (isTile(url)) return (await findCachedTile(cache, url)) || new Response(new ArrayBuffer(0));
    throw e;
  }
}

/** Network-first for small JSON (styles, TileJSON) so updates arrive, cached copy when offline. */
async function jsonNetworkFirst(url, { timeout = 6000 } = {}) {
  const cache = typeof caches !== "undefined" ? await caches.open(MAP_CACHE) : null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    if (cache) await cache.put(url, res.clone());
    return await res.json();
  } catch (e) {
    const hit = cache && (await cache.match(url));
    if (hit) return hit.json();
    throw e;
  } finally {
    clearTimeout(t);
  }
}

let registered = false;
export function registerCacheProtocol() {
  if (registered || typeof caches === "undefined") return;
  registered = true;
  maplibregl.addProtocol(PROTO, async (params, abort) => {
    const res = await cacheFirst(uncached(params.url), { signal: abort.signal });
    if (!res.ok) {
      if (isTile(params.url)) return { data: new ArrayBuffer(0) }; // missing tile = empty area, not an error
      throw new Error(`HTTP ${res.status}`);
    }
    if (res.status === 204) return { data: params.type === "json" ? {} : new ArrayBuffer(0) };
    if (params.type === "json") return { data: await res.json() };
    if (params.type === "string") return { data: await res.text() };
    return { data: await res.arrayBuffer() };
  });
}

// ───────────────────────── Styles ─────────────────────────

function emptyStyle(dark) {
  return { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": dark ? "#1a2024" : "#dfe5e1" } }] };
}

/** OSM raster fallback. Dark mode inverts it on the GPU (no CSS filter on the whole map). */
export function rasterStyle(dark) {
  return {
    version: 8,
    sources: { osm: { type: "raster", tiles: [RASTER_URL], tileSize: 256, maxzoom: 19, attribution: OSM_ATTRIBUTION } },
    layers: [
      {
        id: "osm",
        type: "raster",
        source: "osm",
        paint: dark ? { "raster-brightness-min": 0.95, "raster-brightness-max": 0.08, "raster-hue-rotate": 180, "raster-saturation": -0.45, "raster-contrast": 0.1 } : {},
      },
    ],
  };
}

const ESRI = (path) => `https://server.arcgisonline.com/ArcGIS/rest/services/${path}/MapServer/tile/{z}/{y}/{x}`;
const IMAGERY = {
  type: "raster",
  tiles: [ESRI("World_Imagery")],
  tileSize: 256,
  // Beyond 18 the photos are often missing outside cities; stretching z18 looks better than blank.
  maxzoom: 18,
  attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
};

/** Fallback when the vector map isn't reachable: photos + Esri's own (raster) labels. */
export function satelliteStyle() {
  return {
    version: 8,
    sources: {
      sat: IMAGERY,
      // Esri's label tiles stop being drawn past ~z16 in many areas; capping avoids huge stretched text.
      labels: { type: "raster", tiles: [ESRI("Reference/World_Boundaries_and_Places")], tileSize: 256, maxzoom: 16 },
    },
    layers: [
      { id: "sat", type: "raster", source: "sat", paint: { "raster-fade-duration": 150 } },
      { id: "labels", type: "raster", source: "labels" },
    ],
  };
}

/**
 * Hybrid: satellite photos underneath, crisp vector roads and place names on top
 * (from the same vector map), so text stays sharp at every zoom instead of scaling up.
 */
function hybridStyle(vector) {
  const s = structuredClone(vector);
  const isRoad = (l) => l.type === "line" && /road|highway|street|motorway|trunk|primary|secondary|tertiary|bridge|tunnel|transportation/i.test(`${l.id} ${l["source-layer"] || ""}`);
  const layers = (s.layers || []).filter((l) => l.type === "symbol" || isRoad(l));
  for (const l of layers) {
    if (l.type === "symbol") {
      l.paint = { ...(l.paint || {}), "text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,0.85)", "text-halo-width": 1.4 };
    } else {
      l.paint = { ...(l.paint || {}), "line-opacity": 0.55 };
    }
  }
  s.sources = { ...s.sources, sat: IMAGERY };
  s.layers = [{ id: "sat", type: "raster", source: "sat", paint: { "raster-fade-duration": 150 } }, ...layers];
  return s;
}

/** Inline TileJSON sources and route tiles, fonts and sprites through the cache protocol. */
async function prepareVectorStyle(style) {
  const s = structuredClone(style);
  const tileSources = [];
  for (const [id, src] of Object.entries(s.sources || {})) {
    if (src.type !== "vector" && src.type !== "raster") continue;
    if (src.url && !src.tiles) {
      const tj = await jsonNetworkFirst(abs(src.url));
      Object.assign(src, { tiles: tj.tiles, minzoom: tj.minzoom ?? 0, maxzoom: tj.maxzoom ?? 14, attribution: src.attribution || tj.attribution });
      delete src.url;
    }
    if (src.type === "vector" && src.tiles) {
      tileSources.push({ id, templates: src.tiles.map(abs), minzoom: src.minzoom ?? 0, maxzoom: src.maxzoom ?? 14 });
      src.tiles = src.tiles.map((t) => cached(abs(t)));
    }
  }
  const glyphs = s.glyphs ? abs(s.glyphs) : null;
  if (glyphs) s.glyphs = cached(glyphs);
  const spriteList = !s.sprite ? [] : typeof s.sprite === "string" ? [{ id: "default", url: s.sprite }] : s.sprite;
  const sprites = spriteList.map((sp) => abs(sp.url));
  if (typeof s.sprite === "string") s.sprite = cached(sprites[0]);
  else if (Array.isArray(s.sprite)) s.sprite = s.sprite.map((sp, i) => ({ ...sp, url: cached(sprites[i]) }));
  const fonts = new Set();
  const EXPR = /^(literal|get|coalesce|step|interpolate|match|case|zoom|concat|to-string)$/;
  const collect = (v) => {
    if (!Array.isArray(v) || !v.length) return;
    if (v.every((x) => typeof x === "string") && !EXPR.test(v[0])) fonts.add(v.join(","));
    else v.forEach(collect);
  };
  (s.layers || []).forEach((l) => l.layout?.["text-font"] && collect(l.layout["text-font"]));
  return { style: s, offline: { tileSources, glyphs, fonts: [...fonts], sprites } };
}

function protomapsStyle(tilejson, dark) {
  const flavor = dark ? "dark" : "light";
  return {
    version: 8,
    glyphs: `${PROTOMAPS_ASSETS}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${PROTOMAPS_ASSETS}/sprites/v4/${flavor}`,
    sources: {
      protomaps: {
        type: "vector",
        tiles: tilejson.tiles,
        minzoom: tilejson.minzoom ?? 0,
        maxzoom: tilejson.maxzoom ?? 15,
        attribution: '<a href="https://protomaps.com">Protomaps</a> ' + OSM_ATTRIBUTION,
      },
    },
    layers: layers("protomaps", namedFlavor(flavor), { lang: "en" }),
  };
}

/**
 * Resolve the best basemap that works right now (online, or from the offline cache).
 * @returns {{ style, name, offline: { tileSources, glyphs, fonts, sprites } | null }}
 */
export async function resolveBasemap({ dark = false, satellite = false } = {}) {
  if (satellite) {
    const vector = await resolveBasemap({ dark: false });
    return vector.offline ? { style: hybridStyle(vector.style), name: "satellite", offline: null } : { style: satelliteStyle(), name: "satellite", offline: null };
  }
  const attempts = [];
  if (STYLE_OVERRIDE) attempts.push(["custom", () => jsonNetworkFirst(abs(dark ? STYLE_OVERRIDE_DARK : STYLE_OVERRIDE))]);
  attempts.push(["protomaps", async () => protomapsStyle(await jsonNetworkFirst(`${API_BASE}/api/tiles/tile.json`, { timeout: 3000 }), dark)]);
  attempts.push(["openfreemap", () => jsonNetworkFirst(`${OFM}/styles/${dark ? "dark" : "liberty"}`)]);
  for (const [name, load] of attempts) {
    try {
      const prepared = await prepareVectorStyle(await load());
      return { ...prepared, name };
    } catch {
      /* try the next one */
    }
  }
  return { style: rasterStyle(dark), name: "osm-raster", offline: null };
}

export const placeholderStyle = emptyStyle;
export { uncached };
