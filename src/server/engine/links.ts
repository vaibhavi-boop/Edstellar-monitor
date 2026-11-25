import { Parser } from "htmlparser2";

export interface ExtractedLinks {
  /** Absolute URLs from <a href> and <area href>, resolved against <base href>. Not normalised. */
  links: string[];
  canonical: string | null;
}

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

/** Pulls navigable links and the canonical URL out of an HTML page. */
export function extractLinks(html: string, pageUrl: string): ExtractedLinks {
  let base = new URL(pageUrl);
  let baseSet = false;
  const links = new Set<string>();
  let canonical: string | null = null;

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (name === "base" && !baseSet && attrs.href) {
          try {
            base = new URL(attrs.href, base);
            baseSet = true;
          } catch {
            // ignore an invalid <base>
          }
        } else if (name === "a" || name === "area") {
          const href = resolve(attrs.href, base);
          if (href) links.add(href);
        } else if (name === "link" && !canonical && (attrs.rel ?? "").toLowerCase().split(/\s+/).includes("canonical")) {
          canonical = resolve(attrs.href, base);
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.write(html);
  parser.end();
  return { links: [...links], canonical };
}
