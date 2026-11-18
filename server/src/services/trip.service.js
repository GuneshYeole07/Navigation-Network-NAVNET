import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { generateGroupCode, hashPassword, signInvite, verifyInvite, verifyPassword } from "../utils/security.js";
import { getRoute } from "./routing.service.js";
import * as live from "./live.service.js";
import { emitToTrip, emitToUser, evictUserFromTrip } from "../socket/emitter.js";
import { createSystemMessage } from "./message.service.js";
import { generateReport } from "./analytics.service.js";
import { tripChanged } from "./webhook.service.js";

const PROFILE_BY_VEHICLE = { BICYCLE: "cycling", WALKING: "walking" };

const tripListSelect = {
  id: true,
  groupCode: true,
  name: true,
  description: true,
  imageUrl: true,
  status: true,
  startName: true,
  destName: true,
  routeDistance: true,
  departureTime: true,
  expectedArrival: true,
  vehicleType: true,
  maxMembers: true,
  createdAt: true,
  _count: { select: { members: { where: { status: "ACTIVE" } } } },
};

// ─────────────────────────── Create ───────────────────────────

export async function createTrip(adminId, input) {
  if (input.communityId) {
    const c = await prisma.community.findUnique({ where: { id: input.communityId } });
    if (!c || c.ownerId !== adminId) throw ApiError.badRequest("You can only link trips to your own communities");
  }

  // Route: trust a client-previewed route if supplied, otherwise compute server-side.
  let route = input.route;
  if (!route) {
    const coords = [
      [input.start.lat, input.start.lng],
      ...input.waypoints.map((w) => [w.lat, w.lng]),
      [input.destination.lat, input.destination.lng],
    ];
    route = await getRoute(coords, PROFILE_BY_VEHICLE[input.vehicleType] || "driving");
  }

  let groupCode = input.groupCode;
  if (groupCode) {
    const taken = await prisma.trip.findUnique({ where: { groupCode } });
    if (taken) throw ApiError.conflict("That Group ID is already in use. Pick another.");
  } else {
    do groupCode = generateGroupCode();
    while (await prisma.trip.findUnique({ where: { groupCode } }));
  }

  const trip = await prisma.trip.create({
    data: {
      groupCode,
      passwordHash: await hashPassword(input.groupPassword),
      name: input.name,
      description: input.description,
      imageUrl: input.imageUrl || null,
      adminId,
      communityId: input.communityId || null,
      startName: input.start.name,
      startLat: input.start.lat,
      startLng: input.start.lng,
      destName: input.destination.name,
      destLat: input.destination.lat,
      destLng: input.destination.lng,
      routeGeometry: route.geometry,
      routeDistance: route.distance,
      routeDuration: route.duration,
      routeProvider: route.provider || "osrm",
      maxMembers: input.maxMembers,
      vehicleType: input.vehicleType,
      speedLimitKmh: input.speedLimitKmh,
      // How far behind counts as "lost the group": tighter for cycles and walks.
      gapAlertMeters: input.gapAlertMeters ?? ({ BICYCLE: 800, WALKING: 300 }[input.vehicleType] || 1500),
      departureTime: input.departureTime,
      expectedArrival: input.expectedArrival,
      waypoints: { create: input.waypoints.map((w, i) => ({ ...w, order: i })) },
      checkpoints: {
        create: input.checkpoints.map((c, i) => ({
          name: c.name,
          category: c.category,
          lat: c.lat,
          lng: c.lng,
          eta: c.eta || null,
          order: i,
        })),
      },
    },
    select: tripListSelect,
  });
  return trip;
}

// ─────────────────────────── Read ───────────────────────────

export function listAdminTrips(adminId) {
  return prisma.trip.findMany({
    where: { adminId },
    orderBy: [{ status: "asc" }, { departureTime: "desc" }],
    select: tripListSelect,
  });
}

export async function listJoinedTrips(userId) {
  const rows = await prisma.tripMember.findMany({
    where: { userId, status: "ACTIVE", trip: { status: { in: ["PLANNED", "ACTIVE", "PAUSED"] } } },
    orderBy: { joinedAt: "desc" },
    select: { joinedAt: true, trip: { select: tripListSelect } },
  });
  return rows.map((r) => ({ ...r.trip, joinedAt: r.joinedAt }));
}

/** Throws unless the user is this trip's admin or an ACTIVE member. Returns their role. */
export async function assertTripAccess(tripId, user) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { id: true, adminId: true, status: true, name: true } });
  if (!trip) throw ApiError.notFound("Trip not found");
  if (trip.adminId === user.id) return { trip, isAdmin: true };
  const m = await prisma.tripMember.findUnique({
    where: { tripId_userId: { tripId, userId: user.id } },
    select: { status: true },
  });
  if (!m || m.status !== "ACTIVE") throw ApiError.forbidden("You are not a member of this trip");
  return { trip, isAdmin: false };
}

export async function assertTripAdmin(tripId, user) {
  const { trip, isAdmin } = await assertTripAccess(tripId, user).catch((e) => {
    throw e.status === 403 ? ApiError.forbidden("Only the trip admin can do that") : e;
  });
  if (!isAdmin) throw ApiError.forbidden("Only the trip admin can do that");
  return trip;
}

export async function getTripSnapshot(tripId, user) {
  const { isAdmin } = await assertTripAccess(tripId, user);
  const snap = await live.snapshot(tripId);
  if (!isAdmin) delete snap.trip.groupCode; // members already know it; no need to echo
  return { ...snap, role: isAdmin ? "ADMIN" : "MEMBER" };
}

// ─────────────────────────── Join ───────────────────────────

export async function joinTrip(user, { groupCode, password, invite, vehicleNumber }) {
  let trip;
  if (invite) {
    let tripId;
    try {
      tripId = verifyInvite(invite);
    } catch {
      throw ApiError.forbidden("This invite link is invalid or has expired. Ask the admin for a new one.");
    }
    trip = await prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) throw ApiError.notFound("This trip no longer exists");
  } else {
    trip = await prisma.trip.findUnique({ where: { groupCode } });
    // Identical message for wrong ID or wrong password: don't confirm which Group IDs exist.
    // 403, not 401: the user's own session is fine, and clients treat 401 as "log out".
    if (!trip || !(await verifyPassword(password, trip.passwordHash))) {
      throw ApiError.forbidden("Invalid Group ID or password");
    }
  }
  if (trip.status === "COMPLETED" || trip.status === "CANCELLED") {
    throw ApiError.badRequest("This trip has already ended");
  }
  if (trip.adminId === user.id) throw ApiError.badRequest("You are the admin of this trip");

  const existing = await prisma.tripMember.findUnique({
    where: { tripId_userId: { tripId: trip.id, userId: user.id } },
  });
  if (existing?.status === "REMOVED") throw ApiError.forbidden("You were removed from this trip by the admin");

  if (existing?.status !== "ACTIVE") {
    const count = await prisma.tripMember.count({ where: { tripId: trip.id, status: "ACTIVE" } });
    if (count >= trip.maxMembers) throw ApiError.conflict("This trip is full");

    await prisma.tripMember.upsert({
      where: { tripId_userId: { tripId: trip.id, userId: user.id } },
      update: { status: "ACTIVE", vehicleNumber: vehicleNumber || user.vehicleNumber || null },
      create: { tripId: trip.id, userId: user.id, vehicleNumber: vehicleNumber || user.vehicleNumber || null },
    });

    // First rider in becomes leader until the admin says otherwise.
    if (!trip.leaderId) {
      await prisma.trip.update({ where: { id: trip.id }, data: { leaderId: user.id } });
      live.patchTrip(trip.id, { leaderId: user.id });
    }
    await live.addMember(trip.id, user.id);
    await createSystemMessage(trip.id, user.id, `${user.name} joined the trip`);
    emitToTrip(trip.id, "member:joined", { userId: user.id, name: user.name });
  }
  return { tripId: trip.id, name: trip.name, status: trip.status };
}

// ─────────────────────────── Admin controls ───────────────────────────

const TRANSITIONS = {
  start: { from: ["PLANNED"], to: "ACTIVE", msg: "The trip has started. Ride safe!" },
  pause: { from: ["ACTIVE"], to: "PAUSED", msg: "The admin paused the trip." },
  resume: { from: ["PAUSED"], to: "ACTIVE", msg: "The trip has resumed." },
  end: { from: ["ACTIVE", "PAUSED", "PLANNED"], to: "COMPLETED", msg: "The trip has ended. Thanks for riding with NavNet!" },
  cancel: { from: ["PLANNED", "ACTIVE", "PAUSED"], to: "CANCELLED", msg: "The trip was cancelled by the admin." },
};

export async function changeStatus(tripId, admin, action) {
  const trip = await assertTripAdmin(tripId, admin);
  const t = TRANSITIONS[action];
  if (!t.from.includes(trip.status)) {
    throw ApiError.badRequest(`Cannot ${action} a trip that is ${trip.status.toLowerCase()}`);
  }
  const now = new Date();
  const data = { status: t.to };
  if (action === "start") data.startedAt = now;
  if (action === "pause") data.pausedAt = now;
  if (action === "resume") data.pausedAt = null;
  if (action === "end" || action === "cancel") data.endedAt = now;

  const updated = await prisma.trip.update({ where: { id: tripId }, data });
  live.patchTrip(tripId, data);

  await createSystemMessage(tripId, admin.id, t.msg, "ANNOUNCEMENT");
  emitToTrip(tripId, "trip:status", { tripId, status: t.to, action, at: now.toISOString() });

  let report = null;
  if (action === "end") {
    // The trip has already ended; a failed summary is rebuilt when the report is opened.
    report = await generateReport(tripId).catch((e) => {
      console.error(`[report] trip ${tripId}: ${e.message}`);
      return null;
    });
    emitToTrip(tripId, "trip:report", { tripId });
  }
  if (action === "end" || action === "cancel") live.invalidate(tripId);
  tripChanged(tripId, action, report);
  return { status: updated.status, report };
}

export async function setLeader(tripId, admin, userId) {
  await assertTripAdmin(tripId, admin);
  const m = await prisma.tripMember.findUnique({
    where: { tripId_userId: { tripId, userId } },
    include: { user: { select: { name: true } } },
  });
  if (!m || m.status !== "ACTIVE") throw ApiError.badRequest("Leader must be an active member");
  await prisma.trip.update({ where: { id: tripId }, data: { leaderId: userId } });
  live.patchTrip(tripId, { leaderId: userId });
  await createSystemMessage(tripId, admin.id, `${m.user.name} is now the group leader`, "ANNOUNCEMENT");
  emitToTrip(tripId, "trip:leader", { tripId, leaderId: userId, name: m.user.name });
  return { leaderId: userId };
}

export async function removeMember(tripId, admin, userId) {
  const trip = await assertTripAdmin(tripId, admin);
  const m = await prisma.tripMember.findUnique({
    where: { tripId_userId: { tripId, userId } },
    include: { user: { select: { name: true } } },
  });
  if (!m || m.status !== "ACTIVE") throw ApiError.notFound("Member not found in this trip");

  await prisma.tripMember.update({ where: { id: m.id }, data: { status: "REMOVED" } });
  live.dropMember(tripId, userId);

  // Hand leadership to the longest-standing remaining member.
  const full = await prisma.trip.findUnique({ where: { id: tripId }, select: { leaderId: true } });
  if (full.leaderId === userId) {
    const next = await prisma.tripMember.findFirst({
      where: { tripId, status: "ACTIVE" },
      orderBy: { joinedAt: "asc" },
    });
    await prisma.trip.update({ where: { id: tripId }, data: { leaderId: next?.userId ?? null } });
    live.patchTrip(tripId, { leaderId: next?.userId ?? null });
    emitToTrip(tripId, "trip:leader", { tripId, leaderId: next?.userId ?? null });
  }

  emitToUser(userId, "member:removed", { tripId, tripName: trip.name });
  evictUserFromTrip(tripId, userId);
  emitToTrip(tripId, "member:left", { userId, name: m.user.name, reason: "removed" });
  await createSystemMessage(tripId, admin.id, `${m.user.name} was removed from the trip`);
  return { removed: userId };
}

export async function leaveTrip(tripId, user) {
  const m = await prisma.tripMember.findUnique({ where: { tripId_userId: { tripId, userId: user.id } } });
  if (!m || m.status !== "ACTIVE") throw ApiError.notFound("You are not in this trip");
  await prisma.tripMember.update({ where: { id: m.id }, data: { status: "LEFT" } });
  live.dropMember(tripId, user.id);
  evictUserFromTrip(tripId, user.id);
  emitToTrip(tripId, "member:left", { userId: user.id, name: user.name, reason: "left" });
  await createSystemMessage(tripId, user.id, `${user.name} left the trip`);
  return { left: true };
}

/** Invite link token for the trip admin to share (valid until a day after expected arrival). */
export async function createInvite(tripId, admin) {
  const trip = await assertTripAdmin(tripId, admin);
  const full = await prisma.trip.findUnique({ where: { id: tripId }, select: { expectedArrival: true, groupCode: true, name: true } });
  if (trip.status === "COMPLETED" || trip.status === "CANCELLED") throw ApiError.badRequest("This trip has ended");
  const until = new Date(full.expectedArrival.getTime() + 24 * 3600 * 1000);
  return { token: signInvite(tripId, until), expiresAt: until, groupCode: full.groupCode, name: full.name };
}

/** Riders' phone numbers, for the admin only (one-tap "Call rider"). Never broadcast to the group. */
export async function listContacts(tripId, admin) {
  // The admin, or the group leader riding as captain, needs to reach riders and see emergency cards.
  const { trip, isAdmin } = await assertTripAccess(tripId, admin);
  if (!isAdmin) {
    const t = await prisma.trip.findUnique({ where: { id: trip.id }, select: { leaderId: true } });
    if (t.leaderId !== admin.id) throw ApiError.forbidden("Only the ride captain can see contacts");
  }
  const rows = await prisma.tripMember.findMany({
    where: { tripId, status: "ACTIVE" },
    orderBy: { joinedAt: "asc" },
    select: {
      userId: true,
      vehicleNumber: true,
      user: { select: { name: true, phone: true, bloodGroup: true, emergencyName: true, emergencyPhone: true, medicalNotes: true } },
    },
  });
  return rows.map(({ userId, vehicleNumber, user }) => ({ userId, vehicleNumber, ...user }));
}

// ─────────────────────────── Alerts ───────────────────────────

export async function listAlerts(tripId, admin) {
  await assertTripAdmin(tripId, admin);
  const rows = await prisma.alert.findMany({
    where: { tripId },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { user: { select: { name: true } } },
  });
  return rows.map(({ user, ...a }) => ({ ...a, userName: user?.name ?? null }));
}

export async function acknowledgeAlert(alertId, admin) {
  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) throw ApiError.notFound("Alert not found");
  await assertTripAdmin(alert.tripId, admin);
  const updated = await prisma.alert.update({
    where: { id: alertId },
    data: { acknowledgedAt: alert.acknowledgedAt ?? new Date() },
  });
  if (alert.type === "SOS" && alert.userId) {
    emitToUser(alert.userId, "sos:acknowledged", {
      tripId: alert.tripId,
      alertId,
      by: admin.name,
      at: updated.acknowledgedAt,
    });
  }
  return updated;
}

export async function getReport(tripId, user) {
  const { trip } = await assertTripAccess(tripId, user);
  const existing = await prisma.tripReport.findUnique({ where: { tripId } });
  if (existing) return { ...existing.summary, final: true, generatedAt: existing.generatedAt };
  // Finished but never saved (e.g. saving failed when the trip ended): save it now.
  if (trip.status === "COMPLETED") {
    const saved = await generateReport(tripId);
    return { ...saved, final: true, generatedAt: new Date() };
  }
  // Live preview for trips still in progress (not persisted).
  return { ...(await generateReport(tripId, { persist: false })), final: false };
}
