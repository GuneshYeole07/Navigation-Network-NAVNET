import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import request from "supertest";
import { io as ioc } from "socket.io-client";
import { createApp } from "../src/app.js";
import { initSocket } from "../src/socket/index.js";
import { prisma } from "../src/database/prisma.js";
import { clearAll, getContext, stopSweeper, sweep } from "../src/services/live.service.js";
import { resetCooldowns } from "../src/services/monitoring.service.js";
import { densify, cumulativeDistances, pointAlong } from "../src/utils/geo.js";
import { resetDb, tripInput } from "./helpers.js";

// L-shaped 4 km route: 2 km east, then a left turn and 2 km north.
const LINE = densify([[18.5, 73.8], [18.5, 73.819], [18.518, 73.819]], 100);
const CUM = cumulativeDistances(LINE);
const at = (m) => pointAlong(LINE, m, CUM);

let server, io, url, admin, r1, r2, tripId, A, S1, S2;
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = async (b) => (await request(app).post("/api/auth/register").send(b)).body.data;
const connect = (token) =>
  new Promise((res, rej) => {
    const s = ioc(url, { auth: { token }, transports: ["websocket"], forceNew: true });
    s.once("connect", () => res(s));
    s.once("connect_error", rej);
  });
const emit = (s, ev, d) => new Promise((r) => s.emit(ev, d, r));
const next = (s, ev, pred = () => true, ms = 4000) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout waiting for ${ev}`)), ms);
    const h = (d) => {
      if (!pred(d)) return;
      clearTimeout(t);
      s.off(ev, h);
      res(d);
    };
    s.on(ev, h);
  });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const move = async (s, m, speed = 30) => {
  const [lat, lng] = at(m);
  const ack = await emit(s, "location:update", { tripId, lat, lng, speed, battery: 80 });
  await wait(1050); // per-socket 1 s throttle
  return ack;
};

beforeAll(async () => {
  await resetDb();
  clearAll();
  resetCooldowns();
  server = http.createServer(app);
  io = initSocket(server);
  stopSweeper();
  await new Promise((r) => server.listen(0, r));
  url = `http://localhost:${server.address().port}`;
  admin = await reg({ name: "Captain Gunesh", email: "cap@t.dev", password: "Passw0rd", role: "ADMIN", adminCode: "TEST-ADMIN-CODE", phone: "9000000001" });
  r1 = await reg({ name: "Aarav", email: "aarav@t.dev", password: "Passw0rd", phone: "9000000002" });
  r2 = await reg({ name: "Diya", email: "diya@t.dev", password: "Passw0rd" });
  const trip = await request(app)
    .post("/api/trips")
    .set(auth(admin.token))
    .send(
      tripInput({
        groupCode: "GROUP-RIDE",
        start: { name: "A", lat: LINE[0][0], lng: LINE[0][1] },
        destination: { name: "B", lat: LINE.at(-1)[0], lng: LINE.at(-1)[1] },
        route: { geometry: LINE, distance: CUM.at(-1), duration: 600, provider: "test" },
        checkpoints: [],
        gapAlertMeters: 500,
      }),
    );
  tripId = trip.body.data.id;
  for (const r of [r1, r2]) await request(app).post("/api/trips/join").set(auth(r.token)).send({ groupCode: "GROUP-RIDE", password: "secret1" });
});

afterAll(async () => {
  for (const s of [A, S1, S2]) s?.close();
  io.close();
  await new Promise((r) => server.close(r));
  await prisma.$disconnect();
  vi.unstubAllGlobals();
});

describe("a real group ride", () => {
  it("admin rides along as captain (becomes leader, location tracked)", async () => {
    const r = await request(app).post(`/api/trips/${tripId}/ride`).set(auth(admin.token));
    expect(r.status).toBe(200);
    A = await connect(admin.token);
    S1 = await connect(r1.token);
    S2 = await connect(r2.token);
    for (const s of [A, S1, S2]) expect((await emit(s, "trip:join", { tripId })).ok).toBe(true);
    const snap = (await request(app).get(`/api/trips/${tripId}`).set(auth(r1.token))).body.data;
    expect(snap.trip.leaderId).toBe(admin.user.id);
    expect(snap.members.map((m) => m.name).sort()).toEqual(["Aarav", "Captain Gunesh", "Diya"]);
    const ack = await move(A, 0, 0);
    expect(ack.data.member.isLeader).toBe(true);
  });

  it("roll call: riders at the start point are counted", async () => {
    await move(S1, 50, 0);
    const ack = await move(S2, 80, 0);
    expect(ack.data.member.atStart).toBe(true);
  });

  it("pre-ride checklist is visible to the captain", async () => {
    const r = await request(app)
      .patch(`/api/trips/${tripId}/checklist`)
      .set(auth(r1.token))
      .send({ items: { fuel: true, documents: true, helmet: true, tyres: true, powerbank: true, offlinemap: true, emergency: true } });
    expect(r.status).toBe(200);
    const snap = (await request(app).get(`/api/trips/${tripId}`).set(auth(admin.token))).body.data;
    expect(snap.members.find((m) => m.name === "Aarav")).toMatchObject({ checklistDone: 7, checklistTotal: 7 });
  });

  it("ready check: everyone gets asked, captain hears when all are ready", async () => {
    const asked = next(S2, "ready:check");
    expect((await emit(A, "ready:check", { tripId })).ok).toBe(true);
    expect((await asked).by).toBe("Captain Gunesh");
    const all = next(A, "ready:all");
    await emit(S1, "ready:set", { tripId, ready: true });
    await emit(S2, "ready:set", { tripId, ready: true });
    expect((await all).count).toBe(3);
  });

  it("only the captain can drop a meet pin", async () => {
    const res = await emit(S2, "meet:set", { tripId, lat: 18.5, lng: 73.81, name: "Chai" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/captain/);
  });

  it("sweep: captain appoints the tail rider", async () => {
    const got = next(S1, "trip:sweep");
    expect((await emit(A, "sweep:set", { tripId, userId: r2.user.id })).ok).toBe(true);
    expect((await got).name).toBe("Diya");
    await request(app).patch(`/api/trips/${tripId}/status`).set(auth(admin.token)).send({ action: "start" });
  });

  it("gap alert: captain is told when a rider falls behind; rider is told to catch up", async () => {
    await move(A, 1500);
    await move(S1, 1400);
    await move(S2, 300); // 1.2 km behind the leader; limit is 500 m
    const alert = next(A, "alert:new", (a) => a.type === "GAP");
    const notice = next(S2, "notification", (n) => /falling behind/.test(n.message));
    await sweep();
    expect((await alert).message).toMatch(/Diya is 1\.2 km behind/);
    expect((await notice).message).toMatch(/1\.2 km ahead/);
  });

  it("…and hears 'group is back together' once the gap closes", async () => {
    await move(S2, 1450);
    const together = next(A, "group:together");
    await sweep();
    expect((await together).spreadMeters).toBeLessThan(250);
  });

  it("everyone past the junction → 'all took the turn' (with sweep)", async () => {
    for (const s of [A, S1, S2]) await emit(s, "location:update", { tripId, lat: at(2300)[0], lng: at(2300)[1], speed: 25 });
    await wait(1100);
    const cleared = next(A, "convoy:turn-cleared");
    await sweep();
    const c = await cleared;
    expect(c).toMatchObject({ side: "left", bySweep: true });
    expect(c.km).toBeCloseTo(1.9, 0);
  });

  it("stop request reaches the captain with the reason", async () => {
    const got = next(A, "alert:new", (a) => a.type === "STOP_REQUEST");
    expect((await emit(S1, "stop:request", { tripId, reason: "FUEL" })).ok).toBe(true);
    expect((await got).message).toBe("Aarav needs fuel");
    const again = await emit(S1, "stop:request", { tripId, reason: "FUEL" });
    expect(again.ok).toBe(false); // de-duplicated for a minute
  });

  it("meet pin + headcount + departure countdown", async () => {
    const [lat, lng] = at(2600);
    const meetSeen = next(S2, "trip:meet");
    expect((await emit(A, "meet:set", { tripId, lat, lng, name: "Indian Oil" })).ok).toBe(true);
    expect((await meetSeen).meet.name).toBe("Indian Oil");
    const ack = await move(S2, 2620, 0);
    expect(ack.data.member.atMeet).toBe(true);
    const dep = next(S1, "trip:depart", (d) => d.departAt);
    await emit(A, "depart:set", { tripId, minutes: 10 });
    const d = await dep;
    expect(new Date(d.departAt).getTime() - Date.now()).toBeGreaterThan(9 * 60 * 1000);
    // A rider waiting at the meet pin is not "stationary".
    const ctx = await getContext(tripId);
    expect(ctx.trip.meetName).toBe("Indian Oil");
  });

  it("the stop clears itself a few minutes after the countdown ends", async () => {
    const cleared = next(S1, "trip:meet", (d) => d.meet === null);
    await sweep(Date.now() + 16 * 60 * 1000);
    await cleared;
  });

  it("SOS: captain gets the emergency card; nearest friends get directions", async () => {
    await request(app).patch("/api/auth/me").set(auth(r2.token)).send({ bloodGroup: "B+", emergencyName: "Mom", emergencyPhone: "9111111111" });
    const sos = next(A, "sos:alert");
    const helper = next(S1, "sos:nearby");
    const [lat, lng] = at(2700);
    expect((await emit(S2, "sos:trigger", { tripId, lat, lng, emergencyType: "BREAKDOWN", battery: 30 })).ok).toBe(true);
    expect((await sos).data).toMatchObject({ bloodGroup: "B+", emergencyName: "Mom", emergencyPhone: "9111111111" });
    const h = await helper;
    expect(h).toMatchObject({ name: "Diya", emergencyType: "BREAKDOWN" });
    expect(h.distance).toBeLessThan(500);
  });

  it("rejects an invalid blood group", async () => {
    expect((await request(app).patch("/api/auth/me").set(auth(r2.token)).send({ bloodGroup: "Z+" })).status).toBe(400);
  });
});

describe("push-to-talk voice", () => {
  it("uploads a clip, broadcasts it, and serves the audio", async () => {
    const got = next(S2, "chat:message", (m) => m.type === "VOICE");
    const r = await request(app)
      .post(`/api/trips/${tripId}/voice`)
      .set(auth(r1.token))
      .field("durationMs", "4200")
      .attach("audio", Buffer.from("fake-opus-bytes"), { filename: "ptt.webm", contentType: "audio/webm;codecs=opus" });
    expect(r.status).toBe(201);
    const m = await got;
    expect(m).toMatchObject({ type: "VOICE", durationMs: 4200, senderName: "Aarav" });
    expect((await request(app).get(m.audioUrl)).status).toBe(200);
  });
  it("rejects non-audio files and outsiders", async () => {
    const bad = await request(app).post(`/api/trips/${tripId}/voice`).set(auth(r1.token)).attach("audio", Buffer.from("x"), { filename: "a.txt", contentType: "text/plain" });
    expect(bad.status).toBe(400);
    const out = await reg({ name: "Outsider", email: "o@t.dev", password: "Passw0rd" });
    const denied = await request(app).post(`/api/trips/${tripId}/voice`).set(auth(out.token)).attach("audio", Buffer.from("x"), { filename: "a.webm", contentType: "audio/webm" });
    expect(denied.status).toBe(403);
  });
});

describe("shared expenses", () => {
  it("splits fuel and food and works out who pays whom", async () => {
    await request(app).post(`/api/trips/${tripId}/expenses`).set(auth(r1.token)).send({ amount: 900, description: "Misal + chai" });
    await request(app).post(`/api/trips/${tripId}/expenses`).set(auth(r2.token)).send({ amount: 300, description: "Toll" });
    const s = (await request(app).get(`/api/trips/${tripId}/expenses`).set(auth(admin.token))).body.data;
    expect(s.totalPaise).toBe(120000);
    // each owes 400: Aarav +500, Diya -100, Captain -400
    const bal = Object.fromEntries(s.people.map((p) => [p.name, p.balancePaise]));
    expect(bal).toEqual({ Aarav: 50000, Diya: -10000, "Captain Gunesh": -40000 });
    expect(s.settlements).toEqual([
      expect.objectContaining({ fromName: "Captain Gunesh", toName: "Aarav", amountPaise: 40000 }),
      expect.objectContaining({ fromName: "Diya", toName: "Aarav", amountPaise: 10000 }),
    ]);
  });
  it("only the payer (or admin) can delete an expense", async () => {
    const e = (await request(app).post(`/api/trips/${tripId}/expenses`).set(auth(r1.token)).send({ amount: 50, description: "Water" })).body.data;
    expect((await request(app).delete(`/api/trips/${tripId}/expenses/${e.id}`).set(auth(r2.token))).status).toBe(403);
    expect((await request(app).delete(`/api/trips/${tripId}/expenses/${e.id}`).set(auth(r1.token))).status).toBe(200);
  });
});

describe("nearby essentials", () => {
  it("fetches from Overpass once, then serves the cache", async () => {
    const realFetch = globalThis.fetch;
    const overpass = vi.fn(async () =>
      new Response(JSON.stringify({ elements: [{ type: "node", id: 9, lat: at(1000)[0] + 0.001, lon: at(1000)[1], tags: { amenity: "fuel", name: "Bharat Petroleum" } }] })),
    );
    vi.stubGlobal("fetch", (u, o) => (String(u).includes("overpass") ? overpass(u, o) : realFetch(u, o)));
    const a = (await request(app).get(`/api/trips/${tripId}/pois`).set(auth(r1.token))).body.data;
    expect(a.source).toBe("overpass");
    expect(a.pois[0]).toMatchObject({ category: "fuel", name: "Bharat Petroleum" });
    const b = (await request(app).get(`/api/trips/${tripId}/pois`).set(auth(r2.token))).body.data;
    expect(b.source).toBe("cache");
    expect(overpass).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch", realFetch);
  });
});
