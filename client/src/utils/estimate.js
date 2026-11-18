import { pointAlong } from "./geo";

export const STALE_AFTER_S = 20; // no fix for this long → show "last seen" + an estimate
export const MAX_ESTIMATE_S = 120; // beyond 2 min an estimate is a guess, so stop
export const MAX_ESTIMATE_M = 2000;

/** Seconds since the rider's newest GPS fix (phone time when known). */
export function fixAge(m, now = Date.now()) {
  const t = new Date(m.lastFixAt ?? m.lastSeenAt ?? 0).getTime();
  return t ? Math.max(0, (now - t) / 1000) : Infinity;
}

/**
 * Where a rider probably is now, when their phone has gone quiet (tunnel, dead zone).
 * Carries them forward along the route at their last speed, for at most 2 min / 2 km.
 * Returns null when they're fresh, stopped, arrived, off-route without a heading, or too stale.
 */
export function estimatePosition(m, now = Date.now(), route = null) {
  if (m.lat == null || m.arrivedAt || m.status === "ARRIVED") return null;
  const age = fixAge(m, now);
  if (age < STALE_AFTER_S || age > MAX_ESTIMATE_S) return null;
  const kmh = m.speed || 0;
  if (kmh < 5) return null;
  const ahead = Math.min((kmh / 3.6) * age, MAX_ESTIMATE_M);

  if (route?.line?.length > 1 && m.progress != null && (m.distanceFromRoute ?? 0) < 150) {
    const [lat, lng] = pointAlong(route.line, m.progress + ahead, route.cum);
    return { lat, lng, ahead, age };
  }
  if (m.heading == null) return null;
  const R = 6371000;
  const b = (m.heading * Math.PI) / 180;
  const lat1 = (m.lat * Math.PI) / 180;
  const lng1 = (m.lng * Math.PI) / 180;
  const d = ahead / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lng2 = lng1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI, ahead, age };
}
