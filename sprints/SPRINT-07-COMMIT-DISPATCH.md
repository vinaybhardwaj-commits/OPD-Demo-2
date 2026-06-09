# Sprint 7 — Commit/submit + dispatch

**Status:** complete
**Started:** 2026-05-18
**Completed:** 2026-05-18
**Days budget:** 4-5
**Days actual:** 1 (continuous from Sprint 6)
**Ship tag:** `sprint-7-shipped`

## Scope (from design doc §8)

Confirmation modal, PDF generation with hospital letterhead, Twilio WhatsApp dispatch (sandbox mode), success state. Deliverable: real PDFs going out via WhatsApp (sandbox path).

## Deliverables — what shipped

| Milestone | Commit(s) | Deliverable |
|---|---|---|
| **M7.1** | `d11876d` + `573db92` | `pdf-lib` 1.17.1 dep (virtiofs workaround). `src/lib/pdf.ts` A4 prescription generator: Even Hospital letterhead, patient block (allergies pill), CC chips + free text, vitals one-liner, exam findings (wrapped), assessment with ICD-10 codes + labels, Rx lines with brand/generic/freq/duration/timing/instructions/Schedule X & high-risk warnings, disposition, doctor signature block, DEMO watermark at 18% opacity. Non-Latin-1 chars sanitised at input boundary. `src/lib/twilio.ts` wrapper with DEMO_MODE log path. `POST /api/encounters/[id]/dispatch` orchestrates PDF → Blob → Promise.all over patient+pharmacy sends → timestamp stamping. Idempotent. 409 if encounter not completed. `<SubmitConfirmModal>` per design doc §4.6 with preview phase + Confirm & send + success view. |
| **M7.2** | `553feba` | EncounterEditor's Submit button now opens the modal instead of going straight to `/complete`. Modal fetches live prescription state on open. Modal's confirm runs `/complete → /dispatch` chain. Success view auto-redirects to `/dashboard` after 2.5s. patient object (name/mrn/age/sex/phone) threaded through page → editor → modal. |

## Verified end-to-end (smoke)

1. Dispatch on completed encounter (DEMO_MODE) → 200, PDF in private Blob, both Twilio sends returned demo SIDs (`SM_DEMO_…_patient` / `SM_DEMO_…_pharmacy`)
2. Re-dispatch → 200 with `already_dispatched: true`, same URL returned (idempotent)
3. Dispatch on non-completed encounter → 409 `encounter_not_completed`
4. Prescription row has `pdf_blob_url + patient_sent_at + pharmacy_sent_at` all populated post-dispatch
5. Encounter page renders 200 for all states with the new modal mount

## Bugs found in sprint sweep

| # | Where | Fix |
|---|---|---|
| 1 | First PDF generation crashed with `WinAnsi cannot encode 0x26A0` (warning glyph) | Sanitiser `sanitiseInput()` strips/replaces non-Latin-1 chars (em dash → `-`, curly quotes → straight, `⚠` → empty, subscript digits → ASCII) at the boundary |
| 2 | virtiofs ENOTEMPTY on npm install for pdf-lib | Same M5.1 workaround: standalone install in /tmp/pdf-install, cp into Pulse/node_modules, `npm install --package-lock-only` for the lockfile. Pattern now established for any future dep that hits virtiofs |

## Carry-overs into Sprint 8 (Polish + demo prep)

1. **Live Twilio** — current path is DEMO_MODE only. Pre-pilot: provision Twilio credentials (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_WHATSAPP`), submit Meta WhatsApp templates (24–48hr approval), flip `DEMO_MODE=false`. `sendWhatsAppPdf` already has the production code path stubbed.
2. **Patient WhatsApp numbers** — Sprint 0 seeded fake `+91987654…` numbers. Real pilot needs the patient queue feed (Pulse integration) or manual capture at registration.
3. **Pharmacy WhatsApp number** — currently `process.env.EHRC_PHARMACY_WHATSAPP` falls back to `+919999999999`. Set the real number on Vercel env before pilot.
4. **PDF Unicode support** — `sanitiseInput()` is a stopgap. Bundling a Unicode font (Noto Sans, ~300KB) would let doctors keep curly quotes, em dashes, multi-script names.
5. **PDF retrieval** — PDF is stored private with no server-side proxy. Add `GET /api/prescriptions/[id]/pdf` that streams the blob to authenticated browsers so the doctor can re-view.
6. **Older carry-overs still open:** chunked offline-queue upload (S5 polish), recordings-retry admin tool, region migration `iad1` → `bom1`/`sin1`, DNS-verify `notifications.even.in` in Resend, remove `ALLOWED_DOCTOR_EMAILS` env var, restore `section_dictations.audio_blob_url` to NOT NULL.

## Retrospective

What worked: the existing `/complete` endpoint + new `/dispatch` endpoint composed cleanly — the modal calls them sequentially, and each is independently testable. Sanitising user text once at the PDF input boundary kept the rendering loop simple. pdf-lib produced a credible-looking demo prescription with just Helvetica + colored text + a diagonal watermark — no font bundling needed.

What didn't: the first PDF run crashed on seed data's em dashes. Should have anticipated — Sprint 2's seed copy already had them. Net cost ~3 min of debug + the sanitiser code (~25 lines).

Sprint 8 (polish + demo prep) is the last sprint before pilot.
