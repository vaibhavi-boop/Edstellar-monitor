import { gunzipSync } from "node:zlib";
import { Parser } from "htmlparser2";
import type { FetchOutcome } from "./http";
import { classifyError } from "./http";

export interface ParsedSitemap {
  kind: "index" | "urlset" | "unknown";
  locs: string[];
}

/** Parses a sitemap index, a urlset, or a plain-text list of URLs. */
export function parseSitemap(text: string): ParsedSitemap {
  const trimmed = text.replace(/^﻿/, "").trimStart();
  if (!trimmed.startsWith("<")) {
    const locs = trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^https?:\/\//i.test(l));
    return { kind: locs.length ? "urlset" : "unknown", locs };
  }

  let kind: ParsedSitemap["kind"] = "unknown";
  const locs: string[] = [];
  const stack: string[] = [];
  let buffer: string | null = null;
  const local = (name: string) => name.toLowerCase().replace(/^.*:/, "");

  const parser = new Parser(
    {
      onopentag(name) {
        const tag = local(name);
        if (stack.length === 0) kind = tag === "sitemapindex" ? "index" : tag === "urlset" ? "urlset" : "unknown";
        stack.push(tag);
        // <loc> directly inside <url> or <sitemap>; image:loc etc. sit inside <image:image> and are skipped.
        if (tag === "loc" && (stack.at(-2) === "url" || stack.at(-2) === "sitemap")) buffer = "";
      },
      ontext(data) {
        if (buffer !== null) buffer += data;
      },
      onclosetag(name) {
        if (local(name) === "loc" && buffer !== null) {
          const value = buffer.trim();
          if (value) locs.push(value);
          buffer = null;
        }
        stack.pop();
      },
    },
    { xmlMode: true, decodeEntities: true },
  );
  parser.write(trimmed);
  parser.end();
  return { kind, locs };
}

const MAX_SITEMAP_BYTES = 50 * 1024 * 1024; // sitemaps.org limit, uncompressed

/** Body as text, gunzipping when the payload is gzip (by magic bytes, whatever the headers say). */
export function sitemapBodyText(body: Buffer): string {
  if (body.length >= 2 && body[0] === 0x1f && body[1] === 0x8b) {
    return gunzipSync(body, { maxOutputLength: MAX_SITEMAP_BYTES }).toString("utf8");
  }
  return body.toString("utf8");
}

export interface SitemapNode {
  url: string;
  parentUrl: string | null;
  isIndex: boolean;
  urlCount: number;
  statusCode: number | null;
  isValid: boolean;
  errorMessage: string | null;
  /** Page URLs listed in this file (urlsets only). */
  locs: string[];
}

export interface SitemapReadResult {
  nodes: SitemapNode[];
  pageUrls: string[];
}

export type SitemapFetch = (url: string) => Promise<FetchOutcome>;

/**
 * Reads sitemap files breadth-first from the given roots, following sitemap
 * indexes up to `maxDepth` levels and `maxFiles` files in total. Optional
 * roots (e.g. /sitemap.xml when robots.txt already declares sitemaps) are
 * dropped silently when they return 404.
 */
export async function readSitemaps(
  roots: Array<{ url: string; optional?: boolean }>,
  fetchSitemap: SitemapFetch,
  limits: { maxFiles?: number; maxDepth?: number; signal?: AbortSignal } = {},
): Promise<SitemapReadResult> {
  const maxFiles = limits.maxFiles ?? 500;
  const maxDepth = limits.maxDepth ?? 3;
  const nodes: SitemapNode[] = [];
  const seen = new Set<string>();
  const queue: Array<{ url: string; parentUrl: string | null; depth: number; optional: boolean }> = [];
  for (const root of roots) {
    if (seen.has(root.url)) continue;
    seen.add(root.url);
    queue.push({ url: root.url, parentUrl: null, depth: 0, optional: root.optional ?? false });
  }

  while (queue.length && nodes.length < maxFiles && !limits.signal?.aborted) {
    const item = queue.shift()!;
    const node: SitemapNode = {
      url: item.url,
      parentUrl: item.parentUrl,
      isIndex: false,
      urlCount: 0,
      statusCode: null,
      isValid: false,
      errorMessage: null,
      locs: [],
    };
    const outcome = await fetchSitemap(item.url);

    if (!outcome.ok) {
      node.statusCode = outcome.chain[0]?.status ?? null;
      node.errorMessage = classifyError(outcome.error).message;
      nodes.push(node);
      continue;
    }
    const { response } = outcome;
    node.statusCode = outcome.chain[0]?.status ?? response.status;
    if (response.status !== 200) {
      if (item.optional && response.status === 404) continue;
      node.errorMessage = `HTTP ${response.status}`;
      nodes.push(node);
      continue;
    }
    if (response.bodyTruncated) {
      node.errorMessage = "Larger than 50 MB; only the first part was read";
    }

    let parsed: ParsedSitemap;
    try {
      parsed = parseSitemap(sitemapBodyText(response.body ?? Buffer.alloc(0)));
    } catch (error) {
      node.errorMessage = `Could not read the file: ${error instanceof Error ? error.message : String(error)}`;
      nodes.push(node);
      continue;
    }

    if (parsed.kind === "unknown") {
      if (item.optional) continue;
      node.errorMessage ??= "Not a sitemap: expected <urlset> or <sitemapindex>";
      nodes.push(node);
      continue;
    }

    node.isValid = !node.errorMessage;
    node.isIndex = parsed.kind === "index";
    node.urlCount = parsed.locs.length;
    if (node.isIndex) {
      if (item.depth >= maxDepth) {
        node.errorMessage = `Sitemap indexes nested deeper than ${maxDepth} levels were not followed`;
      } else {
        for (const loc of parsed.locs) {
          if (seen.has(loc)) continue;
          seen.add(loc);
          queue.push({ url: loc, parentUrl: item.url, depth: item.depth + 1, optional: false });
        }
      }
    } else {
      if (parsed.locs.length > 50_000) node.errorMessage = `Lists ${parsed.locs.length} URLs; the limit per file is 50,000`;
      node.locs = parsed.locs;
    }
    nodes.push(node);
  }

  if (queue.length && nodes.length >= maxFiles) {
    const last = nodes.at(-1);
    if (last) last.errorMessage ??= `Stopped after ${maxFiles} sitemap files`;
  }

  return { nodes, pageUrls: nodes.flatMap((n) => n.locs) };
}
