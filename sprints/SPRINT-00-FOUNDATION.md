# Sprint 0 — Foundation

**Status:** complete
**Started:** 2026-05-17
**Completed:** 2026-05-17
**Days budget:** 3-5
**Days actual:** 1 (single Cowork session)
**Ship tag:** `sprint-0-shipped`

## Scope (from design doc §8)

New Next.js 15 repo, Tailwind + Even palette, Neon DB project, Vercel deploys, Resend magic-link auth, demo schema migration v1. Deployed empty app with doctor login.

## Deliverables — what shipped

| Milestone | Commit | Deliverable |
|---|---|---|
| M0.1 | `986fe7e` | Next.js 15 scaffold (TypeScript + Tailwind + App Router + `src/`). 29 files. |
| M0.1 fix | `c45e23c` | Bumped `next` 15.1.6 → 15.5.18 (CVE-2025-29927 middleware auth-bypass). |
| M0.2 | `7ae0d0a` | Even brand palette wired into Tailwind (blue/navy/pink/white + ink ramp). Vercel project linked, first deploy green, SSO/auth gate disabled (public demo URL). |
| M0.3 | `86952f8` | Neon DB `opd-encounter-app-db` (sin1, Launch plan, PG 17.8). `@vercel/postgres` pool. `/api/health` returns DB latency + version. 18 env vars on Vercel. |
| M0.4 | `a427f4a` | Resend magic-link auth (15-min token + 30-day session, both HS256 via `jose`). `/auth/login`, `/api/auth/{request,callback,logout}`, `/dashboard`, `src/middleware.ts`. ALLOWED_DOCTOR_EMAILS env allowlist. Email delivered to `vinay.bhardwaj@even.in` confirmed via Resend API. |
| M0.5 | `a5eb2a6` | Idempotent inline migration runner at `/api/run-migrations` (MIGRATION_SECRET-gated). v0 bootstraps `schema_migrations`; v1 applies the full demo schema. 9 tables live in Neon. `/api/health` now also reports `latest_migration` + `table_count`. |

## Production URLs

- **App root** — https://opd-encounter-app-vinaybhardwaj-commits-projects.vercel.app/
- **Sign-in** — https://opd-encounter-app-vinaybhardwaj-commits-projects.vercel.app/auth/login
- **Dashboard** (cookie required) — https://opd-encounter-app-vinaybhardwaj-commits-projects.vercel.app/dashboard
- **Health** — https://opd-encounter-app-vinaybhardwaj-commits-projects.vercel.app/api/health
- **Migration state** — https://opd-encounter-app-vinaybhardwaj-commits-projects.vercel.app/api/run-migrations (GET — public read)

## Resource IDs

| Resource | ID |
|---|---|
| GitHub repo | https://github.com/vinaybhardwaj-commits/OPD-Encounter-App |
| Vercel team | `team_yu1wWpsKdjsf90haai1ETJDG` (`vinaybhardwaj-commits-projects`, Hospital Product) |
| Vercel project | `prj_8NRiDM85l95w69RcC3UUZmjm0Kbx` (`opd-encounter-app`) |
| Neon DB | `calm-resonance-28753525` (`opd-encounter-app-db`, Singapore sin1, Launch plan) |
| Vercel store | `store_CKe9kaOJdBWZyA6J` |
| Resend domain (queued for DNS) | `notifications.even.in` — status `not_started` |

## Bugs found in sprint sweep

| # | Where | Fix |
|---|---|---|
| 1 | Vercel blocked first deploy citing CVE-2025-29927 | Bumped `next` 15.1.6 → 15.5.18 in M0.1 fix commit `c45e23c` |
| 2 | Vercel SSO gate (HTTP 401 on prod URLs) | `PATCH /v9/projects/{id}` with `ssoProtection: null` |
| 3 | Vercel deploy API ignored gitSource without `repoId` | Hard-coded numeric `repoId: 1241253956` |
| 4 | macOS virtiofs blocks `.git/index.lock` unlinks from the sandbox | `GIT_DIR=/tmp/opd-git` (sandbox-local), work-tree on virtiofs |
| 5 | `npm install` failed with EACCES on stale shared `/tmp/npm-cache` | Use unique cache dir per session (`/tmp/opd-npm-cache-$$`) |
| 6 | Vercel CDN cached `/api/health` after deploy | Cache-bust query param on smoke calls; revisit if it bites again |

## Carry-overs into Sprint 1

- DNS-verify `notifications.even.in` in Resend and flip `RESEND_FROM_EMAIL` from `onboarding@resend.dev` to `noreply@notifications.even.in` so pilot doctors (not just V) can receive magic links
- Move Vercel function region from `iad1` → `bom1`/`sin1` to colocate with Neon (~100ms savings per request)
- Replace `ALLOWED_DOCTOR_EMAILS` env-var allowlist with a `SELECT email FROM doctors WHERE …` query — depends on Sprint 1 seeding the first doctor row
- The pre-existing broken `Pulse/.git/` folder (left over from the failed sandbox-side `git init` attempt in M0.1) — virtiofs won't let Cowork delete it; you can `rm -rf .git` from your own Terminal whenever you want to work locally

## Retrospective

What worked: the EHRC-pattern inline migration runner ported cleanly; auto-deploy on push to main meant zero manual deploy triggers were needed after M0.2; the env-var allowlist let M0.4 ship without waiting for M0.5; the bash `GIT_DIR` trick let git work despite the virtiofs lockfile issue.

What didn't: macOS virtiofs filesystem permissions cost ~30 min of debugging on git lockfile unlinks; Vercel API path for creating a Neon DB programmatically required falling back to the dashboard UI via Chrome MCP (the standalone Neon API blocked it because the org is Vercel-managed).

Carry-overs feed Sprint 1 directly.
