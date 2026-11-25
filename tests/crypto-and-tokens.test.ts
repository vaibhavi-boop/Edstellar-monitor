import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, keyedHash, safeEqual } from "@/server/security/crypto";
import { signSession, verifySession } from "@/server/auth/token";
import { hashPassword, passwordSchema, verifyPassword } from "@/server/auth/password";

const KEY = Buffer.alloc(32, 7).toString("base64");
const SECRET = "x".repeat(40);

describe("secret encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptSecret("Bearer abc123", KEY);
    const b = encryptSecret("Bearer abc123", KEY);
    expect(a).not.toEqual(b);
    expect(a).not.toContain("abc123");
    expect(decryptSecret(a, KEY)).toBe("Bearer abc123");
  });
  it("detects tampering", () => {
    const parts = encryptSecret("hooks.slack.com/x", KEY).split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."), KEY)).toThrow();
  });
  it("rejects keys of the wrong length", () => {
    expect(() => encryptSecret("x", Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
  });
  it("hashes and compares safely", () => {
    expect(keyedHash("1.2.3.4", SECRET)).toHaveLength(32);
    expect(keyedHash("1.2.3.4", SECRET)).not.toBe(keyedHash("1.2.3.5", SECRET));
    expect(safeEqual("token", "token")).toBe(true);
    expect(safeEqual("token", "tokem")).toBe(false);
    expect(safeEqual("token", "token-longer")).toBe(false);
  });
});

describe("session tokens", () => {
  it("signs and verifies claims", async () => {
    const token = await signSession({ sub: "u1", role: "ADMIN", sv: 3 }, 1, SECRET);
    await expect(verifySession(token, SECRET)).resolves.toEqual({ sub: "u1", role: "ADMIN", sv: 3 });
  });
  it("rejects tokens signed with another secret or altered", async () => {
    const token = await signSession({ sub: "u1", role: "VIEWER", sv: 1 }, 1, SECRET);
    await expect(verifySession(token, "y".repeat(40))).resolves.toBeNull();
    const [h, , s] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "u1", role: "ADMIN", sv: 1 })).toString("base64url");
    await expect(verifySession(`${h}.${forged}.${s}`, SECRET)).resolves.toBeNull();
    await expect(verifySession(undefined, SECRET)).resolves.toBeNull();
  });
  it("refuses a short AUTH_SECRET", async () => {
    await expect(signSession({ sub: "u", role: "VIEWER", sv: 1 }, 1, "short")).rejects.toThrow(/32 characters/);
  });
});

describe("passwords", () => {
  it("hashes with bcrypt and verifies", async () => {
    const hash = await hashPassword("correct-horse-42");
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    await expect(verifyPassword("correct-horse-42", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-horse-42", hash)).resolves.toBe(false);
  });
  it("enforces the password policy", () => {
    expect(passwordSchema.safeParse("short1").success).toBe(false);
    expect(passwordSchema.safeParse("onlyletterslong").success).toBe(false);
    expect(passwordSchema.safeParse("long-enough-123").success).toBe(true);
  });
});
