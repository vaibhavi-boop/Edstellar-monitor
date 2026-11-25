import type { PrismaClient } from "@/generated/prisma/client";
import type { RunTrigger, ScanType } from "@/generated/prisma/enums";

/**
 * The run queue. The cron endpoint, the "Run now" button and `worker --due`
 * only create QUEUED runs; a worker process picks them up. At most one run per
 * website waits in the queue, and the run lease (MonitoringLock) keeps two from
 * running at once.
 *
 * Scheduling: a website is due when its last run started at least
 * `crawlFrequencyMinutes` ago. The first run of each day is a full scan (links
 * followed); the runs in between are incremental (known URLs re-checked).
 * A run that crashed is detected by its expired lease and retried once.
 */

export const LEASE_MS = 5 * 60_000;
const QUEUE_EXPIRY_MS = 24 * 3_600_000;
const FULL_SCAN_EVERY_MS = 24 * 3_600_000;
const INTERRUPTED = "Stopped responding; its lease expired";

/** Marks crashed RUNNING runs as failed and drops queue entries nobody picked up within a day. */
export async function sweepStaleRuns(db: PrismaClient, now = new Date()) {
  const running = await db.monitoringRun.findMany({ where: { status: "RUNNING" }, select: { id: true, websiteId: true, heartbeatAt: true, startedAt: true } });
  const locks = await db.monitoringLock.findMany({ where: { websiteId: { in: running.map((r) => r.websiteId) } } });
  const stale = running.filter((r) => {
    const lock = locks.find((l) => l.monitoringRunId === r.id);
    if (lock) return lock.leaseUntil < now;
    const last = r.heartbeatAt ?? r.startedAt;
    return !last || now.getTime() - last.getTime() > LEASE_MS;
  });
  if (stale.length) {
    await db.$transaction([
      db.monitoringRun.updateMany({ where: { id: { in: stale.map((r) => r.id) } }, data: { status: "FAILED", finishedAt: now, errorMessage: `${INTERRUPTED}; it will be retried` } }),
      db.monitoringJob.updateMany({ where: { monitoringRunId: { in: stale.map((r) => r.id) }, status: { in: ["PENDING", "RUNNING"] } }, data: { status: "FAILED", finishedAt: now, errorMessage: "Interrupted" } }),
      db.monitoringLock.deleteMany({ where: { monitoringRunId: { in: stale.map((r) => r.id) }, leaseUntil: { lt: now } } }),
    ]);
  }
  const expired = await db.monitoringRun.updateMany({
    where: { status: "QUEUED", createdAt: { lt: new Date(now.getTime() - QUEUE_EXPIRY_MS) } },
    data: { status: "CANCELLED", finishedAt: now, errorMessage: "No worker picked this run up within 24 hours" },
  });
  return { interrupted: stale.length, expired: expired.count };
}

export async function enqueueRun(
  db: PrismaClient,
  websiteId: string,
  options: { trigger: RunTrigger; scanType: ScanType; triggeredById?: string | null },
): Promise<{ run: { id: string; number: number; scanType: ScanType }; created: boolean }> {
  const waiting = await db.monitoringRun.findFirst({ where: { websiteId, status: "QUEUED" }, select: { id: true, number: true, scanType: true } });
  if (waiting) {
    // A full scan request upgrades a waiting incremental one.
    if (options.scanType === "FULL" && waiting.scanType === "INCREMENTAL") {
      await db.monitoringRun.update({ where: { id: waiting.id }, data: { scanType: "FULL" } });
      return { run: { ...waiting, scanType: "FULL" }, created: false };
    }
    return { run: waiting, created: false };
  }
  const run = await db.monitoringRun.create({
    data: { websiteId, trigger: options.trigger, scanType: options.scanType, status: "QUEUED", triggeredById: options.triggeredById ?? null },
    select: { id: true, number: true, scanType: true },
  });
  return { run, created: true };
}

export interface DueWebsite {
  websiteId: string;
  domain: string;
  scanType: ScanType;
  reason: string;
}

export async function dueWebsites(db: PrismaClient, now = new Date()): Promise<DueWebsite[]> {
  const sites = await db.website.findMany({
    where: { status: "ACTIVE", configuration: { isNot: null } },
    select: {
      id: true,
      domain: true,
      configuration: { select: { crawlFrequencyMinutes: true } },
      monitoringRuns: { orderBy: { createdAt: "desc" }, take: 2, where: { status: { not: "CANCELLED" } }, select: { status: true, createdAt: true, finishedAt: true, errorMessage: true } },
    },
  });
  const due: DueWebsite[] = [];
  for (const site of sites) {
    const [last, before] = site.monitoringRuns;
    if (last && (last.status === "QUEUED" || last.status === "RUNNING")) continue;
    const lastFull = await db.monitoringRun.findFirst({
      where: { websiteId: site.id, scanType: "FULL", status: { in: ["COMPLETED", "PARTIAL"] } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const scanType: ScanType = !lastFull || now.getTime() - lastFull.createdAt.getTime() >= FULL_SCAN_EVERY_MS - 5 * 60_000 ? "FULL" : "INCREMENTAL";
    const frequencyMs = (site.configuration?.crawlFrequencyMinutes ?? 240) * 60_000;

    if (!last) due.push({ websiteId: site.id, domain: site.domain, scanType, reason: "never run" });
    else if (now.getTime() - last.createdAt.getTime() >= frequencyMs - 60_000) due.push({ websiteId: site.id, domain: site.domain, scanType, reason: "schedule" });
    else if (last.status === "FAILED" && last.errorMessage?.startsWith(INTERRUPTED) && before?.status !== "FAILED") {
      due.push({ websiteId: site.id, domain: site.domain, scanType, reason: "retry after an interrupted run" });
    }
  }
  return due;
}

export async function enqueueDue(db: PrismaClient, now = new Date()) {
  const due = await dueWebsites(db, now);
  const queued = [];
  for (const d of due) {
    const { run, created } = await enqueueRun(db, d.websiteId, { trigger: "SCHEDULED", scanType: d.scanType });
    queued.push({ ...d, runNumber: run.number, created });
  }
  return queued;
}

/** The oldest queued run whose website is not locked by a live run, or null. */
export async function nextQueuedRun(db: PrismaClient, skip: ReadonlySet<string> = new Set(), now = new Date()) {
  const queued = await db.monitoringRun.findMany({ where: { status: "QUEUED", id: { notIn: [...skip] } }, orderBy: { createdAt: "asc" }, take: 20 });
  for (const run of queued) {
    const lock = await db.monitoringLock.findUnique({ where: { websiteId: run.websiteId } });
    if (!lock || lock.leaseUntil < now) return run;
  }
  return null;
}
