"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import type { ActionState } from "@/lib/action-state";
import { audit } from "@/server/audit";
import { authorize, ForbiddenError } from "@/server/auth/session";
import { clientIpHash } from "@/server/request";
import { decryptSecret, encryptSecret } from "@/server/security/crypto";
import { fieldErrors } from "@/server/websites/schema";
import { buildDigest } from "./events";
import { isSlackWebhook, sendEmail, sendSlack } from "./send";

const EVENTS = ["WEBSITE_DOWN", "CRITICAL_ISSUE", "NEW_404", "API_FAILURE", "SSL_EXPIRY", "PERFORMANCE_DEGRADATION", "CRITICAL_RESOLVED"] as const;

const prefSchema = z.discriminatedUnion("channel", [
  z.object({ channel: z.literal("EMAIL"), target: z.string().trim().toLowerCase().email("Enter a valid email address").max(254), events: z.array(z.enum(EVENTS)).min(1, "Choose at least one event") }),
  z.object({
    channel: z.literal("SLACK"),
    target: z.string().trim().refine(isSlackWebhook, "Paste a Slack incoming-webhook URL (https://hooks.slack.com/services/…)"),
    events: z.array(z.enum(EVENTS)).min(1, "Choose at least one event"),
  }),
]);

function fail(error: unknown): ActionState {
  if (error instanceof ForbiddenError) return { ok: false, message: error.message };
  console.error(error);
  return { ok: false, message: "Something went wrong. Try again." };
}

export async function addNotification(websiteId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await authorize("ADMIN");
    const parsed = prefSchema.safeParse({ channel: form.get("channel"), target: form.get("target") ?? "", events: form.getAll("events").map(String) });
    if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error), values: { target: String(form.get("target") ?? "") } };
    const p = parsed.data;
    if (p.channel === "SLACK" && !process.env.ENCRYPTION_KEY) return { ok: false, message: "ENCRYPTION_KEY is not set, so the Slack webhook cannot be stored safely." };
    const existing = p.channel === "EMAIL" ? await db.notificationPreference.findFirst({ where: { websiteId, channel: "EMAIL", target: p.target } }) : null;
    if (existing) return { ok: false, fieldErrors: { target: [`${p.target} already receives notifications for this website`] } };
    const pref = await db.notificationPreference.create({
      data: {
        websiteId,
        channel: p.channel,
        target: p.channel === "EMAIL" ? p.target : `…${p.target.slice(-6)}`,
        encryptedTarget: p.channel === "SLACK" ? encryptSecret(p.target) : null,
        events: p.events,
      },
    });
    await audit({ actorId: user.id, action: "notification.added", entityType: "NotificationPreference", entityId: pref.id, metadata: { channel: p.channel, events: p.events }, ipHash: await clientIpHash() });
    revalidatePath(`/websites/${websiteId}`);
    return { ok: true, message: p.channel === "EMAIL" ? `${p.target} will be notified.` : "Slack channel added." };
  } catch (error) {
    return fail(error);
  }
}

export async function removeNotification(id: string): Promise<ActionState> {
  try {
    const user = await authorize("ADMIN");
    const pref = await db.notificationPreference.delete({ where: { id } });
    await audit({ actorId: user.id, action: "notification.removed", entityType: "NotificationPreference", entityId: id, metadata: { channel: pref.channel }, ipHash: await clientIpHash() });
    revalidatePath(`/websites/${pref.websiteId}`);
    return { ok: true, message: "Removed." };
  } catch (error) {
    return fail(error);
  }
}

export async function toggleNotification(id: string, enabled: boolean): Promise<ActionState> {
  try {
    await authorize("ADMIN");
    const pref = await db.notificationPreference.update({ where: { id }, data: { isEnabled: enabled } });
    revalidatePath(`/websites/${pref.websiteId}`);
    return { ok: true, message: enabled ? "Enabled." : "Paused." };
  } catch (error) {
    return fail(error);
  }
}

/** Sends a sample digest so an administrator can confirm delivery works. */
export async function sendTestNotification(id: string): Promise<ActionState> {
  try {
    await authorize("ADMIN");
    const pref = await db.notificationPreference.findUnique({ where: { id }, include: { website: { select: { name: true, domain: true } } } });
    if (!pref) return { ok: false, message: "This notification no longer exists." };
    const appUrl = process.env.APP_URL?.trim() || "http://localhost:3000";
    const digest = buildDigest(
      pref.website,
      [{ event: "CRITICAL_ISSUE", issues: [{ id: "test", number: 0, type: "availability.site_down", title: "Test notification: nothing is wrong", severity: "CRITICAL", status: "NEW", affectedUrl: `https://${pref.website.domain}/`, description: "", transition: "created" }] }],
      appUrl,
      null,
    );
    digest.subject = `[Edstellar Monitor] Test notification for ${pref.website.domain}`;
    if (pref.channel === "EMAIL") await sendEmail(pref.target!, digest);
    else await sendSlack(decryptSecret(pref.encryptedTarget!), { ...digest.slack, text: digest.subject });
    return { ok: true, message: pref.channel === "EMAIL" ? `Test email sent to ${pref.target}.` : "Test message sent to Slack." };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    return { ok: false, message: error instanceof Error ? error.message : "Sending failed." };
  }
}
