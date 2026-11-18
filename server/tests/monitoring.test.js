import { describe, expect, it } from "vitest";
import { evaluateLocation } from "../src/services/monitoring.service.js";

const trip = { id: "t", status: "ACTIVE", speedLimitKmh: 60 };
const member = (o = {}) => ({
  userId: "u",
  name: "Asha",
  speed: 40,
  battery: 80,
  distanceFromRoute: 20,
  progress: 5000,
  maxProgress: 5000,
  arrivedAt: null,
  offRouteStreak: 0,
  flags: { lowBattery: false, offline: false },
  ...o,
});
const types = (arr) => arr.map((a) => a.type);

describe("monitoring rules", () => {
  it("no alerts for a well-behaved rider", () => {
    expect(evaluateLocation(trip, member())).toEqual([]);
  });

  it("off-route needs two consecutive off-route pings", () => {
    const m = member({ distanceFromRoute: 800 });
    expect(types(evaluateLocation(trip, m))).not.toContain("OFF_ROUTE");
    expect(types(evaluateLocation(trip, m))).toContain("OFF_ROUTE");
  });

  it("flags overspeed above the trip limit", () => {
    expect(types(evaluateLocation(trip, member({ speed: 75 })))).toContain("OVERSPEED");
  });

  it("flags wrong direction when progress drops within the recent window", () => {
    expect(types(evaluateLocation(trip, member({ progress: 4000, recentMax: 5000, maxProgress: 5000 })))).toContain("WRONG_DIRECTION");
  });

  it("does not flag a rider who is merely behind their all-time furthest point", () => {
    expect(types(evaluateLocation(trip, member({ progress: 4000, recentMax: 4000, maxProgress: 9000 })))).not.toContain("WRONG_DIRECTION");
  });

  it("low battery fires once until the battery recovers", () => {
    const m = member({ battery: 15 });
    expect(types(evaluateLocation(trip, m))).toContain("LOW_BATTERY");
    expect(types(evaluateLocation(trip, m))).not.toContain("LOW_BATTERY");
    m.battery = 40;
    evaluateLocation(trip, m);
    m.battery = 10;
    expect(types(evaluateLocation(trip, m))).toContain("LOW_BATTERY");
  });

  it("route rules are suppressed while the trip is paused", () => {
    const paused = { ...trip, status: "PAUSED" };
    expect(evaluateLocation(paused, member({ speed: 120, distanceFromRoute: 900, offRouteStreak: 5 }))).toEqual([]);
  });
});
