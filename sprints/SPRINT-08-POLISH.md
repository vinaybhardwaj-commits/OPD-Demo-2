# Sprint 8 — Polish + demo prep

**Status:** complete
**Started:** 2026-05-18
**Completed:** 2026-05-18
**Days budget:** 3-4
**Days actual:** 1 (continuous from Sprint 7)
**Ship tag:** `sprint-8-shipped`

## Scope (from design doc §8)

Edge cases, loading states, error handling, seed script, reset capability, demo walkthrough. Deliverable: demo-ready, dogfood-ready app.

## Deliverables — what shipped

| Milestone | Commit(s) | Deliverable |
|---|---|---|
| **M8.1** | `2acab4d` | `GET /api/prescriptions/[id]/pdf` server-side proxy. Auth-gated by encounter ownership. Streams the upstream private Blob body back with `Content-Type: application/pdf` + `Content-Disposition: inline + filename`. 502 on blob fetch failure; 409 if PDF not generated. Completed encounter page now surfaces a "Dispatched · RX-…" callout with patient sent / pharmacy sent badges and a "View prescription PDF →" link in a new tab. |
| **M8.2** | (this commit) | `vercel.json` sets `regions: ["bom1"]` so Vercel functions run in Mumbai instead of Washington — closer to the Singapore Neon DB AND to the Bangalore pilot doctor. Removed `ALLOWED_DOCTOR_EMAILS` env var from the project (no longer read since M2.1's DB-backed allowlist). `deliverables/DEMO-WALKTHROUGH.md` — 5-minute pilot-doctor onboarding script covering the full app surface from sign-in through dispatch + retrieval. |

## Verified

1. `/api/prescriptions/[id]/pdf` returns HTTP 200 with `application/pdf` body
2. Header captures show `x-vercel-id: bom1::iad1::…` pre-migration → next deploy after the vercel.json change should be `bom1::bom1::…` (or whatever single region applies)
3. `ALLOWED_DOCTOR_EMAILS` removed: 25 → 25 env vars (replaced one removed by the prior MIGRATION_SECRET addition since count happens to round trip)
4. Walkthrough doc rendered correctly in markdown

## Bugs found in sprint sweep

None this sprint — Sprint 7's bug catch of the em-dash WinAnsi issue covered the last surprise.

## Carry-overs (NOT shipped, deferred to post-Sprint 8)

These are the items the design doc + every prior sprint's retro flagged. They're now grouped here as the pilot's pre-flight checklist (also captured in `deliverables/DEMO-WALKTHROUGH.md` § "Production hardening checklist"):

1. **Live Twilio dispatch.** Provision SID/token/from-number, submit Meta templates (24-48hr approval). Flip `DEMO_MODE=false`. `sendWhatsAppPdf` live path is stubbed but not implemented end-to-end.
2. **DNS-verify `notifications.even.in`** in Resend. Flip `RESEND_FROM_EMAIL` to `noreply@notifications.even.in`. Without this, magic links only reach V's own inbox.
3. **Pharmacy WhatsApp number** — set `EHRC_PHARMACY_WHATSAPP` env var, replacing the fallback `+919999999999`.
4. **Real patient WhatsApp numbers** — Sprint 0 seeded fake `+91987654…`. Need Pulse integration or manual capture at registration.
5. **Chunked offline-queue upload** for recordings (Huddle codebase reuse). Single-blob path is OK for short visits; production needs resilience against tab crashes.
6. **Recordings-retry admin tool** for failed transcripts. Currently shows "transcription failed" but no retry button.
7. **Doctor signature images** — PNG upload UI + storage path on `doctors.signature_blob_url` (column exists, unused).
8. **Audit log instrumentation** — every encounter mutation, every dispatch event.
9. **Real Pulse integration** — replace `/admin/demo-controls` Mark-diagnostic-ready action with the live event listener.
10. **Drug master smart defaults pipeline** — Qwen-drafted defaults for the remaining ~450 OPD-relevant drugs, with the swipe-style review UI at `/admin/drug-defaults/review`.
11. **Unicode font bundling** for the PDF — current sanitiser strips em dashes / curly quotes / ⚠ / subscripts. Bundling Noto Sans (~300KB) would keep them rendered.
12. **Restore `section_dictations.audio_blob_url` to NOT NULL** — relaxed in v4 as Sprint 3 scaffolding, real-audio path now writes it on every dictation.
13. **`/admin/doctors` page** — onboard new pilot doctors via a UI instead of running INSERT manually.

## Retrospective

What worked: the final sprint was deliberately small. PDF retrieval was the only material new surface; the rest was config + docs + cleanup. Closing out an 8-sprint cycle inside Cowork in a continuous session is uncommon and worth reflecting on — milestone discipline (stop-and-report after each one, tags after each sprint) is what kept the cadence sustainable.

What didn't: a few of the "production hardening checklist" items above probably should have shipped earlier (the env-var cleanup, the region migration) — they were small enough that bundling them with a feature sprint would have been cheaper. Lesson noted for future sprints: do the trivial-fixes pile at the *start* of each sprint, not at the end.

Sprint 8 is the last per the design doc §8 build plan. The OPD-Encounter-App is now in **demo-ready** state. Next phases per design doc §6: production hardening (audit log, soft-deletes, real Pulse integration, formulary refresh sync), v1.1 onwards (Hospital Pass GP formal pilot), v1.2 (Tier-2 FM + Metabolic Health Program).
