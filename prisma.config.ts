import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations need a direct (non-pooled) connection. Fall back to DATABASE_URL
    // when the provider gives you only one connection string.
    url: process.env.DIRECT_URL ?? env("DATABASE_URL"),
  },
});
