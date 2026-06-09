# Sprint 4 — Prescription compose

**Status:** complete
**Started:** 2026-05-18
**Completed:** 2026-05-18
**Days budget:** 5-6
**Days actual:** 1 (continuous from Sprint 3)
**Ship tag:** `sprint-4-shipped`

## Scope (from design doc §8)

Drug row component, multi-drug, LASA confirmation strip, schedule + risk indicators, defaults application, JSONB lines storage. Deliverable: multi-drug prescriptions composed in seconds.

## Deliverables — what shipped

| Milestone | Commit | Deliverable |
|---|---|---|
| **M4.1** | `0f1b4d9` | `src/lib/drug-defaults.ts` — 41 generics mapped to `{frequency, duration_days, timing, instructions}` for one-tap completion of the common case. `<DrugRow>` component: brand head with schedule chip + ⚠ high-risk badge + remove ×; 3 chip groups (frequency / duration / timing) with collapse-expand pattern; free-text instructions; italic at-rest summary line. `/dashboard/drugs` playground upgraded to demo full rows. |
| **M4.2** | `ac4636f` | `GET/PUT /api/encounters/[id]/prescription` upsert endpoint. Prescription number mirrors the encounter (ENC- → RX-). 409 on completed encounters. `<PrescriptionCompose>` replaces the placeholder in the encounter screen — "Add drug" button reveals inline typeahead that stays open across multi-picks. Auto-save (800ms debounced PUT). |
| **M4.3** | `00d2388` | Schedule X double-confirm: picking a Schedule X drug short-circuits the add and surfaces an alertdialog banner citing the Drugs & Cosmetics Rules. LASA confirmation strip below freshly-added rows that have `lasa_alternates`: "You picked X. Sound-alike: Y, Z." with "✓ Confirm pick" + "Remove & pick a different drug." Client-side state (not persisted). |

## End-to-end smoke (verified)

1. GET prescription before any PUT → 200, `prescription: null`
2. PUT 2-drug payload (CALPOL TDS 3d after meals + AMOXYCLAV BD 5d after meals) → 200, returns `RX-20260518-017`, both lines persisted
3. GET fetches both lines back with stable prescription_number
4. PUT empty lines clears the array, keeps the row
5. PUT against completed encounter → 409 `encounter_completed_immutable`
6. Invalid body → 400 `lines_must_be_array`
7. Encounter page renders end-to-end with all M4 components → HTTP 200
8. Schedule X drugs present in formulary (ANEKET / KETMIN Ketamine variants, both ⚠ high-risk with LASA=Propofol)
9. LASA-flagged drugs present in search results (COMBIFLAM → Ibuprofen) so the strip surfaces in the UI

## Smart-defaults coverage

41 generic substrings keyed in `src/lib/drug-defaults.ts`. Combination products (e.g. `Amoxicillin+Potassium Clavulanate`) inherit the lead-molecule's defaults via substring match. Categories: Analgesic/antipyretic 6, Antibiotics 10, GI 6, Antihistamine/cold-cough 5, Cardiovascular/chronic 6, Diabetes 2, Thyroid 1, Supplements 4, Asthma 2. Top GP OPD coverage; remaining ~450 OPD drugs land via the Qwen-drafted + V-reviewed pipeline (parallel track noted in design doc §4A, deferred to Sprint 4/5 polish window).

## Bugs found in sprint sweep

| # | Where | Fix |
|---|---|---|
| 1 | Initial draft tried to round-trip LASA alternates through the persisted line JSONB | Refactored to keep them in component-local Map (lasa_at_pick_time stays out of the DB) |

## Carry-overs into Sprint 5 (Recording infrastructure)

- M3.3's section dictation captures intent + duration only. Sprint 5 wires MediaRecorder + Vercel Blob upload + Deepgram transcription. Same `<DictateButton>` swaps the synthetic duration for real audio; existing `section_dictations` rows get `transcript_text` filled in async. Migration v? should restore `section_dictations.audio_blob_url` to NOT NULL after the path lands.
- The ambient encounter recording (different concern from section dictation — long-form, multi-snippet) is Sprint 5's core: chunk upload to Blob, Huddle-codebase reuse, "big red record button" in the encounter header.
- All older carry-overs still open: DNS-verify `notifications.even.in` in Resend; move Vercel function region `iad1` → `bom1`/`sin1`; remove now-unused `ALLOWED_DOCTOR_EMAILS` env var.

## Retrospective

What worked: the M4.1 → M4.2 progression let me ship a visually complete row (playground) before any persistence — useful because the chip-group collapse/expand behaviour got most of its iteration there, not against a real encounter. The same `<DrugTypeahead>` + `<DrugRow>` pair powers both the playground and the in-encounter compose. Smart defaults from substring matching covers combination products without a lookup table.

What didn't: had to redo the LASA round-trip approach — first pass tried to enrich the persisted line shape with `lasa_at_pick_time`, which would have leaked client-only state into the JSONB. Pure-client Map fixed it; lesson: persisted shapes deserve their own type, not a superset of the UI's shape.

Sprint 5 (recording infrastructure) is next.
