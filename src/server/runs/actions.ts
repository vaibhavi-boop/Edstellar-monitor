"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import type { ActionState } from "@/lib/action-state";
import { audit } from "@/server/audit";
import { authorize, ForbiddenError } from "@/server/auth/session";
import { enqueueRun } from "@/server/engine/queue";
import { clientIpHash } from "@/server/request";

/** "Run now": editors queue a scan; a worker picks it up. */
export async function requestRun(websiteId: string, scanType: "FULL" | "INCREMENTAL"): Promise<ActionState> {
  try {
    const user = await authorize("EDITOR");
    const website = await db.website.findUnique({ where: { id: websiteId }, select: { id: true, status: true, domain: true } });
    if (!website) return { ok: false, message: "This website no longer exists." };
    if (website.status === "PAUSED") return { ok: false, message: "Monitoring is paused for this website. Resume it first." };
    const { run, created } = await enqueueRun(db, websiteId, { trigger: "MANUAL", scanType, triggeredById: user.id });
    await audit({ actorId: user.id, action: "run.requested", entityType: "MonitoringRun", entityId: run.id, metadata: { number: run.number, scanType, domain: website.domain }, ipHash: await clientIpHash() });
    revalidatePath("/history");
    revalidatePath("/");
    return {
      ok: true,
      message: created
        ? `Run #${run.number} is queued. It starts when the worker next checks the queue (within a minute in loop mode).`
        : `Run #${run.number} was already waiting in the queue${scanType === "FULL" ? "; it will now be a full scan" : ""}.`,
    };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    console.error(error);
    return { ok: false, message: "The run could not be queued. Try again." };
  }
}
