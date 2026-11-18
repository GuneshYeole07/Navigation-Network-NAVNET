import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";

const handler = (_req, res) =>
  res.status(429).json({
    success: false,
    error: { message: "Too many requests. Please slow down and try again shortly." },
  });

// Off in tests, and for local load tests (RATE_LIMIT_DISABLED=1, ignored in production).
const skip = () => env.isTest || (env.rateLimitDisabled && process.env.NODE_ENV !== "production");

/** General API ceiling per IP. */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler,
  skip,
});

/** Brute-force protection for login / register / trip join. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler,
  skip,
});

/** Protect the free public OSM services we proxy (Nominatim policy: ≤1 req/s). */
export const geoLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler,
  skip,
});
