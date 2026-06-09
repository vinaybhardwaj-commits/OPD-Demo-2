# OPD Encounter App

Doctor-facing OPD encounter app for Even Hospital — recording, documentation, prescription, WhatsApp dispatch.

**Stack:** Next.js 15 · React 19 · TypeScript · Tailwind CSS · Neon Postgres · Vercel Blob · Twilio · Deepgram · Resend · Self-hosted Qwen

**Status:** Sprint 0 — Foundation. Pre-build scaffold.

## Repo layout

```
/                              Next.js 15 app (App Router, src/)
├── src/app/                   pages, layouts, route handlers
├── public/                    static assets
├── sprints/                   Sprint 0–8 progress trackers
├── deliverables/              Claude Code prompts, Meta templates, smart defaults drafts, pilot onboarding kits
├── reference/                 EHRC-Daily-Dash reuse map, design decisions log
├── status/                    weekly status, blockers, dependencies
├── COWORK-HANDOFF.md          operating manual for Cowork on this project
├── OPD-ENCOUNTER-APP-DESIGN.md   full design doc (888 lines)
├── opd-encounter-schema.sql        production schema (15 tables)
└── opd-encounter-schema-demo.sql   demo schema (8 tables) — used in Sprint 0
```

## Local dev

```bash
npm install
npm run dev
```

## Sprint plan

See `OPD-ENCOUNTER-APP-DESIGN.md` §8 for the 9-sprint build plan. Individual sprint trackers live in `sprints/`.

## Owner

Dr. Vinay Bhardwaj — Hospital PM, Even Hospital.
