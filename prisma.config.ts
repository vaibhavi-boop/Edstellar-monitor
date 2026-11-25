import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations need a direct (non-pooled) connection: DIRECT_URL, or
    // DATABASE_URL_UNPOOLED as set by Vercel's Neon integration. Fall back to
    // DATABASE_URL when the provider gives you only one connection string.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL_UNPOOLED || env("DATABASE_URL"),
  },
});
