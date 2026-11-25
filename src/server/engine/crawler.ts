import type { UrlSource } from "@/generated/prisma/enums";
import { classifyOutcome, type CheckResult, type ExpectedResponse, type FetchOutcome, type RedirectHop, type WantBody } from "./http";
import { analyzeHtml, type PageAnalysis } from "./html";

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
  /** Every redirect hop followed, in order. */
  chain: RedirectHop[];
  redirectLoop: boolean;
  /** Status of the last response (after redirects); null on network errors. */
  finalStatus: number | null;
  xRobotsTag: string | null;
  /** SEO facts for in-scope HTML pages that returned 2xx; otherwise null. */
  analysis: PageAnalysis | null;
  /** Normalised in-scope URLs this page links to (excluding itself). */
  outLinks: string[];
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
  /** Full scans follow links; incremental scans only re-check the seeds (pages are still analysed). */
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

  /** Queues a URL (unless `enqueue` is false). Returns its normalised key when it is in scope. */
  const add = (raw: string, meta: Omit<QueueItem, "url" | "normalized">, enqueue = true): string | null => {
    const prepared = options.prepare(raw);
    if (!prepared) return null;
    const existing = known.get(prepared.normalized);
    if (existing) {
      existing.inSitemap ||= meta.inSitemap;
      existing.isManual ||= meta.isManual;
      return prepared.normalized;
    }
    if (!options.inScope(prepared.url)) return null;
    if (!enqueue) return prepared.normalized;
    if (known.size >= options.maxUrls) {
      truncated = true;
      return prepared.normalized;
    }
    const item = { url: prepared.url.href, normalized: prepared.normalized, ...meta };
    known.set(prepared.normalized, item);
    queue.push(item);
    return prepared.normalized;
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
        chain: [],
        redirectLoop: false,
        finalStatus: null,
        xRobotsTag: null,
        analysis: null,
        outLinks: [],
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
      status >= 200 && status < 300 && options.inScope(u) && HTML_TYPES.test(String(headers["content-type"] ?? ""));

    const outcome = await options.fetch(item.url, wantBody, options.signal);
    const check = classifyOutcome(outcome, url, options.expected);

    let analysis: PageAnalysis | null = null;
    const outLinks = new Set<string>();
    if (outcome.ok && outcome.response.body) {
      analysis = analyzeHtml(outcome.response.body.toString("utf8"), outcome.response.url);
      const meta = { depth: item.depth + 1, inSitemap: false, isManual: false };
      for (const link of analysis.links) {
        const key = add(link, { ...meta, source: "CRAWL" }, followLinks);
        if (key && key !== item.normalized) outLinks.add(key);
      }
      if (analysis.canonical) add(analysis.canonical, { ...meta, source: "CANONICAL" }, followLinks);
    }
    const xRobots = outcome.ok ? outcome.response.headers["x-robots-tag"] : undefined;

    checked++;
    await options.onResult({
      ...base(item),
      ...check,
      robotsBlocked: false,
      canonicalUrl: analysis?.canonical ?? null,
      attempts: outcome.attempts,
      chain: outcome.chain,
      redirectLoop: !outcome.ok && outcome.loop,
      finalStatus: outcome.ok ? outcome.response.status : null,
      xRobotsTag: xRobots ? (Array.isArray(xRobots) ? xRobots.join(", ") : xRobots) : null,
      analysis,
      outLinks: [...outLinks],
    });
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
