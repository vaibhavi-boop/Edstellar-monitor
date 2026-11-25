import { describe, expect, it } from "vitest";
import { computeHealthScore } from "@/lib/health-score";
import { ISSUE_TYPES, ISSUE_TYPE_KEYS } from "@/lib/issue-catalog";

const none = { critical: 0, high: 0, medium: 0, low: 0 };

describe("health score", () => {
  it("is null before anything is checked", () => {
    expect(computeHealthScore({ checkedUrls: 0, healthyUrls: 0, openIssues: none, ssl: null })).toBeNull();
  });
  it("is 100 for a fully healthy site with a long-lived certificate", () => {
    expect(computeHealthScore({ checkedUrls: 500, healthyUrls: 500, openIssues: none, ssl: { valid: true, daysRemaining: 80 } })).toEqual({
      score: 100, availability: 50, issues: 40, ssl: 10,
    });
  });
  it("scales to 100 when SSL has not been checked yet", () => {
    const s = computeHealthScore({ checkedUrls: 10, healthyUrls: 10, openIssues: none, ssl: null });
    expect(s?.score).toBe(100);
    expect(s?.ssl).toBeNull();
  });
  it("applies issue penalties and floors them at zero", () => {
    const s = computeHealthScore({
      checkedUrls: 100,
      healthyUrls: 90,
      openIssues: { critical: 1, high: 2, medium: 3, low: 4 },
      ssl: { valid: true, daysRemaining: 12 },
    });
    // availability 45, issues 40 - (10 + 8 + 3 + 1) = 18, ssl 5
    expect(s).toEqual({ score: 68, availability: 45, issues: 18, ssl: 5 });
    expect(computeHealthScore({ checkedUrls: 1, healthyUrls: 1, openIssues: { ...none, critical: 9 }, ssl: { valid: false, daysRemaining: null } })?.issues).toBe(0);
  });
});

describe("issue catalogue", () => {
  it("has unique keys covering every category", () => {
    expect(ISSUE_TYPE_KEYS.size).toBe(ISSUE_TYPES.length);
    const categories = new Set(ISSUE_TYPES.map((t) => t.category));
    expect([...categories].sort()).toEqual(["API", "AVAILABILITY", "BROKEN_LINK", "DNS", "PERFORMANCE", "REDIRECT", "ROBOTS", "SEO", "SITEMAP", "SSL"]);
  });
});
