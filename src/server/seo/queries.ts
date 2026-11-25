import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export const SEO_PAGE_SIZE = 50;

export const SEO_PROBLEMS = {
  all: "All pages",
  no_title: "Missing or empty title",
  title_length: "Title outside 30–60 characters",
  no_description: "Missing or empty description",
  no_h1: "No H1",
  multi_h1: "More than one H1",
  no_canonical: "No canonical",
  not_indexable: "Not indexable",
  no_schema: "No structured data",
  bad_json_ld: "Invalid JSON-LD",
  no_og_image: "No Open Graph image",
} as const;
export type SeoProblem = keyof typeof SEO_PROBLEMS;

export function problemWhere(problem: SeoProblem): Prisma.SeoAuditResultWhereInput {
  switch (problem) {
    case "no_title":
      return { OR: [{ title: null }, { title: "" }] };
    case "title_length":
      return { OR: [{ titleLength: { gt: 60 } }, { titleLength: { lt: 30, gt: 0 } }] };
    case "no_description":
      return { OR: [{ metaDescription: null }, { metaDescription: "" }] };
    case "no_h1":
      return { h1Count: 0 };
    case "multi_h1":
      return { h1Count: { gt: 1 } };
    case "no_canonical":
      return { canonicalUrl: null };
    case "not_indexable":
      return { isIndexable: false };
    case "no_schema":
      return { schemaTypes: { isEmpty: true } };
    case "bad_json_ld":
      return { jsonLdValid: false };
    case "no_og_image":
      return { OR: [{ ogImage: null }, { ogImage: "" }] };
    default:
      return {};
  }
}

/** The latest run of this website that produced SEO audit rows. */
export async function latestSeoRun(websiteId: string) {
  return db.monitoringRun.findFirst({
    where: { websiteId, seoAuditResults: { some: {} } },
    orderBy: { createdAt: "desc" },
    select: { id: true, number: true, finishedAt: true, startedAt: true },
  });
}

export async function seoCounts(runId: string) {
  const keys = Object.keys(SEO_PROBLEMS) as SeoProblem[];
  const counts = await Promise.all(keys.map((k) => db.seoAuditResult.count({ where: { monitoringRunId: runId, ...problemWhere(k) } })));
  return Object.fromEntries(keys.map((k, i) => [k, counts[i]!])) as Record<SeoProblem, number>;
}

export async function listSeoPages(runId: string, problem: SeoProblem, q: string, page: number) {
  const where: Prisma.SeoAuditResultWhereInput = {
    monitoringRunId: runId,
    ...problemWhere(problem),
    ...(q ? { discoveredUrl: { url: { contains: q, mode: "insensitive" } } } : {}),
  };
  const [total, rows] = await Promise.all([
    db.seoAuditResult.count({ where }),
    db.seoAuditResult.findMany({
      where,
      orderBy: { discoveredUrl: { url: "asc" } },
      skip: (page - 1) * SEO_PAGE_SIZE,
      take: SEO_PAGE_SIZE,
      include: { discoveredUrl: { select: { url: true } } },
    }),
  ]);
  return { total, rows };
}
