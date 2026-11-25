import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crawl, type PageResult } from "@/server/engine/crawler";
import { defaultFetchPolicy, fetchWithRetry } from "@/server/engine/http";
import { normalizeUrl, parseHttpUrl } from "@/server/engine/normalize";
import { parseRobotsTxt } from "@/server/engine/robots";
import { createScope } from "@/server/engine/scope";

// A tiny site served on 127.0.0.1. The URL guard would (correctly) refuse a
// loopback address, so these tests swap in a permissive checkUrl; the guard
// itself is covered in url-guard.test.ts and engine.test.ts.
let server: http.Server;
let origin = "";
let flakyHits = 0;

const html = (body: string) => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = req.url ?? "/";
    const send = (status: number, body = "", headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" }) => {
      res.writeHead(status, headers);
      res.end(body);
    };
    switch (path) {
      case "/":
        return send(200, html(`
          <a href="/a">A</a><a href="/a#frag">A again</a><a href="/a/?utm_source=x">A tracked</a>
          <a href="/file.pdf">PDF</a><a href="/old">Old</a><a href="/loop">Loop</a><a href="/missing">Missing</a>
          <a href="/flaky">Flaky</a><a href="/slow">Slow</a><a href="mailto:x@y.z">Mail</a>
          <a href="https://other.example/x">External</a><link rel="canonical" href="/">`));
      case "/a":
        return send(200, html(`<a href="/deep">Deep</a><a href="/">Home</a>`));
      case "/deep":
        return send(200, html(`<a href="/deeper">Deeper</a>`));
      case "/deeper":
        return send(200, html(""));
      case "/file.pdf":
        return send(200, "%PDF-1.4", { "content-type": "application/pdf" });
      case "/old":
        return send(301, "", { location: "/a" });
      case "/loop":
        return send(302, "", { location: "/loop" });
      case "/missing":
        return send(404, html("not found"));
      case "/flaky":
        flakyHits++;
        return flakyHits === 1 ? send(503, "", { "retry-after": "0" }) : send(200, html("ok now"));
      case "/slow":
        setTimeout(() => send(200, html("late")), 1500);
        return;
      case "/from-sitemap":
        return send(200, html("listed"));
      default:
        return send(404, "");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function runCrawl(overrides: { maxUrls?: number; maxDepth?: number; discoverLinks?: boolean } = {}) {
  const policy = defaultFetchPolicy({ userAgent: "EdstellarMonitor/1.0 test", timeoutMs: 500, checkUrl: () => {} });
  const scope = createScope({ domain: "127.0.0.1", includeWwwVariant: false, includePatterns: [], excludePatterns: [] });
  const robots = parseRobotsTxt("User-agent: *\nDisallow: /private", policy.userAgent);
  const results = new Map<string, PageResult>();
  const summary = await crawl({
    seeds: [
      { url: `${origin}/`, source: "CRAWL" },
      { url: `${origin}/from-sitemap`, source: "SITEMAP", inSitemap: true },
      { url: `${origin}/a`, source: "SITEMAP", inSitemap: true },
      { url: `${origin}/private/page`, source: "SITEMAP", inSitemap: true },
    ],
    prepare: (raw) => {
      const url = parseHttpUrl(raw);
      const normalized = url && normalizeUrl(url, { keptQueryParams: [] });
      return url && normalized ? { url, normalized } : null;
    },
    inScope: (u) => scope(u).inScope,
    isAllowed: (u) => robots.isAllowed(u),
    maxUrls: overrides.maxUrls ?? 100,
    maxDepth: overrides.maxDepth ?? 2,
    concurrency: 3,
    discoverLinks: overrides.discoverLinks ?? true,
    minIntervalMs: 0,
    fetch: (url, wantBody, signal) => fetchWithRetry(url, policy, wantBody, { retries: 2, signal, baseDelayMs: 1 }),
    expected: [],
    onResult: async (r) => void results.set(new URL(r.normalizedUrl).pathname, r),
  });
  return { summary, results };
}

describe("crawler against a local site", () => {
  it("discovers, de-duplicates and classifies every reachable URL", async () => {
    flakyHits = 0;
    const { summary, results } = await runCrawl();
    const by = (p: string) => results.get(p);

    expect([...results.keys()].sort()).toEqual(
      ["/", "/a", "/deep", "/deeper", "/file.pdf", "/flaky", "/from-sitemap", "/loop", "/missing", "/old", "/private/page", "/slow"].sort(),
    );
    // /a was seen as a sitemap URL, then linked three ways: one row, sitemap source kept.
    expect(by("/a")).toMatchObject({ source: "SITEMAP", inSitemap: true, availability: "UP", statusCode: 200, depth: 0 });
    expect(by("/")).toMatchObject({ availability: "UP", canonicalUrl: `${origin}/` });
    expect(by("/file.pdf")).toMatchObject({ availability: "UP", contentType: "application/pdf", depth: 1 });
    expect(by("/old")).toMatchObject({ availability: "REDIRECT", statusCode: 301, redirectUrl: `${origin}/a` });
    expect(by("/loop")).toMatchObject({ availability: "CLIENT_ERROR", statusCode: 302 });
    expect(by("/missing")).toMatchObject({ availability: "CLIENT_ERROR", statusCode: 404 });
    expect(by("/flaky")).toMatchObject({ availability: "UP", statusCode: 200, attempts: 2 });
    expect(by("/slow")).toMatchObject({ availability: "TIMEOUT", statusCode: null });
    expect(by("/private/page")).toMatchObject({ availability: "BLOCKED", robotsBlocked: true, attempts: 0 });
    // /deep is one hop from the /a seed; /deeper is checked at the depth limit (2) but not read for links.
    expect(by("/deep")?.depth).toBe(1);
    expect(by("/deeper")?.depth).toBe(2);
    expect(summary).toMatchObject({ discovered: 12, checked: 11, robotsBlocked: 1, truncated: false, cancelled: false });
  });

  it("stops following links at the depth limit", async () => {
    flakyHits = 1;
    const { results } = await runCrawl({ maxDepth: 1 });
    expect(results.has("/deep")).toBe(true);
    expect(results.has("/deeper")).toBe(false);
  });

  it("stops at maxUrls and reports truncation", async () => {
    flakyHits = 1;
    const { summary, results } = await runCrawl({ maxUrls: 5 });
    expect(results.size).toBe(5);
    expect(summary).toMatchObject({ discovered: 5, truncated: true });
  });

  it("only re-checks the seeds when link discovery is off (incremental)", async () => {
    flakyHits = 1;
    const { results } = await runCrawl({ discoverLinks: false });
    expect([...results.keys()].sort()).toEqual(["/", "/a", "/from-sitemap", "/private/page"]);
  });
});
