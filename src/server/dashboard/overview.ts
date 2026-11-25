import "server-only";
import { db } from "@/lib/db";
import { computeHealthScore, type HealthScore } from "@/lib/health-score";
import type { IssueCategory, Severity } from "@/generated/prisma/enums";

const OPEN_STATUSES = ["NEW", "OPEN", "IN_PROGRESS"] as const;
const BROKEN_AVAILABILITY = [
  "CLIENT_ERROR",
  "SERVER_ERROR",
  "TIMEOUT",
  "DNS_ERROR",
  "SSL_ERROR",
  "CONNECTION_ERROR",
] as const;

export interface OverviewData {
  stats: {
    totalUrls: number;
    checkedUrls: number;
    healthyUrls: number;
    brokenUrls: number;
    openIssues: number;
    criticalIssues: number;
    highIssues: number;
    resolvedIssues: number;
    apiFailures24h: number;
    avgResponseMs: number | null;
    availabilityPct: number | null;
  };
  health: HealthScore | null;
  lastRun: { number: number; status: string; finishedAt: Date | null; startedAt: Date | null } | null;
  charts: {
    issuesOverTime: Array<{ day: string; count: number }>;
    byCategory: Array<{ category: IssueCategory; count: number }>;
    bySeverity: Array<{ severity: Severity; count: number }>;
    availabilityHistory: Array<{ run: string; pct: number }>;
    responseTrend: Array<{ day: string; avgMs: number }>;
    openVsResolved: Array<{ day: string; opened: number; resolved: number }>;
  };
}

/** Everything the overview needs, from real rows only. Days are UTC dates. */
export async function getOverview(websiteId: string): Promise<OverviewData> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const dayAgo = new Date(Date.now() - 86_400_000);

  const [
    totalUrls,
    checkedUrls,
    healthyUrls,
    brokenUrls,
    severityGroups,
    categoryGroups,
    resolvedIssues,
    apiFailures24h,
    responseAgg,
    latestSsl,
    lastRun,
  ] = await Promise.all([
    db.discoveredUrl.count({ where: { websiteId, isActive: true } }),
    db.discoveredUrl.count({ where: { websiteId, isActive: true, lastCheckedAt: { not: null } } }),
    db.discoveredUrl.count({ where: { websiteId, isActive: true, lastAvailability: { in: ["UP", "REDIRECT"] } } }),
    db.discoveredUrl.count({ where: { websiteId, isActive: true, lastAvailability: { in: [...BROKEN_AVAILABILITY] } } }),
    db.issue.groupBy({ by: ["severity"], where: { websiteId, status: { in: [...OPEN_STATUSES] } }, _count: { _all: true } }),
    db.issue.groupBy({ by: ["category"], where: { websiteId, status: { in: [...OPEN_STATUSES] } }, _count: { _all: true } }),
    db.issue.count({ where: { websiteId, status: "RESOLVED" } }),
    db.apiCheckResult.count({ where: { ok: false, checkedAt: { gte: dayAgo }, apiEndpoint: { websiteId } } }),
    db.discoveredUrl.aggregate({ where: { websiteId, isActive: true, lastResponseTimeMs: { not: null } }, _avg: { lastResponseTimeMs: true } }),
    db.sslCheck.findFirst({ where: { websiteId }, orderBy: { checkedAt: "desc" }, select: { valid: true, daysRemaining: true } }),
    db.monitoringRun.findFirst({
      where: { websiteId },
      orderBy: { createdAt: "desc" },
      select: { number: true, status: true, finishedAt: true, startedAt: true },
    }),
  ]);

  const sev = (s: Severity) => severityGroups.find((g) => g.severity === s)?._count._all ?? 0;
  const openIssues = severityGroups.reduce((sum, g) => sum + g._count._all, 0);

  const [issuesOverTime, availabilityHistory, responseTrend, openVsResolved] = await Promise.all([
    db.$queryRaw<Array<{ day: Date; count: bigint }>>`
      SELECT date_trunc('day', "firstDetectedAt") AS day, count(*) AS count
      FROM "Issue" WHERE "websiteId" = ${websiteId} AND "firstDetectedAt" >= ${since}
      GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<Array<{ number: number; pct: number }>>`
      SELECT mr."number" AS number,
             100.0 * count(*) FILTER (WHERE cr."availability" IN ('UP', 'REDIRECT')) / NULLIF(count(*), 0) AS pct
      FROM "MonitoringRun" mr
      JOIN "CrawlRun" c ON c."monitoringRunId" = mr."id"
      JOIN "CrawlResult" cr ON cr."crawlRunId" = c."id"
      WHERE mr."websiteId" = ${websiteId} AND mr."createdAt" >= ${since}
      GROUP BY mr."number" ORDER BY mr."number"`,
    db.$queryRaw<Array<{ day: Date; avg: number }>>`
      SELECT date_trunc('day', cr."checkedAt") AS day, avg(cr."responseTimeMs")::float AS avg
      FROM "CrawlResult" cr JOIN "CrawlRun" c ON c."id" = cr."crawlRunId"
      WHERE c."websiteId" = ${websiteId} AND cr."checkedAt" >= ${since} AND cr."responseTimeMs" IS NOT NULL
      GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<Array<{ day: Date; opened: bigint; resolved: bigint }>>`
      SELECT d.day,
             (SELECT count(*) FROM "Issue" i WHERE i."websiteId" = ${websiteId} AND date_trunc('day', i."firstDetectedAt") = d.day) AS opened,
             (SELECT count(*) FROM "Issue" i WHERE i."websiteId" = ${websiteId} AND date_trunc('day', i."resolvedAt") = d.day) AS resolved
      FROM generate_series(date_trunc('day', ${since}::timestamptz), date_trunc('day', now()), interval '1 day') AS d(day)
      ORDER BY d.day`,
  ]);

  const iso = (d: Date) => new Date(d).toISOString().slice(0, 10);
  const opened = openVsResolved.map((r) => ({ day: iso(r.day), opened: Number(r.opened), resolved: Number(r.resolved) }));

  return {
    stats: {
      totalUrls,
      checkedUrls,
      healthyUrls,
      brokenUrls,
      openIssues,
      criticalIssues: sev("CRITICAL"),
      highIssues: sev("HIGH"),
      resolvedIssues,
      apiFailures24h,
      avgResponseMs: responseAgg._avg.lastResponseTimeMs,
      availabilityPct: checkedUrls > 0 ? (100 * healthyUrls) / checkedUrls : null,
    },
    health: computeHealthScore({
      checkedUrls,
      healthyUrls,
      openIssues: { critical: sev("CRITICAL"), high: sev("HIGH"), medium: sev("MEDIUM"), low: sev("LOW") },
      ssl: latestSsl,
    }),
    lastRun,
    charts: {
      issuesOverTime: issuesOverTime.map((r) => ({ day: iso(r.day), count: Number(r.count) })),
      byCategory: categoryGroups.map((g) => ({ category: g.category, count: g._count._all })),
      bySeverity: severityGroups.map((g) => ({ severity: g.severity, count: g._count._all })),
      availabilityHistory: availabilityHistory.map((r) => ({ run: `#${r.number}`, pct: Math.round(Number(r.pct) * 10) / 10 })),
      responseTrend: responseTrend.map((r) => ({ day: iso(r.day), avgMs: Math.round(Number(r.avg)) })),
      // Only meaningful once something has been opened or resolved.
      openVsResolved: opened.some((r) => r.opened || r.resolved) ? opened : [],
    },
  };
}
