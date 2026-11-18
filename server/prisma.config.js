import "dotenv/config";
import { defineConfig } from "prisma/config";

// `prisma generate` (run on npm install) doesn't need a database, so DATABASE_URL may be
// absent on a fresh clone. Migrate/seed commands do need it and will fail clearly without it.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.js",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
