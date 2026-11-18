import { Router } from "express";
import auth from "./auth.routes.js";
import trips from "./trip.routes.js";
import communities from "./community.routes.js";
import geo from "./geo.routes.js";
import uploads from "./upload.routes.js";
import { prisma } from "../database/prisma.js";

const api = Router();

api.get("/health", async (_req, res) => {
  let db = "up";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = "down";
  }
  res.status(db === "up" ? 200 : 503).json({ success: db === "up", data: { status: "ok", db, uptime: process.uptime() } });
});

api.use("/auth", auth);
api.use("/trips", trips);
api.use("/communities", communities);
api.use("/geo", geo);
api.use("/uploads", uploads);

export default api;
