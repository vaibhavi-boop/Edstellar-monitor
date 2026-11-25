import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { createPrismaAdapter } from "@/lib/prisma-adapter";
import type { DetectedIssue } from "@/server/engine/detect";
import { fingerprint, reconcileIssues } from "@/server/engine/reconcile";

// Runs against the database in DATABASE_URL (CI provides a disposable one).
// Everything is created under a throwaway website and removed afterwards.
const enabled = Boolean(process.env.DATABASE_URL);
const db = enabled ? new PrismaClient({ adapter: createPrismaAdapter() }) : (null as unknown as PrismaClient);
let websiteId = "";

const A: DetectedIssue = { type: "seo.missing_title", key: "https://t.example/a", scope: "page", description: "No title", affectedUrl: "https://t.example/a", details: { page: "https://t.example/a" } };
const D: DetectedIssue = { type: "seo.missing_h1", key: "https://t.example/d", scope: "page", description: "No H1", affectedUrl: "https://t.example/d", details: { page: "https://t.example/d" } };
const B: DetectedIssue = { type: "seo.duplicate_title", key: "dup", scope: "group", description: "2 pages share a title", affectedUrl: "https://t.example/a", details: { count: 2 } };
const C: DetectedIssue = { type: "robots.missing_sitemap", key: "https://t.example/robots.txt", scope: "site", description: "No sitemap line", affectedUrl: "https://t.example/robots.txt" };
const L: DetectedIssue = { type: "links.broken_internal", key: "https://t.example/x", scope: "page", description: "404", affectedUrl: "https://t.example/x", details: { page: "https://t.example/x" } };

const ALL = ["availability.", "redirect.", "seo.", "sitemap.", "robots.", "links."];
const pagesChecked = (...paths: string[]) => new Set(paths.map((p) => `https://t.example${p}`));

async function newRun() {
  const run = await db.monitoringRun.create({ data: { websiteId, trigger: "MANUAL", status: "RUNNING" } });
  return run.id;
}
async function issue(d: DetectedIssue) {
  return db.issue.findUniqueOrThrow({
    where: { websiteId_fingerprint: { websiteId, fingerprint: fingerprint(d.type, d.key) } },
    include: { occurrences: { orderBy: { createdAt: "asc" } } },
  });
}

describe.skipIf(!enabled)("issue reconciliation (database)", () => {
  beforeAll(async () => {
    const site = await db.website.create({ data: { name: "Reconcile test", url: "https://t.example", domain: `reconcile-${randomUUID()}.example` } });
    websiteId = site.id;
  });
  afterAll(async () => {
    if (websiteId) await db.website.delete({ where: { id: websiteId } });
    await db.$disconnect();
  });

  it("creates new issues with a DETECTED history entry", async () => {
    const result = await reconcileIssues(db, { websiteId, runId: await newRun(), detected: [A, B, C, D, L, A], ignoredTypes: [], evaluated: ALL, checkedPages: pagesChecked("/a", "/d", "/x"), complete: true });
    expect(result).toMatchObject({ created: 5, redetected: 0, reopened: 0, resolved: 0 });
    expect(result.transitions.created).toHaveLength(5);
    const a = await issue(A);
    expect(a).toMatchObject({ status: "NEW", severity: "HIGH", category: "SEO", title: "Missing title tag", occurrenceCount: 1 });
    expect(a.occurrences.map((o) => o.kind)).toEqual(["DETECTED"]);
  });

  it("refreshes what it sees again and resolves only what it really evaluated", async () => {
    // A seen again. D's page was not checked (stays open). B (group) and C (site) are gone.
    // L is a links issue, but links were not evaluated in this run (e.g. incremental scan).
    const result = await reconcileIssues(db, {
      websiteId,
      runId: await newRun(),
      detected: [{ ...A, description: "Still no title" }],
      ignoredTypes: [],
      evaluated: ["availability.", "redirect.", "seo.", "sitemap.", "robots."],
      checkedPages: pagesChecked("/a", "/x"),
      complete: true,
    });
    expect(result).toMatchObject({ created: 0, redetected: 1, reopened: 0, resolved: 2 });
    expect(result.transitions.resolved).toHaveLength(2);
    const a = await issue(A);
    expect(a).toMatchObject({ status: "NEW", occurrenceCount: 2, description: "Still no title" });
    expect(a.occurrences).toHaveLength(1); // re-detection does not add history rows
    expect((await issue(D)).status).toBe("NEW");
    expect((await issue(L)).status).toBe("NEW");
    const b = await issue(B);
    expect(b.status).toBe("RESOLVED");
    expect(b.resolvedAt).not.toBeNull();
    expect(b.occurrences.map((o) => [o.kind, o.fromStatus, o.toStatus])).toEqual([["DETECTED", null, "NEW"], ["AUTO_RESOLVED", "NEW", "RESOLVED"]]);
    expect((await issue(C)).status).toBe("RESOLVED");
  });

  it("reopens a resolved issue that comes back, counting the recurrence", async () => {
    const result = await reconcileIssues(db, { websiteId, runId: await newRun(), detected: [A, B, D, L], ignoredTypes: [], evaluated: ALL, checkedPages: pagesChecked("/a", "/d", "/x"), complete: true });
    expect(result.reopened).toBe(1);
    const b = await issue(B);
    expect(b).toMatchObject({ status: "OPEN", recurrenceCount: 1, resolvedAt: null });
    expect(b.occurrences.at(-1)).toMatchObject({ kind: "RECURRED", fromStatus: "RESOLVED", toStatus: "OPEN" });
  });

  it("leaves group issues alone after an incomplete run, and ignored types entirely", async () => {
    const result = await reconcileIssues(db, {
      websiteId,
      runId: await newRun(),
      detected: [D, L],
      ignoredTypes: ["seo.missing_title"],
      evaluated: ALL,
      checkedPages: pagesChecked("/a", "/d", "/x"),
      complete: false,
    });
    expect(result.resolved).toBe(0);
    expect((await issue(A)).status).toBe("NEW"); // ignored type: not resolved even though not detected
    expect((await issue(B)).status).toBe("OPEN"); // group issue: run was cut short
  });

  it("keeps an issue a person ignored, while still counting sightings", async () => {
    await db.issue.update({ where: { id: (await issue(D)).id }, data: { status: "IGNORED" } });
    await reconcileIssues(db, { websiteId, runId: await newRun(), detected: [D], ignoredTypes: [], evaluated: ALL, checkedPages: pagesChecked("/d"), complete: true });
    const d = await issue(D);
    expect(d.status).toBe("IGNORED");
    expect(d.occurrenceCount).toBe(4); // runs 1, 3, 4 and 5 (not run 2)
  });
});
