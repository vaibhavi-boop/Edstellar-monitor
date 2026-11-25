import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * AES-256-GCM encryption for secrets stored in the database (API credentials,
 * Slack webhook URLs). Format: v1.<iv>.<tag>.<ciphertext>, each base64url.
 */

function loadKey(raw = process.env.ENCRYPTION_KEY): Buffer {
  if (!raw) throw new Error("ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes");
  return key;
}

export function encryptSecret(plaintext: string, rawKey?: string): string {
  const key = loadKey(rawKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, rawKey?: string): string {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised secret format");
  const decipher = createDecipheriv("aes-256-gcm", loadKey(rawKey), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** Keyed hash for values that must be correlated but never stored raw (IP addresses). */
export function keyedHash(value: string, secret = process.env.AUTH_SECRET ?? ""): string {
  return createHmac("sha256", secret).update(value).digest("hex").slice(0, 32);
}

/** Constant-time comparison for bearer tokens (scheduler endpoint, Phase 5). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
