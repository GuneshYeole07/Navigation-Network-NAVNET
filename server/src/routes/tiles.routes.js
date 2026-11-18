import { Router } from "express";
import { tile, tileJson } from "../services/tiles.service.js";

const r = Router();

r.get("/tile.json", async (req, res, next) => {
  try {
    const proto = req.headers["x-forwarded-proto"]?.split(",")[0] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const tj = await tileJson(`${proto}://${host}${req.baseUrl}`);
    if (!tj) return res.status(404).json({ success: false, message: "No map tiles on this server (PMTILES_PATH not set)" });
    res.set("Cache-Control", "public, max-age=300").json(tj);
  } catch (e) {
    next(e);
  }
});

r.get("/:z/:x/:y.mvt", async (req, res, next) => {
  try {
    const [z, x, y] = [req.params.z, req.params.x, req.params.y].map(Number);
    if (![z, x, y].every(Number.isInteger) || z < 0 || z > 22) return res.status(400).end();
    const data = await tile(z, x, y);
    res.set("Cache-Control", "public, max-age=86400").set("Access-Control-Allow-Origin", "*");
    if (!data) return res.status(204).end(); // empty sea / outside the extract
    res.type("application/vnd.mapbox-vector-tile").send(data);
  } catch (e) {
    next(e);
  }
});

export default r;
