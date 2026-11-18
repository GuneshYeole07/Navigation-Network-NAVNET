import { describe, expect, it } from "vitest";
import { settle, shares } from "../src/services/expense.service.js";
import { buildQuery, categoryOf, parsePois } from "../src/services/poi.service.js";
import { densify, detectTurns } from "../src/utils/geo.js";

describe("expense split", () => {
  it("splits equally and never loses a paisa", () => {
    const s = shares(1000, ["a", "b", "c"]);
    expect(s.map((x) => x.share)).toEqual([334, 333, 333]);
    expect(s.reduce((t, x) => t + x.share, 0)).toBe(1000);
  });
  it("settles with the fewest transfers", () => {
    // a paid 900 for a,b,c ; b paid 300 for a,b,c  → a +600-400=+500? compute: shares 300 each
    // a: +900 -300 -100 = +500 ; b: +300 -300 -100 = -100 ; c: -300 -100 = -400
    const t = settle({ a: 50000, b: -10000, c: -40000 });
    expect(t).toEqual([
      { from: "c", to: "a", amountPaise: 40000 },
      { from: "b", to: "a", amountPaise: 10000 },
    ]);
  });
  it("nothing to settle when even", () => {
    expect(settle({ a: 0, b: 0 })).toEqual([]);
  });
});

describe("nearby essentials (OpenStreetMap)", () => {
  const line = densify([[18.5, 73.8], [18.5, 73.9]], 500);
  it("maps OSM tags to categories", () => {
    expect(categoryOf({ amenity: "fuel" })).toBe("fuel");
    expect(categoryOf({ amenity: "clinic" })).toBe("hospital");
    expect(categoryOf({ shop: "tyres" })).toBe("mechanic");
    expect(categoryOf({ amenity: "cafe" })).toBe(null);
  });
  it("queries the route in boxes", () => {
    const q = buildQuery(line);
    expect(q).toContain('nwr["amenity"="fuel"]');
    expect(q.startsWith("[out:json]")).toBe(true);
  });
  it("keeps only places near the route, with distance along it", () => {
    const pois = parsePois(
      {
        elements: [
          { type: "node", id: 1, lat: 18.501, lon: 73.85, tags: { amenity: "fuel", name: "HP Petrol Pump" } },
          { type: "way", id: 2, center: { lat: 18.6, lon: 73.85 }, tags: { amenity: "fuel" } }, // 11 km away → dropped
          { type: "way", id: 3, center: { lat: 18.55, lon: 73.85 }, tags: { amenity: "hospital", name: "Rural Hospital", phone: "+91 20 1234" } }, // 5.5 km: hospitals allowed
          { type: "node", id: 4, lat: 18.5, lon: 73.82, tags: { shop: "motorcycle_repair" } },
          { type: "node", id: 1, lat: 18.501, lon: 73.85, tags: { amenity: "fuel" } }, // duplicate
        ],
      },
      line,
    );
    expect(pois.map((p) => p.category)).toEqual(["mechanic", "fuel", "hospital"]);
    expect(pois[1]).toMatchObject({ name: "HP Petrol Pump", fromRoute: expect.any(Number) });
    expect(pois[1].along / 1000).toBeCloseTo(5.3, 0);
    expect(pois[2].phone).toBe("+91 20 1234");
  });
});

describe("server turn detection", () => {
  it("finds the corner of an L-shaped route", () => {
    const L = densify([[18.5, 73.8], [18.5, 73.819], [18.518, 73.819]], 100);
    const t = detectTurns(L);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ side: "left", type: "turn" });
  });
});
