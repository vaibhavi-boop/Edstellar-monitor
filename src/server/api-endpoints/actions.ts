"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import type { ActionState } from "@/lib/action-state";
import { audit } from "@/server/audit";
import { authorize, ForbiddenError } from "@/server/auth/session";
import { runEndpointCheck } from "@/server/engine/checks/api-run";
import { defaultFetchPolicy } from "@/server/engine/http";
import { clientIpHash } from "@/server/request";
import { encryptSecret } from "@/server/security/crypto";
import { assertPublicHost, parsePublicUrl, UrlGuardError } from "@/server/security/url-guard";
import { DEFAULT_USER_AGENT } from "@/server/websites/defaults";
import { fieldErrors } from "@/server/websites/schema";
import { apiEndpointFromForm, apiEndpointSchema, credentialFor } from "./schema";

function toState(error: unknown): ActionState {
  if (error instanceof ForbiddenError) return { ok: false, message: error.message };
  if (error instanceof UrlGuardError) return { ok: false, fieldErrors: { url: [error.message] } };
  console.error(error);
  return { ok: false, message: "Something went wrong while saving. Try again." };
}

async function validate(form: FormData, existing: { encryptedAuth: string | null; authType: string } | null) {
  const raw = apiEndpointFromForm(form);
  if (raw.headerError) return { state: { ok: false, fieldErrors: { headers: [raw.headerError] } } satisfies ActionState };
  const parsed = apiEndpointSchema.safeParse(raw.data);
  if (!parsed.success) return { state: { ok: false, fieldErrors: fieldErrors(parsed.error) } satisfies ActionState };
  const v = parsed.data;

  const url = parsePublicUrl(v.url);
  await assertPublicHost(url.hostname);

  const credential = credentialFor(v, Boolean(existing?.encryptedAuth), existing?.authType ?? null);
  if (credential.error) return { state: { ok: false, fieldErrors: { [credential.error[0]]: [credential.error[1]] } } satisfies ActionState };
  let encryptedAuth: string | null | undefined = credential.json === undefined ? undefined : null;
  if (credential.json) {
    if (!process.env.ENCRYPTION_KEY) return { state: { ok: false, message: "ENCRYPTION_KEY is not set on the server, so credentials cannot be stored safely." } satisfies ActionState };
    encryptedAuth = encryptSecret(credential.json);
  }

  return {
    data: {
      name: v.name,
      url: url.href,
      method: v.method,
      headers: v.headers,
      authType: v.authType,
      ...(encryptedAuth !== undefined ? { encryptedAuth } : {}),
      requestBody: v.method === "GET" ? null : v.requestBody || null,
      expectedStatus: v.expectedStatus,
      expectedFields: v.expectedFields,
      timeoutMs: v.timeoutSeconds * 1000,
      frequencyMinutes: v.frequencyMinutes,
      isActive: v.isActive,
    },
  };
}

export async function createApiEndpoint(websiteId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  let id: string;
  try {
    const user = await authorize("ADMIN");
    const website = await db.website.findUnique({ where: { id: websiteId }, select: { id: true } });
    if (!website) return { ok: false, message: "This website no longer exists." };
    const result = await validate(form, null);
    if (result.state) return result.state;
    const endpoint = await db.apiEndpoint.create({ data: { websiteId, ...result.data } });
    id = endpoint.id;
    await audit({ actorId: user.id, action: "api.created", entityType: "ApiEndpoint", entityId: id, metadata: { name: endpoint.name, url: endpoint.url }, ipHash: await clientIpHash() });
  } catch (error) {
    return toState(error);
  }
  revalidatePath("/api-monitoring");
  redirect(`/api-monitoring/${id}?created=1`);
}

export async function updateApiEndpoint(endpointId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await authorize("ADMIN");
    const existing = await db.apiEndpoint.findUnique({ where: { id: endpointId }, select: { encryptedAuth: true, authType: true, name: true } });
    if (!existing) return { ok: false, message: "This endpoint no longer exists." };
    const result = await validate(form, existing);
    if (result.state) return result.state;
    await db.apiEndpoint.update({ where: { id: endpointId }, data: result.data });
    await audit({
      actorId: user.id,
      action: "api.updated",
      entityType: "ApiEndpoint",
      entityId: endpointId,
      metadata: { name: result.data.name, credentialsChanged: "encryptedAuth" in result.data },
      ipHash: await clientIpHash(),
    });
    revalidatePath(`/api-monitoring/${endpointId}`);
    revalidatePath("/api-monitoring");
    return { ok: true, message: "Endpoint saved. The next check uses the new settings." };
  } catch (error) {
    return toState(error);
  }
}

export async function deleteApiEndpoint(endpointId: string): Promise<ActionState> {
  try {
    const user = await authorize("ADMIN");
    const endpoint = await db.apiEndpoint.findUnique({ where: { id: endpointId }, select: { id: true, name: true, websiteId: true } });
    if (!endpoint) return { ok: false, message: "This endpoint no longer exists." };
    // Its open issues can no longer be re-checked: resolve them with a note.
    const open = await db.issue.findMany({
      where: { websiteId: endpoint.websiteId, category: "API", status: { in: ["NEW", "OPEN", "IN_PROGRESS"] }, details: { path: ["page"], equals: `api:${endpoint.id}` } },
      select: { id: true, status: true },
    });
    const now = new Date();
    await db.$transaction([
      db.issue.updateMany({ where: { id: { in: open.map((i) => i.id) } }, data: { status: "RESOLVED", resolvedAt: now } }),
      db.issueOccurrence.createMany({
        data: open.map((i) => ({ issueId: i.id, kind: "STATUS_CHANGED" as const, fromStatus: i.status, toStatus: "RESOLVED" as const, note: `Endpoint "${endpoint.name}" was removed`, actorId: user.id, createdAt: now })),
      }),
      db.apiEndpoint.delete({ where: { id: endpointId } }),
    ]);
    await audit({ actorId: user.id, action: "api.deleted", entityType: "ApiEndpoint", entityId: endpointId, metadata: { name: endpoint.name }, ipHash: await clientIpHash() });
  } catch (error) {
    return toState(error);
  }
  revalidatePath("/api-monitoring");
  redirect("/api-monitoring");
}

/** Runs one check now and records the result. Issues are updated by the next monitoring run. */
export async function checkApiEndpointNow(endpointId: string): Promise<ActionState> {
  try {
    await authorize("EDITOR");
    const endpoint = await db.apiEndpoint.findUnique({ where: { id: endpointId }, include: { website: { select: { configuration: { select: { userAgent: true } } } } } });
    if (!endpoint) return { ok: false, message: "This endpoint no longer exists." };
    const policy = defaultFetchPolicy({ userAgent: endpoint.website.configuration?.userAgent ?? DEFAULT_USER_AGENT, timeoutMs: endpoint.timeoutMs });
    const { website: _w, ...row } = endpoint;
    void _w;
    const outcome = await runEndpointCheck(db, row, policy, null);
    revalidatePath(`/api-monitoring/${endpointId}`);
    revalidatePath("/api-monitoring");
    return outcome.ok
      ? { ok: true, message: `Passed: HTTP ${outcome.statusCode} in ${outcome.responseTimeMs} ms.` }
      : { ok: false, message: `Failed: ${outcome.errorMessage ?? "unknown error"}` };
  } catch (error) {
    return toState(error);
  }
}
