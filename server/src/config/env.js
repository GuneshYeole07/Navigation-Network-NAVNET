import dotenv from "dotenv";

dotenv.config({ quiet: true });

const required = ["DATABASE_URL", "JWT_SECRET"];
for (const key of required) {
  if (!process.env[key] && process.env.NODE_ENV !== "test") {
    // Fail fast: a server without a DB or signing secret is useless and unsafe.
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const num = (v, d) => (v === undefined || v === "" ? d : Number(v));

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  isProd: process.env.NODE_ENV === "production",
  isTest: process.env.NODE_ENV === "test",
  port: num(process.env.PORT, 5000),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || "test-secret-only-for-tests",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  clientOrigins: (process.env.CLIENT_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  adminSignupCode: process.env.ADMIN_SIGNUP_CODE || "",
  orsApiKey: process.env.ORS_API_KEY || "",
  osrmUrl: process.env.OSRM_URL || "https://router.project-osrm.org",
  // FOSSGIS OSRM: separate car / bike / foot servers (the OSRM demo above only routes cars).
  // Python analytics service (FastAPI): ride insights + machine-learned ETA. Empty = off.
  analyticsUrl: (process.env.ANALYTICS_URL || "").replace(/\/$/, ""),
  analyticsKey: process.env.ANALYTICS_KEY || "",
  // Stream every processed position to the Python safety monitor (Postgres NOTIFY navnet_ping).
  rateLimitDisabled: process.env.RATE_LIMIT_DISABLED === "1",
  safetyMonitor: ["1", "true", "yes"].includes(String(process.env.SAFETY_MONITOR || "").toLowerCase()),
  // Self-hosted Protomaps map file (local path or https URL). Empty = use OpenFreeMap.
  pmtilesPath: process.env.PMTILES_PATH || "",
  fossgisRoutingUrl: (process.env.FOSSGIS_ROUTING_URL || "https://routing.openstreetmap.de").replace(/\/$/, ""),
  nominatimUrl: process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org",
  photonUrl: process.env.PHOTON_URL || "https://photon.komoot.io",
  overpassUrl: process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter",
  // Nominatim rejects generic/placeholder agents; fall back to an identifying default.
  geoUserAgent:
    process.env.GEO_USER_AGENT && !/example\.com/i.test(process.env.GEO_USER_AGENT)
      ? process.env.GEO_USER_AGENT
      : "NavNet/1.0 (+https://github.com/GuneshYeole07/navnet)",
  uploadDir: process.env.UPLOAD_DIR || "uploads",
  monitoring: {
    offRouteMeters: num(process.env.OFF_ROUTE_METERS, 300),
    stationaryMinutes: num(process.env.STATIONARY_MINUTES, 5),
    offlineSeconds: num(process.env.OFFLINE_SECONDS, 60),
    lowBatteryPercent: num(process.env.LOW_BATTERY_PERCENT, 20),
    wrongDirectionMeters: num(process.env.WRONG_DIRECTION_METERS, 250),
    arrivalMeters: num(process.env.ARRIVAL_METERS, 150),
    checkpointMeters: num(process.env.CHECKPOINT_METERS, 200),
    alertCooldownSeconds: num(process.env.ALERT_COOLDOWN_SECONDS, 300),
    pingPersistSeconds: num(process.env.PING_PERSIST_SECONDS, 10),
    sweepIntervalSeconds: num(process.env.SWEEP_INTERVAL_SECONDS, 15),
  },
};
