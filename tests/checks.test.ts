import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo, LookupFunction } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authHeaders, checkApi, evaluateApiResponse, hasPath, type ApiRequestSpec } from "@/server/engine/checks/api";
import { parsePageSpeed } from "@/server/engine/checks/pagespeed";
import { daysBetween, dnsMoved, inspectCertificate, networkKey } from "@/server/engine/checks/ssl";
import { measureOnce, medianTiming, type Timing } from "@/server/engine/checks/timing";
import { createGuardedLookup } from "@/server/engine/http";

// Local servers on 127.0.0.1; the URL guard is swapped for a permissive one
// (it is covered by its own tests) and "localhost" is resolved to loopback.
const loopback: LookupFunction = createGuardedLookup(async () => [{ address: "127.0.0.1" }], () => false);
const policy = { userAgent: "EdstellarMonitor/1.0 test", lookup: loopback, checkUrl: () => {}, timeoutMs: 1000 };

describe("API response rules", () => {
  it("reads dotted paths, including array indexes", () => {
    const json = { data: { items: [{ id: 1, name: null }] }, ok: true };
    expect(hasPath(json, "data.items.0.id")).toBe(true);
    expect(hasPath(json, "data.items.0.name")).toBe(true);
    expect(hasPath(json, "data.items.1.id")).toBe(false);
    expect(hasPath(json, "data.missing")).toBe(false);
    expect(hasPath(json, "ok.deeper")).toBe(false);
    expect(hasPath(json, "toString")).toBe(false);
  });

  it("classifies status and shape problems", () => {
    const spec = { expectedStatus: 200, expectedFields: ["data.id"] };
    expect(evaluateApiResponse(spec, 401, "").errorType).toBe("api.auth_failure");
    expect(evaluateApiResponse(spec, 403, "").errorType).toBe("api.auth_failure");
    expect(evaluateApiResponse(spec, 404, "").errorType).toBe("api.http_4xx");
    expect(evaluateApiResponse(spec, 502, "").errorType).toBe("api.http_5xx");
    expect(evaluateApiResponse(spec, 204, "").errorType).toBe("api.unexpected_status");
    expect(evaluateApiResponse(spec, 200, "<html>").errorType).toBe("api.invalid_json");
    expect(evaluateApiResponse(spec, 200, '{"data":{}}')).toMatchObject({ errorType: "api.missing_fields", missingFields: ["data.id"] });
    expect(evaluateApiResponse(spec, 200, '{"data":{"id":7}}')).toMatchObject({ ok: true, errorType: null });
    expect(evaluateApiResponse({ expectedStatus: 200, expectedFields: [] }, 200, "not json").ok).toBe(true);
  });

  it("builds auth headers", () => {
    expect(authHeaders({ type: "BEARER", token: "t" })).toEqual({ authorization: "Bearer t" });
    expect(authHeaders({ type: "BASIC", username: "u", password: "p" })).toEqual({ authorization: `Basic ${Buffer.from("u:p").toString("base64")}` });
    expect(authHeaders({ type: "API_KEY_HEADER", header: "X-Api-Key", value: "k" })).toEqual({ "x-api-key": "k" });
    expect(authHeaders({ type: "NONE" })).toEqual({});
  });
});

describe("API checks and timing against a local server", () => {
  let server: http.Server;
  let base = "";
  const body = "<html>" + "x".repeat(5000) + "</html>";
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const auth = req.headers.authorization;
      if (req.url === "/api/ok") {
        res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
        return res.end(gzipSync(JSON.stringify({ data: { items: [{ id: 1 }] }, method: req.method })));
      }
      if (req.url === "/api/secure") {
        res.writeHead(auth === "Bearer good" ? 200 : 401, { "content-type": "application/json" });
        return res.end("{}");
      }
      if (req.url === "/api/echo" && req.method === "POST") {
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => {
          res.writeHead(201, { "content-type": "application/json" });
          res.end(JSON.stringify({ received: JSON.parse(data), type: req.headers["content-type"] }));
        });
        return;
      }
      if (req.url === "/api/slow") return void setTimeout(() => res.end("{}"), 1500);
      if (req.url === "/api/redirect") {
        res.writeHead(302, { location: "/api/ok" });
        return res.end();
      }
      if (req.url === "/page") {
        res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
        return res.end(gzipSync(body));
      }
      res.writeHead(500);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const spec = (overrides: Partial<ApiRequestSpec>): ApiRequestSpec => ({
    url: `${base}/api/ok`,
    method: "GET",
    headers: {},
    auth: { type: "NONE" },
    body: null,
    expectedStatus: 200,
    expectedFields: [],
    timeoutMs: 800,
    ...overrides,
  });

  it("passes a healthy endpoint and checks expected fields through gzip", async () => {
    const r = await checkApi(spec({ expectedFields: ["data.items.0.id"] }), policy);
    expect(r).toMatchObject({ ok: true, statusCode: 200, errorType: null });
    expect(r.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect((await checkApi(spec({ expectedFields: ["data.items.0.title"] }), policy)).missingFields).toEqual(["data.items.0.title"]);
  });

  it("sends credentials and request bodies", async () => {
    expect((await checkApi(spec({ url: `${base}/api/secure`, auth: { type: "BEARER", token: "good" } }), policy)).ok).toBe(true);
    expect((await checkApi(spec({ url: `${base}/api/secure`, auth: { type: "BEARER", token: "bad" } }), policy)).errorType).toBe("api.auth_failure");
    const posted = await checkApi(
      spec({ url: `${base}/api/echo`, method: "POST", body: '{"q":1}', expectedStatus: 201, expectedFields: ["received.q", "type"] }),
      policy,
    );
    expect(posted.ok).toBe(true);
  });

  it("reports timeouts, server errors and redirects (which are not followed)", async () => {
    expect((await checkApi(spec({ url: `${base}/api/slow` }), policy)).errorType).toBe("api.timeout");
    expect((await checkApi(spec({ url: `${base}/api/nope` }), policy)).errorType).toBe("api.http_5xx");
    expect(await checkApi(spec({ url: `${base}/api/redirect` }), policy)).toMatchObject({ statusCode: 302, errorType: "api.unexpected_status" });
    const closed = await checkApi(spec({ url: "http://127.0.0.1:1/x" }), policy);
    expect(closed.errorType).toBe("api.unavailable");
  });

  it("measures a timing breakdown and the decompressed HTML size", async () => {
    const t = await measureOnce(`${base}/page`, policy);
    expect(t.status).toBe(200);
    expect(t.htmlBytes).toBe(Buffer.byteLength(body));
    expect(t.tlsMs).toBeNull();
    expect(t.ttfbMs).toBeLessThanOrEqual(t.totalMs);
    for (const v of [t.dnsMs, t.connectMs, t.ttfbMs, t.totalMs]) expect(v).toBeGreaterThanOrEqual(0);
  });

  it("takes the median sample by total time", () => {
    const s = (totalMs: number) => ({ totalMs }) as Timing;
    expect(medianTiming([s(900), s(100), s(300)])?.totalMs).toBe(300);
    expect(medianTiming([s(200), s(100)])?.totalMs).toBe(100);
    expect(medianTiming([])).toBeNull();
  });
});

let openssl = true;
try {
  execFileSync("openssl", ["version"], { stdio: "ignore" });
} catch {
  openssl = false;
}

describe.skipIf(!openssl)("TLS certificate inspection", () => {
  let server: https.Server;
  let port = 0;
  let dir = "";
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "em-tls-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-days", "30", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"], { stdio: "ignore" });
    server = https.createServer({ key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) }, (_req, res) => res.end("ok"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads the certificate and flags an untrusted (self-signed) chain", async () => {
    const r = await inspectCertificate("localhost", loopback, 3000, new Date(), port);
    expect(r).toMatchObject({ reachable: true, valid: false, subject: "localhost", issuer: "localhost" });
    expect(r.daysRemaining).toBeGreaterThanOrEqual(28);
    expect(r.errorMessage).toMatch(/SELF_SIGNED|self.signed/i);
  });

  it("flags expiry and a hostname mismatch", async () => {
    const later = new Date(Date.now() + 40 * 86_400_000);
    const expired = await inspectCertificate("localhost", loopback, 3000, later, port);
    expect(expired.daysRemaining).toBeLessThan(0);
    expect(expired.errorMessage).toMatch(/Expired on/);
    const wrongHost = await inspectCertificate("other.test", loopback, 3000, new Date(), port);
    expect(wrongHost.errorMessage).toMatch(/other\.test|altnames|Hostname/i);
  });

  it("reports an unreachable HTTPS port", async () => {
    const r = await inspectCertificate("localhost", loopback, 1000, new Date(), 1);
    expect(r).toMatchObject({ reachable: false, valid: false });
  });

  it("counts whole days", () => {
    expect(daysBetween(new Date("2026-01-01T00:00:00Z"), new Date("2026-01-31T12:00:00Z"))).toBe(30);
  });
});

describe("DNS change detection", () => {
  it("ignores rotation within the same networks and reports a real move", () => {
    expect(networkKey("216.198.79.67")).toBe("216.198.79");
    expect(networkKey("2606:4700::6810:84e5")).toBe("2606:4700:0");
    // What Vercel did between two runs: new addresses, same /24s.
    expect(dnsMoved(["216.198.79.67", "64.29.17.67"], ["216.198.79.131", "64.29.17.131"])).toBe(false);
    expect(dnsMoved(["216.198.79.67"], ["216.198.79.67", "64.29.17.67"])).toBe(false);
    expect(dnsMoved(["216.198.79.67", "64.29.17.67"], ["104.21.4.10"])).toBe(true);
    expect(dnsMoved([], ["104.21.4.10"])).toBe(false);
  });
});

describe("PageSpeed Insights parsing", () => {
  it("extracts scores and Core Web Vitals", () => {
    const body = {
      lighthouseResult: {
        categories: { performance: { score: 0.42 }, accessibility: { score: 0.9 }, "best-practices": { score: 1 }, seo: { score: 0.61 } },
        audits: {
          "largest-contentful-paint": { numericValue: 4123.7 },
          "first-contentful-paint": { numericValue: 1800.2 },
          "cumulative-layout-shift": { numericValue: 0.12345 },
        },
      },
      loadingExperience: { metrics: { INTERACTION_TO_NEXT_PAINT: { percentile: 210 } } },
    };
    expect(parsePageSpeed(body)).toEqual({ performanceScore: 42, accessibilityScore: 90, bestPracticesScore: 100, seoScore: 61, lcpMs: 4124, fcpMs: 1800, cls: 0.123, inpMs: 210 });
    expect(parsePageSpeed({})).toMatchObject({ performanceScore: null, inpMs: null });
  });
});
