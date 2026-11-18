import { describe, expect, it } from "vitest";
import { bearing, cumulativeDistances, densify, haversine, pointAlong, projectOnLine } from "../src/utils/geo.js";

describe("geo utils", () => {
  it("haversine: Pune → Mumbai is ~120 km", () => {
    const d = haversine([18.5204, 73.8567], [19.076, 72.8777]);
    expect(d / 1000).toBeGreaterThan(115);
    expect(d / 1000).toBeLessThan(125);
  });

  it("bearing: due east is ~90°", () => {
    expect(bearing([0, 0], [0, 1])).toBeCloseTo(90, 0);
  });

  it("projects a point beside the line and measures progress", () => {
    const line = densify([[18.5, 73.8], [18.5, 73.9]], 200);
    const cum = cumulativeDistances(line);
    const total = cum.at(-1);
    const p = projectOnLine([18.501, 73.85], line, cum); // ~111 m north of the midpoint
    expect(p.distance).toBeGreaterThan(100);
    expect(p.distance).toBeLessThan(125);
    expect(p.along / total).toBeCloseTo(0.5, 1);
  });

  it("pointAlong is the inverse of projection", () => {
    const line = [[18.5, 73.8], [18.6, 73.8], [18.6, 73.9]];
    const cum = cumulativeDistances(line);
    const pt = pointAlong(line, 15000, cum);
    expect(projectOnLine(pt, line, cum).along).toBeCloseTo(15000, -1);
  });

  it("windowed projection ignores far legs of a looping route", () => {
    // Out-and-back route: both legs pass the same spot.
    const line = densify([[18.5, 73.8], [18.5, 73.9], [18.5005, 73.8]], 200);
    const cum = cumulativeDistances(line);
    const p = [18.5003, 73.85];
    const outbound = projectOnLine(p, line, cum, { min: 0, max: 12000 });
    expect(outbound.along).toBeLessThan(12000);
  });
});
