# OPD Encounter App — Demo walkthrough

A 5-minute guided run through the app as a pilot doctor would experience it.
Written for the dogfood pilot at EHRC GP OPD; reusable as the briefing
document when onboarding the first formal pilot doctor.

## Setup once

1. Make sure your email is in the `doctors` table (V's is seeded; new pilot
   doctors need a row added via Sprint 8's pre-pilot onboarding kit).
2. Open https://opd-encounter-app-vinaybhardwaj-commits-projects.vercel.app/.

## 1. Sign in — magic link (30 sec)

You land on `/auth/login`.

1. Type your hospital email (`vinay.bhardwaj@even.in` for V).
2. Click **Send sign-in link**.
3. Check your inbox — the email arrives from **Even OPD** in 1–3 seconds.
4. Click **Sign in** in the email — opens `/dashboard` already signed in.
   Magic-link token is valid for 15 minutes, single-use. Session cookie
   lasts 30 days.

> **Demo mode caveat:** until DNS for `notifications.even.in` is verified,
> Resend can only deliver to V's own inbox. Pilot doctors will need V to
> verify DNS before they can receive magic links.

## 2. The queue (1 min)

`/dashboard` is your queue. Four lanes ordered by what's most actionable:

| Lane | Color | What it means |
|---|---|---|
| Ready to resume | Blue ring | Diagnostic result is back. Top priority. |
| Waiting | Neutral | New patient — not yet seen. |
| At diagnostics | Pink (amber slot) | Encounter paused, test pending. |
| Completed today | Dim | Today's archive. |

Header shows your name, the date, and "X of Y seen today." Each card has
the patient's name + age/sex + MRN + chief complaint (or pending test, or
arrival time).

**To start an encounter:** tap any **Waiting** card. The encounter screen
opens with the patient banner at top.

## 3. The encounter screen (2-3 min, the meat of the demo)

You're on `/dashboard/encounters/<id>`. Six sections, each independently
editable. Auto-save fires 800ms after you stop typing — a quiet "saved"
indicator on the right.

**Header:**
- Encounter timer (counts up from when you opened the patient).
- **Start recording** pill (the big pink button) — taps to start ambient
  recording of the whole encounter. Pulses while recording. Tap again to
  stop; transcript appears in a panel at the bottom.

**Chief complaint:**
- Three chip rows (Acute / Follow-up / Routine). Tap chips to toggle into
  the patient's complaint. Free-text below.
- **Dictate mic** next to the section title — tap, speak ("burning chest
  pain x 5 days, worse at night"), tap stop. Audio uploads, Deepgram
  transcribes in ~2-3 seconds, the transcript drops into the textarea.

**Vitals:** six fields (BP sys/dia, HR, RR, Temp, SpO₂). Optional.

**Exam findings:** free-text + dictate mic.

**Assessment:**
- ICD-10 typeahead — type "hyper", "diabetes", "J02" — picks bubble up
  as removable blue chips above the textarea.
- Dictate mic for free-text impression.

**Prescription:**
- Tap **+ Add a drug**. Drug typeahead opens. Type "para" → CALPOL row
  materialises with frequency/duration/timing chips already filled in
  (smart defaults). Tap a chip to override.
- LASA strip auto-appears below new rows that have sound-alikes —
  "You picked X. Sound-alike: Y, Z." Confirm or swap.
- Schedule X picks (e.g. Ketamine) trigger a double-confirm modal citing
  the Drugs & Cosmetics Rules before the row lands.

**Disposition:** 6 tap targets (Discharge / Follow-up / Refer /
Diagnostics / Admit / Vaccinate). Required to submit. Follow-up reveals a
"days" input; Refer reveals a "refer to" input.

## 4. Send to diagnostics (mid-encounter pause) — 30 sec

Click **Send to diagnostics** in the sticky action bar.

- Modal shows the 6-test grid (CXR / ECG / USG abdomen / Echo / CBC /
  Urine routine) + Custom + notes for the lab.
- Pick + Confirm → encounter pauses, you're back on `/dashboard`. The
  patient card has moved to **At diagnostics** lane with the test name.
- When the test result is ready, the **/admin/demo-controls** page has a
  per-encounter **✓ Test ready** button (a stand-in for the Pulse event in
  production). Tap it → card moves to **Ready to resume**.
- Tap the Ready-to-resume card → encounter screen reopens with all prior
  content preserved + a blue **Resume encounter** banner.
- Tap **Resume encounter** → status flips back to active, banner gone.
- Big red record button picks up snippet 2 automatically.

## 5. Submit & dispatch — 30 sec

When the encounter is complete, tap **Submit & finish**.

- Confirmation modal opens with a 2-3-second scannable preview:
  - Patient + WhatsApp number
  - Diagnosis chips (ICD codes + labels)
  - Rx summary list
  - Disposition
  - Recipients banner ("Will WhatsApp the PDF to: Patient +91… / EHRC
    Pharmacy")
- Confirm & send →
  1. Encounter flips to `completed`
  2. PDF generates (Even Hospital letterhead, DEMO watermark, drug
     warnings, doctor sig block)
  3. PDF uploads to private Vercel Blob
  4. Twilio WhatsApp sends fan out to patient + pharmacy (in DEMO_MODE
     they're logged with synthetic SIDs — no real delivery until V flips
     `DEMO_MODE=false` and Meta approves the templates)
  5. Success view: "Sent · Prescription dispatched to <Name> at <phone>
     and the EHRC pharmacy."
- Auto-redirect back to `/dashboard` after 2.5s. Card now sits in
  **Completed today** lane.

Open the completed card → "Dispatched · RX-…" callout under the patient
banner + a **View prescription PDF →** link.

## 6. Demo controls (V's pre-demo reset) — 30 sec

`/dashboard` → **Demo** link in the header → `/admin/demo-controls`.

- **Reset today's queue** — wipes today's encounters (your test edits),
  reseeds the original 12 completed / 3 paused / 2 ready.
- **+ Add walk-in** — drops a new patient into the Waiting lane with a
  fresh MRN. Each tap picks the next unused name from the demo pool.
- **✓ Test ready** — per paused encounter, flips paused_diagnostics →
  ready_to_resume.

Use these between practice runs so the demo always starts from a clean
state.

## Production hardening checklist (pre-pilot)

Before pointing a real doctor at this:

- [ ] DNS-verify `notifications.even.in` in Resend dashboard, flip
      `RESEND_FROM_EMAIL` to `noreply@notifications.even.in`.
- [ ] Provision Twilio credentials + submit Meta WhatsApp templates
      (24-48 hr approval cycle). Flip `DEMO_MODE=false`.
- [ ] Replace `EHRC_PHARMACY_WHATSAPP` fallback with the real pharmacy
      number.
- [ ] Doctor signature image upload flow (PNG transparent, ~400px wide).
- [ ] Replace the env-var allowlist with a `doctors` admin UI (M8.1
      proxy is auth-gated by `doctors` table membership already).
- [ ] Audit log instrumentation across encounter mutations.
- [ ] Real Pulse integration replacing the Mark-diagnostic-ready admin
      action.

The first three are the critical path. The rest are nice-to-have for
the dogfood pilot.

## What's intentionally NOT in the demo

- Drug-interaction warnings (no allergy data without Pulse).
- Refills (Indian OPD doesn't model these the way Western EMRs do).
- Dose calculators (no patient context).
- Quantity to dispense (pharmacy calculates from frequency × duration).
- Audit trail (Sprint 8+).
- Drug master defaults beyond ~50 generics (Qwen-drafted full pipeline
  is a separate sprint).
