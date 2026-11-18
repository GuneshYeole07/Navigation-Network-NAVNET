import { OFFLINE_ZOOMS, corridorTiles } from "./geo";
import { MAP_CACHE, resolveBasemap } from "../components/map/mapStyles";

const metaKey = (tripId) => `navnet-offline-${tripId}`;
// Unicode ranges worth saving: Latin, Latin-extended, Devanagari (Marathi/Hindi names), punctuation.
const GLYPH_RANGES = ["0-255", "256-511", "2304-2559", "8192-8447"];

export const offlineSupported = () => typeof window !== "undefined" && "caches" in window;

export function offlineInfo(tripId) {
  try {
    return JSON.parse(localStorage.getItem(metaKey(tripId)));
  } catch {
    return null;
  }
}

/** Vector tiles stop at zoom 14 (the phone draws them sharper when you zoom further). */
const zoomsFor = (maxzoom) => [{ z: 8, buffer: 20000 }, { z: 9, buffer: 12000 }, ...OFFLINE_ZOOMS].filter((z) => z.z <= maxzoom);

export const tileCountFor = (line, maxzoom = 14) => corridorTiles(line, zoomsFor(maxzoom)).length;

/** Everything one trip needs offline, for both the light and the dark map. */
async function offlineManifest(line) {
  const urls = new Set();
  let tiles = 0;
  for (const dark of [false, true]) {
    const b = await resolveBasemap({ dark });
    if (!b.offline) throw new Error("The vector map isn't reachable right now, so it can't be saved for offline use.");
    for (const src of b.offline.tileSources) {
      const keys = corridorTiles(line, zoomsFor(src.maxzoom));
      for (const t of src.templates.slice(0, 1)) {
        for (const k of keys) {
          const [z, x, y] = k.split("/");
          if (+z >= src.minzoom) urls.add(t.replace("{z}", z).replace("{x}", x).replace("{y}", y));
        }
      }
    }
    if (b.offline.glyphs) for (const f of b.offline.fonts) for (const r of GLYPH_RANGES) urls.add(b.offline.glyphs.replace("{fontstack}", f).replace("{range}", r));
    for (const sp of b.offline.sprites) for (const sfx of [".json", ".png", "@2x.json", "@2x.png"]) urls.add(sp + sfx);
  }
  for (const u of urls) if (/\/\d+\/\d+\/\d+\.\w+$/.test(u)) tiles += 1;
  return { urls: [...urls], tiles };
}

/**
 * Save the map along the route corridor (vector tiles, fonts, icons; light + dark) into
 * Cache Storage. 6 requests at a time; already-saved files are skipped, so re-running only
 * fetches what's missing. Returns { tiles, total, failed, bytes, at }.
 */
export async function downloadRouteTiles(tripId, line, { onProgress, signal } = {}) {
  const { urls, tiles } = await offlineManifest(line);
  const cache = await caches.open(MAP_CACHE);
  let done = 0;
  let failed = 0;
  let bytes = 0;
  const queue = [...urls];

  async function worker() {
    while (queue.length) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const url = queue.shift();
      try {
        const hit = await cache.match(url);
        if (hit) bytes += Number(hit.headers.get("content-length")) || 20000;
        else {
          const res = await fetch(url, { signal, mode: "cors" });
          if (!res.ok) throw new Error(res.status);
          bytes += (await res.clone().blob()).size;
          await cache.put(url, res);
        }
      } catch (e) {
        if (e.name === "AbortError") throw e;
        failed += 1;
      }
      done += 1;
      onProgress?.({ done, total: urls.length, failed });
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));

  const info = { tiles: urls.length - failed, total: urls.length, mapTiles: tiles, failed, bytes, at: Date.now() };
  localStorage.setItem(metaKey(tripId), JSON.stringify(info));
  return info;
}

/** Wipe cached trip data (used on logout so the next person on this phone can't see it). */
export async function clearPrivateCaches() {
  try {
    await caches.delete("navnet-api-v1");
    Object.keys(localStorage)
      .filter((k) => k.startsWith("navnet-trip-") || k.startsWith("navnet-outbox-"))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* storage unavailable */
  }
}
