export type SearchParams = Record<string, string | string[] | undefined>;

/** First value of a query parameter. */
export function param(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/** A query parameter restricted to the keys of `allowed`; anything else gives `fallback`. */
export function choice<T extends string>(value: string | null | undefined, allowed: Record<T, unknown>, fallback: T): T {
  return value != null && Object.prototype.hasOwnProperty.call(allowed, value) ? (value as T) : fallback;
}

/** A 1-based page number, clamped to 1…10,000. */
export function pageNumber(value: string | null | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 10_000) : 1;
}
