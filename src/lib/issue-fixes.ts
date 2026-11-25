/** Suggested fix shown on the issue page, per issue type. */
export const ISSUE_FIXES: Record<string, string> = {
  "availability.site_down":
    "Check the hosting provider's status page and the latest deployment. Confirm DNS still points at the host and that the TLS certificate is valid. Roll back the last release if it caused the outage.",
  "availability.http_4xx":
    "Check whether the page should exist. If it moved, add a 301 redirect to the new address; if access is restricted on purpose, add an expected response for this path in the website settings.",
  "availability.http_404":
    "Restore the page, or add a 301 redirect to the closest live page. Then fix the internal links and sitemap entries that still point here (see Broken links).",
  "availability.http_410":
    "410 tells search engines the page is gone for good. If that is intended, remove it from the sitemap and internal links; otherwise restore it or redirect it.",
  "availability.http_429":
    "The server or a firewall/CDN rule is rate limiting the monitor. Allow-list the monitor's user agent, or lower 'Concurrent requests' in the website settings.",
  "availability.http_5xx":
    "Look up the request in the application and hosting logs around the time of the check. Server errors usually point to an exception, a timeout to a dependency, or a failed deployment.",
  "availability.timeout":
    "Find out why the page is slow to respond (uncached server rendering, slow database or API calls). If it is legitimately slow, raise the request timeout in the website settings.",
  "availability.connection_error":
    "The connection failed before HTTP started (DNS, TLS or network). Check the DNS records, the certificate and whether the host is reachable from outside your network.",
  "links.broken_internal":
    "Edit the linking pages (listed below) to point at a working URL, or add a 301 redirect from the broken URL. Links in shared templates (header, footer) fix many pages at once.",
  "links.redirected_internal":
    "Update the links to point straight at the final URL. Each redirect adds a round trip for visitors and wastes crawl budget.",
  "redirect.chain":
    "Point the first URL directly at the final destination with one 301, and update internal links to the final URL.",
  "redirect.loop":
    "Inspect the redirect rules (hosting config, CMS, middleware) for two rules that send URLs back and forth, often trailing-slash or www rules fighting each other.",
  "redirect.broken_destination":
    "Change the redirect to point at a working page, or restore the destination page.",
  "redirect.temporary":
    "If the move is permanent, change the 302/307 to a 301/308 so search engines transfer the ranking to the new URL.",
  "redirect.non_canonical_destination":
    "Redirect to the canonical URL itself, so the redirect target and the canonical tag agree.",
  "seo.missing_title": "Add a unique, descriptive <title> of 30–60 characters to the page template.",
  "seo.empty_title": "Fill the <title> element with a unique, descriptive title of 30–60 characters.",
  "seo.duplicate_title": "Give each page its own title that describes its specific content, for example by including the course or category name.",
  "seo.title_too_long": "Shorten the title to about 60 characters, keeping the most important words first. Longer titles are cut off in search results.",
  "seo.title_too_short": "Expand the title to 30–60 characters so it describes the page and includes the main search phrase.",
  "seo.missing_meta_description": "Add a <meta name=\"description\"> of 120–160 characters summarising the page. Search engines often show it as the snippet.",
  "seo.empty_meta_description": "Fill the meta description with a 120–160 character summary of the page.",
  "seo.duplicate_meta_description": "Write a description specific to each page. Template defaults repeated across pages are usually ignored by search engines.",
  "seo.missing_h1": "Add one H1 that states the page's main topic, usually the visible page title.",
  "seo.multiple_h1": "Keep a single H1 for the main topic and turn the others into H2s.",
  "seo.empty_heading": "Remove empty heading elements or give them text. Screen readers announce them as headings with nothing in them.",
  "seo.heading_hierarchy": "Use heading levels in order (H1 → H2 → H3) without skipping. Style headings with CSS instead of choosing a level for its size.",
  "seo.missing_canonical": "Add <link rel=\"canonical\" href=\"…\"> pointing at the page's preferred URL (usually itself).",
  "seo.duplicate_canonical": "Check the template that outputs the canonical tag: each page should normally name its own URL, not a shared one.",
  "seo.canonical_to_404": "Point the canonical at a live URL, normally the page itself.",
  "seo.canonical_to_redirect": "Point the canonical at the final URL rather than one that redirects.",
  "seo.canonical_wrong_domain":
    "Make the canonical use the site's own domain. On a staging deployment, add the production domain as a host alias in the website settings if the canonical is intentional.",
  "seo.canonical_http": "Use the https:// URL in the canonical tag.",
  "seo.noindex": "If the page should appear in search, remove noindex from the robots meta tag. Leave it for pages that should stay out (thank-you pages, internal search).",
  "seo.nofollow": "Remove nofollow from the robots meta tag unless you intend search engines to ignore every link on the page.",
  "seo.x_robots_tag":
    "Remove the noindex/nofollow X-Robots-Tag response header for pages that should be indexed. On Vercel, preview deployments add it automatically; the production domain does not.",
  "seo.blocked_by_robots": "Remove the Disallow rule that matches this URL from robots.txt, or remove the URL from the sitemap if it should not be crawled.",
  "seo.sitemap_canonical_mismatch": "List only canonical URLs in the sitemap: either list the canonical URL instead, or make this page canonical to itself.",
  "seo.missing_schema": "Add JSON-LD structured data that fits the page, e.g. Course for course pages, Organization on the home page and BreadcrumbList everywhere.",
  "seo.invalid_json_ld": "Fix the JSON syntax in the <script type=\"application/ld+json\"> block (often a trailing comma or an unescaped quote). Validate with Google's Rich Results Test.",
  "seo.schema_missing_property": "Add the missing properties listed below to the structured data so it qualifies for rich results.",
  "seo.missing_og_title": "Add <meta property=\"og:title\"> so shared links show a proper title on LinkedIn, Facebook and messaging apps.",
  "seo.missing_og_description": "Add <meta property=\"og:description\"> with a one-sentence summary for link previews.",
  "seo.missing_og_image": "Add <meta property=\"og:image\"> with an absolute URL to a 1200×630 image for link previews.",
  "seo.missing_twitter_card": "Add <meta name=\"twitter:card\" content=\"summary_large_image\"> for link previews on X.",
  "sitemap.unavailable": "Make sure the sitemap URL returns 200 with XML, and that robots.txt declares the right address.",
  "sitemap.invalid_xml": "Regenerate the sitemap so it is valid <urlset> or <sitemapindex> XML with at most 50,000 URLs and 50 MB per file.",
  "sitemap.url_404": "Remove the URL from the sitemap, or restore the page. Sitemaps should list only live, canonical, indexable URLs.",
  "sitemap.url_5xx": "Fix the server error on the page; if it persists, take the URL out of the sitemap until it works.",
  "sitemap.url_noindex": "Either remove noindex from the page or remove the page from the sitemap; the two signals contradict each other.",
  "robots.unavailable": "Make robots.txt return 200 (or 404 if you have none). Server errors on robots.txt can make search engines stop crawling the site.",
  "robots.missing_sitemap": "Add a line such as \"Sitemap: https://www.example.com/sitemap.xml\" to robots.txt.",
};

export function suggestedFix(type: string): string | null {
  return ISSUE_FIXES[type] ?? null;
}
