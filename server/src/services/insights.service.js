/**
 * Bridge to the Python analytics service (analytics/, FastAPI). The API checks the user may
 * see the trip, then asks the service. If the service is off or down, these return
 * { available: false } and the app simply hides the extra panels.
 */
import { env } from "../config/env.js";
import { assertTripAccess } from "./trip.service.js";

const etaCache = new Map(); // tripId → { at, data }
const ETA_TTL_MS = 30_000;

async function callAnalytics(path, { timeoutMs = 8000 } = {}) {
  if (!env.analyticsUrl) return { available: false, reason: "Analytics service not configured" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.analyticsUrl}${path}`, { headers: { "X-Analytics-Key": env.analyticsKey }, signal: ctrl.signal });
    if (!res.ok) return { available: false, reason: `Analytics service answered ${res.status}` };
    return { available: true, ...(await res.json()) };
  } catch (e) {
    if (!env.isTest) console.warn(`[analytics] ${path} failed: ${e.message}`);
    return { available: false, reason: "Analytics service unreachable" };
  } finally {
    clearTimeout(t);
  }
}

export async function tripInsights(tripId, user) {
  await assertTripAccess(tripId, user);
  return callAnalytics(`/trips/${encodeURIComponent(tripId)}/insights`, { timeoutMs: 20000 });
}

export async function smartEta(tripId, user) {
  await assertTripAccess(tripId, user);
  const hit = etaCache.get(tripId);
  if (hit && Date.now() - hit.at < ETA_TTL_MS) return hit.data;
  const data = await callAnalytics(`/trips/${encodeURIComponent(tripId)}/eta`, { timeoutMs: 5000 });
  etaCache.set(tripId, { at: Date.now(), data });
  if (etaCache.size > 500) etaCache.delete(etaCache.keys().next().value);
  return data;
}
