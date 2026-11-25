# Architecture

## Overview

```
                ┌──────────────────────────────┐
 Browser ──────▶│ Next.js app (Vercel)          │
                │  • proxy.ts: session check    │
                │  • Server Components / Actions│──────┐
                │  • /api/health                │      │
                └──────────────────────────────┘      ▼
                                                 ┌──────────┐
 External scheduler (every 4 h, phase 5) ──────▶ │PostgreSQL│
   calls worker or a secured endpoint            └──────────┘
                ┌──────────────────────────────┐      ▲
                │ Monitoring worker (phase 2+)  │──────┘
                │  plain Node.js, no Next deps  │──▶ https://edstellar-two.vercel.app (in-scope hosts only)
                └──────────────────────────────┘
```

The dashboard never crawls. Crawling runs in a separate worker process because a full crawl of thousands of URLs exceeds serverless time limits. The worker and the dashboard share the database and the pure TypeScript modules under `src/server/` and `src/lib/` (URL guard, issue catalogue, schemas), so the engine can move between hosts (GitHub Actions, Render, Fly.io, a VM) without being rewritten.

### Resumable, batch-based runs (designed now, built in phases 2 and 5)

A run (`MonitoringRun`) is split into stages (`MonitoringJob`, one per `JobStage`). Each job stores a `cursor`, `processed` and `total`, so the worker can stop after any batch and resume. `MonitoringLock` holds one lease per website: a run takes the lease, renews it via `heartbeatAt`, and a crashed run's expired lease can be taken over. This prevents overlapping runs without long-held database locks.

### Issue lifecycle (phase 3)

Every finding has a `fingerprint` = hash of issue type + affected resource, unique per website. Re-detection updates the existing `Issue` (`lastDetectedAt`, `occurrenceCount`) instead of inserting a new one. An issue missing from a completed run is auto-resolved; if it reappears it is reopened with `recurrenceCount + 1`. Every transition writes an `IssueOccurrence`, which is the audit trail shown on the issue page.

## Folder structure

```
edstellar-monitor/
├── prisma/
│   ├── schema.prisma            # all models for all phases
│   ├── migrations/              # committed SQL migrations
│   └── seed.ts                  # first admin + Edstellar website
├── prisma.config.ts             # Prisma 7 config (datasource URL, seed)
├── src/
│   ├── proxy.ts                 # Next 16 "proxy" (formerly middleware): optimistic auth gate
│   ├── app/
│   │   ├── (auth)/login/        # sign-in page + form
│   │   ├── (dashboard)/         # authenticated shell: sidebar, top bar
│   │   │   ├── page.tsx         # overview (health score, stats, trends)
│   │   │   ├── websites/        # list, new, [id] settings
│   │   │   ├── settings/        # account, team access, activity log
│   │   │   └── pages|issues|seo|…  # phase placeholders
│   │   └── api/health/          # uptime/DB probe
│   ├── components/
│   │   ├── ui/                  # button, input, card, table, dialog, form helpers…
│   │   ├── layout/              # sidebar, top bar, theme, LocalTime, empty states
│   │   ├── dashboard/           # health dial, stat tiles, charts
│   │   ├── websites/            # website forms
│   │   └── settings/            # account + user management
│   ├── lib/                     # db client, env, utils, issue catalogue, health score, navigation
│   ├── server/
│   │   ├── auth/                # passwords, tokens, sessions, roles, throttling, actions
│   │   ├── security/            # SSRF URL guard, AES-GCM secrets, keyed hashing
│   │   ├── websites/            # schemas, queries, server actions
│   │   ├── users/               # user management
│   │   ├── dashboard/           # overview queries
│   │   └── audit.ts             # audit log writer
│   └── generated/prisma/        # generated client (git-ignored)
├── tests/                       # Vitest unit tests
└── docs/
```

Phase 2 added `src/server/engine/` and `worker/index.ts`:

```
src/server/engine/
├── normalize.ts   # URL normalisation (dedupe key for DiscoveredUrl)
├── scope.ts       # include/exclude globs, host scope, host aliases
├── robots.ts      # RFC 9309 robots.txt parser
├── http.ts        # guarded HTTP client: vetted DNS, manual redirects, timeouts, retries, classification
├── links.ts       # <a>/<area> links and canonical from HTML (htmlparser2)
├── sitemaps.ts    # urlset / sitemap index / text / gzip, index tree
├── crawler.ts     # breadth-first crawl with a concurrency limit (no database access)
└── run.ts         # one monitoring run: lease, jobs, persistence
worker/index.ts    # CLI entry point: npm run worker -- --website <domain>
```

Engine modules do not import `server-only` or Next.js, so the worker runs under plain Node.js (via `tsx`). Planned: detectors and the issue reconciler (phases 3–4), `src/app/api/cron/` (secured trigger; phase 5).

## Data model

All tables exist from phase 1. Timestamps are `timestamptz` in UTC and are formatted in the viewer's time zone by `<LocalTime>`.

| Area | Models |
|---|---|
| Access | `User`, `LoginAttempt`, `AuditLog` |
| Websites | `Website`, `WebsiteConfiguration` |
| Discovery | `DiscoveredUrl` (unique per website + normalised URL), `Sitemap` (index tree) |
| Runs | `MonitoringRun` (sequential `number`), `MonitoringJob` (per stage, resumable), `MonitoringLock`, `CrawlRun`, `CrawlResult` |
| Findings | `Issue` (unique per website + fingerprint, display ID `EM-<number>`), `IssueOccurrence` |
| Checks | `SeoAuditResult`, `Redirect`, `ApiEndpoint`, `ApiCheckResult`, `PerformanceResult`, `SslCheck` |
| Alerts | `NotificationPreference`, `Notification` |

Indexes cover the dashboard's access paths (website + status / severity / category / date). Deleting a website cascades to its data; deleting a user keeps their history with the actor set to null.

## Security

- **Sessions.** HS256 JWT in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production). The proxy verifies only the signature; every page and action re-checks the user in the database, including `isActive` and `sessionVersion`. Incrementing `sessionVersion` (password change, role change, deactivation, "sign out everywhere") revokes all sessions immediately.
- **Passwords.** bcrypt cost 12; ≥ 12 characters with a letter and a number. Unknown emails still run a bcrypt comparison so timing does not reveal accounts. One error message for every failure.
- **Throttling.** Postgres-backed: 5 failures per email or 25 per IP hash in 15 minutes. Works across serverless instances.
- **Roles.** `requireRole` for pages (redirects to a 403 page) and `authorize` for server actions (throws). The UI hides controls, but the server is the enforcement point.
- **CSRF.** Mutations are Server Actions, which Next.js only accepts from the same origin; the session cookie is `SameSite=Lax`.
- **SSRF.** `src/server/security/url-guard.ts` allows only http(s) on ports 80/443, no credentials in URLs, no IP literals, no internal names (`localhost`, `*.internal`, single-label hosts…). DNS answers are resolved and refused if *any* address is private, loopback, link-local (incl. `169.254.169.254`), CGNAT, multicast, reserved, or an IPv4-mapped form of these. Crawl scope is the domain and its `www` variant only. The crawler re-runs `parsePublicUrl` on every redirect hop and resolves DNS through a guarded `lookup` that refuses the host if any address is private, so the socket connects only to a vetted address.
- **Secrets.** API credentials and Slack webhooks are stored as AES-256-GCM ciphertext (`ENCRYPTION_KEY`) and never sent to the browser. IP addresses are stored only as keyed hashes.
- **Headers.** CSP, `X-Frame-Options: DENY`, HSTS, `nosniff`, strict referrer policy.
- **Validation.** Zod schemas on every server action; Prisma parameterises all queries, including the tagged-template raw SQL used for charts.

## Health score

Defined in `src/lib/health-score.ts` and explained on the overview:

- Availability, 50 points: 50 × healthy URLs ÷ checked URLs.
- Open issues, 40 points: 40 − (10 per critical + 4 per high + 1 per medium + 0.25 per low), never below 0.
- SSL, 10 points: 10 if valid with > 30 days left, 5 if ≤ 30 days, 0 if invalid. Until SSL is checked, the other two parts are scaled to 100.
- No score until at least one URL has been checked.
