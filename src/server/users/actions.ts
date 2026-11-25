"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import type { ActionState } from "@/lib/action-state";
import { Role } from "@/generated/prisma/enums";
import { audit } from "@/server/audit";
import { hashPassword, passwordSchema } from "@/server/auth/password";
import { authorize, ForbiddenError } from "@/server/auth/session";
import { clientIpHash } from "@/server/request";
import { fieldErrors } from "@/server/websites/schema";

const roleSchema = z.enum([Role.ADMIN, Role.EDITOR, Role.VIEWER]);

const createUserSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  role: roleSchema,
  password: passwordSchema,
});

function failure(error: unknown): ActionState {
  if (error instanceof ForbiddenError) return { ok: false, message: error.message };
  console.error(error);
  return { ok: false, message: "Something went wrong. Try again." };
}

async function activeAdminCount(excludingId?: string) {
  return db.user.count({ where: { role: "ADMIN", isActive: true, ...(excludingId ? { id: { not: excludingId } } : {}) } });
}

export async function createUser(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await authorize("ADMIN");
    const parsed = createUserSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
    const { name, email, role, password } = parsed.data;
    if (await db.user.findUnique({ where: { email }, select: { id: true } })) {
      return { ok: false, fieldErrors: { email: ["A user with this email already exists"] } };
    }
    const user = await db.user.create({ data: { name, email, role, passwordHash: await hashPassword(password) } });
    await audit({
      actorId: actor.id,
      action: "user.created",
      entityType: "User",
      entityId: user.id,
      metadata: { email, role },
      ipHash: await clientIpHash(),
    });
    revalidatePath("/settings/users");
    return { ok: true, message: `${name} can now sign in. Share the temporary password through a secure channel.` };
  } catch (error) {
    return failure(error);
  }
}

export async function updateUserRole(userId: string, role: string): Promise<ActionState> {
  try {
    const actor = await authorize("ADMIN");
    const parsedRole = roleSchema.parse(role);
    if (userId === actor.id) return { ok: false, message: "You cannot change your own role." };
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) return { ok: false, message: "User not found." };
    if (user.role === "ADMIN" && parsedRole !== "ADMIN" && (await activeAdminCount(userId)) === 0) {
      return { ok: false, message: "Keep at least one active administrator." };
    }
    // Bumping the session version applies the new role on the next request.
    await db.user.update({ where: { id: userId }, data: { role: parsedRole, sessionVersion: { increment: 1 } } });
    await audit({
      actorId: actor.id,
      action: "user.role_changed",
      entityType: "User",
      entityId: userId,
      metadata: { from: user.role, to: parsedRole },
      ipHash: await clientIpHash(),
    });
    revalidatePath("/settings/users");
    return { ok: true, message: `${user.name} is now ${parsedRole.toLowerCase()}.` };
  } catch (error) {
    return failure(error);
  }
}

export async function setUserActive(userId: string, isActive: boolean): Promise<ActionState> {
  try {
    const actor = await authorize("ADMIN");
    if (userId === actor.id) return { ok: false, message: "You cannot deactivate your own account." };
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) return { ok: false, message: "User not found." };
    if (!isActive && user.role === "ADMIN" && (await activeAdminCount(userId)) === 0) {
      return { ok: false, message: "Keep at least one active administrator." };
    }
    await db.user.update({ where: { id: userId }, data: { isActive, sessionVersion: { increment: 1 } } });
    await audit({
      actorId: actor.id,
      action: isActive ? "user.reactivated" : "user.deactivated",
      entityType: "User",
      entityId: userId,
      ipHash: await clientIpHash(),
    });
    revalidatePath("/settings/users");
    return { ok: true, message: isActive ? `${user.name} can sign in again.` : `${user.name} has been signed out and deactivated.` };
  } catch (error) {
    return failure(error);
  }
}

export async function resetUserPassword(userId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await authorize("ADMIN");
    const parsed = z.object({ password: passwordSchema }).safeParse({ password: form.get("password") });
    if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) return { ok: false, message: "User not found." };
    await db.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(parsed.data.password), sessionVersion: { increment: 1 } },
    });
    await audit({ actorId: actor.id, action: "user.password_reset", entityType: "User", entityId: userId, ipHash: await clientIpHash() });
    return { ok: true, message: `Password reset. ${user.name} has been signed out everywhere.` };
  } catch (error) {
    return failure(error);
  }
}
