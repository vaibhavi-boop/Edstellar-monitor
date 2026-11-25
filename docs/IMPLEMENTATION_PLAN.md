# Implementation plan

Each phase ends with: unit tests, a type check, a production build, browser checks of the new screens (desktop and mobile, light and dark), database persistence checks, and updated environment documentation. Nothing is marked complete until it has been run.

## Phase 1 — foundation ✅

Project setup; Prisma schema for every phase and the initial migration; authentication with roles, throttling and session revocation; dashboard shell (sidebar, top bar, website switcher, light/dark/system theme, responsive layout); website management and the full configuration form from spec section 22; user management; activity log; overview wired to real queries with empty states; health score; SSRF guard; secret encryption; health endpoint. See `PHASE1_VERIFICATION.md`.

## Phase 2 — discovery and availability ✅

Built as planned in `src/server/engine/` (normalise, scope, robots, http, links, sitemaps, crawler, run) and `worker/index.ts`. Additions: host aliases (`WebsiteConfiguration.hostAliases`, migration `host_aliases`) and an editable *Respect robots.txt* setting, both needed to monitor the Vercel staging deployment. A basic run lease is in place; resuming an interrupted run from its cursor stays in phase 5. See `PHASE2_VERIFICATION.md`.

- `src/server/engine/`: URL normaliser (lower-case host, strip fragment and default port, trailing-slash rule, drop query params not in `keptQueryParams`, sort the rest), scope check, include/exclude glob matcher, robots.txt parser (respecting the configured user agent).
- Sitemap reader: `robots.txt` declarations + `/sitemap.xml`, sitemap indexes, gzip, URL counts per file → `Sitemap`.
- Crawler: breadth-first by depth, `maxUrls`, concurrency limit, timeouts, retries with exponential backoff and jitter, honouring `Retry-After` on 429/503. Manual redirect following with the URL guard re-applied on every hop.
- Availability classification into `Availability` (UP, REDIRECT, CLIENT_ERROR, SERVER_ERROR, TIMEOUT, DNS_ERROR, SSL_ERROR, CONNECTION_ERROR, BLOCKED), with `expectedResponses` exceptions so expected 401/403/redirects are not errors.
- `worker/index.ts` + `npm run worker -- --website edstellar-two.vercel.app` for a manual full or incremental scan.
- Screens: Pages (inventory with search, filters, pagination, manual URL add), Sitemap.

## Phase 3 — findings ✅

Built in `src/server/engine/` (`html.ts` analysis, `detect.ts` detectors, `reconcile.ts` issue lifecycle, `findings.ts` run stages) and four screens. No schema change was needed. Choices worth knowing: broken links are one issue per broken URL with up to 20 linking pages; duplicates are one issue per shared value; site-wide robots.txt blocks and X-Robots-Tag headers are one issue for the site; re-detections update counters without adding history rows. See `PHASE3_VERIFICATION.md`.

- HTML parsing (a streaming parser such as `parse5`/`htmlparser2`), link extraction, broken-link aggregation by source page.
- SEO detectors for every type in `src/lib/issue-catalog.ts` (titles, descriptions, headings, canonicals, indexability, JSON-LD incl. Organization/Breadcrumb/Article/Course, Open Graph, Twitter).
- Redirect audit: chains, loops, broken and non-canonical destinations, HTTP→HTTPS.
- Issue reconciler: fingerprinting, de-duplication, auto-resolve, recurrence, `IssueOccurrence` trail, ignored types.
- Screens: Issues (table with filters, search, sorting, pagination; detail page with history and suggested fix; status changes for editors), SEO audit, Broken links, Redirect audit.

## Phase 4 — APIs, SSL, performance ✅

Built in `src/server/engine/checks/` (`ssl.ts`, `timing.ts`, `pagespeed.ts`, `api.ts`, `api-run.ts`, `run-checks.ts`) and three screens; thresholds in `src/lib/thresholds.ts`. HTTP timing uses Node's own socket events rather than `undici` diagnostics, on a fresh connection per request. DNS changes are reported only when the host moves to a different /24 (IPv4) or /48 (IPv6) network, because Vercel rotated every address between two runs an hour apart. No schema change. Also in this phase: the Edstellar visual identity, and pinning the database session time zone to UTC. See `PHASE4_VERIFICATION.md`.

- API endpoints CRUD (encrypted credentials), explicit checks only, response-shape and expected-field validation.
- TLS certificate inspection, expiry thresholds from `sslWarningDays`, DNS resolution and change detection.
- HTTP timing breakdown (DNS, connect, TLS, TTFB, total, HTML size) via `undici` diagnostics; optional PageSpeed Insights (LCP, FCP, CLS, INP, four Lighthouse scores) on a sample of key pages to stay within quota.
- Screens: API monitoring, Performance, SSL monitoring.

## Phase 5 — scheduling and notifications ✅

Built in `src/server/engine/queue.ts`, `src/server/notify/`, `src/app/api/cron/monitor`, the worker's `--due`/`--queue`/`--loop` modes and the Monitoring history screens. Deviation: an interrupted run is not resumed from its cursor; it is detected by its expired lease, marked failed and the website is retried once with a fresh run (URLs it had already checked keep their results). Notifications are one digest per recipient per run rather than one message per issue. See `PHASE5_6_VERIFICATION.md`.

- Lease-based locking via `MonitoringLock`, heartbeat, resume of interrupted jobs, run logs.
- Secured trigger `POST /api/cron/monitor` (`Authorization: Bearer $CRON_SECRET`, constant-time compare) that enqueues a run; a "Run now" button for editors.
- Notifications: email (SMTP) and Slack webhooks per website, per event; suppression of repeats for the same ongoing issue, re-notify on recurrence or severity change.
- Screen: Monitoring history with run detail.

## Phase 6 — reports and release ✅

Reports screen with streamed CSV exports, data retention (`RETENTION_DAYS`), a test database for the database tests, an HTTP smoke test and a 2,000-page load test in CI, a 10,000-page load test (`npm run loadtest`), the scheduled monitoring workflow and `docs/DEPLOYMENT.md`. The end-to-end tests are HTTP-level (every screen and export of a production build), not browser-driven. See `PHASE5_6_VERIFICATION.md`.

- Daily, weekly, monthly, SEO, broken-link, API and performance reports; CSV export (streamed).
- Integration tests against a disposable Postgres, end-to-end tests in CI, load test of a 10,000-URL crawl.
- Deployment runbook.

## Free-tier hosting plan (verify limits before relying on them)

| Need | Option | Notes to verify |
|---|---|---|
| Dashboard | Vercel Hobby for development | Hobby is for non-commercial use. A production monitor for a company site needs Vercel Pro or another host. |
| Database | Neon or Supabase free tier | Storage caps (a few hundred MB) — keep `CrawlResult` retention short (e.g. 30 days) and aggregate older data. |
| Worker + 4-hour schedule | GitHub Actions scheduled workflow (`cron: "0 */4 * * *"`) running the worker | Free minutes are limited for private repositories. A full 10,000-URL crawl at gentle concurrency can take 20+ minutes; 6 runs a day may exceed the allowance, so use incremental scans between nightly full scans, or a small always-on host (Render, Fly.io, Railway). Scheduled workflows can start late. |
| Alternative scheduler | cron-job.org or Upstash QStash calling `/api/cron/monitor` | Only enqueues; the worker does the crawling. |

The engine does not depend on any of these providers, so moving hosts means changing where `npm run worker` runs, not the code.
