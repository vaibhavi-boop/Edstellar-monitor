/**
 * URL normalisation. Two URLs that normalise to the same string are the same
 * page for discovery purposes (`DiscoveredUrl.normalizedUrl` is unique per
 * website). The original URL is kept for fetching.
 *
 * Rules:
 * - http and https only; anything else (mailto:, tel:, javascript:, data:) is dropped
 * - host lower-cased, trailing dot removed; default port removed
 * - fragment removed
 * - trailing slash removed except on the root path ("/blog/" → "/blog")
 * - query parameters not listed in `keptQueryParams` are removed, the rest sorted
 * - the scheme is kept: http:// and https:// stay distinct (an http URL that
 *   redirects to https shows up as a redirect, which is useful to see)
 */
export interface NormalizeOptions {
  keptQueryParams: readonly string[];
}

export function parseHttpUrl(input: string, base?: string | URL): URL | null {
  const raw = input.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url;
}

export function normalizeUrl(input: string | URL, options: NormalizeOptions, base?: string | URL): string | null {
  const url = typeof input === "string" ? parseHttpUrl(input, base) : new URL(input.href);
  if (!url) return null;

  url.hash = "";
  url.username = "";
  url.password = "";
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) url.port = "";

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  }

  const kept = new Set(options.keptQueryParams.map((p) => p.toLowerCase()));
  const params = [...url.searchParams.entries()]
    .filter(([key]) => kept.has(key.toLowerCase()))
    .sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  url.search = "";
  for (const [key, value] of params) url.searchParams.append(key, value);

  return url.href;
}
