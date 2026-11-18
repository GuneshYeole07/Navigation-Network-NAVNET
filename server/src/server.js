import http from "node:http";
import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { initSocket } from "./socket/index.js";
import { disconnectDb } from "./database/prisma.js";
import { stopSweeper } from "./services/live.service.js";

const app = createApp();
const server = http.createServer(app);
const io = initSocket(server);

server.listen(env.port, () => {
  console.log(`🚦 NavNet API listening on http://localhost:${env.port} (${env.nodeEnv})`);
});

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
