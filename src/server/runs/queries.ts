import "server-only";
import { db } from "@/lib/db";

export const RUN_PAGE_SIZE = 30;

export async function listRuns(websiteId: string, page: number) {
  const [total, rows, queued, lock] = await Promise.all([
    db.monitoringRun.count({ where: { websiteId } }),
    db.monitoringRun.findMany({
      where: { websiteId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * RUN_PAGE_SIZE,
      take: RUN_PAGE_SIZE,
      select: {
        id: true,
        number: true,
        trigger: true,
        scanType: true,
        status: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
        durationMs: true,
        urlsChecked: true,
        failedChecks: true,
        newIssues: true,
        resolvedIssues: true,
        errorMessage: true,
      },
    }),
    db.monitoringRun.count({ where: { websiteId, status: "QUEUED" } }),
    db.monitoringLock.findUnique({ where: { websiteId } }),
  ]);
  return { total, rows, queued, running: Boolean(lock && lock.leaseUntil > new Date()) };
}

export async function getRun(number: number) {
  const run = await db.monitoringRun.findUnique({
    where: { number },
    include: {
      website: { select: { id: true, name: true, domain: true } },
      jobs: { orderBy: [{ startedAt: { sort: "asc", nulls: "last" } }] },
    },
  });
  if (!run) return null;
  const [triggeredBy, occurrences, notifications] = await Promise.all([
    run.triggeredById ? db.user.findUnique({ where: { id: run.triggeredById }, select: { name: true } }) : null,
    db.issueOccurrence.groupBy({ by: ["kind"], where: { monitoringRunId: run.id }, _count: { _all: true } }),
    db.notification.findMany({ where: { websiteId: run.websiteId, payload: { path: ["runId"], equals: run.id } }, orderBy: { createdAt: "asc" } }),
  ]);
  const recent = await db.issueOccurrence.findMany({
    where: { monitoringRunId: run.id, kind: { in: ["DETECTED", "RECURRED", "AUTO_RESOLVED"] } },
    orderBy: [{ issue: { severity: "asc" } }, { createdAt: "asc" }],
    take: 25,
    include: { issue: { select: { number: true, title: true, severity: true, affectedUrl: true } } },
  });
  return { run, triggeredBy: triggeredBy?.name ?? null, occurrences, notifications, recent };
}
