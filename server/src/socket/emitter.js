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
export const emitToUser = (userId, event, data) => io?.to(rooms.user(userId)).emit(event, data);

/** Remove every socket of a user from a trip's rooms (used when a member is removed). */
export const evictUserFromTrip = (tripId, userId) => {
  io?.in(rooms.user(userId)).socketsLeave([rooms.trip(tripId), rooms.tripAdmin(tripId)]);
};
