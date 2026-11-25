import { isHostInScope } from "@/server/security/url-guard";

/**
 * Include/exclude patterns are path globs (validated by `urlPatternSchema`):
 * they start with "/", "*" matches within one path segment and "**" matches
 * across segments. A trailing "/**" also matches the folder itself, so
 * "/blog/**" matches "/blog" and "/blog/a/b". A pattern containing "?" is
 * matched against path + query; otherwise against the path only.
 */
export function globToRegExp(pattern: string): RegExp {
  let source = "";
  let rest = pattern;
  let tailAny = false;
  if (rest.endsWith("/**")) {
    rest = rest.slice(0, -3);
    tailAny = true;
  }
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]!;
    if (ch === "*") {
      if (rest[i + 1] === "*") {
        source += ".*";
        i++;
      } else {
        source += "[^/]*";
      }
    } else {
      source += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  if (tailAny) source += "(?:/.*)?";
  return new RegExp(`^${source}$`);
}

export interface PatternMatcher {
  matches(url: URL): boolean;
}

export function compilePatterns(patterns: readonly string[]): PatternMatcher {
  const compiled = patterns.map((p) => ({ re: globToRegExp(p), withQuery: p.includes("?") }));
  return {
    matches(url) {
      return compiled.some(({ re, withQuery }) => re.test(withQuery ? url.pathname + url.search : url.pathname));
    },
  };
}

/**
 * Host aliases: URLs on these hosts are treated as the same path on the
 * monitored website. Used when monitoring a staging deployment whose sitemap
 * and canonical tags still name the production domain.
 */
export function createHostMapper(siteUrl: string, aliases: readonly string[]): (url: URL) => URL {
  const origin = new URL(siteUrl);
  const hosts = new Set(aliases.map((a) => a.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean));
  return (url) => {
    if (!hosts.has(url.hostname.toLowerCase().replace(/\.$/, ""))) return url;
    const mapped = new URL(url.href);
    mapped.protocol = origin.protocol;
    mapped.host = origin.host;
    return mapped;
  };
}

export interface ScopeConfig {
  domain: string;
  includeWwwVariant: boolean;
  includePatterns: readonly string[];
  excludePatterns: readonly string[];
}

export type ScopeDecision = { inScope: true } | { inScope: false; reason: "host" | "include" | "exclude" };

/** Decides whether a URL belongs to the website's crawl. */
export function createScope(config: ScopeConfig) {
  const include = compilePatterns(config.includePatterns);
  const exclude = compilePatterns(config.excludePatterns);
  const hasInclude = config.includePatterns.length > 0;

  return function check(url: URL): ScopeDecision {
    if (!isHostInScope(url.hostname, config.domain, config.includeWwwVariant)) return { inScope: false, reason: "host" };
    // The home page is always in scope so a run has a starting point.
    if (hasInclude && url.pathname !== "/" && !include.matches(url)) return { inScope: false, reason: "include" };
    if (exclude.matches(url)) return { inScope: false, reason: "exclude" };
    return { inScope: true };
  };
}
