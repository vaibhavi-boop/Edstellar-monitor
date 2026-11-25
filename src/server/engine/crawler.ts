import type { UrlSource } from "@/generated/prisma/enums";
import { classifyOutcome, type CheckResult, type ExpectedResponse, type FetchOutcome, type WantBody } from "./http";
import { extractLinks } from "./links";

export interface CrawlSeed {
  url: string;
  source: UrlSource;
  depth?: number;
  inSitemap?: boolean;
  isManual?: boolean;
}

export interface PageResult extends CheckResult {
  url: string;
  normalizedUrl: string;
  source: UrlSource;
  depth: number;
  inSitemap: boolean;
  isManual: boolean;
  /** Not requested because robots.txt disallows it. */
  robotsBlocked: boolean;
  canonicalUrl: string | null;
  attempts: number;
}

export interface CrawlerOptions {
  seeds: CrawlSeed[];
  /** Maps alias hosts and normalises. Returns null for URLs that cannot be crawled. */
  prepare: (raw: string) => { url: URL; normalized: string } | null;
  inScope: (url: URL) => boolean;
  /** robots.txt decision (always true when robots.txt is ignored). */
  isAllowed: (url: URL) => boolean;
  maxUrls: number;
  maxDepth: number;
  concurrency: number;
  /** Full scans read HTML and follow links; incremental scans only re-check the seeds. */
  discoverLinks: boolean;
  /** Minimum gap between request starts (robots.txt Crawl-delay). */
  minIntervalMs: number;
  fetch: (url: string, wantBody: WantBody, signal?: AbortSignal) => Promise<FetchOutcome & { attempts: number }>;
  expected: readonly ExpectedResponse[];
  onResult: (result: PageResult) => Promise<void>;
  signal?: AbortSignal;
}

export interface CrawlSummary {
  discovered: number;
  checked: number;
  robotsBlocked: number;
  /** maxUrls was reached and further URLs were left out. */
  truncated: boolean;
  cancelled: boolean;
}

interface QueueItem {
  url: string;
  normalized: string;
  source: UrlSource;
  depth: number;
  inSitemap: boolean;
  isManual: boolean;
}

const HTML_TYPES = /^(text\/html|application\/xhtml\+xml)\b/i;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function crawl(options: CrawlerOptions): Promise<CrawlSummary> {
  const known = new Map<string, QueueItem>();
  const queue: QueueItem[] = [];
  let truncated = false;
  let checked = 0;
  let robotsBlocked = 0;

  const add = (raw: string, meta: Omit<QueueItem, "url" | "normalized">) => {
    const prepared = options.prepare(raw);
    if (!prepared) return;
    const existing = known.get(prepared.normalized);
    if (existing) {
      existing.inSitemap ||= meta.inSitemap;
      existing.isManual ||= meta.isManual;
      return;
    }
    if (!options.inScope(prepared.url)) return;
    if (known.size >= options.maxUrls) {
      truncated = true;
      return;
    }
    const item = { url: prepared.url.href, normalized: prepared.normalized, ...meta };
    known.set(prepared.normalized, item);
    queue.push(item);
  };

  for (const seed of options.seeds) {
    add(seed.url, {
      source: seed.source,
      depth: seed.depth ?? 0,
      inSitemap: seed.inSitemap ?? false,
      isManual: seed.isManual ?? false,
    });
  }

  let nextSlot = 0;
  const waitForSlot = async () => {
    if (options.minIntervalMs <= 0) return;
    const now = Date.now();
    const wait = Math.max(0, nextSlot - now);
    nextSlot = Math.max(now, nextSlot) + options.minIntervalMs;
    if (wait) await sleep(wait);
  };

  const base = (item: QueueItem) => ({
    url: item.url,
    normalizedUrl: item.normalized,
    source: item.source,
    depth: item.depth,
    inSitemap: item.inSitemap,
    isManual: item.isManual,
  });

  const processItem = async (item: QueueItem) => {
    const url = new URL(item.url);
    if (!options.isAllowed(url)) {
      robotsBlocked++;
      await options.onResult({
        ...base(item),
        robotsBlocked: true,
        canonicalUrl: null,
        attempts: 0,
        statusCode: null,
        availability: "BLOCKED",
        responseTimeMs: null,
        redirectUrl: null,
        finalUrl: null,
        contentType: null,
        contentLength: null,
        errorMessage: "Disallowed by robots.txt, so it was not requested",
      });
      return;
    }

    await waitForSlot();
    if (options.signal?.aborted) return;
    const followLinks = options.discoverLinks && item.depth < options.maxDepth;
    const wantBody: WantBody = (u, status, headers) =>
      followLinks && status >= 200 && status < 300 && options.inScope(u) && HTML_TYPES.test(String(headers["content-type"] ?? ""));

    const outcome = await options.fetch(item.url, wantBody, options.signal);
    const check = classifyOutcome(outcome, url, options.expected);

    let canonicalUrl: string | null = null;
    if (outcome.ok && outcome.response.body) {
      const { links, canonical } = extractLinks(outcome.response.body.toString("utf8"), outcome.response.url);
      canonicalUrl = canonical;
      const meta = { depth: item.depth + 1, inSitemap: false, isManual: false };
      for (const link of links) add(link, { ...meta, source: "CRAWL" });
      if (canonical) add(canonical, { ...meta, source: "CANONICAL" });
    }

    checked++;
    await options.onResult({ ...base(item), ...check, robotsBlocked: false, canonicalUrl, attempts: outcome.attempts });
  };

  // Worker pool over a growing queue: FIFO order keeps it breadth-first.
  let next = 0;
  let active = 0;
  let fatal: unknown = null;
  await new Promise<void>((resolve) => {
    const pump = () => {
      const stopping = fatal !== null || options.signal?.aborted;
      while (!stopping && active < options.concurrency && next < queue.length) {
        const item = queue[next++]!;
        active++;
        processItem(item)
          .catch((error: unknown) => {
            fatal ??= error;
          })
          .finally(() => {
            active--;
            pump();
          });
      }
      if (active === 0 && (stopping || next >= queue.length)) resolve();
    };
    pump();
  });

  if (fatal) throw fatal;
  return {
    discovered: known.size,
    checked,
    robotsBlocked,
    truncated,
    cancelled: Boolean(options.signal?.aborted) && next < queue.length,
  };
}
