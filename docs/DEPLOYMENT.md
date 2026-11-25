# Deployment runbook

Edstellar Monitor has three parts. They share one PostgreSQL database and can live on different hosts.

| Part | What it does | Where it can run |
|---|---|---|
| **Dashboard** (Next.js) | Screens, sign-in, settings, "Run now", the cron endpoint, CSV exports | Vercel, Render, Fly.io, any Node 20+ host |
| **Worker** (`npm run worker`) | Crawls, checks, finds issues, sends notifications | Any Node 20+ host that can run for 10–30 minutes at a time: GitHub Actions, Render background worker, Fly.io machine, a VM |
| **Database** (PostgreSQL 14+) | Everything | Neon, Supabase, RDS, any managed Postgres |

The dashboard never crawls. Serverless functions time out long before a 2,500-page crawl finishes, so crawling is always done by the worker.

## 1. Database

1. Create a PostgreSQL 14+ database (e.g. Neon: one project, one database).
2. Note two connection strings: the **pooled** one for the app (`DATABASE_URL`) and the **direct** one for migrations (`DIRECT_URL`). With a single string, leave `DIRECT_URL` unset (do not set it to an empty string).
3. From a machine with the code: `DATABASE_URL=… DIRECT_URL=… npx prisma migrate deploy`, then `npm run db:seed` with `SEED_ADMIN_*` set. Remove `SEED_ADMIN_PASSWORD` afterwards.

The app pins every database session to UTC, so the server's own time zone does not matter.

## 2. Secrets

Generate once and keep them in your password manager:

```bash
openssl rand -base64 48   # AUTH_SECRET     (signs sessions; changing it signs everyone out)
openssl rand -base64 32   # ENCRYPTION_KEY  (encrypts API credentials and Slack webhooks)
openssl rand -hex 24      # CRON_SECRET     (bearer token for /api/cron/monitor)
```

**`ENCRYPTION_KEY` must be identical on the dashboard and the worker** and must never change without re-entering credentials: anything encrypted with the old key can no longer be read (the API check then reports "credentials cannot be decrypted").

## 3. Environment variables

| Variable | Dashboard | Worker | Notes |
|---|---|---|---|
| `DATABASE_URL` | ✔ | ✔ | Pooled connection is fine |
| `DIRECT_URL` | migrations | migrations | Only if the provider pools `DATABASE_URL` |
| `AUTH_SECRET` | ✔ | | ≥ 32 characters |
| `APP_URL` | ✔ | ✔ | Public dashboard URL, used in notification links |
| `ENCRYPTION_KEY` | ✔ | ✔ | Same value on both |
| `CRON_SECRET` | ✔ | | ≥ 16 characters; only if you use the cron endpoint |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `NOTIFY_FROM_EMAIL` | test button | ✔ | Port 465 = TLS, 587 = STARTTLS (required) |
| `PAGESPEED_API_KEY` | | ✔ | Optional; enable PageSpeed per website in its settings |
| `RETENTION_DAYS` | | ✔ | Default 30, minimum 7 |
| `SESSION_TTL_HOURS` | ✔ | | Default 12 |

## 4. Dashboard on Vercel

1. **Import** the GitHub repository at vercel.com/new (framework Next.js; keep the default build command: Vercel runs the `vercel-build` script, which applies migrations with `prisma migrate deploy` and then builds). Install command: `npm ci --legacy-peer-deps`.
2. **Database:** in the project, *Storage → Create → Neon* (Vercel Marketplace). It sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (used for migrations) for every environment. Any other Postgres works too: set `DATABASE_URL`, and `DIRECT_URL` if it is pooled.
3. **Variables** (*Settings → Environment Variables*, Production): `AUTH_SECRET`, `ENCRYPTION_KEY`, `APP_URL` (the deployment URL, e.g. `https://edstellar-monitor.vercel.app`), `CRON_SECRET`, and the `SMTP_*` values for the notification test button.
4. **Deploy.** The first build creates the tables. Then seed the first administrator once, from your machine, against the same database: `DATABASE_URL="<Neon URL>" SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… npm run db:seed`.
5. Open `/api/health` (expects `{"status":"ok","database":"ok"}`) and sign in.

The deployment only serves the dashboard; the crawling worker runs elsewhere (section 5) against the same database. Vercel Hobby is for non-commercial use; a company monitor needs Vercel Pro or another host.

## 5. Worker: choose one

**A. Always-on worker (recommended).** On Render (background worker), Fly.io or a VM run:

```bash
npm ci --legacy-peer-deps && npx prisma migrate deploy && npm run worker -- --loop
```

It checks every minute for websites that are due and for runs queued with "Run now" or the cron endpoint, and purges old results every 6 hours. Runs start within a minute and the schedule is exact.

**B. GitHub Actions.** `.github/workflows/monitor.yml` runs `npm run worker -- --due` every four hours. Add the worker variables as repository **secrets**, then set the repository **variable** `MONITOR_ENABLED=true` to switch it on. Limits: scheduled workflows can start late, "Run now" waits for the next scheduled start, and Actions minutes are limited on private repositories (one full scan of edstellar-two.vercel.app takes 7–25 minutes depending on the site's speed). Use "Run workflow" with a domain for an immediate scan.

**C. External scheduler + worker.** A scheduler (cron-job.org, Upstash QStash) calls

```bash
curl -X POST https://monitor.example.com/api/cron/monitor -H "Authorization: Bearer $CRON_SECRET"
```

every 15 minutes. This only **queues** due runs; a worker started with `--queue` (e.g. a cron job on a VM) or `--loop` runs them.

Only one run per website can be active (a database lease); several workers are safe. A worker that dies mid-run is detected when its lease expires (5 minutes) and the website is retried once.

## 6. After deploying

- Sign in, open **Websites → (website)**, review the monitoring settings and add notification recipients; use **Send test** to confirm delivery.
- Use **Run now** on the overview; the run appears in **Monitoring history** with its stages and log.
- Check **Settings → Activity log** for the changes made.

## 7. Operations

| Task | How |
|---|---|
| Deploy a new version | Push to `main`; Vercel builds the dashboard. Restart or redeploy the worker. Run `npx prisma migrate deploy` first when a release adds a migration. |
| Roll back | Redeploy the previous version. Migrations only add columns, so the previous version keeps working. |
| Back up | Use the provider's point-in-time recovery (Neon, RDS) or a nightly `pg_dump`. Issues, runs and history are the record worth keeping; crawl detail is purged after `RETENTION_DAYS`. |
| Rotate `AUTH_SECRET` | Change it on the dashboard; everyone signs in again. |
| Rotate `CRON_SECRET` | Change it on the dashboard and in the scheduler at the same time. |
| Rotate `ENCRYPTION_KEY` | Change it on both, then re-enter every API credential and Slack webhook. |
| Pause monitoring | **Websites → (website) → Pause**. Queued runs are not started for paused websites. |
| A run seems stuck | **Monitoring history** shows it as running. If the worker died, the lease expires after 5 minutes and the next worker marks it failed and retries. |
| Database growing | Lower `RETENTION_DAYS`, or reduce *Maximum URLs* / check frequency. |

## 8. Verify a deployment

```bash
SMOKE_URL=https://monitor.example.com DATABASE_URL=… npm run smoke
```

requests every screen and export as the first administrator (read-only) and checks the security headers and the authentication boundaries.
