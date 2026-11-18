import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import path from "node:path";
import fs from "node:fs";
import { env } from "./config/env.js";
import { ApiError } from "./utils/ApiError.js";
import { isAllowedOrigin, isSameOrigin } from "./utils/origin.js";
import tiles from "./routes/tiles.routes.js";
import api from "./routes/index.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1); // correct client IPs behind Render/Nginx for rate limiting

  app.use(
    helmet({
      // Uploaded trip images are fetched cross-origin by the Vite client.
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(
    cors((req, cb) => {
      // Allow same-origin / curl (no Origin header) and configured client origins.
      const origin = req.headers.origin;
      const host = req.headers["x-forwarded-host"] || req.headers.host;
      if (isAllowedOrigin(origin) || isSameOrigin(origin, host)) return cb(null, { origin: true, credentials: true });
      cb(ApiError.forbidden(`Origin ${origin} is not allowed. Add it to CLIENT_ORIGIN.`));
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: "2mb" }));
  if (!env.isTest) app.use(morgan(env.isProd ? "combined" : "dev"));

  app.use("/uploads", express.static(path.resolve(env.uploadDir), { maxAge: "7d", fallthrough: false }));
  // Map tiles: hundreds of small requests per screen, so they skip the API rate limit.
  app.use("/api/tiles", tiles);
  app.use("/api", apiLimiter, api);

  // Optional single-service deploy: serve the built React app if present.
  const clientDist = path.resolve("../client/dist");
  if (env.isProd && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { maxAge: "1h" }));
    app.get(/^\/(?!api|uploads|socket\.io).*/, (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
