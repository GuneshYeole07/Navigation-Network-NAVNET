import http from "node:http";
import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { initSocket } from "./socket/index.js";
import { disconnectDb } from "./database/prisma.js";
import { hasActiveTrips, stopSweeper } from "./services/live.service.js";

const app = createApp();
const server = http.createServer(app);
const io = initSocket(server);

server.listen(env.port, () => {
  console.log(`🚦 NavNet API listening on http://localhost:${env.port} (${env.nodeEnv})`);
});

// Free hosting (Render) puts a service to sleep after 15 min without requests. The Python
// safety monitor only receives positions through Postgres, not HTTP, so while a trip is on
// the road, nudge it every 5 minutes to keep it awake.
if (env.safetyMonitor && env.analyticsUrl) {
  setInterval(() => {
    if (hasActiveTrips()) fetch(`${env.analyticsUrl}/health`, { signal: AbortSignal.timeout(60000) }).catch(() => {});
  }, 5 * 60 * 1000).unref();
}

async function shutdown(signal) {
  console.log(`\n${signal} received — shutting down gracefully`);
  stopSweeper();
  io.close();
  server.close(async () => {
    await disconnectDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (err) => console.error("[unhandledRejection]", err));
