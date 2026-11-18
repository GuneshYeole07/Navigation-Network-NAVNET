import { describe, expect, it } from "vitest";
import { describeNav } from "./lockScreenNav";

const trip = { name: "Lonavala ride", destination: { name: "Lonavala, Maharashtra" } };
const base = { remaining: 12400, eta: new Date("2026-11-18T10:05:00Z"), arrived: false, offRoute: false, nextTurn: null, nextCheckpoint: null };

describe("lock-screen navigation text", () => {
  it("shows the next turn with distance, km to go and arrival", () => {
    const r = describeNav({ ...base, nextTurn: { type: "turn", side: "left", distance: 238 }, nextCheckpoint: { name: "Chai stop", distance: 1800 } }, trip);
    expect(r.title).toMatch(/left/i);
    expect(r.title).toMatch(/240 m/);
    expect(r.body).toMatch(/12 km to go/);
    expect(r.body).toMatch(/then Chai stop/);
  });
  it("warns when off route and says when arrived", () => {
    expect(describeNav({ ...base, offRoute: true, offRouteBy: 180 }, trip).title).toMatch(/Off route/);
    expect(describeNav({ ...base, arrived: true }, trip).title).toBe("You've arrived at Lonavala");
  });
});
