/**
 * Live convoy state.
 *
 * Hot path (every GPS ping) runs fully in memory: project onto the route, derive speed,
 * progress, ETA, arrival and checkpoint visits, evaluate monitoring rules. Postgres is
 * written on a throttle (PING_PERSIST_SECONDS) so a 50-rider convoy pinging every 3 s
 * doesn't hammer the database. State is rebuilt from Postgres on demand after a restart.
 *
 * Scaling past one Node process: swap this Map for Redis and add the Socket.IO Redis
 * adapter — see docs/ARCHITECTURE.md.
 */
import { prisma } from "../database/prisma.js";
import { env } from "../config/env.js";
import { cumulativeDistances, detectTurns, haversine, projectOnLine } from "../utils/geo.js";
import { ApiError } from "../utils/ApiError.js";
import { evaluateLocation, raiseAlert } from "./monitoring.service.js";
import { emitToTrip, emitToTripAdmins, emitToUser } from "../socket/emitter.js";

const cfg = env.monitoring;
const contexts = new Map(); // tripId -> ctx
const loading = new Map(); // tripId -> Promise<ctx>
const online = new Map(); // `${tripId}:${userId}` -> open socket count

// ─────────────────────────── Context lifecycle ───────────────────────────

function memberFromDb(m, visitedIds) {
  const lat = m.lastLat;
  const lng = m.lastLng;
  return {
    userId: m.userId,
    name: m.user.name,
    vehicleNumber: m.vehicleNumber || m.user.vehicleNumber || null,
    joinedAt: m.joinedAt.getTime(),
    lat,
    lng,
    speed: m.lastSpeed ?? 0,
    heading: m.lastHeading ?? null,
    battery: m.battery ?? null,
    accuracy: null,
    lastSeenAt: m.lastSeenAt ? m.lastSeenAt.getTime() : null,
    progress: m.progressMeters,
    maxProgress: m.maxProgressMeters,
    distanceFromRoute: 0,
    arrivedAt: m.arrivedAt ? m.arrivedAt.getTime() : null,
    visited: new Set(visitedIds),
    speedEma: m.lastSpeed ?? 0,
    anchor: lat != null ? [lat, lng] : null,
    stationarySince: null,
    offRouteStreak: 0,
    ready: !!m.readyAt,
    checklist: m.checklist || {},
    history: [], // [{ t, p }] recent progress samples for wrong-direction detection
    recentMax: m.progressMeters,
    flags: { lowBattery: false, offline: false },
    lastPersistAt: 0,
  };
}

async function buildContext(tripId) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      admin: { select: { id: true, name: true, phone: true } },
      checkpoints: { orderBy: { order: "asc" } },
      waypoints: { orderBy: { order: "asc" } },
      members: {
        where: { status: "ACTIVE" },
        include: { user: { select: { id: true, name: true, vehicleNumber: true } } },
      },
    },
  });
  if (!trip) throw ApiError.notFound("Trip not found");

  const line = trip.routeGeometry;
  const cum = cumulativeDistances(line);
  const total = cum[cum.length - 1] || trip.routeDistance;
  const checkpoints = trip.checkpoints.map((c) => {
    const proj = projectOnLine([c.lat, c.lng], line, cum);
    return { ...c, along: proj.along, offset: proj.distance };
  });

  const visits = await prisma.checkpointVisit.findMany({
    where: { tripId },
    select: { userId: true, checkpointId: true },
  });
  const visitedBy = new Map();
  for (const v of visits) {
    if (!visitedBy.has(v.userId)) visitedBy.set(v.userId, []);
    visitedBy.get(v.userId).push(v.checkpointId);
  }

  const members = new Map();
  for (const m of trip.members) members.set(m.userId, memberFromDb(m, visitedBy.get(m.userId) || []));

  const { members: _m, checkpoints: _c, ...tripFields } = trip;
  // Real junctions only (not gentle bends): used for "everyone has taken the turn".
  const turns = detectTurns(line, cum).filter((t) => t.type !== "slight");
  const minProgress = Math.min(...[...members.values()].filter((m) => m.lat != null).map((m) => m.progress), Infinity);
  const turnPtr = turns.findIndex((t) => t.along > (Number.isFinite(minProgress) ? minProgress : 0));
  return {
    trip: tripFields,
    line,
    cum,
    total,
    checkpoints,
    members,
    turns,
    turnPtr: turnPtr === -1 ? turns.length : turnPtr,
    gapAlerted: false,
    touchedAt: Date.now(),
  };
}

export async function getContext(tripId) {
  const ctx = contexts.get(tripId);
  if (ctx) {
    ctx.touchedAt = Date.now();
    return ctx;
  }
  if (!loading.has(tripId)) {
    loading.set(
      tripId,
      buildContext(tripId)
        .then((c) => {
          contexts.set(tripId, c);
          return c;
        })
        .finally(() => loading.delete(tripId)),
    );
  }
  return loading.get(tripId);
}

/** Captain = the trip admin or the group leader: the people who run the ride. */
export const isCaptain = (ctx, userId) => userId === ctx.trip.adminId || userId === ctx.trip.leaderId;

/** Send an event to everyone running the ride (admin sockets + the leader's phone). */
export function emitToCaptains(ctx, event, data) {
  emitToTripAdmins(ctx.trip.id, event, data);
  if (ctx.trip.leaderId && ctx.trip.leaderId !== ctx.trip.adminId) emitToUser(ctx.trip.leaderId, event, data);
}

export const CHECKLIST_ITEMS = ["fuel", "documents", "helmet", "tyres", "powerbank", "offlinemap", "emergency"];

/** Drop cached state so the next access reloads from Postgres (after structural edits). */
export function invalidate(tripId) {
  contexts.delete(tripId);
}

/** Patch scalar trip fields (status, leader…) in the cache without a reload. */
export function patchTrip(tripId, fields) {
  const ctx = contexts.get(tripId);
  if (ctx) Object.assign(ctx.trip, fields);
}

export async function addMember(tripId, userId) {
  const ctx = contexts.get(tripId);
  if (!ctx) return; // will be loaded with the member next time
  const m = await prisma.tripMember.findUnique({
    where: { tripId_userId: { tripId, userId } },
    include: { user: { select: { id: true, name: true, vehicleNumber: true } } },
  });
  if (m) ctx.members.set(userId, memberFromDb(m, []));
}

export function dropMember(tripId, userId) {
  contexts.get(tripId)?.members.delete(userId);
}

export function clearAll() {
  contexts.clear();
  online.clear();
}

// ─────────────────────────── Presence ───────────────────────────

const key = (tripId, userId) => `${tripId}:${userId}`;
export const isOnline = (tripId, userId) => (online.get(key(tripId, userId)) || 0) > 0;

export function markOnline(tripId, userId) {
  online.set(key(tripId, userId), (online.get(key(tripId, userId)) || 0) + 1);
}

/** @returns true when this was the user's last socket for the trip */
export function markOffline(tripId, userId) {
  const n = (online.get(key(tripId, userId)) || 1) - 1;
  if (n <= 0) {
    online.delete(key(tripId, userId));
    return true;
  }
  online.set(key(tripId, userId), n);
  return false;
}

// ─────────────────────────── Derived views ───────────────────────────

function plannedSpeedKmh(ctx) {
  const { routeDistance, routeDuration } = ctx.trip;
  return routeDuration > 0 ? (routeDistance / routeDuration) * 3.6 : 40;
}

export function memberStatus(ctx, m, now = Date.now()) {
  if (m.arrivedAt) return "ARRIVED";
  if (
    !isOnline(ctx.trip.id, m.userId) ||
    !m.lastSeenAt ||
    now - m.lastSeenAt > cfg.offlineSeconds * 1000
  ) {
    return "OFFLINE";
  }
  return m.speed >= 2 ? "MOVING" : "STOPPED";
}

function nextCheckpoint(ctx, m) {
  return ctx.checkpoints.find((c) => !m.visited.has(c.id) && c.along >= m.progress - 50) || null;
}

export function serializeMember(ctx, m, now = Date.now()) {
  const leader = ctx.trip.leaderId ? ctx.members.get(ctx.trip.leaderId) : null;
  const remaining = m.arrivedAt ? 0 : Math.max(0, ctx.total - m.progress);
  const basis = m.speedEma > 5 ? m.speedEma : plannedSpeedKmh(ctx);
  const etaSeconds = remaining / (basis / 3.6);
  const next = nextCheckpoint(ctx, m);
  const hasPos = m.lat != null && m.lng != null;

  return {
    userId: m.userId,
    name: m.name,
    vehicleNumber: m.vehicleNumber,
    isLeader: ctx.trip.leaderId === m.userId,
    lat: m.lat,
    lng: m.lng,
    speed: Math.round(m.speed * 10) / 10,
    heading: m.heading,
    battery: m.battery,
    lastSeenAt: m.lastSeenAt,
    status: memberStatus(ctx, m, now),
    online: isOnline(ctx.trip.id, m.userId),
    progress: Math.round(m.progress),
    progressPercent: ctx.total ? Math.min(100, Math.round((m.progress / ctx.total) * 1000) / 10) : 0,
    distanceRemaining: Math.round(remaining),
    distanceFromRoute: Math.round(m.distanceFromRoute || 0),
    etaSeconds: m.arrivedAt || !hasPos ? null : Math.round(etaSeconds),
    eta: m.arrivedAt || !hasPos ? null : new Date(now + etaSeconds * 1000).toISOString(),
    distanceFromLeader:
      leader && hasPos && leader.lat != null && leader !== m
        ? Math.round(haversine([m.lat, m.lng], [leader.lat, leader.lng]))
        : leader === m
          ? 0
          : null,
    arrivedAt: m.arrivedAt,
    checkpointsVisited: [...m.visited],
    nextCheckpointId: next?.id ?? null,
    isSweep: ctx.trip.sweepId === m.userId,
    isAdmin: ctx.trip.adminId === m.userId,
    ready: !!m.ready,
    checklist: m.checklist || {},
    checklistDone: CHECKLIST_ITEMS.filter((k) => m.checklist?.[k]).length,
    checklistTotal: CHECKLIST_ITEMS.length,
    // Roll call at the start, headcount at a group stop
    atStart: hasPos && haversine([m.lat, m.lng], [ctx.trip.startLat, ctx.trip.startLng]) <= 300,
    atMeet:
      hasPos && ctx.trip.meetLat != null ? haversine([m.lat, m.lng], [ctx.trip.meetLat, ctx.trip.meetLng]) <= 200 : false,
    distanceToMeet:
      hasPos && ctx.trip.meetLat != null ? Math.round(haversine([m.lat, m.lng], [ctx.trip.meetLat, ctx.trip.meetLng])) : null,
  };
}

export function convoyStats(ctx, now = Date.now()) {
  const all = [...ctx.members.values()].map((m) => serializeMember(ctx, m, now));
  const arrived = all.filter((m) => m.status === "ARRIVED");
  const offline = all.filter((m) => m.status === "OFFLINE");
  const active = all.filter((m) => m.status === "MOVING" || m.status === "STOPPED");
  const positioned = active.filter((m) => m.lat != null);
  const moving = active.filter((m) => m.status === "MOVING");

  const progresses = positioned.map((m) => m.progress);
  const byspeed = [...moving].sort((a, b) => a.speed - b.speed);
  const pending = all.filter((m) => m.status !== "ARRIVED" && m.lat != null);

  return {
    totalMembers: all.length,
    activeMembers: active.length,
    offlineMembers: offline.length,
    arrivedMembers: arrived.length,
    movingMembers: moving.length,
    convoyLength: progresses.length > 1 ? Math.round(Math.max(...progresses) - Math.min(...progresses)) : 0,
    slowest: byspeed[0] ? { userId: byspeed[0].userId, name: byspeed[0].name, speed: byspeed[0].speed } : null,
    fastest: byspeed.length
      ? { userId: byspeed.at(-1).userId, name: byspeed.at(-1).name, speed: byspeed.at(-1).speed }
      : null,
    averageSpeed: moving.length
      ? Math.round((moving.reduce((s, m) => s + m.speed, 0) / moving.length) * 10) / 10
      : 0,
    // Distance until the *last* member arrives — what an admin actually cares about.
    distanceRemaining: pending.length ? Math.max(...pending.map((m) => m.distanceRemaining)) : 0,
    routeDistance: Math.round(ctx.total),
    generatedAt: now,
  };
}

export function tripView(ctx) {
  const t = ctx.trip;
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    imageUrl: t.imageUrl,
    groupCode: t.groupCode,
    status: t.status,
    vehicleType: t.vehicleType,
    speedLimitKmh: t.speedLimitKmh,
    maxMembers: t.maxMembers,
    departureTime: t.departureTime,
    expectedArrival: t.expectedArrival,
    startedAt: t.startedAt,
    endedAt: t.endedAt,
    adminId: t.adminId,
    adminName: t.admin?.name,
    adminPhone: t.admin?.phone ?? null, // riders can call / SMS the organiser from SOS
    leaderId: t.leaderId,
    sweepId: t.sweepId ?? null,
    gapAlertMeters: t.gapAlertMeters,
    meet: t.meetLat != null ? { lat: t.meetLat, lng: t.meetLng, name: t.meetName, setAt: t.meetSetAt } : null,
    departAt: t.departAt ?? null,
    start: { name: t.startName, lat: t.startLat, lng: t.startLng },
    destination: { name: t.destName, lat: t.destLat, lng: t.destLng },
    waypoints: t.waypoints?.map(({ name, lat, lng, order }) => ({ name, lat, lng, order })) ?? [],
    routeGeometry: ctx.line,
    routeDistance: Math.round(ctx.total),
    routeDuration: t.routeDuration,
    routeProvider: t.routeProvider,
    checkpoints: ctx.checkpoints.map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      lat: c.lat,
      lng: c.lng,
      eta: c.eta,
      order: c.order,
      along: Math.round(c.along),
    })),
  };
}

export async function snapshot(tripId) {
  const ctx = await getContext(tripId);
  const now = Date.now();
  return {
    trip: tripView(ctx),
    members: [...ctx.members.values()].map((m) => serializeMember(ctx, m, now)),
    stats: convoyStats(ctx, now),
  };
}

// ─────────────────────────── Hot path: a GPS ping ───────────────────────────

export async function processLocation(tripId, userId, p) {
  const ctx = await getContext(tripId);
  const { trip } = ctx;
  if (trip.status === "COMPLETED" || trip.status === "CANCELLED") {
    throw ApiError.badRequest("This trip has ended");
  }
  const m = ctx.members.get(userId);
  if (!m) throw ApiError.forbidden("You are not an active member of this trip");

  const now = Date.now();
  const pos = [p.lat, p.lng];

  // Speed: trust the device's GNSS speed; otherwise derive from displacement.
  let speed = p.speed;
  if (speed == null) {
    if (m.lat != null && m.lastSeenAt && now > m.lastSeenAt) {
      const dt = (now - m.lastSeenAt) / 1000;
      // Pings closer than 2 s apart turn GPS jitter into absurd speeds; keep the last value.
      speed = dt >= 2 ? (haversine([m.lat, m.lng], pos) / dt) * 3.6 : m.speed;
    } else speed = 0;
  }
  speed = Math.min(Math.max(speed, 0), 400);

  // Progress along route, preferring the neighbourhood of the last known progress.
  const hadPos = m.lat != null;
  const prevProgress = m.progress;
  let proj = hadPos
    ? projectOnLine(pos, ctx.line, ctx.cum, { min: m.progress - 3000, max: m.progress + 15000 })
    : projectOnLine(pos, ctx.line, ctx.cum);
  if (proj.distance > cfg.offRouteMeters) {
    const global = projectOnLine(pos, ctx.line, ctx.cum);
    if (global.distance < proj.distance) proj = global;
  }

  // Stationary tracking (anchor resets once the member moves > 30 m)
  if (!m.anchor || haversine(m.anchor, pos) > 30) {
    m.anchor = pos;
    m.stationarySince = null;
  } else if (m.stationarySince == null) {
    m.stationarySince = now;
  }

  Object.assign(m, {
    lat: p.lat,
    lng: p.lng,
    speed,
    heading: p.heading ?? m.heading,
    battery: p.battery ?? m.battery,
    accuracy: p.accuracy ?? null,
    lastSeenAt: now,
    distanceFromRoute: proj.distance,
    progress: proj.along,
    maxProgress: Math.max(m.maxProgress, proj.along),
    speedEma: m.speedEma * 0.7 + speed * 0.3,
  });
  m.flags.offline = false;

  // Sliding 2-minute window: "wrong way" means backtracking *recently*, not ever being
  // behind your all-time furthest point (e.g. after turning back to help someone).
  m.history.push({ t: now, p: m.progress });
  while (m.history.length && now - m.history[0].t > 120000) m.history.shift();
  m.recentMax = Math.max(...m.history.map((h) => h.p));

  const events = [];

  // Arrival
  if (!m.arrivedAt && haversine(pos, [trip.destLat, trip.destLng]) <= cfg.arrivalMeters) {
    m.arrivedAt = now;
    m.progress = ctx.total;
    m.maxProgress = ctx.total;
    events.push({ type: "arrived", userId, name: m.name });
  }

  // Checkpoints
  const newVisits = [];
  for (const c of ctx.checkpoints) {
    if (m.visited.has(c.id)) continue;
    const near = haversine(pos, [c.lat, c.lng]) <= cfg.checkpointMeters;
    // Sparse pings at highway speed can jump right over the radius: also count an
    // on-route checkpoint as visited when the member's progress crossed it.
    const passed =
      hadPos &&
      c.offset <= cfg.checkpointMeters &&
      proj.distance <= cfg.offRouteMeters &&
      c.along > prevProgress &&
      c.along <= m.progress;
    if (near || passed) {
      m.visited.add(c.id);
      newVisits.push(c);
      events.push({ type: "checkpoint", userId, name: m.name, checkpointId: c.id, checkpointName: c.name });
    }
  }

  // Persist on a throttle (or immediately for meaningful events)
  if (events.length || now - m.lastPersistAt >= cfg.pingPersistSeconds * 1000) {
    m.lastPersistAt = now;
    await prisma.$transaction([
      prisma.locationPing.create({
        data: {
          tripId,
          userId,
          lat: p.lat,
          lng: p.lng,
          speed,
          heading: p.heading ?? null,
          accuracy: p.accuracy ?? null,
          battery: p.battery ?? null,
        },
      }),
      prisma.tripMember.update({
        where: { tripId_userId: { tripId, userId } },
        data: {
          lastLat: p.lat,
          lastLng: p.lng,
          lastSpeed: speed,
          lastHeading: p.heading ?? null,
          battery: m.battery,
          lastSeenAt: new Date(now),
          progressMeters: m.progress,
          maxProgressMeters: m.maxProgress,
          arrivedAt: m.arrivedAt ? new Date(m.arrivedAt) : null,
        },
      }),
      ...(newVisits.length
        ? [
            prisma.checkpointVisit.createMany({
              data: newVisits.map((c) => ({ tripId, userId, checkpointId: c.id })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);
  }

  const specs = evaluateLocation(trip, m);
  const alerts = [];
  for (const spec of specs) {
    const a = await raiseAlert(tripId, spec, m, { captainId: trip.leaderId, adminId: trip.adminId });
    if (a) alerts.push(a);
  }

  return { member: serializeMember(ctx, m, now), events, alerts, ctx };
}

// ─────────────────────────── Background sweeper ───────────────────────────

let sweepTimer = null;

export async function sweep(now = Date.now()) {
  for (const [tripId, ctx] of contexts) {
    // Evict idle trips (no one connected for 30 min) to bound memory.
    const anyoneOnline = [...ctx.members.keys(), ctx.trip.adminId].some((u) => isOnline(tripId, u));
    if (!anyoneOnline && now - ctx.touchedAt > 30 * 60 * 1000) {
      contexts.delete(tripId);
      continue;
    }
    if (!["PLANNED", "ACTIVE", "PAUSED"].includes(ctx.trip.status)) continue;

    // Individual rider alerts only while the convoy is actually moving.
    for (const m of ctx.trip.status === "ACTIVE" ? ctx.members.values() : []) {
      if (m.arrivedAt || m.lastSeenAt == null) continue;

      if (now - m.lastSeenAt > cfg.offlineSeconds * 1000 && !m.flags.offline) {
        m.flags.offline = true;
        await raiseAlert(
          tripId,
          {
            type: "OFFLINE",
            message: `${m.name} lost connection (last seen ${Math.round((now - m.lastSeenAt) / 1000)} s ago)`,
            data: { lastSeenAt: m.lastSeenAt },
          },
          m,
        );
      }

      if (
        m.stationarySince &&
        now - m.stationarySince > cfg.stationaryMinutes * 60 * 1000 &&
        isOnline(tripId, m.userId)
      ) {
        // Waiting at a planned checkpoint or the captain's meet pin is expected, not an alert.
        const atCheckpoint =
          ctx.checkpoints.some((c) => m.lat != null && haversine([m.lat, m.lng], [c.lat, c.lng]) <= cfg.checkpointMeters) ||
          (ctx.trip.meetLat != null && m.lat != null && haversine([m.lat, m.lng], [ctx.trip.meetLat, ctx.trip.meetLng]) <= 250);
        if (!atCheckpoint) {
          const secs = Math.round((now - m.stationarySince) / 1000);
          const label = secs >= 60 ? `${Math.round(secs / 60)} min` : `${secs} s`;
          await raiseAlert(
            tripId,
            {
              type: "STATIONARY",
              message: `${m.name} has been stationary for ${label}`,
              data: { seconds: secs },
            },
            m,
          );
        }
      }
    }

    await groupSafety(ctx, now);

    // Periodic refresh so statuses (e.g. MOVING → OFFLINE) update without new pings.
    const members = [...ctx.members.values()].map((m) => serializeMember(ctx, m, now));
    emitToTrip(tripId, "members:update", members);
    emitToTripAdmins(tripId, "convoy:stats", convoyStats(ctx, now));
  }
}

/**
 * Group-safety checks that only make sense for the convoy as a whole:
 *  • gap alerts — a rider has fallen too far behind the leader
 *  • "behind the sweep" — someone is behind the tail rider (nobody is watching them)
 *  • "everyone has taken the turn" — the last rider has passed a junction
 *  • stop housekeeping — clear the meet pin a few minutes after the countdown ends
 */
export async function groupSafety(ctx, now = Date.now()) {
  const { trip } = ctx;
  const riders = [...ctx.members.values()].filter(
    (m) => m.lat != null && !m.arrivedAt && isOnline(trip.id, m.userId) && now - (m.lastSeenAt || 0) < cfg.offlineSeconds * 1000,
  );
  const captain = { captainId: trip.leaderId, adminId: trip.adminId };

  if (trip.status === "ACTIVE" && riders.length > 1) {
    const leader = trip.leaderId ? ctx.members.get(trip.leaderId) : null;
    const ref = leader && riders.includes(leader) ? leader.progress : Math.max(...riders.map((m) => m.progress));
    const limit = trip.gapAlertMeters || 1500;
    let maxGap = 0;
    for (const m of riders) {
      if (m.userId === trip.leaderId) continue;
      const gap = ref - m.progress;
      maxGap = Math.max(maxGap, gap);
      if (gap > limit) {
        const km = (gap / 1000).toFixed(1);
        await raiseAlert(
          trip.id,
          {
            type: "GAP",
            message: `${m.name} is ${km} km behind the group`,
            notice: `You're falling behind — the group is ${km} km ahead. Catch up safely or tap "Need a stop".`,
            data: { gapMeters: Math.round(gap) },
          },
          m,
          captain,
        );
        ctx.gapAlerted = true;
      }
    }
    if (ctx.gapAlerted && maxGap < limit / 2) {
      ctx.gapAlerted = false;
      emitToCaptains(ctx, "group:together", { tripId: trip.id, spreadMeters: Math.round(maxGap) });
    }

    // Nobody should ride behind the sweep.
    const sweep = trip.sweepId ? ctx.members.get(trip.sweepId) : null;
    if (sweep && riders.includes(sweep)) {
      for (const m of riders) {
        if (m === sweep || sweep.progress - m.progress < 300) continue;
        await raiseAlert(
          trip.id,
          { type: "GAP", key: "sweep", message: `${m.name} is behind the sweep (${sweep.name})`, data: { behindSweepMeters: Math.round(sweep.progress - m.progress) } },
          m,
          captain,
        );
      }
    }

    // Last rider has passed a junction → the whole group took the turn.
    const tail = Math.min(...riders.map((m) => m.progress));
    while (ctx.turnPtr < ctx.turns.length && ctx.turns[ctx.turnPtr].along < tail - 30) {
      const t = ctx.turns[ctx.turnPtr++];
      emitToCaptains(ctx, "convoy:turn-cleared", {
        tripId: trip.id,
        km: Math.round(t.along / 100) / 10,
        side: t.side,
        bySweep: !!sweep,
      });
    }
  }

  // Housekeeping: a stop ends a few minutes after its departure countdown.
  if (trip.departAt && now > new Date(trip.departAt).getTime() + 5 * 60 * 1000) {
    const data = { meetLat: null, meetLng: null, meetName: null, meetSetAt: null, departAt: null };
    await prisma.trip.update({ where: { id: trip.id }, data });
    Object.assign(trip, data);
    emitToTrip(trip.id, "trip:meet", { tripId: trip.id, meet: null });
    emitToTrip(trip.id, "trip:depart", { tripId: trip.id, departAt: null });
  }
}

export function startSweeper() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    sweep().catch((e) => console.error("[sweeper]", e));
  }, cfg.sweepIntervalSeconds * 1000);
  sweepTimer.unref?.();
}

export function stopSweeper() {
  clearInterval(sweepTimer);
  sweepTimer = null;
}
