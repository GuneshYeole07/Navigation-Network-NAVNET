import { describe, expect, it } from "vitest";
import { formatDistance, formatDuration, initials, memberColor, timeAgo } from "./format";
import { haversine } from "./geo";

describe("format utils", () => {
  it("formats distance", () => {
    expect(formatDistance(450)).toBe("450 m");
    expect(formatDistance(4520)).toBe("4.5 km");
    expect(formatDistance(59390)).toBe("59 km");
    expect(formatDistance(null)).toBe("—");
  });
  it("formats duration", () => {
    expect(formatDuration(600)).toBe("10 min");
    expect(formatDuration(7200)).toBe("2 h");
    expect(formatDuration(5430)).toBe("1 h 31 min");
  });
  it("relative time", () => {
    const now = Date.now();
    expect(timeAgo(now - 3000, now)).toBe("just now");
    expect(timeAgo(now - 90000, now)).toBe("1m ago");
  });
  it("initials and stable colours", () => {
    expect(initials("Aarav Patil")).toBe("AP");
    expect(memberColor("abc")).toBe(memberColor("abc"));
  });
  it("haversine matches the server", () => {
    expect(haversine([18.5204, 73.8567], [19.076, 72.8777]) / 1000).toBeCloseTo(120, -1);
  });
});
