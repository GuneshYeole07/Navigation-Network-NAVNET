/**
 * Endpoints for NavNet's own services (not the apps). Authenticated with the shared
 * ANALYTICS_KEY in the X-Analytics-Key header; disabled when the key isn't set.
 */
import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";
import { raiseAlert, SAFETY_TYPES } from "../services/monitoring.service.js";
import { getContext } from "../services/live.service.js";

const router = Router();

const sameKey = (a, b) => {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

router.use((req, res, next) => {
  if (!env.analyticsKey || !sameKey(req.get("X-Analytics-Key"), env.analyticsKey)) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  next();
});

const alertSchema = z.object({
  tripId: z.string().min(1),
  userId: z.string().min(1),
  type: z.string().refine((t) => SAFETY_TYPES.has(t), "Unknown alert type"),
  message: z.string().trim().min(1).max(300),
  data: z.record(z.string(), z.unknown()).optional(),
});

/** Safety monitor → captain/admin alert (same pipeline as every other alert). */
router.post("/alerts", async (req, res, next) => {
  try {
    const body = alertSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ success: false, message: body.error.issues[0]?.message });
    const { tripId, userId, type, message, data } = body.data;
    const ctx = await getContext(tripId).catch(() => null);
    const m = ctx?.members.get(userId);
    if (!ctx || !m) return res.status(404).json({ success: false, message: "Rider not in an active trip" });
    if (ctx.trip.status !== "ACTIVE") return res.json({ success: true, data: { raised: false, reason: "trip not active" } });
    const alert = await raiseAlert(tripId, { type, message, data: { ...data, source: "safety-monitor" } }, m, {
      captainId: ctx.trip.leaderId,
      adminId: ctx.trip.adminId,
    });
    res.json({ success: true, data: { raised: !!alert, id: alert?.id ?? null } });
  } catch (e) {
    next(e);
  }
});

export default router;
