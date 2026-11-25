import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { createPrismaAdapter } from "@/lib/prisma-adapter";
import { csvCell } from "@/lib/csv";
import { dueWebsites, enqueueRun, nextQueuedRun, sweepStaleRuns } from "@/server/engine/queue";
import { dispatchNotifications } from "@/server/notify/dispatch";
import { buildDigest, eventsFor, groupByEvent, type NotifiableIssue } from "@/server/notify/events";
import { isSlackWebhook } from "@/server/notify/send";
import { encryptSecret } from "@/server/security/crypto";

const issue = (over: Partial<NotifiableIssue>): NotifiableIssue => ({
  id: randomUUID(), number: 1, type: "seo.missing_title", title: "Missing title tag", severity: "HIGH", status: "NEW", affectedUrl: "https://e.test/a", description: "", ...over,
});

describe("notification events and digests", () => {
  it("maps transitions to events and never alerts on low-impact changes", () => {
    expect(eventsFor(issue({ type: "availability.site_down", severity: "CRITICAL" }), "created")).toEqual(["WEBSITE_DOWN", "CRITICAL_ISSUE"]);
    expect(eventsFor(issue({ type: "availability.http_404" }), "created")).toEqual(["NEW_404"]);
    expect(eventsFor(issue({ type: "availability.http_404" }), "reopened")).toEqual([]);
    expect(eventsFor(issue({ type: "api.http_5xx", severity: "CRITICAL" }), "reopened")).toEqual(["CRITICAL_ISSUE", "API_FAILURE"]);
    expect(eventsFor(issue({ type: "ssl.expiring" }), "escalated")).toEqual(["SSL_EXPIRY"]);
    expect(eventsFor(issue({ type: "performance.slow_ttfb", severity: "MEDIUM" }), "created")).toEqual(["PERFORMANCE_DEGRADATION"]);
    expect(eventsFor(issue({ severity: "CRITICAL", type: "ssl.expired" }), "resolved")).toEqual(["CRITICAL_RESOLVED"]);
    expect(eventsFor(issue({}), "created")).toEqual([]);
  });

  it("builds one digest, capped per group, with escaped content", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ issue: issue({ number: i + 1, type: "availability.http_404", title: `<b>${i}</b>` }), transition: "created" as const }));
    const groups = groupByEvent([...many, { issue: issue({ number: 99, type: "availability.site_down", severity: "CRITICAL" }), transition: "created" }]);
    expect(groups.map((g) => g.event)).toEqual(["WEBSITE_DOWN", "CRITICAL_ISSUE", "NEW_404"]);
    const d = buildDigest({ name: "Site", domain: "e.test" }, groups, "https://monitor.test/", 7);
    expect(d.subject).toContain("e.test");
    expect(d.text).toContain("https://monitor.test/issues/99");
    expect(d.text).toContain("and 5 more");
    expect(d.html).not.toContain("<b>0</b>");
    expect(d.html).toContain("&lt;b&gt;0&lt;/b&gt;");
    expect(JSON.stringify(d.slack)).not.toContain("<b>");
  });

  it("accepts only Slack incoming-webhook URLs", () => {
    expect(isSlackWebhook("https://hooks.slack.com/services/T0/B0/xyz")).toBe(true);
    for (const bad of ["http://hooks.slack.com/services/x", "https://hooks.slack.com.evil.test/services/x", "https://example.com/services/x", "https://hooks.slack.com:8443/services/x", "not a url"]) {
      expect(isSlackWebhook(bad)).toBe(false);
    }
  });

  it("neutralises spreadsheet formulas in CSV cells", () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("-1+1")).toBe(`"'-1+1"`);
    expect(csvCell("plain")).toBe(`"plain"`);
    expect(csvCell(null)).toBe(`""`);
  });
});

// Database-backed: everything lives under throwaway websites that are removed afterwards.
const enabled = Boolean(process.env.DATABASE_URL);
const db = enabled ? new PrismaClient({ adapter: createPrismaAdapter() }) : (null as unknown as PrismaClient);
const created: string[] = [];
async function site(overrides: { frequency?: number; status?: "ACTIVE" | "PAUSED" } = {}) {
  const w = await db.website.create({
    data: {
      name: "Queue test",
      url: "https://q.test",
      domain: `queue-${randomUUID()}.test`,
      status: overrides.status ?? "ACTIVE",
      configuration: { create: { crawlFrequencyMinutes: overrides.frequency ?? 240 } },
    },
  });
  created.push(w.id);
  return w.id;
}

// One cleanup for the whole file, after every database test has run.
afterAll(async () => {
  if (!enabled) return;
  await db.website.deleteMany({ where: { id: { in: created } } });
  await db.$disconnect();
});

describe.skipIf(!enabled)("run queue (database)", () => {

  it("keeps one queued run per website and upgrades it to a full scan", async () => {
    const id = await site();
    const a = await enqueueRun(db, id, { trigger: "MANUAL", scanType: "INCREMENTAL" });
    const b = await enqueueRun(db, id, { trigger: "SCHEDULED", scanType: "FULL" });
    expect(a.created).toBe(true);
    expect(b).toMatchObject({ created: false, run: { id: a.run.id, scanType: "FULL" } });
    expect(await db.monitoringRun.count({ where: { websiteId: id, status: "QUEUED" } })).toBe(1);
  });

  it("schedules by frequency: full once a day, incremental in between", async () => {
    const fresh = await site();
    const now = new Date();
    const doneAt = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000);

    const recent = await site();
    await db.monitoringRun.create({ data: { websiteId: recent, trigger: "SCHEDULED", scanType: "FULL", status: "COMPLETED", createdAt: doneAt(60) } });

    const dueIncremental = await site();
    await db.monitoringRun.create({ data: { websiteId: dueIncremental, trigger: "SCHEDULED", scanType: "FULL", status: "COMPLETED", createdAt: doneAt(241) } });

    const dueFull = await site();
    await db.monitoringRun.create({ data: { websiteId: dueFull, trigger: "SCHEDULED", scanType: "FULL", status: "COMPLETED", createdAt: doneAt(25 * 60) } });

    const paused = await site({ status: "PAUSED" });

    const due = new Map((await dueWebsites(db, now)).map((d) => [d.websiteId, d]));
    expect(due.get(fresh)).toMatchObject({ scanType: "FULL", reason: "never run" });
    expect(due.has(recent)).toBe(false);
    expect(due.get(dueIncremental)).toMatchObject({ scanType: "INCREMENTAL", reason: "schedule" });
    expect(due.get(dueFull)).toMatchObject({ scanType: "FULL" });
    expect(due.has(paused)).toBe(false);

    // Queue only this test's websites (enqueueDue would also queue real ones in a shared database).
    for (const d of due.values()) if (created.includes(d.websiteId)) await enqueueRun(db, d.websiteId, { trigger: "SCHEDULED", scanType: d.scanType });
    expect((await dueWebsites(db, now)).some((d) => d.websiteId === fresh)).toBe(false); // already queued
  });

  it("detects a crashed run by its expired lease and retries it once", async () => {
    const id = await site();
    const now = new Date();
    const run = await db.monitoringRun.create({ data: { websiteId: id, trigger: "SCHEDULED", scanType: "FULL", status: "RUNNING", startedAt: new Date(now.getTime() - 20 * 60_000), heartbeatAt: new Date(now.getTime() - 10 * 60_000) } });
    await db.monitoringLock.create({ data: { websiteId: id, monitoringRunId: run.id, leaseUntil: new Date(now.getTime() - 5 * 60_000) } });

    const swept = await sweepStaleRuns(db, now);
    expect(swept.interrupted).toBeGreaterThanOrEqual(1);
    expect((await db.monitoringRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("FAILED");
    expect(await db.monitoringLock.findUnique({ where: { websiteId: id } })).toBeNull();
    expect((await dueWebsites(db, now)).find((d) => d.websiteId === id)?.reason).toBe("retry after an interrupted run");

    // A second consecutive failure is not retried again.
    await db.monitoringRun.create({ data: { websiteId: id, trigger: "SCHEDULED", scanType: "FULL", status: "FAILED", errorMessage: "Stopped responding; its lease expired; it will be retried", finishedAt: now, createdAt: new Date(now.getTime() + 1000) } });
    expect((await dueWebsites(db, new Date(now.getTime() + 2000))).some((d) => d.websiteId === id)).toBe(false);
  });

  it("does not hand out a queued run while its website is locked", async () => {
    const id = await site();
    const { run } = await enqueueRun(db, id, { trigger: "MANUAL", scanType: "FULL" });
    const holder = await db.monitoringRun.create({ data: { websiteId: id, trigger: "MANUAL", scanType: "FULL", status: "RUNNING" } });
    await db.monitoringLock.create({ data: { websiteId: id, monitoringRunId: holder.id, leaseUntil: new Date(Date.now() + 60_000) } });
    const others = new Set((await db.monitoringRun.findMany({ where: { status: "QUEUED", websiteId: { not: id } }, select: { id: true } })).map((r) => r.id));
    expect((await nextQueuedRun(db, others))?.id).not.toBe(run.id);
    await db.monitoringLock.delete({ where: { websiteId: id } });
    expect((await nextQueuedRun(db, others))?.id).toBe(run.id);
  });
});

describe.skipIf(!enabled)("notification dispatch (database)", () => {
  let websiteId = "";
  const sentEmails: Array<{ to: string; subject: string }> = [];
  const sentSlack: unknown[] = [];
  const email = async (to: string, m: { subject: string }) => void sentEmails.push({ to, subject: m.subject });
  const slack = async (_url: string, payload: unknown) => void sentSlack.push(payload);
  const key = randomBytes(32).toString("base64");

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY ??= key;
    websiteId = await site();
  });

  it("sends one digest per subscriber, filtered by event, and records it", async () => {
    const [down, notFound, title] = await Promise.all(
      [
        { type: "availability.site_down", severity: "CRITICAL" as const, title: "Website is unreachable" },
        { type: "availability.http_404", severity: "HIGH" as const, title: "Page returns 404 Not Found" },
        { type: "seo.missing_title", severity: "HIGH" as const, title: "Missing title tag" },
      ].map((t, i) =>
        db.issue.create({ data: { websiteId, category: "AVAILABILITY", type: t.type, fingerprint: `fp-${i}`, title: t.title, description: "d", severity: t.severity } }),
      ),
    );
    await db.notificationPreference.createMany({
      data: [
        { websiteId, channel: "EMAIL", target: "ops@e.test", events: ["WEBSITE_DOWN", "NEW_404"] },
        { websiteId, channel: "SLACK", target: "…xyz", encryptedTarget: encryptSecret("https://hooks.slack.com/services/T/B/xyz"), events: ["CRITICAL_ISSUE"] },
        { websiteId, channel: "EMAIL", target: "seo@e.test", events: ["PERFORMANCE_DEGRADATION"] },
        { websiteId, channel: "EMAIL", target: "off@e.test", events: ["WEBSITE_DOWN"], isEnabled: false },
      ],
    });
    const result = await dispatchNotifications(
      db,
      { websiteId, runId: null, runNumber: 5, transitions: { created: [down!.id, notFound!.id, title!.id], reopened: [], resolved: [], escalated: [] }, appUrl: "https://m.test" },
      { email, slack },
    );
    expect(result).toEqual({ sent: 2, failed: 0, skipped: 1 });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]!.to).toBe("ops@e.test");
    expect(sentSlack).toHaveLength(1);
    const rows = await db.notification.findMany({ where: { websiteId }, orderBy: { event: "asc" } });
    expect(rows.map((r) => [r.channel, r.event, r.status])).toEqual([
      ["EMAIL", "WEBSITE_DOWN", "SENT"],
      ["SLACK", "CRITICAL_ISSUE", "SENT"],
      ["EMAIL", "NEW_404", "SENT"],
    ]);
    expect((await db.issue.findUniqueOrThrow({ where: { id: title!.id } })).lastNotifiedAt).toBeNull();
    expect((await db.issue.findUniqueOrThrow({ where: { id: down!.id } })).lastNotifiedAt).not.toBeNull();
  });

  it("records delivery failures instead of throwing, and sends nothing without transitions", async () => {
    const failing = async () => {
      throw new Error("SMTP is down");
    };
    const i = await db.issue.create({ data: { websiteId, category: "AVAILABILITY", type: "availability.site_down", fingerprint: "fp-x", title: "Website is unreachable", description: "d", severity: "CRITICAL" } });
    const r = await dispatchNotifications(db, { websiteId, runId: null, runNumber: 6, transitions: { created: [], reopened: [i.id], resolved: [], escalated: [] }, appUrl: "https://m.test" }, { email: failing, slack });
    expect(r.failed).toBe(1);
    expect(await db.notification.findFirst({ where: { websiteId, status: "FAILED" } })).toMatchObject({ error: "SMTP is down" });
    expect(await dispatchNotifications(db, { websiteId, runId: null, runNumber: 7, transitions: { created: [], reopened: [], resolved: [], escalated: [] }, appUrl: "x" }, { email, slack })).toEqual({ sent: 0, failed: 0, skipped: 0 });
  });

});
