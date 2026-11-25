# Edstellar Monitor

Website health monitoring for Edstellar, currently pointed at the Vercel deployment **https://edstellar-two.vercel.app**: URL discovery, availability, broken links, SEO, redirects, APIs, SSL and performance, checked every four hours, with a full issue history.

All six build phases in `docs/IMPLEMENTATION_PLAN.md` are complete: authentication and roles, website configuration, sitemap and crawl-based discovery, availability, SEO audit, broken links, redirect audit, the issue lifecycle, API/SSL/DNS/performance monitoring, a run queue with scheduling and notifications (email, Slack), reports with CSV export, and the deployment runbook (`docs/DEPLOYMENT.md`).

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 16.4 (App Router, Turbopack), React 19.3, TypeScript 5.9 |
| UI | Tailwind CSS 4, shadcn/ui-style components on Radix primitives, Lucide icons, Recharts |
| Data | PostgreSQL + Prisma 7.10 (`prisma-client` generator, `@prisma/adapter-pg`) |
| Auth | Own implementation: bcrypt (cost 12), HS256 session cookie (jose), DB-checked sessions, roles |
| Tests | Vitest (unit), Playwright (browser checks during development) |

## Getting started

Requirements: Node.js 20.19+ (22 LTS recommended) and a PostgreSQL 14+ database.

```bash
npm install                      # also runs `prisma generate`
cp .env.example .env             # then fill in the values (see below)
npm run db:deploy                # applies prisma/migrations
npm run db:seed                  # creates the first admin and the Edstellar website
npm run dev                      # http://localhost:3000
npm run worker -- --website edstellar-two.vercel.app   # first scan
```

Sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, then remove `SEED_ADMIN_PASSWORD` from your environment. Change the password under **Settings → Account**.

> If `npm install` reports a peer-dependency conflict, use `npm install --legacy-peer-deps`.

## Environment variables

All variables are documented in `.env.example`. Phase 1 needs:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Runtime connection string (pooled is fine) |
| `DIRECT_URL` | no | Direct connection for migrations, if your provider pools `DATABASE_URL` |
| `AUTH_SECRET` | yes | Signs session cookies, ≥ 32 chars. `openssl rand -base64 48` |
| `SESSION_TTL_HOURS` | no | Session lifetime, default 12 |
| `APP_URL` | no | Public URL of the dashboard |
| `ENCRYPTION_KEY` | from phase 4 | 32 bytes base64 for AES-256-GCM of stored API credentials / webhooks. `openssl rand -base64 32` |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_NAME`, `SEED_ADMIN_PASSWORD` | for seeding | First administrator |

`ENCRYPTION_KEY` is required to save API credentials and Slack webhooks. `CRON_SECRET` enables the cron endpoint. `SMTP_*` and `NOTIFY_FROM_EMAIL` enable email notifications. `PAGESPEED_API_KEY` (optional) enables PageSpeed Insights. `RETENTION_DAYS` sets how long run detail is kept. `docs/DEPLOYMENT.md` lists which part needs which variable.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` | TypeScript type check |
| `npm test` | Unit, crawler, check and database tests (130 tests). Database tests use `TEST_DATABASE_URL` (a separate, migrated database) and are skipped without it; in CI they use the workflow's disposable database. TLS tests need `openssl`. |
| `npm run worker -- …` | Monitoring worker: `--website <domain>`, `--due`, `--queue` or `--loop` (see below) |
| `npm run smoke` | Requests every screen and export of a running server (`SMOKE_URL`) as the first administrator |
| `npm run loadtest [-- <pages>]` | Full monitoring run against a local synthetic site (default 10,000 pages) through the real engine and database |
| `npm run db:migrate` | Create a new migration after editing the schema (development) |
| `npm run db:deploy` | Apply committed migrations (CI / production) |
| `npm run db:seed` | Idempotent seed |
| `npm run db:studio` | Prisma Studio |

## Running a scan

The dashboard never crawls; the worker does, as a separate plain Node.js process that shares the database:

```bash
npm run worker -- --website edstellar-two.vercel.app                    # full scan
npm run worker -- --website edstellar-two.vercel.app --scan incremental # re-check known URLs only
npm run worker -- --website edstellar-two.vercel.app --max-urls 50      # quick trial
npm run worker -- --help
```

A **full** scan reads robots.txt and every sitemap, then crawls breadth-first from the home page, the sitemap URLs and any manually added URLs, following links up to the configured depth and maximum URL count. An **incremental** scan reads the sitemaps and re-checks every known URL without following links. Each URL gets a status code, an availability class (up, redirect, client error, server error, timeout, DNS, SSL, connection error, blocked) and a response time; results appear under **Pages** and **Sitemap**.

Every in-scope HTML page is then audited (title, description, headings, canonical, robots meta and X-Robots-Tag, JSON-LD, Open Graph, Twitter card), links are aggregated into broken-link findings, redirects are recorded with their full chain, and all findings are reconciled into **Issues**: each issue has a stable fingerprint, is re-detected rather than duplicated, is resolved automatically when a run no longer finds it, and reopens (counted as a recurrence) if it returns. Editors change an issue's status on its page; every change is kept in its history.

Each run then checks the TLS certificate (trust, hostname, expiry against the website's warning days) and DNS, measures DNS/connect/TLS/TTFB/total time and HTML size for the home page and the 19 shallowest pages (median of 3 requests), runs PageSpeed Insights on 5 pages when enabled and `PAGESPEED_API_KEY` is set, and calls every active API endpoint configured under **API monitoring**. Their results feed the same issue lifecycle.

Conditions that affect the whole site are reported once instead of per page: robots.txt blocking the home page, and an X-Robots-Tag header on (almost) every page, which is what the Vercel deployment sends.

Only one run per website can be active (a lease in `MonitoringLock`, renewed every 30 s; a crashed run's lease expires after 5 minutes and the website is retried once). Ctrl+C stops after the requests in flight and records the run as cancelled.

### Scheduling, queue and notifications

"Run now" (editors) and `POST /api/cron/monitor` (`Authorization: Bearer $CRON_SECRET`) only **queue** runs; a worker runs them:

```bash
npm run worker -- --loop    # always-on: every minute, queue due websites and run the queue
npm run worker -- --due     # once: queue due websites, run the queue, exit (cron / GitHub Actions)
npm run worker -- --queue   # once: run what is already queued, exit
```

A website is due when its last run started `crawlFrequencyMinutes` ago (4 hours by default). The first run of a day is a full scan; the others are incremental. After each run the worker sends **one digest per recipient** (email via SMTP, or a Slack incoming webhook) for the events they chose: website down, new critical issues, new 404s and broken links, API failures, SSL problems, performance degradation, critical issues resolved. Only changes notify (new, back, escalated, resolved), so an issue that stays open never repeats. Recipients are managed per website under **Websites → (website) → Notifications**, with a test button. Old crawl, SEO, performance and API detail is purged after `RETENTION_DAYS` (30). Every run, with its stages, log and notifications, is listed under **Monitoring history**.

**Reports** gives daily, weekly and monthly health summaries and SEO, broken-link, API and performance reports, printable, with streamed CSV exports of issues, pages, the SEO audit, broken links (one row per linking page), API checks, performance and runs.

See `docs/DEPLOYMENT.md` for hosting the dashboard, the worker and the database.

**Staging deployments.** `edstellar-two.vercel.app` blocks every crawler in robots.txt and its sitemap lists `www.edstellar.com` URLs. Its configuration therefore has *Respect robots.txt* turned off and `www.edstellar.com` / `edstellar.com` as **host aliases**, so sitemap and link URLs on those hosts are checked as the same paths on the deployment. Both settings are under **Websites → (website) → Crawl scope**.

## Design

The dashboard uses the Edstellar brand taken from edstellar.com: navy `#0a1628` on warm paper `#f5f3eb`/`#fffef8`, electric lime `#c8f135` as the accent (active navigation, highlights, primary colour in the dark theme), Sora for headings and DM Sans for text. Colours are tokens in `src/app/globals.css`; text and controls meet WCAG AA contrast in both themes.

## Roles

| Role | Can |
|---|---|
| Administrator | Add, edit, pause and delete websites and API endpoints; change monitoring settings and notification recipients; manage users; read the activity log |
| Editor | Everything a viewer can, plus "Run now", changing issue status, adding URLs manually under Pages and "Check now" on API endpoints |
| Viewer | Read dashboards and settings |

## Documentation

- `docs/ARCHITECTURE.md` — architecture, folder structure, data model, security
- `docs/IMPLEMENTATION_PLAN.md` — the six phases and the free-tier hosting plan
- `docs/PHASE1_VERIFICATION.md` — what was tested for phase 1 and how
- `docs/PHASE2_VERIFICATION.md` — what was tested for phase 2 and how
- `docs/PHASE3_VERIFICATION.md` — what was tested for phase 3 and how
- `docs/PHASE4_VERIFICATION.md` — what was tested for phase 4 and how
- `docs/PHASE5_6_VERIFICATION.md` — what was tested for phases 5 and 6 and how
- `docs/DEPLOYMENT.md` — deployment runbook: dashboard, worker, database, secrets, operations
