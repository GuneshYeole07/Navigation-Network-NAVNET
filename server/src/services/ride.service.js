/**
 * The ride captain's toolkit — things a real ride leader does on the road:
 * ride along as captain, ready checks, "meet here" pins, departure countdowns,
 * appointing a sweep, handling stop requests, and the pre-ride checklist.
 * Captain = the trip admin or the current group leader.
 */
import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { haversine } from "../utils/geo.js";
import * as live from "./live.service.js";
import { raiseAlert } from "./monitoring.service.js";
import { createSystemMessage } from "./message.service.js";
import { emitToTrip, emitToUser } from "../socket/emitter.js";
import { assertTripAdmin } from "./trip.service.js";

const OPEN = ["PLANNED", "ACTIVE", "PAUSED"];

async function captainContext(tripId, user) {
  const ctx = await live.getContext(tripId);
  if (!live.isCaptain(ctx, user.id)) throw ApiError.forbidden("Only the ride captain (admin or group leader) can do that");
  if (!OPEN.includes(ctx.trip.status)) throw ApiError.badRequest("This trip has ended");
  return ctx;
}

async function memberContext(tripId, user) {
  const ctx = await live.getContext(tripId);
  const m = ctx.members.get(user.id);
  if (!m) throw ApiError.forbidden("You are not riding in this trip");
  return { ctx, m };
}

function broadcastMember(ctx, m) {
  emitToTrip(ctx.trip.id, "member:status", live.serializeMember(ctx, m));
}

// ───────────── Admin rides along as captain ─────────────

export async function rideAsCaptain(tripId, admin) {
  const trip = await assertTripAdmin(tripId, admin);
  if (!OPEN.includes(trip.status)) throw ApiError.badRequest("This trip has ended");
  const user = await prisma.user.findUnique({ where: { id: admin.id }, select: { vehicleNumber: true } });
  await prisma.tripMember.upsert({
    where: { tripId_userId: { tripId, userId: admin.id } },
    update: { status: "ACTIVE" },
    create: { tripId, userId: admin.id, vehicleNumber: user.vehicleNumber },
  });
  // The captain leads from the front.
  await prisma.trip.update({ where: { id: tripId }, data: { leaderId: admin.id } });
  live.patchTrip(tripId, { leaderId: admin.id });
  await live.addMember(tripId, admin.id);
  emitToTrip(tripId, "trip:leader", { tripId, leaderId: admin.id, name: admin.name });
  emitToTrip(tripId, "member:joined", { userId: admin.id, name: admin.name });
  return { riding: true };
}

// ───────────── Sweep (tail rider) ─────────────

export async function setSweep(tripId, actor, userId) {
  const ctx = await captainContext(tripId, actor);
  let name = null;
  if (userId) {
    const m = ctx.members.get(userId);
    if (!m) throw ApiError.badRequest("The sweep must be a rider in this trip");
    name = m.name;
  }
  await prisma.trip.update({ where: { id: tripId }, data: { sweepId: userId || null } });
  live.patchTrip(tripId, { sweepId: userId || null });
  emitToTrip(tripId, "trip:sweep", { tripId, sweepId: userId || null, name });
  if (name) await createSystemMessage(tripId, actor.id, `${name} is the sweep (rides last, keeps the group together)`, "ANNOUNCEMENT");
  return { sweepId: userId || null };
}

// ───────────── Ready check & roll call ─────────────

export async function readyCheck(tripId, actor) {
  const ctx = await captainContext(tripId, actor);
  await prisma.tripMember.updateMany({ where: { tripId, status: "ACTIVE" }, data: { readyAt: null } });
  for (const m of ctx.members.values()) m.ready = m.userId === actor.id; // captain is ready by asking
  if (ctx.members.has(actor.id)) {
    await prisma.tripMember.update({ where: { tripId_userId: { tripId, userId: actor.id } }, data: { readyAt: new Date() } });
  }
  emitToTrip(tripId, "ready:check", { tripId, by: actor.name, at: new Date().toISOString() });
  emitToTrip(tripId, "members:update", [...ctx.members.values()].map((m) => live.serializeMember(ctx, m)));
  return { asked: ctx.members.size };
}

export async function setReady(tripId, user, ready = true) {
  const { ctx, m } = await memberContext(tripId, user);
  await prisma.tripMember.update({ where: { tripId_userId: { tripId, userId: user.id } }, data: { readyAt: ready ? new Date() : null } });
  m.ready = ready;
  broadcastMember(ctx, m);
  const all = [...ctx.members.values()];
  const readyCount = all.filter((x) => x.ready).length;
  if (ready && readyCount === all.length) live.emitToCaptains(ctx, "ready:all", { tripId, count: readyCount });
  return { ready, readyCount, total: all.length };
}

// ───────────── Pre-ride checklist ─────────────

export async function setChecklist(tripId, user, items) {
  const { ctx, m } = await memberContext(tripId, user);
  const clean = Object.fromEntries(live.CHECKLIST_ITEMS.map((k) => [k, !!items[k]]));
  await prisma.tripMember.update({ where: { tripId_userId: { tripId, userId: user.id } }, data: { checklist: clean } });
  m.checklist = clean;
  broadcastMember(ctx, m);
  return clean;
}

// ───────────── Group stops: meet pin + departure countdown ─────────────

export async function setMeet(tripId, actor, { lat, lng, name }) {
  const ctx = await captainContext(tripId, actor);
  const label = (name || "").trim() || "Group stop";
  const data = { meetLat: lat, meetLng: lng, meetName: label.slice(0, 80), meetSetAt: new Date(), departAt: null };
  await prisma.trip.update({ where: { id: tripId }, data });
  live.patchTrip(tripId, data);
  const meet = { lat, lng, name: data.meetName, setAt: data.meetSetAt };
  emitToTrip(tripId, "trip:meet", { tripId, meet, by: actor.name });
  emitToTrip(tripId, "trip:depart", { tripId, departAt: null });
  await createSystemMessage(tripId, actor.id, `Group stop: ${data.meetName}. Everyone meet there.`, "ANNOUNCEMENT");
  return meet;
}

export async function clearMeet(tripId, actor) {
  await captainContext(tripId, actor);
  const data = { meetLat: null, meetLng: null, meetName: null, meetSetAt: null, departAt: null };
  await prisma.trip.update({ where: { id: tripId }, data });
  live.patchTrip(tripId, data);
  emitToTrip(tripId, "trip:meet", { tripId, meet: null, by: actor.name });
  emitToTrip(tripId, "trip:depart", { tripId, departAt: null });
  return { cleared: true };
}

export async function setDepart(tripId, actor, minutes) {
  await captainContext(tripId, actor);
  const departAt = minutes ? new Date(Date.now() + minutes * 60 * 1000) : null;
  await prisma.trip.update({ where: { id: tripId }, data: { departAt } });
  live.patchTrip(tripId, { departAt });
  emitToTrip(tripId, "trip:depart", { tripId, departAt, by: actor.name, minutes });
  if (minutes) await createSystemMessage(tripId, actor.id, `Leaving in ${minutes} min`, "ANNOUNCEMENT");
  return { departAt };
}

// ───────────── Rider asks for a stop ─────────────

const STOP_LABEL = { FUEL: "fuel", TOILET: "a toilet break", TIRED: "a rest (tired)", BIKE: "a stop (bike issue)", FOOD: "food", OTHER: "a stop" };

export async function requestStop(tripId, user, { reason, lat, lng }) {
  const { ctx, m } = await memberContext(tripId, user);
  const alert = await raiseAlert(
    tripId,
    {
      type: "STOP_REQUEST",
      message: `${m.name} needs ${STOP_LABEL[reason] || "a stop"}`,
      data: { reason },
      lat: lat ?? m.lat,
      lng: lng ?? m.lng,
    },
    { ...m, lat: lat ?? m.lat, lng: lng ?? m.lng },
    { captainId: ctx.trip.leaderId, adminId: ctx.trip.adminId },
  );
  if (!alert) throw ApiError.badRequest("Stop already requested — the captain has it. Try again in a minute.");
  return { sent: true };
}

// ───────────── SOS: get the nearest friends moving too ─────────────

/** Leader, sweep and the two closest riders get the SOS location to help, not just the admin. */
export function notifyHelpers(ctx, victimId, { lat, lng, emergencyType, name }) {
  const others = [...ctx.members.values()].filter((m) => m.userId !== victimId && m.lat != null);
  const byDistance = others
    .map((m) => ({ m, d: haversine([m.lat, m.lng], [lat, lng]) }))
    .sort((a, b) => a.d - b.d);
  const helpers = new Map();
  for (const { m, d } of byDistance.slice(0, 2)) helpers.set(m.userId, d);
  for (const id of [ctx.trip.leaderId, ctx.trip.sweepId]) {
    const hit = byDistance.find((x) => x.m.userId === id);
    if (hit) helpers.set(id, hit.d);
  }
  for (const [userId, d] of helpers) {
    emitToUser(userId, "sos:nearby", { tripId: ctx.trip.id, userId: victimId, name, lat, lng, emergencyType, distance: Math.round(d) });
  }
  return [...helpers.keys()];
}
