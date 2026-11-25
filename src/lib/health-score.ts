/**
 * Website health score, 0–100. Three parts, each explainable on its own:
 *
 *   Availability  50 pts  50 × (healthy URLs ÷ checked URLs)
 *   Open issues   40 pts  40 − (10 per critical + 4 per high + 1 per medium + 0.25 per low), floor 0
 *   SSL           10 pts  10 if valid with more than 30 days left, 5 if valid with 30 days or less, else 0
 *
 * Informational issues never lower the score. While SSL has not been checked
 * yet, availability and issues are scaled up to 100 so the score is not capped
 * at 90 by missing data. Returns null until at least one
 * URL has been checked, so an unmonitored site never shows a misleading 100.
 */

export interface HealthInputs {
  checkedUrls: number;
  healthyUrls: number;
  openIssues: { critical: number; high: number; medium: number; low: number };
  ssl: { valid: boolean; daysRemaining: number | null } | null;
}

export interface HealthScore {
  score: number;
  availability: number;
  issues: number;
  /** null when SSL has not been checked yet. */
  ssl: number | null;
}

export const HEALTH_WEIGHTS = { availability: 50, issues: 40, ssl: 10 } as const;
export const ISSUE_PENALTIES = { critical: 10, high: 4, medium: 1, low: 0.25 } as const;

export function computeHealthScore(input: HealthInputs): HealthScore | null {
  if (input.checkedUrls <= 0) return null;
  const healthy = Math.min(Math.max(input.healthyUrls, 0), input.checkedUrls);
  const availability = HEALTH_WEIGHTS.availability * (healthy / input.checkedUrls);

  const { critical, high, medium, low } = input.openIssues;
  const penalty =
    critical * ISSUE_PENALTIES.critical +
    high * ISSUE_PENALTIES.high +
    medium * ISSUE_PENALTIES.medium +
    low * ISSUE_PENALTIES.low;
  const issues = Math.max(0, HEALTH_WEIGHTS.issues - penalty);

  let ssl = 0;
  if (input.ssl?.valid) {
    ssl = input.ssl.daysRemaining != null && input.ssl.daysRemaining <= 30 ? HEALTH_WEIGHTS.ssl / 2 : HEALTH_WEIGHTS.ssl;
  }

  const round1 = (n: number) => Math.round(n * 10) / 10;
  const total =
    input.ssl === null
      ? ((availability + issues) * 100) / (HEALTH_WEIGHTS.availability + HEALTH_WEIGHTS.issues)
      : availability + issues + ssl;
  return {
    score: Math.round(total),
    availability: round1(availability),
    issues: round1(issues),
    ssl: input.ssl === null ? null : round1(ssl),
  };
}
