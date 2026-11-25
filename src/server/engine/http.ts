import { lookup as dnsLookup } from "node:dns/promises";
import http, { type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import zlib from "node:zlib";
import type { Availability } from "@/generated/prisma/enums";
import { isBlockedIp, parsePublicUrl, UrlGuardError } from "@/server/security/url-guard";

/**
 * Guarded HTTP client for the crawler.
 *
 * - Every connection resolves DNS through `createGuardedLookup`, which refuses
 *   the hostname if any address is private. The socket connects to the vetted
 *   address, so a second DNS answer cannot swap in an internal IP.
 * - Redirects are followed manually; each hop is re-validated (`checkUrl`).
 * - A single deadline covers connect, headers and body.
 */

export class RequestTimeoutError extends Error {
  readonly code = "ETIMEDOUT";
  constructor(ms: number) {
    super(`No complete response within ${Math.round(ms / 1000)} s`);
    this.name = "RequestTimeoutError";
  }
}

export type Resolve = (hostname: string) => Promise<Array<{ address: string }>>;

const defaultResolve: Resolve = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

export function createGuardedLookup(resolve: Resolve = defaultResolve, isBlocked: (ip: string) => boolean = isBlockedIp): LookupFunction {
  const fn = (hostname: string, options: { all?: boolean } | number | undefined, callback: (...args: unknown[]) => void) => {
    const all = typeof options === "object" && options?.all === true;
    resolve(hostname)
      .then((records) => {
        if (records.length === 0) throw Object.assign(new Error(`${hostname} has no address records`), { code: "ENOTFOUND" });
        if (records.some((r) => isBlocked(r.address))) {
          throw new UrlGuardError(`${hostname} resolves to a private address`);
        }
        if (all) callback(null, records.map((r) => ({ address: r.address, family: isIP(r.address) })));
        else callback(null, records[0]!.address, isIP(records[0]!.address));
      })
      .catch((error: unknown) => callback(error, all ? [] : "", 0));
  };
  return fn as unknown as LookupFunction;
}

export interface FetchPolicy {
  userAgent: string;
  timeoutMs: number;
  /** Bodies are cut off at this size (after decompression). */
  maxBodyBytes: number;
  maxRedirects: number;
  /** Throws UrlGuardError for URLs that must not be requested. Runs before every hop. */
  checkUrl: (url: URL) => void;
  lookup: LookupFunction;
}

export function defaultFetchPolicy(overrides: Partial<FetchPolicy> & Pick<FetchPolicy, "userAgent" | "timeoutMs">): FetchPolicy {
  return {
    maxBodyBytes: 5 * 1024 * 1024,
    maxRedirects: 10,
    checkUrl: (url) => void parsePublicUrl(url.href),
    lookup: createGuardedLookup(),
    ...overrides,
  };
}

export interface HopResponse {
  url: string;
  status: number;
  headers: IncomingHttpHeaders;
  /** Time until response headers arrived. */
  timeMs: number;
  body: Buffer | null;
  bodyTruncated: boolean;
}

export type WantBody = (url: URL, status: number, headers: IncomingHttpHeaders) => boolean;

function decoder(encoding: string | undefined) {
  switch ((encoding ?? "").trim().toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return zlib.createGunzip();
    case "deflate":
      return zlib.createInflate();
    case "br":
      return zlib.createBrotliDecompress();
    default:
      return null;
  }
}

function readBody(res: IncomingMessage, limit: number): Promise<{ body: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const decode = decoder(res.headers["content-encoding"]);
    const stream = decode ? res.pipe(decode) : res;
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (truncated: boolean) => {
      if (done) return;
      done = true;
      if (truncated) {
        res.destroy();
        decode?.destroy();
      }
      resolve({ body: Buffer.concat(chunks), truncated });
    };
    stream.on("data", (chunk: Buffer) => {
      if (done) return;
      const room = limit - size;
      if (chunk.length >= room) {
        chunks.push(chunk.subarray(0, room));
        size = limit;
        finish(true);
      } else {
        chunks.push(chunk);
        size += chunk.length;
      }
    });
    stream.on("end", () => finish(false));
    stream.on("error", (error) => {
      if (!done) {
        done = true;
        reject(error);
      }
    });
    res.on("error", (error) => {
      if (!done) {
        done = true;
        reject(error);
      }
    });
  });
}

/** One request, no redirect handling. Rejects on network, TLS, DNS, guard or timeout errors. */
export function requestOnce(url: URL, policy: FetchPolicy, wantBody: WantBody): Promise<HopResponse> {
  policy.checkUrl(url);
  const client = url.protocol === "https:" ? https : http;
  const started = performance.now();

  return new Promise<HopResponse>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      reject(error);
    };
    const req = client.request(
      url,
      {
        method: "GET",
        lookup: policy.lookup,
        agent: false,
        headers: {
          "user-agent": policy.userAgent,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-encoding": "gzip, deflate, br",
          "accept-language": "en",
        },
      },
      (res) => {
        const timeMs = Math.round(performance.now() - started);
        const status = res.statusCode ?? 0;
        if (!wantBody(url, status, res.headers)) {
          res.destroy();
          settled = true;
          clearTimeout(timer);
          resolve({ url: url.href, status, headers: res.headers, timeMs, body: null, bodyTruncated: false });
          return;
        }
        readBody(res, policy.maxBodyBytes).then(({ body, truncated }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ url: url.href, status, headers: res.headers, timeMs, body, bodyTruncated: truncated });
        }, fail);
      },
    );
    const timer = setTimeout(() => fail(new RequestTimeoutError(policy.timeoutMs)), policy.timeoutMs);
    req.on("error", fail);
    req.end();
  });
}

export interface RedirectHop {
  url: string;
  status: number;
  location: string;
}

export type FetchOutcome =
  | { ok: true; chain: RedirectHop[]; response: HopResponse; loop: false }
  | { ok: false; chain: RedirectHop[]; error: unknown; failedUrl: string; loop: boolean };

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Follows redirects manually, re-validating every hop. */
export async function fetchFollowing(input: string, policy: FetchPolicy, wantBody: WantBody): Promise<FetchOutcome> {
  const chain: RedirectHop[] = [];
  const seen = new Set<string>();
  let current: URL;
  try {
    current = new URL(input);
  } catch {
    return { ok: false, chain, error: new UrlGuardError("Not a valid URL"), failedUrl: input, loop: false };
  }

  for (;;) {
    if (seen.has(current.href)) {
      return { ok: false, chain, error: new Error(`Redirect loop back to ${current.href}`), failedUrl: current.href, loop: true };
    }
    seen.add(current.href);

    let response: HopResponse;
    try {
      response = await requestOnce(current, policy, (u, status, headers) =>
        REDIRECT_STATUSES.has(status) && headers.location ? false : wantBody(u, status, headers),
      );
    } catch (error) {
      return { ok: false, chain, error, failedUrl: current.href, loop: false };
    }

    const location = response.headers.location;
    if (!REDIRECT_STATUSES.has(response.status) || !location) return { ok: true, chain, response, loop: false };

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return { ok: true, chain, response, loop: false };
    }
    chain.push({ url: current.href, status: response.status, location: next.href });
    if (chain.length > policy.maxRedirects) {
      return { ok: false, chain, error: new Error(`More than ${policy.maxRedirects} redirects`), failedUrl: next.href, loop: true };
    }
    current = next;
  }
}

// ───────────────────────── Classification ─────────────────────────

const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_NODATA", "EAI_FAIL", "ENODATA", "ESERVFAIL", "EAI_NONAME"]);

export function errorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  return undefined;
}

/** Maps a thrown error to an availability class and a readable message. */
export function classifyError(error: unknown): { availability: Availability; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof UrlGuardError) return { availability: "BLOCKED", message: `Blocked by the URL guard: ${message}` };
  if (error instanceof RequestTimeoutError) return { availability: "TIMEOUT", message };
  const code = errorCode(error) ?? "";
  if (DNS_CODES.has(code)) return { availability: "DNS_ERROR", message: `DNS lookup failed (${code})` };
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return { availability: "TIMEOUT", message };
  if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/.test(code) || code === "EPROTO") {
    return { availability: "SSL_ERROR", message: `TLS error (${code}): ${message}` };
  }
  return { availability: "CONNECTION_ERROR", message: code ? `${code}: ${message}` : message };
}

export interface ExpectedResponse {
  pattern: RegExp;
  status: number;
}

export interface CheckResult {
  statusCode: number | null;
  availability: Availability;
  responseTimeMs: number | null;
  redirectUrl: string | null;
  finalUrl: string | null;
  contentType: string | null;
  contentLength: number | null;
  errorMessage: string | null;
}

/**
 * Availability of a URL from its fetch outcome. The status code shown is the
 * first response (e.g. 301); a redirect that ends in a working page is REDIRECT,
 * one that ends in an error takes the error's class. Expected responses (e.g.
 * 401 on /admin/**) count as UP.
 */
export function classifyOutcome(outcome: FetchOutcome, url: URL, expected: readonly ExpectedResponse[] = []): CheckResult {
  const first = outcome.chain[0];
  const redirectUrl = first?.location ?? null;
  const firstStatus = first?.status ?? (outcome.ok ? outcome.response.status : null);
  const isExpected = firstStatus != null && expected.some((e) => e.status === firstStatus && e.pattern.test(url.pathname));

  if (!outcome.ok) {
    const { availability, message } = outcome.loop
      ? { availability: "CLIENT_ERROR" as const, message: outcome.error instanceof Error ? outcome.error.message : "Redirect loop" }
      : classifyError(outcome.error);
    return {
      statusCode: firstStatus,
      availability: isExpected ? "UP" : availability,
      responseTimeMs: null,
      redirectUrl,
      finalUrl: outcome.failedUrl,
      contentType: null,
      contentLength: null,
      errorMessage: outcome.chain.length && !outcome.loop ? `After ${outcome.chain.length} redirect(s): ${message}` : message,
    };
  }

  const { response } = outcome;
  const status = response.status;
  const lengthHeader = Number(response.headers["content-length"]);
  let availability: Availability;
  let errorMessage: string | null = null;
  if (status >= 200 && status < 300) availability = outcome.chain.length ? "REDIRECT" : "UP";
  else if (status >= 400 && status < 500) availability = "CLIENT_ERROR";
  else {
    availability = "SERVER_ERROR";
    if (status >= 300 && status < 400) errorMessage = `HTTP ${status} without a usable Location header`;
  }
  if (isExpected) availability = "UP";
  if (outcome.chain.length && availability !== "REDIRECT" && availability !== "UP" && !errorMessage) {
    errorMessage = `Redirects to ${response.url}, which returns HTTP ${status}`;
  }

  return {
    statusCode: firstStatus,
    availability,
    responseTimeMs: response.timeMs,
    redirectUrl,
    finalUrl: response.url,
    contentType: (response.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase() || null,
    contentLength: Number.isFinite(lengthHeader) ? lengthHeader : response.body?.length ?? null,
    errorMessage,
  };
}

// ───────────────────────────── Retries ─────────────────────────────

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "EPIPE", "EAI_AGAIN", "ETIMEDOUT", "ESOCKETTIMEDOUT", "EHOSTUNREACH", "ENETUNREACH"]);
const MAX_RETRY_AFTER_MS = 60_000;

/** Retry-After as milliseconds (seconds or HTTP date), capped at 60 s. */
export function parseRetryAfter(value: string | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Math.min(Number(trimmed) * 1000, MAX_RETRY_AFTER_MS);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.min(Math.max(at - now, 0), MAX_RETRY_AFTER_MS);
}

/** Exponential backoff with full jitter: random in [base·2^n / 2, base·2^n], capped at 30 s. */
export function backoffMs(attempt: number, baseMs = 1000, random = Math.random): number {
  const ceiling = Math.min(baseMs * 2 ** attempt, 30_000);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

export function shouldRetry(outcome: FetchOutcome): boolean {
  if (outcome.ok) return RETRY_STATUSES.has(outcome.response.status);
  if (outcome.loop) return false;
  if (outcome.error instanceof RequestTimeoutError) return true;
  return RETRY_CODES.has(errorCode(outcome.error) ?? "");
}

const realSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

export async function fetchWithRetry(
  url: string,
  policy: FetchPolicy,
  wantBody: WantBody,
  options: { retries: number; signal?: AbortSignal; sleep?: typeof realSleep; baseDelayMs?: number },
): Promise<FetchOutcome & { attempts: number }> {
  const sleep = options.sleep ?? realSleep;
  let attempt = 0;
  for (;;) {
    const outcome = await fetchFollowing(url, policy, wantBody);
    if (attempt >= options.retries || !shouldRetry(outcome) || options.signal?.aborted) return { ...outcome, attempts: attempt + 1 };
    const retryAfter = outcome.ok ? parseRetryAfter(outcome.response.headers["retry-after"] as string | undefined) : null;
    await sleep(retryAfter ?? backoffMs(attempt, options.baseDelayMs), options.signal);
    attempt++;
  }
}
