import { useEffect, useState } from "react";
import { tripService } from "../services/tripService";

/**
 * Machine-learned arrival time from the analytics service, refreshed every minute while
 * the trip is running and we're online. Returns null when not available (the app then
 * keeps showing the on-device estimate).
 */
export function useSmartEta(tripId, { active, online }) {
  const [eta, setEta] = useState(null);
  useEffect(() => {
    if (!tripId || !active || !online) return undefined;
    let alive = true;
    const load = () =>
      tripService
        .smartEta(tripId)
        .then((r) => alive && setEta(r?.available && r.source === "model" ? { ...r, fetchedAt: Date.now() } : null))
        .catch(() => alive && setEta(null));
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [tripId, active, online]);
  // Drop it if it's gone stale (e.g. we went offline 5+ minutes ago).
  return eta && Date.now() - eta.fetchedAt < 5 * 60_000 ? eta : null;
}
