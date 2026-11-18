import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import request from "supertest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { resetDb } from "./helpers.js";
import { prisma } from "../src/database/prisma.js";

const app = createApp();
let stub, seen = [];

describe("analytics bridge (Python service)", () => {
  let admin, outsider, tripId;
  beforeAll(async () => {
    await resetDb();
    stub = http.createServer((req, res) => {
      seen.push({ url: req.url, key: req.headers["x-analytics-key"] });
      res.setHeader("Content-Type", "application/json");
      if (req.url.endsWith("/eta")) return res.end(JSON.stringify({ available: true, source: "model", minutes_left: 42 }));
      res.end(JSON.stringify({ has_data: true, summary: { riders: 3 } }));
    }).listen(0);
    await new Promise((r) => stub.once("listening", r));
    env.analyticsUrl = `http://127.0.0.1:${stub.address().port}`;
    env.analyticsKey = "k";
    const register = (body) => request(app).post("/api/auth/register").send(body);
    admin = (await register({ name: "Admin", email: "ia@t.dev", password: "Passw0rd", role: "ADMIN", adminCode: "TEST-ADMIN-CODE" })).body.data;
    outsider = (await register({ name: "Out Sider", email: "io@t.dev", password: "Passw0rd" })).body.data;
    const trip = await prisma.trip.create({
      data: {
        groupCode: "INSIGHT1", passwordHash: "x", name: "Insights", description: "d", adminId: admin.user.id,
        startName: "A", startLat: 18.5, startLng: 73.8, destName: "B", destLat: 18.6, destLng: 73.9,
        routeGeometry: [[18.5, 73.8], [18.6, 73.9]], routeDistance: 15000, routeDuration: 1200,
        departureTime: new Date(), expectedArrival: new Date(Date.now() + 3600e3), status: "ACTIVE",
      },
    });
    tripId = trip.id;
  });
  afterAll(() => {
    env.analyticsUrl = "";
    stub.close();
  });

  it("proxies insights and ETA with the shared key, for people on the trip", async () => {
    const ins = await request(app).get(`/api/trips/${tripId}/insights`).set("Authorization", `Bearer ${admin.token}`).expect(200);
    expect(ins.body.data).toMatchObject({ available: true, has_data: true });
    const eta = await request(app).get(`/api/trips/${tripId}/eta`).set("Authorization", `Bearer ${admin.token}`).expect(200);
    expect(eta.body.data).toMatchObject({ available: true, minutes_left: 42 });
    expect(seen.every((s) => s.key === "k")).toBe(true);
  });

  it("refuses people who aren't on the trip", async () => {
    await request(app).get(`/api/trips/${tripId}/insights`).set("Authorization", `Bearer ${outsider.token}`).expect(403);
  });

  it("degrades quietly when the service is off", async () => {
    env.analyticsUrl = "";
    const r = await request(app).get(`/api/trips/${tripId}/insights`).set("Authorization", `Bearer ${admin.token}`).expect(200);
    expect(r.body.data.available).toBe(false);
  });
});
