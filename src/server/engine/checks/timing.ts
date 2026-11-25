import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import type { Socket } from "node:net";
import zlib from "node:zlib";
import { classifyError, RequestTimeoutError, type FetchPolicy } from "../http";

/**
 * Timing breakdown of one HTTP request on a fresh connection:
 * DNS → TCP connect → TLS handshake → first byte → last byte.
 */
export interface Timing {
  dnsMs: number;
  connectMs: number;
  tlsMs: number | null;
  ttfbMs: number;
  totalMs: number;
  /** HTML size after decompression. */
  htmlBytes: number;
  status: number;
}

const MAX_BYTES = 10 * 1024 * 1024;

function timedLookup(inner: LookupFunction, onDone: () => void): LookupFunction {
  return ((hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
    (inner as unknown as (h: string, o: unknown, cb: (...args: unknown[]) => void) => void)(hostname, options, (...args: unknown[]) => {
      onDone();
      callback(...args);
    });
  }) as unknown as LookupFunction;
}

export function measureOnce(target: string, policy: Pick<FetchPolicy, "userAgent" | "timeoutMs" | "lookup" | "checkUrl">): Promise<Timing> {
  const url = new URL(target);
  policy.checkUrl(url);
  const client = url.protocol === "https:" ? https : http;

  return new Promise<Timing>((resolve, reject) => {
    const t0 = performance.now();
    let tDns: number | null = null;
    let tConnect: number | null = null;
    let tTls: number | null = null;
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
        agent: false,
        lookup: timedLookup(policy.lookup, () => (tDns ??= performance.now())),
        headers: { "user-agent": policy.userAgent, accept: "text/html,*/*;q=0.8", "accept-encoding": "gzip, deflate, br" },
      },
      (res) => {
        const tTtfb = performance.now();
        const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
        const decode = encoding === "gzip" ? zlib.createGunzip() : encoding === "br" ? zlib.createBrotliDecompress() : encoding === "deflate" ? zlib.createInflate() : null;
        const stream = decode ? res.pipe(decode) : res;
        let bytes = 0;
        stream.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_BYTES) {
            res.destroy();
            decode?.destroy();
            finish();
          }
        });
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const end = performance.now();
          const dns = (tDns ?? t0) - t0;
          const connected = tConnect ?? tDns ?? t0;
          resolve({
            dnsMs: Math.round(dns),
            connectMs: Math.round(connected - (tDns ?? t0)),
            tlsMs: tTls != null ? Math.round(tTls - connected) : null,
            ttfbMs: Math.round(tTtfb - t0),
            totalMs: Math.round(end - t0),
            htmlBytes: bytes,
            status: res.statusCode ?? 0,
          });
        };
        stream.on("end", finish);
        stream.on("error", fail);
      },
    );
    req.on("socket", (socket: Socket) => {
      socket.once("connect", () => (tConnect = performance.now()));
      socket.once("secureConnect", () => (tTls = performance.now()));
    });
    const timer = setTimeout(() => fail(new RequestTimeoutError(policy.timeoutMs)), policy.timeoutMs);
    req.on("error", fail);
    req.end();
  });
}

/** Median by total time; returns that sample so its breakdown stays consistent. */
export function medianTiming(samples: Timing[]): Timing | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a.totalMs - b.totalMs);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

export async function measure(
  target: string,
  policy: Pick<FetchPolicy, "userAgent" | "timeoutMs" | "lookup" | "checkUrl">,
  samples: number,
): Promise<{ timing: Timing | null; error: string | null }> {
  const ok: Timing[] = [];
  let error: string | null = null;
  for (let i = 0; i < samples; i++) {
    try {
      ok.push(await measureOnce(target, policy));
    } catch (e) {
      error = classifyError(e).message;
    }
  }
  return { timing: medianTiming(ok), error: ok.length ? null : error };
}
