import { describe, expect, it } from "vitest";
import { configFromFormData, fieldErrors, lines, websiteConfigSchema } from "@/server/websites/schema";
import { hasRole } from "@/server/auth/roles";
import { isActivePath } from "@/lib/navigation";

function form(overrides: Record<string, string | string[]> = {}): FormData {
  const base: Record<string, string | string[]> = {
    crawlFrequencyMinutes: "240",
    crawlDepth: "10",
    maxUrls: "10000",
    concurrentRequests: "4",
    requestTimeoutSeconds: "15",
    retryAttempts: "3",
    userAgent: "EdstellarMonitor/1.0 (+https://www.edstellar.com)",
    includeWwwVariant: "on",
    includePatterns: "",
    excludePatterns: "/search*\n/cart/**\n/search*",
    keptQueryParams: "page",
    sslWarningDays: "30, 15, 7, 3",
    ignoredIssueTypes: ["seo.noindex"],
    ...overrides,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries(base)) for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item);
  return fd;
}

describe("website configuration validation", () => {
  it("accepts the four-hour defaults", () => {
    const parsed = websiteConfigSchema.safeParse(configFromFormData(form()));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.crawlFrequencyMinutes).toBe(240);
    expect(parsed.data.requestTimeoutSeconds).toBe(15);
    expect(parsed.data.excludePatterns).toEqual(["/search*", "/cart/**"]);
    expect(parsed.data.includeWwwVariant).toBe(true);
    expect(parsed.data.pageSpeedEnabled).toBe(false);
    expect(parsed.data.sslWarningDays).toEqual([30, 15, 7, 3]);
  });

  it("reports out-of-range and invalid values per field", () => {
    const parsed = websiteConfigSchema.safeParse(
      configFromFormData(
        form({
          crawlFrequencyMinutes: "7",
          concurrentRequests: "50",
          requestTimeoutSeconds: "0",
          excludePatterns: "search\n/ok/**",
          userAgent: "x",
          ignoredIssueTypes: ["made.up"],
          sslWarningDays: "",
        }),
      ),
    );
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const errors = fieldErrors(parsed.error);
    expect(Object.keys(errors).sort()).toEqual(
      ["concurrentRequests", "crawlFrequencyMinutes", "excludePatterns", "ignoredIssueTypes", "requestTimeoutSeconds", "sslWarningDays", "userAgent"].sort(),
    );
    expect(errors.excludePatterns?.[0]).toMatch(/start with \//);
  });

  it("refuses patterns with characters that could break matching", () => {
    expect(websiteConfigSchema.shape.includePatterns.safeParse(["/a b"]).success).toBe(false);
    expect(websiteConfigSchema.shape.includePatterns.safeParse(["/<script>"]).success).toBe(false);
    expect(websiteConfigSchema.shape.includePatterns.safeParse(["/courses/**", "/*?page=*"]).success).toBe(true);
  });

  it("splits textarea lines", () => expect(lines(" a \r\n\n b\na ")).toEqual(["a", "b"]));
});

describe("roles and navigation", () => {
  it("applies the role hierarchy", () => {
    expect(hasRole("ADMIN", "EDITOR")).toBe(true);
    expect(hasRole("EDITOR", "ADMIN")).toBe(false);
    expect(hasRole("VIEWER", "VIEWER")).toBe(true);
  });
  it("matches active sidebar items", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/websites/abc", "/")).toBe(false);
    expect(isActivePath("/websites/abc", "/websites")).toBe(true);
    expect(isActivePath("/websites-old", "/websites")).toBe(false);
  });
});
