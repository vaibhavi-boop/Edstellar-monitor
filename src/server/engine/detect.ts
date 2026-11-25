import { createHash } from "node:crypto";
import type { Availability } from "@/generated/prisma/enums";
import type { RedirectHop } from "./http";
import type { PageAnalysis } from "./html";
import type { SitemapNode } from "./sitemaps";

/**
 * Phase 3 detectors. Pure functions over what a run collected: no database,
 * no network. Each finding carries a stable `key` (fingerprinted together
 * with its type) and a `scope` that tells the reconciler when it may
 * auto-resolve the issue:
 *   page  — about one URL; resolved only if that URL was checked this run
 *   group — about a set of pages (duplicates); resolved only after a run that was not cut short
 *   site  — about the site as a whole (robots.txt, sitemap files, site down)
 */

export type IssueScope = "page" | "group" | "site";

export interface DetectedIssue {
  type: string;
  key: string;
  scope: IssueScope;
  description: string;
  affectedUrl: string | null;
  sourceUrl?: string | null;
  httpStatus?: number | null;
  details?: Record<string, unknown>;
}

export interface PageRecord {
  normalized: string;
  url: string;
  inSitemap: boolean;
  availability: Availability;
  statusCode: number | null;
  finalStatus: number | null;
  finalUrl: string | null;
  chain: RedirectHop[];
  redirectLoop: boolean;
  errorMessage: string | null;
  robotsBlocked: boolean;
  /** robots.txt would disallow this URL (whether or not the website respects it). */
  robotsDisallowed: boolean;
  xRobotsTag: string | null;
  analysis: Omit<PageAnalysis, "links"> | null;
  /** Canonical after host-alias mapping and normalisation. */
  canonicalNormalized: string | null;
  canonicalInScope: boolean;
}

export interface LinkSources {
  count: number;
  /** First few linking pages (display URLs). */
  sources: string[];
}

export interface DetectionInput {
  pages: Map<string, PageRecord>;
  links: Map<string, LinkSources>;
  linksEvaluated: boolean;
  homeNormalized: string;
  robots: { url: string; found: boolean; statusCode: number | null; error: string | null; sitemaps: string[] };
  sitemaps: Array<Omit<SitemapNode, "locs">>;
  /** Normalises a URL the same way the crawl did (host aliases + normalisation). */
  normalize: (url: string) => string | null;
}

export const TITLE_MIN = 30;
export const TITLE_MAX = 60;
const MAX_LIST = 20;
/** Share of analysed pages above which a header condition is reported once for the site. */
const SITE_WIDE_SHARE = 0.8;

const FAILING: readonly Availability[] = ["CLIENT_ERROR", "SERVER_ERROR", "TIMEOUT", "DNS_ERROR", "SSL_ERROR", "CONNECTION_ERROR"];
const TEMPORARY = new Set([302, 303, 307]);

export const hashKey = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);

const restricts = (value: string | null, word: "noindex" | "nofollow") =>
  Boolean(value && new RegExp(`(^|[\\s,:])(${word}|none)($|[\\s,])`, "i").test(value));

function pageIssue(page: PageRecord, type: string, description: string, extra: Partial<DetectedIssue> = {}): DetectedIssue {
  return {
    type,
    key: page.normalized,
    scope: "page",
    description,
    affectedUrl: page.url,
    httpStatus: page.statusCode,
    ...extra,
    details: { page: page.normalized, ...(extra.details ?? {}) },
  };
}

function availabilityIssues(page: PageRecord, out: DetectedIssue[]) {
  if (page.robotsBlocked || page.chain.length > 0 || page.redirectLoop) return; // redirects are audited separately
  const s = page.statusCode;
  switch (page.availability) {
    case "CLIENT_ERROR":
      if (s === 404) out.push(pageIssue(page, "availability.http_404", "The page returns 404 Not Found."));
      else if (s === 410) out.push(pageIssue(page, "availability.http_410", "The page returns 410 Gone."));
      else if (s === 429) out.push(pageIssue(page, "availability.http_429", "The server rate-limited the monitor (HTTP 429) even after retries."));
      else out.push(pageIssue(page, "availability.http_4xx", `The page returns HTTP ${s}.`));
      break;
    case "SERVER_ERROR":
      if (s != null && s >= 500) out.push(pageIssue(page, "availability.http_5xx", `The server returns HTTP ${s}.`));
      else out.push(pageIssue(page, "redirect.broken_destination", page.errorMessage ?? `HTTP ${s} without a usable Location header.`));
      break;
    case "TIMEOUT":
      out.push(pageIssue(page, "availability.timeout", page.errorMessage ?? "No complete response before the timeout."));
      break;
    case "DNS_ERROR":
    case "SSL_ERROR":
    case "CONNECTION_ERROR":
      out.push(pageIssue(page, "availability.connection_error", page.errorMessage ?? "The connection failed.", { details: { availability: page.availability } }));
      break;
  }
}

function redirectIssues(page: PageRecord, input: DetectionInput, out: DetectedIssue[]) {
  if (page.chain.length === 0 && !page.redirectLoop) return;
  const chain = page.chain.map((h) => ({ url: h.url, status: h.status, location: h.location }));
  const details = { chain, finalUrl: page.finalUrl, finalStatus: page.finalStatus };

  if (page.redirectLoop) {
    out.push(pageIssue(page, "redirect.loop", page.errorMessage ?? "The redirects never reach a page.", { details }));
    return;
  }
  if (page.chain.length >= 2) {
    out.push(pageIssue(page, "redirect.chain", `${page.chain.length} redirects in a row before reaching ${page.finalUrl}.`, { details }));
  }
  if (FAILING.includes(page.availability)) {
    out.push(
      pageIssue(page, "redirect.broken_destination", page.errorMessage ?? `The redirect ends at ${page.finalUrl}, which fails.`, {
        details,
        httpStatus: page.finalStatus ?? page.statusCode,
      }),
    );
  }
  const temporary = page.chain.find((h) => TEMPORARY.has(h.status));
  if (temporary) {
    out.push(pageIssue(page, "redirect.temporary", `A temporary ${temporary.status} redirect to ${temporary.location}. Use 301 or 308 if the move is permanent.`, { details }));
  }
  if (page.finalUrl && page.availability === "REDIRECT") {
    const finalKey = input.normalize(page.finalUrl);
    const target = finalKey ? input.pages.get(finalKey) : undefined;
    if (target?.canonicalNormalized && target.canonicalNormalized !== finalKey) {
      out.push(
        pageIssue(page, "redirect.non_canonical_destination", `The redirect lands on ${page.finalUrl}, whose canonical is ${target.analysis?.canonical}.`, {
          details: { ...details, canonical: target.analysis?.canonical },
        }),
      );
    }
  }
}

function linkIssues(input: DetectionInput, out: DetectedIssue[]) {
  for (const [target, link] of input.links) {
    const page = input.pages.get(target);
    if (!page || page.robotsBlocked) continue;
    const details = { page: target, sources: link.sources.slice(0, MAX_LIST), sourceCount: link.count };
    const from = `Linked from ${link.count} page${link.count === 1 ? "" : "s"}.`;
    if (FAILING.includes(page.availability)) {
      const status = page.finalStatus ?? page.statusCode;
      out.push({
        type: "links.broken_internal",
        key: target,
        scope: "page",
        description: `${status ? `Returns HTTP ${status}` : page.errorMessage ?? "Fails"}. ${from}`,
        affectedUrl: page.url,
        sourceUrl: link.sources[0] ?? null,
        httpStatus: status,
        details: { ...details, availability: page.availability },
      });
    } else if (page.availability === "REDIRECT") {
      out.push({
        type: "links.redirected_internal",
        key: target,
        scope: "page",
        description: `Redirects to ${page.finalUrl}. ${from} Link to the destination directly.`,
        affectedUrl: page.url,
        sourceUrl: link.sources[0] ?? null,
        httpStatus: page.statusCode,
        details: { ...details, finalUrl: page.finalUrl },
      });
    }
  }
}

function seoPageIssues(page: PageRecord, input: DetectionInput, out: DetectedIssue[], headerSiteWide: boolean) {
  const a = page.analysis;
  if (!a) return;
  const push = (type: string, description: string, details?: Record<string, unknown>) => out.push(pageIssue(page, type, description, { details }));

  if (a.title === null) push("seo.missing_title", "The page has no <title> element.");
  else if (a.title === "") push("seo.empty_title", "The <title> element is empty.");
  else if (a.title.length > TITLE_MAX) push("seo.title_too_long", `The title is ${a.title.length} characters; search results show about ${TITLE_MAX}.`, { title: a.title });
  else if (a.title.length < TITLE_MIN) push("seo.title_too_short", `The title is ${a.title.length} characters; aim for ${TITLE_MIN}–${TITLE_MAX}.`, { title: a.title });

  if (a.metaDescription === null) push("seo.missing_meta_description", "The page has no meta description.");
  else if (a.metaDescription === "") push("seo.empty_meta_description", "The meta description is empty.");

  const h1 = a.headings.filter((h) => h.level === 1);
  if (h1.length === 0) push("seo.missing_h1", "The page has no H1 heading.");
  else if (h1.length > 1) push("seo.multiple_h1", `The page has ${h1.length} H1 headings.`, { h1: h1.map((h) => h.text).slice(0, MAX_LIST) });
  const empty = a.headings.filter((h) => h.text === "");
  if (empty.length) push("seo.empty_heading", `${empty.length} heading${empty.length === 1 ? " is" : "s are"} empty.`, { levels: empty.map((h) => `H${h.level}`) });
  for (let i = 1; i < a.headings.length; i++) {
    const prev = a.headings[i - 1]!;
    const cur = a.headings[i]!;
    if (cur.level > prev.level + 1) {
      push("seo.heading_hierarchy", `An H${cur.level} ("${cur.text.slice(0, 60)}") follows an H${prev.level} with no H${prev.level + 1} between.`, {
        from: `H${prev.level}`,
        to: `H${cur.level}`,
      });
      break;
    }
  }

  if (a.canonicalCount === 0) push("seo.missing_canonical", "The page has no rel=canonical link.");
  else if (a.canonical) {
    if (!page.canonicalInScope) push("seo.canonical_wrong_domain", `The canonical points to another domain: ${a.canonical}.`, { canonical: a.canonical });
    if (page.url.startsWith("https:") && a.canonical.startsWith("http:")) push("seo.canonical_http", `The canonical uses http: ${a.canonical}.`, { canonical: a.canonical });
    const target = page.canonicalNormalized && page.canonicalNormalized !== page.normalized ? input.pages.get(page.canonicalNormalized) : undefined;
    if (target && FAILING.includes(target.availability)) {
      push("seo.canonical_to_404", `The canonical ${a.canonical} returns ${target.finalStatus ?? target.statusCode ?? "an error"}.`, { canonical: a.canonical });
    } else if (target && (target.chain.length > 0 || target.redirectLoop)) {
      push("seo.canonical_to_redirect", `The canonical ${a.canonical} redirects to ${target.finalUrl}.`, { canonical: a.canonical });
    }
    if (page.inSitemap && page.canonicalNormalized && page.canonicalNormalized !== page.normalized) {
      push("seo.sitemap_canonical_mismatch", `The sitemap lists this URL, but its canonical is ${a.canonical}.`, { canonical: a.canonical });
    }
  }

  if (restricts(a.robotsMeta, "noindex")) push("seo.noindex", `Meta robots: "${a.robotsMeta}".`, { robotsMeta: a.robotsMeta });
  if (restricts(a.robotsMeta, "nofollow")) push("seo.nofollow", `Meta robots: "${a.robotsMeta}".`, { robotsMeta: a.robotsMeta });
  if (!headerSiteWide && (restricts(page.xRobotsTag, "noindex") || restricts(page.xRobotsTag, "nofollow"))) {
    push("seo.x_robots_tag", `The response header X-Robots-Tag is "${page.xRobotsTag}".`, { xRobotsTag: page.xRobotsTag });
  }

  if (a.jsonLd.length === 0) push("seo.missing_schema", "The page has no JSON-LD structured data.");
  const invalid = a.jsonLd.filter((b) => !b.valid);
  if (invalid.length) push("seo.invalid_json_ld", `${invalid.length} JSON-LD block${invalid.length === 1 ? " is" : "s are"} not valid JSON: ${invalid[0]!.error}.`, { errors: invalid.map((b) => b.error) });
  const missing: Record<string, string[]> = {};
  for (const block of a.jsonLd) for (const [type, props] of Object.entries(block.missing)) missing[type] = [...new Set([...(missing[type] ?? []), ...props])];
  if (Object.keys(missing).length) {
    push(
      "seo.schema_missing_property",
      Object.entries(missing).map(([type, props]) => `${type} is missing ${props.join(", ")}`).join("; ") + ".",
      { missing },
    );
  }

  if (!a.ogTitle) push("seo.missing_og_title", "No og:title meta tag.");
  if (!a.ogDescription) push("seo.missing_og_description", "No og:description meta tag.");
  if (!a.ogImage) push("seo.missing_og_image", "No og:image meta tag.");
  if (!a.twitterCard) push("seo.missing_twitter_card", "No twitter:card meta tag.");
}

function duplicates(input: DetectionInput, out: DetectedIssue[]) {
  const titles = new Map<string, PageRecord[]>();
  const descriptions = new Map<string, PageRecord[]>();
  const canonicals = new Map<string, PageRecord[]>();
  for (const page of input.pages.values()) {
    const a = page.analysis;
    if (!a || page.availability !== "UP" || restricts(a.robotsMeta, "noindex")) continue;
    if (a.title) titles.set(a.title, [...(titles.get(a.title) ?? []), page]);
    if (a.metaDescription) descriptions.set(a.metaDescription, [...(descriptions.get(a.metaDescription) ?? []), page]);
    if (page.canonicalNormalized && page.canonicalNormalized !== page.normalized) {
      canonicals.set(page.canonicalNormalized, [...(canonicals.get(page.canonicalNormalized) ?? []), page]);
    }
  }
  const group = (type: string, map: Map<string, PageRecord[]>, label: string, valueKey: string) => {
    for (const [value, pages] of map) {
      if (pages.length < 2) continue;
      out.push({
        type,
        key: hashKey(value),
        scope: "group",
        description: `${pages.length} pages share the ${label} "${value.slice(0, 120)}".`,
        affectedUrl: pages[0]!.url,
        details: { [valueKey]: value, count: pages.length, urls: pages.slice(0, MAX_LIST).map((p) => p.url) },
      });
    }
  };
  group("seo.duplicate_title", titles, "title", "title");
  group("seo.duplicate_meta_description", descriptions, "meta description", "metaDescription");
  for (const [canonical, pages] of canonicals) {
    if (pages.length < 2) continue;
    out.push({
      type: "seo.duplicate_canonical",
      key: canonical,
      scope: "group",
      description: `${pages.length} different pages name ${canonical} as their canonical. Check that the template sets a canonical per page.`,
      affectedUrl: pages[0]!.analysis?.canonical ?? canonical,
      details: { canonical, count: pages.length, urls: pages.slice(0, MAX_LIST).map((p) => p.url) },
    });
  }
}

function sitemapAndRobots(input: DetectionInput, out: DetectedIssue[], headerSiteWide: boolean) {
  for (const node of input.sitemaps) {
    if (!node.problem) continue;
    out.push({
      type: node.problem === "unavailable" ? "sitemap.unavailable" : "sitemap.invalid_xml",
      key: node.url,
      scope: "site",
      description: node.errorMessage ?? "The sitemap could not be read.",
      affectedUrl: node.url,
      httpStatus: node.statusCode,
      details: { parent: node.parentUrl },
    });
  }
  for (const page of input.pages.values()) {
    if (!page.inSitemap || page.robotsBlocked) continue;
    const status = page.finalStatus ?? page.statusCode;
    if (page.availability === "CLIENT_ERROR" && (status === 404 || status === 410)) {
      out.push(pageIssue(page, "sitemap.url_404", `The sitemap lists this URL, but it returns ${status}. Remove it or restore the page.`));
    } else if (page.availability === "SERVER_ERROR" && status != null && status >= 500) {
      out.push(pageIssue(page, "sitemap.url_5xx", `The sitemap lists this URL, but it returns ${status}.`));
    }
    const metaNoindex = restricts(page.analysis?.robotsMeta ?? null, "noindex");
    const headerNoindex = !headerSiteWide && restricts(page.xRobotsTag, "noindex");
    if (metaNoindex || headerNoindex) {
      out.push(pageIssue(page, "sitemap.url_noindex", `The sitemap lists this URL, but it is set to noindex (${metaNoindex ? "meta robots" : "X-Robots-Tag header"}).`));
    }
  }

  const r = input.robots;
  if (r.error) {
    out.push({ type: "robots.unavailable", key: r.url, scope: "site", description: r.error, affectedUrl: r.url, httpStatus: r.statusCode });
  }
  if (r.found && r.sitemaps.length === 0) {
    out.push({
      type: "robots.missing_sitemap",
      key: r.url,
      scope: "site",
      description: "robots.txt has no Sitemap: line, so crawlers must guess where the sitemap is.",
      affectedUrl: r.url,
    });
  }
}

function robotsBlocking(input: DetectionInput, out: DetectedIssue[]) {
  const home = input.pages.get(input.homeNormalized);
  const disallowed = [...input.pages.values()].filter((p) => p.robotsDisallowed);
  if (disallowed.length === 0) return;
  if (home?.robotsDisallowed) {
    out.push({
      type: "seo.blocked_by_robots",
      key: "site",
      scope: "site",
      description: `robots.txt disallows the home page and ${disallowed.length} of ${input.pages.size} URLs checked, so search engines cannot crawl the site. Expected on a staging deployment; a serious problem on the live site.`,
      affectedUrl: input.robots.url,
      details: { count: disallowed.length, examples: disallowed.slice(0, MAX_LIST).map((p) => p.url) },
    });
    return;
  }
  for (const page of disallowed) {
    if (page.inSitemap) out.push(pageIssue(page, "seo.blocked_by_robots", "The sitemap lists this URL, but robots.txt disallows it."));
  }
}

/** Does the X-Robots-Tag restriction cover (nearly) the whole site? Then report it once. */
function headerSiteWideIssue(input: DetectionInput, out: DetectedIssue[]): boolean {
  const analysed = [...input.pages.values()].filter((p) => p.analysis);
  const restricted = analysed.filter((p) => restricts(p.xRobotsTag, "noindex") || restricts(p.xRobotsTag, "nofollow"));
  const home = input.pages.get(input.homeNormalized);
  const homeRestricted = Boolean(home && (restricts(home.xRobotsTag, "noindex") || restricts(home.xRobotsTag, "nofollow")));
  if (!homeRestricted || analysed.length === 0 || restricted.length / analysed.length < SITE_WIDE_SHARE) return false;
  out.push({
    type: "seo.x_robots_tag",
    key: "site",
    scope: "site",
    description: `Every page (${restricted.length} of ${analysed.length} analysed) sends "X-Robots-Tag: ${home!.xRobotsTag}", so none can be indexed, including the URLs in the sitemap. Vercel adds this header to non-production deployments; on the live site it would remove every page from search.`,
    affectedUrl: home!.url,
    details: { xRobotsTag: home!.xRobotsTag, count: restricted.length, analysed: analysed.length },
  });
  return true;
}

export function detectIssues(input: DetectionInput): DetectedIssue[] {
  const out: DetectedIssue[] = [];
  const home = input.pages.get(input.homeNormalized);
  if (home && !home.robotsBlocked && home.availability !== "UP" && home.availability !== "REDIRECT") {
    out.push({
      type: "availability.site_down",
      key: "site",
      scope: "site",
      description: `The home page ${home.url} failed: ${home.errorMessage ?? `HTTP ${home.finalStatus ?? home.statusCode}`}.`,
      affectedUrl: home.url,
      httpStatus: home.finalStatus ?? home.statusCode,
    });
  }

  const headerSiteWide = headerSiteWideIssue(input, out);
  for (const page of input.pages.values()) {
    availabilityIssues(page, out);
    redirectIssues(page, input, out);
    if (page.availability === "UP") seoPageIssues(page, input, out, headerSiteWide);
  }
  if (input.linksEvaluated) linkIssues(input, out);
  duplicates(input, out);
  sitemapAndRobots(input, out, headerSiteWide);
  robotsBlocking(input, out);
  return out;
}

/** Which issue types a run evaluates (so their absence can resolve open issues). */
export function evaluatedPrefixes(linksEvaluated: boolean): string[] {
  return ["availability.", "redirect.", "seo.", "sitemap.", "robots.", ...(linksEvaluated ? ["links."] : [])];
}
