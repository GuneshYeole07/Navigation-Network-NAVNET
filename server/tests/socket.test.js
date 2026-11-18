import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import request from "supertest";
import { io as ioc } from "socket.io-client";
import { createApp } from "../src/app.js";
import { initSocket } from "../src/socket/index.js";
import { prisma } from "../src/database/prisma.js";
import { clearAll, stopSweeper, sweep } from "../src/services/live.service.js";
import { resetCooldowns } from "../src/services/monitoring.service.js";
import { resetDb, tripInput } from "./helpers.js";

let server, io, url, admin, rider, tripId, adminSock, riderSock;
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const connect = (token) =>
  new Promise((res, rej) => {
    const s = ioc(url, { auth: { token }, transports: ["websocket"], forceNew: true });
    s.once("connect", () => res(s));
    s.once("connect_error", rej);
  });
const emit = (s, ev, d) => new Promise((r) => s.emit(ev, d, r));
const next = (s, ev) => new Promise((r) => s.once(ev, r));

beforeAll(async () => {
  await resetDb();
  clearAll();
  resetCooldowns();
  server = http.createServer(app);
  io = initSocket(server);
  stopSweeper(); // we drive sweep() manually
  await new Promise((r) => server.listen(0, r));
  url = `http://localhost:${server.address().port}`;

  admin = (await request(app).post("/api/auth/register").send({ name: "Admin", email: "sa@t.dev", password: "Passw0rd", role: "ADMIN", adminCode: "TEST-ADMIN-CODE" })).body.data;
  rider = (await request(app).post("/api/auth/register").send({ name: "Asha", email: "sr@t.dev", password: "Passw0rd" })).body.data;
  tripId = (await request(app).post("/api/trips").set(auth(admin.token)).send(tripInput({ groupCode: "SOCK-RIDE" }))).body.data.id;
  await request(app).post("/api/trips/join").set(auth(rider.token)).send({ groupCode: "SOCK-RIDE", password: "secret1" });
  await request(app).patch(`/api/trips/${tripId}/status`).set(auth(admin.token)).send({ action: "start" });
});

afterAll(async () => {
  adminSock?.close();
  riderSock?.close();
  io.close();
  await new Promise((r) => server.close(r));
  await prisma.$disconnect();
});

describe("real-time convoy", () => {
  it("rejects sockets without a valid token", async () => {
    await expect(connect("garbage")).rejects.toThrow(/unauthorized/);
  });

  it("joins rooms and returns a snapshot", async () => {
    adminSock = await connect(admin.token);
    riderSock = await connect(rider.token);
    const a = await emit(adminSock, "trip:join", { tripId });
    expect(a.ok).toBe(true);
    expect(a.data.role).toBe("ADMIN");
    const r = await emit(riderSock, "trip:join", { tripId });
    expect(r.data.role).toBe("MEMBER");
    expect(r.data.trip.groupCode).toBeUndefined();
  });

  it("broadcasts location with derived progress, ETA and status", async () => {
    const got = next(adminSock, "member:location");
    const ack = await emit(riderSock, "location:update", { tripId, lat: 18.5308, lng: 73.8775, speed: 40, battery: 90 });
    expect(ack.ok).toBe(true);
    const m = await got;
    expect(m.status).toBe("MOVING");
    expect(m.progressPercent).toBeGreaterThan(25);
    expect(m.progressPercent).toBeLessThan(35);
    expect(m.etaSeconds).toBeGreaterThan(0);
    expect(m.isLeader).toBe(true);
  });

  it("raises an overspeed alert to the admin and a notice to the rider", async () => {
    await new Promise((r) => setTimeout(r, 1100)); // per-socket 1 s throttle
    const alert = next(adminSock, "alert:new");
    const notice = next(riderSock, "notification");
    await emit(riderSock, "location:update", { tripId, lat: 18.5308, lng: 73.8875, speed: 95, battery: 90 });
    expect((await alert).type).toBe("OVERSPEED");
    expect((await notice).message).toMatch(/Slow down/);
  });

  it("marks the fuel checkpoint visited when passing through it", async () => {
    await new Promise((r) => setTimeout(r, 1100));
    const visited = next(adminSock, "checkpoint:visited");
    await emit(riderSock, "location:update", { tripId, lat: 18.5308, lng: 73.8985, speed: 40 });
    expect((await visited).checkpointName).toBe("Fuel");
  });

  it("delivers SOS with name, coordinates, speed, battery, type and timestamp", async () => {
    const sos = next(adminSock, "sos:alert");
    const ack = await emit(riderSock, "sos:trigger", {
      tripId, lat: 18.531, lng: 73.9, speed: 0, battery: 42, emergencyType: "MEDICAL",
    });
    expect(ack.ok).toBe(true);
    const a = await sos;
    expect(a.severity).toBe("CRITICAL");
    expect(a.data).toMatchObject({ userName: "Asha", emergencyType: "MEDICAL", battery: 42, lat: 18.531, lng: 73.9 });
    expect(a.data.timestamp).toBeTruthy();

    const acked = next(riderSock, "sos:acknowledged");
    await request(app).patch(`/api/trips/alerts/${a.id}/ack`).set(auth(admin.token));
    expect((await acked).by).toBe("Admin");
  });

  it("sweeper flags a member who goes silent as OFFLINE", async () => {
    const alert = next(adminSock, "alert:new");
    await sweep(Date.now() + 5 * 60 * 1000);
    expect((await alert).type).toBe("OFFLINE");
  });

  it("detects arrival", async () => {
    await new Promise((r) => setTimeout(r, 1100));
    const arrived = next(adminSock, "member:arrived");
    await emit(riderSock, "location:update", { tripId, lat: 18.5308, lng: 73.9474, speed: 10 });
    expect((await arrived).name).toBe("Asha");
  });

  it("group chat over sockets reaches everyone", async () => {
    const got = next(adminSock, "chat:message");
    const ack = await emit(riderSock, "chat:send", { tripId, body: "Made it!" });
    expect(ack.ok).toBe(true);
    expect((await got).body).toBe("Made it!");
  });
});

describe("wrong-direction window", () => {
  it("flags a rider who reverses along the route", async () => {
    // Fresh rider positioned mid-route, then moved 600 m back toward the start.
    const r2 = (await request(app).post("/api/auth/register").send({ name: "Bharat", email: "b2@t.dev", password: "Passw0rd" })).body.data;
    await request(app).post("/api/trips/join").set(auth(r2.token)).send({ groupCode: "SOCK-RIDE", password: "secret1" });
    const s = await connect(r2.token);
    await emit(s, "trip:join", { tripId });
    await emit(s, "location:update", { tripId, lat: 18.5308, lng: 73.9, speed: 30 });
    await new Promise((r) => setTimeout(r, 1100));
    await emit(s, "location:update", { tripId, lat: 18.5308, lng: 73.906, speed: 30 });
    await new Promise((r) => setTimeout(r, 1100));
    const alert = new Promise((res) => {
      const h = (a) => a.type === "WRONG_DIRECTION" && (adminSock.off("alert:new", h), res(a));
      adminSock.on("alert:new", h);
    });
    await emit(s, "location:update", { tripId, lat: 18.5308, lng: 73.9, speed: 30 });
    expect((await alert).userName).toBe("Bharat");
    s.close();
  });
});

describe("reconnect race", () => {
  it("chat and SOS sent before trip:join still go through (auto-join), outsiders still blocked", async () => {
    const s = await connect(rider.token); // fresh socket, never emitted trip:join
    const got = next(adminSock, "chat:message");
    const ack = await emit(s, "chat:send", { tripId, body: "queued while offline" });
    expect(ack.ok).toBe(true);
    expect((await got).body).toBe("queued while offline");
    const sos = next(adminSock, "sos:alert");
    expect((await emit(s, "sos:trigger", { tripId, lat: 18.53, lng: 73.9, emergencyType: "BREAKDOWN" })).ok).toBe(true);
    expect((await sos).data.emergencyType).toBe("BREAKDOWN");
    s.close();

    const outsider = (await request(app).post("/api/auth/register").send({ name: "Outsider", email: "out@t.dev", password: "Passw0rd" })).body.data;
    const o = await connect(outsider.token);
    const denied = await emit(o, "chat:send", { tripId, body: "let me in" });
    expect(denied.ok).toBe(false);
    o.close();
  });
});

describe("tracking accuracy", () => {
  let tripId; // its own trip: the shared one is full
  beforeAll(async () => {
    tripId = (await request(app).post("/api/trips").set(auth(admin.token)).send(tripInput({ groupCode: "ACC-RIDE", maxMembers: 10 }))).body.data.id;
    await request(app).patch(`/api/trips/${tripId}/status`).set(auth(admin.token)).send({ action: "start" });
    await emit(adminSock, "trip:join", { tripId });
  });
  const newRider = async (name, email) => {
    const r = (await request(app).post("/api/auth/register").send({ name, email, password: "Passw0rd" })).body.data;
    await request(app).post("/api/trips/join").set(auth(r.token)).send({ groupCode: "ACC-RIDE", password: "secret1" });
    const s = await connect(r.token);
    await emit(s, "trip:join", { tripId });
    return { r, s };
  };
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));

  it("ignores an impossible GPS jump but accepts the rider once fixes agree", async () => {
    const { s } = await newRider("Chirag", "c3@t.dev");
    const t0 = Date.now();
    expect((await emit(s, "location:update", { tripId, lat: 18.5308, lng: 73.88, accuracy: 8, recordedAt: t0 })).ok).toBe(true);
    await wait(1100);
    // 5 km away 1 s later with "8 m accuracy": a glitch.
    const bad = await emit(s, "location:update", { tripId, lat: 18.5308, lng: 73.928, accuracy: 8, recordedAt: t0 + 1000 });
    expect(bad.data.ignored).toBe("impossible-jump");
    // A fix that's really far off with honest accuracy is fine.
    await wait(1100);
    const ok = await emit(s, "location:update", { tripId, lat: 18.5308, lng: 73.8803, accuracy: 10, recordedAt: t0 + 2000 });
    expect(ok.data.ignored).toBeUndefined();
    s.close();
  });

  it("does not move a rider backwards for a fix that arrives late", async () => {
    const { s } = await newRider("Deepa", "d4@t.dev");
    const t0 = Date.now();
    await emit(s, "location:update", { tripId, lat: 18.5308, lng: 73.89, accuracy: 5, recordedAt: t0 });
    await wait(1100);
    const late = await emit(s, "location:update", { tripId, lat: 18.5308, lng: 73.885, accuracy: 5, recordedAt: t0 - 30_000 });
    expect(late.data.ignored).toBe("out-of-order");
    s.close();
  });

  it("stores a dead-zone batch without gaps and moves the rider to the newest point", async () => {
    const { r, s } = await newRider("Esha", "e5@t.dev");
    const t0 = Date.now() - 120_000;
    // 2 minutes in a tunnel, one fix every 2 s (the server keeps one per 5 s).
    const points = Array.from({ length: 60 }, (_, i) => ({
      lat: 18.5308, lng: 73.885 + i * 0.0002, speed: 30, accuracy: 6, recordedAt: t0 + i * 2000,
    }));
    const moved = next(adminSock, "member:location");
    const ack = await emit(s, "location:batch", { tripId, points: [...points].reverse() });
    expect(ack.ok).toBe(true);
    expect(ack.data.received).toBe(60);
    expect(ack.data.stored).toBe(21); // every 3rd (≥5 s apart) + the newest
    const m = await moved;
    expect(m.lng).toBeCloseTo(73.885 + 59 * 0.0002, 6);
    const rows = await prisma.locationPing.findMany({ where: { tripId, userId: r.user.id }, orderBy: { recordedAt: "asc" } });
    expect(rows.length).toBeGreaterThanOrEqual(20);
    expect(rows[0].recordedAt.getTime()).toBe(t0); // the phone's time, not upload time
    s.close();
  });

  it("rejects an oversized batch", async () => {
    const { s } = await newRider("Farid", "f6@t.dev");
    const points = Array.from({ length: 501 }, () => ({ lat: 18.53, lng: 73.9 }));
    const ack = await emit(s, "location:batch", { tripId, points });
    expect(ack.ok).toBe(false);
    s.close();
  });
});

describe("safety monitor alerts (internal endpoint)", () => {
  it("needs the shared key", async () => {
    const r = await request(app).post("/api/internal/alerts").send({});
    expect(r.status).toBe(401);
    const w = await request(app).post("/api/internal/alerts").set("X-Analytics-Key", "wrong").send({});
    expect(w.status).toBe(401);
  });

  it("raises a possible-crash alert to the admin, once per cooldown", async () => {
    const got = next(adminSock, "alert:new");
    const body = { tripId, userId: rider.user.id, type: "POSSIBLE_CRASH", message: "Asha stopped suddenly from 48 km/h and hasn't moved for 50 s", data: { fromKmh: 48 } };
    const r = await request(app).post("/api/internal/alerts").set("X-Analytics-Key", "test-analytics-key").send(body);
    expect(r.status).toBe(200);
    expect(r.body.data.raised).toBe(true);
    const a = await got;
    expect(a.type).toBe("POSSIBLE_CRASH");
    expect(a.severity).toBe("CRITICAL");
    expect(a.data.source).toBe("safety-monitor");
    const again = await request(app).post("/api/internal/alerts").set("X-Analytics-Key", "test-analytics-key").send(body);
    expect(again.body.data.raised).toBe(false);
  });

  it("rejects unknown alert types (the monitor can't raise SOS)", async () => {
    const r = await request(app)
      .post("/api/internal/alerts")
      .set("X-Analytics-Key", "test-analytics-key")
      .send({ tripId, userId: rider.user.id, type: "SOS", message: "x" });
    expect(r.status).toBe(400);
  });
});

describe("position stream to the safety monitor", () => {
  it("publishes each processed position on NOTIFY navnet_ping when SAFETY_MONITOR is on", async () => {
    const { env } = await import("../src/config/env.js");
    const pg = (await import("pg")).default;
    const listener = new pg.Client({ connectionString: process.env.DATABASE_URL.split("?")[0] });
    await listener.connect();
    await listener.query("LISTEN navnet_ping");
    const got = new Promise((res) => listener.once("notification", (n) => res(JSON.parse(n.payload))));
    env.safetyMonitor = true;
    try {
      await new Promise((r) => setTimeout(r, 1100));
      // accuracy 0 = simulated fix (skips the impossible-jump guard; the rider was elsewhere a moment ago)
      await emit(riderSock, "location:update", { tripId, lat: 18.5308, lng: 73.94, speed: 33, accuracy: 0, heading: 90 });
      const msg = await got;
      expect(msg).toMatchObject({ tripId, userId: rider.user.id, speed: 33, accuracy: 0, heading: 90 });
      expect(typeof msg.nearPlace).toBe("boolean");
      expect(msg.t).toBeGreaterThan(0);
    } finally {
      env.safetyMonitor = false;
      await listener.end();
    }
  });
});

describe("webhooks for automation (n8n)", () => {
  let hook, got, env;
  const waitFor = async (pred, ms = 4000) => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      const hit = got.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("webhook not received");
  };
  beforeAll(async () => {
    got = [];
    hook = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        got.push({ headers: req.headers, body, json: JSON.parse(body) });
        res.end("ok");
      });
    });
    await new Promise((r) => hook.listen(0, r));
    env = (await import("../src/config/env.js")).env;
    env.webhookUrl = `http://127.0.0.1:${hook.address().port}/navnet`;
    env.webhookSecret = "hook-secret";
    await prisma.user.update({ where: { id: rider.user.id }, data: { bloodGroup: "B+", emergencyName: "Mom", emergencyPhone: "+919800000009" } });
  });
  afterAll(async () => {
    env.webhookUrl = "";
    await new Promise((r) => hook.close(r));
  });

  it("sends a signed alert.raised for SOS with the rider's emergency card", async () => {
    await emit(riderSock, "sos:trigger", { tripId, lat: 18.531, lng: 73.9, speed: 0, battery: 40, emergencyType: "ACCIDENT" });
    const h = await waitFor((x) => x.json.event === "alert.raised" && x.json.alert.type === "SOS");
    const { sign } = await import("../src/services/webhook.service.js");
    expect(h.headers["x-navnet-signature"]).toBe(sign(h.body, "hook-secret"));
    expect(h.headers["x-navnet-event"]).toBe("alert.raised");
    expect(h.json.alert.emergency).toBe(true);
    expect(h.json.alert.mapLink).toMatch(/openstreetmap\.org/);
    expect(h.json.rider.emergencyCard).toEqual({ bloodGroup: "B+", contactName: "Mom", contactPhone: "+919800000009" });
    expect(h.json.trip.id).toBe(tripId);
    expect(h.json.captain).toBeTruthy();
  });

  it("routine alerts don't carry the emergency card", async () => {
    await request(app)
      .post("/api/internal/alerts")
      .set("X-Analytics-Key", "test-analytics-key")
      .send({ tripId, userId: rider.user.id, type: "WEAK_GPS", message: "Asha's GPS has been weak" });
    const h = await waitFor((x) => x.json.alert?.type === "WEAK_GPS");
    expect(h.json.alert.emergency).toBe(false);
    expect(h.json.rider.emergencyCard).toBeUndefined();
  });

  it("retries when the automation tool is briefly down", async () => {
    let calls = 0;
    const flaky = http.createServer((req, res) => {
      calls += 1;
      req.resume();
      res.statusCode = calls < 3 ? 503 : 200;
      res.end();
    });
    await new Promise((r) => flaky.listen(0, r));
    const { sendEvent } = await import("../src/services/webhook.service.js");
    const old = env.webhookUrl;
    env.webhookUrl = `http://127.0.0.1:${flaky.address().port}/x`;
    const [ok] = await sendEvent("test.ping", { hello: 1 });
    env.webhookUrl = old;
    await new Promise((r) => flaky.close(r));
    expect(ok).toBe(true);
    expect(calls).toBe(3);
  });

  it("sends trip.ended with the ride summary", async () => {
    await request(app).patch(`/api/trips/${tripId}/status`).set(auth(admin.token)).send({ action: "end" });
    const h = await waitFor((x) => x.json.event === "trip.ended", 8000);
    expect(h.json.summary).toMatchObject({ riders: expect.any(Number), sosCount: expect.any(Number) });
  });
});
