import { jwtVerify, SignJWT } from "jose";
import type { Role } from "@/generated/prisma/enums";

/**
 * Session tokens are short HS256 JWTs. The proxy only verifies the signature
 * (cheap, no database); server components re-check the user, their active
 * flag and session version against the database on every request.
 */

export const SESSION_COOKIE = "em_session";

export interface SessionClaims {
  sub: string;
  role: Role;
  sv: number;
}

function secretKey(secret = process.env.AUTH_SECRET): Uint8Array {
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must be set to at least 32 characters");
  return new TextEncoder().encode(secret);
}

export async function signSession(claims: SessionClaims, ttlHours: number, secret?: string): Promise<string> {
  return new SignJWT({ role: claims.role, sv: claims.sv })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer("edstellar-monitor")
    .setAudience("edstellar-monitor")
    .setIssuedAt()
    .setExpirationTime(`${ttlHours}h`)
    .sign(secretKey(secret));
}

export async function verifySession(token: string | undefined, secret?: string): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), {
      algorithms: ["HS256"],
      issuer: "edstellar-monitor",
      audience: "edstellar-monitor",
    });
    if (typeof payload.sub !== "string" || typeof payload.sv !== "number" || typeof payload.role !== "string") {
      return null;
    }
    return { sub: payload.sub, role: payload.role as Role, sv: payload.sv };
  } catch {
    return null;
  }
}
