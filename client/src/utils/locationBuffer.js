/**
 * Positions recorded while the phone has no connection, kept on the phone and uploaded
 * in batches when the signal comes back, so the group's track has no gaps (ghats, tunnels).
 */
const MAX_POINTS = 2000; // ~2.7 h at one point every 5 s
const MIN_SPACING_MS = 5000;

const key = (tripId) => `navnet-locbuf-${tripId}`;

function read(tripId) {
  try {
    return JSON.parse(localStorage.getItem(key(tripId))) || [];
  } catch {
    return [];
  }
}

function write(tripId, points) {
  try {
    if (points.length) localStorage.setItem(key(tripId), JSON.stringify(points));
    else localStorage.removeItem(key(tripId));
  } catch {
    /* storage full / private mode: keep going without the buffer */
  }
}

export function bufferPosition(tripId, p) {
  const points = read(tripId);
  const last = points[points.length - 1];
  if (last && p.recordedAt - last.recordedAt < MIN_SPACING_MS) return points.length;
  points.push(p);
  if (points.length > MAX_POINTS) {
    // Too long offline: thin out the oldest half (keep every other point) instead of losing the end.
    const half = Math.floor(points.length / 2);
    points.splice(0, half, ...points.slice(0, half).filter((_, i) => i % 2 === 0));
  }
  write(tripId, points);
  return points.length;
}

export const bufferedCount = (tripId) => read(tripId).length;

/** Upload everything buffered, oldest first, in chunks. Stops (keeping the rest) on failure. */
export async function flushPositions(tripId, emit, chunk = 200) {
  let sent = 0;
  for (;;) {
    const points = read(tripId);
    if (!points.length) return sent;
    const batch = points.slice(0, chunk);
    await emit("location:batch", { points: batch }); // throws on timeout → retried on next reconnect
    write(tripId, read(tripId).slice(batch.length));
    sent += batch.length;
  }
}
