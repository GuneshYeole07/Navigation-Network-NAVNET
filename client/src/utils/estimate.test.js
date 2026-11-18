import { describe, expect, it } from "vitest";
import { estimatePosition, fixAge } from "./estimate";
import { cumulative, haversine } from "./geo";

const line = [[18.5, 73.8], [18.5, 73.9]]; // ~10.5 km due east
const route = { line, cum: cumulative(line) };
const now = 1_000_000_000;
const rider = (o = {}) => ({ lat: 18.5, lng: 73.81, speed: 36, heading: 90, progress: 1055, distanceFromRoute: 0, lastFixAt: now - 30_000, ...o });

describe("estimatePosition", () => {
  it("is null while the rider is fresh", () => {
    expect(estimatePosition(rider({ lastFixAt: now - 5000 }), now, route)).toBeNull();
  });
  it("carries a quiet rider forward along the route at their last speed", () => {
    const e = estimatePosition(rider(), now, route);
    expect(e.ahead).toBeCloseTo(300, 0); // 10 m/s × 30 s
    expect(haversine([18.5, 73.81], [e.lat, e.lng])).toBeGreaterThan(280);
  });
  it("caps the distance and gives up after 2 minutes", () => {
    expect(estimatePosition(rider({ speed: 200, lastFixAt: now - 100_000 }), now, route).ahead).toBe(2000);
    expect(estimatePosition(rider({ lastFixAt: now - 130_000 }), now, route)).toBeNull();
  });
  it("doesn't move stopped or arrived riders", () => {
    expect(estimatePosition(rider({ speed: 2 }), now, route)).toBeNull();
    expect(estimatePosition(rider({ arrivedAt: "x" }), now, route)).toBeNull();
  });
  it("uses heading when off the route", () => {
    const e = estimatePosition(rider({ distanceFromRoute: 800 }), now, null);
    expect(e.lng).toBeGreaterThan(73.81);
    expect(fixAge(rider(), now)).toBe(30);
  });
});
