/**
 * Post-trip analytics, computed from persisted location pings, checkpoint visits,
 * alerts and messages. Called automatically when the admin ends a trip; also usable
 * as a live preview while the trip is running (persist:false).
 */
import { prisma } from "../database/prisma.js";
import { haversine } from "../utils/geo.js";
import { ApiError } from "../utils/ApiError.js";

const STOP_SPEED_KMH = 2;
const STOP_MIN_MS = 2 * 60 * 1000;
const MAX_PLAUSIBLE_KMH = 250; // drop GPS teleports when summing distance

const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/** Per-member track stats. Exported for unit tests. */
export function analyseTrack(pings) {
  let distance = 0;
  let maxSpeed = 0;
  let movingMs = 0;
  let movingSpeedSum = 0;
  let movingSamples = 0;
  const stops = [];
  let stopStart = null;

  for (let i = 0; i < pings.length; i++) {
    const p = pings[i];
    const speed = p.speed ?? 0;
    maxSpeed = Math.max(maxSpeed, speed);
    if (speed >= STOP_SPEED_KMH) {
      movingSpeedSum += speed;
      movingSamples += 1;
    }

    if (i > 0) {
      const prev = pings[i - 1];
      const dt = p.t - prev.t;
      const d = haversine([prev.lat, prev.lng], [p.lat, p.lng]);
      if (dt > 0 && (d / dt) * 3600 <= MAX_PLAUSIBLE_KMH) {
        distance += d;
        if (speed >= STOP_SPEED_KMH) movingMs += dt;
      }
    }

    if (speed < STOP_SPEED_KMH) {
      if (!stopStart) stopStart = p;
    } else if (stopStart) {
      if (p.t - stopStart.t >= STOP_MIN_MS) stops.push({ lat: stopStart.lat, lng: stopStart.lng, start: stopStart.t, end: p.t });
      stopStart = null;
    }
  }
  const last = pings.at(-1);
  if (stopStart && last && last.t - stopStart.t >= STOP_MIN_MS) {
    stops.push({ lat: stopStart.lat, lng: stopStart.lng, start: stopStart.t, end: last.t });
  }

  return {
    distance,
    maxSpeed,
    movingMs,
    // Mean of device-reported speeds while moving: robust to signal gaps that
    // would otherwise distort distance ÷ time.
    avgMovingSpeed: movingSamples ? movingSpeedSum / movingSamples : movingMs > 0 ? distance / 1000 / (movingMs / 3600000) : 0,
    stops,
  };
}

/** Merge per-member stops that are the same convoy halt (close in space and time). */
export function clusterStops(stops, radius = 300, slackMs = 10 * 60 * 1000) {
  const clusters = [];
  for (const s of [...stops].sort((a, b) => a.start - b.start)) {
    const c = clusters.find(
      (k) => haversine([k.lat, k.lng], [s.lat, s.lng]) <= radius && s.start <= k.end + slackMs && s.end >= k.start - slackMs,
    );
    if (c) {
      c.start = Math.min(c.start, s.start);
      c.end = Math.max(c.end, s.end);
      c.members += 1;
    } else clusters.push({ ...s, members: 1 });
  }
  return clusters;
}

export async function generateReport(tripId, { persist = true } = {}) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      checkpoints: { orderBy: { order: "asc" } },
      members: { include: { user: { select: { id: true, name: true } } } },
      alerts: { select: { type: true, userId: true, createdAt: true, message: true, data: true } },
      visits: { select: { checkpointId: true, userId: true } },
    },
  });
  if (!trip) throw ApiError.notFound("Trip not found");

  const pings = await prisma.locationPing.findMany({
    where: { tripId },
    orderBy: { recordedAt: "asc" },
    select: { userId: true, lat: true, lng: true, speed: true, recordedAt: true },
  });
  const msgCounts = await prisma.message.groupBy({
    by: ["senderId"],
    where: { tripId, type: "CHAT" },
    _count: { _all: true },
  });
  const msgBy = new Map(msgCounts.map((r) => [r.senderId, r._count._all]));

  const byUser = new Map();
  for (const p of pings) {
    if (!byUser.has(p.userId)) byUser.set(p.userId, []);
    byUser.get(p.userId).push({ lat: p.lat, lng: p.lng, speed: p.speed, t: p.recordedAt.getTime() });
  }

  const total = trip.routeDistance || 1;
  const allStops = [];
  const participation = trip.members.map((m) => {
    const track = analyseTrack(byUser.get(m.userId) || []);
    // Gaps in the track (tunnels, dead zones) drop segments; route progress is a floor.
    track.distance = Math.max(track.distance, m.maxProgressMeters);
    allStops.push(...track.stops);
    const alerts = trip.alerts.filter((a) => a.userId === m.userId);
    const completion = Math.min(100, (m.maxProgressMeters / total) * 100);
    return {
      userId: m.userId,
      name: m.user.name,
      vehicleNumber: m.vehicleNumber,
      memberStatus: m.status,
      joinedAt: m.joinedAt,
      arrived: !!m.arrivedAt,
      arrivedAt: m.arrivedAt,
      distanceKm: round(track.distance / 1000, 2),
      avgSpeedKmh: round(track.avgMovingSpeed),
      maxSpeedKmh: round(track.maxSpeed),
      stops: track.stops.length,
      checkpointsVisited: trip.visits.filter((v) => v.userId === m.userId).length,
      completionPercent: round(completion),
      alerts: alerts.length,
      sosCount: alerts.filter((a) => a.type === "SOS").length,
      messagesSent: msgBy.get(m.userId) || 0,
      pings: (byUser.get(m.userId) || []).length,
    };
  });

  const riders = participation.filter((p) => p.pings > 0);
  const firstPing = pings[0]?.recordedAt?.getTime();
  const lastPing = pings.at(-1)?.recordedAt?.getTime();
  const start = trip.startedAt?.getTime() ?? firstPing ?? null;
  const end = trip.endedAt?.getTime() ?? lastPing ?? Date.now();

  const visitedIds = new Set(trip.visits.map((v) => v.checkpointId));
  const checkpoints = trip.checkpoints.map((c) => ({
    id: c.id,
    name: c.name,
    category: c.category,
    visitedBy: trip.visits.filter((v) => v.checkpointId === c.id).length,
  }));

  const alertsByType = {};
  for (const a of trip.alerts) alertsByType[a.type] = (alertsByType[a.type] || 0) + 1;

  const summary = {
    tripId,
    tripName: trip.name,
    status: trip.status,
    plannedDistanceKm: round(trip.routeDistance / 1000, 2),
    totalDistanceKm: riders.length ? Math.max(...riders.map((r) => r.distanceKm)) : 0,
    averageDistanceKm: riders.length ? round(riders.reduce((s, r) => s + r.distanceKm, 0) / riders.length, 2) : 0,
    travelDurationSeconds: start ? Math.max(0, Math.round((end - start) / 1000)) : 0,
    startedAt: start ? new Date(start).toISOString() : null,
    endedAt: trip.endedAt ? trip.endedAt.toISOString() : null,
    averageSpeedKmh: riders.length ? round(riders.reduce((s, r) => s + r.avgSpeedKmh, 0) / riders.length) : 0,
    maxSpeedKmh: riders.length ? Math.max(...riders.map((r) => r.maxSpeedKmh)) : 0,
    totalStops: clusterStops(allStops).length,
    fuelStops: trip.checkpoints.filter((c) => c.category === "FUEL" && visitedIds.has(c.id)).length,
    checkpointsVisited: visitedIds.size,
    checkpointsTotal: trip.checkpoints.length,
    checkpoints,
    emergencyEvents: trip.alerts
      .filter((a) => a.type === "SOS")
      .map((a) => ({ at: a.createdAt, message: a.message, emergencyType: a.data?.emergencyType ?? null })),
    alertsByType,
    routeCompletionPercent: participation.length
      ? round(participation.reduce((s, p) => s + p.completionPercent, 0) / participation.length)
      : 0,
    membersTotal: participation.length,
    membersArrived: participation.filter((p) => p.arrived).length,
    participation,
  };

  if (persist) {
    await prisma.tripReport.upsert({
      where: { tripId },
      update: { summary, generatedAt: new Date() },
      create: { tripId, summary },
    });
  }
  return summary;
}
