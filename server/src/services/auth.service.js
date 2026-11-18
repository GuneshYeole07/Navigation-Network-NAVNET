import { prisma } from "../database/prisma.js";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";
import { hashPassword, verifyPassword, signToken, publicUser } from "../utils/security.js";

export async function register({ name, email, password, role, adminCode, phone, vehicleNumber }) {
  if (role === "ADMIN") {
    // Admin self-signup is gated by a shared code so random visitors can't become admins.
    if (!env.adminSignupCode || adminCode !== env.adminSignupCode) {
      throw ApiError.forbidden("A valid admin invite code is required to register as Admin");
    }
  }
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) throw ApiError.conflict("An account with this email already exists");

  const user = await prisma.user.create({
    data: { name, email, role, phone, vehicleNumber, passwordHash: await hashPassword(password) },
  });
  return { user: publicUser(user), token: signToken(user) };
}

export async function login({ email, password, role }) {
  const user = await prisma.user.findUnique({ where: { email } });
  // Same message for unknown email and bad password: don't leak which accounts exist.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw ApiError.unauthorized("Invalid email or password");
  }
  if (user.role !== role) {
    throw ApiError.forbidden(
      role === "ADMIN"
        ? "This account is not an Admin account. Use “Login as User”."
        : "This is an Admin account. Use “Login as Admin”.",
    );
  }
  return { user: publicUser(user), token: signToken(user) };
}

export async function updateProfile(userId, data) {
  const user = await prisma.user.update({ where: { id: userId }, data });
  return publicUser(user);
}
