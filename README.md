# Edstellar Monitor

Website health monitoring for **https://www.edstellar.com**: URL discovery, availability, broken links, SEO, redirects, APIs, SSL and performance, checked every four hours, with a full issue history.

This repository is being built in six phases (see `docs/IMPLEMENTATION_PLAN.md`). **Phase 1 is complete**: project setup, authentication and roles, the complete database schema with its migration, the dashboard shell, and website configuration. Screens for later phases are in the navigation but clearly marked with the phase that delivers them; they show no sample data.

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

`CRON_SECRET`, `PAGESPEED_API_KEY` and the `SMTP_*` values are placeholders for phases 4–5 and are not read yet.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` | TypeScript type check |
| `npm test` | Unit tests (63 tests) |
| `npm run db:migrate` | Create a new migration after editing the schema (development) |
| `npm run db:deploy` | Apply committed migrations (CI / production) |
| `npm run db:seed` | Idempotent seed |
| `npm run db:studio` | Prisma Studio |

## Roles

| Role | Can |
|---|---|
| Administrator | Add, edit, pause and delete websites; change monitoring settings; manage users; read the activity log |
| Editor | Everything a viewer can; issue status changes and manual runs arrive in phases 3 and 5 |
| Viewer | Read dashboards and settings |

## Documentation

- `docs/ARCHITECTURE.md` — architecture, folder structure, data model, security
- `docs/IMPLEMENTATION_PLAN.md` — the six phases and the free-tier hosting plan
- `docs/PHASE1_VERIFICATION.md` — what was tested for phase 1 and how
