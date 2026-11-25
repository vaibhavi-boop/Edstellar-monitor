import "server-only";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { Availability, UrlSource } from "@/generated/prisma/enums";
import type { RunSummary } from "@/server/engine/run";

export const PAGE_SIZE = 50;

export const STATUS_FILTERS = {
  all: "All statuses",
  up: "Up (2xx)",
  redirect: "Redirects",
  failing: "Failing (any error)",
  client: "Client errors (4xx)",
  server: "Server errors (5xx)",
  network: "Timeouts and network errors",
  unchecked: "Not checked yet",
  blocked: "Blocked",
  inactive: "No longer found",
} as const;
export type StatusFilter = keyof typeof STATUS_FILTERS;

export const SOURCE_FILTERS = { all: "All sources", SITEMAP: "Sitemap", CRAWL: "Crawl", CANONICAL: "Canonical tag", MANUAL: "Added manually" } as const;
export type SourceFilter = keyof typeof SOURCE_FILTERS;

export const SORTS = { url: "URL", status: "Status code", time: "Response time", checked: "Last checked" } as const;
export type SortKey = keyof typeof SORTS;

const FAILING: Availability[] = ["CLIENT_ERROR", "SERVER_ERROR", "TIMEOUT", "DNS_ERROR", "SSL_ERROR", "CONNECTION_ERROR"];

export interface PageFilters {
  q: string;
  status: StatusFilter;
  source: SourceFilter;
  sort: SortKey;
  dir: "asc" | "desc";
  page: number;
}

function pick<T extends string>(value: unknown, allowed: Record<T, unknown>, fallback: T): T {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(allowed, value) ? (value as T) : fallback;
}

/** Reads ?q=&status=&source=&sort=&dir=&page= defensively; anything unknown falls back to the default. */
export function parsePageFilters(params: Record<string, string | string[] | undefined>): PageFilters {
  const one = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]);
  const page = Number(one("page"));
  return {
    q: (one("q") ?? "").trim().slice(0, 200),
    status: pick(one("status"), STATUS_FILTERS, "all"),
    source: pick(one("source"), SOURCE_FILTERS, "all"),
    sort: pick(one("sort"), SORTS, "url"),
    dir: one("dir") === "desc" ? "desc" : "asc",
    page: Number.isInteger(page) && page > 0 ? Math.min(page, 10_000) : 1,
  };
}

function statusWhere(status: StatusFilter): Prisma.DiscoveredUrlWhereInput {
  switch (status) {
    case "up":
      return { lastAvailability: "UP" };
    case "redirect":
      return { lastAvailability: "REDIRECT" };
    case "failing":
      return { lastAvailability: { in: FAILING } };
    case "client":
      return { lastAvailability: "CLIENT_ERROR" };
    case "server":
      return { lastAvailability: "SERVER_ERROR" };
    case "network":
      return { lastAvailability: { in: ["TIMEOUT", "DNS_ERROR", "SSL_ERROR", "CONNECTION_ERROR"] } };
    case "unchecked":
      return { lastAvailability: null };
    case "blocked":
      return { lastAvailability: "BLOCKED" };
    default:
      return {};
  }
}

export async function listPages(websiteId: string, f: PageFilters) {
  const where: Prisma.DiscoveredUrlWhereInput = {
    websiteId,
    isActive: f.status !== "inactive",
    ...statusWhere(f.status),
    ...(f.source !== "all" ? { source: f.source as UrlSource } : {}),
    ...(f.q ? { url: { contains: f.q, mode: "insensitive" as const } } : {}),
  };
  const nulls = f.dir === "asc" ? "last" : "first";
  const orderBy: Prisma.DiscoveredUrlOrderByWithRelationInput[] =
    f.sort === "status"
      ? [{ lastStatusCode: { sort: f.dir, nulls } }, { url: "asc" }]
      : f.sort === "time"
        ? [{ lastResponseTimeMs: { sort: f.dir, nulls } }, { url: "asc" }]
        : f.sort === "checked"
          ? [{ lastCheckedAt: { sort: f.dir, nulls } }, { url: "asc" }]
          : [{ url: f.dir }];

  const [total, rows] = await Promise.all([
    db.discoveredUrl.count({ where }),
    db.discoveredUrl.findMany({
      where,
      orderBy,
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        url: true,
        source: true,
        depth: true,
        inSitemap: true,
        isManual: true,
        lastStatusCode: true,
        lastAvailability: true,
        lastResponseTimeMs: true,
        lastCheckedAt: true,
        crawlResults: { orderBy: { checkedAt: "desc" }, take: 1, select: { errorMessage: true, redirectUrl: true } },
      },
    }),
  ]);
  return { total, rows };
}

export async function pageStats(websiteId: string) {
  const [groups, total, unchecked, inactive, lastRun] = await Promise.all([
    db.discoveredUrl.groupBy({ by: ["lastAvailability"], where: { websiteId, isActive: true }, _count: { _all: true } }),
    db.discoveredUrl.count({ where: { websiteId, isActive: true } }),
    db.discoveredUrl.count({ where: { websiteId, isActive: true, lastAvailability: null } }),
    db.discoveredUrl.count({ where: { websiteId, isActive: false } }),
    db.monitoringRun.findFirst({
      where: { websiteId },
      orderBy: { createdAt: "desc" },
      select: { number: true, status: true, scanType: true, startedAt: true, finishedAt: true, urlsChecked: true, errorMessage: true },
    }),
  ]);
  const count = (a: Availability[]) => groups.filter((g) => g.lastAvailability && a.includes(g.lastAvailability)).reduce((s, g) => s + g._count._all, 0);
  return {
    total,
    up: count(["UP"]),
    redirect: count(["REDIRECT"]),
    failing: count(FAILING),
    blocked: count(["BLOCKED"]),
    unchecked,
    inactive,
    lastRun,
  };
}

export async function sitemapOverview(websiteId: string) {
  const [sitemaps, latest, inSitemap, notInSitemap, failingInSitemap] = await Promise.all([
    db.sitemap.findMany({ where: { websiteId }, orderBy: [{ createdAt: "asc" }, { url: "asc" }] }),
    db.monitoringRun.findFirst({
      where: { websiteId, summary: { not: Prisma.DbNull } },
      orderBy: { createdAt: "desc" },
      select: { number: true, finishedAt: true, startedAt: true, summary: true },
    }),
    db.discoveredUrl.count({ where: { websiteId, isActive: true, inSitemap: true } }),
    db.discoveredUrl.count({ where: { websiteId, isActive: true, inSitemap: false } }),
    db.discoveredUrl.count({ where: { websiteId, isActive: true, inSitemap: true, lastAvailability: { in: FAILING } } }),
  ]);

  // Parents first, children indented beneath them.
  const byParent = new Map<string | null, typeof sitemaps>();
  for (const s of sitemaps) {
    const key = s.parentId && sitemaps.some((p) => p.id === s.parentId) ? s.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), s]);
  }
  const ordered: Array<(typeof sitemaps)[number] & { level: number }> = [];
  const walk = (parent: string | null, level: number) => {
    for (const s of byParent.get(parent) ?? []) {
      ordered.push({ ...s, level });
      walk(s.id, level + 1);
    }
  };
  walk(null, 0);

  return {
    sitemaps: ordered,
    run: latest ? { number: latest.number, at: latest.finishedAt ?? latest.startedAt, summary: latest.summary as unknown as RunSummary } : null,
    inSitemap,
    notInSitemap,
    failingInSitemap,
  };
}
