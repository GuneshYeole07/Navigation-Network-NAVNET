/**
 * Outgoing webhooks: NavNet tells an automation tool (n8n, Zapier, Make, your own server)
 * what happened, and that tool does the rest: WhatsApp/SMS the emergency contact, post to
 * a Telegram group, log the ride in Google Sheets…
 *
 *   N8N_WEBHOOK_URL     where to POST (comma-separated for several)
 *   N8N_WEBHOOK_SECRET  signs every body: X-NavNet-Signature: sha256=<HMAC-SHA256(body)>
 *
 * Events: alert.raised (every alert, SOS and possible crash included), trip.started,
 * trip.ended (with the ride summary), rider.arrived. Delivery never blocks or breaks riding:
 * it happens in the background, with 3 retries, and a failure is only logged.
 */
import crypto from "node:crypto";
import { prisma } from "../database/prisma.js";
import { env } from "../config/env.js";

const RETRY_MS = [1000, 5000, 30000];
/** Alerts where the rider's emergency card goes along, so the automation can call for help. */
const EMERGENCY = new Set(["SOS", "POSSIBLE_CRASH"]);

const urls = () =>
  String(env.webhookUrl || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const webhooksEnabled = () => urls().length > 0;

export function sign(body, secret = env.webhookSecret) {
  return `sha256=${crypto.createHmac("sha256", secret || "").update(body).digest("hex")}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function deliver(url, event, body, id) {
  for (let attempt = 0; attempt <= RETRY_MS.length; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "NavNet-Webhooks/1.0",
          "X-NavNet-Event": event,
          "X-NavNet-Delivery": id, // same id on every retry: let the receiver drop duplicates
          "X-NavNet-Signature": sign(body),
        },
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return true;
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        console.warn(`[webhook] ${event} → ${url}: HTTP ${res.status}, not retrying`);
        return false;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (attempt === RETRY_MS.length) {
        console.warn(`[webhook] ${event} → ${url} failed: ${e.message}`);
        return false;
      }
      await sleep(env.isTest ? 50 : RETRY_MS[attempt]);
    }
  }
  return false;
}

/** Fire and forget. Returns a promise only so tests can await delivery. */
export function sendEvent(event, data) {
  if (!webhooksEnabled()) return Promise.resolve([]);
  const id = crypto.randomUUID();
  const body = JSON.stringify({ id, event, sentAt: new Date().toISOString(), ...data });
  return Promise.all(urls().map((u) => deliver(u, event, body, id))).catch(() => []);
}

const mapLink = (lat, lng) => (lat != null && lng != null ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}` : null);

async function tripInfo(tripId) {
  const t = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      id: true,
      name: true,
      status: true,
      leaderId: true,
      admin: { select: { id: true, name: true, phone: true } },
      leader: { select: { id: true, name: true, phone: true } },
    },
  });
  if (!t) return null;
  const captain = t.leader ?? t.admin;
  return {
    trip: { id: t.id, name: t.name, status: t.status },
    captain: captain ? { id: captain.id, name: captain.name, phone: captain.phone } : null,
    organiser: t.admin ? { id: t.admin.id, name: t.admin.name, phone: t.admin.phone } : null,
  };
}

async function riderInfo(userId, emergency) {
  if (!userId) return null;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, phone: true, vehicleNumber: true, bloodGroup: true, emergencyName: true, emergencyPhone: true },
  });
  if (!u) return null;
  const rider = { id: u.id, name: u.name, phone: u.phone, vehicleNumber: u.vehicleNumber };
  // The emergency card only travels with SOS / possible crash, never with routine alerts.
  if (emergency) rider.emergencyCard = { bloodGroup: u.bloodGroup, contactName: u.emergencyName, contactPhone: u.emergencyPhone };
  return rider;
}

export function alertRaised(alert) {
  if (!webhooksEnabled()) return;
  (async () => {
    const emergency = EMERGENCY.has(alert.type);
    const [t, rider] = await Promise.all([tripInfo(alert.tripId), riderInfo(alert.userId, emergency)]);
    if (!t) return;
    await sendEvent("alert.raised", {
      ...t,
      rider,
      alert: {
        id: alert.id,
        type: alert.type,
        severity: alert.severity,
        emergency,
        message: alert.message,
        lat: alert.lat,
        lng: alert.lng,
        mapLink: mapLink(alert.lat, alert.lng),
        data: alert.data ?? null,
        createdAt: alert.createdAt,
      },
    });
  })().catch((e) => console.warn(`[webhook] alert.raised: ${e.message}`));
}

export function tripChanged(tripId, action, report = null) {
  if (!webhooksEnabled() || !["start", "end", "cancel"].includes(action)) return;
  const event = action === "start" ? "trip.started" : action === "end" ? "trip.ended" : "trip.cancelled";
  (async () => {
    const t = await tripInfo(tripId);
    if (!t) return;
    const summary = report
      ? {
          distanceKm: report.totalDistanceKm,
          durationMinutes: Math.round((report.travelDurationSeconds || 0) / 60),
          averageSpeedKmh: report.averageSpeedKmh,
          maxSpeedKmh: report.maxSpeedKmh,
          stops: report.totalStops,
          ridersArrived: report.membersArrived,
          riders: report.membersTotal,
          sosCount: report.emergencyEvents?.length ?? 0,
          alertsByType: report.alertsByType,
        }
      : null;
    await sendEvent(event, { ...t, summary });
  })().catch((e) => console.warn(`[webhook] ${event}: ${e.message}`));
}

export function riderArrived(tripId, userId) {
  if (!webhooksEnabled()) return;
  (async () => {
    const [t, rider] = await Promise.all([tripInfo(tripId), riderInfo(userId, false)]);
    if (t) await sendEvent("rider.arrived", { ...t, rider });
  })().catch((e) => console.warn(`[webhook] rider.arrived: ${e.message}`));
}
