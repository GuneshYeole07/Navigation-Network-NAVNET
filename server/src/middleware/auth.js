import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { verifyToken } from "../utils/security.js";

/** Verifies the Bearer JWT and loads a fresh user (so deleted users/role changes take effect). */
export async function requireAuth(req, _res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return next(ApiError.unauthorized());

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return next(ApiError.unauthorized("Session expired or invalid. Please sign in again."));
  }

  // Only session tokens may authenticate (invite links are signed with the same key).
  if (!payload.sub || payload.typ) return next(ApiError.unauthorized("Session expired or invalid. Please sign in again."));

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      vehicleNumber: true,
      phone: true,
      bloodGroup: true,
      emergencyName: true,
      emergencyPhone: true,
      medicalNotes: true,
    },
  });
  if (!user) return next(ApiError.unauthorized("Account no longer exists"));
  req.user = user;
  next();
}

/** Role-based access control. Usage: requireRole("ADMIN") */
export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) return next(ApiError.forbidden());
    next();
  };
