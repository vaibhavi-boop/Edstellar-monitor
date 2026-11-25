"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import type { ActionState } from "@/lib/action-state";
import { audit } from "@/server/audit";
import { authorize, ForbiddenError } from "@/server/auth/session";
import { clientIpHash } from "@/server/request";
import { fieldErrors } from "@/server/websites/schema";

const statusChangeSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "IGNORED"], { message: "Choose a status" }),
  note: z.string().trim().max(500, "Notes can be at most 500 characters"),
});

/**
 * Editors and administrators move an issue through its workflow. Every change
 * is recorded on the issue (STATUS_CHANGED occurrence) and in the audit log.
 * A manually resolved issue that is detected again is reopened by the next run.
 */
export async function changeIssueStatus(issueId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await authorize("EDITOR");
    const parsed = statusChangeSchema.safeParse({ status: form.get("status"), note: form.get("note") ?? "" });
    if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
    const { status, note } = parsed.data;

    const issue = await db.issue.findUnique({ where: { id: issueId }, select: { id: true, number: true, status: true, websiteId: true } });
    if (!issue) return { ok: false, message: "This issue no longer exists." };
    if (issue.status === status && !note) return { ok: false, message: "The issue already has this status. Add a note to record a comment." };

    const now = new Date();
    await db.$transaction([
      db.issue.update({
        where: { id: issue.id },
        data: { status, resolvedAt: status === "RESOLVED" ? now : status === issue.status ? undefined : null },
      }),
      db.issueOccurrence.create({
        data: { issueId: issue.id, kind: "STATUS_CHANGED", fromStatus: issue.status, toStatus: status, note: note || null, actorId: user.id, createdAt: now },
      }),
    ]);
    await audit({
      actorId: user.id,
      action: "issue.status_changed",
      entityType: "Issue",
      entityId: issue.id,
      metadata: { number: issue.number, from: issue.status, to: status },
      ipHash: await clientIpHash(),
    });
    revalidatePath(`/issues/${issue.number}`);
    revalidatePath("/issues");
    return { ok: true, message: issue.status === status ? "Note added." : "Status updated." };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    console.error(error);
    return { ok: false, message: "Something went wrong while saving. Try again." };
  }
}
