"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import type { ActionState } from "@/lib/action-state";
import { audit } from "@/server/audit";
import { authorize, ForbiddenError, requireUser } from "@/server/auth/session";
import { clientIpHash } from "@/server/request";
import { assertPublicHost, parsePublicUrl, rootDomain, UrlGuardError } from "@/server/security/url-guard";
import { DEFAULT_USER_AGENT } from "./defaults";
import { ACTIVE_WEBSITE_COOKIE } from "./queries";
import { configFromFormData, fieldErrors, websiteConfigSchema, websiteCreateSchema } from "./schema";

function toState(error: unknown): ActionState {
  if (error instanceof ForbiddenError) return { ok: false, message: error.message };
  if (error instanceof UrlGuardError) return { ok: false, fieldErrors: { url: [error.message] } };
  console.error(error);
  return { ok: false, message: "Something went wrong while saving. Try again." };
}

/** Validates a site URL, resolves DNS and returns the canonical URL + domain. */
async function checkSiteUrl(raw: string) {
  const url = parsePublicUrl(raw);
  await assertPublicHost(url.hostname);
  return { url: `${url.protocol}//${url.hostname}`, domain: rootDomain(url.hostname) };
}

export async function createWebsite(_prev: ActionState, form: FormData): Promise<ActionState> {
  let websiteId: string;
  try {
    const user = await authorize("ADMIN");
    const parsed = websiteCreateSchema.safeParse({ name: form.get("name"), url: form.get("url") });
    if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };

    const target = parsePublicUrl(parsed.data.url);
    const existing = await db.website.findUnique({ where: { domain: rootDomain(target.hostname) }, select: { id: true } });
    if (existing) return { ok: false, fieldErrors: { url: [`${rootDomain(target.hostname)} is already being monitored`] } };
    const { url, domain } = await checkSiteUrl(parsed.data.url);

    const website = await db.website.create({
      data: {
        name: parsed.data.name,
        url,
        domain,
        createdById: user.id,
        configuration: { create: { userAgent: DEFAULT_USER_AGENT } },
      },
    });
    websiteId = website.id;
    await audit({
      actorId: user.id,
      action: "website.created",
      entityType: "Website",
      entityId: website.id,
      metadata: { name: website.name, url, domain },
      ipHash: await clientIpHash(),
    });
    (await cookies()).set(ACTIVE_WEBSITE_COOKIE, website.id, { path: "/", sameSite: "lax", httpOnly: true });
  } catch (error) {
    return toState(error);
  }
  revalidatePath("/", "layout");
  redirect(`/websites/${websiteId}?created=1`);
}

export async function updateWebsiteGeneral(websiteId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await authorize("ADMIN");
    const parsed = websiteCreateSchema.safeParse({ name: form.get("name"), url: form.get("url") });
    if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };

    const current = await db.website.findUnique({ where: { id: websiteId } });
    if (!current) return { ok: false, message: "This website no longer exists." };

    const { url, domain } = await checkSiteUrl(parsed.data.url);
    if (domain !== current.domain) {
      const clash = await db.website.findUnique({ where: { domain }, select: { id: true } });
      if (clash) return { ok: false, fieldErrors: { url: [`${domain} is already being monitored`] } };
    }
    await db.website.update({ where: { id: websiteId }, data: { name: parsed.data.name, url, domain } });
    await audit({
      actorId: user.id,
      action: "website.updated",
      entityType: "Website",
      entityId: websiteId,
      metadata: { before: { name: current.name, url: current.url }, after: { name: parsed.data.name, url } },
      ipHash: await clientIpHash(),
    });
    revalidatePath("/", "layout");
    return {
      ok: true,
      message:
        domain !== current.domain
          ? `Saved. The domain changed to ${domain}; existing results stay attached to this website.`
          : "Website details saved.",
    };
  } catch (error) {
    return toState(error);
  }
}

export async function updateWebsiteConfiguration(
  websiteId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await authorize("ADMIN");
    const parsed = websiteConfigSchema.safeParse(configFromFormData(form));
    if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };

    const { requestTimeoutSeconds, sslWarningDays, ...rest } = parsed.data;
    const data = {
      ...rest,
      requestTimeoutMs: requestTimeoutSeconds * 1000,
      sslWarningDays: [...new Set(sslWarningDays)].sort((a, b) => b - a),
    };
    const before = await db.websiteConfiguration.findUnique({ where: { websiteId } });
    if (!before) return { ok: false, message: "This website no longer exists." };

    await db.websiteConfiguration.update({ where: { websiteId }, data });
    const changed = Object.keys(data).filter(
      (k) => JSON.stringify(before[k as keyof typeof before]) !== JSON.stringify(data[k as keyof typeof data]),
    );
    await audit({
      actorId: user.id,
      action: "website.configuration_updated",
      entityType: "Website",
      entityId: websiteId,
      metadata: { changed },
      ipHash: await clientIpHash(),
    });
    revalidatePath(`/websites/${websiteId}`);
    return { ok: true, message: changed.length ? "Monitoring settings saved." : "No changes to save." };
  } catch (error) {
    return toState(error);
  }
}

export async function setWebsiteStatus(websiteId: string, status: "ACTIVE" | "PAUSED"): Promise<ActionState> {
  try {
    const user = await authorize("ADMIN");
    await db.website.update({ where: { id: websiteId }, data: { status } });
    await audit({
      actorId: user.id,
      action: status === "PAUSED" ? "website.paused" : "website.resumed",
      entityType: "Website",
      entityId: websiteId,
      ipHash: await clientIpHash(),
    });
    revalidatePath("/", "layout");
    return { ok: true, message: status === "PAUSED" ? "Monitoring paused." : "Monitoring resumed." };
  } catch (error) {
    return toState(error);
  }
}

export async function deleteWebsite(websiteId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await authorize("ADMIN");
    const website = await db.website.findUnique({ where: { id: websiteId } });
    if (!website) return { ok: false, message: "This website no longer exists." };
    if (String(form.get("confirm") ?? "").trim().toLowerCase() !== website.domain) {
      return { ok: false, fieldErrors: { confirm: [`Type ${website.domain} to confirm`] } };
    }
    await db.website.delete({ where: { id: websiteId } });
    await audit({
      actorId: user.id,
      action: "website.deleted",
      entityType: "Website",
      entityId: websiteId,
      metadata: { name: website.name, domain: website.domain },
      ipHash: await clientIpHash(),
    });
    const jar = await cookies();
    if (jar.get(ACTIVE_WEBSITE_COOKIE)?.value === websiteId) jar.delete(ACTIVE_WEBSITE_COOKIE);
  } catch (error) {
    return toState(error);
  }
  revalidatePath("/", "layout");
  redirect("/websites");
}

/** Website switcher in the top bar. Any signed-in user may change focus. */
export async function selectWebsite(websiteId: string): Promise<void> {
  await requireUser();
  const exists = await db.website.findUnique({ where: { id: websiteId }, select: { id: true } });
  if (!exists) return;
  (await cookies()).set(ACTIVE_WEBSITE_COOKIE, websiteId, { path: "/", sameSite: "lax", httpOnly: true });
  revalidatePath("/", "layout");
}
