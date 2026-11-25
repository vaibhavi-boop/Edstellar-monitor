import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Postgres driver adapter for Prisma. The session time zone is pinned to UTC:
 * the adapter sends timestamps without an offset, so on a server whose time
 * zone is not UTC (e.g. a local Postgres set to Asia/Kolkata) they would be
 * stored shifted by the local offset. The app would still read them back
 * consistently, but anything Postgres computes (now(), date_trunc for the
 * overview charts, other tools reading the database) would be wrong.
 * No server-only import: the worker and the seed use this too.
 */
export function createPrismaAdapter(connectionString = process.env.DATABASE_URL) {
  return new PrismaPg({ connectionString, options: "-c TimeZone=UTC" });
}
