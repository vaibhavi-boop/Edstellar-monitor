import type { IssueStatus, NotificationEvent, Severity } from "@/generated/prisma/enums";

/**
 * Which notification events an issue transition belongs to. Only transitions
 * notify: a new issue, one that came back, one that crossed a new warning
 * threshold, or a critical one that was resolved. An issue that is simply still
 * open is never re-sent, which is what keeps alerts from repeating every run.
 */

export type Transition = "created" | "reopened" | "escalated" | "resolved";

export interface NotifiableIssue {
  id: string;
  number: number;
  type: string;
  title: string;
  severity: Severity;
  status: IssueStatus;
  affectedUrl: string | null;
  description: string;
}

export const EVENT_LABELS: Record<NotificationEvent, string> = {
  WEBSITE_DOWN: "Website down",
  CRITICAL_ISSUE: "New critical issues",
  NEW_404: "New 404 pages and broken links",
  API_FAILURE: "API failures",
  SSL_EXPIRY: "SSL certificate problems",
  PERFORMANCE_DEGRADATION: "Performance degradation",
  CRITICAL_RESOLVED: "Critical issues resolved",
};

export const EVENT_ORDER: NotificationEvent[] = ["WEBSITE_DOWN", "CRITICAL_ISSUE", "API_FAILURE", "SSL_EXPIRY", "NEW_404", "PERFORMANCE_DEGRADATION", "CRITICAL_RESOLVED"];

export function eventsFor(issue: Pick<NotifiableIssue, "type" | "severity">, transition: Transition): NotificationEvent[] {
  if (transition === "resolved") return issue.severity === "CRITICAL" ? ["CRITICAL_RESOLVED"] : [];
  const events: NotificationEvent[] = [];
  if (issue.type === "availability.site_down") events.push("WEBSITE_DOWN");
  if (issue.severity === "CRITICAL" && transition !== "escalated") events.push("CRITICAL_ISSUE");
  if (transition === "created" && (issue.type === "availability.http_404" || issue.type === "links.broken_internal")) events.push("NEW_404");
  if (issue.type.startsWith("api.")) events.push("API_FAILURE");
  if (issue.type.startsWith("ssl.")) events.push("SSL_EXPIRY");
  if (issue.type.startsWith("performance.") && transition !== "escalated") events.push("PERFORMANCE_DEGRADATION");
  return events;
}

export interface EventGroup {
  event: NotificationEvent;
  issues: Array<NotifiableIssue & { transition: Transition }>;
}

/** Groups transitioned issues by event, in a fixed order. Each issue appears once per event. */
export function groupByEvent(items: Array<{ issue: NotifiableIssue; transition: Transition }>): EventGroup[] {
  const groups = new Map<NotificationEvent, EventGroup>();
  for (const { issue, transition } of items) {
    for (const event of eventsFor(issue, transition)) {
      const group = groups.get(event) ?? { event, issues: [] };
      if (!group.issues.some((i) => i.id === issue.id)) group.issues.push({ ...issue, transition });
      groups.set(event, group);
    }
  }
  return EVENT_ORDER.filter((e) => groups.has(e)).map((e) => groups.get(e)!);
}

const MAX_PER_GROUP = 15;

export interface Digest {
  subject: string;
  text: string;
  html: string;
  /** Slack Block Kit payload. */
  slack: { text: string; blocks: unknown[] };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const slackEsc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const verb: Record<Transition, string> = { created: "new", reopened: "back", escalated: "escalated", resolved: "resolved" };

/** One message for one channel covering every event group of a run. */
export function buildDigest(site: { name: string; domain: string }, groups: EventGroup[], appUrl: string, runNumber: number | null): Digest {
  const total = groups.reduce((n, g) => n + g.issues.length, 0);
  const headline = groups.map((g) => `${EVENT_LABELS[g.event]} (${g.issues.length})`).join(", ");
  const subject = `[Edstellar Monitor] ${site.domain}: ${headline}`;
  const link = (n: number) => `${appUrl.replace(/\/$/, "")}/issues/${n}`;

  const textParts = [`${site.name} (${site.domain})${runNumber ? `, monitoring run #${runNumber}` : ""}`, ""];
  const htmlParts = [`<p style="margin:0 0 12px">${esc(site.name)} (${esc(site.domain)})${runNumber ? `, monitoring run #${runNumber}` : ""}</p>`];
  const blocks: unknown[] = [{ type: "header", text: { type: "plain_text", text: `${site.domain}: ${total} update${total === 1 ? "" : "s"}`.slice(0, 150) } }];

  for (const g of groups) {
    const shown = g.issues.slice(0, MAX_PER_GROUP);
    const more = g.issues.length - shown.length;
    textParts.push(`${EVENT_LABELS[g.event]} (${g.issues.length})`);
    for (const i of shown) textParts.push(`  - EM-${i.number} [${verb[i.transition]}] ${i.title}${i.affectedUrl ? ` - ${i.affectedUrl}` : ""}\n    ${link(i.number)}`);
    if (more > 0) textParts.push(`  and ${more} more: ${appUrl.replace(/\/$/, "")}/issues`);
    textParts.push("");

    htmlParts.push(
      `<h3 style="margin:16px 0 6px;font-size:15px">${esc(EVENT_LABELS[g.event])} (${g.issues.length})</h3><ul style="margin:0;padding-left:18px">` +
        shown
          .map((i) => `<li style="margin:0 0 6px"><a href="${esc(link(i.number))}">EM-${i.number}</a> <em>${verb[i.transition]}</em>: ${esc(i.title)}${i.affectedUrl ? `<br><span style="color:#5a6270;font-family:monospace;font-size:12px">${esc(i.affectedUrl)}</span>` : ""}</li>`)
          .join("") +
        (more > 0 ? `<li>and ${more} more</li>` : "") +
        "</ul>",
    );
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: (`*${EVENT_LABELS[g.event]}* (${g.issues.length})\n` + shown.map((i) => `• <${link(i.number)}|EM-${i.number}> _${verb[i.transition]}_ ${slackEsc(i.title)}${i.affectedUrl ? ` — \`${slackEsc(i.affectedUrl)}\`` : ""}`).join("\n") + (more > 0 ? `\n…and ${more} more` : "")).slice(0, 2900),
      },
    });
  }
  textParts.push(`Open the dashboard: ${appUrl}`);
  htmlParts.push(`<p style="margin:16px 0 0;color:#5a6270;font-size:12px">Sent by Edstellar Monitor. Change what you receive in the website's notification settings.</p>`);
  return {
    subject: subject.length > 200 ? `${subject.slice(0, 197)}…` : subject,
    text: textParts.join("\n"),
    html: `<div style="font-family:system-ui,sans-serif;color:#0a1628;font-size:14px;line-height:1.45">${htmlParts.join("")}</div>`,
    slack: { text: subject, blocks: blocks.slice(0, 50) },
  };
}
