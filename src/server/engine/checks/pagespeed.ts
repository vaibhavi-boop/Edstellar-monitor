/**
 * Google PageSpeed Insights (Lighthouse, mobile). Only called when the website
 * has PageSpeed enabled and PAGESPEED_API_KEY is set. The request goes to a
 * fixed Google endpoint, so it does not pass through the crawl URL guard.
 */

export interface PageSpeedResult {
  performanceScore: number | null;
  accessibilityScore: number | null;
  bestPracticesScore: number | null;
  seoScore: number | null;
  lcpMs: number | null;
  fcpMs: number | null;
  cls: number | null;
  /** Field data (real users), when Google has enough of it for the URL. */
  inpMs: number | null;
}

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

type Json = Record<string, unknown>;
const get = (obj: unknown, path: string[]): unknown => path.reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Json)[k] : undefined), obj);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const score = (v: unknown) => (num(v) == null ? null : Math.round(num(v)! * 100));
const ms = (v: unknown) => (num(v) == null ? null : Math.round(num(v)!));

export function parsePageSpeed(body: unknown): PageSpeedResult {
  const cat = (id: string) => score(get(body, ["lighthouseResult", "categories", id, "score"]));
  const audit = (id: string) => get(body, ["lighthouseResult", "audits", id, "numericValue"]);
  const cls = num(audit("cumulative-layout-shift"));
  return {
    performanceScore: cat("performance"),
    accessibilityScore: cat("accessibility"),
    bestPracticesScore: cat("best-practices"),
    seoScore: cat("seo"),
    lcpMs: ms(audit("largest-contentful-paint")),
    fcpMs: ms(audit("first-contentful-paint")),
    cls: cls == null ? null : Math.round(cls * 1000) / 1000,
    inpMs: ms(get(body, ["loadingExperience", "metrics", "INTERACTION_TO_NEXT_PAINT", "percentile"])),
  };
}

export async function runPageSpeed(url: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<PageSpeedResult> {
  const params = new URLSearchParams({ url, strategy: "mobile", key: apiKey });
  for (const c of ["performance", "accessibility", "best-practices", "seo"]) params.append("category", c);
  const res = await fetchImpl(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(90_000) });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = get(body, ["error", "message"]);
    throw new Error(`PageSpeed Insights returned HTTP ${res.status}${typeof message === "string" ? `: ${message}` : ""}`);
  }
  return parsePageSpeed(body);
}
