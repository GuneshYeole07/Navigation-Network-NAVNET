import * as routing from "../services/routing.service.js";
import { ok } from "../utils/respond.js";
import { ApiError } from "../utils/ApiError.js";

export const route = async (req, res) => ok(res, await routing.getRoute(req.body.coordinates, req.body.profile));

export const search = async (req, res) => {
  try {
    const { q, lat, lng } = req.q;
    ok(res, await routing.geocode(q, lat != null && lng != null ? { lat, lng } : null));
  } catch (err) {
    console.warn(`[geocode] search "${req.q.q}" failed: ${err.message}`);
    throw new ApiError(502, "Place search is temporarily unavailable. You can still drop pins on the map.");
  }
};

export const reverse = async (req, res) => {
  try {
    ok(res, await routing.reverseGeocode(req.q.lat, req.q.lng));
  } catch {
    // Degrade gracefully: a coordinate label is still a usable place name.
    ok(res, { name: `${req.q.lat.toFixed(5)}, ${req.q.lng.toFixed(5)}`, shortName: "Dropped pin", lat: req.q.lat, lng: req.q.lng });
  }
};
