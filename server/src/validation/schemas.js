import { z } from "zod";

const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);
const trimmed = (min, max) => z.string().trim().min(min).max(max);
const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password is too long")
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/\d/, "Password must contain a number");

// ─────────────── Auth ───────────────
export const registerSchema = z.object({
  name: trimmed(2, 60),
  email: z.email("Enter a valid email").transform((e) => e.toLowerCase()),
  password,
  role: z.enum(["ADMIN", "USER"]).default("USER"),
  adminCode: z.string().optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  vehicleNumber: z.string().trim().max(20).optional(),
});

export const loginSchema = z.object({
  email: z.email("Enter a valid email").transform((e) => e.toLowerCase()),
  password: z.string().min(1, "Password is required"),
  role: z.enum(["ADMIN", "USER"]),
});

const optText = (max) => z.string().trim().max(max).optional().nullable().or(z.literal("").transform(() => null));
const optPhone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number")
  .optional()
  .nullable()
  .or(z.literal("").transform(() => null));

export const updateProfileSchema = z.object({
  name: trimmed(2, 60).optional(),
  phone: optPhone,
  vehicleNumber: optText(20),
  bloodGroup: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]).optional().nullable().or(z.literal("").transform(() => null)),
  emergencyName: optText(60),
  emergencyPhone: optPhone,
  medicalNotes: optText(300),
});

// ─────────────── Trips ───────────────
const point = z.object({ name: trimmed(1, 120), lat, lng });

export const checkpointCategories = [
  "BREAKFAST",
  "FUEL",
  "HYDRATION",
  "LUNCH",
  "REST",
  "SCENIC",
  "HOTEL",
  "HOSPITAL",
  "OTHER",
];

const checkpoint = point.extend({
  category: z.enum(checkpointCategories).default("OTHER"),
  eta: z.coerce.date().optional().nullable(),
});

export const createTripSchema = z
  .object({
    name: trimmed(3, 80),
    description: trimmed(1, 1000),
    imageUrl: z.string().trim().max(500).optional().nullable(),
    communityId: z.uuid().optional().nullable(),
    start: point,
    destination: point,
    waypoints: z.array(point).max(25).default([]),
    checkpoints: z.array(checkpoint).max(200).default([]),
    route: z
      .object({
        geometry: z.array(z.tuple([lat, lng])).min(2).max(20000),
        distance: z.number().nonnegative(),
        duration: z.number().nonnegative(),
        provider: z.string().max(30).default("osrm"),
      })
      .optional(),
    groupCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{4,20}$/, "Group ID: 4–20 letters, numbers or dashes")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    groupPassword: z.string().min(4, "Group password must be at least 4 characters").max(64),
    maxMembers: z.coerce.number().int().min(2).max(500).default(20),
    vehicleType: z.enum(["BIKE", "CAR", "BICYCLE", "BUS", "WALKING", "MIXED"]).default("BIKE"),
    speedLimitKmh: z.coerce.number().int().min(5).max(200).default(80),
    gapAlertMeters: z.coerce.number().int().min(200).max(20000).optional(),
    departureTime: z.coerce.date(),
    expectedArrival: z.coerce.date(),
  })
  .refine((d) => d.expectedArrival > d.departureTime, {
    message: "Expected arrival must be after departure",
    path: ["expectedArrival"],
  });

export const joinTripSchema = z
  .object({
    groupCode: z.string().trim().toUpperCase().optional(),
    password: z.string().optional(),
    invite: z.string().max(1000).optional(),
    vehicleNumber: z.string().trim().max(20).optional(),
  })
  .refine((d) => d.invite || (d.groupCode && d.groupCode.length >= 4 && d.password), {
    message: "Enter the Group ID and password",
  });

export const tripActionSchema = z.object({
  action: z.enum(["start", "pause", "resume", "end", "cancel"]),
});

export const leaderSchema = z.object({ userId: z.uuid() });

export const messageSchema = z.object({
  body: trimmed(1, 2000),
  recipientId: z.uuid().optional().nullable(),
});

export const announcementSchema = z.object({ body: trimmed(1, 2000) });

export const messagesQuerySchema = z.object({
  with: z.uuid().optional(),
  scope: z.enum(["group", "private"]).default("group"),
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

// ─────────────── Communities ───────────────
export const createCommunitySchema = z.object({
  name: trimmed(3, 80),
  description: trimmed(10, 1000),
  city: z.string().trim().max(60).optional(),
  category: z.string().trim().max(40).default("General"),
  coverImage: z.string().trim().max(500).optional().nullable(),
  isPublic: z.boolean().default(true),
});

export const communityQuerySchema = z.object({
  search: z.string().trim().max(80).optional(),
  category: z.string().trim().max(40).optional(),
});

export const joinCommunitySchema = z.object({ message: z.string().trim().max(300).optional() });

export const decideRequestSchema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]) });

export const communityAnnouncementSchema = z.object({
  title: trimmed(3, 120),
  body: trimmed(1, 3000),
});

// ─────────────── Geo ───────────────
export const routeRequestSchema = z.object({
  coordinates: z.array(z.tuple([lat, lng])).min(2).max(27),
  profile: z.enum(["driving", "cycling", "walking"]).default("driving"),
});

export const geocodeQuerySchema = z.object({ q: trimmed(2, 200), lat: lat.optional(), lng: lng.optional() });
export const reverseQuerySchema = z.object({ lat, lng });

// ─────────────── Socket payloads ───────────────
export const locationPayloadSchema = z.object({
  lat,
  lng,
  speed: z.coerce.number().min(0).max(400).nullable().optional(), // km/h
  heading: z.coerce.number().min(0).max(360).nullable().optional(),
  accuracy: z.coerce.number().min(0).max(100000).nullable().optional(),
  battery: z.coerce.number().int().min(0).max(100).nullable().optional(),
});

export const sosPayloadSchema = locationPayloadSchema.extend({
  emergencyType: z
    .enum(["ACCIDENT", "BREAKDOWN", "MEDICAL", "FUEL", "LOST", "SECURITY", "OTHER"])
    .default("OTHER"),
  note: z.string().trim().max(300).optional(),
});

// ─────────────── Ride captain / group riding ───────────────
export const sweepSchema = z.object({ userId: z.uuid().nullable() });
export const checklistSchema = z.object({ items: z.record(z.string(), z.boolean()) });
export const voiceMetaSchema = z.object({
  durationMs: z.coerce.number().int().min(0).max(20000).default(0),
  recipientId: z.uuid().optional().or(z.literal("").transform(() => undefined)),
});
export const expenseSchema = z.object({
  amount: z.coerce.number().positive("Enter an amount").max(1000000),
  description: trimmed(1, 80),
  splitAmong: z.array(z.uuid()).max(200).optional(),
});
export const poiQuerySchema = z.object({ refresh: z.coerce.boolean().default(false) });

// socket payloads
export const meetSchema = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180), name: z.string().trim().max(80).optional() });
export const departSchema = z.object({ minutes: z.coerce.number().int().min(0).max(180) });
export const readySchema = z.object({ ready: z.boolean().default(true) });
export const stopRequestSchema = z.object({
  reason: z.enum(["FUEL", "TOILET", "TIRED", "BIKE", "FOOD", "OTHER"]).default("OTHER"),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});
