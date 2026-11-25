import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Availability, JobStage, ScanType, RunTrigger } from "@/generated/prisma/enums";
import { crawl, type CrawlSeed, type PageResult } from "./crawler";
import { classifyError, defaultFetchPolicy, fetchWithRetry, type ExpectedResponse, type FetchPolicy, type WantBody } from "./http";
import { normalizeUrl, parseHttpUrl } from "./normalize";
import { allowAllRobots, parseRobotsTxt, type RobotsTxt } from "./robots";
import { createHostMapper, createScope, globToRegExp } from "./scope";
import { readSitemaps } from "./sitemaps";

/**
 * One monitoring run for one website (phase 2 stages: robots.txt, sitemaps,
 * discovery/crawl and availability). Takes the website's lease so runs never
 * overlap, renews it while working, and records progress in MonitoringJob rows.
 */

const LEASE_MS = 5 * 60_000;
const HEARTBEAT_MS = 30_000;
const MAX_CRAWL_DELAY_S = 10;
const BROKEN: readonly Availability[] = ["CLIENT_ERROR", "SERVER_ERROR", "TIMEOUT", "DNS_ERROR", "SSL_ERROR", "CONNECTION_ERROR"];

export class RunInProgressError extends Error {
  constructor(runNumber?: number) {
    super(`Another run${runNumber ? ` (#${runNumber})` : ""} is already in progress for this website`);
    this.name = "RunInProgressError";
  }
}

export interface RunOptions {
  scanType: ScanType;
  trigger: RunTrigger;
  triggeredById?: string | null;
  /** Lower the configured maximum for a trial run. */
  maxUrlsOverride?: number;
  /** Run even when the website is paused. */
  force?: boolean;
  signal?: AbortSignal;
  log?: (message: string) => void;
  /** Tests replace the URL guard and DNS lookup to reach a local server. */
  fetchPolicy?: Partial<FetchPolicy>;
}

export interface RunReport {
  runId: string;
  runNumber: number;
  status: "COMPLETED" | "PARTIAL" | "CANCELLED";
  durationMs: number;
  summary: RunSummary;
}

export interface RunSummary {
  scanType: ScanType;
  robots: {
    url: string;
    statusCode: number | null;
    found: boolean;
    respected: boolean;
    matchedAgent: string | null;
    ruleCount: number;
    crawlDelaySeconds: number | null;
    sitemaps: string[];
    error: string | null;
  };
  sitemaps: { files: number; invalid: number; urlsListed: number; urlsInScope: number; urlsOutOfScope: number };
  crawl: {
    discovered: number;
    checked: number;
    robotsBlocked: number;
    newUrls: number;
    deactivated: number;
    truncated: boolean;
    maxUrls: number;
  };
  availability: Partial<Record<Availability, number>>;
  hostAliases: string[];
}

const expectedSchema = z.array(z.object({ pattern: z.string().startsWith("/"), status: z.number().int().min(100).max(599) }));

export function parseExpectedResponses(value: unknown): ExpectedResponse[] {
  const parsed = expectedSchema.safeParse(value);
  return parsed.success ? parsed.data.map((e) => ({ pattern: globToRegExp(e.pattern), status: e.status })) : [];
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

async function startRun(db: PrismaClient, websiteId: string, options: RunOptions) {
  try {
    return await db.$transaction(async (tx) => {
      const now = new Date();
      const lock = await tx.monitoringLock.findUnique({ where: { websiteId } });
      if (lock && lock.leaseUntil > now) {
        const holder = await tx.monitoringRun.findUnique({ where: { id: lock.monitoringRunId }, select: { number: true } });
        throw new RunInProgressError(holder?.number);
      }
      if (lock) {
        await tx.monitoringRun.updateMany({
          where: { id: lock.monitoringRunId, status: { in: ["QUEUED", "RUNNING"] } },
          data: { status: "FAILED", finishedAt: now, errorMessage: "Stopped responding; its lease expired and a later run took over" },
        });
        await tx.monitoringLock.delete({ where: { websiteId } });
      }
      const run = await tx.monitoringRun.create({
        data: {
          websiteId,
          trigger: options.trigger,
          scanType: options.scanType,
          status: "RUNNING",
          startedAt: now,
          heartbeatAt: now,
          triggeredById: options.triggeredById ?? null,
        },
      });
      await tx.monitoringLock.create({ data: { websiteId, monitoringRunId: run.id, leaseUntil: new Date(now.getTime() + LEASE_MS) } });
      return run;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new RunInProgressError();
    throw error;
  }
}

export async function runMonitoring(db: PrismaClient, websiteId: string, options: RunOptions): Promise<RunReport> {
  const log = options.log ?? (() => {});
  const signal = options.signal;
  const website = await db.website.findUnique({ where: { id: websiteId }, include: { configuration: true } });
  if (!website) throw new Error("Website not found");
  const cfg = website.configuration;
  if (!cfg) throw new Error(`${website.domain} has no monitoring configuration`);
  if (website.status === "PAUSED" && !options.force) throw new Error(`${website.domain} is paused. Resume it in Websites, or pass --force.`);

  const run = await startRun(db, website.id, options);
  const started = Date.now();
  log(`Run #${run.number} started: ${options.scanType.toLowerCase()} scan of ${website.url}`);

  const heartbeat = setInterval(() => {
    const now = new Date();
    db.$transaction([
      db.monitoringLock.updateMany({ where: { websiteId: website.id, monitoringRunId: run.id }, data: { leaseUntil: new Date(now.getTime() + LEASE_MS) } }),
      db.monitoringRun.update({ where: { id: run.id }, data: { heartbeatAt: now } }),
    ]).catch((error: unknown) => log(`Heartbeat failed: ${error instanceof Error ? error.message : String(error)}`));
  }, HEARTBEAT_MS);
  heartbeat.unref();

  const checkStage: JobStage = options.scanType === "FULL" ? "CRAWL" : "AVAILABILITY";
  const jobs = {
    SITEMAP: await db.monitoringJob.create({ data: { monitoringRunId: run.id, stage: "SITEMAP" } }),
    check: await db.monitoringJob.create({ data: { monitoringRunId: run.id, stage: checkStage } }),
  };
  const crawlRun = await db.crawlRun.create({
    data: { websiteId: website.id, monitoringRunId: run.id, status: "RUNNING", startedAt: new Date() },
  });

  try {
    const policy = defaultFetchPolicy({ userAgent: cfg.userAgent, timeoutMs: cfg.requestTimeoutMs, ...options.fetchPolicy });
    const fetchRetrying = (url: string, wantBody: WantBody, maxBodyBytes = policy.maxBodyBytes) =>
      fetchWithRetry(url, { ...policy, maxBodyBytes }, wantBody, { retries: cfg.retryAttempts, signal });

    const origin = new URL(website.url).origin;
    const mapHost = createHostMapper(website.url, cfg.hostAliases);
    const keptQueryParams = cfg.keptQueryParams;
    const prepare = (raw: string) => {
      const parsed = parseHttpUrl(raw);
      if (!parsed) return null;
      const url = mapHost(parsed);
      const normalized = normalizeUrl(url, { keptQueryParams });
      return normalized ? { url, normalized } : null;
    };
    const scope = createScope({
      domain: website.domain,
      includeWwwVariant: cfg.includeWwwVariant,
      includePatterns: cfg.includePatterns,
      excludePatterns: cfg.excludePatterns,
    });
    const inScope = (url: URL) => scope(url).inScope;

    // ── robots.txt ──
    await db.monitoringJob.update({ where: { id: jobs.SITEMAP.id }, data: { status: "RUNNING", startedAt: new Date(), attempts: 1 } });
    const robotsUrl = `${origin}/robots.txt`;
    const robotsOutcome = await fetchRetrying(robotsUrl, (_u, status) => status === 200, 512 * 1024);
    let robots: RobotsTxt = allowAllRobots();
    let robotsStatus: number | null = null;
    let robotsError: string | null = null;
    let robotsFound = false;
    if (robotsOutcome.ok) {
      robotsStatus = robotsOutcome.response.status;
      if (robotsStatus === 200 && robotsOutcome.response.body) {
        robots = parseRobotsTxt(robotsOutcome.response.body.toString("utf8"), cfg.userAgent);
        robotsFound = true;
      } else if (robotsStatus >= 500) {
        robotsError = `HTTP ${robotsStatus}; treated as allowing everything`;
      }
    } else {
      robotsError = `${classifyError(robotsOutcome.error).message}; treated as allowing everything`;
    }
    const isAllowed = cfg.respectRobotsTxt ? (url: URL) => robots.isAllowed(url) : () => true;
    log(
      robotsFound
        ? `robots.txt: ${robots.ruleCount} rule(s) for ${robots.matchedAgent ?? "no matching agent"}, ${robots.sitemaps.length} sitemap(s) declared${cfg.respectRobotsTxt ? "" : " (rules ignored by configuration)"}`
        : `robots.txt: not used (${robotsError ?? `HTTP ${robotsStatus}`})`,
    );

    // ── sitemaps ──
    const declared = [...new Set(robots.sitemaps.map((s) => prepare(s)?.url.href).filter((s): s is string => Boolean(s)))];
    const sitemapRead = await readSitemaps(
      [...declared.map((url) => ({ url })), { url: `${origin}/sitemap.xml`, optional: declared.length > 0 }],
      (url) => fetchRetrying(url, (_u, status) => status === 200, 50 * 1024 * 1024),
      { signal },
    );
    const sitemapIds = new Map<string, string>();
    const fetchedAt = new Date();
    for (const node of sitemapRead.nodes) {
      const data = {
        isIndex: node.isIndex,
        parentId: node.parentUrl ? sitemapIds.get(node.parentUrl) ?? null : null,
        urlCount: node.urlCount,
        lastStatusCode: node.statusCode,
        isValid: node.isValid,
        errorMessage: node.errorMessage,
        lastFetchedAt: fetchedAt,
      };
      const row = await db.sitemap.upsert({
        where: { websiteId_url: { websiteId: website.id, url: node.url } },
        create: { websiteId: website.id, url: node.url, ...data },
        update: data,
        select: { id: true },
      });
      sitemapIds.set(node.url, row.id);
    }
    await db.sitemap.updateMany({
      where: { websiteId: website.id, OR: [{ lastFetchedAt: { lt: fetchedAt } }, { lastFetchedAt: null }] },
      data: { isValid: false, errorMessage: "Not referenced in the latest scan" },
    });

    const sitemapSeeds: CrawlSeed[] = [];
    let urlsOutOfScope = 0;
    for (const loc of sitemapRead.pageUrls) {
      const prepared = prepare(loc);
      if (prepared && inScope(prepared.url)) sitemapSeeds.push({ url: prepared.url.href, source: "SITEMAP", inSitemap: true });
      else urlsOutOfScope++;
    }
    const invalidSitemaps = sitemapRead.nodes.filter((n) => !n.isValid).length;
    await db.monitoringJob.update({
      where: { id: jobs.SITEMAP.id },
      data: { status: "COMPLETED", finishedAt: new Date(), processed: sitemapRead.nodes.length, total: sitemapRead.nodes.length },
    });
    log(
      `Sitemaps: ${sitemapRead.nodes.length} file(s), ${invalidSitemaps} with errors, ${sitemapRead.pageUrls.length} URL(s) listed, ${sitemapSeeds.length} in scope`,
    );

    // ── seeds ──
    const existing = await db.discoveredUrl.findMany({
      where: { websiteId: website.id },
      select: { normalizedUrl: true, url: true, source: true, depth: true, isManual: true, isActive: true },
    });
    const existingSet = new Set(existing.map((e) => e.normalizedUrl));
    const seeds: CrawlSeed[] = [
      { url: website.url, source: "CRAWL", depth: 0 },
      ...existing.filter((e) => e.isManual).map((e) => ({ url: e.url, source: e.source, depth: 0, isManual: true })),
      ...sitemapSeeds,
    ];
    if (options.scanType === "INCREMENTAL") {
      seeds.push(...existing.filter((e) => e.isActive && !e.isManual).map((e) => ({ url: e.url, source: e.source, depth: e.depth })));
    }
    const maxUrls = Math.min(cfg.maxUrls, options.maxUrlsOverride ?? Number.POSITIVE_INFINITY);
    const homeNormalized = prepare(website.url)?.normalized;

    // ── crawl / availability ──
    await db.monitoringJob.update({ where: { id: jobs.check.id }, data: { status: "RUNNING", startedAt: new Date(), attempts: 1 } });
    const counts: Partial<Record<Availability, number>> = {};
    let processed = 0;
    let newUrls = 0;
    let failed = 0;
    let homeOk = false;

    const onResult = async (r: PageResult) => {
      const now = new Date();
      const data = {
        url: r.url,
        depth: r.depth,
        inSitemap: r.inSitemap,
        isActive: true,
        lastSeenAt: now,
        canonicalUrl: r.canonicalUrl,
        contentType: r.contentType,
        lastStatusCode: r.statusCode,
        lastAvailability: r.availability,
        lastResponseTimeMs: r.responseTimeMs,
        lastCheckedAt: r.robotsBlocked ? null : now,
        ...(r.isManual ? { isManual: true } : {}),
      };
      const row = await db.discoveredUrl.upsert({
        where: { websiteId_normalizedUrl: { websiteId: website.id, normalizedUrl: r.normalizedUrl } },
        create: { websiteId: website.id, normalizedUrl: r.normalizedUrl, source: r.source, firstSeenAt: now, isManual: r.isManual, ...data },
        update: data,
        select: { id: true },
      });
      await db.crawlResult.create({
        data: {
          crawlRunId: crawlRun.id,
          discoveredUrlId: row.id,
          url: r.url,
          statusCode: r.statusCode,
          availability: r.availability,
          responseTimeMs: r.responseTimeMs,
          redirectUrl: r.redirectUrl,
          finalUrl: r.finalUrl,
          contentType: r.contentType,
          contentLength: r.contentLength,
          errorMessage: r.errorMessage,
        },
      });

      processed++;
      counts[r.availability] = (counts[r.availability] ?? 0) + 1;
      if (!existingSet.has(r.normalizedUrl)) newUrls++;
      if (BROKEN.includes(r.availability)) failed++;
      if (r.normalizedUrl === homeNormalized) homeOk = r.availability === "UP" || r.availability === "REDIRECT";

      if (processed % 25 === 0) {
        await db.monitoringJob.update({ where: { id: jobs.check.id }, data: { processed } });
        await db.crawlRun.update({ where: { id: crawlRun.id }, data: { urlsCrawled: processed, urlsFailed: failed } });
      }
      if (processed % 50 === 0) log(`  ${processed} URLs checked, ${failed} failing`);
    };

    const minIntervalMs =
      cfg.respectRobotsTxt && robots.crawlDelaySeconds ? Math.min(robots.crawlDelaySeconds, MAX_CRAWL_DELAY_S) * 1000 : 0;
    if (minIntervalMs) log(`Honouring robots.txt Crawl-delay: one request every ${minIntervalMs / 1000} s`);

    const result = await crawl({
      seeds,
      prepare,
      inScope,
      isAllowed,
      maxUrls,
      maxDepth: cfg.crawlDepth,
      concurrency: cfg.concurrentRequests,
      discoverLinks: options.scanType === "FULL",
      minIntervalMs,
      fetch: (url, wantBody, s) => fetchWithRetry(url, policy, wantBody, { retries: cfg.retryAttempts, signal: s }),
      expected: parseExpectedResponses(cfg.expectedResponses),
      onResult,
      signal,
    });

    // A complete full scan that reached the home page knows every live URL; the rest have gone.
    let deactivated = 0;
    if (options.scanType === "FULL" && !result.truncated && !result.cancelled && homeOk) {
      const gone = await db.discoveredUrl.updateMany({
        where: { websiteId: website.id, isActive: true, isManual: false, lastSeenAt: { lt: new Date(started) } },
        data: { isActive: false },
      });
      deactivated = gone.count;
    }

    const status = result.cancelled ? "CANCELLED" : result.truncated ? "PARTIAL" : "COMPLETED";
    const durationMs = Date.now() - started;
    const summary: RunSummary = {
      scanType: options.scanType,
      robots: {
        url: robotsUrl,
        statusCode: robotsStatus,
        found: robotsFound,
        respected: cfg.respectRobotsTxt,
        matchedAgent: robots.matchedAgent,
        ruleCount: robots.ruleCount,
        crawlDelaySeconds: robots.crawlDelaySeconds,
        sitemaps: robots.sitemaps,
        error: robotsError,
      },
      sitemaps: {
        files: sitemapRead.nodes.length,
        invalid: invalidSitemaps,
        urlsListed: sitemapRead.pageUrls.length,
        urlsInScope: sitemapSeeds.length,
        urlsOutOfScope,
      },
      crawl: {
        discovered: result.discovered,
        checked: result.checked,
        robotsBlocked: result.robotsBlocked,
        newUrls,
        deactivated,
        truncated: result.truncated,
        maxUrls,
      },
      availability: counts,
      hostAliases: cfg.hostAliases,
    };

    const finishedAt = new Date();
    await db.$transaction([
      db.monitoringJob.update({
        where: { id: jobs.check.id },
        data: { status: result.cancelled ? "FAILED" : "COMPLETED", finishedAt, processed, total: result.discovered, errorMessage: result.cancelled ? "Cancelled" : null },
      }),
      db.crawlRun.update({
        where: { id: crawlRun.id },
        data: { status, urlsQueued: result.discovered, urlsCrawled: processed, urlsFailed: failed, finishedAt },
      }),
      db.monitoringRun.update({
        where: { id: run.id },
        data: {
          status,
          finishedAt,
          durationMs,
          urlsChecked: result.checked,
          newUrls,
          failedChecks: failed,
          errorMessage: result.cancelled ? "Cancelled before all URLs were checked" : null,
          summary: summary as unknown as Prisma.InputJsonValue,
        },
      }),
    ]);
    log(
      `Run #${run.number} ${status.toLowerCase()} in ${(durationMs / 1000).toFixed(1)} s: ${result.checked} checked, ${failed} failing, ${newUrls} new` +
        (result.truncated ? `, stopped at the ${maxUrls}-URL limit` : "") +
        (deactivated ? `, ${deactivated} no longer found` : ""),
    );
    return { runId: run.id, runNumber: run.number, status, durationMs, summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const finishedAt = new Date();
    await db.$transaction([
      db.monitoringJob.updateMany({
        where: { monitoringRunId: run.id, status: { in: ["PENDING", "RUNNING"] } },
        data: { status: "FAILED", finishedAt, errorMessage: message.slice(0, 1000) },
      }),
      db.crawlRun.update({ where: { id: crawlRun.id }, data: { status: "FAILED", finishedAt } }),
      db.monitoringRun.update({
        where: { id: run.id },
        data: { status: "FAILED", finishedAt, durationMs: Date.now() - started, errorMessage: message.slice(0, 1000) },
      }),
    ]).catch(() => {});
    throw error;
  } finally {
    clearInterval(heartbeat);
    await db.monitoringLock.deleteMany({ where: { websiteId: website.id, monitoringRunId: run.id } }).catch(() => {});
  }
}
