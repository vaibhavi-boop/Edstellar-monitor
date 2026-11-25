/**
 * robots.txt parser following RFC 9309: groups are selected by product token
 * (case-insensitive, falling back to "*"), groups for the same agent are
 * merged, the longest matching rule wins and "allow" wins a tie. "*" and "$"
 * wildcards are supported. Sitemap and Crawl-delay lines are collected too.
 */
interface Rule {
  allow: boolean;
  pattern: string;
  re: RegExp;
}

export interface RobotsTxt {
  /** Is this path (+ query) allowed for our user agent? */
  isAllowed(url: URL): boolean;
  sitemaps: string[];
  crawlDelaySeconds: number | null;
  /** The group that applied: our product token, "*" or null if none matched. */
  matchedAgent: string | null;
  ruleCount: number;
}

/** "EdstellarMonitor/1.0 (+https://…)" → "edstellarmonitor". */
export function productToken(userAgent: string): string {
  return (userAgent.trim().split(/[\s/]/)[0] ?? "").toLowerCase();
}

function patternToRegExp(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "*") source += ".*";
    else if (ch === "$" && i === pattern.length - 1) source += "$";
    else source += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}`);
}

/** Percent-encodes characters the way they appear on the wire, so rules and URLs compare alike. */
function canonicalPath(value: string): string {
  try {
    return encodeURI(decodeURI(value));
  } catch {
    return value;
  }
}

export function parseRobotsTxt(body: string, userAgent: string): RobotsTxt {
  const token = productToken(userAgent);
  const groups: Array<{ agents: string[]; rules: Rule[]; crawlDelay: number | null }> = [];
  const sitemaps: string[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;

  for (const rawLine of body.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;

    if (key === "sitemap") {
      if (value) sitemaps.push(value);
    } else if ((key === "allow" || key === "disallow") && current) {
      if (!value) continue; // "Disallow:" with no path allows everything
      const pattern = canonicalPath(value);
      current.rules.push({ allow: key === "allow", pattern, re: patternToRegExp(pattern) });
    } else if (key === "crawl-delay" && current) {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }

  const ours = groups.filter((g) => token && g.agents.includes(token));
  const chosen = ours.length ? ours : groups.filter((g) => g.agents.includes("*"));
  const rules = chosen.flatMap((g) => g.rules);
  const delays = chosen.map((g) => g.crawlDelay).filter((d): d is number => d != null);

  return {
    sitemaps: [...new Set(sitemaps)],
    crawlDelaySeconds: delays.length ? Math.max(...delays) : null,
    matchedAgent: ours.length ? token : chosen.length ? "*" : null,
    ruleCount: rules.length,
    isAllowed(url) {
      const path = canonicalPath(url.pathname + url.search);
      if (url.pathname === "/robots.txt") return true;
      let best: Rule | null = null;
      for (const rule of rules) {
        if (!rule.re.test(path)) continue;
        if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) {
          best = rule;
        }
      }
      return best ? best.allow : true;
    },
  };
}

/** Used when robots.txt is missing (4xx), unreachable, or ignored by configuration. */
export function allowAllRobots(sitemaps: string[] = []): RobotsTxt {
  return { isAllowed: () => true, sitemaps, crawlDelaySeconds: null, matchedAgent: null, ruleCount: 0 };
}
