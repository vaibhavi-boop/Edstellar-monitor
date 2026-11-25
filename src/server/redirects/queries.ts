import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export const REDIRECT_PAGE_SIZE = 50;

export const REDIRECT_FILTERS = {
  all: "All redirects",
  chain: "Chains (2+ hops)",
  loop: "Loops",
  broken: "Broken destination",
  temporary: "Temporary (302, 303, 307)",
  http: "HTTP → HTTPS",
} as const;
export type RedirectFilter = keyof typeof REDIRECT_FILTERS;

export function redirectWhere(websiteId: string, filter: RedirectFilter, q: string): Prisma.RedirectWhereInput {
  const search: Prisma.RedirectWhereInput = q
    ? { OR: [{ sourceUrl: { contains: q, mode: "insensitive" } }, { destinationUrl: { contains: q, mode: "insensitive" } }] }
    : {};
  const kind: Record<RedirectFilter, Prisma.RedirectWhereInput> = {
    all: {},
    chain: { hops: { gte: 2 } },
    loop: { isLoop: true },
    broken: { OR: [{ isLoop: true }, { finalStatusCode: null }, { finalStatusCode: { gte: 400 } }] },
    temporary: { statusCode: { in: [302, 303, 307] } },
    http: { isHttpToHttps: true },
  };
  return { websiteId, AND: [search, kind[filter]] };
}

export async function redirectCounts(websiteId: string) {
  const keys = Object.keys(REDIRECT_FILTERS) as RedirectFilter[];
  const counts = await Promise.all(keys.map((k) => db.redirect.count({ where: redirectWhere(websiteId, k, "") })));
  return Object.fromEntries(keys.map((k, i) => [k, counts[i]!])) as Record<RedirectFilter, number>;
}

export async function listRedirects(websiteId: string, filter: RedirectFilter, q: string, page: number) {
  const where = redirectWhere(websiteId, filter, q);
  const [total, rows] = await Promise.all([
    db.redirect.count({ where }),
    db.redirect.findMany({
      where,
      orderBy: [{ hops: "desc" }, { sourceUrl: "asc" }],
      skip: (page - 1) * REDIRECT_PAGE_SIZE,
      take: REDIRECT_PAGE_SIZE,
    }),
  ]);
  return { total, rows };
}

export { csvCell } from "@/lib/csv";
