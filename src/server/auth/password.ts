import bcrypt from "bcryptjs";
import { z } from "zod";

const COST = 12;

export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(128, "Use at most 128 characters")
  .refine((v) => /[a-z]/i.test(v) && /\d/.test(v), "Include at least one letter and one number");

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Compared against when the email is unknown so response time does not
// reveal which accounts exist.
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= bcrypt.hash("edstellar-monitor-timing-equaliser", COST);
  await bcrypt.compare(password, await dummyHash);
}
