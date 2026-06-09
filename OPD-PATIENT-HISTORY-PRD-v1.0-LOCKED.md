# OPD Patient History — PRD v1.0 (LOCKED)

| Field | Value |
|---|---|
| Status | **LOCKED** — 19 decisions across 5 rounds with V (2026-05-18) |
| Owner | Dr. Vinay Bhardwaj (Hospital PM, Even Hospital) |
| Project | OPD-Encounter-App (post-Sprint-8 — `74db413` on main) |
| Final ship tag | `patient-history-v1-shipped` |
| Rollback anchor | `pre-patient-history` (to be tagged on the M0 commit before any PH code lands) |
| Sprint count | 5 sub-sprints (PH.1 → PH.5) |
| Companion docs | `OPD-ENCOUNTER-APP-DESIGN.md` §4A (Smart defaults source), `EHRC-CARRYOVER-2026-05-12.md` §4 (SREWS Qwen architecture reference) |

---

## 1. Problem statement

The OPD Encounter App as it stands (post-Sprint-8) is **present-tense only**. Every encounter screen renders the same set of 24 CC chips and 6 disposition buttons regardless of whether the patient has been seen 0 or 50 times before. The doctor cannot, while documenting, see the patient's past encounters, current chronic conditions, active medications, or accumulated allergy/red-flag history without leaving the app.

This costs three things at once:

1. **Speed.** A doctor who already knows the patient has uncontrolled HTN should be one tap from "BP follow-up" — not scanning 24 chips for it. A chronic-disease return visit looks identical to a first-time walk-in in today's UI.
2. **Safety.** Past notes contain allergies, past contraindications, and chronic-disease drift signals that don't fit into the structured `patients.known_allergies` text field. The doctor's working memory is the only safety net.
3. **Continuity.** The doctor opens the encounter without knowing they saw this patient three weeks ago for a similar complaint. The system has the data; it just doesn't surface it.

**This PRD addresses all three** by introducing a patient-history-awareness module on top of the existing encounter screen: a Qwen-powered patient summary, a dedicated longitudinal view, a slide-out history panel inside the encounter, and CC + disposition chips that re-rank and add patient-specific entries based on the patient's documented past.

---

## 2. Locked decisions (19)

### Round 1 — scope, intelligence, cadence, naming

| # | Decision |
|---|---|
| 1 | **Scope: WIDE.** Full longitudinal view (`/patients/[id]`) + collapsible in-encounter panel + chip smartening + global search. Not just smart-fill on top of existing UI. |
| 2 | **Intelligence: Qwen bridge from day 1.** Same self-hosted Qwen 2.5 14B at `LLM_BASE_URL` that powers EHRC's SREWS. No heuristic-only phase 1. |
| 3 | **Run cadence: pre-process on encounter open + cache.** The patient_summary is computed in the background; the encounter screen reads from the cache. Doctor never blocks on Qwen during typing. |
| 4 | **Module name:** `OPD-PATIENT-HISTORY`. PRD file: this doc. Sprint prefix: `PH.<n>`. |

### Round 2 — content + integration + output + chip behaviour

| # | Decision |
|---|---|
| 5 | **Longitudinal view (`/patients/[id]`) contains ALL FOUR sections:** encounter timeline (chronological cards), LLM-curated problem list, deduplicated medication history, aggregated allergy + risk profile. |
| 6 | **In-encounter integration:** collapsible **left panel**. Default collapsed; one tap reveals last 3-5 visits inline. Doctor can keep open while documenting. |
| 7 | **Qwen output contains ALL FOUR fields:** 2-3 line patient summary (free text), structured chronic problem list (JSON), CC + disposition chip recommendations (ranked array), red-flag list (allergy / contraindication / drug-interaction notes). |
| 8 | **Chip behaviour: BOTH** ranked existing 24 chips + up to 3 patient-specific chips. Standard 24 are re-ordered by this patient's history; up to 3 net-new patient-specific chips appear as a separate "For this patient" row above the buckets. Same applies to disposition (6 buttons re-ordered + up to 2 patient-specific dispositions like "Refer to Dr. Iyer · Cardiology"). |

### Round 3 — recompute, cold start, override, entry points

| # | Decision |
|---|---|
| 9 | **Recompute trigger: post-submit refresh + on-demand button.** Background job after each `/complete` re-runs Qwen for the patient. Doctors can also trigger from `/patients/[id]` via a **Recompute** button. |
| 10 | **Cold start (Mac asleep, 47s): cron pre-warm + skeleton fallback.** `/api/keep-alive` hits Qwen every 5 min during clinic hours (07:00–21:00 IST). On cache miss, the panel renders a "Reading history…" skeleton for up to 10s, then a graceful "history unavailable, retry?" fallback. |
| 11 | **Override pattern: edit + dismiss.** Doctor can edit problem-list items (mark resolved, reword, add custom), and dismiss any AI-suggested chip (won't reappear for this patient). Overrides persist in `doctor_overrides`; future Qwen prompts see them as constraints in a "doctor corrections" section. |
| 12 | **`/patients/[id]` entry points: ALL FOUR** — (a) patient name on queue card becomes a tappable link, (b) link from encounter screen patient banner, (c) "See full history →" link at the bottom of the in-encounter panel, (d) global patient search in the dashboard header. |

### Round 4 — input window, output structure, phasing, empty state

| # | Decision |
|---|---|
| 13 | **Input window for Qwen:** the patient's last **10 completed encounters OR last 12 months — whichever yields more encounters**. Caps prompt token cost while covering both frequent visitors and annual-review patients. |
| 14 | **Output structure: single JSON document per patient.** One Qwen call returns the full payload (`{summary_text, problem_list[], medication_history[], allergy_aggregation, cc_chip_rankings[], cc_chip_additions[], disposition_recommendation, disposition_additions[], red_flags[]}`). Cached as one `patient_summaries` row keyed by `patient_id`. |
| 15 | **Build phasing: PH.1 → PH.5** in this order — Qwen bridge + cache → longitudinal view → in-encounter panel → chip smartening → doctor overrides + global search. |
| 16 | **New patient (zero history) behavior: always-visible panel with "no prior history" inside.** Reinforces that the doctor checked. Chips fall back to the default standard 24 / 6 layout. No Qwen call needed for empty-history patients (saves cost). |

### Round 5 — LLM provenance, sign-off, audit

| # | Decision |
|---|---|
| 17 | **Visual LLM-source indicator: subtle violet dot / AI badge.** Net-new patient-specific chips, Qwen-curated problem-list items, and the recommended disposition all carry a small purple dot (`bg-violet-500` ~6px) or an "AI" pill. Hover/tap reveals "Suggested from past 6 visits." Doctor can always tell what came from Qwen vs structured data. |
| 18 | **Doctor sign-off: implicit at submit.** The existing Submit & finish confirmation modal is the accountability moment. No per-element accept gate on chips or problem list. The PRD documents this explicitly so the design choice is auditable. |
| 19 | **Audit log: patient_id + prompt_hash + output_hash + ms latency + doctor_id.** No raw prompt or output text persisted (size + PHI). Hash-keyed for replay debugging: doctor can ask "what did Qwen show me on Tuesday?" and the audit lets us reconstruct by re-running with the prompt context. |

---

## 3. User stories

**U1 — Returning chronic patient (BP review).**
Geetha Prasad (55F, on Telmisartan + Amlodipine for 18 months) walks in. Doctor opens her queue card. Encounter screen loads with the left panel pre-populated: "Last seen 11 days ago for BP review, 138/82. T2DM + HTN, both well-controlled." CC chips show "BP follow-up" at the top (her 2nd-most-frequent CC); "Diabetes follow-up" 2nd. Disposition shows "Follow-up · 90 days" as the highlighted suggestion. Doctor confirms vitals (BP 142/86 today), taps "BP follow-up", picks her usual Rx from a single-click drug typeahead, taps "Follow-up", submits. **30 seconds for a chronic visit.**

**U2 — New walk-in (first time at EHRC).**
Sneha Acharya (31F, added via demo controls). Doctor opens her card. Left panel renders empty state ("No prior visits — new to EHRC"). Chips render the standard 24/6 layout. Encounter proceeds as it does today. **No regression for first-time visits.**

**U3 — Returning patient with red flag.**
Mohan Rao (66M, T2DM + HTN, **allergic to iodine contrast** per past encounter notes). Doctor opens his card. Panel surfaces a pink-strip "Allergy: iodine contrast (from 2026-03-12 encounter)" warning. CC chips include "Iodine-contrast allergy precaution" as a patient-specific chip. **Doctor sees the red flag without scrolling.**

**U4 — Doctor disagrees with Qwen's problem list.**
Aishwarya Rao (27F, Qwen lists "UTI — recurrent" as a chronic problem after 3 visits in 4 months). Doctor doesn't agree — the latest visit was a one-off. Doctor opens `/patients/[id]`, taps **Edit** on the problem-list row, marks it **Resolved**, adds a note "single uncomplicated episode, no recurrence on follow-up." Next Qwen recompute sees the override and stops surfacing UTI as chronic. **Override loop closed.**

**U5 — Doctor searches for a patient mid-clinic.**
Krishnan calls from the front desk: "Are you available to see Mr. Rajesh Kumar — he was here 3 weeks ago?" Doctor types "Rajesh" in the dashboard search bar, autocomplete shows Rajesh Kumar's MRN, taps → lands on `/patients/[id]`, sees his past visit summary, says "yes, send him in." **30 seconds to context.**

---

## 4. Architecture

### 4.1 Qwen bridge

Reuses the EHRC pattern (see EHRC-CARRYOVER §10):

- **Endpoint:** `LLM_BASE_URL=https://llm.llmvinayminihome.uk/v1` (Cloudflare Tunnel → V's Mac Mini Ollama instance, same as SREWS). Copied to OPD's Vercel env from EHRC's project (pattern matches DEEPGRAM_API_KEY copy in M5.1).
- **Model:** `qwen2.5:14b`. 32K context window. Fits ~20K tokens of Indian OPD records comfortably.
- **Client:** `src/lib/qwen.ts` wraps a `fetch` to `${LLM_BASE_URL}/chat/completions` with `model`, `messages`, `temperature: 0.2`, `response_format: { type: 'json_object' }`.
- **Prompt structure** (system + user, system stays constant):
  - System: role definition, "you are a clinical summarisation assistant for OPD doctors at Even Hospital," output schema description, doctor-correction policy ("if doctor has marked an item as Resolved in past overrides, do NOT re-suggest it").
  - User: serialised JSON of (a) patient demographics, (b) past 10 encounters or 12 months (whichever yields more) with all sections, (c) any persisted `doctor_overrides` for this patient.
- **Output schema** (single JSON object, validated server-side before caching):

  ```jsonc
  {
    "summary_text": "string, 2-3 lines max, doctor-readable",
    "problem_list": [
      {
        "label": "Hypertension",
        "since": "2024-08",            // YYYY-MM or null
        "status": "active | controlled | resolved",
        "current_meds": ["Telmisartan 40mg OD"],
        "last_managed_at": "2026-05-07",
        "source_encounters": ["ENC-20260507-002", "ENC-20260318-...”] // 1-3 refs
      }
    ],
    "medication_history": [
      { "generic": "Telmisartan", "active": true, "first_prescribed": "2024-08", "last_prescribed": "2026-05-07", "frequency_normal": "OD" }
    ],
    "allergy_aggregation": [
      { "allergen": "Iodine contrast", "source": "2026-03-12 encounter notes", "confidence": "high|medium|low" }
    ],
    "cc_chip_rankings": ["BP follow-up", "Diabetes follow-up", "Lab review", "Annual check-up", "..."], // 24 standard chips in patient-specific order
    "cc_chip_additions": ["BP medication review", "Foot check", "HbA1c due"], // 0-3 patient-specific net-new chips
    "disposition_recommendation": "follow_up",          // one of the 6 enum values
    "disposition_additions": ["Refer to Dr. Iyer · Cardiology"], // 0-2 patient-specific named referrals
    "red_flags": [
      { "kind": "allergy", "text": "iodine contrast", "severity": "high" },
      { "kind": "drug_interaction", "text": "Warfarin + NSAIDs avoid", "severity": "medium" }
    ]
  }
  ```

- **Latency budget:** warm Qwen ~5-15s for ~10K token input. Acceptable as a background job. The doctor never blocks on this in normal flow because cache is warmed by the previous encounter's submit.
- **Failure mode:** if Qwen call fails (timeout, parse error, schema violation), the row in `patient_summaries` is marked `status='failed'` and the in-encounter panel renders the fallback empty state. PH.5's polish adds a doctor-facing "Recompute" CTA on the longitudinal view.

### 4.2 Caching + recompute (`patient_summaries` table)

New table introduced in migration v5:

```sql
CREATE TABLE patient_summaries (
  patient_id UUID PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
  summary JSONB NOT NULL,
  source_encounter_count INT NOT NULL,
  source_window_start DATE NOT NULL,
  source_window_end DATE NOT NULL,
  qwen_model TEXT NOT NULL,        -- e.g. 'qwen2.5:14b'
  qwen_latency_ms INT,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'fresh', -- fresh | stale | failed | computing
  fail_reason TEXT
);
```

**Recompute triggers:**

1. **Post-`/complete` async hook.** When an encounter flips to `completed`, fire `POST /api/internal/recompute-summary?patient_id=X` as a background fetch. The endpoint runs the Qwen call and updates the row. Failure marks status='failed' but does not block the encounter completion.
2. **On-demand button** on `/patients/[id]` triggers the same endpoint, with a UI spinner until the update returns.
3. **First-time computation** (a patient with zero summary row but ≥1 completed encounter) happens lazily on first encounter screen open for that patient. The panel shows a skeleton until done.

**No TTL-based refresh.** Cache only invalidates when a new encounter is submitted. Past-encounter edits are rare and handled via the on-demand button.

### 4.3 Cold-start handling

**Cron pre-warm.** Vercel Cron Job at `/api/keep-alive` runs every 5 minutes during clinic hours:

```
0 7-21 * * * → POST /api/keep-alive (Mon-Sat)
```

The endpoint POSTs a 3-token request to Qwen ("ping"). Keeps the Ollama process and the Cloudflare Tunnel alive between encounters. Adds ~$1-2/month of compute on V's home power bill — negligible.

**Skeleton on cache miss.** If a patient's summary is not yet computed when the encounter screen opens, the panel renders a `<HistoryPanelSkeleton />` for up to 10s. If the cache is still cold at 10s, the panel falls back to "History unavailable — retry?" with a manual recompute button. Encounter screen continues to function — chips default to standard 24, disposition shows standard 6.

### 4.4 Audit log

New table:

```sql
CREATE TABLE qwen_call_audit (
  id BIGSERIAL PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id UUID REFERENCES doctors(id),
  prompt_hash TEXT NOT NULL,         -- sha256 of the user message
  output_hash TEXT NOT NULL,         -- sha256 of the parsed output
  qwen_model TEXT NOT NULL,
  qwen_latency_ms INT,
  result TEXT NOT NULL,              -- 'success' | 'parse_error' | 'timeout' | 'schema_violation'
  called_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_qwen_call_audit_patient ON qwen_call_audit(patient_id, called_at DESC);
```

Per Round-5 decision: no raw prompt or output text persisted. Hash-keyed for replay. To debug "what did Qwen show me on Tuesday," V can locate the row by patient + date, then re-run the Qwen call with the same input window. Approximate replay (Qwen is non-deterministic at temperature 0.2, but close enough at lower-temperature retries).

---

## 5. UI surfaces

### 5.1 `/patients/[id]` longitudinal view (PH.2)

New page. Auth-gated by doctor session (middleware matcher extended to `/patients/:path*`).

Layout (single column, max-width 3xl):

1. **Patient banner** — name, age/sex, MRN, phone, allergy pill. Same banner pattern as the encounter screen for consistency.
2. **Qwen summary card** — the `summary_text` (2-3 lines), violet AI badge, "Computed <time ago>" timestamp, on-demand **Recompute** button. Skeleton/failure states handled here.
3. **Problem list panel** — table of `{label, since, status, current_meds, last_managed_at}`. Each row has an inline **Edit** action (modal: re-word label, change status to active/controlled/resolved, add doctor note). Custom problems can be added with `+ Add problem`. AI-derived items carry the violet dot.
4. **Medication history table** — sortable by recency. Columns: brand+strength, generic, frequency, first/last prescribed, active/discontinued. Each row links to the originating encounter.
5. **Allergy + risk profile strip** — pink-background list. Each item shows source encounter date. Editable: doctor can mark `confidence: false_positive` to dismiss.
6. **Encounter timeline** — reverse-chronological cards. Each card: date, CC chips, primary diagnosis (ICD code), Rx summary (one-line), disposition. Click a card → opens read-only `/dashboard/encounters/[id]` in new tab.

### 5.2 In-encounter collapsible left panel (PH.3)

Mounted on the left edge of `/dashboard/encounters/[id]`. Default collapsed (40px-wide rail with a chevron icon). Tap to expand to ~360px.

Contents when expanded:

- Header: patient name + "View full history →" link to `/patients/[id]`
- Summary line (1-2 of the 2-3 line `summary_text`)
- Problem list (compact, top 3-4 items)
- Allergy strip (always visible if non-empty)
- Last 3-5 encounter cards (date + CC + diagnosis)

Persistent state: the doctor's choice to expand/collapse persists per session in `localStorage`. Resets on sign-out.

### 5.3 Chip smartening (PH.4)

**CC chips:**
- The standard 24 chips remain. Their **order within each bucket** (Acute / Follow-up / Routine) is re-ranked using `cc_chip_rankings` from the patient summary.
- A new row appears at the top of the chip grid labelled **"For this patient"** — contains the 0-3 chips from `cc_chip_additions`. Each carries a violet AI dot.

**Disposition buttons:**
- The 6 standard buttons remain. Their **order** is re-ranked so the `disposition_recommendation` is leftmost + visually emphasised with a violet AI dot.
- 0-2 net-new patient-specific dispositions appear as additional buttons (e.g., "Refer to Dr. Iyer · Cardiology"). Selecting one auto-fills the `referral_target` field with the doctor name.

**Persistence:** AI-derived chip selections are persisted into `chief_complaint_chips[]` and (for the new disposition labels) as a new optional `disposition_label_override` column on `encounters` — TBD in PH.4 schema migration.

### 5.4 Doctor overrides (PH.5)

Three override surfaces:

1. **Problem-list edits** in `/patients/[id]` (5.1). Each edit writes to a new `doctor_overrides` table:

```sql
CREATE TABLE doctor_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES doctors(id),
  override_type TEXT NOT NULL,    -- 'problem_resolved' | 'problem_relabeled' | 'allergy_dismissed' | 'chip_dismissed' | 'custom_problem_added' | 'doctor_note'
  target_key TEXT NOT NULL,        -- problem label, allergy text, chip label, etc.
  override_value JSONB,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_doctor_overrides_patient ON doctor_overrides(patient_id, created_at DESC);
```

2. **Chip dismissal** in the in-encounter view. Each AI chip has a small × on hover; tap → chip disappears for this patient permanently. Stored as `override_type='chip_dismissed'`.

3. **Allergy/red-flag dismissal** in `/patients/[id]` allergy strip. Same pattern.

**Override influence on Qwen:** The next Qwen call for the patient includes a "doctor corrections" section in the prompt with all active overrides. Prompt instruction: "do not re-suggest items the doctor has explicitly resolved or dismissed."

### 5.5 Global patient search (PH.5)

Search bar added to the dashboard header (left of the existing "Drug search" / "Demo" / "Sign out" links).

- 1-character minimum to trigger.
- Searches `patients.name` (trigram) + `patients.mrn` (prefix).
- Returns top 6, autocomplete dropdown style.
- Click → `/patients/[id]`.
- Implemented via existing `pg_trgm` indexes (add a trigram index on `patients.name` in migration alongside PH.5).

### 5.6 Empty state for new patients

When a patient has zero completed encounters:

- `/patients/[id]` shows a friendly empty state. Sections render with "No prior data" placeholders.
- In-encounter panel renders expanded by default (since there's nothing to scroll past) but with the empty state inside.
- No Qwen call is made; no `patient_summaries` row exists.
- CC chips use the default standard 24 in their original order.
- Disposition uses the default standard 6.

### 5.7 LLM provenance treatment

Every Qwen-derived UI element carries one of:

- **Violet dot** (~6px circle, `bg-violet-500`) for compact contexts (chips, problem-list rows, disposition buttons).
- **AI pill** (rounded badge with "AI" text and violet background) for prominent contexts (problem-list panel headers, recommended-disposition emphasis).

Hover/tap reveals a tooltip: "Suggested from past N visits." (where N is the encounter count window used).

The doctor can always distinguish Qwen-derived content from structured-data-derived content.

---

## 6. Data model

### 6.1 New tables (3) + 1 column add

- `patient_summaries` (one row per patient, JSONB summary) — §4.2
- `doctor_overrides` (audit-friendly override log) — §5.4
- `qwen_call_audit` (hash-keyed call log) — §4.4
- `encounters.disposition_label_override TEXT NULL` — to capture custom disposition labels from `disposition_additions` (PH.4)

### 6.2 Migration sequencing

| Version | Name | Sprint |
|---|---|---|
| v5 | `create_patient_summaries` | PH.1 |
| v6 | `create_qwen_call_audit` | PH.1 |
| v7 | `create_doctor_overrides` | PH.5 |
| v8 | `add_disposition_label_override` | PH.4 |

All migrations idempotent (`CREATE TABLE IF NOT EXISTS`, `ALTER … ADD COLUMN IF NOT EXISTS`). Inline in `src/lib/migrations.ts` per the existing pattern.

---

## 7. Build plan

| Sprint | Focus | Deliverable | Days |
|---|---|---|---|
| **PH.1** | Qwen bridge + cache | `LLM_BASE_URL` copied to OPD env. `src/lib/qwen.ts` client. `POST /api/internal/recompute-summary`. `GET /api/patients/[id]/summary`. Migration v5 + v6. `qwen_call_audit` writes from every call. `/api/keep-alive` cron at 5 min during clinic hours. | 3-4 |
| **PH.2** | `/patients/[id]` longitudinal view | New page with the 4 sections (timeline, problem list, medication history, allergy strip) + summary card with Recompute button. Read-only initially; editing is PH.5. | 3-4 |
| **PH.3** | In-encounter collapsible left panel | `<HistoryPanel>` component mounted on `/dashboard/encounters/[id]`. Skeleton + failure fallbacks. localStorage-persisted expand/collapse. "See full history →" link to PH.2. | 2-3 |
| **PH.4** | Chip smartening (CC + disposition) | Re-rank standard 24 / 6 from `cc_chip_rankings` / `disposition_recommendation`. Render up to 3 patient-specific CC chips + 2 patient-specific dispositions as net-new entries. Violet AI dots. Migration v8 (`disposition_label_override`). | 3-4 |
| **PH.5** | Doctor overrides + global search | `doctor_overrides` table (v7). Problem-list edit modal, chip dismissal ×, allergy dismissal. Global header search bar with trigram autocomplete. Qwen prompt extended to include overrides. Sprint close — ship tag `patient-history-v1-shipped`. | 3-4 |

**Total: 14-19 elapsed days.** Each PH sprint follows the established Cowork pattern (milestone check-ins, tags, smoke tests, sprint tracker file).

---

## 8. Production hardening / pre-pilot prerequisites

These must happen before patient-history v1 ships to a real pilot doctor:

- **`LLM_BASE_URL` provisioned on OPD Vercel.** Copy from EHRC project env, same flow as DEEPGRAM_API_KEY in M5.1.
- **Mac Mini availability monitoring.** EHRC carryover §10 notes 47s cold-start when Mac sleeps. Need (a) clinic-hour cron pre-warm, (b) status page indicator if Qwen is down, (c) graceful degradation.
- **Backfill existing 25 seed patients.** PH.1 will need a one-time job: for each patient with ≥1 completed encounter, run the Qwen summary. Demo controls panel gets a **Backfill all summaries** button.
- **Audit retention policy.** `qwen_call_audit` grows by ~1 row per encounter. At 50 encounters/day × 365 days, ~18K rows/year. Negligible storage. Plan retention: keep indefinitely for v1; revisit at 100K rows.
- **Doctor-correction telemetry.** Track how often the doctor overrides Qwen output — feeds back into prompt tuning.

---

## 9. Open questions / deferred to v2

| Item | Why deferred |
|---|---|
| **Cross-doctor problem-list view** (does Dr. Chandrika see V's overrides?) | Today there's one doctor (V). Multi-doctor merging needs its own design pass. |
| **Patient-portal access to their own longitudinal view** | Outside OPD app scope. Could be a Hospital-Pass-side feature. |
| **Lab values in the timeline** | We don't ingest labs yet. When labs land (separate project), they become a 5th section. |
| **Drug-drug interaction checking from Qwen output** | Qwen produces red flags but doesn't run a formal interaction check. v2 can wire `drug_master` against the RxNorm interaction graph. |
| **Voice query of patient history** ("show me her last BP readings") | Sprint 5's section dictation could be extended into the panel. v2. |
| **Differential diagnosis suggestions** | Larger clinical-reasoning surface; needs its own PRD + clinical-safety review. |

---

## 10. Change log

- **2026-05-18** — Document initialised. Round 1-5 complete; 19 decisions locked. Build sequence finalised as PH.1 → PH.5. PRD ready for V's start-PH.1 sign-off.

---

## Appendix A — Decision provenance

Each locked decision in §2 was raised as a multiple-choice question via the AskUserQuestion tool in Cowork. The five rounds were:

- Round 1 (4 decisions): scope, intelligence layer, run cadence, module name.
- Round 2 (4 decisions): longitudinal-view contents, in-encounter integration, Qwen output, chip behaviour.
- Round 3 (4 decisions): recompute trigger, cold-start UX, override pattern, entry points.
- Round 4 (4 decisions): input window, output structure, build phasing, empty state.
- Round 5 (3 decisions): LLM provenance, doctor sign-off, audit scope.

Verbatim responses captured in the Cowork session transcript (2026-05-18).

---

*End of OPD-PATIENT-HISTORY-PRD-v1.0-LOCKED.*
