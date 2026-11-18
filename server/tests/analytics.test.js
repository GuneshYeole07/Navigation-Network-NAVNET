import { describe, expect, it } from "vitest";
import { analyseTrack, clusterStops } from "../src/services/analytics.service.js";

const min = 60 * 1000;

describe("trip analytics", () => {
  it("sums distance, max speed and detects a stop", () => {
    const t0 = Date.now();
    const pings = [
      { lat: 18.5, lng: 73.8, speed: 40, t: t0 },
      { lat: 18.5, lng: 73.81, speed: 45, t: t0 + 1 * min },
      { lat: 18.5, lng: 73.81, speed: 0, t: t0 + 2 * min },
      { lat: 18.5, lng: 73.81, speed: 0, t: t0 + 6 * min },
      { lat: 18.5, lng: 73.82, speed: 50, t: t0 + 7 * min },
    ];
    const r = analyseTrack(pings);
    expect(r.distance / 1000).toBeCloseTo(2.11, 1);
    expect(r.maxSpeed).toBe(50);
    expect(r.stops).toHaveLength(1);
  });

  it("drops impossible GPS jumps from distance", () => {
    const t0 = Date.now();
    const r = analyseTrack([
      { lat: 18.5, lng: 73.8, speed: 30, t: t0 },
      { lat: 19.5, lng: 73.8, speed: 30, t: t0 + 10000 }, // 111 km in 10 s
    ]);
    expect(r.distance).toBe(0);
  });

  it("clusters simultaneous nearby stops into one convoy halt", () => {
    const t = Date.now();
    const stops = [
      { lat: 18.5, lng: 73.8, start: t, end: t + 5 * min },
      { lat: 18.5005, lng: 73.8005, start: t + min, end: t + 6 * min },
      { lat: 18.7, lng: 73.5, start: t + 60 * min, end: t + 70 * min },
    ];
    expect(clusterStops(stops)).toHaveLength(2);
  });
});
