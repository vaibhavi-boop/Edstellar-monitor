import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const numberFormat = new Intl.NumberFormat("en-IN");
export function formatNumber(value: number | null | undefined): string {
  return value == null ? "—" : numberFormat.format(value);
}

export function formatMs(value: number | null | undefined): string {
  if (value == null) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  return value == null ? "—" : `${value.toFixed(digits)}%`;
}

export function frequencyLabel(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? "Every day" : `Every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? "Every hour" : `Every ${minutes / 60} hours`;
  return `Every ${minutes} minutes`;
}

/** Display ID for issues, e.g. EM-42. */
export function issueRef(number: number): string {
  return `EM-${number}`;
}
