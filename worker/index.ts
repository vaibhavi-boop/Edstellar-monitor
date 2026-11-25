/**
 * Monitoring worker. Plain Node.js (no Next.js), so it can run anywhere:
 * a laptop, a GitHub Actions schedule, Render, Fly.io or a VM.
 *
 *   npm run worker -- --website edstellar-two.vercel.app        run one scan now
 *   npm run worker -- --due                                     queue due websites, run the queue, exit
 *   npm run worker -- --queue                                   run queued scans, exit
 *   npm run worker -- --loop                                    keep running: schedule and process every minute
 *
 * Ctrl+C stops after the requests in flight finish and records the run as cancelled.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { PrismaClient } from "../src/generated/prisma/client";
import { createPrismaAdapter } from "../src/lib/prisma-adapter";
import { enqueueDue, nextQueuedRun, sweepStaleRuns } from "../src/server/engine/queue";
import { purgeOldResults } from "../src/server/engine/retention";
import { RunInProgressError, runMonitoring, type RunReport } from "../src/server/engine/run";

const HELP = `Usage: npm run worker -- <mode> [options]

Modes (choose one):
  --website, -w <domain|id>  Run one scan of this website now
  --due                      Queue every website that is due, run the queue, then exit
                             (use this from a cron job or a scheduled CI workflow)
  --queue                    Run scans already queued (cron endpoint, "Run now"), then exit
  --loop                     Keep running: every minute, queue due websites and run the queue

Options:
  --scan full|incremental    With --website: full (default) follows links; incremental re-checks known URLs
  --max-urls <n>             With --website: stop after n URLs (a quick trial)
  --force                    With --website: run even if the website is paused
  --help, -h                 Show this help

Environment: DATABASE_URL (required), APP_URL (links in notifications), SMTP_* (email),
ENCRYPTION_KEY (API credentials, Slack webhooks), PAGESPEED_API_KEY, RETENTION_DAYS (default 30).`;

const stamp = () => new Date().toISOString().slice(11, 19);
const say = (message: string) => console.log(`[${stamp()}] ${message}`);

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

function printTotals(report: RunReport) {
  const a = report.summary.availability;
  console.log(
    `Up ${a.UP ?? 0} · Redirect ${a.REDIRECT ?? 0} · Client error ${a.CLIENT_ERROR ?? 0} · Server error ${a.SERVER_ERROR ?? 0}` +
      ` · Timeout ${a.TIMEOUT ?? 0} · Other failures ${(a.DNS_ERROR ?? 0) + (a.SSL_ERROR ?? 0) + (a.CONNECTION_ERROR ?? 0)} · Blocked ${a.BLOCKED ?? 0}`,
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      website: { type: "string", short: "w" },
      due: { type: "boolean", default: false },
      queue: { type: "boolean", default: false },
      loop: { type: "boolean", default: false },
      scan: { type: "string", default: "full" },
      "max-urls": { type: "string" },
      force: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) return void console.log(HELP);
  const modes = [values.website ? "website" : null, values.due ? "due" : null, values.queue ? "queue" : null, values.loop ? "loop" : null].filter(Boolean);
  if (modes.length !== 1) fail(`Choose exactly one mode.\n\n${HELP}`);
  const scan = values.scan?.toLowerCase();
  if (scan !== "full" && scan !== "incremental") fail("--scan must be full or incremental");
  let maxUrls: number | undefined;
  if (values["max-urls"] !== undefined) {
    maxUrls = Number(values["max-urls"]);
    if (!Number.isInteger(maxUrls) || maxUrls < 1) fail("--max-urls must be a positive whole number");
  }
  if (!process.env.DATABASE_URL) fail("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  const appUrl = process.env.APP_URL?.trim() || "http://localhost:3000";

  const db = new PrismaClient({ adapter: createPrismaAdapter() });
  const controller = new AbortController();
  let interrupts = 0;
  process.on("SIGINT", () => {
    if (++interrupts > 1) process.exit(130);
    console.log("\nStopping after the requests in flight finish (press Ctrl+C again to quit at once)…");
    controller.abort();
  });
  process.on("SIGTERM", () => controller.abort());

  const runQueue = async () => {
    const tried = new Set<string>();
    for (;;) {
      if (controller.signal.aborted) return;
      const next = await nextQueuedRun(db, tried);
      if (!next) return;
      tried.add(next.id);
      try {
        const report = await runMonitoring(db, next.websiteId, {
          queuedRunId: next.id,
          scanType: next.scanType,
          trigger: next.trigger,
          triggeredById: next.triggeredById,
          signal: controller.signal,
          appUrl,
          log: say,
        });
        printTotals(report);
      } catch (error) {
        if (error instanceof RunInProgressError) say(`Run #${next.number} skipped: ${error.message}`);
        else say(`Run #${next.number} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  const housekeeping = async () => {
    const swept = await sweepStaleRuns(db);
    if (swept.interrupted || swept.expired) say(`Housekeeping: ${swept.interrupted} interrupted run(s) marked failed, ${swept.expired} stale queue entr(ies) cancelled`);
  };
  const purge = async () => {
    const p = await purgeOldResults(db);
    const removed = p.crawlRuns + p.seo + p.performance + p.api + p.ssl + p.notifications;
    if (removed) say(`Retention (${p.days} days): removed ${p.crawlRuns} crawl runs, ${p.seo} SEO rows, ${p.performance} performance rows, ${p.api} API results, ${p.ssl} SSL checks, ${p.notifications} notifications`);
  };
  const schedule = async () => {
    const queued = await enqueueDue(db);
    for (const q of queued) say(`Queued run #${q.runNumber} for ${q.domain}: ${q.scanType.toLowerCase()} scan (${q.reason})${q.created ? "" : ", already waiting"}`);
    if (queued.length === 0) say("No website is due.");
  };

  try {
    if (values.website) {
      const key = values.website.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
      const website = await db.website.findFirst({ where: { OR: [{ id: values.website.trim() }, { domain: key }] }, select: { id: true } });
      if (!website) {
        const all = await db.website.findMany({ select: { domain: true } });
        fail(`No website matches "${values.website}". Known websites: ${all.map((w) => w.domain).join(", ") || "none"}`);
      }
      await housekeeping();
      const report = await runMonitoring(db, website.id, {
        scanType: scan === "full" ? "FULL" : "INCREMENTAL",
        trigger: "MANUAL",
        maxUrlsOverride: maxUrls,
        force: values.force,
        signal: controller.signal,
        appUrl,
        log: say,
      });
      console.log("");
      printTotals(report);
      await purge();
      if (report.status === "CANCELLED") process.exitCode = 130;
    } else if (values.queue || values.due) {
      await housekeeping();
      if (values.due) await schedule();
      await runQueue();
      await purge();
    } else {
      say("Worker started in loop mode. Checking for due and queued runs every minute.");
      let lastPurge = 0;
      while (!controller.signal.aborted) {
        await housekeeping();
        await schedule();
        await runQueue();
        if (Date.now() - lastPurge > 6 * 3_600_000) {
          await purge();
          lastPurge = Date.now();
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 60_000);
          controller.signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
        });
      }
    }
  } catch (error) {
    if (error instanceof RunInProgressError) {
      console.error(error.message);
      process.exitCode = 3;
    } else {
      console.error(error instanceof Error ? (error.stack ?? error.message) : error);
      process.exitCode = 1;
    }
  } finally {
    await db.$disconnect();
  }
}

void main();
