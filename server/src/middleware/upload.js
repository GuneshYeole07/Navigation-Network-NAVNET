import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";

const dir = path.resolve(env.uploadDir);
fs.mkdirSync(dir, { recursive: true });

const ALLOWED = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

const storage = multer.diskStorage({
  destination: dir,
  // Random names: never trust the client filename (path traversal, collisions).
  filename: (_req, file, cb) => cb(null, crypto.randomUUID() + ALLOWED[file.mimetype]),
});

export const imageUpload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED[file.mimetype]) cb(null, true);
    else cb(ApiError.badRequest("Only JPG, PNG or WEBP images are allowed"));
  },
});

// Push-to-talk clips: what MediaRecorder produces on Android (webm/opus) and iOS (mp4/aac).
const AUDIO = { "audio/webm": ".webm", "audio/ogg": ".ogg", "audio/mp4": ".m4a", "audio/aac": ".aac", "audio/mpeg": ".mp3", "audio/x-m4a": ".m4a", "video/webm": ".webm" };
const voiceDir = path.join(dir, "voice");
fs.mkdirSync(voiceDir, { recursive: true });

export const audioUpload = multer({
  storage: multer.diskStorage({
    destination: voiceDir,
    filename: (_req, file, cb) => cb(null, crypto.randomUUID() + AUDIO[file.mimetype.split(";")[0]]),
  }),
  limits: { fileSize: 1.5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (AUDIO[file.mimetype.split(";")[0]]) cb(null, true);
    else cb(ApiError.badRequest("Unsupported audio format"));
  },
});
