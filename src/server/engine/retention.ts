import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Deletes per-run detail older than RETENTION_DAYS (default 30, minimum 7):
 * crawl results, SEO audit rows, performance and API results, SSL checks and
 * sent notifications. The latest run of each website is always kept, so the
 * screens never go empty. Runs, URLs, issues and issue history are kept
 * forever; they are small and are the audit trail.
 */
export function retentionDays(): number {
  const n = Number(process.env.RETENTION_DAYS ?? 30);
  return Number.isFinite(n) ? Math.max(7, Math.round(n)) : 30;
}

export async function purgeOldResults(db: PrismaClient, days = retentionDays(), now = new Date()) {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const latest = await db.website.findMany({
    select: { monitoringRuns: { where: { status: { in: ["COMPLETED", "PARTIAL"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true } } },
  });
  const keep = latest.flatMap((w) => w.monitoringRuns.map((r) => r.id));
  const notKept = { OR: [{ monitoringRunId: null }, { monitoringRunId: { notIn: keep } }] };

  const [crawlRuns, seo, performance, api, ssl, notifications] = await db.$transaction([
    db.crawlRun.deleteMany({ where: { startedAt: { lt: cutoff }, ...notKept } }),
    db.seoAuditResult.deleteMany({ where: { checkedAt: { lt: cutoff }, ...notKept } }),
    db.performanceResult.deleteMany({ where: { checkedAt: { lt: cutoff }, ...notKept } }),
    db.apiCheckResult.deleteMany({ where: { checkedAt: { lt: cutoff }, ...notKept } }),
    db.sslCheck.deleteMany({ where: { checkedAt: { lt: cutoff }, ...notKept } }),
    db.notification.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - Math.max(days, 90) * 86_400_000) } } }),
  ]);
  return { days, crawlRuns: crawlRuns.count, seo: seo.count, performance: performance.count, api: api.count, ssl: ssl.count, notifications: notifications.count };
}
