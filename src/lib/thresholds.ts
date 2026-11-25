/**
 * Limits used by the phase 4 checks. Shown on the Performance and SSL screens
 * so the numbers behind every issue are visible.
 */
export const PERFORMANCE = {
  /** Pages measured per run: the home page plus the shallowest pages. */
  sampleSize: 20,
  /** Measurements per page; the median is stored, so one slow response does not raise an issue. */
  samplesPerPage: 3,
  slowTtfbMs: 800,
  slowTotalMs: 3000,
  largeHtmlBytes: 1_000_000,
  /** PageSpeed Insights: pages per run (the API quota is small) and the "low" score. */
  pageSpeedPages: 5,
  lowScore: 50,
} as const;

export const API_CHECKS = {
  maxResponseBytes: 2 * 1024 * 1024,
} as const;
