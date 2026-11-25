import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { z } from "zod";
import { API_CHECKS } from "@/lib/thresholds";
import { classifyError, RequestTimeoutError, type FetchPolicy } from "../http";

/**
 * One explicit API check: send the configured request, compare the status,
 * and (when fields are expected) parse JSON and check that each dotted path
 * exists. Redirects are not followed. Credentials are added as headers here and
 * never appear in results or error messages.
 */

export const apiAuthSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("NONE") }),
  z.object({ type: z.literal("BEARER"), token: z.string().min(1) }),
  z.object({ type: z.literal("BASIC"), username: z.string().min(1), password: z.string() }),
  z.object({ type: z.literal("API_KEY_HEADER"), header: z.string().min(1), value: z.string().min(1) }),
]);
export type ApiAuth = z.infer<typeof apiAuthSchema>;

export interface ApiRequestSpec {
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers: Record<string, string>;
  auth: ApiAuth;
  body: string | null;
  expectedStatus: number;
  expectedFields: string[];
  timeoutMs: number;
}

export interface ApiCheckOutcome {
  ok: boolean;
  statusCode: number | null;
  responseTimeMs: number | null;
  /** Issue type key when the check failed, e.g. "api.http_5xx". */
  errorType: string | null;
  errorMessage: string | null;
  missingFields: string[];
}

export function authHeaders(auth: ApiAuth): Record<string, string> {
  switch (auth.type) {
    case "BEARER":
      return { authorization: `Bearer ${auth.token}` };
    case "BASIC":
      return { authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}` };
    case "API_KEY_HEADER":
      return { [auth.header.toLowerCase()]: auth.value };
    default:
      return {};
  }
}

/** Does a dotted path ("data.items.0.id") exist in parsed JSON? null counts as present; undefined does not. */
export function hasPath(value: unknown, path: string): boolean {
  let current: unknown = value;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object") return false;
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(part)) return false;
      current = current[Number(part)];
    } else {
      if (!Object.prototype.hasOwnProperty.call(current, part)) return false;
      current = (current as Record<string, unknown>)[part];
    }
    if (current === undefined) return false;
  }
  return true;
}

/** Applies status and response-shape rules to a received response. */
export function evaluateApiResponse(spec: Pick<ApiRequestSpec, "expectedStatus" | "expectedFields">, status: number, body: string): Omit<ApiCheckOutcome, "responseTimeMs" | "statusCode"> {
  if (status !== spec.expectedStatus) {
    const errorType =
      status === 401 || status === 403 ? "api.auth_failure" : status >= 500 ? "api.http_5xx" : status >= 400 ? "api.http_4xx" : "api.unexpected_status";
    return { ok: false, errorType, errorMessage: `Expected HTTP ${spec.expectedStatus}, got ${status}`, missingFields: [] };
  }
  if (spec.expectedFields.length === 0) return { ok: true, errorType: null, errorMessage: null, missingFields: [] };
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, errorType: "api.invalid_json", errorMessage: "The response is not valid JSON", missingFields: [] };
  }
  const missing = spec.expectedFields.filter((f) => !hasPath(json, f));
  return missing.length
    ? { ok: false, errorType: "api.missing_fields", errorMessage: `Missing: ${missing.join(", ")}`, missingFields: missing }
    : { ok: true, errorType: null, errorMessage: null, missingFields: [] };
}

export function checkApi(spec: ApiRequestSpec, policy: Pick<FetchPolicy, "userAgent" | "lookup" | "checkUrl">): Promise<ApiCheckOutcome> {
  const failure = (error: unknown, responseTimeMs: number | null = null): ApiCheckOutcome => {
    const timeout = error instanceof RequestTimeoutError;
    return {
      ok: false,
      statusCode: null,
      responseTimeMs,
      errorType: timeout ? "api.timeout" : "api.unavailable",
      errorMessage: classifyError(error).message,
      missingFields: [],
    };
  };

  let url: URL;
  try {
    url = new URL(spec.url);
    policy.checkUrl(url);
  } catch (error) {
    return Promise.resolve(failure(error));
  }
  const client = url.protocol === "https:" ? https : http;
  const headers: Record<string, string> = {
    "user-agent": policy.userAgent,
    accept: "application/json, */*;q=0.5",
    "accept-encoding": "gzip, deflate, br",
    ...Object.fromEntries(Object.entries(spec.headers).map(([k, v]) => [k.toLowerCase(), v])),
    ...authHeaders(spec.auth),
  };
  if (spec.body != null && spec.method !== "GET") {
    headers["content-type"] ??= "application/json";
    headers["content-length"] = String(Buffer.byteLength(spec.body));
  }

  return new Promise<ApiCheckOutcome>((resolve) => {
    const started = performance.now();
    let settled = false;
    const settle = (outcome: ApiCheckOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      resolve(outcome);
    };
    const req = client.request(url, { method: spec.method, agent: false, lookup: policy.lookup, headers }, (res) => {
      const responseTimeMs = Math.round(performance.now() - started);
      const status = res.statusCode ?? 0;
      const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
      const decode = encoding === "gzip" ? zlib.createGunzip() : encoding === "br" ? zlib.createBrotliDecompress() : encoding === "deflate" ? zlib.createInflate() : null;
      const stream = decode ? res.pipe(decode) : res;
      const chunks: Buffer[] = [];
      let size = 0;
      const done = () => settle({ statusCode: status, responseTimeMs, ...evaluateApiResponse(spec, status, Buffer.concat(chunks).toString("utf8")) });
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > API_CHECKS.maxResponseBytes) {
          settle({ ok: false, statusCode: status, responseTimeMs, errorType: "api.invalid_json", errorMessage: "The response is larger than 2 MB", missingFields: [] });
          return;
        }
        chunks.push(chunk);
      });
      stream.on("end", done);
      stream.on("error", (error) => settle(failure(error, responseTimeMs)));
    });
    const timer = setTimeout(() => settle(failure(new RequestTimeoutError(spec.timeoutMs))), spec.timeoutMs);
    req.on("error", (error) => settle(failure(error)));
    if (spec.body != null && spec.method !== "GET") req.write(spec.body);
    req.end();
  });
}
