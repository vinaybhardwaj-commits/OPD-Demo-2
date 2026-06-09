# OPD-Encounter-App v2 — PRD (LOCKED)

**Status:** Locked 2026-05-18 across 6 design rounds with V. 24 binding decisions.
**Rollback anchor (will be set):** `pre-v2` → tip of `patient-history-v1-shipped` at build start.
**Final ship tag:** `opd-app-v2-shipped`
**Predecessor:** `patient-history-v1-shipped` (1969421)

---

## 1. Problem statement

v1 delivered a doctor-only OPD encounter app: queue, encounter, prescription dispatch, longitudinal patient history with a Qwen-powered intelligence layer. It assumes a single actor (the doctor) does everything from intake to dispatch.

A real Even Hospital OPD has at least three actors before the doctor:

- **Customer Care Executive (CCE)** at reception — registers patients, captures intake reason, assigns to an OPD room, dispatches paused-encounter patients to lab/diagnostics, marks results ready
- **Triage Nurse** in the triage station — captures vitals (BP, HR, RR, Temp, SpO₂, Weight, Height, Pain), refines chief complaint, marks the patient as ready for the doctor
- **Lab Tech** in the lab — receives orders, uploads result PDFs, returns results into the patient chart

v1 elides all three. v2 builds them as first-class actors with their own surfaces, while keeping the doctor's existing encounter screen untouched in core flow. The doctor's experience gets *richer* (vitals pre-filled, intake reason visible, real-time queue updates), not different.

v2 also adds four AI/clinical-quality capabilities that were deferred from the v1 patient-history PRD: **lab values in the timeline**, **drug-drug interaction checks**, **differential-diagnosis suggestions**, and **voice query of patient history**. And it formalises **multi-doctor visibility** for the problem list, which was explicitly punted in v1.

Patient portal access — deferred from v1 — is **dropped from v2 entirely** and reconsidered for v3+.

---

## 2. Locked decisions (24)

### Round 1 — Framing

1. **Scope is a single PRD** spanning v2.0 → v2.3, no per-phase PRDs. Build executed phase-by-phase.
2. **Per-user magic-link auth with `role` claim** on the JWT (`doctor | cce | nurse | lab_tech | admin`). No shared kiosk accounts; every action carries a real human author.
3. **`encounter_status` enum is extended** in place to add pre-doctor states (`registered`, `at_triage`, `waiting_for_doctor`). One source of truth per visit; existing queue code keeps working.
4. **Real-time updates via SSE on Postgres LISTEN/NOTIFY.** Sub-second propagation, zero third-party PHI exposure, no monthly cost. Doctor's queue, triage queue, CCE board all subscribe.

### Round 2 — OPD Choreography (v2.0)

5. **OPD rooms are physical**, named, with a default doctor and a swap path. New `opd_rooms` table. Patient is assigned to room → doctor on shift owns the queue.
6. **Mandatory triage vitals = BP, HR, Temp, SpO₂, Weight, Height, Pain** (the JCI/NABH-tier set). BMI auto-computed. RR is optional.
7. **Day-of token = MRN** (no separate sequence). Schema reserves `token_number TEXT` for later upgrade if waiting-room board needs short serials.
8. **CCE never sends patients to lab independently.** Doctor orders → patient comes back to CCE → CCE dispatches to lab counter. Clinical ownership stays with the doctor.

### Round 3 — Patient portal

9. **Patient portal DROPPED from v2.** Deferred to v3 or later.

### Round 4 — Labs (v2.1)

10. **No lab catalog table.** Doctor types test name in free text. Qwen normalises to a canonical key (`cbc`, `hba1c`, `lipid_panel`) at order entry. Same key used by result extraction so trending works.
11. **Order entry inline in the existing Send-to-diagnostics modal** plus a new "Labs ordered" card on the encounter screen. One UX path.
12. **Lab result return = lab tech uploads the PDF.** Server pipeline: OCR (best-effort) → Qwen extracts structured rows → each row tagged with canonical key.
13. **Critical-value alerts surface in-app** (red banner on doctor's queue + dashboard count), pushed via SSE in <1s. No SMS in v2; that's pager territory for a later phase.

### Round 5 — Advanced AI (v2.2)

14. **Voice query = push-to-talk in the HistoryPanel.** No wake word, no always-on listening. Re-uses Deepgram + Qwen plumbing from v1.
15. **Differential diagnosis fires twice:** (a) on-demand "Suggest Ddx" button, (b) pre-submit safety check inside SubmitConfirmModal. Doctor sees both, can ignore either.
16. **DDI checking = Qwen-only**, single prompt over the drug list + allergies + active problems. No FDA / RxNorm dependency.
17. **AI provenance is fully visible.** Every AI output carries a violet dot, an "AI" tag, AND a "Why this suggestion?" expander that lists the source encounter numbers it drew from. Maximum medico-legal defensibility.

### Round 6 — Multi-doctor problem-list (v2.3)

18. **Shared chart by default.** Every doctor sees every override with author + date attribution.
19. **Re-open = new override row supersedes the old.** Both rows persist (audit trail), problem-list rendering uses most-recent-wins.
20. **Author attribution = inline tag + hover tooltip.** Subtle subline like "Resolved by Dr. V · 6w ago"; full timestamp on hover.
21. **Handoff notes = new `handoff_note` TEXT field on the encounter.** Shows as a pinned banner on the patient's next encounter open across any doctor; auto-dismisses when next doctor acknowledges.

### Additional locked rules

22. **All new surfaces use the existing Even palette + Tailwind classes.** No new design system.
23. **Migrations are sequential `v9..vN`** with the existing inline runner pattern. No new tooling.
24. **No regression on the v1 demo path** — `/admin/demo-controls` keeps every existing button. Rollback to `pre-v2` is fast.

---

## 3. User stories

### CCE (Customer Care Executive)

- "As a CCE, I want to register a walk-in patient in under 60 seconds so the triage line keeps moving."
- "As a CCE, I want the dashboard to show me each room's current queue length so I can balance new patients across rooms."
- "As a CCE, I want a board of patients waiting for lab/diagnostic results so I can call them when results land."
- "As a CCE, I want SSE to update my view when the doctor sends a patient to lab — without me refreshing."

### Triage Nurse

- "As a triage nurse, I want to see only patients in `at_triage` state, grouped by room."
- "As a triage nurse, I want the vitals form to flag red-zone values (BP > 180/110, SpO₂ < 92, Temp > 38.5) immediately."
- "As a triage nurse, I want BMI to auto-compute when I enter weight + height."
- "As a triage nurse, I want to refine the chief complaint that the CCE entered — sometimes the patient tells me something more specific."

### Doctor (existing surface evolves)

- "As a doctor, I want my queue to update in real-time when vitals are captured — no manual refresh."
- "As a doctor, I want vitals to be pre-filled in the encounter, so I focus on the consult."
- "As a doctor, I want a critical-value banner if any lab result came back red."
- "As a doctor, I want a 'Suggest Ddx' button after my exam — and a safety check at submit time."
- "As a doctor, I want to leave a handoff note for whichever doctor sees this patient next."

### Lab Tech

- "As a lab tech, I want to see only orders assigned to me, grouped by patient."
- "As a lab tech, I want to upload a result PDF and have it parsed into structured rows automatically."
- "As a lab tech, I want to flag the doctor when a critical value is detected."

### Admin

- "As an admin, I want to invite new CCEs, nurses, and lab techs by email (magic-link signup)."
- "As an admin, I want to manage OPD rooms — name, default doctor, active flag."

---

## 4. Architecture

### 4.1 Role-based auth & RBAC

The existing `doctors` table is renamed to `users` and gains a `role` column:

```sql
ALTER TABLE doctors RENAME TO users;
ALTER TABLE users
  ADD COLUMN role TEXT NOT NULL DEFAULT 'doctor'
  CHECK (role IN ('doctor','nurse','cce','lab_tech','admin'));
```

The JWT carries `{ email, role, purpose: 'session' }`. Middleware extends its matcher to gate all new surfaces (`/reception`, `/triage`, `/lab`) by role.

`getCurrentUser()` replaces `getCurrentDoctor()` everywhere. The old function is kept as a deprecated alias that asserts `role === 'doctor'` and 403s otherwise — so v1 routes stay correct.

Magic-link signup at `/auth/signup` accepts an `invite_token` query param. Admins generate invite tokens at `/admin/users` that scope to a specific role on accept.

### 4.2 Encounter state machine (extended)

```
                         ┌─────────────┐
   walk in → CCE creates │ registered  │
                         └──────┬──────┘
              CCE assigns room  │
                                ▼
                         ┌─────────────┐
                         │  at_triage  │
                         └──────┬──────┘
            Nurse saves vitals  │
                                ▼
                         ┌──────────────────┐
                         │ waiting_for_doctor│
                         └──────┬───────────┘
              Doctor opens enc  │
                                ▼
                         ┌─────────────┐
                         │   active    │
                         └──┬───────┬──┘
        Send to diagnostics │       │ Submit
                            ▼       │
                ┌─────────────────┐ │
                │ paused_diagnostics├─→ ready_to_resume ─→ active (loop)
                └─────────────────┘ │
                                    ▼
                            ┌─────────────┐
                            │  completed  │
                            └─────────────┘
                                    │
                                    ▼ dispatch (existing)
                            (PDF + Twilio)
```

Migration (v9) alters the existing `encounter_status` enum to add `registered`, `at_triage`, `waiting_for_doctor` ahead of `active`. Existing rows are unaffected (none have the new values).

Queue API (`/api/queue`) gains lanes for the new states. Doctor's `/dashboard` "Waiting" lane semantically becomes "Vitals captured, ready for me." CCE and Nurse surfaces see the earlier states.

### 4.3 OPD room model

```sql
CREATE TABLE opd_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,      -- 'OPD-1', 'OPD-2'
  floor TEXT,                      -- '2nd floor'
  default_doctor_id UUID REFERENCES users(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE encounters ADD COLUMN room_id UUID REFERENCES opd_rooms(id);
ALTER TABLE encounters ADD COLUMN intake_visit_reason TEXT;
```

CCE assigns patient → picks room → encounters row inserted with `status='registered'`, `room_id`, `intake_visit_reason`. The patient's doctor for this visit is `opd_rooms.default_doctor_id` resolved at insert time; admin can swap by editing the row.

Admin surface `/admin/rooms` is a simple CRUD: name, floor, default doctor select, active toggle.

### 4.4 Real-time updates (SSE on Postgres LISTEN/NOTIFY)

**Channel naming:** `queue:room:<room_id>` and `queue:user:<user_id>` and `queue:global`.

**Producer side:** every state change in `/api/encounters/[id]/...` ends with `pg_notify('queue:room:<id>', encounter_id::text)`. CCE assign action also notifies.

**Consumer side:** new endpoint `GET /api/queue/stream?room=<id>` opens an SSE connection. Server runs `LISTEN queue:room:<id>` on a dedicated pool connection per request (capped at maxDuration; client auto-reconnects on close).

**Client side:** new hook `useQueueLive(roomId)` opens the EventSource, calls `router.refresh()` on every notify. Replaces the implicit refresh pattern. The hook is mounted on `/dashboard`, `/triage`, `/reception`, `/lab`.

**Vercel constraints:** Pro tier supports streaming responses with `maxDuration: 800`. After 13 minutes the client reconnects. Reconnect is silent (EventSource handles it natively).

**Fallback:** if SSE fails (network blip), the hook falls back to 30s polling so the UI stays accurate.

### 4.5 Lab subsystem

Two new tables:

```sql
CREATE TABLE lab_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES encounters(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  ordering_doctor_id UUID NOT NULL REFERENCES users(id),
  raw_text TEXT NOT NULL,           -- what the doctor typed
  canonical_key TEXT,                -- 'cbc', 'lipid_panel', etc — Qwen-normalized
  display_name TEXT,                 -- 'Complete Blood Count' — Qwen-normalized
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | in_progress | resulted | cancelled
  ordered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resulted_at TIMESTAMPTZ
);

CREATE TABLE lab_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_order_id UUID NOT NULL REFERENCES lab_orders(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  canonical_key TEXT NOT NULL,       -- 'hemoglobin', 'hba1c' — per-test, not per-panel
  display_name TEXT NOT NULL,
  value_numeric NUMERIC,             -- if Qwen could parse a number
  value_text TEXT,                   -- fallback / qualitative
  unit TEXT,
  reference_range TEXT,
  is_critical BOOLEAN NOT NULL DEFAULT FALSE,
  source_pdf_url TEXT,               -- Vercel Blob URL of the original
  entered_by UUID REFERENCES users(id),  -- the lab tech
  entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_lab_results_patient_key ON lab_results(patient_id, canonical_key, entered_at DESC);
```

**Flow:**

1. Doctor (in encounter Send-to-diagnostics modal) types "CBC and HbA1c". Qwen normalises into two `lab_orders` rows (`canonical_key='cbc'`, `canonical_key='hba1c'`). Encounter goes `paused_diagnostics`.
2. CCE dispatches the patient to the lab counter (clicks "Sent to lab" on /reception).
3. Lab tech logs in to `/lab`, sees pending orders by patient, scans + uploads the result PDF.
4. Server: pdf-lib + Tesseract.js OCR → Qwen extracts structured rows → writes `lab_results`. Each row's `canonical_key` is matched to one of the open orders (or left orphan).
5. Critical values (Qwen flags them) → `is_critical=true` + `pg_notify('queue:user:<doctor_id>')`.
6. Doctor's `/dashboard` shows a red banner. Click → encounter screen surfaces the result + "✓ Mark as reviewed" → encounter resumes to `ready_to_resume`.

**Trending:** patient timeline gets a new section "Lab values" — for each `canonical_key`, a sparkline of values over time.

### 4.6 Advanced AI surfaces

**Voice query** (PH.3's `<HistoryPanel>` evolution):
- New mic button in panel header.
- Hold → MediaRecorder → Deepgram → text.
- New `POST /api/internal/voice-query` accepts `{ patient_id, question }`, runs Qwen over the patient summary + last 10 encounters, returns `{ answer, sources: ['ENC-...', ...] }`.
- Renders as a chat bubble in the panel, sources rendered as click-through links.

**Differential diagnosis:**
- New `POST /api/internal/ddx` accepts `{ encounter_id }`, runs Qwen with the current encounter's CC + exam + assessment + patient summary + active meds, returns rank-ordered `[{ dx, confidence, rationale, source_encounters }]`.
- On-demand: new "Suggest Ddx" button in the encounter screen near Submit. Opens a side sheet with the list.
- Pre-submit: inside SubmitConfirmModal, the same call runs. If Qwen suggests a Ddx that's NOT in the doctor's assessment, the modal shows a yellow "Consider also" callout with one item. Doctor must acknowledge to continue (single click).

**DDI checking:**
- On every Rx auto-save, throttled to 1 call per 10s.
- `POST /api/internal/ddi` accepts `{ encounter_id }`, runs Qwen over (existing meds + new meds + allergies + active problems), returns `[{ severity: 'high'|'medium'|'low', pair: [drug_a, drug_b], rationale }]`.
- High-severity interactions render as a pink banner above the prescription compose section. Medium as a yellow chip. Low as a subtle dot.
- All findings persist on the encounter's `ddi_findings` JSONB column (new) for audit + medico-legal defensibility.

### 4.7 Multi-doctor problem-list semantics

- All `doctor_overrides` rows are visible to all doctors. No `visibility` column.
- Problem-list rendering on `/patients/[id]` applies overrides in `created_at DESC` order; most-recent-wins.
- Each problem row carries an inline subline showing the most-recent overriding doctor + relative time: "Resolved by Dr. V · 6w ago". Hover for full timestamp and full name.
- "Re-open" UI is a button on resolved problems → writes a new override row with `action='edit', status='active'`. The new row supersedes.
- New `encounters.handoff_note TEXT` column. On encounter completion, the doctor can type a free-text note. Shows as a pinned violet banner on the *next* encounter open for the same patient across any doctor. The next doctor sees an "✓ Acknowledge" button that dismisses the banner (writes `handoff_ack_by`, `handoff_ack_at` on the source encounter).

---

## 5. UI surfaces

### 5.1 `/reception` — CCE workstation (NEW)

Single page, max-w-6xl. Layout:

```
┌──────────────────────────────────────────────────────────────┐
│ Even Hospital · Reception              [User]   [Sign out]   │
│ ────────────────────────────────────────────────────────────│
│ [search bar — global patient search]                         │
│                                                              │
│ Today's queue · 47 patients · 23 done · 18 waiting · 6 active│
│                                                              │
│ ┌─ OPD-1 · Dr. V ─────────┐ ┌─ OPD-2 · Dr. Chandrika ───┐  │
│ │ Wait: 6  Avg: 12m       │ │ Wait: 4  Avg: 8m          │  │
│ │                         │ │                            │  │
│ │ • Mohan Rao    EHRC-012 │ │ • Asha Pai     EHRC-018   │  │
│ │   at_triage             │ │   at_triage                │  │
│ │ • Sunita K.    EHRC-011 │ │ • Naveen G.    EHRC-019   │  │
│ │   waiting_for_doctor    │ │   active                   │  │
│ │ ...                     │ │ ...                        │  │
│ └─────────────────────────┘ └────────────────────────────┘  │
│                                                              │
│ [+ Register patient] (modal)                                 │
│                                                              │
│ ╔════════════════════════════════════════════════════════╗  │
│ ║ Lab / Diagnostics dispatch (4 paused)                  ║  │
│ ║                                                         ║  │
│ ║ • Geetha Prasad   ECG pending     [Sent to lab]        ║  │
│ ║ • Rohan Mehta     USG abdomen     [✓ Result ready]     ║  │
│ ║ ...                                                     ║  │
│ ╚════════════════════════════════════════════════════════╝  │
└──────────────────────────────────────────────────────────────┘
```

**Register modal** — search by phone first (existing patient path) or fill form. Required fields: name, age, sex, phone. Optional: address, Aadhaar, insurance. Intake reason free-text. Doctor/room select shows current queue length per row. Submit → inserts `encounters` row with `status='registered'`, `room_id`, `intake_visit_reason`. SSE notifies the triage station.

**Lab/Diagnostics dispatch panel** — shows encounters in `paused_diagnostics` for any doctor. Two actions per row: "Sent to lab" (no state change, just acknowledgement) and "✓ Result ready" (→ `ready_to_resume`, SSE notifies doctor).

### 5.2 `/triage` — Triage Nurse workstation (NEW)

```
┌──────────────────────────────────────────────────────────────┐
│ Triage · Nurse Devi                            [Sign out]    │
│ ────────────────────────────────────────────────────────────│
│ [OPD-1 (5)] [OPD-2 (3)] [All (8)]                          │
│                                                              │
│ Mohan Rao   66M   EHRC-012   Visit: BP follow-up           │
│ Registered 8 minutes ago                       [Capture →]  │
│ ──────────────────────────────────────────                  │
│ Sunita K.   72F   EHRC-011   Visit: Joint pain             │
│ Registered 5 minutes ago                       [Capture →]  │
│ ...                                                          │
└──────────────────────────────────────────────────────────────┘
```

**Vitals capture form** — modal or dedicated page (latter recommended for keyboard ergonomics):

```
Vitals · Mohan Rao · 66M · EHRC-012
─────────────────────────────────────

BP            ___ / ___   mmHg
HR            ___          bpm
RR (opt.)     ___          /min
Temp          ___          °C
SpO₂          ___          %
Weight        ___          kg
Height        ___          cm  →  BMI: auto
Pain          ___          /10

Refine chief complaint (CCE: "BP follow-up"):
________________________________________________________

Notes (optional):
________________________________________________________

                            [Cancel]   [Save & ready for doctor]
```

Red-zone validation inline: BP >180/110, HR <50 or >110, Temp >38.5, SpO₂ <92 → field background turns pink, callout below the field. Submit blocked only if pain or any of the 6 standard fields are missing.

Save → encounter advances to `waiting_for_doctor`, vitals JSON populated, chief_complaint_text overwrites the CCE one. SSE notifies the room's default doctor.

### 5.3 `/dashboard` — Doctor (existing, evolved)

Visual delta from v1:
- "Waiting" lane semantically becomes "Vitals captured" (label changes, lane stays).
- Each waiting card gains a 1-line vitals tile and the intake reason chip.
- Red banner at top if any encounter in `paused_diagnostics` has a critical lab result.
- `useQueueLive(doctor.id)` hook subscribes to SSE for real-time updates.
- Search bar in header gains a "Recent" tab (last 5 patients V opened).

### 5.4 `/dashboard/encounters/[id]` — Encounter screen evolutions

- Vitals section pre-filled from triage; "Last edited by Nurse Devi · 12m ago" attribution.
- Intake reason from CCE shown as a chip above the CC chip grid.
- New "Critical lab result" red banner if applicable (only shows in `ready_to_resume` after lab return).
- "Suggest Ddx" button on the right of the Submit area.
- HistoryPanel gains a 🎤 mic for voice query.
- Drug rows show DDI severity badges; banner above the section if any high-severity.
- SubmitConfirmModal gains a "Pre-submit safety check" section running the Ddx + DDI passes; handoff_note input below.

### 5.5 `/patients/[id]` — Longitudinal (evolves)

- All sections gain author attribution per row ("Resolved by Dr. V · 6w ago" pattern).
- Lab values section added between Medication history and Allergies. Per canonical_key, a 12-month sparkline + table of values with reference ranges.
- Re-open action on resolved problems.
- Voice query mic in the summary card (same hook as encounter HistoryPanel).
- Handoff banner if a previous doctor left one.

### 5.6 `/lab` — Lab Tech workstation (NEW)

```
┌──────────────────────────────────────────────────────────────┐
│ Lab · Tech Ramesh                              [Sign out]    │
│ ────────────────────────────────────────────────────────────│
│ Pending orders (12)                                          │
│                                                              │
│ Mohan Rao   66M  EHRC-012                                   │
│ • CBC                                          [Upload PDF]  │
│ • HbA1c                                        [Upload PDF]  │
│ ──────────────────────────────────────────                   │
│ Sunita K.   72F  EHRC-011                                   │
│ • Lipid Panel                                  [Upload PDF]  │
│ ...                                                          │
└──────────────────────────────────────────────────────────────┘
```

Upload flow: drag-drop PDF → server uploads to Vercel Blob → OCR + Qwen extract → result rows render in a preview pane → tech reviews/edits → "Confirm result" writes `lab_results` rows and advances order status to `resulted`. Critical values flagged in the preview.

### 5.7 `/admin/rooms` and `/admin/users` (NEW)

Simple CRUD pages. Admin invites users via `/admin/users` → email goes out via Resend with magic link to `/auth/signup?invite=<token>`. Rooms editable inline.

### 5.8 AI surface treatments (cross-cutting)

- Every AI-derived item carries a violet dot (existing convention).
- New "Why this suggestion?" affordance — a small `(?)` next to each AI claim. Click → popover lists the source encounter numbers ("Based on ENC-20260318, ENC-20260507, ENC-20260518") that link to the read-only encounter view.
- Ddx side sheet renders 3-5 candidates, each with confidence pill (high/med/low — based on Qwen's self-rating + cross-checked against the patient's history), rationale paragraph, and the "Why" popover.

---

## 6. Data model

### 6.1 New tables

- `opd_rooms` (§4.3)
- `lab_orders`, `lab_results` (§4.5)

### 6.2 New columns

- `users` (renamed from `doctors`): `role` (text, default 'doctor')
- `encounters`: `room_id` (uuid, fk → opd_rooms), `intake_visit_reason` (text), `token_number` (text), `handoff_note` (text), `handoff_ack_by` (uuid, fk → users), `handoff_ack_at` (timestamptz), `ddi_findings` (jsonb)
- `encounter_status` enum extended with `registered`, `at_triage`, `waiting_for_doctor`

### 6.3 Migration sequence

| Version | Name | Purpose |
|---|---|---|
| v9 | `users_role_column` | Rename `doctors` → `users`, add `role` |
| v10 | `encounter_status_extended` | Add three pre-doctor states to the enum |
| v11 | `opd_rooms` | New table + seed (OPD-1 → V, OPD-2 → Chandrika) |
| v12 | `encounter_room_intake_columns` | Add `room_id`, `intake_visit_reason`, `token_number` to encounters |
| v13 | `lab_orders_results` | Two new tables |
| v14 | `encounter_handoff_columns` | Add `handoff_note`, `handoff_ack_*` |
| v15 | `encounter_ddi_findings` | Add `ddi_findings` jsonb |

### 6.4 Out-of-band

A one-time backfill task seeds the existing 25 patients into `OPD-1 · Dr. V` (the only room they'd have been in). No data loss.

---

## 7. Build plan

### Phase v2.0 — OPD Choreography (foundational, ~3 weeks)

- **v2.0.1** — Migrations v9, v10, v11. Auth refactor (`getCurrentUser`, role middleware). Magic-link signup with invite tokens.
- **v2.0.2** — `/admin/rooms`, `/admin/users`. Seed OPD-1 + OPD-2.
- **v2.0.3** — `/reception` workstation. Register patient flow.
- **v2.0.4** — `/triage` workstation. Vitals capture with red-zone validation. BMI auto.
- **v2.0.5** — Doctor `/dashboard` evolutions (vitals tile, intake reason chip).
- **v2.0.6** — SSE infrastructure: `/api/queue/stream`, `useQueueLive` hook, `pg_notify` from every state-changing endpoint.
- **v2.0.7** — Lab dispatch panel on `/reception` (uses existing v1 paused_diagnostics flow).
- **v2.0.8** — Smoke + close. Tag `v2-0-shipped`.

### Phase v2.1 — Labs (~2 weeks)

- **v2.1.1** — Migration v13. `lab_orders` insert from Send-to-diagnostics modal with Qwen normalisation.
- **v2.1.2** — `/lab` workstation. PDF upload → Vercel Blob → OCR + Qwen extract pipeline.
- **v2.1.3** — Lab results display on `/patients/[id]` and `/dashboard/encounters/[id]`. Critical banner.
- **v2.1.4** — Sparkline trending on `/patients/[id]`.
- **v2.1.5** — Smoke + close. Tag `v2-1-shipped`.

### Phase v2.2 — Advanced AI (~2 weeks)

- **v2.2.1** — Voice query: mic button + `/api/internal/voice-query` + chat bubble in HistoryPanel.
- **v2.2.2** — Differential dx: on-demand button + side sheet.
- **v2.2.3** — Differential dx: pre-submit safety check in SubmitConfirmModal.
- **v2.2.4** — DDI: throttled background pass on Rx auto-save; pink/yellow severity banners.
- **v2.2.5** — Full provenance: "Why this suggestion?" popover wired on every AI output. Migration v15 (`ddi_findings`).
- **v2.2.6** — Smoke + close. Tag `v2-2-shipped`.

### Phase v2.3 — Multi-doctor (~1 week)

- **v2.3.1** — Migration v14. `handoff_note` field + pinned banner UX.
- **v2.3.2** — Author attribution sublines on every overridable surface (problem list, allergies, chips).
- **v2.3.3** — Re-open action on resolved problems. Smoke. Tag `v2-3-shipped`.

### Final ship

- **v2 close** — Carryover doc, demo-walkthrough doc rewrite, hardening checklist. Tag `opd-app-v2-shipped`.

**Total elapsed: 8-9 weeks.**

---

## 8. Production hardening / pre-pilot

- All v1 hardening items (DNS-verify `notifications.even.in`, Twilio creds, Meta WhatsApp template approval) remain.
- New: SSE connection budget — Vercel Pro allows ~1000 concurrent long-running functions; one per logged-in user is fine for EHRC scale (≤50 concurrent).
- New: Critical-value definitions — Qwen-driven today, codify per-test in a config file when we hit ≥3 false positives.
- New: PHI in voice query — Deepgram is HIPAA-compliant; Qwen runs on V's Mac Mini (no cloud LLM); audit log carries hashes only (PH.1 convention extends).
- New: Multi-doctor visibility carries an explicit medico-legal note in the doctor onboarding — all problem-list edits are visible to all doctors and audit-logged.

---

## 9. Open questions / deferred to v3+

| Item | Why deferred |
|---|---|
| **Patient portal** | Decided in Round 3 to defer. Reconsider when CCE/Nurse flows are stable. |
| **SMS critical-alerts + on-call pager** | v2 in-app banner is enough for clinic hours; after-hours wants a real pager. v2.5 candidate. |
| **Lab catalog table (structured)** | Free-text + Qwen is good enough now; revisit when we want billing integration or external lab interop. |
| **External lab integration (HL7 / FHIR)** | Out of scope. v3+. |
| **Voice-only encounter dictation end-to-end** | v1 has section dictation; full encounter via voice is its own design pass. |
| **Appointment booking** | Different problem; needs slot-management primitives. v3+. |
| **Billing / payment** | Lab orders carry `cost` implicitly via the canonical_key — but no actual billing surface in v2. |
| **Cross-hospital patient ID resolution** | When Even adds a second hospital, patient deduplication across MRNs. v3+. |

---

## 10. Change log

- **2026-05-18** — Document initialised. Rounds 1-6 complete; 24 decisions locked. Build sequence finalised as v2.0 → v2.3. PRD ready for V's start-v2.0 sign-off.

---

## Appendix A — Decision provenance

Each locked decision was raised as a multiple-choice question via the AskUserQuestion tool. The six rounds were:

- **Round 1** (4 decisions): scope shape, role auth, state machine, real-time
- **Round 2** (4 decisions): room model, mandatory vitals, day-of token, CCE-to-lab boundary
- **Round 3** (4 decisions): patient portal — all dropped
- **Round 4** (4 decisions): lab catalog source, order entry placement, result return path, critical alerts
- **Round 5** (4 decisions): voice query trigger, ddx trigger, DDI source, AI provenance visibility
- **Round 6** (4 decisions): multi-doctor visibility default, re-open flow, author attribution, handoff notes

Recommendations were made for each question. V accepted "Recommended" for 17 of 24, chose alternatives for 7. The most consequential alternative-pick:

- **Round 4 Q1**: "Free text + LLM normalization" over the recommended hand-curated catalog. This means we never build a `lab_tests` table; Qwen does all canonicalisation. Downside: no panel shortcuts, no autocomplete on order entry. Upside: zero setup overhead, lab catalog is implicitly discovered from doctor usage.
- **Round 4 Q3**: "Lab tech uploads PDF — OCR + LLM extract" over the recommended typed entry. Means no `/lab` typed-entry surface; lab tech only uploads. Faster for the lab tech, lower data quality. We may add typed-entry later if extraction error rate is too high.
- **Round 5 Q4**: "Full provenance — Based on encounters X, Y, Z" over the lighter "Violet dot only." Means every AI output needs a source-encounter list. Higher build cost, strongest medico-legal posture.

These three are the riskiest non-default picks. The PRD honors them; we'll revisit at each phase close if cost outweighs benefit.

---

**Awaiting V's sign-off to begin v2.0.1 (migrations + auth refactor).**
