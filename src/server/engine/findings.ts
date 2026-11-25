import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { JobStage, ScanType } from "@/generated/prisma/enums";
import { detectIssues, evaluatedPrefixes, type DetectedIssue, type DetectionInput, type LinkSources, type PageRecord } from "./detect";
import { reconcileIssues, type IssueTransitions, type ReconcileResult } from "./reconcile";
import type { SitemapNode } from "./sitemaps";

/**
 * Phase 3 stages of a run, after the crawl: SEO audit rows, the redirect
 * inventory, issue detection and reconciliation. Each stage is recorded as a
 * MonitoringJob so the run detail shows what happened.
 */

export interface FindingsContext {
  db: PrismaClient;
  websiteId: string;
  runId: string;
  scanType: ScanType;
  startedAt: Date;
  /** Crawl finished without hitting the URL limit or being cancelled. */
  complete: boolean;
  pages: Map<string, PageRecord>;
  discoveredIds: Map<string, string>;
  links: Map<string, LinkSources>;
  homeNormalized: string;
  robots: DetectionInput["robots"];
  sitemaps: SitemapNode[];
  normalize: (url: string) => string | null;
  ignoredTypes: readonly string[];
  log: (message: string) => void;
  /** Findings from the phase 4 checks (SSL/DNS, performance, APIs), reconciled together with the crawl's. */
  extra?: { detected: DetectedIssue[]; checkedKeys: string[]; evaluated: string[] };
}

export interface FindingsSummary {
  seoPages: number;
  redirects: number;
  linkTargets: number;
  issues: ReconcileResult & { detected: number };
}

export interface FindingsOutcome {
  summary: FindingsSummary;
  transitions: IssueTransitions;
}

const restrictsIndexing = (value: string | null | undefined) => Boolean(value && /(^|[\s,:])(noindex|none)($|[\s,])/i.test(value));

async function stage<T>(db: PrismaClient, runId: string, name: JobStage, work: () => Promise<{ result: T; processed: number }>): Promise<T> {
  const job = await db.monitoringJob.create({ data: { monitoringRunId: runId, stage: name, status: "RUNNING", startedAt: new Date(), attempts: 1 } });
  try {
    const { result, processed } = await work();
    await db.monitoringJob.update({ where: { id: job.id }, data: { status: "COMPLETED", finishedAt: new Date(), processed, total: processed } });
    return result;
  } catch (error) {
    await db.monitoringJob
      .update({ where: { id: job.id }, data: { status: "FAILED", finishedAt: new Date(), errorMessage: error instanceof Error ? error.message.slice(0, 1000) : String(error) } })
      .catch(() => {});
    throw error;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function processFindings(ctx: FindingsContext): Promise<FindingsOutcome> {
  const { db } = ctx;
  const pages = [...ctx.pages.values()];
  const linksEvaluated = ctx.scanType === "FULL";

  const linkTargets = linksEvaluated
    ? await stage(ctx.db, ctx.runId, "LINKS", async () => ({ result: ctx.links.size, processed: ctx.links.size }))
    : 0;

  // ── SEO audit rows (one per analysed page per run) ──
  const seoPages = await stage(db, ctx.runId, "SEO", async () => {
    const rows: Prisma.SeoAuditResultCreateManyInput[] = [];
    for (const page of pages) {
      const a = page.analysis;
      const discoveredUrlId = ctx.discoveredIds.get(page.normalized);
      if (!a || !discoveredUrlId || page.availability !== "UP") continue;
      rows.push({
        discoveredUrlId,
        monitoringRunId: ctx.runId,
        title: a.title,
        titleLength: a.title?.length ?? null,
        metaDescription: a.metaDescription,
        metaDescriptionLength: a.metaDescription?.length ?? null,
        h1Count: a.headings.filter((h) => h.level === 1).length,
        headings: a.headings.slice(0, 100) as unknown as Prisma.InputJsonValue,
        canonicalUrl: a.canonical,
        robotsMeta: a.robotsMeta,
        xRobotsTag: page.xRobotsTag,
        isIndexable: !restrictsIndexing(a.robotsMeta) && !restrictsIndexing(page.xRobotsTag),
        ogTitle: a.ogTitle,
        ogDescription: a.ogDescription,
        ogImage: a.ogImage,
        twitterCard: a.twitterCard,
        schemaTypes: [...new Set(a.jsonLd.flatMap((b) => b.types))],
        jsonLdValid: a.jsonLd.every((b) => b.valid),
      });
    }
    for (const batch of chunk(rows, 500)) await db.seoAuditResult.createMany({ data: batch });
    return { result: rows.length, processed: rows.length };
  });

  // ── Redirect inventory ──
  const redirects = await stage(db, ctx.runId, "REDIRECTS", async () => {
    const redirecting = pages.filter((p) => p.chain.length > 0);
    const now = new Date();
    for (const batch of chunk(redirecting, 100)) {
      await db.$transaction(
        batch.map((p) => {
          const first = p.chain[0]!;
          const from = new URL(first.url);
          const to = new URL(first.location);
          const data = {
            destinationUrl: first.location,
            finalUrl: p.finalUrl,
            statusCode: first.status,
            hops: p.chain.length,
            chain: p.chain as unknown as Prisma.InputJsonValue,
            finalStatusCode: p.finalStatus,
            isLoop: p.redirectLoop,
            isHttpToHttps: from.protocol === "http:" && to.protocol === "https:" && from.hostname.replace(/^www\./, "") === to.hostname.replace(/^www\./, ""),
            lastSeenAt: now,
          };
          return db.redirect.upsert({
            where: { websiteId_sourceUrl: { websiteId: ctx.websiteId, sourceUrl: p.url } },
            create: { websiteId: ctx.websiteId, sourceUrl: p.url, firstSeenAt: now, ...data },
            update: data,
          });
        }),
      );
    }
    // Drop redirects that no longer redirect: all stale ones after a complete full scan,
    // otherwise only those whose source URL was re-checked in this run.
    if (ctx.scanType === "FULL" && ctx.complete) {
      await db.redirect.deleteMany({ where: { websiteId: ctx.websiteId, lastSeenAt: { lt: ctx.startedAt } } });
    } else {
      for (const batch of chunk(pages.filter((p) => !p.robotsBlocked).map((p) => p.url), 1000)) {
        await db.redirect.deleteMany({ where: { websiteId: ctx.websiteId, lastSeenAt: { lt: ctx.startedAt }, sourceUrl: { in: batch } } });
      }
    }
    return { result: redirecting.length, processed: redirecting.length };
  });

  // ── Issues ──
  const issues = await stage(db, ctx.runId, "ISSUES", async () => {
    const detected = [
      ...detectIssues({
      pages: ctx.pages,
      links: ctx.links,
      linksEvaluated,
      homeNormalized: ctx.homeNormalized,
      robots: ctx.robots,
      sitemaps: ctx.sitemaps,
      normalize: ctx.normalize,
      }),
      ...(ctx.extra?.detected ?? []),
    ];
    const checkedPages = new Set([...pages.filter((p) => !p.robotsBlocked).map((p) => p.normalized), ...(ctx.extra?.checkedKeys ?? [])]);
    const result = await reconcileIssues(db, {
      websiteId: ctx.websiteId,
      runId: ctx.runId,
      detected,
      ignoredTypes: ctx.ignoredTypes,
      // Broken-link issues can only be cleared by a crawl that saw every link.
      evaluated: [...evaluatedPrefixes(linksEvaluated && ctx.complete), ...(ctx.extra?.evaluated ?? [])],
      checkedPages,
      complete: ctx.complete,
    });
    return { result: { ...result, detected: detected.length }, processed: detected.length };
  });
  const { transitions, ...counts } = issues;

  ctx.log(
    `Findings: ${seoPages} pages audited, ${redirects} redirects, ${issues.detected} findings → ${issues.created} new, ` +
      `${issues.reopened} reopened, ${issues.resolved} resolved`,
  );
  return { summary: { seoPages, redirects, linkTargets, issues: counts }, transitions };
}
