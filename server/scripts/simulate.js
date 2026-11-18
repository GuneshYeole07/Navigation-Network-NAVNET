#!/usr/bin/env node
/**
 * Convoy simulator — drives seeded riders along a trip's real route over Socket.IO,
 * so the Admin Monitoring Panel can be demoed without anyone leaving their desk.
 *
 *   npm run simulate                                  # PUNE-RIDE, 5 riders, 20× speed
 *   npm run simulate -- --group SINHAGAD --password cycle123 --riders 3 --timescale 10
 *
 * Built-in scenarios (so every Smart Monitoring alert fires):
 *   rider 2 → battery drains below 20%
 *   rider 3 → detours off the planned route mid-trip
 *   rider 4 → overspeeds on the highway stretch
 *   rider 5 → stops for a long break (stationary) and later triggers an SOS
 */
import { io } from "socket.io-client";
import { cumulativeDistances, pointAlong, bearing } from "../src/utils/geo.js";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]?.startsWith("--") ? true : arr[i + 1] ?? true]);
    return acc;
  }, []),
);

const API = args.api || process.env.API_URL || "http://localhost:5000";
const GROUP = (args.group || "PUNE-RIDE").toUpperCase();
const PASSWORD = args.password || "ride123";
const RIDERS = Math.min(Number(args.riders || 5), 5);
const TIMESCALE = Number(args.timescale || 20); // simulated seconds per real second
const TICK_MS = 2000;
const NO_START = !!args["no-start"];

const RIDER_EMAILS = ["aarav", "diya", "kabir", "meera", "rohan"].map((n) => `${n}@navnet.dev`);

async function http(path, { token, ...opts } = {}) {
  const res = await fetch(`${API}/api${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${json.error?.message || res.status}`);
  return json.data;
}

const login = (email, password, role) =>
  http("/auth/login", { method: "POST", body: JSON.stringify({ email, password, role }) });

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = io(API, { auth: { token }, transports: ["websocket"] });
    s.once("connect", () => resolve(s));
    s.once("connect_error", reject);
  });
}

const emit = (s, ev, data) => new Promise((r) => s.emit(ev, data, r));

async function main() {
  console.log(`🛰️  NavNet simulator → ${API}  group=${GROUP} riders=${RIDERS} timescale=${TIMESCALE}×`);

  // Admin: optionally start the trip so route alerts are live.
  const admin = await login("admin@navnet.dev", "Admin@123", "ADMIN");

  const riders = [];
  for (let i = 0; i < RIDERS; i++) {
    const { token, user } = await login(RIDER_EMAILS[i], "Rider@123", "USER");
    const { tripId } = await http("/trips/join", { method: "POST", token, body: JSON.stringify({ groupCode: GROUP, password: PASSWORD }) });
    const socket = await connect(token);
    const ack = await emit(socket, "trip:join", { tripId });
    if (!ack.ok) throw new Error(ack.error);
    riders.push({ i, user, socket, tripId, snapshot: ack.data });
    console.log(`   ✓ ${user.name} joined`);
  }

  const { tripId, snapshot } = riders[0];
  if (!NO_START && snapshot.trip.status === "PLANNED") {
    await http(`/trips/${tripId}/status`, { method: "PATCH", token: admin.token, body: JSON.stringify({ action: "start" }) });
    console.log("   ▶ trip started by admin");
  } else if (snapshot.trip.status === "PAUSED") {
    console.log("   ⏸ trip is paused — alerts are suppressed until the admin resumes");
  }

  const line = snapshot.trip.routeGeometry;
  const cum = cumulativeDistances(line);
  const total = cum.at(-1);
  console.log(`   route ${(total / 1000).toFixed(1)} km, ${line.length} points`);

  // Per-rider state: staggered start, different cruise speeds.
  const state = riders.map((r) => ({
    ...r,
    along: Math.max(0, 600 - r.i * 150), // leader ahead, others spaced ~150 m
    cruise: [48, 44, 52, 46, 42][r.i],
    battery: [88, 26, 71, 64, 55][r.i],
    sosSent: false,
    done: false,
  }));

  const timer = setInterval(async () => {
    const dtSim = (TICK_MS / 1000) * TIMESCALE;
    for (const r of state) {
      if (r.done) continue;
      const frac = r.along / total;
      let speed = r.cruise + (Math.random() * 6 - 3);

      // Scenarios
      if (r.i === 3 && frac > 0.25 && frac < 0.4) speed = 92; // overspeed
      const breakWindow = r.i === 4 && frac > 0.45 && !r.sosSent;
      if (breakWindow && (r.breakStart ??= Date.now()) && Date.now() - r.breakStart < 45000) speed = 0;
      if (r.i === 1) r.battery = Math.max(5, r.battery - 0.4);

      r.along = Math.min(total, r.along + (speed / 3.6) * dtSim);
      let [lat, lng] = pointAlong(line, r.along, cum);
      const ahead = pointAlong(line, Math.min(total, r.along + 30), cum);

      if (r.i === 2 && frac > 0.55 && frac < 0.62) {
        lat += 0.006; // ~650 m detour north of the route
        lng += 0.002;
      }

      const ack = await emit(r.socket, "location:update", {
        tripId: r.tripId,
        lat,
        lng,
        speed,
        heading: bearing([lat, lng], ahead),
        accuracy: 8,
        battery: Math.round(r.battery),
      });
      if (!ack.ok) console.warn(`   ! ${r.user.name}: ${ack.error}`);

      if (r.i === 4 && breakWindow && !r.sosSent && Date.now() - r.breakStart > 30000) {
        r.sosSent = true;
        await emit(r.socket, "sos:trigger", {
          tripId: r.tripId,
          lat,
          lng,
          speed: 0,
          battery: Math.round(r.battery),
          emergencyType: "BREAKDOWN",
          note: "Chain snapped near Kamshet — need a tow (simulated)",
        });
        console.log(`   🆘 ${r.user.name} triggered SOS`);
      }

      if (r.along >= total) {
        r.done = true;
        console.log(`   🏁 ${r.user.name} arrived`);
      }
    }
    const status = state.map((r) => `${r.user.name.split(" ")[0]} ${((r.along / total) * 100).toFixed(0)}%`).join(" · ");
    process.stdout.write(`\r   ${status}      `);

    if (state.every((r) => r.done)) {
      clearInterval(timer);
      console.log("\n✅ All riders arrived. End the trip from the Monitoring Panel to generate analytics.");
      state.forEach((r) => r.socket.close());
    }
  }, TICK_MS);

  process.on("SIGINT", () => {
    clearInterval(timer);
    state.forEach((r) => r.socket.close());
    console.log("\nSimulator stopped.");
    process.exit(0);
  });
}

main().catch((e) => {
  console.error("Simulator failed:", e.message);
  process.exit(1);
});
