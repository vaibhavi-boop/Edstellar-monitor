import "server-only";
import { db } from "@/lib/db";
import type { Severity } from "@/generated/prisma/enums";
import { OPEN_STATUSES } from "@/server/issues/queries";

export const PERIODS = { day: { label: "Daily", days: 1 }, week: { label: "Weekly", days: 7 }, month: { label: "Monthly", days: 30 } } as const;
export type Period = keyof typeof PERIODS;

export const sinceFor = (period: Period, now = Date.now()) => new Date(now - PERIODS[period].days * 86_400_000);

/** Health summary for a period: runs, availability, issues, SSL, APIs, performance. */
export async function summaryReport(websiteId: string, period: Period) {
  const since = sinceFor(period);
  const [runs, availability, opened, resolved, openBySeverity, topTypes, topOpen, ssl, api, perf] = await Promise.all([
    db.monitoringRun.groupBy({ by: ["status"], where: { websiteId, createdAt: { gte: since } }, _count: { _all: true }, _avg: { durationMs: true } }),
    db.$queryRaw<Array<{ total: number; healthy: number }>>`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE r.availability IN ('UP','REDIRECT'))::int AS healthy
      FROM "CrawlResult" r JOIN "CrawlRun" c ON c.id = r."crawlRunId"
      WHERE c."websiteId" = ${websiteId} AND r."checkedAt" >= ${since} AND r.availability <> 'BLOCKED'`,
    db.issue.count({ where: { websiteId, firstDetectedAt: { gte: since } } }),
    db.issue.count({ where: { websiteId, status: "RESOLVED", resolvedAt: { gte: since } } }),
    db.issue.groupBy({ by: ["severity"], where: { websiteId, status: { in: OPEN_STATUSES } }, _count: { _all: true } }),
    db.issue.groupBy({ by: ["type", "title", "severity"], where: { websiteId, firstDetectedAt: { gte: since } }, _count: { _all: true }, orderBy: { _count: { type: "desc" } }, take: 8 }),
    db.issue.findMany({
      where: { websiteId, status: { in: OPEN_STATUSES }, severity: { in: ["CRITICAL", "HIGH"] } },
      orderBy: [{ severity: "asc" }, { lastDetectedAt: "desc" }],
      take: 10,
      select: { number: true, title: true, severity: true, affectedUrl: true, firstDetectedAt: true },
    }),
    db.sslCheck.findFirst({ where: { websiteId }, orderBy: { checkedAt: "desc" }, select: { valid: true, daysRemaining: true, validTo: true, issuer: true } }),
    apiReport(websiteId, period),
    db.$queryRaw<Array<{ median_ttfb: number | null; p90_total: number | null; samples: number }>>`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY "ttfbMs")::float AS median_ttfb,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY "totalMs")::float AS p90_total,
             count(*)::int AS samples
      FROM "PerformanceResult" WHERE "websiteId" = ${websiteId} AND source = 'HTTP' AND "checkedAt" >= ${since}`,
  ]);
  const runCount = (s?: string) => runs.filter((r) => !s || r.status === s).reduce((n, r) => n + r._count._all, 0);
  const durations = runs.filter((r) => r._avg.durationMs != null);
  const sev = (s: Severity) => openBySeverity.find((g) => g.severity === s)?._count._all ?? 0;
  const a = availability[0] ?? { total: 0, healthy: 0 };
  return {
    since,
    runs: {
      total: runCount(),
      completed: runCount("COMPLETED"),
      partial: runCount("PARTIAL"),
      failed: runCount("FAILED"),
      avgDurationMs: durations.length ? durations.reduce((n, r) => n + r._avg.durationMs! * r._count._all, 0) / durations.reduce((n, r) => n + r._count._all, 0) : null,
    },
    availability: { checks: a.total, healthy: a.healthy, pct: a.total ? (a.healthy / a.total) * 100 : null },
    issues: { opened, resolved, open: { critical: sev("CRITICAL"), high: sev("HIGH"), medium: sev("MEDIUM"), low: sev("LOW"), info: sev("INFO") }, topTypes, topOpen },
    ssl,
    api,
    performance: perf[0] ?? { median_ttfb: null, p90_total: null, samples: 0 },
  };
}

/** Per-endpoint success and response times for a period. */
export async function apiReport(websiteId: string, period: Period) {
  const since = sinceFor(period);
  return db.$queryRaw<Array<{ id: string; name: string; method: string; url: string; checks: number; ok: number; p50: number | null; p95: number | null; last_error: string | null }>>`
    SELECT e.id, e.name, e.method::text AS method, e.url,
           count(r.id)::int AS checks,
           count(r.id) FILTER (WHERE r.ok)::int AS ok,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r."responseTimeMs")::float AS p50,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY r."responseTimeMs")::float AS p95,
           (SELECT r2."errorMessage" FROM "ApiCheckResult" r2 WHERE r2."apiEndpointId" = e.id AND NOT r2.ok AND r2."checkedAt" >= ${since} ORDER BY r2."checkedAt" DESC LIMIT 1) AS last_error
    FROM "ApiEndpoint" e LEFT JOIN "ApiCheckResult" r ON r."apiEndpointId" = e.id AND r."checkedAt" >= ${since}
    WHERE e."websiteId" = ${websiteId}
    GROUP BY e.id ORDER BY e.name`;
}

/** Per-page timing over a period: median TTFB and total, slowest first. */
export async function performanceReport(websiteId: string, period: Period) {
  const since = sinceFor(period);
  const [pages, runs] = await Promise.all([
    db.$queryRaw<Array<{ url: string; samples: number; median_ttfb: number; median_total: number; max_ttfb: number; html_bytes: number }>>`
      SELECT url, count(*)::int AS samples,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY "ttfbMs")::float AS median_ttfb,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY "totalMs")::float AS median_total,
             max("ttfbMs")::int AS max_ttfb, max("htmlBytes")::int AS html_bytes
      FROM "PerformanceResult" WHERE "websiteId" = ${websiteId} AND source = 'HTTP' AND "checkedAt" >= ${since}
      GROUP BY url ORDER BY median_ttfb DESC LIMIT 50`,
    db.$queryRaw<Array<{ number: number; median_ttfb: number }>>`
      SELECT r.number, percentile_cont(0.5) WITHIN GROUP (ORDER BY p."ttfbMs")::float AS median_ttfb
      FROM "PerformanceResult" p JOIN "MonitoringRun" r ON r.id = p."monitoringRunId"
      WHERE p."websiteId" = ${websiteId} AND p.source = 'HTTP' AND p."checkedAt" >= ${since}
      GROUP BY r.number ORDER BY r.number`,
  ]);
  return { pages, runs };
}

export async function brokenLinkReport(websiteId: string) {
  return db.issue.findMany({
    where: { websiteId, type: "links.broken_internal", status: { in: OPEN_STATUSES } },
    orderBy: { lastDetectedAt: "desc" },
    take: 200,
    select: { number: true, affectedUrl: true, httpStatus: true, details: true, firstDetectedAt: true },
  });
}
