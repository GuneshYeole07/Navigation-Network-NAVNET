/**
 * Smart monitoring rules. Pure-ish: `evaluateLocation` inspects a live member record and
 * returns alert specs; `raiseAlert` applies per-(member, type) cooldowns, persists the alert
 * and pushes it to the trip admin in real time.
 */
import { prisma } from "../database/prisma.js";
import { env } from "../config/env.js";
import { emitToTripAdmins, emitToUser } from "../socket/emitter.js";
import { alertRaised } from "./webhook.service.js";

const cfg = env.monitoring;
const cooldowns = new Map(); // `${tripId}:${userId}:${type}` -> last raised ms

const SEVERITY = {
  SOS: "CRITICAL",
  OFF_ROUTE: "WARNING",
  STATIONARY: "WARNING",
  OFFLINE: "WARNING",
  LOW_BATTERY: "INFO",
  OVERSPEED: "WARNING",
  WRONG_DIRECTION: "WARNING",
  GAP: "WARNING",
  STOP_REQUEST: "INFO",
  // Raised by the Python safety monitor (analytics/app/safety.py).
  POSSIBLE_CRASH: "CRITICAL",
  UNUSUAL_MOVEMENT: "WARNING",
  WEAK_GPS: "INFO",
};

export const SAFETY_TYPES = new Set(["POSSIBLE_CRASH", "UNUSUAL_MOVEMENT", "WEAK_GPS"]);

/** Alerts the riding captain (group leader) also receives on their phone, not just the admin. */
const CAPTAIN_TYPES = new Set(["SOS", "GAP", "STOP_REQUEST", "POSSIBLE_CRASH"]);
const COOLDOWN_SECONDS = { STOP_REQUEST: 60, GAP: 180, POSSIBLE_CRASH: 600, UNUSUAL_MOVEMENT: 900, WEAK_GPS: 900 };

/** Messages also shown to the rider themselves (not just the admin). */
const RIDER_NOTICE = {
  OFF_ROUTE: "You appear to be off the planned route.",
  OVERSPEED: "Slow down — you're above the group speed limit.",
  WRONG_DIRECTION: "You seem to be heading the wrong way.",
  LOW_BATTERY: "Battery below 20%. Consider charging to stay tracked.",
};

export function resetCooldowns() {
  cooldowns.clear();
}

/**
 * @param {object} trip   { id, status, speedLimitKmh }
 * @param {object} m      live member record (after this ping was applied)
 * @returns {Array<{type, message, data}>}
 */
export function evaluateLocation(trip, m) {
  const out = [];

  // Battery is tracked whenever the member is sharing location.
  if (m.battery != null) {
    if (m.battery < cfg.lowBatteryPercent && !m.flags.lowBattery) {
      m.flags.lowBattery = true;
      out.push({
        type: "LOW_BATTERY",
        message: `${m.name}'s battery is at ${m.battery}%`,
        data: { battery: m.battery },
      });
    } else if (m.battery >= cfg.lowBatteryPercent + 5) {
      m.flags.lowBattery = false;
    }
  }

  // Route / speed rules only apply while the convoy is actually moving.
  if (trip.status !== "ACTIVE" || m.arrivedAt) return out;

  if (m.distanceFromRoute > cfg.offRouteMeters) {
    m.offRouteStreak += 1;
    // Two consecutive pings: filters single GPS spikes.
    if (m.offRouteStreak >= 2) {
      out.push({
        type: "OFF_ROUTE",
        message: `${m.name} is ${Math.round(m.distanceFromRoute)} m off the planned route`,
        data: { distanceFromRoute: Math.round(m.distanceFromRoute) },
      });
    }
  } else {
    m.offRouteStreak = 0;
  }

  if (m.speed > trip.speedLimitKmh) {
    out.push({
      type: "OVERSPEED",
      message: `${m.name} is at ${Math.round(m.speed)} km/h (limit ${trip.speedLimitKmh})`,
      data: { speed: Math.round(m.speed), limit: trip.speedLimitKmh },
    });
  }

  if (
    m.speed > 5 &&
    m.distanceFromRoute <= cfg.offRouteMeters &&
    (m.recentMax ?? m.maxProgress) - m.progress > cfg.wrongDirectionMeters
  ) {
    out.push({
      type: "WRONG_DIRECTION",
      message: `${m.name} is moving away from the destination`,
      data: { backtrackedMeters: Math.round((m.recentMax ?? m.maxProgress) - m.progress) },
    });
  }

  return out;
}

/**
 * Persist + broadcast an alert, unless the same alert fired for this member recently.
 * SOS bypasses the cooldown — every press must reach the admin.
 */
export async function raiseAlert(tripId, spec, member, { captainId = null, adminId = null } = {}) {
  const key = `${tripId}:${member?.userId ?? "trip"}:${spec.type}${spec.key ? `:${spec.key}` : ""}`;
  const now = Date.now();
  if (spec.type !== "SOS") {
    const last = cooldowns.get(key);
    const cd = COOLDOWN_SECONDS[spec.type] ?? cfg.alertCooldownSeconds;
    if (last && now - last < cd * 1000) return null;
  }
  cooldowns.set(key, now);

  const alert = await prisma.alert.create({
    data: {
      tripId,
      userId: member?.userId ?? null,
      type: spec.type,
      severity: SEVERITY[spec.type] || "WARNING",
      message: spec.message,
      data: spec.data ?? undefined,
      lat: member?.lat ?? spec.lat ?? null,
      lng: member?.lng ?? spec.lng ?? null,
    },
  });

  const payload = { ...alert, userName: member?.name ?? null };
  alertRaised(alert);
  const event = spec.type === "SOS" ? "sos:alert" : "alert:new";
  emitToTripAdmins(tripId, event, payload);
  // The riding captain (leader) gets group-safety alerts on their phone too.
  if (captainId && captainId !== adminId && CAPTAIN_TYPES.has(spec.type) && captainId !== member?.userId) {
    emitToUser(captainId, event, payload);
  }

  const notice = spec.notice ?? RIDER_NOTICE[spec.type];
  if (member && notice) {
    emitToUser(member.userId, "notification", {
      tripId,
      level: "warning",
      title: spec.type.replace("_", " "),
      message: notice,
    });
  }
  return payload;
}
