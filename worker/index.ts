/**
 * Monitoring worker. Runs one scan for one website and exits.
 *
 *   npm run worker -- --website edstellar-two.vercel.app
 *   npm run worker -- --website <domain|id> --scan incremental --max-urls 200
 *
 * Plain Node.js (no Next.js), so it can run on any host: a laptop, GitHub
 * Actions, Render, Fly.io or a VM. Ctrl+C stops after the requests in flight
 * finish and records the run as cancelled.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { RunInProgressError, runMonitoring } from "../src/server/engine/run";

const HELP = `Usage: npm run worker -- --website <domain or id> [options]

Options:
  --website, -w   Website domain (e.g. edstellar-two.vercel.app) or ID. Required.
  --scan          full (default): sitemaps + follow links + check every URL
                  incremental: sitemaps + re-check known URLs, no link discovery
  --max-urls      Stop after this many URLs (lower than the configured maximum)
  --force         Run even if the website is paused
  --help, -h      Show this help`;

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

async function main() {
  const { values } = parseArgs({
    options: {
      website: { type: "string", short: "w" },
      scan: { type: "string", default: "full" },
      "max-urls": { type: "string" },
      force: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  if (!values.website) fail(`--website is required.\n\n${HELP}`);
  const scan = values.scan?.toLowerCase();
  if (scan !== "full" && scan !== "incremental") fail("--scan must be full or incremental");
  let maxUrls: number | undefined;
  if (values["max-urls"] !== undefined) {
    maxUrls = Number(values["max-urls"]);
    if (!Number.isInteger(maxUrls) || maxUrls < 1) fail("--max-urls must be a positive whole number");
  }
  if (!process.env.DATABASE_URL) fail("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const controller = new AbortController();
  let interrupts = 0;
  process.on("SIGINT", () => {
    interrupts++;
    if (interrupts > 1) process.exit(130);
    console.log("\nStopping after the requests in flight finish (press Ctrl+C again to quit at once)…");
    controller.abort();
  });
  process.on("SIGTERM", () => controller.abort());

  try {
    const key = values.website.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
    const website = await db.website.findFirst({
      where: { OR: [{ id: values.website.trim() }, { domain: key }] },
      select: { id: true, domain: true },
    });
    if (!website) {
      const all = await db.website.findMany({ select: { domain: true } });
      fail(`No website matches "${values.website}". Known websites: ${all.map((w) => w.domain).join(", ") || "none"}`);
    }

    const report = await runMonitoring(db, website.id, {
      scanType: scan === "full" ? "FULL" : "INCREMENTAL",
      trigger: "MANUAL",
      maxUrlsOverride: maxUrls,
      force: values.force,
      signal: controller.signal,
      log: (message) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`),
    });
    const a = report.summary.availability;
    console.log(
      `\nUp ${a.UP ?? 0} · Redirect ${a.REDIRECT ?? 0} · Client error ${a.CLIENT_ERROR ?? 0} · Server error ${a.SERVER_ERROR ?? 0}` +
        ` · Timeout ${a.TIMEOUT ?? 0} · Other failures ${(a.DNS_ERROR ?? 0) + (a.SSL_ERROR ?? 0) + (a.CONNECTION_ERROR ?? 0)}` +
        ` · Blocked ${a.BLOCKED ?? 0}`,
    );
    if (report.status === "CANCELLED") process.exitCode = 130;
  } catch (error) {
    if (error instanceof RunInProgressError) {
      console.error(error.message);
      process.exitCode = 3;
    } else {
      console.error(error instanceof Error ? error.stack ?? error.message : error);
      process.exitCode = 1;
    }
  } finally {
    await db.$disconnect();
  }
}

void main();
