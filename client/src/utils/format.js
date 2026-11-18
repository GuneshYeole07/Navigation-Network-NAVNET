export function formatDistance(m) {
  if (m == null || Number.isNaN(m)) return "—";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

export function formatDuration(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h === 0) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const formatSpeed = (kmh) => (kmh == null ? "—" : `${Math.round(kmh)} km/h`);

export function formatClock(date) {
  if (!date) return "—";
  return new Date(date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatDateTime(date) {
  if (!date) return "—";
  return new Date(date).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function timeAgo(date, now = Date.now()) {
  if (!date) return "never";
  const s = Math.round((now - new Date(date).getTime()) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const initials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("") || "?";

/** Stable, readable colour per member for map markers. */
const PALETTE = ["#0E6B4E", "#1F6FB2", "#7A4BC2", "#C2541F", "#0F8A8A", "#9C2F6B", "#4E7A1F", "#B2771F"];
export function memberColor(id = "") {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
