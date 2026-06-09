# Sprint 3 — Encounter screen + documentation

**Status:** complete
**Started:** 2026-05-18
**Completed:** 2026-05-18
**Days budget:** 4-5
**Days actual:** 1 (continuous from Sprint 2)
**Ship tag:** `sprint-3-shipped`

## Scope (from design doc §8)

Encounter screen UI (CC chips, exam findings, assessment, vitals, ICD-10 search), section dictation infrastructure. Deliverable: doctor fills all documentation sections.

## Deliverables — what shipped

| Milestone | Commit | Deliverable |
|---|---|---|
| **M3.1** | `ed3164d` | `src/lib/cc-chips.ts` (24 curated GP/OPD chips in 3 buckets). `<CcChipGrid>` above the CC textarea — toggle to add/remove from `chief_complaint_chips[]`. Assessment section renders `assessment_codes[]` as removable blue chips. `PATCH /api/encounters/[id]` accepts both arrays. |
| **M3.2** | `8cd1de2` | `src/lib/icd10.ts` — 150 curated GP codes spanning 14 clinical buckets including India-relevant vector-borne (dengue, malaria, typhoid, TB). `searchIcd10()` in-memory ranked scan. `GET /api/icd10/search?q=...&limit=...` endpoint. `<Icd10Typeahead>` mirrors `<DrugTypeahead>` UX. Codes append to `assessment_codes[]`; chips show code + label. |
| **M3.3** | `f724ba6` | Migration v4 (relax `section_dictations.audio_blob_url` to nullable). `GET/POST /api/encounters/[id]/dictations`. `<DictateButton>` client component: idle / recording (pulsing pink + ticker) / saving / saved / error states. Mounted on CC / Exam / Assessment section headers. Sprint 5 will swap synthetic duration for real MediaRecorder + Vercel Blob + Deepgram. |

## Production URLs (auth required)

- **Encounter (with all M3 features):** `/dashboard/encounters/[id]`
- **ICD-10 search API:** `/api/icd10/search?q=hyper`
- **Dictations API:** `/api/encounters/[id]/dictations`

## Verification numbers

- **CC chips:** 24 total — 12 Acute / 6 Follow-up / 6 Routine
- **ICD-10 list:** 150 codes covering 14 clinical buckets
- **ICD-10 search latency:** 0–17ms (in-memory; 230× faster than DB-backed drug search)
- **Section dictation:** 5 allowed sections; 3 exposed in UI (chief_complaint, exam_findings, assessment)
- **Migrations total:** 5 (v0–v4)

## Search probes verified (10 queries)

| Query | Top hit | Latency |
|---|---|---|
| `hyper` | I10 Essential hypertension | 17ms |
| `diabetes` | E10.9 / E11.9 / R73.03 Prediabetes | <1ms |
| `fever` | A90 Dengue / A91 Dengue HF / A38.9 Scarlet | <1ms |
| `dengue` | A90 + A91 | <1ms |
| `J02` | J02.9 Acute pharyngitis | 1ms |
| `E11` | All 3 E11 codes | <1ms |
| `headache` | R51 + G44.209 Tension-type | <1ms |
| `asthma` | J45.909 | <1ms |
| `anxiety` | F41.1 GAD + F41.9 | 1ms |
| `I10` | I10 (exact code match, 1.0) | <1ms |

## End-to-end smoke (verified)

PATCH `chief_complaint_chips=["Fever","Cough"]` + `assessment_codes=["J02.9"]` → 200, both arrays persist + render on the page. POST dictation `{section:"chief_complaint",duration_seconds:12}` → row created with `audio_blob_url=null`, `transcript_text=null`. POST `{section:"foo"}` → 400 `invalid_section`. GET dictations returns both rows. Encounter page renders 3 mic SVGs (one per section).

## Bugs found in sprint sweep

| # | Where | Fix |
|---|---|---|
| 1 | Smoke test initially picked a completed encounter for PATCH chips test | Test fix, not a code issue — completed-encounter immutability guard correctly 409'd. Re-ran against a ready_to_resume encounter and it persisted. |

## Carry-overs into Sprint 4 (Prescription compose)

- The Prescription section in `<EncounterEditor>` is still a placeholder card pointing at `/dashboard/drugs`. Sprint 4 drops in the drug compose row with `<DrugTypeahead>` from M1.3 + chip groups for frequency/duration/timing + LASA confirmation strip + Schedule X double-confirm.
- Section dictation captures intent + duration but no audio. Sprint 5 wires MediaRecorder + Vercel Blob + Deepgram so the same `<DictateButton>` records real audio and the existing DB rows get `transcript_text` populated.
- All earlier Sprint 0–2 carry-overs still open: DNS-verify `notifications.even.in` in Resend; move Vercel function region `iad1` → `bom1`/`sin1`; remove the now-unused `ALLOWED_DOCTOR_EMAILS` Vercel env var.

## Retrospective

What worked: the `Section` helper in `<EncounterEditor>` became a clean abstraction — adding a `dictate` prop and getting mics across CC / Exam / Assessment was a 3-line edit. The ICD-10 in-memory search blew DB-backed search latency away (1ms vs 230ms) — worth remembering that <500-row reference data doesn't need a DB round-trip. Sprint 1's `<DrugTypeahead>` was a clean enough template that `<Icd10Typeahead>` came together in <30 mins.

What didn't: the migration v4 patch on `audio_blob_url` is a Sprint 3 concession that wouldn't be acceptable in the production schema (`section_dictations.audio_blob_url` is meaningfully required). Sprint 5 should restore NOT NULL after the real audio path lands.

Sprint 4 (prescription compose) is next.
