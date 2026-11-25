import "server-only";
import { db } from "@/lib/db";

const DAY = 86_400_000;

/** Endpoints with their latest result and success rates. Never returns stored credentials. */
export async function listEndpoints(websiteId: string) {
  const endpoints = await db.apiEndpoint.findMany({
    where: { websiteId },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      url: true,
      method: true,
      authType: true,
      expectedStatus: true,
      expectedFields: true,
      isActive: true,
      lastCheckedAt: true,
      results: { orderBy: { checkedAt: "desc" }, take: 1, select: { ok: true, statusCode: true, responseTimeMs: true, errorMessage: true, checkedAt: true } },
    },
  });
  const ids = endpoints.map((e) => e.id);
  const since = (days: number) => new Date(Date.now() - days * DAY);
  const countsSince = (days: number) =>
    db.apiCheckResult.groupBy({ by: ["apiEndpointId", "ok"], where: { apiEndpointId: { in: ids }, checkedAt: { gte: since(days) } }, _count: { _all: true } });
  const [day, week] = await Promise.all([countsSince(1), countsSince(7)]);
  const rate = (groups: typeof day, id: string) => {
    const total = groups.filter((g) => g.apiEndpointId === id).reduce((n, g) => n + g._count._all, 0);
    const ok = groups.find((g) => g.apiEndpointId === id && g.ok)?._count._all ?? 0;
    return total ? { pct: (ok / total) * 100, total } : null;
  };
  return endpoints.map((e) => ({ ...e, last: e.results[0] ?? null, day: rate(day, e.id), week: rate(week, e.id) }));
}

export async function getEndpoint(id: string) {
  const endpoint = await db.apiEndpoint.findUnique({
    where: { id },
    include: {
      website: { select: { id: true, name: true, domain: true } },
      results: { orderBy: { checkedAt: "desc" }, take: 50 },
    },
  });
  if (!endpoint) return null;
  const { encryptedAuth, ...rest } = endpoint;
  return { ...rest, hasCredentials: Boolean(encryptedAuth) };
}
