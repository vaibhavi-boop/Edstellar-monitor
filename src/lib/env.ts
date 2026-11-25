import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  APP_URL: z.string().url().default("http://localhost:3000"),
  ENCRYPTION_KEY: z.string().optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

/** Validated server environment. Throws a readable error on misconfiguration. */
export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}\nSee .env.example.`);
  }
  cached = parsed.data;
  return cached;
}
