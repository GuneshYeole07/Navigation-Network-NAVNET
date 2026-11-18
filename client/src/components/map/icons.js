import { CHECKPOINT_CATEGORIES } from "../../utils/constants";
import { initials, memberColor } from "../../utils/format";

/** Same shape as Leaflet's divIcon options; rendered by components/map/gl.jsx. */
const divIcon = (o) => ({ className: "nn-marker", ...o });

const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const STATUS_RING = { MOVING: null, STOPPED: "#F2B705", OFFLINE: "#8A9499", ARRIVED: "#1F6FB2" };

const ago = (s) => (s < 90 ? `${Math.round(s)}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`);

export function memberIcon(m, { self = false, staleS = 0 } = {}) {
  // "Last seen" tag once a rider's GPS has been quiet for 20 s+, so nobody mistakes an old dot for a live one.
  const stale = staleS >= 20 && staleS !== Infinity && m.status !== "ARRIVED";
  const tag = stale ? `<span class="nn-stale">${ago(staleS)} ago</span>` : "";
  const color = m.status === "OFFLINE" ? "#8A9499" : memberColor(m.userId);
  const ring = STATUS_RING[m.status];
  const heading =
    m.heading != null && m.status === "MOVING"
      ? `<svg class="nn-heading" viewBox="0 0 54 54" style="transform:rotate(${m.heading}deg)"><path d="M27 1 L33 10 L21 10 Z" fill="${color}"/></svg>`
      : "";
  const classes = ["nn-member", self && "is-self", m.isLeader && "is-leader", m.isSweep && "is-sweep"].filter(Boolean).join(" ");
  return divIcon({
    className: "nn-marker",
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18],
    html: `<div style="position:relative;display:grid;place-items:center">${heading}${m.isLeader ? '<span class="crown">👑</span>' : ""}${tag}<div class="${classes}${stale ? " is-stale" : ""}" style="background:${color};${ring ? `box-shadow:0 0 0 3px ${ring},0 3px 10px rgba(0,0,0,.35)` : ""}">${esc(initials(m.name))}</div></div>`,
  });
}

/** Faded, dashed marker for where a quiet rider probably is now. */
export function ghostIcon(m, ageS) {
  const color = memberColor(m.userId);
  return divIcon({
    className: "nn-marker",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15],
    html: `<div class="nn-ghost" style="border-color:${color};color:${color}" title="Estimated, no GPS for ${ageS}s">${esc(initials(m.name))}</div>`,
  });
}

export function checkpointIcon(category, visited = false) {
  const c = CHECKPOINT_CATEGORIES[category] || CHECKPOINT_CATEGORIES.OTHER;
  return divIcon({
    className: "nn-marker",
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16],
    html: `<div class="nn-pin ${visited ? "visited" : ""}" style="background:${c.color}">${c.emoji}</div>`,
  });
}

export function endpointIcon(kind) {
  const start = kind === "start";
  return divIcon({
    className: "nn-marker",
    iconSize: start ? [22, 22] : [30, 40],
    iconAnchor: start ? [11, 11] : [15, 38],
    html: start
      ? '<div style="width:22px;height:22px;border-radius:50%;background:#fff;border:6px solid #0E6B4E;box-shadow:0 2px 6px rgba(0,0,0,.3)"></div>'
      : '<svg width="30" height="40" viewBox="0 0 30 40"><path d="M15 39C15 39 2 23 2 14a13 13 0 0 1 26 0c0 9-13 25-13 25z" fill="#D7263D" stroke="#fff" stroke-width="2"/><circle cx="15" cy="14" r="5" fill="#fff"/></svg>',
  });
}

export function waypointIcon(n) {
  return divIcon({
    className: "nn-marker",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    html: `<div style="width:24px;height:24px;border-radius:50%;background:#1C2226;color:#fff;display:grid;place-items:center;font:700 12px 'Barlow Condensed';border:2px solid #fff">${n}</div>`,
  });
}

/** Captain's "meet here" pin, or a personal target (fuel pump, friend in trouble). */
export function targetIcon(kind = "meet") {
  const bg = kind === "sos" ? "#D7263D" : kind === "meet" ? "#F2B705" : "#1F6FB2";
  const glyph = kind === "sos" ? "!" : kind === "meet" ? "⚑" : kind === "fuel" ? "⛽" : kind === "hospital" ? "✚" : kind === "mechanic" ? "🔧" : "●";
  return divIcon({
    className: "nn-marker",
    iconSize: [36, 46],
    iconAnchor: [18, 44],
    html: `<svg width="36" height="46" viewBox="0 0 36 46"><path d="M18 45S3 27 3 17a15 15 0 0 1 30 0c0 10-15 28-15 28z" fill="${bg}" stroke="#1C2226" stroke-width="2"/></svg><span style="position:absolute;left:0;top:6px;width:36px;text-align:center;font:700 16px 'Barlow Condensed',sans-serif;color:${kind === "meet" ? "#1C2226" : "#fff"}">${glyph}</span>`,
  });
}
