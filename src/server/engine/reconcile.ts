import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { IssueStatus } from "@/generated/prisma/enums";
import { ISSUE_TYPES } from "@/lib/issue-catalog";
import type { DetectedIssue, IssueScope } from "./detect";

/**
 * Issue lifecycle. One row per (website, fingerprint), where the fingerprint
 * hashes the issue type and the affected resource. A run:
 * - creates issues it sees for the first time (NEW, occurrence DETECTED);
 * - refreshes open issues it sees again (lastDetectedAt, occurrenceCount; no history row);
 * - reopens resolved issues that are back (OPEN, recurrenceCount + 1, occurrence RECURRED);
 * - leaves issues a person marked IGNORED as they are (only counts the sighting);
 * - auto-resolves open issues it no longer sees, but only when it actually
 *   evaluated them: the type is in scope for this run, the page was checked
 *   (page scope), or the run covered the whole site (group scope).
 * Types the website ignores are neither raised nor resolved.
 */

const OPEN: readonly IssueStatus[] = ["NEW", "OPEN", "IN_PROGRESS"];
const CATALOG = new Map(ISSUE_TYPES.map((t) => [t.key, t]));
const BATCH = 500;

export function fingerprint(type: string, key: string): string {
  return createHash("sha256").update(`${type}\n${key}`).digest("hex").slice(0, 40);
}

export interface ReconcileInput {
  websiteId: string;
  runId: string;
  detected: DetectedIssue[];
  ignoredTypes: readonly string[];
  /** Type prefixes this run evaluated, e.g. ["seo.", "availability."]. */
  evaluated: readonly string[];
  /** Normalised URLs checked in this run. */
  checkedPages: ReadonlySet<string>;
  /** False when the run stopped early (URL limit, cancellation): group issues are then left alone. */
  complete: boolean;
  now?: Date;
}

export interface ReconcileResult {
  created: number;
  redetected: number;
  reopened: number;
  resolved: number;
}

/** Issue ids per transition, for notifications. Re-detections are not transitions. */
export interface IssueTransitions {
  created: string[];
  reopened: string[];
  resolved: string[];
  /** Still open, but crossed a new warning threshold (e.g. SSL expiry 30 → 15 days). */
  escalated: string[];
}

function chunk<T>(items: T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function content(d: DetectedIssue) {
  return {
    description: d.description,
    affectedUrl: d.affectedUrl,
    sourceUrl: d.sourceUrl ?? null,
    httpStatus: d.httpStatus ?? null,
    details: { scope: d.scope, ...(d.details ?? {}) } as Prisma.InputJsonValue,
  };
}

const sameContent = (a: ReturnType<typeof content>, b: { description: string; affectedUrl: string | null; sourceUrl: string | null; httpStatus: number | null; details: unknown }) =>
  JSON.stringify([a.description, a.affectedUrl, a.sourceUrl, a.httpStatus, a.details]) ===
  JSON.stringify([b.description, b.affectedUrl, b.sourceUrl, b.httpStatus, b.details]);

export async function reconcileIssues(db: PrismaClient, input: ReconcileInput): Promise<ReconcileResult & { transitions: IssueTransitions }> {
  const now = input.now ?? new Date();
  const ignored = new Set(input.ignoredTypes);
  const isEvaluated = (type: string) => !ignored.has(type) && input.evaluated.some((p) => type.startsWith(p));

  const detected = new Map<string, DetectedIssue>();
  for (const d of input.detected) {
    if (ignored.has(d.type) || !CATALOG.has(d.type)) continue;
    const fp = fingerprint(d.type, d.key);
    if (!detected.has(fp)) detected.set(fp, d);
  }

  const existing = await db.issue.findMany({
    where: { websiteId: input.websiteId },
    select: { id: true, fingerprint: true, type: true, status: true, description: true, affectedUrl: true, sourceUrl: true, httpStatus: true, details: true },
  });
  const byFingerprint = new Map(existing.map((e) => [e.fingerprint, e]));

  const toCreate: Array<[string, DetectedIssue]> = [];
  const redetectIds: string[] = [];
  const refresh: Array<{ id: string; data: ReturnType<typeof content> }> = [];
  const reopen: Array<{ id: string; data: ReturnType<typeof content> }> = [];
  const ignoredSeen: string[] = [];
  const escalated: string[] = [];
  const thresholdOf = (details: unknown) => (details && typeof details === "object" ? (details as { threshold?: unknown }).threshold : undefined);

  for (const [fp, d] of detected) {
    const current = byFingerprint.get(fp);
    const data = content(d);
    if (!current) toCreate.push([fp, d]);
    else if (current.status === "RESOLVED") reopen.push({ id: current.id, data });
    else {
      if (current.status === "IGNORED") ignoredSeen.push(current.id);
      else redetectIds.push(current.id);
      if (!sameContent(data, current)) refresh.push({ id: current.id, data });
      const before = thresholdOf(current.details);
      const after = thresholdOf(data.details);
      if (current.status !== "IGNORED" && before !== undefined && after !== undefined && before !== after) escalated.push(current.id);
    }
  }

  const toResolve = existing.filter((e) => {
    if (!OPEN.includes(e.status) || detected.has(e.fingerprint) || !isEvaluated(e.type)) return false;
    const details = (e.details ?? {}) as { scope?: IssueScope; page?: string };
    if (details.scope === "page") return typeof details.page === "string" && input.checkedPages.has(details.page);
    if (details.scope === "group") return input.complete;
    return details.scope === "site";
  });

  // Create
  const createdIds: string[] = [];
  for (const batch of chunk(toCreate)) {
    const rows = await db.issue.createManyAndReturn({
      data: batch.map(([fp, d]) => {
        const def = CATALOG.get(d.type)!;
        return {
          websiteId: input.websiteId,
          category: def.category,
          type: d.type,
          fingerprint: fp,
          title: def.title,
          severity: def.severity,
          status: "NEW" as const,
          firstDetectedAt: now,
          lastDetectedAt: now,
          ...content(d),
        };
      }),
      select: { id: true },
    });
    createdIds.push(...rows.map((r) => r.id));
    await db.issueOccurrence.createMany({
      data: rows.map((r) => ({ issueId: r.id, monitoringRunId: input.runId, kind: "DETECTED" as const, toStatus: "NEW" as const, createdAt: now })),
    });
  }

  // Seen again
  for (const batch of chunk([...redetectIds, ...ignoredSeen])) {
    await db.issue.updateMany({ where: { id: { in: batch } }, data: { lastDetectedAt: now, occurrenceCount: { increment: 1 } } });
  }
  for (const batch of chunk(refresh, 100)) {
    await db.$transaction(batch.map((r) => db.issue.update({ where: { id: r.id }, data: r.data })));
  }

  // Back after being resolved
  for (const batch of chunk(reopen, 100)) {
    await db.$transaction([
      ...batch.map((r) =>
        db.issue.update({
          where: { id: r.id },
          data: { ...r.data, status: "OPEN", resolvedAt: null, lastDetectedAt: now, occurrenceCount: { increment: 1 }, recurrenceCount: { increment: 1 } },
        }),
      ),
      db.issueOccurrence.createMany({
        data: batch.map((r) => ({ issueId: r.id, monitoringRunId: input.runId, kind: "RECURRED" as const, fromStatus: "RESOLVED" as const, toStatus: "OPEN" as const, createdAt: now })),
      }),
    ]);
  }

  // Gone
  for (const batch of chunk(toResolve)) {
    await db.$transaction([
      db.issue.updateMany({ where: { id: { in: batch.map((e) => e.id) } }, data: { status: "RESOLVED", resolvedAt: now } }),
      db.issueOccurrence.createMany({
        data: batch.map((e) => ({
          issueId: e.id,
          monitoringRunId: input.runId,
          kind: "AUTO_RESOLVED" as const,
          fromStatus: e.status,
          toStatus: "RESOLVED" as const,
          note: "Not detected in this run",
          createdAt: now,
        })),
      }),
    ]);
  }

  return {
    created: toCreate.length,
    redetected: redetectIds.length,
    reopened: reopen.length,
    resolved: toResolve.length,
    transitions: { created: createdIds, reopened: reopen.map((r) => r.id), resolved: toResolve.map((e) => e.id), escalated },
  };
}
