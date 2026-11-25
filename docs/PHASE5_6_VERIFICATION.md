# Phases 5 and 6 verification

Run on Node.js 24, PostgreSQL 14, Next.js 16.4.6 (production build on port 3002), against https://edstellar-two.vercel.app.

## Automated

| Check | Result |
|---|---|
| `npm test` | 130 tests pass. Database tests now run against a separate `TEST_DATABASE_URL` (locally `edstellar_monitor_test`); without it they skip, so `npm test` never writes to the app's database. CI uses its disposable database. |
| `tests/notify-queue.test.ts` (10) | event mapping per transition; one digest per recipient with a per-group cap and HTML/Slack escaping; Slack webhook host check; CSV formula neutralisation; one queued run per website with upgrade to a full scan; due websites by frequency, full once a day and incremental in between, paused websites skipped; a crashed run detected by its expired lease, marked failed and retried once (not twice); no queued run handed out while its website is locked; dispatch filtered by subscribed events with disabled recipients skipped; delivery failures recorded, not thrown |
| `npm run smoke` against the production build | **48 checks pass**: health, login, security headers, anonymous redirect and export refusal, cron endpoint refusing missing/wrong tokens, 34 screens (every dashboard page, report and detail page) and 8 CSV exports |
| CI (`.github/workflows/ci.yml`) | adds the smoke test against `next start` and a 2,000-page load test |

## Load test (`npm run loadtest`)

Synthetic site served locally: 10,000 course pages (each ~4 KB of text, JSON-LD, Open Graph), 25 category pages, a sitemap, and a broken link on every 500th page. Real engine and database.

| Pages | URLs checked | Wall time | Rate | Peak RSS (worker + test server) | Broken-link issues |
|---|---|---|---|---|---|
| 2,000 | 2,030 | 7.7 s | 265 / s | 389 MB | 4 of 4 expected |
| 10,000 | 10,046 | 37.6 s | 267 / s | 549 MB | 20 of 20 expected |

The live site is slower per URL (network latency and ~500 KB pages), which is why a full scan of edstellar-two.vercel.app takes 6–24 minutes; the engine and database are not the bottleneck.

## Scheduling and queue against the live site

| Step | Result |
|---|---|
| `POST /api/cron/monitor` with the secret | `{"queued":[]}`: nothing due (last run 35 minutes earlier, 4-hour schedule) |
| `POST …?website=edstellar-two.vercel.app&scan=incremental` | HTTP 202, run #76 queued |
| The same request again with a full scan | HTTP 202, `created: false`: no duplicate; the waiting run was upgraded to a full scan |
| `npm run worker -- --queue` | claimed run #76 (trigger *scheduled*, full scan), COMPLETED in 7.6 min: 2,655 URLs; all 1,727 existing issues **re-detected** with 0 new, 0 reopened and 0 resolved (no duplicates, nothing wrongly cleared); DNS rotated again to `…79.3`/`…17.3` within the same networks and raised no change issue; 40-line run log stored for the history page |

## Not verified

- **Email and Slack delivery to real servers**: no SMTP server or Slack webhook is configured here. Delivery code is exercised with fake senders in tests; the digest content is unit-tested.
- "Run now", notification settings and the report print layout were not clicked through in a browser; the screens render (smoke test) and the server actions share tested code paths (`enqueueRun`, `dispatchNotifications`).
- The GitHub Actions monitor workflow has not run: it needs a database reachable from GitHub and is off until `MONITOR_ENABLED=true` is set.
