import { Parser } from "htmlparser2";

/**
 * One streaming pass over a page collects everything phases 2 and 3 need:
 * navigable links, the canonical URL, and the SEO facts (title, meta
 * description, headings, robots meta, Open Graph, Twitter card, JSON-LD).
 */

export interface Heading {
  level: number;
  text: string;
}

export interface JsonLdBlock {
  valid: boolean;
  error?: string;
  /** @type values found at the top level and inside @graph. */
  types: string[];
  /** Required properties missing, per type, e.g. { Course: ["provider"] }. */
  missing: Record<string, string[]>;
}

export interface PageAnalysis {
  links: string[];
  canonical: string | null;
  canonicalCount: number;
  /** null = no <title> element; "" = present but empty. */
  title: string | null;
  metaDescription: string | null;
  headings: Heading[];
  robotsMeta: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  twitterCard: string | null;
  jsonLd: JsonLdBlock[];
}

/**
 * Properties checked per schema.org type: Google's required properties where
 * it defines them, otherwise the properties without which the markup is useless.
 */
export const SCHEMA_REQUIRED: Record<string, string[]> = {
  Organization: ["name", "url"],
  EducationalOrganization: ["name", "url"],
  LocalBusiness: ["name", "address"],
  WebSite: ["name", "url"],
  BreadcrumbList: ["itemListElement"],
  Article: ["headline"],
  NewsArticle: ["headline"],
  BlogPosting: ["headline"],
  Course: ["name", "description", "provider"],
  Product: ["name"],
  Event: ["name", "startDate", "location"],
  FAQPage: ["mainEntity"],
  VideoObject: ["name", "thumbnailUrl", "uploadDate"],
};

function resolve(href: string | undefined, base: URL): string | null {
  if (!href) return null;
  const value = href.trim();
  if (!value || value.startsWith("#") || /^(javascript|mailto|tel|data|sms|ftp):/i.test(value)) return null;
  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}

/**
 * Copies a string out of the parser's buffer. Attribute values and text are
 * V8 "sliced strings" that keep the whole page (~0.5–1 MB) alive; a run keeps
 * every page's analysis until the end, so without copying, memory grows by the
 * full HTML of every page and a 2,500-page crawl exhausts the heap.
 */
export function detach(value: string): string {
  return Buffer.from(value, "utf8").toString("utf8");
}
const detachOrNull = (value: string | null) => (value == null ? null : detach(value));

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

function isEmptyValue(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
}

export function analyzeJsonLd(source: string): JsonLdBlock {
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : "Not valid JSON", types: [], missing: {} };
  }
  const nodes: Array<Record<string, unknown>> = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (Array.isArray(obj["@graph"])) obj["@graph"].forEach(visit);
      if ("@type" in obj) nodes.push(obj);
    }
  };
  visit(data);
  if (nodes.length === 0 && !(data && typeof data === "object")) {
    return { valid: false, error: "JSON-LD must be an object or an array of objects", types: [], missing: {} };
  }

  const types: string[] = [];
  const missing: Record<string, string[]> = {};
  for (const node of nodes) {
    const raw = node["@type"];
    const nodeTypes = (Array.isArray(raw) ? raw : [raw]).filter((t): t is string => typeof t === "string");
    for (const type of nodeTypes) {
      types.push(type);
      const required = SCHEMA_REQUIRED[type];
      if (!required) continue;
      const absent = required.filter((p) => isEmptyValue(node[p]));
      if (absent.length) missing[type] = [...new Set([...(missing[type] ?? []), ...absent])];
    }
  }
  return { valid: true, types: [...new Set(types)], missing };
}

export function analyzeHtml(html: string, pageUrl: string): PageAnalysis {
  let base = new URL(pageUrl);
  let baseSet = false;
  const links = new Set<string>();
  const result: Omit<PageAnalysis, "links"> = {
    canonical: null,
    canonicalCount: 0,
    title: null,
    metaDescription: null,
    headings: [],
    robotsMeta: null,
    ogTitle: null,
    ogDescription: null,
    ogImage: null,
    twitterCard: null,
    jsonLd: [],
  };
  const robots: string[] = [];

  let svgDepth = 0;
  let titleBuffer: string | null = null;
  let heading: { level: number; text: string } | null = null;
  let jsonLdBuffer: string | null = null;

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (name === "svg") svgDepth++;
        if (svgDepth > 0) return;
        switch (name) {
          case "base":
            if (!baseSet && attrs.href) {
              try {
                base = new URL(attrs.href, base);
                baseSet = true;
              } catch {
                // ignore an invalid <base>
              }
            }
            break;
          case "a":
          case "area": {
            const href = resolve(attrs.href, base);
            if (href) links.add(href);
            break;
          }
          case "link":
            if ((attrs.rel ?? "").toLowerCase().split(/\s+/).includes("canonical")) {
              result.canonicalCount++;
              result.canonical ??= resolve(attrs.href, base);
            }
            break;
          case "title":
            if (result.title === null) titleBuffer = "";
            break;
          case "meta": {
            const key = (attrs.name ?? attrs.property ?? "").toLowerCase().trim();
            const content = attrs.content ?? "";
            if (key === "description") result.metaDescription ??= collapse(content);
            else if (key === "robots" || key === "googlebot") robots.push(collapse(content).toLowerCase());
            else if (key === "og:title") result.ogTitle ??= collapse(content);
            else if (key === "og:description") result.ogDescription ??= collapse(content);
            else if (key === "og:image") result.ogImage ??= content.trim();
            else if (key === "twitter:card") result.twitterCard ??= content.trim();
            break;
          }
          case "script":
            if ((attrs.type ?? "").toLowerCase().trim() === "application/ld+json") jsonLdBuffer = "";
            break;
          default:
            if (/^h[1-6]$/.test(name)) heading = { level: Number(name[1]), text: "" };
        }
      },
      ontext(text) {
        if (svgDepth > 0) return;
        if (titleBuffer !== null) titleBuffer += text;
        if (heading) heading.text += text;
        if (jsonLdBuffer !== null) jsonLdBuffer += text;
      },
      onclosetag(name) {
        if (name === "svg") {
          svgDepth = Math.max(0, svgDepth - 1);
          return;
        }
        if (svgDepth > 0) return;
        if (name === "title" && titleBuffer !== null) {
          result.title = collapse(titleBuffer);
          titleBuffer = null;
        } else if (heading && name === `h${heading.level}`) {
          result.headings.push({ level: heading.level, text: collapse(heading.text) });
          heading = null;
        } else if (name === "script" && jsonLdBuffer !== null) {
          result.jsonLd.push(analyzeJsonLd(jsonLdBuffer));
          jsonLdBuffer = null;
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.write(html);
  parser.end();

  result.robotsMeta = robots.length ? robots.join(", ") : null;
  return {
    links: [...links],
    ...result,
    canonical: detachOrNull(result.canonical),
    title: detachOrNull(result.title),
    metaDescription: detachOrNull(result.metaDescription),
    robotsMeta: detachOrNull(result.robotsMeta),
    ogTitle: detachOrNull(result.ogTitle),
    ogDescription: detachOrNull(result.ogDescription),
    ogImage: detachOrNull(result.ogImage),
    twitterCard: detachOrNull(result.twitterCard),
    headings: result.headings.map((h) => ({ level: h.level, text: detach(h.text) })),
    jsonLd: result.jsonLd.map((b) => ({ ...b, error: b.error === undefined ? undefined : detach(b.error) })),
  };
}
