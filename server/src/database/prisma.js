import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env.js";

// Single shared client. Prisma 7 talks to Postgres through the `pg` driver adapter.
const adapter = new PrismaPg({ connectionString: env.databaseUrl });

export const prisma = new PrismaClient({
  adapter,
  log: env.isProd || env.isTest ? ["error"] : ["warn", "error"],
});

export async function disconnectDb() {
  await prisma.$disconnect();
}
