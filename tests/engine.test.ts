import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { normalizeUrl } from "@/server/engine/normalize";
import { compilePatterns, createHostMapper, createScope, globToRegExp } from "@/server/engine/scope";
import { parseRobotsTxt, productToken } from "@/server/engine/robots";
import { extractLinks } from "@/server/engine/links";
import { parseSitemap, readSitemaps, sitemapBodyText } from "@/server/engine/sitemaps";
import {
  backoffMs,
  classifyError,
  classifyOutcome,
  createGuardedLookup,
  parseRetryAfter,
  RequestTimeoutError,
  shouldRetry,
  type FetchOutcome,
  type HopResponse,
} from "@/server/engine/http";
import { parseExpectedResponses } from "@/server/engine/run";
import { UrlGuardError } from "@/server/security/url-guard";

const keep = { keptQueryParams: ["page"] };

describe("normalizeUrl", () => {
  it.each([
    ["https://WWW.Example.com:443/Blog/?utm_source=x&page=2#top", "https://www.example.com/Blog?page=2"],
    ["http://example.com:80", "http://example.com/"],
    ["https://example.com/a/b///", "https://example.com/a/b"],
    ["https://example.com/?b=1&page=3&page=1", "https://example.com/?page=1&page=3"],
    ["https://user:pw@example.com./x", "https://example.com/x"],
  ])("%s → %s", (input, expected) => expect(normalizeUrl(input, keep)).toBe(expected));

  it("resolves relative URLs against a base and drops non-http schemes", () => {
    expect(normalizeUrl("../c?page=1", keep, "https://example.com/a/b/")).toBe("https://example.com/a/c?page=1");
    for (const bad of ["mailto:a@b.com", "javascript:void(0)", "tel:123", "ftp://x.com/", "", "http://"]) {
      expect(normalizeUrl(bad, keep)).toBeNull();
    }
  });
});

describe("path globs and scope", () => {
  it("matches single and multi-segment wildcards", () => {
    expect(globToRegExp("/blog/*").test("/blog/post")).toBe(true);
    expect(globToRegExp("/blog/*").test("/blog/a/b")).toBe(false);
    expect(globToRegExp("/blog/**").test("/blog")).toBe(true);
    expect(globToRegExp("/blog/**").test("/blog/a/b")).toBe(true);
    expect(globToRegExp("/blog/**").test("/blogger")).toBe(false);
    expect(globToRegExp("/search*").test("/search-results")).toBe(true);
    expect(globToRegExp("/a.b").test("/axb")).toBe(false);
  });

  it("matches the query string only when the pattern has one", () => {
    const m = compilePatterns(["/*?preview=*"]);
    expect(m.matches(new URL("https://x.com/page?preview=1"))).toBe(true);
    expect(m.matches(new URL("https://x.com/page"))).toBe(false);
  });

  it("keeps the domain and www, applies include and exclude, and always allows the home page", () => {
    const scope = createScope({ domain: "example.com", includeWwwVariant: true, includePatterns: ["/courses/**"], excludePatterns: ["/courses/draft*"] });
    expect(scope(new URL("https://www.example.com/courses/ai")).inScope).toBe(true);
    expect(scope(new URL("https://example.com/")).inScope).toBe(true);
    expect(scope(new URL("https://example.com/about"))).toEqual({ inScope: false, reason: "include" });
    expect(scope(new URL("https://example.com/courses/draft-1"))).toEqual({ inScope: false, reason: "exclude" });
    expect(scope(new URL("https://blog.example.com/courses/ai"))).toEqual({ inScope: false, reason: "host" });
    expect(scope(new URL("https://example.com.evil.net/"))).toEqual({ inScope: false, reason: "host" });
  });

  it("maps host aliases onto the monitored origin", () => {
    const map = createHostMapper("https://edstellar-two.vercel.app", ["www.edstellar.com", "edstellar.com"]);
    expect(map(new URL("https://www.edstellar.com/corporate-training?page=2")).href).toBe("https://edstellar-two.vercel.app/corporate-training?page=2");
    expect(map(new URL("http://edstellar.com/x")).href).toBe("https://edstellar-two.vercel.app/x");
    expect(map(new URL("https://blog.edstellar.com/x")).href).toBe("https://blog.edstellar.com/x");
  });
});

describe("robots.txt", () => {
  const body = `
# comment
User-agent: *
Disallow: /private/
Allow: /private/open$
Disallow: /*.pdf$
Crawl-delay: 2
Sitemap: https://example.com/sitemap_index.xml

User-agent: EdstellarMonitor
User-agent: OtherBot
Disallow: /only-for-us/
Disallow:

Sitemap: https://example.com/extra.xml
`;

  it("uses the * group when our token has no group of its own", () => {
    const robots = parseRobotsTxt(body, "SomethingElse/2.0");
    const allowed = (p: string) => robots.isAllowed(new URL(`https://example.com${p}`));
    expect(robots.matchedAgent).toBe("*");
    expect(allowed("/")).toBe(true);
    expect(allowed("/private/x")).toBe(false);
    expect(allowed("/private/open")).toBe(true);
    expect(allowed("/private/open/more")).toBe(false);
    expect(allowed("/files/a.pdf")).toBe(false);
    expect(allowed("/files/a.pdf?x=1")).toBe(true);
    expect(allowed("/robots.txt")).toBe(true);
    expect(robots.crawlDelaySeconds).toBe(2);
    expect(robots.sitemaps).toEqual(["https://example.com/sitemap_index.xml", "https://example.com/extra.xml"]);
  });

  it("prefers the group naming our product token, case-insensitively", () => {
    expect(productToken("EdstellarMonitor/1.0 (+https://www.edstellar.com)")).toBe("edstellarmonitor");
    const robots = parseRobotsTxt(body, "EdstellarMonitor/1.0 (+https://www.edstellar.com)");
    expect(robots.matchedAgent).toBe("edstellarmonitor");
    expect(robots.isAllowed(new URL("https://example.com/private/x"))).toBe(true);
    expect(robots.isAllowed(new URL("https://example.com/only-for-us/a"))).toBe(false);
    expect(robots.crawlDelaySeconds).toBeNull();
  });

  it("reads a disallow-everything staging file", () => {
    const robots = parseRobotsTxt("User-Agent: *\nDisallow: /\nDisallow: /api/\n", "EdstellarMonitor/1.0");
    expect(robots.isAllowed(new URL("https://x.vercel.app/anything"))).toBe(false);
    expect(robots.ruleCount).toBe(2);
  });
});

describe("extractLinks", () => {
  it("resolves links against <base>, skips non-navigable ones and finds the canonical", () => {
    const html = `<html><head><base href="/en/"><link rel="Canonical" href="https://www.example.com/en/home"></head>
      <body><a href="about">About</a><a href="/courses?page=2&amp;utm=x">C</a><a href="#top">Top</a>
      <a href="mailto:a@b.com">Mail</a><a href="javascript:void(0)">JS</a><area href="https://other.com/x"><a>none</a></body></html>`;
    const { links, canonical } = extractLinks(html, "https://example.com/en/index");
    expect(links).toEqual(["https://example.com/en/about", "https://example.com/courses?page=2&utm=x", "https://other.com/x"]);
    expect(canonical).toBe("https://www.example.com/en/home");
  });
});

describe("sitemaps", () => {
  it("parses urlsets and ignores image locations", () => {
    const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
      <url><loc> https://example.com/a?x=1&amp;y=2 </loc><image:image><image:loc>https://cdn.example.com/i.png</image:loc></image:image></url>
      <url><loc>https://example.com/b</loc></url></urlset>`;
    expect(parseSitemap(xml)).toEqual({ kind: "urlset", locs: ["https://example.com/a?x=1&y=2", "https://example.com/b"] });
  });

  it("parses sitemap indexes, plain-text sitemaps and gzip", () => {
    const index = `<sitemapindex><sitemap><loc>https://example.com/s1.xml</loc></sitemap></sitemapindex>`;
    expect(parseSitemap(index)).toEqual({ kind: "index", locs: ["https://example.com/s1.xml"] });
    expect(parseSitemap("https://example.com/a\nnot a url\nhttps://example.com/b\n")).toEqual({ kind: "urlset", locs: ["https://example.com/a", "https://example.com/b"] });
    expect(parseSitemap("<html><body>404</body></html>").kind).toBe("unknown");
    expect(sitemapBodyText(gzipSync(Buffer.from("<urlset/>")))).toBe("<urlset/>");
  });

  it("follows indexes, records errors and drops a missing optional /sitemap.xml", async () => {
    const files: Record<string, { status: number; body: string }> = {
      "https://e.com/index.xml": { status: 200, body: `<sitemapindex><sitemap><loc>https://e.com/a.xml</loc></sitemap><sitemap><loc>https://e.com/gone.xml</loc></sitemap></sitemapindex>` },
      "https://e.com/a.xml": { status: 200, body: `<urlset><url><loc>https://e.com/1</loc></url><url><loc>https://e.com/2</loc></url></urlset>` },
      "https://e.com/gone.xml": { status: 404, body: "" },
      "https://e.com/sitemap.xml": { status: 404, body: "" },
    };
    const fetchFile = async (url: string): Promise<FetchOutcome> => {
      const f = files[url] ?? { status: 404, body: "" };
      return { ok: true, chain: [], loop: false, response: { url, status: f.status, headers: {}, timeMs: 1, body: Buffer.from(f.body), bodyTruncated: false } };
    };
    const result = await readSitemaps([{ url: "https://e.com/index.xml" }, { url: "https://e.com/sitemap.xml", optional: true }], fetchFile);
    expect(result.pageUrls).toEqual(["https://e.com/1", "https://e.com/2"]);
    expect(result.nodes.map((n) => [n.url, n.isIndex, n.urlCount, n.isValid, n.parentUrl])).toEqual([
      ["https://e.com/index.xml", true, 2, true, null],
      ["https://e.com/a.xml", false, 2, true, "https://e.com/index.xml"],
      ["https://e.com/gone.xml", false, 0, false, "https://e.com/index.xml"],
    ]);
    expect(result.nodes[2]?.errorMessage).toBe("HTTP 404");
  });
});

describe("classification", () => {
  const response = (status: number, url = "https://e.com/x", headers: Record<string, string> = {}): HopResponse => ({
    url, status, headers, timeMs: 42, body: null, bodyTruncated: false,
  });
  const ok = (status: number, chain: FetchOutcome["chain"] = []): FetchOutcome => ({ ok: true, chain, loop: false, response: response(status) });
  const url = new URL("https://e.com/x");

  it("maps status codes and redirects", () => {
    expect(classifyOutcome(ok(200), url)).toMatchObject({ statusCode: 200, availability: "UP", responseTimeMs: 42 });
    expect(classifyOutcome(ok(404), url).availability).toBe("CLIENT_ERROR");
    expect(classifyOutcome(ok(503), url).availability).toBe("SERVER_ERROR");
    const hop = { url: "https://e.com/x", status: 301, location: "https://e.com/y" };
    expect(classifyOutcome(ok(200, [hop]), url)).toMatchObject({ statusCode: 301, availability: "REDIRECT", redirectUrl: "https://e.com/y" });
    const broken = classifyOutcome(ok(404, [hop]), url);
    expect(broken).toMatchObject({ statusCode: 301, availability: "CLIENT_ERROR" });
    expect(broken.errorMessage).toContain("returns HTTP 404");
  });

  it("treats expected responses as up", () => {
    const expected = parseExpectedResponses([{ pattern: "/admin/**", status: 401 }, { bad: true }]);
    expect(expected).toEqual([]); // the whole list is rejected when an entry is malformed
    const valid = parseExpectedResponses([{ pattern: "/admin/**", status: 401 }]);
    expect(classifyOutcome(ok(401), new URL("https://e.com/admin/x"), valid).availability).toBe("UP");
    expect(classifyOutcome(ok(401), new URL("https://e.com/other"), valid).availability).toBe("CLIENT_ERROR");
  });

  it("maps network errors", () => {
    const err = (code: string) => Object.assign(new Error(code), { code });
    expect(classifyError(err("ENOTFOUND")).availability).toBe("DNS_ERROR");
    expect(classifyError(err("CERT_HAS_EXPIRED")).availability).toBe("SSL_ERROR");
    expect(classifyError(err("ERR_TLS_CERT_ALTNAME_INVALID")).availability).toBe("SSL_ERROR");
    expect(classifyError(err("ECONNREFUSED")).availability).toBe("CONNECTION_ERROR");
    expect(classifyError(new RequestTimeoutError(15000)).availability).toBe("TIMEOUT");
    expect(classifyError(new UrlGuardError("private")).availability).toBe("BLOCKED");
    const loop: FetchOutcome = { ok: false, chain: [], error: new Error("Redirect loop back to x"), failedUrl: "x", loop: true };
    expect(classifyOutcome(loop, url).availability).toBe("CLIENT_ERROR");
  });

  it("retries transient failures only, with bounded backoff", () => {
    expect(shouldRetry(ok(503))).toBe(true);
    expect(shouldRetry(ok(429))).toBe(true);
    expect(shouldRetry(ok(404))).toBe(false);
    expect(shouldRetry({ ok: false, chain: [], error: Object.assign(new Error(), { code: "ECONNRESET" }), failedUrl: "", loop: false })).toBe(true);
    expect(shouldRetry({ ok: false, chain: [], error: Object.assign(new Error(), { code: "ENOTFOUND" }), failedUrl: "", loop: false })).toBe(false);
    expect(parseRetryAfter("5")).toBe(5000);
    expect(parseRetryAfter("3600")).toBe(60_000);
    expect(parseRetryAfter(new Date(Date.now() + 10_000).toUTCString(), Date.now())).toBeGreaterThan(8000);
    expect(parseRetryAfter("soon")).toBeNull();
    expect(backoffMs(0, 1000, () => 0)).toBe(500);
    expect(backoffMs(2, 1000, () => 1)).toBe(4000);
    expect(backoffMs(20, 1000, () => 1)).toBe(30_000);
  });
});

describe("guarded DNS lookup", () => {
  const run = (records: string[], all: boolean) =>
    new Promise<{ error: unknown; result: unknown }>((resolve) => {
      const lookup = createGuardedLookup(async () => records.map((address) => ({ address })));
      (lookup as unknown as (h: string, o: object, cb: (e: unknown, r: unknown) => void) => void)("example.com", { all }, (error, result) =>
        resolve({ error, result }),
      );
    });

  it("refuses a hostname when any address is private", async () => {
    const { error } = await run(["93.184.216.34", "10.0.0.5"], true);
    expect(error).toBeInstanceOf(UrlGuardError);
  });

  it("returns public addresses in both callback shapes", async () => {
    expect((await run(["93.184.216.34"], true)).result).toEqual([{ address: "93.184.216.34", family: 4 }]);
    expect((await run(["93.184.216.34"], false)).result).toBe("93.184.216.34");
  });
});
