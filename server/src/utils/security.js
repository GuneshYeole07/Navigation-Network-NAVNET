import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { env } from "../config/env.js";

const ROUNDS = env.isTest ? 4 : 12;

export const hashPassword = (plain) => bcrypt.hash(plain, ROUNDS);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, name: user.name }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

export function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret);
}

/** Human-friendly group code: NAV-7K3QX (no 0/O/1/I ambiguity). */
export function generateGroupCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(5);
  let code = "";
  for (const b of bytes) code += alphabet[b % alphabet.length];
  return `NAV-${code}`;
}

export function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Strip secrets before sending a user to the client. */
export function publicUser(u) {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return rest;
}

/** Signed, expiring trip invite: lets a rider join via link/QR without typing the password. */
export function signInvite(tripId, expiresAt) {
  const seconds = Math.max(3600, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  return jwt.sign({ typ: "invite", tid: tripId }, env.jwtSecret, { expiresIn: seconds });
}

export function verifyInvite(token) {
  const p = jwt.verify(token, env.jwtSecret);
  if (p.typ !== "invite" || !p.tid) throw new Error("not an invite");
  return p.tid;
}
