import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { Role } from "@/generated/prisma/enums";
import { hasRole } from "./roles";
import { SESSION_COOKIE, signSession, verifySession } from "./token";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

export async function startSession(user: { id: string; role: Role; sessionVersion: number }): Promise<void> {
  const { SESSION_TTL_HOURS, NODE_ENV } = env();
  const token = await signSession({ sub: user.id, role: user.role, sv: user.sessionVersion }, SESSION_TTL_HOURS);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_HOURS * 3600,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/**
 * The signed-in user, validated against the database: the account must still
 * be active and the token's session version must match (so role changes,
 * password resets and "sign out everywhere" take effect immediately).
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const jar = await cookies();
  const claims = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!claims) return null;
  const user = await db.user.findUnique({
    where: { id: claims.sub },
    select: { id: true, email: true, name: true, role: true, isActive: true, sessionVersion: true },
  });
  if (!user || !user.isActive || user.sessionVersion !== claims.sv) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    const jar = await cookies();
    // A signed cookie that fails the database check means the session was revoked.
    redirect(jar.has(SESSION_COOKIE) ? "/login?reason=ended" : "/login");
  }
  return user;
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to do that") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** For pages: redirects anonymous users, shows the 403 state for the wrong role. */
export async function requireRole(role: Role): Promise<CurrentUser> {
  const user = await requireUser();
  if (!hasRole(user.role, role)) redirect("/forbidden");
  return user;
}

/** For server actions: throws instead of redirecting so the form can show the error. */
export async function authorize(role: Role): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new ForbiddenError("Your session has expired. Sign in again.");
  if (!hasRole(user.role, role)) throw new ForbiddenError();
  return user;
}
