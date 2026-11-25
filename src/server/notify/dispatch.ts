import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { IssueTransitions } from "@/server/engine/reconcile";
import { decryptSecret } from "@/server/security/crypto";
import { buildDigest, groupByEvent, type NotifiableIssue, type Transition } from "./events";
import { sendEmail, sendSlack } from "./send";

/**
 * After a run: turn issue transitions into one digest per enabled notification
 * preference (filtered to the events it subscribes to), send it, and record a
 * Notification row per event group with the outcome. Delivery failures are
 * recorded, never thrown: a broken SMTP server must not fail a monitoring run.
 */

export interface DispatchResult {
  sent: number;
  failed: number;
  skipped: number;
}

export async function dispatchNotifications(
  db: PrismaClient,
  input: { websiteId: string; runId: string | null; runNumber: number | null; transitions: IssueTransitions; appUrl: string },
  deps: { email?: typeof sendEmail; slack?: typeof sendSlack } = {},
): Promise<DispatchResult> {
  const email = deps.email ?? sendEmail;
  const slack = deps.slack ?? sendSlack;
  const result: DispatchResult = { sent: 0, failed: 0, skipped: 0 };

  const byId = new Map<string, Transition>();
  for (const [key, transition] of [["created", "created"], ["reopened", "reopened"], ["escalated", "escalated"], ["resolved", "resolved"]] as const) {
    for (const id of input.transitions[key]) if (!byId.has(id)) byId.set(id, transition);
  }
  if (byId.size === 0) return result;

  const prefs = await db.notificationPreference.findMany({ where: { websiteId: input.websiteId, isEnabled: true } });
  if (prefs.length === 0) return result;

  const issues: NotifiableIssue[] = [];
  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += 1000) {
    issues.push(
      ...(await db.issue.findMany({
        where: { id: { in: ids.slice(i, i + 1000) } },
        select: { id: true, number: true, type: true, title: true, severity: true, status: true, affectedUrl: true, description: true },
      })),
    );
  }
  const groups = groupByEvent(issues.map((issue) => ({ issue, transition: byId.get(issue.id)! })));
  if (groups.length === 0) return result;

  const site = await db.website.findUniqueOrThrow({ where: { id: input.websiteId }, select: { name: true, domain: true } });
  const notified = new Set<string>();

  for (const pref of prefs) {
    const mine = groups.filter((g) => pref.events.includes(g.event));
    if (mine.length === 0) {
      result.skipped++;
      continue;
    }
    const digest = buildDigest(site, mine, input.appUrl, input.runNumber);
    let error: string | null = null;
    try {
      if (pref.channel === "EMAIL") {
        if (!pref.target) throw new Error("No email address");
        await email(pref.target, digest);
      } else {
        if (!pref.encryptedTarget) throw new Error("No Slack webhook stored");
        await slack(decryptSecret(pref.encryptedTarget), digest.slack);
      }
      result.sent++;
      for (const g of mine) for (const i of g.issues) notified.add(i.id);
    } catch (e) {
      error = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
      result.failed++;
    }
    const now = new Date();
    await db.notification.createMany({
      data: mine.map((g) => ({
        websiteId: input.websiteId,
        issueId: g.issues.length === 1 ? g.issues[0]!.id : null,
        channel: pref.channel,
        event: g.event,
        status: error ? ("FAILED" as const) : ("SENT" as const),
        sentAt: error ? null : now,
        error,
        payload: {
          preferenceId: pref.id,
          runId: input.runId,
          runNumber: input.runNumber,
          subject: digest.subject,
          issues: g.issues.slice(0, 100).map((i) => ({ number: i.number, title: i.title, transition: i.transition })),
          count: g.issues.length,
        } satisfies Prisma.InputJsonValue,
      })),
    });
  }

  if (notified.size) {
    const list = [...notified];
    for (let i = 0; i < list.length; i += 1000) {
      await db.issue.updateMany({ where: { id: { in: list.slice(i, i + 1000) } }, data: { lastNotifiedAt: new Date() } });
    }
  }
  return result;
}
