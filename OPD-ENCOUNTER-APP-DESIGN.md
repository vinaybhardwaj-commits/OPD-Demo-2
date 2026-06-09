# OPD Encounter App — Design Doc

**Status:** Working draft (in active design)
**Author:** V (Vinay Bhardwaj), with design dialogue support
**Started:** 2026-05-17
**Codebase reuse target:** EHRC-Daily-Dash Huddle infrastructure

---

## 1. Product Framing

### Lead value
The lead value for the doctor is **prescription + disposition speed** — the fastest possible path from "patient walks in" to "prescription printed/delivered + disposition logged." Audio recording is optional context, not the deliverable. Audio is the means; the closed encounter is the end.

### Audience
Non-tech-savvy but highly process-oriented doctors. They reward consistency, density, and tactility. They punish surprises and free-text inputs where chips would do. They want to know exactly where they are in the workflow at all times.

### Quality bar
Extremely elegant, intuitive, easy to use. Single-screen workspace, persistent patient context, action chips not free-text, audit trail of where they are in the encounter visible at a glance.

### Coexistence with Pulse
Pulse is the existing OPD encounter management and ambulatory management system for the Even Hospital ecosystem. Pulse owns patient queue management, demographics, lab/pharmacy/admin integrations, and is a closed vendor product (SaaS, no API).

**Design assumption (per V's direction):** integration is handled by the Pulse team. The new app assumes the live queue is populated in real-time. The doctor sees a symbolically visualized queue of patients to pick from. The new app focuses on the doctor's encounter management choreography; Pulse handles everything else.

---

## 2. Choreography Model

### The verbs
The doctor's day reduces to eight verbs. The exam can interleave with any of them.

1. **Pick** — patient from queue → encounter opens
2. **Record** — ambient recording toggles on (optional)
3. **Document chief complaint** — chips, typing, or dictation
4. **Examine** — physical exam, findings captured via per-section mic, keyboard, or spoken aloud into the ambient stream
5. **Diagnose** — ICD-10 lookup or free text
6. **Prescribe** — drug rows (the hero feature)
7. **Dispose** — tap target (discharge / follow-up / refer / diagnostics / admit / vaccinate)
8. **Commit** — submit → PDF to patient + pharmacy via WhatsApp → encounter closes

Plus the pause/switch/resume choreography for handling multiple patients in parallel during one clinic session.

### The two recording streams
There are two distinct audio streams in an encounter, capturing different things at different granularities:

**Ambient encounter recording** — continuous Huddle-style capture of the whole conversation. Optional. Runs from "open encounter" to "submit & finish." Pauses when the encounter pauses, resumes when the doctor picks the patient back up. Source material for AI-drafted notes and durable record. Uses the existing Huddle `recording_session_id` infrastructure natively — each "snippet" of a split-resumed encounter is a new session against the same `encounter_id`.

**Per-section quick dictation** — short voice note (≤30s) scoped to a specific field. Doctor taps mic icon next to "Exam findings," speaks the finding, transcribed text lands in that field. Editable immediately. Every section gets one. Each is scoped, immediate, and editable.

These streams don't conflict because they answer different questions. Ambient = "what happened in the room." Per-section = "what the doctor wants stored in this specific field, right now."

### Pause / switch / resume
At any moment during an encounter, the doctor can pause the current patient (typically to send them for diagnostics) and switch to another waiting patient. Multiple paused encounters can exist simultaneously. When a previously-paused patient is ready (returned from diagnostics), they appear in the queue in a "Ready to resume" state. Tapping them restores the full encounter context.

---

## 3. Design Moments

All five doctor-facing design moments are settled:

1. **The queue at rest** — symbolically visualized live queue with state segregation ✅
2. **The pick → encounter transition** — implicit; tapping a queue card opens the encounter screen ✅
3. **The pause / switch / resume choreography** — send-to-diagnostics flow with `recording_session_id` snippet pattern ✅
4. **The prescription compose flow** — drug rows with three input modes + formulary-driven additions ✅
5. **The commit moment** — confirmation modal, async dispatch, success state, auto-transition ✅

Plus one admin-facing tool:
- **Smart Defaults Review UI** — swipe-style Qwen-draft review for V to populate `drug_defaults` for ~500 OPD drugs ✅

---

## 4. Screens (designed so far)

### 4.1 Queue (home state) — DESIGNED

States visible in the queue, each in its own visual register:
- **Ready to resume** (green) — patient returned from diagnostics, awaiting doctor. Top priority, draws the eye first.
- **Waiting** (neutral white) — default queue, hasn't seen doctor yet.
- **At diagnostics** (amber) — patient sent for tests, awaiting return.
- **Completed** (dim gray) — finished today, archive view.

Header bar shows: doctor name, location, date, "X of Y seen today," current time.

Each patient card shows: name, age/sex, brief context (chief complaint chip or diagnostic test name or arrival time).

The doctor's eye lands on green first by design. That's the next thing they should do.

### 4.2 Active encounter screen — DESIGNED

Single-column workspace. Patient banner at top with encounter timer and ambient recording indicator. Then stacked sections, each independently editable:

1. **Chief complaint** — chips + dictate mic
2. **Exam findings** (visually highlighted as new) — text + prominent dictate mic
3. **Assessment** — ICD-10 lookup chips + dictate mic
4. **Prescription** — drug rows + dictate mic
5. **Disposition** — five tap-target buttons (discharge / follow-up / refer / diagnostics / admit)

Bottom action bar: Pause | Send to diagnostics | Submit & finish

### 4.3 Send-to-diagnostics modal — DESIGNED

Triggered when doctor taps "Send to diagnostics" in the encounter screen action bar. Modal overlay on top of the encounter screen. Contains:

- **Header:** "Send [patient name] for diagnostics" + subtitle clarifying the queue behavior ("returns as Ready to resume when done")
- **Test selector grid:** auto-fit tap targets for common tests (Chest x-ray, ECG, USG abdomen, Echo, Blood CBC, Urine routine, More tests). Each test is a button with a Tabler icon. Selected state uses info background.
- **Optional notes field:** textarea with placeholder ("e.g., rule out consolidation, urgent read") and an embedded Dictate mic button at top-right of the textarea for voice-entry of instructions.
- **Actions:** Cancel | Send & pause encounter

**On confirm, four things happen in sequence:**
1. Modal closes
2. Ambient recording snippet 1 finalizes (uploads pending chunks, persists `recording_session_id_1` against `encounter_id`)
3. Encounter row updates: `status='paused'`, `paused_reason='diagnostics'`, `pending_diagnostic='Chest x-ray'`
4. Screen returns to queue; patient card moves to "At diagnostics" column with the test name + time-since-sent

The diagnostic order itself flows through Pulse (assumed integration). The new app emits an event for Pulse to consume; Pulse handles the actual ordering. When the patient comes back, Pulse signals the app, which flips the queue card to "Ready to resume" (green).

### 4.4 Resume — DESIGNED (described, no separate mockup)

Doctor taps a "Ready to resume" card in the queue. Encounter screen reopens with all prior section content preserved exactly as it was. A subtle banner appears just below the patient banner:

> `Resumed · [N] min at diagnostics · [Test name] result available in Pulse`

Ambient recording starts a new snippet: `recording_session_id_2` against the same `encounter_id`. The snippet indicator on the recording badge increments to "snippet 2."

The doctor reads the diagnostic result in Pulse (separate window), returns to the new app, taps "Quick dictate" on Exam findings to add the result note (e.g., "CXR clear, no consolidation"). Continues normally to assessment, prescription, disposition, submit.

**Delta from initial encounter screen:** only the resume banner + the incremented snippet indicator. Otherwise identical UI.

### 4.5 Prescription compose flow — DESIGNED

**Core insight:** the unit is the drug row. Speed comes from making the common-case completed row take **one tap**, with overrides taking 2-3 extra taps when needed.

**Visual structure:** the prescription section header shows medication count and a Dictate button (for whole-section voice input). Below it, drug rows stack vertically. Each row has:

- **Head:** pill icon + drug name + strength (left), remove X (right)
- **Body:** either a one-line summary string (at-rest state) or chip groups (mid-edit state)
- **Active indicator:** blue border when the row is being edited

**Chip groups per drug row:**
- "how often" — OD / BD / TDS / QID / SOS / HS / Custom
- "how long" — 3d / 5d / 7d / 10d / 14d / 1mo / Custom
- "timing" — Before meals / After meals / Empty stomach / At bedtime / With water / Custom
- "instructions" — free-text (optional, for things like "for fever (SOS)")

**Collapse/expand pattern:** at rest, each chip group shows only the selected chip (visually quiet). When the doctor taps a chip, the group expands to show all alternatives inline. Tapping a new alternative collapses the group again. Other chip groups on the same row stay collapsed unless tapped. This keeps the row dense but every field reachable in one tap.

**Three input patterns** (used interchangeably):

1. **Type-and-pick** (primary): tap "Add drug" → type 3+ chars → typeahead shows top 5 drug matches (name + strength + form) → tap one. Smart defaults apply automatically. Row completes.
2. **Dictate the whole row**: tap section Dictate mic → speak *"amoxicillin five hundred TDS five days after meals"* → on-prem Qwen parses into structured fields → row created with chips populated. Doctor reviews and corrects.
3. **Override-a-chip**: tap any chip on any row → alternatives expand inline → tap new selection → collapses back.

**Smart defaults:** for each drug in the master, the most common prescribing pattern is stored (frequency + duration + timing + instructions). When a drug is selected, defaults pre-apply and the row appears complete. Doctor only edits when their case differs from the default. Defaults are hardcoded for v1 (top ~300 drugs); doctor-personalized defaults are a Phase 2 feature.

**Deliberately excluded from v1:**
- Drug interaction warnings (no patient allergy history without Pulse integration)
- Dose calculators (need patient context we don't have)
- Refills (Indian OPD doesn't model refills the way Western EMRs do)
- Quantity-to-dispense (pharmacy calculates from frequency × duration)

### Formulary-driven additions (post-formulary-decision, 2026-05-17)

With the Even Hospital Pharmacy Formulary 2026 as the master, three formulary-driven affordances get added to each drug row:

**Schedule chip** — small character chip showing OTC/H/H1/X. Schedule H1 visible but unobtrusive. Schedule X (narcotic/psychotropic — 11 items) gets red treatment and a required double-confirm before adding to the prescription.

**LASA confirmation strip** — appears once just below a newly added drug if the formulary has LASA alternates for it. Format: `You picked [drug]. Sound-alike: [alt1], [alt2]. Confirm or swap.` Tap confirm to dismiss; tap an alternate to swap the row. ISMP/NABH-recommended cognitive checkpoint that most EMRs skip.

**Risk profile indicator** — subtle warning icon next to drug names for the 326 ISMP high-alert medications (insulins, anticoagulants, opioids, paralytics, concentrated electrolytes, chemo, IV anaesthetics). Visual cue to slow down.

These are additive decorations to the existing row structure — no architectural change.

### Search behavior

Typeahead searches both `brand_name` and `generic_name` fields simultaneously. Doctor types "calpol" or "paracetamol" — both hit the Calpol 500mg row. Results display: `Brand · Generic · Dosage Form + Strength`. The Item Code (M-N-PH-XXXX) is the row identity but not surfaced to the doctor.

### Smart defaults source

The formulary does not carry default dose/frequency/duration per drug — these need a separate table. v1 approach:
1. Qwen (self-hosted) drafts default `frequency × duration × timing × instructions` for the top ~500 OPD-relevant drugs from the formulary based on generic name + therapeutic class
2. V reviews and approves/edits each
3. Stored as `drug_defaults` table keyed on `item_code`
4. Doctor's per-encounter overrides are tracked separately (eventually feed Phase 2 personalized defaults)

### 4.6 Commit / submission — DESIGNED

The submit moment is six small phases happening in sequence:

**1. Validation gate.** Disposition is the only required field; "Submit & finish" is dimmed until one is selected. Everything else is a soft warning at submit time, not a block. Doctors who want to submit a minimal record should be able to.

**2. Confirmation modal.** A digestible preview the doctor scans in 2-3 seconds. Contains:
- Patient name + age/sex + MRN + WhatsApp number on file
- Diagnosis chip (with ICD code)
- Prescription summary (one line per drug: name + strength · frequency · duration · instructions)
- Disposition chip
- Recipients banner (patient + pharmacy, both via WhatsApp)
- Two buttons: Cancel | Confirm & send

Rationale for modal over optimistic-with-undo: sending a prescription is the one encounter moment where a mistake costs real time and embarrassment to recover. Explicit cognitive checkpoint outweighs the speed gain of optimistic submit.

**3. Async dispatch.** Six things happen in parallel after confirm:
- Encounter status flips to `completed`, `completed_at` set to NOW()
- Ambient recording snippet finalizes; Deepgram transcription kicks off async
- PDF generated server-side (hospital letterhead + doctor MCI number + patient details + prescription table + disposition + QR code + Schedule X license number if applicable)
- Patient WhatsApp dispatched via Twilio (Meta-approved template)
- Pharmacy WhatsApp dispatched via Twilio (Meta-approved template, more compact format)
- Audit log row written
- Event emitted for Pulse to consume

**4. Brief success state.** ~1.5 seconds of full-width feedback: check icon + patient name + "sent to patient & pharmacy." Registers closure before the next encounter.

**5. Auto-transition to queue.** Patient card moves from "In room" to "Completed." Next "Ready to resume" or "Waiting" patient is naturally highlighted as next-up.

**6. Async record finalization.** Transcript becomes available within 5-30s, attaches to the encounter. Doctor doesn't wait. All artifacts (audio, transcript, structured fields, prescription, disposition) bound to `encounter_id` become the durable chart entry.

### Failure handling

- **Patient WhatsApp fails** (invalid number, opted out): small warning chip on the completed-card, doctor retries or hands off to admin. Non-blocking.
- **Pharmacy WhatsApp fails** (critical — patient can't get meds): immediate notification to fallback channel (admin Slack/SMS) for human follow-up within minutes.
- **PDF generation fails**: retry, then fall back to plain-text prescription content in WhatsApp message body (no attachment) as last resort.
- **Network offline at submit**: encounter saves locally via existing IndexedDB offline queue (reused from Huddle infra). Dispatch happens when network returns.

The doctor is never blocked by delivery failure. The encounter closes the moment they confirm.

### Meta WhatsApp template approval

Two templates need to be registered with Meta before go-live (typically 24-48 hr approval):

1. **Patient prescription template** — `"Hi [Name], your prescription from Dr. [Doctor] dated [Date] is attached. Follow-up: [Disposition]. For queries, call [Hospital]. — Even Hospital"` + PDF attachment
2. **Pharmacy prescription template** — `"Rx for [Patient] (Age, MRN), Dr. [Doctor]. [N] meds. Schedule: [H1/X notes if any]."` + PDF attachment

Worth queuing the approval now in parallel with the build.

### Deferred to v2

- Print fallback for doctors who want paper too
- SMS-with-PDF-link for patients without WhatsApp
- Family-member proxy WhatsApp (common in India)
- Multiple patient phone numbers
- Email delivery as additional channel
- Prescription verification page (QR code scan target)

---

## 4A. Admin tooling

### Smart Defaults Review UI — DESIGNED

Separate admin tool for V to bulk-approve Qwen-drafted prescribing defaults for the formulary. Lives at `/admin/drug-defaults/review`, gated to admin users.

**Three-phase pipeline:**

1. **Filter** — query the 2,174-item formulary, exclude items where `dept_primary` is in (Anaesthesia, OT, Critical Care, Oncology, Chemotherapy, Emergency) and `dosage_form` is not in (Tablet, Capsule, Syrup, Drops, Cream, Spray, Ointment, Eye/Ear Drops). Outputs ~500 OPD-relevant candidates.
2. **Draft** — for each candidate, send formulary metadata to self-hosted Qwen with a prompt framing it as a clinical pharmacist drafting *primary-care OPD* defaults. Qwen returns structured JSON (frequency, duration_days, timing, instructions, route, confidence, reasoning). Stored in `drug_defaults_drafts` table.
3. **Review** — V opens the swipe-style review UI, sees one drug at a time with Qwen's chips pre-selected and reasoning visible. Three actions per card: Approve / Edit a chip / Skip. Approved entries land in `drug_defaults` keyed by `item_code`. Skipped drugs remain in typeahead but compose flow won't pre-fill them.

**Review UI design:**
- One drug card per screen
- Drug header: brand name + generic + chips for schedule, therapeutic class, form/strength
- Per field (frequency, duration, timing, instructions): chip group with Qwen's selection pre-filled. Same chip patterns as the compose UI.
- Qwen's reasoning visible below in italic with a sparkle icon
- Confidence badge shown next to the first chip group
- Three action buttons at bottom: Skip / Edit a chip / Approve
- Progress bar at top showing N of 500

**Auto-approve policy:**
First-batch policy: no auto-approve. V reviews every draft to calibrate Qwen's output quality. After first batch, future drug additions can auto-approve on `confidence == "high"`.

**Time budget:**
- Qwen drafting: ~15-30 min of compute (free, self-hosted)
- V review: 2-3 hours total at ~15-20 sec average per drug, splittable into 2-3 sessions
- Build effort: ~3 days (filter script + Qwen pipeline + review UI + production wiring)

**Override learning loop (Phase 2):**
Every doctor override in actual use (where they change a default chip) gets logged to `drug_default_overrides` (item_code, doctor_id, original_value, new_value, encounter_id, timestamp). When override rate for a default crosses a threshold (e.g., >40% of uses), V gets a notification to revisit that default. Long-term, per-doctor personalized defaults become possible.

---

## 5. Pause / Resume Choreography

### Two flavors of pause

**Send for diagnostics** — the dominant case. Patient leaves the room for a test. Encounter pauses, ambient recording snippet ends, queue moves the patient to "At diagnostics" with the test name attached. When patient returns, card flips to "Ready to resume" (green). Tapping resumes everything.

**Step away** — less common. Doctor is interrupted by a colleague, wants to look something up in Pulse, takes a brief break. The patient stays put; the encounter just suspends.

### Design decision: how many explicit pause actions?
**RESOLVED 2026-05-17 — Option 1 (one action only).**

Only "Send to diagnostics" is an explicit pause action. Step-aways are handled implicitly: the doctor can navigate back to the queue mid-encounter, the encounter auto-saves, and the patient stays in their current queue state until the doctor either picks them back up or sends them somewhere else. This keeps the action bar simple and avoids creating decision points for what should be a near-invisible state transition.

Rationale: the dominant pause case in real OPD is diagnostics. Step-aways are rare and don't need formal capture in v1. If patterns emerge that demand more pause types, they can be added later.

### State transitions

Encounter lifecycle states:
- `active` — currently with the doctor (one at a time)
- `paused_diagnostics` — patient sent for a test, awaiting return
- `paused_other` — (only if multi-pause is approved) patient on hold for non-test reason
- `ready_to_resume` — patient returned from diagnostics, awaiting doctor's pick
- `completed` — submitted, prescription out, encounter closed

Queue state mirrors encounter state, with the doctor's view organized by what's actionable:
- "Ready to resume" surfaces first (green, action required)
- "Waiting" next (neutral, default queue)
- "At diagnostics" (amber, in progress elsewhere)
- "Completed" (dim, archive)

### Recording snippet model

The ambient recording is composed of one or more snippets, each with its own `recording_session_id`, all linked to the same `encounter_id`:

- `encounter_id` = the unit the doctor thinks about (one patient, one visit)
- `recording_session_id` = the unit the recording engine produces (one continuous capture between start and stop)

A simple encounter has 1 snippet. A diagnostics-paused encounter has 2 snippets (before and after the test). A doubly-paused encounter could have 3+. The Huddle codebase's transcription pipeline already supports multi-session encounters via the re-mux fallback path documented in the original PRD — no new infrastructure needed.

---

## 6. Data Model

Fifteen tables organized into five domains. Postgres 15+, Neon-compatible.

### Domain map

- **Identity** — `patients`, `doctors`. Thin local cache; Pulse owns canonical patient identity.
- **Encounter core** — `encounters`. The central table; everything else hangs off it.
- **Recording** — `encounter_recordings`, `encounter_recording_chunks`, `section_dictations`. Huddle-pattern reuse.
- **Drug + prescription** — `drug_master`, `drug_defaults`, `drug_defaults_drafts`, `drug_default_overrides`, `prescriptions`, `prescription_lines`.
- **Integration & audit** — `audit_log`, `pulse_events`, `outbound_events`.

### Full DDL

```sql
-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enums
CREATE TYPE encounter_status AS ENUM ('active','paused_diagnostics','ready_to_resume','completed','abandoned');
CREATE TYPE disposition_kind AS ENUM ('discharge','follow_up','refer','diagnostics','admit','vaccinate');
CREATE TYPE drug_schedule AS ENUM ('OTC','H','H1','X','G','K','Biological');
CREATE TYPE ved_tier AS ENUM ('V','E','D');
CREATE TYPE transcription_status AS ENUM ('pending','transcribing','complete','failed');
CREATE TYPE whatsapp_delivery_status AS ENUM ('queued','sent','delivered','failed','undeliverable');
CREATE TYPE drug_default_source AS ENUM ('hardcoded','qwen_drafted','v_approved','learned');
CREATE TYPE confidence_level AS ENUM ('high','medium','low');
CREATE TYPE encounter_section AS ENUM ('chief_complaint','exam_findings','assessment','prescription','disposition_notes');
CREATE TYPE pulse_event_kind AS ENUM ('patient_arrived','patient_registered','diagnostic_ordered','diagnostic_completed','patient_left','patient_updated');
CREATE TYPE outbound_event_kind AS ENUM ('encounter_started','encounter_paused','encounter_resumed','encounter_completed','prescription_issued');

-- Identity
CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mrn TEXT NOT NULL UNIQUE,
  pulse_patient_id TEXT UNIQUE,
  name TEXT NOT NULL,
  date_of_birth DATE,
  age_years INT,
  sex CHAR(1) CHECK (sex IN ('M','F','O')),
  phone_e164 TEXT,
  whatsapp_opt_in BOOLEAN DEFAULT TRUE,
  known_allergies TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_patients_mrn ON patients(mrn) WHERE deleted_at IS NULL;
CREATE INDEX idx_patients_pulse_id ON patients(pulse_patient_id) WHERE pulse_patient_id IS NOT NULL;

CREATE TABLE doctors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  qualification TEXT,
  mci_registration_number TEXT NOT NULL,
  specialty TEXT,
  signature_blob_url TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Drug master + defaults
CREATE TABLE drug_master (
  item_code TEXT PRIMARY KEY,
  brand_name TEXT NOT NULL,
  generic_name TEXT NOT NULL,
  dosage_form TEXT NOT NULL,
  strength TEXT,
  major_grouping TEXT NOT NULL,
  minor_grouping TEXT,
  manufacturer TEXT,
  schedule_dc drug_schedule NOT NULL,
  schedule_ip TEXT,
  dept_primary TEXT NOT NULL,
  dept_secondary TEXT,
  is_high_risk BOOLEAN NOT NULL DEFAULT FALSE,
  lasa_alternates TEXT[],
  ved_tier ved_tier NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source_sheet_row INT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_drug_master_brand_trgm ON drug_master USING gin (brand_name gin_trgm_ops);
CREATE INDEX idx_drug_master_generic_trgm ON drug_master USING gin (generic_name gin_trgm_ops);
CREATE INDEX idx_drug_master_dept ON drug_master(dept_primary) WHERE active;
CREATE INDEX idx_drug_master_schedule ON drug_master(schedule_dc) WHERE active;

CREATE TABLE drug_defaults_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_code TEXT NOT NULL REFERENCES drug_master(item_code),
  draft_payload JSONB NOT NULL,
  qwen_reasoning TEXT,
  qwen_confidence confidence_level,
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending','approved','edited','skipped')),
  reviewed_by UUID REFERENCES doctors(id),
  reviewed_at TIMESTAMPTZ,
  final_payload JSONB,
  drafted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (item_code)
);

CREATE TABLE drug_defaults (
  item_code TEXT PRIMARY KEY REFERENCES drug_master(item_code),
  default_frequency TEXT NOT NULL,
  default_duration_days INT,
  default_timing TEXT,
  default_instructions TEXT,
  default_route TEXT NOT NULL DEFAULT 'oral',
  source drug_default_source NOT NULL,
  confidence confidence_level NOT NULL,
  approved_by UUID REFERENCES doctors(id),
  approved_at TIMESTAMPTZ,
  qwen_reasoning TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Encounters
CREATE TABLE encounters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_number TEXT NOT NULL UNIQUE,
  patient_id UUID NOT NULL REFERENCES patients(id),
  doctor_id UUID NOT NULL REFERENCES doctors(id),
  encounter_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status encounter_status NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paused_at TIMESTAMPTZ,
  resumed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  total_duration_seconds INT,
  paused_reason TEXT,
  pending_diagnostic_test TEXT,
  pending_diagnostic_notes TEXT,
  chief_complaint_chips TEXT[],
  chief_complaint_text TEXT,
  vitals JSONB,
  exam_findings TEXT,
  assessment_codes TEXT[],
  assessment_text TEXT,
  disposition disposition_kind,
  follow_up_days INT,
  referral_target TEXT,
  diagnostic_orders JSONB,
  admit_target TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_encounters_doctor_date ON encounters(doctor_id, encounter_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_encounters_patient ON encounters(patient_id, encounter_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_encounters_status ON encounters(status) WHERE status != 'completed' AND deleted_at IS NULL;

-- Recordings (Huddle pattern reuse)
CREATE TABLE encounter_recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES encounters(id),
  recording_session_id UUID NOT NULL,
  snippet_index INT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_seconds INT,
  audio_blob_prefix TEXT,
  chunk_count INT NOT NULL DEFAULT 0,
  bytes_total BIGINT,
  transcript_status transcription_status NOT NULL DEFAULT 'pending',
  transcript_text TEXT,
  transcript_segments JSONB,
  speaker_map JSONB,
  transcribed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (encounter_id, snippet_index)
);
CREATE INDEX idx_recordings_encounter ON encounter_recordings(encounter_id);
CREATE INDEX idx_recordings_session ON encounter_recordings(recording_session_id);

CREATE TABLE encounter_recording_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id UUID NOT NULL REFERENCES encounter_recordings(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  blob_url TEXT NOT NULL,
  bytes INT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'audio/webm',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (recording_id, chunk_index)
);
CREATE INDEX idx_chunks_recording ON encounter_recording_chunks(recording_id, chunk_index);

CREATE TABLE section_dictations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES encounters(id),
  section encounter_section NOT NULL,
  audio_blob_url TEXT NOT NULL,
  duration_seconds INT NOT NULL,
  transcript_text TEXT,
  transcript_status transcription_status NOT NULL DEFAULT 'pending',
  transcribed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_dictations_encounter ON section_dictations(encounter_id, section);

-- Prescriptions
CREATE TABLE prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES encounters(id) UNIQUE,
  prescription_number TEXT NOT NULL UNIQUE,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pdf_blob_url TEXT,
  patient_whatsapp_status whatsapp_delivery_status NOT NULL DEFAULT 'queued',
  patient_whatsapp_message_sid TEXT,
  patient_whatsapp_attempted_at TIMESTAMPTZ,
  patient_whatsapp_delivered_at TIMESTAMPTZ,
  patient_whatsapp_error TEXT,
  pharmacy_whatsapp_status whatsapp_delivery_status NOT NULL DEFAULT 'queued',
  pharmacy_whatsapp_message_sid TEXT,
  pharmacy_whatsapp_attempted_at TIMESTAMPTZ,
  pharmacy_whatsapp_delivered_at TIMESTAMPTZ,
  pharmacy_whatsapp_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_prescriptions_number ON prescriptions(prescription_number);
CREATE INDEX idx_prescriptions_patient_status ON prescriptions(patient_whatsapp_status) WHERE patient_whatsapp_status IN ('queued','failed');
CREATE INDEX idx_prescriptions_pharmacy_status ON prescriptions(pharmacy_whatsapp_status) WHERE pharmacy_whatsapp_status IN ('queued','failed');

CREATE TABLE prescription_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  line_order INT NOT NULL,
  item_code TEXT NOT NULL REFERENCES drug_master(item_code),
  drug_name_snapshot TEXT NOT NULL,
  generic_snapshot TEXT NOT NULL,
  strength_snapshot TEXT,
  schedule_snapshot drug_schedule NOT NULL,
  is_high_risk_snapshot BOOLEAN NOT NULL,
  frequency TEXT NOT NULL,
  duration_days INT,
  timing TEXT,
  instructions TEXT,
  route TEXT NOT NULL DEFAULT 'oral',
  lasa_warning_shown BOOLEAN NOT NULL DEFAULT FALSE,
  lasa_confirmed_by_doctor BOOLEAN,
  input_source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (prescription_id, line_order)
);
CREATE INDEX idx_rx_lines_prescription ON prescription_lines(prescription_id, line_order);
CREATE INDEX idx_rx_lines_item ON prescription_lines(item_code);

CREATE TABLE drug_default_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES encounters(id),
  doctor_id UUID NOT NULL REFERENCES doctors(id),
  item_code TEXT NOT NULL REFERENCES drug_master(item_code),
  field_changed TEXT NOT NULL,
  original_value TEXT,
  new_value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_overrides_drug ON drug_default_overrides(item_code, created_at DESC);
CREATE INDEX idx_overrides_doctor ON drug_default_overrides(doctor_id, item_code);

-- Audit & Integration
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID REFERENCES doctors(id),
  encounter_id UUID REFERENCES encounters(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id UUID,
  metadata JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_doctor_time ON audit_log(doctor_id, created_at DESC);
CREATE INDEX idx_audit_encounter ON audit_log(encounter_id, created_at);
CREATE INDEX idx_audit_action ON audit_log(action, created_at DESC);

CREATE TABLE pulse_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type pulse_event_kind NOT NULL,
  patient_pulse_id TEXT,
  patient_id UUID REFERENCES patients(id),
  encounter_id UUID REFERENCES encounters(id),
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  process_status TEXT NOT NULL DEFAULT 'received'
    CHECK (process_status IN ('received','processed','failed')),
  process_error TEXT
);
CREATE INDEX idx_pulse_events_pending ON pulse_events(process_status, received_at) WHERE process_status = 'received';
CREATE INDEX idx_pulse_events_patient ON pulse_events(patient_pulse_id, received_at DESC);

CREATE TABLE outbound_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type outbound_event_kind NOT NULL,
  encounter_id UUID NOT NULL REFERENCES encounters(id),
  payload JSONB NOT NULL,
  emitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','emitted','acknowledged','failed')),
  retry_count INT NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX idx_outbound_pending ON outbound_events(status, emitted_at) WHERE status IN ('pending','emitted');
CREATE INDEX idx_outbound_encounter ON outbound_events(encounter_id);

-- updated_at triggers
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_patients_updated BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_doctors_updated BEFORE UPDATE ON doctors FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_drug_master_updated BEFORE UPDATE ON drug_master FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_drug_defaults_updated BEFORE UPDATE ON drug_defaults FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_encounters_updated BEFORE UPDATE ON encounters FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_recordings_updated BEFORE UPDATE ON encounter_recordings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_prescriptions_updated BEFORE UPDATE ON prescriptions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
```

### Index strategy notes

- **Trigram GIN indexes** on drug brand/generic names enable sub-millisecond fuzzy typeahead on the 2,174-row formulary
- **Partial indexes** for queue/status lookups where >95% of rows are in a non-interesting state (completed prescriptions, etc.)
- **Composite indexes** on (doctor_id, encounter_date) and (patient_id, encounter_date DESC) cover the hot read paths
- **No cascading deletes** except where data is tightly coupled (prescription_lines, recording_chunks). Everything else soft-deletes via `deleted_at`
- **Audit log entries are never deleted**, period

### Snapshots on prescription_lines

`drug_name_snapshot`, `schedule_snapshot`, `is_high_risk_snapshot` are intentional denormalizations. When the formulary updates, prescriptions issued in the past must remain accurate — without snapshots, an updated drug name in `drug_master` would silently rewrite history on the prescription record. The few extra columns make prescriptions immutable in display.

### Migration sequencing

| # | Tables added | Reason for order |
|---|--------------|------------------|
| v1 | enums, extensions, `patients`, `doctors`, `drug_master` | Zero-dependency foundation |
| v2 | `encounters` | Depends on patients + doctors |
| v3 | `encounter_recordings`, `encounter_recording_chunks`, `section_dictations` | Depends on encounters |
| v4 | `drug_defaults_drafts`, `drug_defaults` | Parallelizable with v2/v3 |
| v5 | `prescriptions`, `prescription_lines`, `drug_default_overrides` | Depends on encounters + drug_master |
| v6 | `audit_log` | Independent |
| v7 | `pulse_events`, `outbound_events` | Pulse integration layer |
| v8 | triggers (`touch_updated_at`) | After all tables exist |

### Open decisions

- **`vitals` as JSONB vs separate `encounter_vitals` table** — JSONB for v1 simplicity; break out if vitals trending becomes a requirement
- **`assessment_codes` as TEXT[] vs `encounter_diagnoses` table** — array works for v1 (1-3 diagnoses typical); separate table if you need per-diagnosis metadata
- **`age_years` as denormalized** — accommodates patients entered with full DOB *or* just age; minor redundancy
- **No `pharmacy` table in v1** — pharmacy is currently a phone number in env config. v2 adds a `pharmacies` table when the pharmacy app is built.

## 6A. Demo-Only Simplified Schema

A trimmed version of the production schema for getting a sandbox demo running fast. **Not production-shaped.** Migration from this lean schema to the full production schema is additive — every table here exists in the production schema with extra columns added.

### What's stripped

- `audit_log` — no medical-legal trail in demo
- `pulse_events`, `outbound_events` — Pulse integration mocked via admin buttons
- `drug_defaults_drafts`, `drug_default_overrides` — defaults seeded directly, no learning loop
- All `deleted_at` soft-delete columns — hard deletes only
- Snapshot columns on `prescription_lines` (formulary stable during demo, lines become JSONB on `prescriptions`)
- Granular WhatsApp tracking — compressed to `patient_sent_at` and `pharmacy_sent_at`
- Most enums compressed to TEXT for mid-demo flexibility
- All updated_at triggers — manual handling in app code

### What's kept

- Full doctor-facing choreography (queue → encounter → pause → resume → submit)
- Real recording infrastructure with Huddle's `recording_session_id` pattern for split/resume
- Real prescription generation
- Real drug master with formulary fidelity
- Smart defaults (folded into `drug_master` as columns)

### The lean schema — 8 tables, 4 enums, ~5 indexes

See `/outputs/opd-encounter-schema-demo.sql` for the full DDL. Tables:

1. `patients`
2. `doctors`
3. `drug_master` (with `default_frequency`, `default_duration_days`, `default_timing`, `default_instructions` folded in)
4. `encounters`
5. `encounter_recordings`
6. `encounter_recording_chunks`
7. `section_dictations`
8. `prescriptions` (with lines as JSONB array)

### Demo support requirements (beyond the schema)

A working demo needs more than tables. Plan to also build:

- **Seed data script** — ~5 doctors, ~25-30 patients spread across queue states, ~50 curated drugs with defaults populated. Wipes and re-populates the DB between demo sessions.
- **Admin demo-control panel** at `/admin/demo-controls` — buttons to advance patient state ("Patient X arrived," "Y's CXR ready"). Replaces Pulse integration events.
- **Twilio sandbox mode** — env flag `DEMO_MODE=true` intercepts Twilio calls and logs would-be sends instead of dispatching. Real PDF generation, fake WhatsApp delivery. Flip the flag to go to production-real.
- **Real Deepgram, real PDF** — the demo wow factor is the *real* pipeline working, just contained.

### Honest tradeoffs

- No audit trail
- No formulary immutability (changes rewrite past prescriptions)
- No real Pulse integration (admin-driven)
- No retry orchestration for failed deliveries
- Limited drug coverage in defaults (~50 vs 500)

Acceptable for sandbox. Not acceptable for real clinical use.

---

## 7. Reuse Plan

### From EHRC-Daily-Dash Huddle codebase
- `src/lib/huddle/offline-queue.ts` — IndexedDB offline queue, exponential backoff
- `src/lib/storage.ts` — Vercel Blob wrappers
- `src/app/api/huddle/[id]/chunk/route.ts` — chunked audio upload
- `src/app/api/huddle/[id]/transcribe/route.ts` — Deepgram transcription pipeline
- `src/app/api/huddle/[id]/audio/route.ts` — on-demand audio streaming
- `src/components/huddle/*` — recording UI components
- `recording_session_id` pattern — for the split-encounter audio

### New for OPD Doctor App
- Encounter data model and lifecycle
- Patient identification (from Pulse queue — assumed integration)
- Drug master (source TBD when prescription compose is designed)
- ICD-10 lookup (could use public ICD-10 MCP)
- PDF prescription generation (`pdf-lib` or ReportLab)
- WhatsApp delivery via Twilio (already a dependency in EHRC-Daily-Dash)
- The encounter screen UI, queue UI, prescription composer UI
- Pause/switch/resume orchestration

### Tech stack (presumed, matching the Huddle codebase)
- Next.js 15, TypeScript, Tailwind v4
- Neon Postgres
- Vercel Blob (audio + PDF)
- Twilio (WhatsApp delivery)
- Deepgram (transcription)
- Self-hosted Qwen via Cloudflare Tunnel (AI summarization, on-prem PHI)
- Resend (email fallback)

---

## 8. Build Plan

Nine sprints, approximately **5-7 weeks elapsed** with Claude Code building in parallel sessions. Each sprint is a discrete deliverable that ships, ends with a bug sweep, and unblocks the next.

### Sprint sequence

| # | Sprint | Days | Scope | Deliverable |
|---|--------|------|-------|-------------|
| 0 | Foundation | 3-5 | New Next.js 15 repo, Tailwind + Even palette, Neon DB project, Vercel deploys, Resend magic-link auth, demo schema migration v1 | Deployed empty app with doctor login |
| 1 | Drug master + typeahead | 3-4 | Formulary import script (Drive sheet via `Google Drive:read_file_content`), trigram indexes, `/api/drugs/search`, reusable typeahead component | Working drug typeahead with 2,174 items |
| 2 | Queue + encounter lifecycle | 4-5 | Patient seed, visualized queue, encounter start/save/complete, queue state management, `/admin/demo-controls` panel | Doctor picks from queue, opens and completes encounter (no Rx or recording yet) |
| 3 | Encounter screen + documentation | 4-5 | Encounter screen UI (CC chips, exam findings, assessment, vitals, ICD-10 search), section dictation infrastructure | Doctor fills all documentation sections |
| 4 | Prescription compose | 5-6 | Drug row component, multi-drug, LASA confirmation strip, schedule + risk indicators, defaults application, JSONB lines storage | Multi-drug prescriptions composed in seconds |
| 5 | Recording infrastructure | 5-6 | Huddle-codebase reuse (offline queue, chunk upload, audio streaming, Deepgram + diarization, big red record button) | Real audio capture with real transcription |
| 6 | Pause/resume choreography | 3-4 | Send-to-diagnostics modal, status transitions, queue card animations, resume banner, multi-snippet recording | Full split-encounter flow end-to-end |
| 7 | Commit/submit + dispatch | 4-5 | Confirmation modal, PDF generation with hospital letterhead, Twilio WhatsApp dispatch (sandbox mode), success state | Real PDFs going out via WhatsApp |
| 8 | Polish + demo prep | 3-4 | Edge cases, loading states, error handling, seed script, reset capability, demo walkthrough | Demo-ready, dogfood-ready app |

**Parallel track — Smart defaults pipeline** (3 days, runs alongside Sprint 4 or 5):
- Formulary filter to OPD subset
- Qwen draft generation
- Swipe-style review UI at `/admin/drug-defaults/review`
- `drug_master` defaults populated from approved entries
- Plus 2-3 hours of V's review time

### Reuse from Huddle codebase

**Direct lift (rename + minor adaptation):**
- `src/lib/huddle/offline-queue.ts` → `src/lib/recordings/offline-queue.ts`
- `src/lib/storage.ts` (full lift, change blob path prefixes only)
- `src/lib/huddle/speaker-identifier.ts` → simplify for 2-speaker case
- `src/app/api/huddle/[id]/chunk/route.ts` → `src/app/api/encounters/[id]/recordings/[recordingId]/chunks/route.ts`
- `src/app/api/huddle/[id]/transcribe/route.ts` → schema adaptation
- `src/app/api/huddle/[id]/audio/route.ts` → audio streaming endpoint
- Stale-recording cron pattern for abandoned encounter cleanup

**Selective lift (UI components):**
- Big red record button + encounter timer
- Chunk-count indicator + upload progress
- Recording state badge
- Transcript viewer with speaker labels

**Not reused** (Daily-Dash-specific): departments/forms/KPI aggregation, HK module, Sewa module, surgical risk module, WhatsApp insights, async channel, Daily Dashboard routes.

**Realistic reuse fraction:** ~30-35% of recording-related code lifts wholesale, ~60% of broader UI patterns get reused, 0% of Daily Dash domain logic.

### Critical dependencies (start in parallel with Sprint 0)

- **Twilio WhatsApp templates** — submit two templates for Meta approval on Day 1 (patient prescription, pharmacy prescription). 24-48hr approval cycle.
- **Drug master sheet stability** — lock down the Drive sheet schema before Sprint 1 import; if columns change, the importer breaks.
- **Doctor signature images** — collect during pilot onboarding. PNG with transparent background, ~400px wide.
- **Pulse integration coordination** — even though v1 mocks Pulse via admin buttons, document the event contract with the Pulse team in Sprint 0 so v1 schema doesn't paint v2 into corners.

### Pilot location

**Recommendation: start with one doctor in EHRC's GP/General Medicine OPD as a dogfood pilot, before any formal pilot.**

Reasoning:
1. V is at EHRC daily — fastest feedback loop with the doctor
2. One doctor's prescribing repertoire is bounded (~150-300 drugs total), well within smart defaults coverage
3. EHRC's existing Pulse deployment is the natural integration test bed
4. Hospital Pass GP becomes the natural v1.1 formal pilot (paying customers, insurer empanelment context)
5. Tier 2 FM teams and Metabolic Health Program are v1.2+ (clinics not open, semaglutide gated)

If a more formal pilot is needed from day 1, **Hospital Pass GP** is the right answer but adds insurer empanelment to the critical path.

### Total elapsed timeline

- **Internal demo running:** end of Sprint 4 (~3-4 weeks)
- **Dogfood pilot ready:** end of Sprint 8 (~5-7 weeks)
- **First formal pilot (Hospital Pass GP or equivalent):** add 2-3 weeks for production hardening, audit log, real Pulse integration, smart defaults full review

### What "production hardening" between demo and formal pilot means

When transitioning from the demo schema to the production schema (Section 6 of this doc), the work is additive and limited to:
- Add tables: `audit_log`, `pulse_events`, `outbound_events`, `drug_defaults_drafts`, `drug_default_overrides`
- Add snapshot columns to `prescription_lines` (and migrate from JSONB to relational lines)
- Add `deleted_at` columns to soft-delete-eligible tables
- Add granular WhatsApp delivery tracking columns
- Wire up real Pulse integration (replace admin buttons with event listeners)
- Submit and approve real Twilio WhatsApp templates with Meta
- Onboard the formulary refresh sync (Drive sheet → drug_master)
- Audit log instrumentation everywhere

The UI code remains largely unchanged — production hardening is mostly database, infrastructure, and integration work.

---

## 9. Open Questions

- ~~Drug master source~~ — **RESOLVED 2026-05-17:** Even Hospital Pharmacy Formulary 2026 (Drive ID `1jKAwnkwafdfX58fMUjfddcM4e2ZyF7jVkQH8GYUESZM`). 2,174 items, V-authored, pharmacist pilot-approved.
- Smart defaults source for top ~500 OPD drugs (Qwen drafts → V reviews recommended)
- Doctor digital signature / MCI registration number capture
- Patient phone capture (from Pulse queue presumably)
- Prescription unique ID format
- Audit log scope (every encounter view, every prescription generated, every edit)
- Pilot location (Hospital Pass GP? EHRC OPD? Specialist clinic?)
- PHI retention policy for ambient recordings (medical record retention typically 5-10 years)
- Smart defaults learning loop (v1 hardcoded; v2 per-doctor personalization?)
- LASA confirmation UX — once-per-drug vs every-time vs only-when-confidence-high?

---

## 10. Change Log

- **2026-05-17** — Doc initialized. Queue and encounter screen designed. Two-recording-streams model established. Physical exam capture integrated. 
- **2026-05-17** — Pause/resume choreography drilled. Send-to-diagnostics modal designed. Resume experience described. State transitions and snippet model documented.
- **2026-05-17** — Pause-action count resolved: option 1 (single explicit pause action — Send to diagnostics — with step-aways handled implicitly).
- **2026-05-17** — Prescription compose flow designed. Drug row pattern, three input modes (type/dictate/override-chip), smart defaults, collapse/expand chip groups.
- **2026-05-17** — Drug master decision resolved: Even Hospital Pharmacy Formulary 2026 (2,174 items, V-authored). Formulary-driven additions to compose flow specified (schedule chip, LASA confirmation strip, risk profile indicator). Smart defaults path defined (Qwen drafts → V reviews for top 500 OPD drugs). Data model section updated with drug_master and drug_defaults tables.
- **2026-05-17** — Smart defaults pipeline designed in detail. Three phases (filter → Qwen draft → V review). Swipe-style review UI with Qwen reasoning visible. ~3 day build, 2-3 hours of V review time. Override learning loop sketched for Phase 2. Lives as separate admin tool at `/admin/drug-defaults/review`.
- **2026-05-17** — Commit/submit moment designed. Six-phase sequence (validation → confirmation modal → async dispatch → success state → auto-transition → async record finalization). Failure handling defined. Meta WhatsApp template approval flagged as parallel dependency. **All five doctor-facing design moments now complete.**
- **2026-05-17** — Full data model walkthrough complete. Fifteen tables across five domains (identity, encounter core, recording, drug+prescription, audit+integration). Full DDL written. Index strategy documented (trigram GIN for typeahead, partial indexes for hot states, composite indexes for read paths). Migration sequencing in 8 steps. Open decisions flagged. Schema is settled.
- **2026-05-17** — Demo-only simplified schema added (Section 6A). Trimmed to 8 tables, 4 enums, ~5 indexes. Stripped audit, Pulse integration, soft delete, snapshot immutability, granular delivery tracking, drug defaults workflow tables. Kept full doctor-facing choreography + real recording + real prescription generation. Migration to production is additive. Demo support requirements documented (seed data, admin demo controls, Twilio sandbox mode).
- **2026-05-17** — Build plan finalized. Nine sprints over 5-7 weeks elapsed. Huddle codebase reuse mapped at file level. Critical dependencies identified (WhatsApp template approval, drug master sheet, signatures, Pulse coordination). Pilot recommendation: dogfood with one doctor at EHRC GP OPD before formal Hospital Pass GP pilot. **Design pass complete.**
