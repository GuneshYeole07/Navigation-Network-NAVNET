import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { emitToTrip, emitToUser } from "../socket/emitter.js";

const include = { sender: { select: { id: true, name: true, role: true } } };

const shape = ({ sender, ...m }) => ({
  ...m,
  senderName: sender?.name ?? "NavNet",
  senderRole: sender?.role ?? "SYSTEM",
});

async function resolveRoles(tripId, userId) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { adminId: true, status: true } });
  if (!trip) throw ApiError.notFound("Trip not found");
  if (trip.adminId === userId) return { trip, isAdmin: true };
  const m = await prisma.tripMember.findUnique({ where: { tripId_userId: { tripId, userId } } });
  if (!m || m.status !== "ACTIVE") throw ApiError.forbidden("You are not a member of this trip");
  return { trip, isAdmin: false };
}

/**
 * Group chat: recipientId null → everyone in the trip.
 * Private chat: strictly admin ↔ member (members cannot DM each other).
 */
export async function sendMessage(tripId, sender, { body, recipientId }) {
  const { trip, isAdmin } = await resolveRoles(tripId, sender.id);
  if (trip.status === "CANCELLED") throw ApiError.badRequest("This trip was cancelled");

  if (recipientId) {
    if (recipientId === sender.id) throw ApiError.badRequest("You cannot message yourself");
    if (isAdmin) {
      const m = await prisma.tripMember.findUnique({
        where: { tripId_userId: { tripId, userId: recipientId } },
      });
      if (!m || m.status !== "ACTIVE") throw ApiError.badRequest("Recipient is not in this trip");
    } else if (recipientId !== trip.adminId) {
      throw ApiError.forbidden("Private messages can only be sent to the trip admin");
    }
  }

  const msg = shape(
    await prisma.message.create({
      data: { tripId, senderId: sender.id, recipientId: recipientId || null, body, type: "CHAT" },
      include,
    }),
  );

  if (recipientId) {
    emitToUser(sender.id, "chat:message", msg);
    emitToUser(recipientId, "chat:message", msg);
  } else {
    emitToTrip(tripId, "chat:message", msg);
  }
  return msg;
}

/** Push-to-talk clip (≤ 20 s). Same visibility rules as text: group, or admin ↔ member. */
export async function sendVoice(tripId, sender, { file, durationMs, recipientId }) {
  if (!file) throw ApiError.badRequest("Attach the recording in the 'audio' field");
  const { trip, isAdmin } = await resolveRoles(tripId, sender.id);
  if (trip.status === "CANCELLED") throw ApiError.badRequest("This trip was cancelled");
  if (recipientId && !isAdmin && recipientId !== trip.adminId) throw ApiError.forbidden("Private messages can only be sent to the trip admin");
  const secs = Math.max(1, Math.round((durationMs || 0) / 1000));
  const msg = shape(
    await prisma.message.create({
      data: {
        tripId,
        senderId: sender.id,
        recipientId: recipientId || null,
        type: "VOICE",
        body: `🎙 Voice message (${secs}s)`,
        audioUrl: `/uploads/voice/${file.filename}`,
        durationMs: Math.min(20000, Math.round(durationMs || 0)),
      },
      include,
    }),
  );
  if (recipientId) {
    emitToUser(sender.id, "chat:message", msg);
    emitToUser(recipientId, "chat:message", msg);
  } else emitToTrip(tripId, "chat:message", msg);
  return msg;
}

export async function broadcast(tripId, admin, body) {
  const { isAdmin } = await resolveRoles(tripId, admin.id);
  if (!isAdmin) throw ApiError.forbidden("Only the trip admin can broadcast");
  const msg = shape(
    await prisma.message.create({
      data: { tripId, senderId: admin.id, body, type: "ANNOUNCEMENT" },
      include,
    }),
  );
  emitToTrip(tripId, "chat:message", msg);
  emitToTrip(tripId, "announcement", msg);
  return msg;
}

/** System line in group chat ("Asha joined", "Trip paused"…). Never throws. */
export async function createSystemMessage(tripId, actorId, body, type = "SYSTEM") {
  try {
    const msg = shape(
      await prisma.message.create({ data: { tripId, senderId: actorId, body, type }, include }),
    );
    emitToTrip(tripId, "chat:message", msg);
    if (type === "ANNOUNCEMENT") emitToTrip(tripId, "announcement", msg);
    return msg;
  } catch (e) {
    console.error("[message] system message failed", e.message);
    return null;
  }
}

export async function listMessages(tripId, user, { scope, with: other, before, limit }) {
  const { trip, isAdmin } = await resolveRoles(tripId, user.id);
  let where;
  if (scope === "private") {
    const peer = isAdmin ? other : trip.adminId;
    if (!peer) throw ApiError.badRequest("Specify ?with=<userId> for a private thread");
    where = {
      tripId,
      OR: [
        { senderId: user.id, recipientId: peer },
        { senderId: peer, recipientId: user.id },
      ],
    };
  } else {
    where = { tripId, recipientId: null };
  }
  if (before) where.createdAt = { lt: before };

  const rows = await prisma.message.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include,
  });
  return rows.reverse().map(shape);
}

/** Admin inbox: last private message per member + unread-ish count (messages since admin's last reply). */
export async function privateThreads(tripId, admin) {
  const { isAdmin } = await resolveRoles(tripId, admin.id);
  if (!isAdmin) throw ApiError.forbidden();
  const rows = await prisma.message.findMany({
    where: { tripId, recipientId: { not: null } },
    orderBy: { createdAt: "desc" },
    include,
  });
  const threads = new Map();
  for (const r of rows) {
    const peer = r.senderId === admin.id ? r.recipientId : r.senderId;
    if (!threads.has(peer)) threads.set(peer, { userId: peer, last: shape(r), count: 0 });
    threads.get(peer).count += 1;
  }
  return [...threads.values()];
}
