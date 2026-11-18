import { afterEach, describe, expect, it, vi } from "vitest";
import { geocode, reverseGeocode, describeError } from "../src/services/routing.service.js";

const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const photonFeature = {
  geometry: { coordinates: [73.4062, 18.7546] },
  properties: { name: "Lonavala", city: "Lonavala", state: "Maharashtra", country: "India", osm_value: "town" },
};

afterEach(() => vi.unstubAllGlobals());

describe("geocoding fallback", () => {
  it("uses Nominatim when it works", async () => {
    const fetch = vi.fn((url) =>
      url.includes("nominatim") ? json([{ display_name: "Yewalewadi, Pune, India", name: "Yewalewadi", lat: "18.44", lon: "73.89", type: "suburb" }]) : json({}),
    );
    vi.stubGlobal("fetch", fetch);
    const r = await geocode("Yewalewadi test1");
    expect(r[0]).toMatchObject({ shortName: "Yewalewadi", lat: 18.44, lng: 73.89 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to Photon when Nominatim is blocked (HTTP 403)", async () => {
    vi.stubGlobal("fetch", vi.fn((url) => (url.includes("nominatim") ? json({ error: "blocked" }, 403) : json({ features: [photonFeature] }))));
    const r = await geocode("Lavasa test2");
    expect(r[0]).toMatchObject({ shortName: "Lonavala", lat: 18.7546, lng: 73.4062 });
    expect(r[0].name).toBe("Lonavala, Maharashtra, India");
  });

  it("falls back to Photon when Nominatim's network fails", async () => {
    vi.stubGlobal("fetch", vi.fn((url) => (url.includes("nominatim") ? Promise.reject(new TypeError("fetch failed", { cause: { code: "ECONNRESET" } })) : json({ features: [photonFeature] }))));
    expect((await geocode("Lavasa test3"))[0].shortName).toBe("Lonavala");
  });

  it("reports every provider's real reason when all fail", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } }))));
    await expect(geocode("nowhere test4")).rejects.toThrow(/nominatim: fetch failed · ENOTFOUND.*photon: fetch failed · ENOTFOUND/);
  });

  it("does not cache failures (next search retries)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("down"))));
    await expect(geocode("retry test5")).rejects.toThrow();
    vi.stubGlobal("fetch", vi.fn(() => json({ features: [photonFeature] })));
    vi.stubGlobal("fetch", vi.fn((url) => (url.includes("nominatim") ? json([], 500) : json({ features: [photonFeature] }))));
    expect((await geocode("retry test5"))[0].shortName).toBe("Lonavala");
  });

  it("reverse geocode falls back to Photon too", async () => {
    vi.stubGlobal("fetch", vi.fn((url) => (url.includes("nominatim") ? json({}, 429) : json({ features: [photonFeature] }))));
    const r = await reverseGeocode(18.75, 73.4);
    expect(r).toMatchObject({ shortName: "Lonavala", lat: 18.75, lng: 73.4 });
  });

  it("describes timeouts and network causes", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(describeError(abort)).toBe("timed out");
    expect(describeError(new TypeError("fetch failed", { cause: { code: "ETIMEDOUT" } }))).toBe("fetch failed · ETIMEDOUT");
  });
});

describe("routing", () => {
  const coords = [[18.52, 73.85], [18.75, 73.41]];
  it("explains a point that's off-road (OSRM NoSegment on HTTP 400) instead of failing silently", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ code: "NoSegment" }), { status: 400, headers: { "content-type": "application/json" } }))));
    const { getRoute } = await import("../src/services/routing.service.js");
    const r = await getRoute(coords, "cycling");
    expect(r.provider).toBe("straight-line");
    expect(r.noRoute).toBe(true);
    expect(r.reason).toMatch(/too far from any road/);
  });
  it("search passes the 'near' bias to Nominatim", async () => {
    const fetch = vi.fn(() => json([]));
    vi.stubGlobal("fetch", fetch);
    await geocode("bias test", { lat: 18.5, lng: 73.8 }).catch(() => {});
    expect(fetch.mock.calls[0][0]).toMatch(/viewbox=72\.3,20,75\.3,17&bounded=0/);
  });
});
