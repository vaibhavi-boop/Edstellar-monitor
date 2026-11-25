"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import type { ActionState } from "@/lib/action-state";
import { audit } from "@/server/audit";
import { authorize, ForbiddenError } from "@/server/auth/session";
import { normalizeUrl } from "@/server/engine/normalize";
import { createHostMapper, createScope } from "@/server/engine/scope";
import { clientIpHash } from "@/server/request";
import { parsePublicUrl, UrlGuardError } from "@/server/security/url-guard";

const SCOPE_MESSAGES = {
  host: "This URL is on a different host. Only the website's own domain (and its host aliases) can be added.",
  include: "This path is not covered by the website's include patterns.",
  exclude: "This path matches one of the website's exclude patterns.",
} as const;

/** Adds a URL to the inventory so every run checks it, even if nothing links to it. */
export async function addManualUrl(websiteId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const raw = String(form.get("url") ?? "").trim();
  const values = { url: raw };
  try {
    const user = await authorize("EDITOR");
    if (!raw) return { ok: false, fieldErrors: { url: ["Enter the full URL of a page"] }, values };
    if (raw.length > 2000) return { ok: false, fieldErrors: { url: ["URLs can be at most 2,000 characters"] }, values };

    const website = await db.website.findUnique({ where: { id: websiteId }, include: { configuration: true } });
    const cfg = website?.configuration;
    if (!website || !cfg) return { ok: false, message: "This website no longer exists." };

    const url = createHostMapper(website.url, cfg.hostAliases)(parsePublicUrl(raw));
    const decision = createScope({
      domain: website.domain,
      includeWwwVariant: cfg.includeWwwVariant,
      includePatterns: cfg.includePatterns,
      excludePatterns: cfg.excludePatterns,
    })(url);
    if (!decision.inScope) return { ok: false, fieldErrors: { url: [SCOPE_MESSAGES[decision.reason]] }, values };

    const normalizedUrl = normalizeUrl(url, { keptQueryParams: cfg.keptQueryParams });
    if (!normalizedUrl) return { ok: false, fieldErrors: { url: ["Enter a full http or https URL"] }, values };

    const existing = await db.discoveredUrl.findUnique({
      where: { websiteId_normalizedUrl: { websiteId, normalizedUrl } },
      select: { id: true, isManual: true, isActive: true },
    });
    if (existing?.isManual && existing.isActive) {
      return { ok: false, fieldErrors: { url: ["This URL is already in the list as a manual URL"] }, values };
    }
    const row = existing
      ? await db.discoveredUrl.update({ where: { id: existing.id }, data: { isManual: true, isActive: true }, select: { id: true } })
      : await db.discoveredUrl.create({
          data: { websiteId, url: url.href, normalizedUrl, source: "MANUAL", isManual: true },
          select: { id: true },
        });

    await audit({
      actorId: user.id,
      action: "url.added_manually",
      entityType: "DiscoveredUrl",
      entityId: row.id,
      metadata: { url: url.href, websiteId },
      ipHash: await clientIpHash(),
    });
    revalidatePath("/pages");
    return {
      ok: true,
      message: existing
        ? "This URL was already known. It is now kept as a manual URL and checked on every run."
        : "URL added. It will be checked in the next monitoring run.",
    };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    if (error instanceof UrlGuardError) return { ok: false, fieldErrors: { url: [error.message] }, values };
    console.error(error);
    return { ok: false, message: "Something went wrong while saving. Try again.", values };
  }
}
