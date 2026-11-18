import { afterAll, describe, expect, it } from "vitest";
import path from "node:path";
import request from "supertest";
import { env } from "../src/config/env.js";
import { resetTiles } from "../src/services/tiles.service.js";
import { createApp } from "../src/app.js";

const app = createApp();

describe("self-hosted map tiles", () => {
  afterAll(() => {
    env.pmtilesPath = "";
    resetTiles();
  });

  it("says no tiles when PMTILES_PATH isn't set (app falls back to OpenFreeMap)", async () => {
    env.pmtilesPath = "";
    resetTiles();
    await request(app).get("/api/tiles/tile.json").expect(404);
  });

  it("serves TileJSON and vector tiles from a .pmtiles file", async () => {
    env.pmtilesPath = path.resolve("tests/fixtures/tiny.pmtiles");
    resetTiles();
    const tj = await request(app).get("/api/tiles/tile.json").expect(200);
    expect(tj.body.tiles[0]).toMatch(/\/api\/tiles\/\{z\}\/\{x\}\/\{y\}\.mvt$/);
    expect(tj.body.maxzoom).toBe(2);
    expect(tj.body.vector_layers.map((l) => l.id)).toEqual(["roads", "water"]);

    const t = await request(app).get("/api/tiles/1/1/0.mvt").buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(t.headers["content-type"]).toMatch(/vector-tile/);
    expect(t.body.length).toBeGreaterThan(20); // decompressed MVT, not gzip bytes
    expect(t.body[0]).not.toBe(0x1f);

    await request(app).get("/api/tiles/9/1/1.mvt").expect(204); // outside the file
  });
});
