/**
 * Thin emit facade so services (REST or socket-driven) can push real-time events
 * without importing the Socket.IO server directly. In tests io may be unset → no-ops.
 *
 * Rooms:
 *   trip:<id>        everyone in the trip (members + admin)
 *   trip:<id>:admin  the trip's admin sockets only
 *   user:<id>        every socket of one user (multi-tab / multi-device)
 */
let io = null;

export const setIo = (instance) => {
  io = instance;
};
export const getIo = () => io;

export const rooms = {
  trip: (tripId) => `trip:${tripId}`,
  tripAdmin: (tripId) => `trip:${tripId}:admin`,
  user: (userId) => `user:${userId}`,
};

export const emitToTrip = (tripId, event, data) => io?.to(rooms.trip(tripId)).emit(event, data);
export const emitToTripAdmins = (tripId, event, data) =>
  io?.to(rooms.tripAdmin(tripId)).emit(event, data);
/**
 * A rider's new position: the admins' live map gets it at once; riders get everyone's
 * moves in one `members:update` per second. With N riders each sending every 3 s, per-fix
 * fan-out to every phone grows as N² (300 riders = 30,000 messages/s); this caps it at one
 * message per phone per second, whatever the group size.
 */
const pendingMoves = new Map(); // tripId -> Map(userId -> member)
let flushTimer = null;
export function broadcastLocation(tripId, member) {
  if (!io) return;
  io.to(rooms.tripAdmin(tripId)).emit("member:location", member);
  if (!pendingMoves.has(tripId)) pendingMoves.set(tripId, new Map());
  pendingMoves.get(tripId).set(member.userId, member);
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      for (const [id, moves] of pendingMoves) {
        io?.to(rooms.trip(id)).except(rooms.tripAdmin(id)).emit("members:update", [...moves.values()]);
      }
      pendingMoves.clear();
    }, 1000);
    flushTimer.unref?.();
  }
}

export const emitToUser = (userId, event, data) => io?.to(rooms.user(userId)).emit(event, data);

/** Remove every socket of a user from a trip's rooms (used when a member is removed). */
export const evictUserFromTrip = (tripId, userId) => {
  io?.in(rooms.user(userId)).socketsLeave([rooms.trip(tripId), rooms.tripAdmin(tripId)]);
};
