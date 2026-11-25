import { describe, expect, it } from "vitest";
import { analyzeHtml, analyzeJsonLd } from "@/server/engine/html";
import { detectIssues, type DetectionInput, type PageRecord } from "@/server/engine/detect";

const ORIGIN = "https://site.test";

function page(path: string, overrides: Partial<PageRecord> = {}, html?: string): PageRecord {
  const url = `${ORIGIN}${path}`;
  const analysis = html === undefined ? null : (({ links: _l, ...rest }) => rest)(analyzeHtml(html, url));
  const canonical = analysis?.canonical ?? null;
  return {
    normalized: url,
    url,
    inSitemap: false,
    availability: "UP",
    statusCode: 200,
    finalStatus: 200,
    finalUrl: url,
    chain: [],
    redirectLoop: false,
    errorMessage: null,
    robotsBlocked: false,
    robotsDisallowed: false,
    xRobotsTag: null,
    analysis,
    canonicalNormalized: canonical,
    canonicalInScope: canonical ? canonical.startsWith(ORIGIN) : false,
    ...overrides,
  };
}

const GOOD = (path: string, extra = "") => `<html><head>
  <title>A perfectly reasonable page title for ${path}</title>
  <meta name="description" content="Description for ${path}">
  <link rel="canonical" href="${ORIGIN}${path}">
  <meta property="og:title" content="t"><meta property="og:description" content="d"><meta property="og:image" content="${ORIGIN}/i.png">
  <meta name="twitter:card" content="summary">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Site","url":"${ORIGIN}"}</script>
  </head><body><h1>Heading ${path}</h1><h2>Sub</h2>${extra}</body></html>`;

function input(pages: PageRecord[], overrides: Partial<DetectionInput> = {}): DetectionInput {
  return {
    pages: new Map(pages.map((p) => [p.normalized, p])),
    links: new Map(),
    linksEvaluated: true,
    homeNormalized: `${ORIGIN}/`,
    robots: { url: `${ORIGIN}/robots.txt`, found: true, statusCode: 200, error: null, sitemaps: [`${ORIGIN}/sitemap.xml`] },
    sitemaps: [],
    normalize: (u) => u,
    ...overrides,
  };
}

const types = (issues: ReturnType<typeof detectIssues>) => issues.map((i) => i.type).sort();

describe("analyzeHtml", () => {
  it("reads title, meta, headings, canonical and JSON-LD, ignoring SVG titles", () => {
    const a = analyzeHtml(
      `<html><head><title> Hello &amp; welcome </title><meta name="robots" content="NOINDEX, follow"><link rel="canonical" href="/x"><link rel="canonical" href="/y"></head>
       <body><svg><title>icon</title></svg><h1>One</h1><h3> </h3><script type="application/ld+json">{"@graph":[{"@type":"Course","name":"C"},{"@type":"BreadcrumbList","itemListElement":[1]}]}</script></body></html>`,
      `${ORIGIN}/p`,
    );
    expect(a.title).toBe("Hello & welcome");
    expect(a.robotsMeta).toBe("noindex, follow");
    expect(a.canonical).toBe(`${ORIGIN}/x`);
    expect(a.canonicalCount).toBe(2);
    expect(a.headings).toEqual([{ level: 1, text: "One" }, { level: 3, text: "" }]);
    expect(a.jsonLd[0]).toMatchObject({ valid: true, types: ["Course", "BreadcrumbList"], missing: { Course: ["description", "provider"] } });
  });

  it("flags invalid JSON-LD", () => {
    expect(analyzeJsonLd('{"@type": "Organization",}').valid).toBe(false);
  });
});

describe("detectIssues", () => {
  it("raises nothing for a clean page", () => {
    expect(detectIssues(input([page("/", {}, GOOD("/"))]))).toEqual([]);
  });

  it("finds per-page SEO problems", () => {
    const p = page("/bad", {}, `<html><head><title>Short</title></head><body><h2>a</h2><h4>b</h4><h1>x</h1><h1>y</h1></body></html>`);
    expect(types(detectIssues(input([page("/", {}, GOOD("/")), p])))).toEqual(
      [
        "seo.heading_hierarchy",
        "seo.missing_canonical",
        "seo.missing_meta_description",
        "seo.missing_og_description",
        "seo.missing_og_image",
        "seo.missing_og_title",
        "seo.missing_schema",
        "seo.missing_twitter_card",
        "seo.multiple_h1",
        "seo.title_too_short",
      ].sort(),
    );
  });

  it("groups duplicate titles and descriptions into one issue each", () => {
    const html = GOOD("/a").replace(/\/a/g, "/same");
    const issues = detectIssues(input([page("/", {}, GOOD("/")), page("/a", { canonicalNormalized: `${ORIGIN}/a` }, html), page("/b", { canonicalNormalized: `${ORIGIN}/b` }, html)]));
    const dup = issues.filter((i) => i.type.startsWith("seo.duplicate_"));
    expect(dup.map((d) => d.type).sort()).toEqual(["seo.duplicate_meta_description", "seo.duplicate_title"]);
    expect(dup[0]).toMatchObject({ scope: "group", details: { count: 2 } });
  });

  it("classifies availability and redirect problems", () => {
    const pages = [
      page("/", {}, GOOD("/")),
      page("/gone", { availability: "CLIENT_ERROR", statusCode: 404, finalStatus: 404 }),
      page("/err", { availability: "SERVER_ERROR", statusCode: 503, finalStatus: 503 }),
      page("/slow", { availability: "TIMEOUT", statusCode: null, finalStatus: null }),
      page("/hop", {
        availability: "REDIRECT",
        statusCode: 302,
        chain: [
          { url: `${ORIGIN}/hop`, status: 302, location: `${ORIGIN}/hop2` },
          { url: `${ORIGIN}/hop2`, status: 301, location: `${ORIGIN}/` },
        ],
      }),
      page("/dead-end", { availability: "CLIENT_ERROR", statusCode: 301, finalStatus: 404, chain: [{ url: `${ORIGIN}/dead-end`, status: 301, location: `${ORIGIN}/gone` }] }),
      page("/loop", { availability: "CLIENT_ERROR", statusCode: 301, redirectLoop: true, chain: [{ url: `${ORIGIN}/loop`, status: 301, location: `${ORIGIN}/loop` }] }),
    ];
    expect(types(detectIssues(input(pages)))).toEqual(
      ["availability.http_404", "availability.http_5xx", "availability.timeout", "redirect.broken_destination", "redirect.chain", "redirect.loop", "redirect.temporary"].sort(),
    );
  });

  it("reports broken and redirected internal links with their sources", () => {
    const pages = [
      page("/", {}, GOOD("/")),
      page("/gone", { availability: "CLIENT_ERROR", statusCode: 404, finalStatus: 404 }),
      page("/moved", { availability: "REDIRECT", statusCode: 301, chain: [{ url: `${ORIGIN}/moved`, status: 301, location: `${ORIGIN}/` }] }),
    ];
    const links = new Map([
      [`${ORIGIN}/gone`, { count: 3, sources: [`${ORIGIN}/`, `${ORIGIN}/x`] }],
      [`${ORIGIN}/moved`, { count: 1, sources: [`${ORIGIN}/`] }],
    ]);
    const issues = detectIssues(input(pages, { links }));
    const broken = issues.find((i) => i.type === "links.broken_internal");
    expect(broken).toMatchObject({ affectedUrl: `${ORIGIN}/gone`, sourceUrl: `${ORIGIN}/`, httpStatus: 404, details: { sourceCount: 3 } });
    expect(issues.some((i) => i.type === "links.redirected_internal")).toBe(true);
    expect(detectIssues(input(pages, { links, linksEvaluated: false })).some((i) => i.type.startsWith("links."))).toBe(false);
  });

  it("reports a site-wide X-Robots-Tag and robots.txt block once, not per page", () => {
    const pages = ["/", "/a", "/b", "/c", "/d"].map((p) =>
      page(p, { xRobotsTag: "noindex, nofollow", robotsDisallowed: true, inSitemap: true, canonicalNormalized: `${ORIGIN}${p}` }, GOOD(p)),
    );
    const issues = detectIssues(input(pages));
    expect(issues.filter((i) => i.type === "seo.x_robots_tag")).toHaveLength(1);
    expect(issues.filter((i) => i.type === "seo.x_robots_tag")[0]).toMatchObject({ key: "site", scope: "site" });
    expect(issues.filter((i) => i.type === "seo.blocked_by_robots")).toHaveLength(1);
    expect(issues.some((i) => i.type === "sitemap.url_noindex")).toBe(false);
  });

  it("reports a single page's X-Robots-Tag per page", () => {
    const pages = [page("/", {}, GOOD("/")), page("/a", { xRobotsTag: "noindex", inSitemap: true, canonicalNormalized: `${ORIGIN}/a` }, GOOD("/a"))];
    expect(types(detectIssues(input(pages)))).toEqual(["seo.x_robots_tag", "sitemap.url_noindex"]);
  });

  it("covers sitemap files, robots.txt and a site outage", () => {
    const issues = detectIssues(
      input([page("/", { availability: "SERVER_ERROR", statusCode: 502, finalStatus: 502, errorMessage: null })], {
        robots: { url: `${ORIGIN}/robots.txt`, found: true, statusCode: 200, error: null, sitemaps: [] },
        sitemaps: [
          { url: `${ORIGIN}/a.xml`, parentUrl: null, isIndex: false, urlCount: 0, statusCode: 404, isValid: false, errorMessage: "HTTP 404", problem: "unavailable" },
          { url: `${ORIGIN}/b.xml`, parentUrl: null, isIndex: false, urlCount: 0, statusCode: 200, isValid: false, errorMessage: "Not a sitemap", problem: "invalid" },
        ],
      }),
    );
    expect(types(issues)).toEqual(["availability.http_5xx", "availability.site_down", "robots.missing_sitemap", "sitemap.invalid_xml", "sitemap.unavailable"]);
  });
});
