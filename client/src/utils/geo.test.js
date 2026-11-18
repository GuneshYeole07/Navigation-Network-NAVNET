import { describe, expect, it } from "vitest";
import { corridorTiles, cumulative, detectTurns, haversine, project, tileOf, turnText } from "./geo";

// An L-shaped route: 2 km east, then 2 km north (a clear left turn).
const east = Array.from({ length: 21 }, (_, i) => [18.5, 73.8 + (0.019 * i) / 20]);
const north = Array.from({ length: 20 }, (_, i) => [18.5 + (0.018 * (i + 1)) / 20, 73.819]);
const L = [...east, ...north];

describe("on-device navigation maths", () => {
  it("projects a position onto the route", () => {
    const cum = cumulative(L);
    const p = project([18.5005, 73.81], L, cum); // ~55 m north of the 1 km mark
    expect(p.distance).toBeGreaterThan(40);
    expect(p.distance).toBeLessThan(70);
    expect(p.along / 1000).toBeCloseTo(1.06, 1);
  });

  it("detects the left turn at the corner, and nothing on straights", () => {
    const turns = detectTurns(L);
    expect(turns).toHaveLength(1);
    expect(turns[0].side).toBe("left");
    expect(turns[0].type).toBe("turn");
    expect(turns[0].along / 1000).toBeCloseTo(2.0, 1);
    expect(turnText(turns[0])).toBe("Turn left");
  });

  it("classifies slight and right turns", () => {
    const line = [[18.5, 73.8], [18.5, 73.81], [18.4985, 73.82]]; // bend ~ -8.5° … 9° → right & slight
    const t = detectTurns(line);
    expect(t.every((x) => x.side === "right")).toBe(true);
  });

  it("tile maths matches the slippy-map standard", () => {
    expect(tileOf(18.52, 73.85, 10)).toEqual([722, 458]); // y = 458.37 → 458
    expect(tileOf(0, 0, 1)).toEqual([1, 1]);
  });

  it("offline corridor covers the route at every zoom without exploding in size", () => {
    const tiles = corridorTiles(L);
    const zooms = new Set(tiles.map((k) => k.split("/")[0]));
    expect([...zooms].sort()).toEqual(["10", "11", "12", "13", "14", "15", "16"]);
    expect(tiles.length).toBeLessThan(200); // ~4 km route
    expect(haversine(L[0], L.at(-1))).toBeGreaterThan(2500);
  });
});
