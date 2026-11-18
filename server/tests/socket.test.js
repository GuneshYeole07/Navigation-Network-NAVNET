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
