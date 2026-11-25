import { z } from "zod";
import { ISSUE_TYPE_KEYS } from "@/lib/issue-catalog";

export const CRAWL_FREQUENCIES = [60, 120, 240, 360, 720, 1440] as const;
export const DEFAULT_FREQUENCY = 240;

/** Splits a textarea into trimmed, non-empty, de-duplicated lines. */
export function lines(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return [...new Set(value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))];
}

const intField = (min: number, max: number, label: string) =>
  z.coerce
    .number({ message: `${label} must be a number` })
    .int(`${label} must be a whole number`)
    .min(min, `${label} must be at least ${min}`)
    .max(max, `${label} must be at most ${max}`);

/**
 * URL patterns are path globs: they start with "/", "*" matches within a path
 * segment and "**" matches across segments, e.g. /blog/** or /*?preview=*.
 */
export const urlPatternSchema = z
  .string()
  .max(200, "Patterns can be at most 200 characters")
  .regex(/^\/[A-Za-z0-9\-._~*/?=&%+:@!$,;]*$/, "Patterns must start with / and contain only URL characters");

export const websiteCreateSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80, "Name must be at most 80 characters"),
  url: z.string().trim().min(1, "Enter the website URL").max(300),
});

export const websiteGeneralSchema = websiteCreateSchema;

export const websiteConfigSchema = z.object({
  crawlFrequencyMinutes: z.coerce
    .number()
    .refine((v) => (CRAWL_FREQUENCIES as readonly number[]).includes(v), "Choose one of the listed frequencies"),
  crawlDepth: intField(1, 50, "Crawl depth"),
  maxUrls: intField(1, 100_000, "Maximum URLs"),
  concurrentRequests: intField(1, 10, "Concurrent requests"),
  requestTimeoutSeconds: intField(1, 60, "Request timeout (seconds)"),
  retryAttempts: intField(0, 5, "Retry attempts"),
  userAgent: z
    .string()
    .trim()
    .min(8, "User agent must be at least 8 characters")
    .max(200, "User agent must be at most 200 characters")
    .regex(/^[\x20-\x7E]+$/, "User agent can contain printable ASCII characters only"),
  includeWwwVariant: z.boolean(),
  respectRobotsTxt: z.boolean(),
  hostAliases: z
    .array(
      z
        .string()
        .toLowerCase()
        .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, "Host aliases are host names such as www.example.com"),
    )
    .max(10, "At most 10 host aliases"),
  includePatterns: z.array(urlPatternSchema).max(100, "At most 100 include patterns"),
  excludePatterns: z.array(urlPatternSchema).max(100, "At most 100 exclude patterns"),
  keptQueryParams: z
    .array(z.string().regex(/^[A-Za-z0-9_\-[\]]{1,50}$/, "Query parameter names can use letters, digits, - and _"))
    .max(30, "At most 30 query parameters"),
  ignoredIssueTypes: z.array(z.string().refine((k) => ISSUE_TYPE_KEYS.has(k), "Unknown issue type")),
  sslWarningDays: z
    .array(intField(1, 120, "SSL warning day"))
    .min(1, "Keep at least one SSL warning threshold")
    .max(6, "At most 6 SSL warning thresholds"),
  pageSpeedEnabled: z.boolean(),
});

export type WebsiteConfigInput = z.infer<typeof websiteConfigSchema>;

/** Reads the configuration form into the shape the schema validates. */
export function configFromFormData(form: FormData): Record<string, unknown> {
  return {
    crawlFrequencyMinutes: form.get("crawlFrequencyMinutes"),
    crawlDepth: form.get("crawlDepth"),
    maxUrls: form.get("maxUrls"),
    concurrentRequests: form.get("concurrentRequests"),
    requestTimeoutSeconds: form.get("requestTimeoutSeconds"),
    retryAttempts: form.get("retryAttempts"),
    userAgent: form.get("userAgent"),
    includeWwwVariant: form.get("includeWwwVariant") === "on",
    respectRobotsTxt: form.get("respectRobotsTxt") === "on",
    hostAliases: lines(form.get("hostAliases")).map((h) => h.replace(/^https?:\/\//i, "").replace(/\/.*$/, "")),
    includePatterns: lines(form.get("includePatterns")),
    excludePatterns: lines(form.get("excludePatterns")),
    keptQueryParams: lines(form.get("keptQueryParams")),
    ignoredIssueTypes: form.getAll("ignoredIssueTypes").map(String),
    sslWarningDays: String(form.get("sslWarningDays") ?? "")
      .split(/[,\s]+/)
      .filter(Boolean)
      .map(Number),
    pageSpeedEnabled: form.get("pageSpeedEnabled") === "on",
  };
}

/** Flattens zod errors into { field: messages } for forms. Array items map to their field. */
export function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    (out[key] ??= []).push(issue.message);
  }
  for (const key of Object.keys(out)) out[key] = [...new Set(out[key])];
  return out;
}
