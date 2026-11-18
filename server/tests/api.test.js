import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/database/prisma.js";
import { clearAll } from "../src/services/live.service.js";
import { resetDb, tripInput } from "./helpers.js";

const app = createApp();
let admin, rider, rider2, tripId;

const register = (body) => request(app).post("/api/auth/register").send(body);
const auth = (t) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  await resetDb();
  clearAll();
  admin = (await register({ name: "Admin", email: "a@t.dev", password: "Passw0rd", role: "ADMIN", adminCode: "TEST-ADMIN-CODE" })).body.data;
  rider = (await register({ name: "Rider One", email: "r1@t.dev", password: "Passw0rd" })).body.data;
  rider2 = (await register({ name: "Rider Two", email: "r2@t.dev", password: "Passw0rd" })).body.data;
});
afterAll(() => prisma.$disconnect());

describe("auth", () => {
  it("rejects admin signup without the invite code", async () => {
    const r = await register({ name: "Xavier", email: "x@t.dev", password: "Passw0rd", role: "ADMIN" });
    expect(r.status).toBe(403);
  });

  it("validates input", async () => {
    const r = await register({ name: "X", email: "not-an-email", password: "short" });
    expect(r.status).toBe(400);
    expect(r.body.error.details.length).toBeGreaterThan(0);
  });

  it("logs in through the matching portal only", async () => {
    const ok = await request(app).post("/api/auth/login").send({ email: "r1@t.dev", password: "Passw0rd", role: "USER" });
    expect(ok.status).toBe(200);
    expect(ok.body.data.user.passwordHash).toBeUndefined();
    const wrongPortal = await request(app).post("/api/auth/login").send({ email: "r1@t.dev", password: "Passw0rd", role: "ADMIN" });
    expect(wrongPortal.status).toBe(403);
    const bad = await request(app).post("/api/auth/login").send({ email: "r1@t.dev", password: "nope", role: "USER" });
    expect(bad.status).toBe(401);
  });

  it("protects routes and enforces roles", async () => {
    expect((await request(app).get("/api/trips/mine")).status).toBe(401);
    expect((await request(app).get("/api/trips/mine").set(auth(rider.token))).status).toBe(403);
  });
});

describe("trip lifecycle", () => {
  it("admin creates a trip (offline straight-line route fallback)", async () => {
    const r = await request(app).post("/api/trips").set(auth(admin.token)).send(tripInput());
    expect(r.status).toBe(201);
    expect(r.body.data.groupCode).toBe("TEST-RIDE");
    tripId = r.body.data.id;
    const t = await prisma.trip.findUnique({ where: { id: tripId } });
    expect(t.routeProvider).toBe("straight-line");
    expect(t.routeDistance / 1000).toBeGreaterThan(10);
  });

  it("rejects arrival before departure", async () => {
    const r = await request(app)
      .post("/api/trips")
      .set(auth(admin.token))
      .send(tripInput({ groupCode: "BAD-TIME", expectedArrival: new Date(Date.now()).toISOString() }));
    expect(r.status).toBe(400);
  });

  it("join requires the right Group ID + password", async () => {
    const bad = await request(app).post("/api/trips/join").set(auth(rider.token)).send({ groupCode: "TEST-RIDE", password: "wrong" });
    expect(bad.status).toBe(403); // must not be 401, which would log the rider out
    const ok = await request(app).post("/api/trips/join").set(auth(rider.token)).send({ groupCode: "test-ride", password: "secret1" });
    expect(ok.status).toBe(200);
    expect(ok.body.data.tripId).toBe(tripId);
  });

  it("first member becomes leader; snapshot hides group code from members", async () => {
    const r = await request(app).get(`/api/trips/${tripId}`).set(auth(rider.token));
    expect(r.status).toBe(200);
    expect(r.body.data.trip.leaderId).toBe(rider.user.id);
    expect(r.body.data.trip.groupCode).toBeUndefined();
    expect(r.body.data.members).toHaveLength(1);
    expect(r.body.data.trip.checkpoints[0].along).toBeGreaterThan(0);
  });

  it("non-members cannot read the trip", async () => {
    expect((await request(app).get(`/api/trips/${tripId}`).set(auth(rider2.token))).status).toBe(403);
  });

  it("group + private chat with admin-only DMs", async () => {
    await request(app).post("/api/trips/join").set(auth(rider2.token)).send({ groupCode: "TEST-RIDE", password: "secret1" });
    const g = await request(app).post(`/api/trips/${tripId}/messages`).set(auth(rider.token)).send({ body: "Hello convoy" });
    expect(g.status).toBe(201);
    const dmPeer = await request(app)
      .post(`/api/trips/${tripId}/messages`)
      .set(auth(rider.token))
      .send({ body: "psst", recipientId: rider2.user.id });
    expect(dmPeer.status).toBe(403);
    const dmAdmin = await request(app)
      .post(`/api/trips/${tripId}/messages`)
      .set(auth(rider.token))
      .send({ body: "Need fuel", recipientId: admin.user.id });
    expect(dmAdmin.status).toBe(201);

    const thread = await request(app).get(`/api/trips/${tripId}/messages?scope=private`).set(auth(rider.token));
    expect(thread.body.data.map((m) => m.body)).toEqual(["Need fuel"]);
    const threads = await request(app).get(`/api/trips/${tripId}/threads`).set(auth(admin.token));
    expect(threads.body.data[0].userId).toBe(rider.user.id);
  });

  it("admin changes leader, pauses, resumes", async () => {
    expect((await request(app).patch(`/api/trips/${tripId}/leader`).set(auth(admin.token)).send({ userId: rider2.user.id })).status).toBe(200);
    expect((await request(app).patch(`/api/trips/${tripId}/status`).set(auth(admin.token)).send({ action: "pause" })).status).toBe(400); // not started
    expect((await request(app).patch(`/api/trips/${tripId}/status`).set(auth(admin.token)).send({ action: "start" })).body.data.status).toBe("ACTIVE");
    expect((await request(app).patch(`/api/trips/${tripId}/status`).set(auth(admin.token)).send({ action: "pause" })).body.data.status).toBe("PAUSED");
    expect((await request(app).patch(`/api/trips/${tripId}/status`).set(auth(admin.token)).send({ action: "resume" })).body.data.status).toBe("ACTIVE");
  });

  it("removing the leader reassigns leadership and blocks re-join", async () => {
    const r = await request(app).delete(`/api/trips/${tripId}/members/${rider2.user.id}`).set(auth(admin.token));
    expect(r.status).toBe(200);
    const t = await prisma.trip.findUnique({ where: { id: tripId } });
    expect(t.leaderId).toBe(rider.user.id);
    const again = await request(app).post("/api/trips/join").set(auth(rider2.token)).send({ groupCode: "TEST-RIDE", password: "secret1" });
    expect(again.status).toBe(403);
  });

  it("ending the trip generates a persisted analytics report", async () => {
    const r = await request(app).patch(`/api/trips/${tripId}/status`).set(auth(admin.token)).send({ action: "end" });
    expect(r.body.data.status).toBe("COMPLETED");
    expect(r.body.data.report.checkpointsTotal).toBe(1);
    const rep = await request(app).get(`/api/trips/${tripId}/report`).set(auth(rider.token));
    expect(rep.body.data.final).toBe(true);
    expect(rep.body.data.participation.length).toBe(2);
  });
});

describe("communities", () => {
  let cid;
  it("admin creates, user requests, admin approves", async () => {
    const c = await request(app)
      .post("/api/communities")
      .set(auth(admin.token))
      .send({ name: "Pune Riders", description: "Weekend highway rides", city: "Pune", category: "Motorcycling" });
    expect(c.status).toBe(201);
    cid = c.body.data.id;

    const list = await request(app).get("/api/communities?search=pune").set(auth(rider.token));
    expect(list.body.data[0].myStatus).toBeNull();

    const req = await request(app).post(`/api/communities/${cid}/join`).set(auth(rider.token)).send({});
    expect(req.status).toBe(201);
    expect((await request(app).post(`/api/communities/${cid}/join`).set(auth(rider.token)).send({})).status).toBe(409);

    const reqs = await request(app).get(`/api/communities/${cid}/requests`).set(auth(admin.token));
    const d = await request(app)
      .patch(`/api/communities/${cid}/requests/${reqs.body.data[0].id}`)
      .set(auth(admin.token))
      .send({ decision: "APPROVED" });
    expect(d.body.data.status).toBe("APPROVED");

    await request(app).post(`/api/communities/${cid}/announcements`).set(auth(admin.token)).send({ title: "Ride Sunday", body: "6 AM sharp" });
    const detail = await request(app).get(`/api/communities/${c.body.data.slug}`).set(auth(rider.token));
    expect(detail.body.data.myStatus).toBe("APPROVED");
    expect(detail.body.data.announcements).toHaveLength(1);
  });
});

describe("misc", () => {
  it("health check reports the DB", async () => {
    const r = await request(app).get("/api/health");
    expect(r.body.data.db).toBe("up");
  });
  it("unknown route → JSON 404", async () => {
    const r = await request(app).get("/api/nope");
    expect(r.status).toBe(404);
    expect(r.body.success).toBe(false);
  });
});

describe("contacts & admin phone", () => {
  it("riders see the admin phone; only the admin sees rider phones", async () => {
    const a = (await register({ name: "Ph Admin", email: "pha@t.dev", password: "Passw0rd", role: "ADMIN", adminCode: "TEST-ADMIN-CODE", phone: "+91 98765 43210" })).body.data;
    const r = (await register({ name: "Ph Rider", email: "phr@t.dev", password: "Passw0rd", phone: "9123456789" })).body.data;
    const t = (await request(app).post("/api/trips").set(auth(a.token)).send(tripInput({ groupCode: "PHONE-TST" }))).body.data;
    await request(app).post("/api/trips/join").set(auth(r.token)).send({ groupCode: "PHONE-TST", password: "secret1" });
    const r2 = (await register({ name: "Ph Rider Two", email: "phr2@t.dev", password: "Passw0rd" })).body.data;
    await request(app).post("/api/trips/join").set(auth(r2.token)).send({ groupCode: "PHONE-TST", password: "secret1" });
    const snap = await request(app).get(`/api/trips/${t.id}`).set(auth(r2.token));
    expect(snap.body.data.trip.adminPhone).toBe("+91 98765 43210");
    expect(JSON.stringify(snap.body.data.members)).not.toContain("9123456789");
    // r is the first rider → group leader (captain) → may see contacts; r2 may not.
    expect((await request(app).get(`/api/trips/${t.id}/contacts`).set(auth(r2.token))).status).toBe(403);
    expect((await request(app).get(`/api/trips/${t.id}/contacts`).set(auth(r.token))).status).toBe(200);
    const c = await request(app).get(`/api/trips/${t.id}/contacts`).set(auth(a.token));
    expect(c.body.data[0]).toMatchObject({ name: "Ph Rider", phone: "9123456789" });
  });
  it("rejects a junk phone number", async () => {
    expect((await register({ name: "Bad Phone", email: "bp@t.dev", password: "Passw0rd", phone: "call me maybe" })).status).toBe(400);
  });
});

describe("invite links", () => {
  it("admin creates an invite; a rider joins with it, no password needed", async () => {
    const a = (await register({ name: "Inv Admin", email: "inva@t.dev", password: "Passw0rd", role: "ADMIN", adminCode: "TEST-ADMIN-CODE" })).body.data;
    const r = (await register({ name: "Inv Rider", email: "invr@t.dev", password: "Passw0rd" })).body.data;
    const t = (await request(app).post("/api/trips").set(auth(a.token)).send(tripInput({ groupCode: "INVITE-TST" }))).body.data;
    expect((await request(app).post(`/api/trips/${t.id}/invite`).set(auth(r.token))).status).toBe(403);
    const inv = (await request(app).post(`/api/trips/${t.id}/invite`).set(auth(a.token))).body.data;
    const j = await request(app).post("/api/trips/join").set(auth(r.token)).send({ invite: inv.token });
    expect(j.status).toBe(200);
    expect(j.body.data.tripId).toBe(t.id);
  });
  it("rejects forged or login tokens used as invites", async () => {
    const r = (await register({ name: "Forger", email: "forge@t.dev", password: "Passw0rd" })).body.data;
    expect((await request(app).post("/api/trips/join").set(auth(r.token)).send({ invite: "abc.def.ghi" })).status).toBe(403);
    expect((await request(app).post("/api/trips/join").set(auth(r.token)).send({ invite: r.token })).status).toBe(403);
    expect((await request(app).post("/api/trips/join").set(auth(r.token)).send({})).status).toBe(400);
  });
});

describe("token separation", () => {
  it("an invite token cannot be used to log in", async () => {
    const a = (await register({ name: "Sep Admin", email: "sepa@t.dev", password: "Passw0rd", role: "ADMIN", adminCode: "TEST-ADMIN-CODE" })).body.data;
    const t = (await request(app).post("/api/trips").set(auth(a.token)).send(tripInput({ groupCode: "SEP-TST" }))).body.data;
    const inv = (await request(app).post(`/api/trips/${t.id}/invite`).set(auth(a.token))).body.data;
    expect((await request(app).get("/api/auth/me").set(auth(inv.token))).status).toBe(401);
  });
});
