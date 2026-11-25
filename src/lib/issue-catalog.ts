import type { IssueCategory, Severity } from "@/generated/prisma/enums";

/**
 * Every issue type the monitoring engine can raise. Detectors (Phases 2–4)
 * reference these keys; administrators can ignore types per website.
 */
export interface IssueTypeDefinition {
  key: string;
  category: IssueCategory;
  severity: Severity;
  title: string;
}

const t = (key: string, category: IssueCategory, severity: Severity, title: string): IssueTypeDefinition => ({
  key,
  category,
  severity,
  title,
});

export const ISSUE_TYPES: IssueTypeDefinition[] = [
  // Availability
  t("availability.site_down", "AVAILABILITY", "CRITICAL", "Website is unreachable"),
  t("availability.http_4xx", "AVAILABILITY", "HIGH", "Page returns a 4xx error"),
  t("availability.http_404", "AVAILABILITY", "HIGH", "Page returns 404 Not Found"),
  t("availability.http_410", "AVAILABILITY", "MEDIUM", "Page returns 410 Gone"),
  t("availability.http_429", "AVAILABILITY", "MEDIUM", "Page is rate limited (429)"),
  t("availability.http_5xx", "AVAILABILITY", "CRITICAL", "Page returns a 5xx server error"),
  t("availability.timeout", "AVAILABILITY", "HIGH", "Request timed out"),
  t("availability.connection_error", "AVAILABILITY", "HIGH", "Connection failed"),
  // Broken links
  t("links.broken_internal", "BROKEN_LINK", "HIGH", "Broken internal link"),
  t("links.redirected_internal", "BROKEN_LINK", "LOW", "Internal link points to a redirect"),
  // Redirects
  t("redirect.chain", "REDIRECT", "MEDIUM", "Redirect chain"),
  t("redirect.loop", "REDIRECT", "CRITICAL", "Redirect loop"),
  t("redirect.broken_destination", "REDIRECT", "HIGH", "Redirect leads to an error page"),
  t("redirect.temporary", "REDIRECT", "LOW", "Temporary (302) redirect"),
  t("redirect.non_canonical_destination", "REDIRECT", "MEDIUM", "Redirect to a non-canonical URL"),
  // SEO — metadata
  t("seo.missing_title", "SEO", "HIGH", "Missing title tag"),
  t("seo.empty_title", "SEO", "HIGH", "Empty title tag"),
  t("seo.duplicate_title", "SEO", "MEDIUM", "Duplicate title"),
  t("seo.title_too_long", "SEO", "LOW", "Title is too long"),
  t("seo.title_too_short", "SEO", "LOW", "Title is too short"),
  t("seo.missing_meta_description", "SEO", "MEDIUM", "Missing meta description"),
  t("seo.empty_meta_description", "SEO", "MEDIUM", "Empty meta description"),
  t("seo.duplicate_meta_description", "SEO", "LOW", "Duplicate meta description"),
  // SEO — headings
  t("seo.missing_h1", "SEO", "MEDIUM", "Missing H1"),
  t("seo.multiple_h1", "SEO", "LOW", "Multiple H1 tags"),
  t("seo.empty_heading", "SEO", "LOW", "Empty heading"),
  t("seo.heading_hierarchy", "SEO", "INFO", "Heading levels skip a step"),
  // SEO — canonical
  t("seo.missing_canonical", "SEO", "MEDIUM", "Missing canonical tag"),
  t("seo.duplicate_canonical", "SEO", "MEDIUM", "Several pages share one canonical URL"),
  t("seo.canonical_to_404", "SEO", "HIGH", "Canonical points to a 404 page"),
  t("seo.canonical_to_redirect", "SEO", "MEDIUM", "Canonical points to a redirect"),
  t("seo.canonical_wrong_domain", "SEO", "HIGH", "Canonical on another domain"),
  t("seo.canonical_http", "SEO", "MEDIUM", "Canonical uses http instead of https"),
  // SEO — indexability
  t("seo.noindex", "SEO", "INFO", "Page is set to noindex"),
  t("seo.nofollow", "SEO", "INFO", "Page is set to nofollow"),
  t("seo.x_robots_tag", "SEO", "MEDIUM", "X-Robots-Tag header restricts indexing"),
  t("seo.blocked_by_robots", "SEO", "MEDIUM", "URL is blocked by robots.txt"),
  t("seo.sitemap_canonical_mismatch", "SEO", "MEDIUM", "Sitemap URL differs from its canonical"),
  // SEO — structured data
  t("seo.missing_schema", "SEO", "LOW", "No structured data"),
  t("seo.invalid_json_ld", "SEO", "HIGH", "Invalid JSON-LD"),
  t("seo.schema_missing_property", "SEO", "MEDIUM", "Structured data is missing required properties"),
  // SEO — social
  t("seo.missing_og_title", "SEO", "LOW", "Missing Open Graph title"),
  t("seo.missing_og_description", "SEO", "LOW", "Missing Open Graph description"),
  t("seo.missing_og_image", "SEO", "LOW", "Missing Open Graph image"),
  t("seo.missing_twitter_card", "SEO", "INFO", "Missing Twitter card"),
  // API
  t("api.unavailable", "API", "CRITICAL", "API is unavailable"),
  t("api.http_4xx", "API", "HIGH", "API returns a 4xx error"),
  t("api.http_5xx", "API", "CRITICAL", "API returns a 5xx error"),
  t("api.timeout", "API", "HIGH", "API request timed out"),
  t("api.invalid_json", "API", "HIGH", "API returned invalid JSON"),
  t("api.missing_fields", "API", "HIGH", "API response is missing expected fields"),
  t("api.unexpected_status", "API", "MEDIUM", "API returned an unexpected status"),
  t("api.auth_failure", "API", "HIGH", "API authentication failed"),
  // Performance
  t("performance.slow_ttfb", "PERFORMANCE", "MEDIUM", "Slow time to first byte"),
  t("performance.slow_response", "PERFORMANCE", "MEDIUM", "Slow response"),
  t("performance.large_html", "PERFORMANCE", "LOW", "HTML document is very large"),
  t("performance.low_score", "PERFORMANCE", "MEDIUM", "Low PageSpeed performance score"),
  // SSL & DNS
  t("ssl.invalid", "SSL", "CRITICAL", "SSL certificate is invalid"),
  t("ssl.expiring", "SSL", "HIGH", "SSL certificate expires soon"),
  t("ssl.expired", "SSL", "CRITICAL", "SSL certificate has expired"),
  t("ssl.https_unavailable", "SSL", "CRITICAL", "HTTPS is unavailable"),
  t("dns.resolution_failed", "DNS", "CRITICAL", "Domain does not resolve"),
  t("dns.records_changed", "DNS", "INFO", "DNS records changed"),
  // Sitemap & robots
  t("sitemap.unavailable", "SITEMAP", "HIGH", "Sitemap is unavailable"),
  t("sitemap.invalid_xml", "SITEMAP", "HIGH", "Sitemap XML is invalid"),
  t("sitemap.url_404", "SITEMAP", "HIGH", "Sitemap lists a 404 URL"),
  t("sitemap.url_5xx", "SITEMAP", "HIGH", "Sitemap lists a URL with a server error"),
  t("sitemap.url_noindex", "SITEMAP", "MEDIUM", "Sitemap lists a noindex URL"),
  t("robots.unavailable", "ROBOTS", "MEDIUM", "robots.txt is unavailable"),
  t("robots.missing_sitemap", "ROBOTS", "LOW", "robots.txt does not declare a sitemap"),
];

export const ISSUE_TYPE_KEYS = new Set(ISSUE_TYPES.map((i) => i.key));

export const CATEGORY_LABELS: Record<IssueCategory, string> = {
  AVAILABILITY: "Availability",
  BROKEN_LINK: "Broken links",
  SEO: "SEO",
  REDIRECT: "Redirects",
  API: "API",
  PERFORMANCE: "Performance",
  SSL: "SSL",
  DNS: "DNS",
  SITEMAP: "Sitemap",
  ROBOTS: "robots.txt",
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  INFO: "Informational",
};

export function issueTypesByCategory(): Array<[IssueCategory, IssueTypeDefinition[]]> {
  const groups = new Map<IssueCategory, IssueTypeDefinition[]>();
  for (const type of ISSUE_TYPES) {
    const list = groups.get(type.category) ?? [];
    list.push(type);
    groups.set(type.category, list);
  }
  return [...groups.entries()];
}
