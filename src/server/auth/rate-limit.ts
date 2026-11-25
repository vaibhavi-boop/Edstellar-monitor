import "server-only";
import { db } from "@/lib/db";

/** Login throttling backed by Postgres, so it works across serverless instances. */
export const LOGIN_WINDOW_MINUTES = 15;
const MAX_FAILURES_PER_EMAIL = 5;
const MAX_FAILURES_PER_IP = 25;

export async function isLoginThrottled(email: string, ipHash: string): Promise<boolean> {
  const since = new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60_000);
  const [byEmail, byIp] = await Promise.all([
    db.loginAttempt.count({ where: { email, success: false, createdAt: { gte: since } } }),
    db.loginAttempt.count({ where: { ipHash, success: false, createdAt: { gte: since } } }),
  ]);
  return byEmail >= MAX_FAILURES_PER_EMAIL || byIp >= MAX_FAILURES_PER_IP;
}

export async function recordLoginAttempt(email: string, ipHash: string, success: boolean): Promise<void> {
  await db.loginAttempt.create({ data: { email, ipHash, success } });
  if (success) {
    // A successful sign-in clears the failure streak for that account.
    await db.loginAttempt.deleteMany({ where: { email, success: false } });
  }
  // Opportunistic cleanup keeps the table small without a cron job.
  if (Math.random() < 0.05) {
    await db.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 3_600_000) } } });
  }
}
