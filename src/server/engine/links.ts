import { analyzeHtml } from "./html";

export interface ExtractedLinks {
  /** Absolute URLs from <a href> and <area href>, resolved against <base href>. Not normalised. */
  links: string[];
  canonical: string | null;
}

/** Navigable links and the canonical URL of a page (a subset of `analyzeHtml`). */
export function extractLinks(html: string, pageUrl: string): ExtractedLinks {
  const { links, canonical } = analyzeHtml(html, pageUrl);
  return { links, canonical };
}
