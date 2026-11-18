import { describe, expect, it } from "vitest";
import { GpsFilter } from "./gpsFilter";
import track from "./__fixtures__/gps-track.json";
import turns from "./__fixtures__/gps-turns.json";
import turnsDoppler from "./__fixtures__/gps-turns-doppler.json";

const R = 6371008.8;
const DEG = Math.PI / 180;
const dist = (a, b, c, d) => {
  const x = Math.sin(((c - a) * DEG) / 2) ** 2 + Math.cos(a * DEG) * Math.cos(c * DEG) * Math.sin(((d - b) * DEG) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const rmse = (errs) => Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);

describe("live GPS filter", () => {
  const f = new GpsFilter();
  const out = track.map((p) => f.push({ lat: p.lat, lng: p.lng, accuracy: p.accuracy, speed: p.speed, heading: p.heading, timestamp: p.t }));

  it("matches the Python analytics filter on the same fixes (within 1 m)", () => {
    // Every fix, held-back ones included: the phone shows exactly what the analytics compute.
    const diffs = track.map((p, i) => dist(p.py_lat, p.py_lng, out[i].lat, out[i].lng));
    expect(Math.max(...diffs)).toBeLessThan(1);
    expect(track.filter((p, i) => p.py_used !== out[i].used)).toHaveLength(0);
  });

  it("is far more accurate than the raw fixes and drops the big jumps", () => {
    const raw = track.map((p) => dist(p.lat, p.lng, p.true_lat, p.true_lng));
    const filtered = track.map((p, i) => dist(out[i].lat, out[i].lng, p.true_lat, p.true_lng));
    expect(Math.max(...raw)).toBeGreaterThan(200);
    expect(rmse(filtered)).toBeLessThan(rmse(raw) * 0.4);
    expect(Math.max(...filtered)).toBeLessThan(80);
  });

  const run = (fixes) => {
    const g = new GpsFilter();
    const o = fixes.map((p) => g.push({ lat: p.lat, lng: p.lng, accuracy: p.accuracy, speed: p.speed, heading: p.heading, timestamp: p.t }));
    const err = fixes.map((p, i) => dist(o[i].lat, o[i].lng, p.true_lat, p.true_lng));
    const parity = fixes.map((p, i) => dist(p.py_lat, p.py_lng, o[i].lat, o[i].lng));
    return { o, err, parity, mismatched: fixes.filter((p, i) => p.py_used !== o[i].used).length };
  };

  it("follows sharp turns and a U-turn at 90 km/h with position only (one fix of lag)", () => {
    const r = run(turns);
    expect(r.mismatched).toBe(0);
    expect(Math.max(...r.parity)).toBeLessThan(1);
    // Without the phone's speed/heading each sharp turn costs one 3 s fix of overshoot
    // (a glitch looks the same until the next fix), then it's right again.
    expect(r.err.filter((e) => e > 40).length).toBeLessThanOrEqual(8);
    expect(r.err.filter((e) => e > 200)).toHaveLength(0);
  });

  it("follows the same turns with no lag when the phone reports speed + heading", () => {
    const r = run(turnsDoppler);
    expect(r.mismatched).toBe(0);
    expect(Math.max(...r.parity)).toBeLessThan(1);
    expect(rmse(r.err)).toBeLessThan(20);
    expect(Math.max(...r.err)).toBeLessThan(60);
  });

  it("never drifts away on stale velocity while fixes are held back", () => {
    const g = new GpsFilter();
    // Ride east at ~130 km/h, then turn north sharply.
    for (let i = 0; i < 5; i++) g.push({ lat: 18.53, lng: 73.88 + i * 0.00035, accuracy: 8, timestamp: i * 1000 });
    const outs = [];
    for (let k = 1; k <= 6; k++) outs.push(g.push({ lat: 18.53 + k * 0.00033, lng: 73.8814, accuracy: 8, timestamp: 4000 + k * 1000 }));
    const last = outs[outs.length - 1];
    expect(dist(last.lat, last.lng, 18.53 + 6 * 0.00033, 73.8814)).toBeLessThan(30);
    expect(Math.max(...outs.map((o, k) => dist(o.lat, o.lng, 18.53 + (k + 1) * 0.00033, 73.8814)))).toBeLessThan(120);
  });

  it("never reports an impossible speed (cached old fix, two fixes with the same time)", () => {
    const g = new GpsFilter();
    g.push({ lat: 18.6745, lng: 73.5591, accuracy: 10, timestamp: 1000 }); // cached from yesterday's ride
    const outs = [];
    for (let i = 0; i < 6; i++) outs.push(g.push({ lat: 18.53, lng: 73.88 + i * 0.0001, accuracy: 10, timestamp: 1000 + i * 1000 }));
    outs.push(g.push({ lat: 18.531, lng: 73.881, accuracy: 10, timestamp: 6000 })); // same time as the last one
    expect(Math.max(...outs.map((o) => o.speed ?? 0))).toBeLessThan(200);
    const last = outs[outs.length - 1];
    expect(dist(last.lat, last.lng, 18.53, 73.8805)).toBeLessThan(60);
  });

  it("accepts a held-back fix once nothing contradicts it (rider turned in and stopped)", () => {
    const g = new GpsFilter();
    for (let i = 0; i < 6; i++) g.push({ lat: 18.53, lng: 73.88 + i * 0.0003, accuracy: 8, timestamp: i * 1000 });
    const held = g.push({ lat: 18.5325, lng: 73.8815, accuracy: 8, timestamp: 6000 }); // sharp turn into a car park
    expect(held.used).toBe(false);
    expect(g.tick(10_000)).toBeNull(); // still waiting
    const ok = g.tick(15_000);
    expect(ok.used).toBe(true);
    expect(dist(ok.lat, ok.lng, 18.5325, 73.8815)).toBeLessThan(1);
  });

  it("ignores a fix with terrible accuracy", () => {
    const g = new GpsFilter();
    g.push({ lat: 18.5, lng: 73.8, accuracy: 8, timestamp: 0 });
    g.push({ lat: 18.5001, lng: 73.8, accuracy: 8, timestamp: 3000 });
    const bad = g.push({ lat: 18.6, lng: 73.9, accuracy: 900, timestamp: 6000 });
    expect(bad.used).toBe(false);
    expect(dist(bad.lat, bad.lng, 18.5, 73.8)).toBeLessThan(100);
  });
});
