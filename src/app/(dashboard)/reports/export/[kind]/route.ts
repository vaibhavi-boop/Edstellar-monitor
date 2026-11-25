import { db } from "@/lib/db";
import { streamCsv } from "@/lib/csv";
import { choice } from "@/lib/search-params";
import { getCurrentUser } from "@/server/auth/session";
import { OPEN_STATUSES } from "@/server/issues/queries";
import { PERIODS, sinceFor, type Period } from "@/server/reports/queries";
import { getActiveWebsite } from "@/server/websites/queries";

/**
 * Streamed CSV exports for the active website. Rows are read in batches of
 * 1,000 by id, so exports of any size use constant memory.
 *   /reports/export/issues?status=open|all      /reports/export/pages
 *   /reports/export/seo (latest audit)           /reports/export/broken-links
 *   /reports/export/api?period=day|week|month   /reports/export/performance?period=…
 *   /reports/export/runs?period=…
 */
const BATCH = 1000;
const KINDS = ["issues", "pages", "seo", "broken-links", "api", "performance", "runs"] as const;
type Kind = (typeof KINDS)[number];

export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in to export data.", { status: 401 });
  const website = await getActiveWebsite();
  if (!website) return new Response("No website is set up.", { status: 404 });
  const { kind: rawKind } = await params;
  if (!(KINDS as readonly string[]).includes(rawKind)) return new Response("Unknown export.", { status: 404 });
  const kind = rawKind as Kind;
  const query = new URL(request.url).searchParams;
  const period = choice<Period>(query.get("period"), PERIODS, "week");
  const since = sinceFor(period);
  const websiteId = website.id;
  const file = (name: string) => `${name}-${website.domain}-${new Date().toISOString().slice(0, 10)}.csv`;
  const after = (cursor: string) => (cursor ? { id: { gt: cursor } } : {});
  const done = <T extends { id: string }>(rows: T[]) => (rows.length < BATCH ? null : rows.at(-1)!.id);

  switch (kind) {
    case "issues": {
      const open = query.get("status") !== "all";
      return streamCsv(
        file(open ? "open-issues" : "issues"),
        ["id", "title", "type", "category", "severity", "status", "affected_url", "source_url", "http_status", "description", "first_detected_utc", "last_detected_utc", "times_detected", "recurrences", "resolved_utc"],
        "",
        async (cursor) => {
          const rows = await db.issue.findMany({ where: { websiteId, ...(open ? { status: { in: OPEN_STATUSES } } : {}), ...after(cursor) }, orderBy: { id: "asc" }, take: BATCH });
          return {
            rows: rows.map((i) => [`EM-${i.number}`, i.title, i.type, i.category, i.severity, i.status, i.affectedUrl, i.sourceUrl, i.httpStatus, i.description, i.firstDetectedAt, i.lastDetectedAt, i.occurrenceCount, i.recurrenceCount, i.resolvedAt]),
            cursor: done(rows),
          };
        },
      );
    }
    case "pages":
      return streamCsv(
        file("pages"),
        ["url", "status_code", "availability", "response_ms", "source", "in_sitemap", "manual", "depth", "canonical", "content_type", "active", "first_seen_utc", "last_checked_utc"],
        "",
        async (cursor) => {
          const rows = await db.discoveredUrl.findMany({ where: { websiteId, ...after(cursor) }, orderBy: { id: "asc" }, take: BATCH });
          return {
            rows: rows.map((u) => [u.url, u.lastStatusCode, u.lastAvailability, u.lastResponseTimeMs, u.source, u.inSitemap, u.isManual, u.depth, u.canonicalUrl, u.contentType, u.isActive, u.firstSeenAt, u.lastCheckedAt]),
            cursor: done(rows),
          };
        },
      );
    case "seo": {
      const run = await db.monitoringRun.findFirst({ where: { websiteId, seoAuditResults: { some: {} } }, orderBy: { createdAt: "desc" }, select: { id: true } });
      return streamCsv(
        file("seo-audit"),
        ["url", "title", "title_length", "meta_description", "description_length", "h1_count", "canonical", "robots_meta", "x_robots_tag", "indexable", "og_title", "og_image", "twitter_card", "schema_types", "json_ld_valid", "checked_utc"],
        "",
        async (cursor) => {
          if (!run) return { rows: [], cursor: null };
          const rows = await db.seoAuditResult.findMany({ where: { monitoringRunId: run.id, ...after(cursor) }, orderBy: { id: "asc" }, take: BATCH, include: { discoveredUrl: { select: { url: true } } } });
          return {
            rows: rows.map((r) => [r.discoveredUrl.url, r.title, r.titleLength, r.metaDescription, r.metaDescriptionLength, r.h1Count, r.canonicalUrl, r.robotsMeta, r.xRobotsTag, r.isIndexable, r.ogTitle, r.ogImage, r.twitterCard, r.schemaTypes.join(" "), r.jsonLdValid, r.checkedAt]),
            cursor: done(rows),
          };
        },
      );
    }
    case "broken-links":
      return streamCsv(file("broken-links"), ["broken_url", "http_status", "linked_from", "links_total", "issue", "first_detected_utc"], "", async (cursor) => {
        const issues = await db.issue.findMany({ where: { websiteId, type: "links.broken_internal", status: { in: OPEN_STATUSES }, ...after(cursor) }, orderBy: { id: "asc" }, take: BATCH });
        // One row per (broken URL, linking page), so the export can be sorted by page to fix.
        const rows = issues.flatMap((i) => {
          const d = (i.details ?? {}) as { sources?: string[]; sourceCount?: number };
          const sources = d.sources?.length ? d.sources : [""];
          return sources.map((s) => [i.affectedUrl, i.httpStatus, s, d.sourceCount ?? sources.length, `EM-${i.number}`, i.firstDetectedAt]);
        });
        return { rows, cursor: done(issues) };
      });
    case "api":
      return streamCsv(file(`api-checks-${period}`), ["endpoint", "method", "url", "checked_utc", "ok", "status_code", "response_ms", "error_type", "error", "missing_fields", "source"], "", async (cursor) => {
        const rows = await db.apiCheckResult.findMany({
          where: { apiEndpoint: { websiteId }, checkedAt: { gte: since }, ...after(cursor) },
          orderBy: { id: "asc" },
          take: BATCH,
          include: { apiEndpoint: { select: { name: true, method: true, url: true } } },
        });
        return {
          rows: rows.map((r) => [r.apiEndpoint.name, r.apiEndpoint.method, r.apiEndpoint.url, r.checkedAt, r.ok, r.statusCode, r.responseTimeMs, r.errorType, r.errorMessage, r.missingFields.join(" "), r.monitoringRunId ? "run" : "manual"]),
          cursor: done(rows),
        };
      });
    case "performance":
      return streamCsv(
        file(`performance-${period}`),
        ["url", "source", "checked_utc", "dns_ms", "connect_ms", "tls_ms", "ttfb_ms", "total_ms", "html_bytes", "performance_score", "accessibility_score", "best_practices_score", "seo_score", "lcp_ms", "fcp_ms", "cls", "inp_ms"],
        "",
        async (cursor) => {
          const rows = await db.performanceResult.findMany({ where: { websiteId, checkedAt: { gte: since }, ...after(cursor) }, orderBy: { id: "asc" }, take: BATCH });
          return {
            rows: rows.map((r) => [r.url, r.source, r.checkedAt, r.dnsMs, r.connectMs, r.tlsMs, r.ttfbMs, r.totalMs, r.htmlBytes, r.performanceScore, r.accessibilityScore, r.bestPracticesScore, r.seoScore, r.lcpMs, r.fcpMs, r.cls, r.inpMs]),
            cursor: done(rows),
          };
        },
      );
    case "runs":
      return streamCsv(
        file(`runs-${period}`),
        ["run", "status", "scan", "trigger", "queued_utc", "started_utc", "finished_utc", "duration_s", "urls_checked", "failing", "new_issues", "updated_issues", "resolved_issues", "error"],
        "",
        async (cursor) => {
          const rows = await db.monitoringRun.findMany({ where: { websiteId, createdAt: { gte: since }, ...after(cursor) }, orderBy: { id: "asc" }, take: BATCH });
          return {
            rows: rows.map((r) => [r.number, r.status, r.scanType, r.trigger, r.createdAt, r.startedAt, r.finishedAt, r.durationMs == null ? null : Math.round(r.durationMs / 1000), r.urlsChecked, r.failedChecks, r.newIssues, r.updatedIssues, r.resolvedIssues, r.errorMessage]),
            cursor: done(rows),
          };
        },
      );
  }
}
