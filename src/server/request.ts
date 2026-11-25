import "server-only";
import { headers } from "next/headers";
import { keyedHash } from "@/server/security/crypto";

/** Hashed client IP. Raw addresses are never stored. */
export async function clientIpHash(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || h.get("x-real-ip") || "unknown";
  return keyedHash(ip);
}
