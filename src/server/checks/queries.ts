import "server-only";
import { db } from "@/lib/db";

/** HTTP timing results of the latest run that measured performance, plus a per-run trend. */
export async function performanceOverview(websiteId: string) {
  const latest = await db.performanceResult.findFirst({
    where: { websiteId, source: "HTTP", monitoringRunId: { not: null } },
    orderBy: { checkedAt: "desc" },
    select: { monitoringRunId: true, checkedAt: true, monitoringRun: { select: { number: true } } },
  });
  if (!latest?.monitoringRunId) return null;
  const [rows, pageSpeed, trendRows] = await Promise.all([
    db.performanceResult.findMany({ where: { monitoringRunId: latest.monitoringRunId, source: "HTTP" }, orderBy: { ttfbMs: "desc" } }),
    db.performanceResult.findMany({
      where: { websiteId, source: "PAGESPEED" },
      orderBy: { checkedAt: "desc" },
      take: 10,
    }),
    db.$queryRaw<Array<{ number: number; at: Date; median_ttfb: number; p90_total: number; pages: number }>>`
      SELECT r.number, max(p."checkedAt") AS at,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY p."ttfbMs")::float AS median_ttfb,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY p."totalMs")::float AS p90_total,
             count(*)::int AS pages
      FROM "PerformanceResult" p JOIN "MonitoringRun" r ON r.id = p."monitoringRunId"
      WHERE p."websiteId" = ${websiteId} AND p.source = 'HTTP'
      GROUP BY r.number ORDER BY r.number DESC LIMIT 20`,
  ]);
  return { runNumber: latest.monitoringRun?.number ?? null, checkedAt: latest.checkedAt, rows, pageSpeed, trend: trendRows.reverse() };
}

export async function sslOverview(websiteId: string) {
  const checks = await db.sslCheck.findMany({ where: { websiteId }, orderBy: { checkedAt: "desc" }, take: 30, include: { monitoringRun: { select: { number: true } } } });
  const config = await db.websiteConfiguration.findUnique({ where: { websiteId }, select: { sslWarningDays: true } });
  return { latest: checks[0] ?? null, history: checks, warningDays: config?.sslWarningDays ?? [30, 15, 7, 3] };
}
