# OPD Encounter App — Cowork Project Handoff

**Project owner:** Dr. Vinay Bhardwaj (Hospital PM, Even Hospital)
**Cowork project name:** `OPD-Encounter-App`
**Local folder:** `~/Projects/OPD-Encounter-App/`
**Status:** Design pass complete (2026-05-17). Pre-build.
**Source of truth:** This document, plus the design doc and schemas in this folder.

---

## 0. How to use this document

This document does three things at once:

1. **Bootstraps Cowork's understanding of the project.** Read it first when starting a new task. It contains everything Claude needs to know to act usefully on this project without re-reading the 800-line design doc.
2. **Defines persistent behavior.** The instructions in §3 apply to every interaction Cowork has on this project, unless explicitly overridden.
3. **Lists what to delegate to Cowork vs what to keep manual.** See §6 and §9.

If anything in this document contradicts the design doc, **the design doc wins for technical/design decisions; this doc wins for working-style and process decisions.**

---

## 1. What the project is, in one paragraph

We are building a desktop web app that gives doctors in Even Hospital's OPD a faster, more elegant way to manage patient encounters — record audio of the consultation, document minimal structured notes, compose a prescription, set a disposition, and send a PDF to both the patient and the pharmacy via WhatsApp. The app sits as a UX layer alongside Pulse (Even's existing OPD management system, a closed SaaS that handles queue and pharmacy). It reuses ~30-35% of the audio recording infrastructure from the existing EHRC-Daily-Dash codebase's Huddle module. The doctor experience must be extremely elegant for non-tech-savvy but highly process-oriented users.

Full context is in `OPD-ENCOUNTER-APP-DESIGN.md` in this folder.

---

## 2. Project identity

| Field | Value |
|-------|-------|
| Codename | OPD-Encounter-App |
| Stage | Pre-build (design pass complete) |
| Pilot site (recommended) | EHRC GP OPD — dogfood with one doctor |
| Pilot site (formal v1.1) | Hospital Pass GP entry point |
| Total build duration | 5-7 weeks elapsed, 9 sprints |
| Stack | Next.js 15, Neon Postgres, Vercel Blob, Twilio, Deepgram, self-hosted Qwen, Resend |
| Brand palette | `#0055FF` (blue), `#002054` (navy), `#F96EB1` (pink), `#FCFCFC` (white) |
| Primary user | OPD doctors (initially: one GP at EHRC for dogfood) |
| Secondary stakeholders | EHRC pharmacy, EHRC admin, future Hospital Pass GP doctors |

---

## 3. Persistent behavior instructions for Cowork

Apply these to every task in this project.

### Working style

- **Be direct.** No excessive preamble. Get to the substance fast.
- **Ask clarifying questions one at a time** before assuming. Use structured multiple-choice format when disambiguating.
- **Flag uncertainty honestly.** "I'm 70% on this" is more useful than confident guessing.
- **Default to phased rollouts.** Pilot → validate → scale. Don't over-engineer before evidence exists.
- **Separate ownership from data.** When something is broken, distinguish "we don't have the data" from "no one owns this problem." Usually the latter is the deeper issue.
- **Distinguish concerns explicitly.** Customer care ≠ billing. Doctor encounter ≠ Pulse. Rx compose ≠ Rx dispatch. Don't let these blur in writing.

### Output style

- **Immediately executable deliverables over frameworks.** Word docs, Excel files, JSON, Linear issues, Claude Code prompts — actionable artifacts, not abstract advice.
- **Document decisions with rationale.** Every locked decision in the design doc has a "why" attached. Maintain this discipline.
- **Use V's existing naming patterns.** `UPPERCASE-DASH-SEPARATED.md` for PRDs/specs. `kebab-case.sql` for SQL. `kebab-case.ts` for code.

### Constraints to respect

- **PHI handling.** All audio recordings contain patient-identifiable data. Never transmit recordings, transcripts, or patient identifiers to any service other than: Vercel Blob (storage), Deepgram (transcription), Qwen (self-hosted, on-prem), Twilio (WhatsApp dispatch). Never to OpenAI, never to Anthropic's API for processing patient data, never to public services.
- **DPDP Act 2023.** India's data protection law applies. Patient consent at registration covers WhatsApp delivery. Audio retention follows medical record retention norms (typically 5-10 years).
- **Schedule X drugs need extra friction.** Only 11 drugs in the formulary, but each requires explicit double-confirm and license number capture.
- **No real prescriptions in demo mode.** Demo PDFs are watermarked "DEMO — NOT A VALID PRESCRIPTION."

### What to push back on

- Requests that compromise patient safety (e.g., skipping LASA warnings to make the UI faster)
- Requests that violate audit-log integrity (e.g., "delete this encounter completely")
- Suggestions to add patient allergy data without a clear source (we don't have Pulse integration for this)
- Any push to delay the Twilio WhatsApp template approval (24-48hr cycle, on the critical path)

---

## 4. Folder structure

```
~/Projects/OPD-Encounter-App/
├── COWORK-HANDOFF.md                    ← This file. Read first.
├── OPD-ENCOUNTER-APP-DESIGN.md          ← The full design doc (888 lines).
├── opd-encounter-schema.sql             ← Production schema (15 tables).
├── opd-encounter-schema-demo.sql        ← Demo schema (8 tables). Use first.
│
├── sprints/
│   ├── SPRINT-00-FOUNDATION.md          ← Sprint progress tracker (Cowork maintains)
│   ├── SPRINT-01-DRUG-MASTER.md
│   ├── ...
│   └── SPRINT-08-POLISH.md
│
├── deliverables/
│   ├── claude-code-prompts/             ← Sprint-by-sprint Claude Code build prompts
│   ├── meta-templates/                  ← WhatsApp templates for Meta approval
│   ├── smart-defaults-drafts/           ← Qwen-generated default drafts pre-review
│   └── pilot-onboarding/                ← Doctor signatures, MCI numbers, etc.
│
├── reference/
│   ├── EHRC-Daily-Dash-reuse-map.md     ← What files lift from the Huddle codebase
│   ├── even-pharmacy-formulary-snapshot.csv  ← Local snapshot of Drive sheet
│   └── design-decisions-log.md          ← Append-only log of locked decisions
│
└── status/
    ├── WEEKLY-STATUS.md                 ← Cowork updates every Friday
    ├── BLOCKERS.md                      ← Active blockers needing V's attention
    └── DEPENDENCIES.md                  ← External waits (Meta approval, pilot doctor onboarding, etc.)
```

Cowork can create the folders that don't yet exist. The files in the root come pre-populated from the design pass.

---

## 5. Initial setup (one-time, for V)

Steps V takes manually before the first Cowork task:

1. **Install Claude Desktop with Cowork** (Max subscription required, macOS or Windows).
2. **Create the project folder** at `~/Projects/OPD-Encounter-App/` and drop in the four root files (this handoff doc, the design doc, both schemas).
3. **Create a new Cowork Project** in Claude Desktop pointing at that folder.
4. **Enable the following connectors** in Cowork:
   - **Linear** — for issue tracking against the EvenHospital team
   - **Slack** — for status updates to stakeholders
   - **Google Drive** — for the pharmacy formulary sheet
   - **Gmail** — for Meta template approval correspondence
5. **Set folder-specific instructions** in Cowork: paste the contents of §3 (Persistent behavior instructions) into the Cowork project's instructions field. Cowork will apply this to every task in this folder.
6. **First task to assign Cowork:** "Initialize the folder structure described in §4 of `COWORK-HANDOFF.md`. Create any missing directories and stub files. Don't fill them yet — just create the skeleton."

After step 6, Cowork has a navigable project structure and is ready to take real work.

---

## 6. Initial set of tasks Cowork can handle

These are concrete delegations V can hand to Cowork once the project is set up. Each is scoped to be completable in a single Cowork session.

### 6.1 Formulary sync

> "Pull the latest version of the Even Pharmacy Formulary from Drive (sheet ID `1jKAwnkwafdfX58fMUjfddcM4e2ZyF7jVkQH8GYUESZM`). Save a CSV snapshot to `reference/even-pharmacy-formulary-snapshot.csv` with today's date in the filename. Diff against the previous snapshot if one exists, and write the changes (new rows, removed rows, modified rows) to `reference/formulary-changelog-YYYY-MM-DD.md`. Flag any changes that touch drugs already in the smart defaults table — those will need re-review."

### 6.2 Sprint progress tracking

> "Read all sprint files in `sprints/`. Generate `status/WEEKLY-STATUS.md` with: which sprint is active, what was completed this week, what's blocked, what's planned next week. Format as a 1-page summary suitable for posting to Slack #even-build channel. Include sprint completion percentage as a rough estimate."

### 6.3 Claude Code prompt drafting

> "For Sprint [N], read the relevant sections of `OPD-ENCOUNTER-APP-DESIGN.md` and the demo schema. Draft a Claude Code build prompt for that sprint and save it to `deliverables/claude-code-prompts/sprint-[N]-prompt.md`. The prompt should include: the sprint's deliverable, the specific files to create/modify, the schema tables involved, what to reuse from EHRC-Daily-Dash (link to the reuse map), and any tests to write. Format it to be self-contained — pasteable directly into a Claude Code session."

### 6.4 Meta WhatsApp template prep

> "Draft the two WhatsApp message templates required for Meta approval (patient prescription notification, pharmacy prescription notification). Use the specifications in §4.6 of the design doc. Save as `deliverables/meta-templates/template-patient.md` and `deliverables/meta-templates/template-pharmacy.md`, each in Meta's required format. Include the exact merge variables and example renderings. Don't submit them — V reviews first."

### 6.5 Smart defaults preparation

> "Read the design doc Section 4A. From the pharmacy formulary CSV at `reference/even-pharmacy-formulary-snapshot.csv`, generate the filter list — drugs that are OPD-relevant (excluded: dept_primary in Anaesthesia/OT/Critical Care/Oncology/Chemotherapy/Emergency; dosage_form not in Tablet/Capsule/Syrup/Drops/Cream/Spray/Ointment/Eye-Ear Drops). Save the filtered list to `deliverables/smart-defaults-drafts/opd-candidates.csv`. Expected: 500-800 rows."

### 6.6 Pilot doctor onboarding kit

> "Create a pilot doctor onboarding checklist at `deliverables/pilot-onboarding/onboarding-checklist.md`. Required items: doctor name, qualification, MCI registration number, hospital affiliation, OPD specialty, signature image (PNG, transparent background, 400px wide), preferred WhatsApp number for receiving status notifications, list of common drugs they prescribe (so we can prioritize smart defaults for them). Include a brief 1-page brief explaining what the app does and what they'll be doing in the dogfood pilot."

### 6.7 Linear sprint setup

> "Create Linear issues for Sprint 0 (Foundation). Each issue should map to one of the discrete deliverables: repo init, Tailwind setup, Neon DB setup, Vercel deploy pipeline, auth scaffolding, demo schema migration. Use the workstream label `opd-encounter-app`. Set the milestone to `Sprint 0`. Cross-link each issue to the relevant section of the design doc."

### 6.8 Decision log maintenance

> "Append a new entry to `reference/design-decisions-log.md` for the decision: [decision]. Include: the question, the options considered, the decision made, the rationale, and the date. Keep entries short — 5 sentences max each. This is for future-you to be able to remember why a thing is the way it is."

---

## 7. Recurring/scheduled tasks

These can be set up as recurring Cowork tasks.

| Cadence | Task |
|---------|------|
| Every Friday 5pm | Generate weekly status report (task 6.2) |
| Every Monday 9am | Check `status/BLOCKERS.md` and `status/DEPENDENCIES.md`, post unblocked items to Slack |
| Every two weeks | Re-sync formulary (task 6.1) |
| End of each sprint | Generate sprint retrospective from sprint file, update `OPD-ENCOUNTER-APP-DESIGN.md` change log |

V should review and approve each recurring task once before it runs automatically.

---

## 8. Sprint status tracking

Cowork should treat the `sprints/` folder as the source of truth for build progress.

Each sprint file follows this structure:

```markdown
# Sprint [N] — [Name]
**Status:** [planned / in-progress / blocked / complete]
**Started:** [date]
**Completed:** [date or "—"]
**Days budget:** [from build plan]
**Days actual:** [auto-update]

## Scope
[From design doc Section 8]

## Deliverables
- [ ] Item 1
- [ ] Item 2
- [ ] ...

## Claude Code session log
[Cowork appends summaries from each build session here]

## Bugs found in sprint sweep
[Cowork tracks bug list and resolution status]

## Retrospective
[Filled at sprint close — what worked, what didn't, carry-overs]
```

Cowork should:
- Update sprint status when V mentions a sprint is starting/ending
- Append Claude Code session summaries when V pastes them in
- Maintain the bug checklist across the sweep
- Flag scope creep (deliverables that weren't in the original plan)

---

## 9. What NOT to delegate to Cowork

These remain V's manual work, or get done in Claude Code, not Cowork:

- **The actual code build.** Claude Code is the right tool for this; Cowork is for assembly, tracking, and orchestration around the build.
- **Smart defaults review (the swipe-through).** V's clinical judgment is the point. Cowork can prepare the queue, but V approves each one personally.
- **Clinical content review.** Any draft that involves clinical claims (prescribing patterns, drug interactions, etc.) gets V's eyes before it ships.
- **Doctor onboarding conversations.** Cowork can prepare the onboarding kit; V does the actual conversation with the pilot doctor.
- **Production deployments.** Demo deploys are fine; flipping the prod flag stays manual.
- **Meta template submission.** Cowork drafts; V submits.
- **Stakeholder communication where context matters.** Cowork can draft Slack updates, but V sends the ones to Ale, Dr. Chandrika, or external parties.
- **Decisions tagged "RESOLVED" in the design doc.** These are locked. Don't reopen unless V explicitly asks.

---

## 10. Communication patterns

How Cowork reports back to V.

- **Plan-first, act-second.** For any task that creates or modifies files in `deliverables/` or `sprints/`, show V the plan and wait for approval. For tasks in `status/` or `reference/`, just do it and summarize.
- **End-of-task summary.** Every completed task ends with a 3-bullet summary: what was done, what files changed, what V should look at next.
- **Slack updates.** When Cowork completes a recurring task or significant manual task, post a 1-line summary to Slack #even-build channel. Skip the noise — only post real progress.
- **Blockers.** When Cowork hits something it can't resolve (missing data, permission needed, ambiguous direction), write the blocker to `status/BLOCKERS.md` and notify V via Slack DM rather than trying to guess.
- **Ambiguity.** When V's instruction is ambiguous, ask one clarifying question with 2-4 multiple-choice options. Don't ask open-ended "what do you mean?" — propose paths.

---

## 11. Key people referenced in this project

| Person | Role | When relevant |
|--------|------|---------------|
| Dr. Vinay Bhardwaj (V) | Project owner, hospital PM | Always |
| Ale | Co-founder, decision-maker | Org-structure decisions, VC governance |
| Dr. Chandrika | Medical Superintendent, EHRC | EHRC pilot context, clinical oversight |
| Dr. Manukumar | Lead anaesthesiologist, EHRC | Not directly relevant to OPD pilot |
| Animesh Roy | HR | Doctor onboarding paperwork |
| Yash | GM | Operations escalations |
| Krishnan | Member support / central ops | Hospital Pass coordination |
| Mithun Kandi, Lavanya Pawar | Customer care leads | Patient experience feedback |

When drafting communications, default to professional but warm tone. V's relationships with this group are collaborative.

---

## 12. Glossary

Quick reference for terms specific to this project. Cowork should treat these as known terms and not re-explain them in V-facing output.

| Term | Meaning |
|------|---------|
| OPD | Out Patient Department — walk-in / appointment-based ambulatory clinic |
| Pulse | The existing closed-SaaS OPD management system at Even Hospital |
| EHRC | Even Hospital Race Course Road — V's home base, secondary care hospital |
| Huddle | The morning meeting recording feature in EHRC-Daily-Dash codebase |
| LASA | Look-Alike Sound-Alike drug warning |
| ISMP | Institute for Safe Medication Practices (US org whose high-alert list we use) |
| MCI | Medical Council of India — every doctor has a registration number |
| Schedule H/H1/X | Indian Drugs & Cosmetics Rules schedules (H requires Rx, H1 requires register entry, X is narcotic) |
| VED | Vital / Essential / Desirable drug categorization |
| CC | Chief complaint — patient's reason for visiting |
| ICD-10 | International Classification of Diseases v10 — diagnosis coding |
| Smart defaults | Pre-populated frequency × duration × timing for common drugs |
| Split encounter | An encounter that pauses (typically for diagnostics) and resumes later |
| Snippet | One recording session within an encounter; one encounter may have multiple |
| Ambient recording | Background audio capture of the whole encounter |
| Section dictation | Short voice note scoped to a specific encounter field |
| Dogfood pilot | Internal use by one trusted doctor before formal pilot |

---

## 13. First-week task list

If V wants to kick off the Cowork project with a concrete week-one queue, this is a reasonable sequence:

| Day | Task | Reference |
|-----|------|-----------|
| Mon | Initialize folder structure | §5 step 6 |
| Mon | Generate Sprint 0 Claude Code prompt | §6.3 |
| Tue | Draft both Meta WhatsApp templates | §6.4 |
| Tue | Create Linear issues for Sprint 0 | §6.7 |
| Wed | Pull formulary snapshot + filter OPD candidates | §6.1 + §6.5 |
| Wed | Set up pilot doctor onboarding kit | §6.6 |
| Thu | Set up recurring tasks (weekly status, biweekly formulary sync) | §7 |
| Fri | Generate first weekly status report | §6.2 |

By Friday of week one, Cowork is meaningfully embedded in the project's daily operations, and Sprint 0 of the actual build can begin in Claude Code on Monday of week two.

---

## 14. Change log for this handoff doc

- **2026-05-17** — Document initialized at end of design pass. All design decisions through Section 8 of `OPD-ENCOUNTER-APP-DESIGN.md` reflected here.

When this document changes, Cowork should append a dated entry here describing what changed and why.

---

## 15. If you (Cowork or a future reader) get stuck

1. **Read the design doc.** Almost every "why is this the way it is" question has a paragraph of rationale in `OPD-ENCOUNTER-APP-DESIGN.md`.
2. **Check the change log.** Section 10 of the design doc shows every locked decision in chronological order.
3. **Check `reference/design-decisions-log.md`.** Append-only log of context decisions that didn't make it into the design doc.
4. **Ask V.** When in doubt, ask one clarifying question with options. Don't guess on anything that touches patient safety, prescription accuracy, or the Even Hospital brand.

Bias toward asking. The project's quality bar is high and V has consistently preferred a brief clarifying exchange over speed-driven assumptions.

---

*End of handoff document. This is the operating manual for OPD-Encounter-App in Cowork.*
