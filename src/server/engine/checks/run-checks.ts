import type { PrismaClient } from "@/generated/prisma/client";
import type { JobStage } from "@/generated/prisma/enums";
import { PERFORMANCE } from "@/lib/thresholds";
import type { DetectedIssue } from "../detect";
import type { FetchPolicy } from "../http";
import { runEndpointCheck } from "./api-run";
import { runPageSpeed } from "./pagespeed";
import { dnsMoved, inspectCertificate, resolveAddresses } from "./ssl";
import { measure } from "./timing";

/**
 * Phase 4 stages of a run: SSL and DNS, HTTP timing (plus optional PageSpeed),
 * and the configured API endpoints. Each stage stores its own results and
 * returns issue findings for the shared reconciler, keyed so that a stage that
 * did not run never resolves another stage's issues (perf:…, psi:…, api:…).
 */

export interface ChecksContext {
  db: PrismaClient;
  websiteId: string;
  runId: string;
  siteUrl: string;
  sslWarningDays: number[];
  pageSpeedEnabled: boolean;
  pageSpeedKey: string | undefined;
  policy: FetchPolicy;
  /** Normalised URL → DiscoveredUrl id for pages that were checked and are up. */
  upPages: Array<{ normalized: string; url: string; id: string; depth: number }>;
  homeNormalized: string;
  log: (message: string) => void;
}

export interface ChecksResult {
  detected: DetectedIssue[];
  checkedKeys: string[];
  evaluated: string[];
  summary: {
    ssl: { valid: boolean; daysRemaining: number | null; addresses: number } | null;
    performance: { measured: number; failed: number; medianTtfbMs: number | null; pageSpeed: number };
    api: { checked: number; failing: number };
  };
}

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

const formatBytes = (n: number) => `${(n / 1024).toFixed(0)} KB`;

export async function runChecks(ctx: ChecksContext): Promise<ChecksResult> {
  const { db } = ctx;
  const detected: DetectedIssue[] = [];
  const checkedKeys: string[] = [];
  const hostname = new URL(ctx.siteUrl).hostname;

  // ── SSL and DNS ──
  const ssl = await stage(db, ctx.runId, "SSL_DNS", async () => {
    const previous = await db.sslCheck.findFirst({ where: { websiteId: ctx.websiteId, hostname }, orderBy: { checkedAt: "desc" }, select: { dnsAddresses: true } });
    const dns = await resolveAddresses(hostname);
    const cert = await inspectCertificate(hostname, ctx.policy.lookup, ctx.policy.timeoutMs);
    await db.sslCheck.create({
      data: {
        websiteId: ctx.websiteId,
        monitoringRunId: ctx.runId,
        hostname,
        valid: cert.valid,
        issuer: cert.issuer,
        subject: cert.subject,
        validFrom: cert.validFrom,
        validTo: cert.validTo,
        daysRemaining: cert.daysRemaining,
        dnsAddresses: dns.addresses,
        errorMessage: cert.errorMessage ?? dns.error,
      },
    });

    const site = (type: string, description: string, details?: Record<string, unknown>): DetectedIssue => ({
      type, key: hostname, scope: "site", description, affectedUrl: `https://${hostname}/`, details,
    });
    if (dns.addresses.length === 0) {
      detected.push(site("dns.resolution_failed", `${hostname} does not resolve: ${dns.error}.`));
    } else if (previous && dnsMoved(previous.dnsAddresses, dns.addresses)) {
      detected.push(site("dns.records_changed", `The addresses of ${hostname} changed from ${previous.dnsAddresses.join(", ")} to ${dns.addresses.join(", ")}.`, { before: previous.dnsAddresses, after: dns.addresses }));
    }
    if (dns.addresses.length > 0 && !cert.reachable) {
      detected.push(site("ssl.https_unavailable", `No HTTPS connection to ${hostname}: ${cert.errorMessage}.`));
    } else if (cert.reachable) {
      const days = cert.daysRemaining;
      const thresholds = [...ctx.sslWarningDays].sort((a, b) => a - b);
      const crossed = days == null ? undefined : thresholds.find((t) => days <= t);
      const details = { issuer: cert.issuer, validTo: cert.validTo?.toISOString(), daysRemaining: days };
      if (days != null && days < 0) detected.push(site("ssl.expired", `The certificate for ${hostname} expired ${-days} day(s) ago.`, details));
      else if (!cert.valid) detected.push(site("ssl.invalid", `The certificate for ${hostname} is not trusted: ${cert.errorMessage}.`, details));
      else if (crossed !== undefined) detected.push(site("ssl.expiring", `The certificate for ${hostname} expires in ${days} day(s) (warning threshold: ${crossed} days).`, { ...details, threshold: crossed }));
    }
    ctx.log(`SSL: ${cert.reachable ? (cert.valid ? `valid, ${cert.daysRemaining} days left (${cert.issuer})` : `not valid: ${cert.errorMessage}`) : `unreachable: ${cert.errorMessage}`}; DNS: ${dns.addresses.join(", ") || dns.error}`);
    return { result: { valid: cert.valid, daysRemaining: cert.daysRemaining, addresses: dns.addresses.length }, processed: 1 };
  });

  // ── HTTP timing (+ PageSpeed) ──
  const performance = await stage(db, ctx.runId, "PERFORMANCE", async () => {
    const home = ctx.upPages.find((p) => p.normalized === ctx.homeNormalized);
    const others = ctx.upPages.filter((p) => p !== home).sort((a, b) => a.depth - b.depth || a.url.localeCompare(b.url));
    const sample = [...(home ? [home] : []), ...others].slice(0, PERFORMANCE.sampleSize);
    let failed = 0;
    const ttfbs: number[] = [];
    for (const page of sample) {
      const { timing } = await measure(page.url, ctx.policy, PERFORMANCE.samplesPerPage);
      if (!timing) {
        failed++;
        continue;
      }
      ttfbs.push(timing.ttfbMs);
      checkedKeys.push(`perf:${page.normalized}`);
      await db.performanceResult.create({
        data: {
          websiteId: ctx.websiteId,
          discoveredUrlId: page.id,
          monitoringRunId: ctx.runId,
          url: page.url,
          source: "HTTP",
          dnsMs: timing.dnsMs,
          connectMs: timing.connectMs,
          tlsMs: timing.tlsMs,
          ttfbMs: timing.ttfbMs,
          totalMs: timing.totalMs,
          htmlBytes: timing.htmlBytes,
        },
      });
      const issue = (type: string, description: string, details: Record<string, unknown>): DetectedIssue => ({
        type, key: `perf:${page.normalized}`, scope: "page", description, affectedUrl: page.url, details: { page: `perf:${page.normalized}`, ...details },
      });
      if (timing.ttfbMs > PERFORMANCE.slowTtfbMs) detected.push(issue("performance.slow_ttfb", `Time to first byte is ${timing.ttfbMs} ms (median of ${PERFORMANCE.samplesPerPage}); the limit is ${PERFORMANCE.slowTtfbMs} ms.`, { ttfbMs: timing.ttfbMs }));
      if (timing.totalMs > PERFORMANCE.slowTotalMs) detected.push(issue("performance.slow_response", `The full HTML response takes ${timing.totalMs} ms; the limit is ${PERFORMANCE.slowTotalMs} ms.`, { totalMs: timing.totalMs }));
      if (timing.htmlBytes > PERFORMANCE.largeHtmlBytes) detected.push(issue("performance.large_html", `The HTML is ${formatBytes(timing.htmlBytes)}; the limit is ${formatBytes(PERFORMANCE.largeHtmlBytes)}.`, { htmlBytes: timing.htmlBytes }));
    }

    let pageSpeed = 0;
    if (ctx.pageSpeedEnabled && !ctx.pageSpeedKey) ctx.log("PageSpeed is enabled for this website but PAGESPEED_API_KEY is not set; skipped.");
    if (ctx.pageSpeedEnabled && ctx.pageSpeedKey) {
      for (const page of sample.slice(0, PERFORMANCE.pageSpeedPages)) {
        try {
          const r = await runPageSpeed(page.url, ctx.pageSpeedKey);
          pageSpeed++;
          checkedKeys.push(`psi:${page.normalized}`);
          await db.performanceResult.create({
            data: { websiteId: ctx.websiteId, discoveredUrlId: page.id, monitoringRunId: ctx.runId, url: page.url, source: "PAGESPEED", ...r },
          });
          if (r.performanceScore != null && r.performanceScore < PERFORMANCE.lowScore) {
            detected.push({
              type: "performance.low_score",
              key: `psi:${page.normalized}`,
              scope: "page",
              description: `PageSpeed performance score (mobile) is ${r.performanceScore}; below ${PERFORMANCE.lowScore}. LCP ${r.lcpMs ?? "?"} ms, CLS ${r.cls ?? "?"}.`,
              affectedUrl: page.url,
              details: { page: `psi:${page.normalized}`, ...r },
            });
          }
        } catch (error) {
          ctx.log(`PageSpeed failed for ${page.url}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    const sorted = [...ttfbs].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)]! : null;
    ctx.log(`Performance: ${sample.length - failed} of ${sample.length} pages measured, median TTFB ${median ?? "—"} ms${pageSpeed ? `, ${pageSpeed} PageSpeed reports` : ""}`);
    return { result: { measured: sample.length - failed, failed, medianTtfbMs: median, pageSpeed }, processed: sample.length };
  });

  // ── API endpoints ──
  const api = await stage(db, ctx.runId, "API", async () => {
    const endpoints = await db.apiEndpoint.findMany({ where: { websiteId: ctx.websiteId, isActive: true }, orderBy: { name: "asc" } });
    let failing = 0;
    for (const endpoint of endpoints) {
      const outcome = await runEndpointCheck(db, endpoint, ctx.policy, ctx.runId);
      const key = `api:${endpoint.id}`;
      checkedKeys.push(key);
      if (!outcome.ok && outcome.errorType) {
        failing++;
        detected.push({
          type: outcome.errorType,
          key,
          scope: "page",
          description: `${endpoint.name} (${endpoint.method} ${endpoint.url}): ${outcome.errorMessage}.`,
          affectedUrl: endpoint.url,
          httpStatus: outcome.statusCode,
          details: { page: key, endpoint: endpoint.name, method: endpoint.method, missingFields: outcome.missingFields.length ? outcome.missingFields : undefined },
        });
      }
    }
    if (endpoints.length) ctx.log(`APIs: ${endpoints.length} checked, ${failing} failing`);
    return { result: { checked: endpoints.length, failing }, processed: endpoints.length };
  });

  return { detected, checkedKeys, evaluated: ["ssl.", "dns.", "performance.", "api."], summary: { ssl, performance, api } };
}
