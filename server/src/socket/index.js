/**
 * Socket.IO gateway.
 *
 * Client → server (all accept an ack callback → { ok, data | error }):
 *   trip:join        { tripId }                       → snapshot
 *   trip:leave       { tripId }
 *   location:update  { tripId, lat, lng, speed?, heading?, accuracy?, battery? }
 *   chat:send        { tripId, body, recipientId? }
 *   sos:trigger      { tripId, lat, lng, speed?, battery?, emergencyType, note? }
 *
 * Server → client:
 *   member:location (admins, every fix), members:update (riders, batched 1/s), member:status, member:joined, member:left,
 *   member:removed, convoy:stats, chat:message, announcement, alert:new, sos:alert,
 *   sos:broadcast, sos:acknowledged, trip:status, trip:leader, trip:report,
 *   checkpoint:visited, member:arrived, notification
 */
import { Server } from "socket.io";
import { z } from "zod";
import { isAllowedOrigin, isSameOrigin } from "../utils/origin.js";
import { prisma } from "../database/prisma.js";
import { verifyToken } from "../utils/security.js";
import {
  departSchema,
  locationPayloadSchema,
  locationBatchSchema,
  meetSchema,
  messageSchema,
  readySchema,
  sosPayloadSchema,
  stopRequestSchema,
  sweepSchema,
} from "../validation/schemas.js";
import * as ride from "../services/ride.service.js";
import { broadcastLocation, emitToTrip, emitToTripAdmins, rooms, setIo } from "./emitter.js";
import * as live from "../services/live.service.js";
import { raiseAlert } from "../services/monitoring.service.js";
import { sendMessage } from "../services/message.service.js";
import { assertTripAccess } from "../services/trip.service.js";

const tripIdSchema = z.object({ tripId: z.uuid() });

/** Wrap a handler so every event gets a consistent ack and never crashes the socket. */
const handle = (fn) => async (payload, ack) => {
  const reply = typeof ack === "function" ? ack : () => {};
  try {
    reply({ ok: true, data: await fn(payload ?? {}) });
  } catch (err) {
    if (!err.status || err.status >= 500) console.error("[socket]", err);
    reply({ ok: false, error: err.status && err.status < 500 ? err.message : "Something went wrong" });
  }
};

function parse(schema, payload) {
  const r = schema.safeParse(payload);
  if (!r.success) {
    const e = new Error(r.error.issues[0]?.message || "Invalid payload");
    e.status = 400;
    throw e;
  }
  return r.data;
}

const statsThrottle = new Map(); // tripId -> last emit ms
function maybeEmitStats(tripId, ctx) {
  const now = Date.now();
  if (now - (statsThrottle.get(tripId) || 0) < 2000) return;
  statsThrottle.set(tripId, now);
  emitToTripAdmins(tripId, "convoy:stats", live.convoyStats(ctx, now));
}

export function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: (origin, cb) => cb(null, isAllowedOrigin(origin) ? origin || true : false), credentials: true },
    // Same-origin (served by this server, or via a dev proxy/tunnel) is always allowed.
    allowRequest: (req, cb) => {
      const { origin } = req.headers;
      const host = req.headers["x-forwarded-host"] || req.headers.host;
      cb(null, isAllowedOrigin(origin) || isSameOrigin(origin, host));
    },
    pingInterval: 10000,
    pingTimeout: 20000,
  });

  // ── Auth handshake: JWT in socket.handshake.auth.token ──
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("unauthorized"));
      const payload = verifyToken(token);
      if (!payload.sub || payload.typ) return next(new Error("unauthorized"));
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, name: true, role: true },
      });
      if (!user) return next(new Error("unauthorized"));
      socket.data.user = user;
      socket.data.trips = new Map(); // tripId -> isAdmin
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const user = socket.data.user;
    socket.join(rooms.user(user.id));

    // Lightweight per-socket flood control.
    let lastLocationAt = 0;
    const chatTimes = [];

    /** Join the trip's rooms (after verifying access) if this socket hasn't yet. */
    const joinRooms = async (tripId) => {
      if (socket.data.trips.has(tripId)) return socket.data.trips.get(tripId);
      const { isAdmin } = await assertTripAccess(tripId, user);
      socket.data.trips.set(tripId, isAdmin);
      socket.join(rooms.trip(tripId));
      if (isAdmin) socket.join(rooms.tripAdmin(tripId));
      live.markOnline(tripId, user.id);
      return isAdmin;
    };

    // Events can race ahead of "trip:join" right after a reconnect (e.g. a rider's queued
    // SOS or chat flushing the instant signal returns). Auto-join instead of rejecting.
    const requireJoined = (tripId) => joinRooms(tripId);

    socket.on(
      "trip:join",
      handle(async (payload) => {
        const { tripId } = parse(tripIdSchema, payload);
        const isAdmin = await joinRooms(tripId);
        const snap = await live.snapshot(tripId);
        if (!isAdmin) {
          const ctx = await live.getContext(tripId);
          const m = ctx.members.get(user.id);
          if (m) emitToTrip(tripId, "member:status", live.serializeMember(ctx, m));
          delete snap.trip.groupCode;
        }
        return { ...snap, role: isAdmin ? "ADMIN" : "MEMBER" };
      }),
    );

    socket.on(
      "trip:leave",
      handle(async (payload) => {
        const { tripId } = parse(tripIdSchema, payload);
        leaveRoom(tripId);
        return { left: tripId };
      }),
    );

    socket.on(
      "location:update",
      handle(async (payload) => {
        const { tripId } = parse(tripIdSchema, payload);
        const isAdmin = await requireJoined(tripId);
        if (isAdmin) {
          // An admin riding as captain is also a member; one watching from a desk is not.
          const ctx0 = await live.getContext(tripId);
          if (!ctx0.members.has(user.id)) return { ignored: "admin location is not tracked" };
        }
        const now = Date.now();
        if (now - lastLocationAt < 1000) return { throttled: true };
        lastLocationAt = now;

        const loc = parse(locationPayloadSchema, payload);
        const { member, events, ctx, ignored } = await live.processLocation(tripId, user.id, loc);
        if (ignored) return { ignored };

        broadcastLocation(tripId, member);
        for (const ev of events) {
          if (ev.type === "arrived") emitToTrip(tripId, "member:arrived", { tripId, ...ev });
          if (ev.type === "checkpoint") emitToTrip(tripId, "checkpoint:visited", { tripId, ...ev });
        }
        maybeEmitStats(tripId, ctx);
        return { member };
      }),
    );

    // Positions the phone saved while it had no signal (tunnel, ghat, dead zone).
    let lastBatchAt = 0;
    socket.on(
      "location:batch",
      handle(async (payload) => {
        const { tripId } = parse(tripIdSchema, payload);
        await requireJoined(tripId);
        const now = Date.now();
        if (now - lastBatchAt < 500) {
          const e = new Error("Too many uploads, slow down");
          e.status = 429;
          throw e;
        }
        lastBatchAt = now;
        const { points } = parse(locationBatchSchema, payload);
        const { stored, received, live: res } = await live.processBatch(tripId, user.id, points);
        if (res && !res.ignored) {
          broadcastLocation(tripId, res.member);
          for (const ev of res.events) {
            if (ev.type === "arrived") emitToTrip(tripId, "member:arrived", { tripId, ...ev });
            if (ev.type === "checkpoint") emitToTrip(tripId, "checkpoint:visited", { tripId, ...ev });
          }
          maybeEmitStats(tripId, res.ctx);
        }
        return { stored, received };
      }),
    );

    socket.on(
      "chat:send",
      handle(async (payload) => {
        const { tripId } = parse(tripIdSchema, payload);
        await requireJoined(tripId);
        const now = Date.now();
        while (chatTimes.length && now - chatTimes[0] > 5000) chatTimes.shift();
        if (chatTimes.length >= 6) {
          const e = new Error("You're sending messages too fast");
          e.status = 429;
          throw e;
        }
        chatTimes.push(now);
        const msg = parse(messageSchema, payload);
        return sendMessage(tripId, user, msg);
      }),
    );

    socket.on(
      "sos:trigger",
      handle(async (payload) => {
        const { tripId } = parse(tripIdSchema, payload);
        await requireJoined(tripId);
        const sos = parse(sosPayloadSchema, payload);
        const ctx = await live.getContext(tripId);
        const m = ctx.members.get(user.id);
        if (!m) {
          const e = new Error("You are not an active member of this trip");
          e.status = 403;
          throw e;
        }

        // Update position too, so the admin map jumps to the latest fix. Never block SOS on it.
        try {
          await live.processLocation(tripId, user.id, sos);
        } catch {
          /* trip may be ended/paused; the alert still goes out */
        }

        const timestamp = new Date().toISOString();
        // Emergency card travels with the SOS: the first question anyone helping will ask.
        const card = await prisma.user.findUnique({
          where: { id: user.id },
          select: { phone: true, bloodGroup: true, emergencyName: true, emergencyPhone: true, medicalNotes: true },
        });
        const alert = await raiseAlert(
          tripId,
          {
            type: "SOS",
            message: `SOS from ${user.name}: ${sos.emergencyType.toLowerCase()}`,
            data: {
              userName: user.name,
              emergencyType: sos.emergencyType,
              note: sos.note ?? null,
              speed: sos.speed ?? m.speed ?? null,
              battery: sos.battery ?? m.battery ?? null,
              timestamp,
              lat: sos.lat,
              lng: sos.lng,
              riderPhone: card?.phone ?? null,
              bloodGroup: card?.bloodGroup ?? null,
              emergencyName: card?.emergencyName ?? null,
              emergencyPhone: card?.emergencyPhone ?? null,
              medicalNotes: card?.medicalNotes ?? null,
            },
          },
          { ...m, lat: sos.lat, lng: sos.lng },
          { captainId: ctx.trip.leaderId, adminId: ctx.trip.adminId },
        );
        // The nearest friends, the leader and the sweep get directions to help.
        const helpers = ride.notifyHelpers(ctx, user.id, { lat: sos.lat, lng: sos.lng, emergencyType: sos.emergencyType, name: user.name });

        socket
          .to(rooms.trip(tripId))
          .except([rooms.tripAdmin(tripId), ...helpers.map((id) => rooms.user(id))])
          .emit("sos:broadcast", {
          tripId,
          userId: user.id,
          name: user.name,
          emergencyType: sos.emergencyType,
          lat: sos.lat,
          lng: sos.lng,
          at: timestamp,
        });
        return { alertId: alert.id, at: timestamp };
      }),
    );

    // ── Ride captain & group riding ──
    const captainEvent = (name, schema, fn) =>
      socket.on(
        name,
        handle(async (payload) => {
          const { tripId } = parse(tripIdSchema, payload);
          await requireJoined(tripId);
          return fn(tripId, schema ? parse(schema, payload) : payload);
        }),
      );

    captainEvent("ready:check", null, (tripId) => ride.readyCheck(tripId, user));
    captainEvent("ready:set", readySchema, (tripId, p) => ride.setReady(tripId, user, p.ready));
    captainEvent("meet:set", meetSchema, (tripId, p) => ride.setMeet(tripId, user, p));
    captainEvent("meet:clear", null, (tripId) => ride.clearMeet(tripId, user));
    captainEvent("depart:set", departSchema, (tripId, p) => ride.setDepart(tripId, user, p.minutes));
    captainEvent("sweep:set", sweepSchema, (tripId, p) => ride.setSweep(tripId, user, p.userId));
    captainEvent("stop:request", stopRequestSchema, (tripId, p) => ride.requestStop(tripId, user, p));

    function leaveRoom(tripId) {
      if (!socket.data.trips.has(tripId)) return;
      const isAdmin = socket.data.trips.get(tripId);
      socket.data.trips.delete(tripId);
      socket.leave(rooms.trip(tripId));
      socket.leave(rooms.tripAdmin(tripId));
      const last = live.markOffline(tripId, user.id);
      if (last && !isAdmin) {
        live
          .getContext(tripId)
          .then((ctx) => {
            const m = ctx.members.get(user.id);
            if (m) emitToTrip(tripId, "member:status", live.serializeMember(ctx, m));
          })
          .catch(() => {});
      }
    }

    socket.on("disconnect", () => {
      for (const tripId of [...socket.data.trips.keys()]) leaveRoom(tripId);
    });
  });

  setIo(io);
  live.startSweeper();
  return io;
}
