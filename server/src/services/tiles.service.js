/**
 * Self-hosted map tiles (Protomaps). Point PMTILES_PATH at a .pmtiles file, either on this
 * server's disk or at an https URL (e.g. Cloudflare R2 / S3), and the API serves ordinary
 * vector tiles at /api/tiles/{z}/{x}/{y}.mvt plus /api/tiles/tile.json. The app detects this
 * and uses your own map instead of OpenFreeMap. See docs/DEPLOYMENT.md → "Your own map tiles".
 */
import fs from "node:fs/promises";
import { FetchSource, PMTiles } from "pmtiles";
import { env } from "../config/env.js";

/** Reads byte ranges from a local file (PMTiles is designed for exactly this). */
class FileSource {
  constructor(file) {
    this.file = file;
    this.handle = null;
  }
  getKey() {
    return this.file;
  }
  async getBytes(offset, length) {
    this.handle ??= await fs.open(this.file, "r");
    const buf = Buffer.alloc(length);
    const { bytesRead } = await this.handle.read(buf, 0, length, offset);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead) };
  }
}

let archive = null;
let checked = false;

export function tilesArchive() {
  if (checked) return archive;
  checked = true;
  const src = env.pmtilesPath;
  if (!src) return null;
  archive = new PMTiles(/^https?:\/\//.test(src) ? new FetchSource(src) : new FileSource(src));
  return archive;
}

/** Test hook: switch file without restarting. */
export function resetTiles() {
  archive = null;
  checked = false;
}

export async function tileJson(baseUrl) {
  const pm = tilesArchive();
  if (!pm) return null;
  const h = await pm.getHeader();
  const meta = (await pm.getMetadata().catch(() => ({}))) || {};
  return {
    tilejson: "3.0.0",
    name: meta.name || "NavNet map",
    tiles: [`${baseUrl}/{z}/{x}/{y}.mvt`],
    minzoom: h.minZoom,
    maxzoom: h.maxZoom,
    bounds: [h.minLon, h.minLat, h.maxLon, h.maxLat],
    center: [h.centerLon, h.centerLat, h.centerZoom],
    vector_layers: meta.vector_layers || [],
    attribution: meta.attribution || '<a href="https://protomaps.com">Protomaps</a> © OpenStreetMap',
  };
}

export async function tile(z, x, y) {
  const pm = tilesArchive();
  if (!pm) return null;
  const r = await pm.getZxy(z, x, y);
  return r?.data ? Buffer.from(r.data) : null;
}
