"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import type { ActionState } from "@/lib/action-state";
import { audit } from "@/server/audit";
import { clientIpHash } from "@/server/request";
import { fieldErrors } from "@/server/websites/schema";
import { burnPasswordCheck, hashPassword, passwordSchema, verifyPassword } from "./password";
import { isLoginThrottled, LOGIN_WINDOW_MINUTES, recordLoginAttempt } from "./rate-limit";
import { endSession, getCurrentUser, startSession } from "./session";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  password: z.string().min(1, "Enter your password").max(128),
});

/** Only same-site relative paths are allowed as a post-login destination. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

export async function login(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  const values = { email: String(form.get("email") ?? "") };
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error), values };
  const { email, password } = parsed.data;
  const ipHash = await clientIpHash();

  if (await isLoginThrottled(email, ipHash)) {
    return { ok: false, message: `Too many failed attempts. Try again in ${LOGIN_WINDOW_MINUTES} minutes.`, values };
  }

  const user = await db.user.findUnique({ where: { email } });
  const valid = user ? await verifyPassword(password, user.passwordHash) : (await burnPasswordCheck(password), false);

  if (!user || !valid || !user.isActive) {
    await recordLoginAttempt(email, ipHash, false);
    // One message for every failure, so the form does not reveal which accounts exist.
    return { ok: false, message: "Email or password is incorrect, or the account is deactivated.", values };
  }

  await recordLoginAttempt(email, ipHash, true);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await startSession(user);
  await audit({ actorId: user.id, action: "auth.login", entityType: "User", entityId: user.id, ipHash });
  redirect(safeNext(form.get("next")));
}

export async function logout(): Promise<void> {
  const user = await getCurrentUser();
  await endSession();
  if (user) await audit({ actorId: user.id, action: "auth.logout", entityType: "User", entityId: user.id });
  redirect("/login");
}

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "The new passwords do not match",
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "Choose a password you have not used here",
  });

export async function changePassword(_prev: ActionState, form: FormData): Promise<ActionState> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, message: "Your session has expired. Sign in again." };
  const parsed = changePasswordSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };

  const user = await db.user.findUniqueOrThrow({ where: { id: current.id } });
  if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    return { ok: false, fieldErrors: { currentPassword: ["Current password is incorrect"] } };
  }
  const updated = await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.newPassword), sessionVersion: { increment: 1 } },
  });
  // Other sessions end; this one is re-issued with the new session version.
  await startSession(updated);
  await audit({ actorId: user.id, action: "auth.password_changed", entityType: "User", entityId: user.id, ipHash: await clientIpHash() });
  return { ok: true, message: "Password changed. Other sessions have been signed out." };
}

export async function signOutEverywhere(): Promise<void> {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  await db.user.update({ where: { id: current.id }, data: { sessionVersion: { increment: 1 } } });
  await audit({ actorId: current.id, action: "auth.signed_out_everywhere", entityType: "User", entityId: current.id });
  await endSession();
  redirect("/login");
}
