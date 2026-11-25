# Phase 3 verification

Run on Node.js 24, PostgreSQL 14, Next.js 16.4.6, against https://edstellar-two.vercel.app.

## Automated

| Check | Result |
|---|---|
| `tests/detect.test.ts` (10) | HTML analysis (title, entities, SVG titles ignored, robots meta, multiple canonicals, headings, JSON-LD with `@graph` and required properties); each detector group; duplicates grouped into one issue; availability and redirect classes; broken and redirected links with sources; a site-wide X-Robots-Tag and robots.txt block reported once; a single page's header reported per page; sitemap, robots and site-down findings |
| `tests/reconcile.test.ts` (5, database) | create with a DETECTED history row; re-detection updates counters without history; auto-resolve only for checked pages / complete runs / evaluated types; reopen with `recurrenceCount + 1` and a RECURRED row; ignored types untouched; issues a person ignored stay ignored |
| `next build`, `tsc` | pass |

## Against the Vercel deployment (run #14, full scan)

| Check | Result |
|---|---|
| Pages audited | 2,654 (every page that answered 200 with HTML) |
| Findings | 1,727 issues: 1,527 titles over 60 characters, 119 pages with meta noindex, 40 with nofollow, 22 short titles, 14 empty headings, 1 internal link to a redirect, 1 HTML page over 1 MB, robots.txt without a Sitemap line, and the two staging-wide conditions (X-Robots-Tag `noindex, nofollow` on every page; robots.txt `Disallow: /`) reported **once each** instead of ~2,500 times |
| Structured data, canonicals, Open Graph, Twitter cards | no issues: every page has them |
| Redirect inventory | 1 redirect recorded with its chain |
| Issue page | evidence (linking page, final URL), suggested fix, history row "Detected · Run #14" — checked in a screenshot |

## Problems found and fixed during verification

- **Out of memory.** The first full scan with Phase 3 died at about 1,450 pages with a 2 GB heap. Strings kept from each page (title, og:image, …) were V8 *sliced strings* that kept the whole ~500 KB page alive. They are now copied (`detach` in `html.ts`): retained memory went from 1,029 KB to 16 KB per page, and the next full run peaked at 541 MB RSS.
- **Filters on three screens** (Redirect audit, SEO audit, Broken links) and the redirect CSV export crashed when no filter was given; a shared `choice()` helper now reads query parameters, and inherited names such as `?status=constructor` are rejected.
- **A crashed run** (#13) held the lease; the next run (#14) waited for it to expire, took it over and marked #13 failed, as designed.

## Not verified

- Status changes on the issue page were not submitted through a browser; the server action is covered by the type check and the audit/occurrence code paths shared with the reconciler.
