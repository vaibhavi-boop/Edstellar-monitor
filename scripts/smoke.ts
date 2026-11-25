/**
 * End-to-end smoke test over HTTP against a running server (CI starts
 * `next start` on a fresh, seeded database). Signs a short session for the
 * first administrator, then requests every screen and export.
 *
 *   SMOKE_URL=http://localhost:3002 npm run smoke
 *
 * Read-only: it never submits forms or queues runs.
 */
import "dotenv/config";
import pg from "pg";
import { signSession } from "../src/server/auth/token";

const BASE = (process.env.SMOKE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const failures: string[] = [];
let passed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failures.push(`${name}${detail ? `: ${detail}` : ""}`);
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, options: "-c TimeZone=UTC" });
  await client.connect();
  const one = async <T>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows[0] as T | undefined;
  const admin = await one<{ id: string; role: "ADMIN"; sessionVersion: number }>(`select id, role, "sessionVersion" from "User" where role = 'ADMIN' and "isActive" order by "createdAt" limit 1`);
  if (!admin) throw new Error("No active administrator; run npm run db:seed first.");
  const website = await one<{ id: string }>(`select id from "Website" order by "createdAt" limit 1`);
  const issue = await one<{ number: number }>(`select number from "Issue" order by number limit 1`);
  const run = await one<{ number: number }>(`select number from "MonitoringRun" order by number desc limit 1`);
  const endpoint = await one<{ id: string }>(`select id from "ApiEndpoint" limit 1`);
  await client.end();

  const cookie = `em_session=${await signSession({ sub: admin.id, role: admin.role, sv: admin.sessionVersion }, 1)}`;
  const get = (path: string, auth = true) => fetch(`${BASE}${path}`, { headers: auth ? { cookie } : {}, redirect: "manual" });

  console.log(`Smoke test against ${BASE}`);

  // Public and protected boundaries
  const health = await get("/api/health", false);
  check("GET /api/health", health.status === 200 && (await health.json()).database === "ok");
  const login = await get("/login", false);
  check("GET /login", login.status === 200);
  for (const header of ["content-security-policy", "x-frame-options", "x-content-type-options", "referrer-policy"]) {
    check(`security header ${header}`, login.headers.has(header));
  }
  const anon = await get("/issues", false);
  check("anonymous page redirects to /login", anon.status === 307 && (anon.headers.get("location") ?? "").includes("/login"));
  const anonApi = await get("/reports/export/issues", false);
  check("anonymous export is refused", anonApi.status === 307 || anonApi.status === 401);
  const cron = await fetch(`${BASE}/api/cron/monitor`, { method: "POST" });
  check("cron endpoint without a token is refused", cron.status === 401 || cron.status === 503, `HTTP ${cron.status}`);
  const cronBad = await fetch(`${BASE}/api/cron/monitor`, { method: "POST", headers: { authorization: "Bearer wrong-token-wrong-token" } });
  check("cron endpoint with a wrong token is refused", cronBad.status === 401 || cronBad.status === 503, `HTTP ${cronBad.status}`);

  // Every screen, signed in
  const pages = [
    "/", "/websites", "/websites/new", "/pages", "/pages?status=failing&sort=time&dir=desc", "/issues", "/issues?status=all&sort=last", "/seo", "/seo?problem=no_h1",
    "/broken-links", "/broken-links?view=source", "/redirects", "/redirects?filter=chain", "/api-monitoring", "/api-monitoring/new", "/performance", "/ssl",
    "/sitemap", "/history", "/reports", "/reports?report=seo", "/reports?report=broken-links", "/reports?report=api&period=month", "/reports?report=performance&period=day",
    "/settings", "/settings/users", "/settings/activity",
    ...(website ? [`/websites/${website.id}`] : []),
    ...(issue ? [`/issues/${issue.number}`] : []),
    ...(run ? [`/history/${run.number}`] : []),
    ...(endpoint ? [`/api-monitoring/${endpoint.id}`] : []),
  ];
  for (const path of pages) {
    const res = await get(path);
    const body = await res.text();
    const broken = /Application error|Internal Server Error|This page could not be found/.exec(body);
    check(`GET ${path}`, res.status === 200 && !broken, broken ? broken[0] : `HTTP ${res.status}`);
  }

  // Exports
  for (const path of ["/redirects/export", "/reports/export/issues", "/reports/export/pages", "/reports/export/seo", "/reports/export/broken-links", "/reports/export/api?period=month", "/reports/export/performance", "/reports/export/runs?period=month"]) {
    const res = await get(path);
    const text = await res.text();
    check(`CSV ${path}`, res.status === 200 && (res.headers.get("content-type") ?? "").startsWith("text/csv") && text.split("\r\n")[0]!.includes(","), `HTTP ${res.status}`);
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log(failures.map((f) => `  - ${f}`).join("\n"));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
