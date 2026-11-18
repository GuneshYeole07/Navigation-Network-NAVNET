import api from "./api";

/**
 * Place search / reverse geocoding go through our API first (cached, rate-limited,
 * Nominatim → Photon). If the API can't reach either, the browser asks Photon
 * directly: it's OpenStreetMap data, free, keyless and CORS-enabled.
 */
const PHOTON = (import.meta.env.VITE_PHOTON_URL || "https://photon.komoot.io").replace(/\/$/, "");

function photonToPlace(f) {
  const p = f.properties || {};
  const [lng, lat] = f.geometry.coordinates;
  const parts = [p.name, p.street, p.district, p.city || p.county, p.state, p.country].filter(Boolean);
  return {
    name: [...new Set(parts)].join(", ") || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    shortName: p.name || parts[0] || "Dropped pin",
    lat,
    lng,
    type: p.osm_value,
  };
}

async function photon(path) {
  const res = await fetch(`${PHOTON}${path}`);
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  return (await res.json()).features || [];
}

const FOSSGIS = (import.meta.env.VITE_ROUTING_URL || "https://routing.openstreetmap.de").replace(/\/$/, "");
const FOSSGIS_PROFILE = { driving: "car", cycling: "bike", walking: "foot" };

/** Road route straight from the browser (used when our server couldn't reach a router). */
async function browserRoute(coordinates, profile) {
  const path = coordinates.map(([lat, lng]) => `${lng},${lat}`).join(";");
  const res = await fetch(`${FOSSGIS}/routed-${FOSSGIS_PROFILE[profile] || "car"}/route/v1/driving/${path}?overview=full&geometries=geojson`);
  const data = await res.json();
  const r = data.routes?.[0];
  if (data.code !== "Ok" || !r) throw new Error(data.code || "no route");
  return { geometry: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]), distance: r.distance, duration: r.duration, provider: "osrm" };
}

export const geoService = {
  async route(coordinates, profile = "driving") {
    const r = await api.post("/geo/route", { coordinates, profile });
    if (r.provider !== "straight-line" || r.noRoute) return r;
    try {
      return await browserRoute(coordinates, profile);
    } catch {
      return r;
    }
  },

  /** @param near {lat,lng} optional: prefer results around here (start point / map view). */
  async search(q, near) {
    const bias = near ? { lat: near.lat.toFixed(4), lng: near.lng.toFixed(4) } : {};
    try {
      return await api.get("/geo/search", { params: { q, ...bias } });
    } catch (serverErr) {
      if (serverErr.status && serverErr.status < 500) throw serverErr; // auth / validation: don't mask
      try {
        const nb = near ? `&lat=${bias.lat}&lon=${bias.lng}` : "";
        return (await photon(`/api/?limit=6&lang=en${nb}&q=${encodeURIComponent(q)}`)).map(photonToPlace);
      } catch {
        throw new Error("Place search is unavailable right now. Check your internet connection, or drop pins on the map.");
      }
    }
  },

  async reverse(lat, lng) {
    const r = await api.get("/geo/reverse", { params: { lat, lng } });
    if (r.shortName !== "Dropped pin") return r;
    // Server returned a coordinate-only label (its geocoders were unreachable): try Photon from the browser.
    try {
      const [f] = await photon(`/reverse?lang=en&lat=${lat}&lon=${lng}`);
      return f ? { ...photonToPlace(f), lat, lng } : r;
    } catch {
      return r;
    }
  },

  uploadImage: (file) => {
    const fd = new FormData();
    fd.append("image", file);
    return api.post("/uploads/image", fd);
  },
};
