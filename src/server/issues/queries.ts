import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { IssueCategory, IssueStatus, Severity } from "@/generated/prisma/enums";
import { CATEGORY_LABELS, ISSUE_TYPE_KEYS, SEVERITY_LABELS } from "@/lib/issue-catalog";

export const ISSUE_PAGE_SIZE = 50;
export const OPEN_STATUSES: IssueStatus[] = ["NEW", "OPEN", "IN_PROGRESS"];

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  NEW: "New",
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  IGNORED: "Ignored",
};

export const STATUS_VIEWS = { open: "Open (new, open, in progress)", NEW: "New", OPEN: "Open", IN_PROGRESS: "In progress", RESOLVED: "Resolved", IGNORED: "Ignored", all: "All statuses" } as const;
export const ISSUE_SORTS = { severity: "Severity", last: "Last detected", first: "First detected", count: "Times detected" } as const;

export interface IssueFilters {
  status: keyof typeof STATUS_VIEWS;
  severity: Severity | "all";
  category: IssueCategory | "all";
  type: string;
  q: string;
  sort: keyof typeof ISSUE_SORTS;
  dir: "asc" | "desc";
  page: number;
}

function pick<T extends string>(value: unknown, allowed: Record<T, unknown>, fallback: T): T {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(allowed, value) ? (value as T) : fallback;
}

export function parseIssueFilters(params: Record<string, string | string[] | undefined>): IssueFilters {
  const one = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]);
  const page = Number(one("page"));
  const type = one("type") ?? "";
  return {
    status: pick(one("status"), STATUS_VIEWS, "open"),
    severity: pick(one("severity"), { ...SEVERITY_LABELS, all: "" }, "all"),
    category: pick(one("category"), { ...CATEGORY_LABELS, all: "" }, "all"),
    type: ISSUE_TYPE_KEYS.has(type) ? type : "",
    q: (one("q") ?? "").trim().slice(0, 200),
    sort: pick(one("sort"), ISSUE_SORTS, "severity"),
    dir: one("dir") === "asc" ? "asc" : one("dir") === "desc" ? "desc" : pick(one("sort"), ISSUE_SORTS, "severity") === "severity" ? "asc" : "desc",
    page: Number.isInteger(page) && page > 0 ? Math.min(page, 10_000) : 1,
  };
}

export function issueWhere(websiteId: string, f: Omit<IssueFilters, "sort" | "dir" | "page">): Prisma.IssueWhereInput {
  const ref = /^em-(\d+)$/i.exec(f.q);
  return {
    websiteId,
    ...(f.status === "open" ? { status: { in: OPEN_STATUSES } } : f.status === "all" ? {} : { status: f.status }),
    ...(f.severity !== "all" ? { severity: f.severity } : {}),
    ...(f.category !== "all" ? { category: f.category } : {}),
    ...(f.type ? { type: f.type } : {}),
    ...(ref
      ? { number: Number(ref[1]) }
      : f.q
        ? { OR: [{ title: { contains: f.q, mode: "insensitive" } }, { affectedUrl: { contains: f.q, mode: "insensitive" } }, { description: { contains: f.q, mode: "insensitive" } }] }
        : {}),
  };
}

export async function listIssues(websiteId: string, f: IssueFilters) {
  const where = issueWhere(websiteId, f);
  const orderBy: Prisma.IssueOrderByWithRelationInput[] =
    f.sort === "severity"
      ? [{ severity: f.dir }, { lastDetectedAt: "desc" }, { number: "desc" }]
      : f.sort === "first"
        ? [{ firstDetectedAt: f.dir }, { number: f.dir }]
        : f.sort === "count"
          ? [{ occurrenceCount: f.dir }, { number: "desc" }]
          : [{ lastDetectedAt: f.dir }, { number: "desc" }];
  const [total, rows] = await Promise.all([
    db.issue.count({ where }),
    db.issue.findMany({
      where,
      orderBy,
      skip: (f.page - 1) * ISSUE_PAGE_SIZE,
      take: ISSUE_PAGE_SIZE,
      select: {
        id: true,
        number: true,
        title: true,
        type: true,
        category: true,
        severity: true,
        status: true,
        affectedUrl: true,
        description: true,
        firstDetectedAt: true,
        lastDetectedAt: true,
        occurrenceCount: true,
        recurrenceCount: true,
      },
    }),
  ]);
  return { total, rows };
}

export async function issueSummary(websiteId: string) {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [bySeverity, resolvedWeek, newWeek] = await Promise.all([
    db.issue.groupBy({ by: ["severity"], where: { websiteId, status: { in: OPEN_STATUSES } }, _count: { _all: true } }),
    db.issue.count({ where: { websiteId, status: "RESOLVED", resolvedAt: { gte: weekAgo } } }),
    db.issue.count({ where: { websiteId, firstDetectedAt: { gte: weekAgo } } }),
  ]);
  const sev = (s: Severity) => bySeverity.find((g) => g.severity === s)?._count._all ?? 0;
  return {
    open: bySeverity.reduce((n, g) => n + g._count._all, 0),
    critical: sev("CRITICAL"),
    high: sev("HIGH"),
    medium: sev("MEDIUM"),
    low: sev("LOW") + sev("INFO"),
    resolvedWeek,
    newWeek,
  };
}

/** Open issue counts per type, for one category (SEO audit, redirect audit). */
export async function openCountsByType(websiteId: string, category: IssueCategory) {
  const groups = await db.issue.groupBy({
    by: ["type"],
    where: { websiteId, category, status: { in: OPEN_STATUSES } },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.type, g._count._all]));
}

export async function getIssue(number: number) {
  return db.issue.findUnique({
    where: { number },
    include: {
      website: { select: { id: true, name: true, domain: true } },
      occurrences: {
        orderBy: { createdAt: "desc" },
        take: 200,
        include: { actor: { select: { name: true } }, monitoringRun: { select: { number: true } } },
      },
    },
  });
}
