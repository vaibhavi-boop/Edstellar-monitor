import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { db } from "@/lib/db";

export const ACTIVE_WEBSITE_COOKIE = "em_website";

export const listWebsites = cache(async () => {
  return db.website.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      configuration: { select: { crawlFrequencyMinutes: true, maxUrls: true } },
      _count: { select: { discoveredUrls: { where: { isActive: true } } } },
      monitoringRuns: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, finishedAt: true, startedAt: true },
      },
    },
  });
});

export async function getWebsite(id: string) {
  return db.website.findUnique({ where: { id }, include: { configuration: true } });
}

/**
 * The website the dashboard is focused on: the one chosen in the switcher,
 * else the first website created.
 */
export const getActiveWebsite = cache(async () => {
  const jar = await cookies();
  const chosen = jar.get(ACTIVE_WEBSITE_COOKIE)?.value;
  if (chosen) {
    const site = await db.website.findUnique({ where: { id: chosen }, select: { id: true, name: true, domain: true, url: true, status: true } });
    if (site) return site;
  }
  return db.website.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, domain: true, url: true, status: true },
  });
});
