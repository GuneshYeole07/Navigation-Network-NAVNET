import { useMemo, useRef } from "react";
import { cumulative, detectTurns, haversine, project } from "../utils/geo";

const OFF_ROUTE_M = 120;
const ARRIVE_M = 150;

/**
 * The rider's own navigation, computed on the device from the trip's route geometry.
 * Needs only GPS — no network — so it keeps working in dead zones.
 * Returns progress, remaining distance, ETA, next turn, next checkpoint and off-route state.
 */
export function useRideNav(trip, fix) {
  const route = useMemo(() => {
    const line = trip?.routeGeometry;
    if (!line?.length) return null;
    const cum = cumulative(line);
    const checkpoints = (trip.checkpoints || []).map((c) => ({
      ...c,
      along: c.along ?? project([c.lat, c.lng], line, cum).along,
    }));
    return { line, cum, total: cum[cum.length - 1], turns: detectTurns(line, cum), checkpoints };
  }, [trip?.routeGeometry, trip?.checkpoints]);

  const last = useRef(null); // last on-route progress, for windowed projection

  return useMemo(() => {
    if (!route || !fix) return null;
    const p = [fix.lat, fix.lng];
    const prev = last.current;
    let proj = prev != null ? project(p, route.line, route.cum, { min: prev - 2000, max: prev + 8000 }) : project(p, route.line, route.cum);
    if (proj.distance > OFF_ROUTE_M) {
      const global = project(p, route.line, route.cum);
      if (global.distance < proj.distance) proj = global;
    }
    const offRoute = proj.distance > OFF_ROUTE_M;
    if (!offRoute) last.current = proj.along;
    const progress = proj.along;

    const dest = route.line[route.line.length - 1];
    const toDest = haversine(p, dest);
    const arrived = toDest <= ARRIVE_M;
    const remaining = arrived ? 0 : Math.max(0, route.total - progress);

    const plannedKmh = trip.routeDuration > 0 ? (trip.routeDistance / trip.routeDuration) * 3.6 : 40;
    const kmh = fix.speed != null && fix.speed > 5 ? fix.speed : plannedKmh;
    const etaSeconds = arrived ? 0 : remaining / (kmh / 3.6);

    const nextTurn = route.turns.find((t) => t.along > progress + 15) || null;
    const nextCheckpoint = route.checkpoints.find((c) => c.along > progress - 50) || null;

    return {
      progress,
      remaining,
      percent: route.total ? Math.min(100, (progress / route.total) * 100) : 0,
      offRoute,
      offRouteBy: Math.round(proj.distance),
      arrived,
      etaSeconds,
      eta: new Date(Date.now() + etaSeconds * 1000),
      nextTurn: nextTurn ? { ...nextTurn, distance: nextTurn.along - progress } : null,
      nextCheckpoint: nextCheckpoint ? { ...nextCheckpoint, distance: Math.max(0, nextCheckpoint.along - progress) } : null,
      total: route.total,
    };
  }, [route, fix, trip?.routeDuration, trip?.routeDistance]);
}
