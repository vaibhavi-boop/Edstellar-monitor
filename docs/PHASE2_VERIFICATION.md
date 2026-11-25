# Phase 2 verification

Run on Node.js 24, PostgreSQL 14 (local), Next.js 16.4.6, against the live Vercel deployment https://edstellar-two.vercel.app.

## Automated

| Check | Result |
|---|---|
| `tsc --noEmit` | passes |
| `vitest run` | 91 tests pass (28 new) |
| `next build` | passes |
| Migration `host_aliases` | created by `prisma migrate dev`, applied to the local database |

New tests:

- `tests/engine.test.ts` — URL normalisation; path globs, scope and host aliases; robots.txt (agent groups, longest match, `$`/`*`, Crawl-delay, a disallow-everything staging file); link and canonical extraction with `<base>`; sitemap urlset / index / text / gzip and index traversal with errors; status and error classification; expected responses; retry decisions, `Retry-After`, backoff; the guarded DNS lookup refusing mixed public/private answers.
- `tests/crawler.test.ts` — a crawl of a local HTTP server: de-duplication across fragments, trailing slashes and tracking parameters; sitemap source kept when also linked; PDF checked but not parsed; 301 → REDIRECT; redirect loop; 404; a 503 that succeeds on retry; a timeout; a robots-disallowed sitemap URL recorded as BLOCKED without a request; depth limit; maxUrls truncation; incremental mode re-checking only the seeds.

## Against the Vercel deployment

| Check | Result |
|---|---|
| robots.txt | read: 2 rules for `*` (`Disallow: /`); ignored because *Respect robots.txt* is off for this website |
| Sitemap | `/sitemap.xml`: 1 urlset, 2,535 URLs, all on `www.edstellar.com`, all mapped onto the deployment through host aliases |
| Trial run (`--max-urls 30`) | 30 URLs checked, all 200; run PARTIAL (limit reached), jobs and lease recorded, lease released |
| Full run (2,535 sitemap URLs + crawl) | in progress when this was committed; results to follow |
| Second worker while a run is active | refused: "Another run (#2) is already in progress", exit code 3 |
| Unknown website / bad `--scan` | clear error, exit code 2 |
| Pages, Pages with filters and sorting, Sitemap, Overview | render with real data (HTTP 200) on the dev server |

## Not verified

- The *Add URL* form and the new settings fields were not driven through a browser; the server-side validation behind them is covered by tests and the type check.
- Visual layout of the two new screens in light/dark and at 390 px was not checked in a browser.
