# OPD-Encounter-App — v2 Demo Walkthrough

End-to-end script for showing v2 (Choreography + Lab + AI + Handoff) in one ~12 minute run. Uses Naveen Gowda (MRN `EHRC-2026-027`) as the canonical patient.

**Prod URL:** https://opd-encounter-app-vinaybhardwaj-commits-projects.vercel.app

---

## 0. Pre-demo checklist

- Mac Mini awake (Cloudflare tunnel → `https://llm.llmvinayminihome.uk/v1`). Verify with: `curl https://llm.llmvinayminihome.uk/v1/models` — should list `qwen2.5:14b`, `qwen2.5vl:7b`, `llama3.1:8b`.
- Hit `/api/health` and confirm `latest_migration: 25` (v0–v24 applied).
- If running fresh: sign in as admin → `/admin/demo-controls` → "Reset today's encounters" → "Add walk-in patient" to populate the queue, OR use the v2 seed (`POST /api/admin/seed-v2` with `MIGRATION_SECRET`).
- Browser permissions: mic (for voice query) + clipboard (optional).

## 0.1 Sign-in shortcuts

`/api/auth/demo-signin` accepts these:

| Demo URL | Who | Lands at |
|---|---|---|
| `?role=cce` | first CCE (Lalitha Krishnan) | `/reception` |
| `?role=nurse` | first nurse | `/triage` |
| (no params) | V (Vinay, doctor) | `/dashboard` |
| `?as=aditya.sharma@even.in` | another doctor (for handoff demo) | `/dashboard` |
| `?role=lab_tech` | first lab tech (Ramesh Kumar) | `/lab` |
| `?role=admin` | superuser | `/admin` |

Use these in different browsers or incognito windows so you can stand at 3 tabs and demo all the roles live.

---

## Act 1 — CCE (Reception) registers + pre-stages labs

1. **Sign in as CCE** → lands on `/reception`. Show the 10-room queue grid + lab dispatch panel.
2. Click **"+ Register patient"** (top right). Quick-search for an existing patient by phone or MRN, or pick a new patient and fill name + age + sex + phone. Pick a quick-reason chip ("Routine follow-up", "Diabetes review", etc.), choose a room with available capacity, hit submit.
3. The new patient appears in that room's column with status `registered`.
4. Click the **🧪 chip** on the new row → `<PreStageLabModal>` opens. Quick-add `CBC`, `RBS`, `HbA1c`. Submit. The chip badge shows `+3` indicating pre-staged labs waiting.

**What just happened:** an encounter row is now in the DB with `status='registered'`, `intake_visit_reason` set, and 3 `lab_orders` rows with `status='pre_staged'`, `ordering_doctor_id=NULL`, `pre_staged_by_cce_id=<Lalitha>`.

## Act 2 — Triage Nurse captures vitals

1. **Sign in as nurse** (separate tab/window) → lands on `/triage`. The patient is in the room-filtered queue.
2. Click **"Capture vitals →"** on the new row. Page transitions to `/triage/<encounter>` and the encounter status flips to `at_triage`.
3. Fill BP `134/82`, HR `78`, Temp `36.8`, SpO₂ `99`, Weight `78`, Height `175`. Live BMI is calculated. Pain slider stays at 0.
4. Submit. Encounter flips to `waiting_for_doctor`. The nurse's queue card disappears; it now shows up on V's `/dashboard`.

**Talking point:** red-zone inline flags fire automatically — BP≥180/110, HR<50 or >110, Temp>38.5, SpO₂<92.

## Act 3 — Doctor opens, sees full context

1. **Sign in as V** → lands on `/dashboard`. The patient is in the "Vitals captured · ready for you" lane (white card). Card shows the 4-cell vitals tile + the intake reason chip + "Vitals captured by Nurse X · Ym ago".
2. Click the card. Encounter detail page opens with:
   - Patient banner: name + MRN + age/sex + allergies
   - `<HistoryPanel>` button (top-left) → expand → see cached Qwen problem list + meds + allergies + lab trends ("HbA1c: 6.5 → 6.2 → 6.0%") + last 5 encounters
   - Chief complaint chip grid + free-text + dictate
   - Exam findings + vitals + assessment + disposition fields
3. Tap a few CC chips ("Cough", "Fever"). Type the rest of the CC. Fill exam, then add an assessment like `J11.1 — Influenza without pneumonia`.
4. **Hold the Ask Qwen mic** in the header for ~2s → ask "what's the trend on her HbA1c?". Release. Right-side drawer opens with Qwen's answer + source-encounter pills.

## Act 4 — Doctor orders labs + DDx on demand

1. Click **"Order labs"** in the action bar. Modal opens showing the 3 pre-staged labs (🧪 chip with "Pre-staged by Lalitha"). Add `Vitamin D` via quick chip. Click **"Send to lab"**.
2. Encounter status flips to `paused_diagnostics`. Action bar's Submit button is now gated with "Paused for diagnostics" hint. Page redirects to `/dashboard`.
3. **Suggest DDx (on-demand)**: open another patient's encounter mid-flow (one with CC + exam filled in) → above Assessment, click **"Suggest DDx"** → Qwen returns top 5 DDx with provenance to past encounters.

## Act 5 — Lab tech receives, extracts, posts

1. **Sign in as lab tech** → `/lab`. Pending tab shows 4 new orders for Naveen.
2. Click **Claim** on the CBC order. Status flips to `in_progress`, claim chip shows.
3. Click **Open** → `/lab/<orderId>`. Left-pane preview is empty; right-pane has the drag-drop upload zone.
4. Drop a real PDF (or PNG) of a lab report. Browser uses `pdfjs-dist` to render each page → POST multipart → server resizes to 1024px JPEG → forwards to `qwen2.5vl:7b` on the Mac Mini.
5. **Outcome A (high confidence ≥0.9):** 10s countdown banner appears with "Auto-posting in 10s… [Cancel]". Click Cancel if you want to demo editing; otherwise wait for auto-post.
6. **Outcome B (low confidence or 0 items):** the editable grid is the primary surface. Edit any cell (display_name, value, unit, ref_range, flag). Add/delete rows as needed.
7. Click **"Post results"**. `lab_results` rows are written + status flips to `resulted` + **encounter atomically flips to `ready_to_resume`** on the FIRST lab posted (subsequent labs no-op the encounter flip).

**Cold-start gotcha:** first Qwen-VL call after the Mac Mini wakes up takes ~30s. Warm calls are 5–15s. The /api/keep-alive cron pings every 15 min during demo hours to keep it warm.

## Act 6 — Doctor sees results + DDI + Auto-DDx + Submit

1. Back on V's `/dashboard` (the SSE listener auto-refreshed when the lab posted). Naveen is now in **Ready to resume** with a green ring and a "3 lab results back · 1 critical" badge.
2. Click the card → encounter screen. Above the prescription compose is **`<EncounterLabResults>`** with all 4 lab orders + their results, abnormal/critical row tints, Source PDF link.
3. Add a few drugs in the prescription compose (e.g. `Paracetamol 650mg` + `Cetirizine 10mg`). After 2s, **`<DdiBanner>`** runs a Qwen scan in the background and surfaces any interactions as severity-tiered banners (low silent, moderate yellow, high/severe red — but **Submit is never blocked**).
4. Annotate the Hemoglobin result if you want: click **+ Note** under the row → write "Repeat CBC same day showed normal Hb — sample likely hemolysed" → save. The note renders inline beneath the row with amber left border.
5. Click **Submit & finish**. `<SubmitConfirmModal>` opens with:
   - Patient + recipient line
   - Diagnosis chips + text
   - **"Did you consider?" section** — Qwen auto-DDx fires server-side with top 5 differential + likelihood + "Based on encounters X, Y, Z" provenance
   - Prescription summary
6. Confirm → `/complete` → `/dispatch` → PDF generated + Vercel Blob archived + Twilio (DEMO_MODE logs) → success state → auto-redirect to `/dashboard` after 2.5s.

## Act 7 — Multi-doctor handoff (optional, ~90s)

Use this when there's a different doctor specialty needed for a patient.

1. On a NEW patient's encounter (someone with chest pain in the assessment), click **"Flag for handoff"** in the action bar. Modal opens with quick-prompt chips ("Suspected cardiac — needs cardio review", etc.). Edit if needed. Submit.
2. Status doesn't change. The encounter now appears in the **network-wide "Needs review" amber lane** at the top of every doctor's `/dashboard`.
3. **Sign in as Dr Aditya Sharma** (`?as=aditya.sharma@even.in`). His `/dashboard` shows Naveen (or the new patient) in Needs review. Click **"Claim handoff →"**.
4. Server atomically: doctor_id → Aditya, contributors_json appended with `via='handoff_claim'`, handoff_ack stamped.
5. Aditya is redirected to the encounter screen. Top has a **`<HandoffBanner>`** with the original doctor's note + Acknowledge button. The `<AttributionStrip>` shows "CC · V · 12m ago / Exam · V · 11m ago" — sections last edited by someone other than Aditya.
6. Aditya adds his own notes (cardio rec, prescription changes), submits.

---

## What you're showing off (talking points)

- **4-actor choreography**: CCE → Triage → Doctor → Lab tech, all driven by **SSE realtime sync** (queue:global, queue:room:<id>, queue:lab channels). Status changes propagate across every open browser in <500ms.
- **Qwen-only AI**: DDI banner, DDx, voice query — all the same `lib/qwen.ts` text model. Vision LLM (`qwen2.5vl:7b`) is the same tunnel, different model name.
- **Local model trust**: nothing leaves V's Mac Mini for AI. No OpenAI / Anthropic / Lexicomp dependency.
- **Always-warn-never-block**: AI doesn't gate Submit. Doctor's call.
- **Full provenance**: every DDx + voice-query answer cites past encounters by UUID (validated server-side so Qwen can't hallucinate IDs).
- **Append-only audit**: handoff contributors_json, section_editors, lab_result_annotations all append-only. Real EHR audit trail.

## Demo gotchas

- **First Qwen call** after idle takes ~30s. Run a throw-away DDx call before the demo to warm the model.
- **Voice query mic** needs https://opd-encounter-app… not the bare prod URL — Vercel signs cookies on the project domain.
- **Lab PDF render** is client-side via pdfjs-dist. Old Safari versions may struggle; use Chrome.
- **Vercel Blob URLs** in the iframe preview only render if the user has the right session cookie. The "open in new tab" link is the always-works fallback.

## Reset between runs

`/admin/demo-controls` → "Reset today's encounters". Wipes today's encounters + lab_orders + voice_queries + section_editors. Re-add walk-ins as needed.

---

## File map (for fellow engineers)

```
src/app/dashboard/                  Doctor queue + encounter
src/app/reception/                  CCE workstation
src/app/triage/                     Nurse workstation
src/app/lab/                        Lab tech inbox + detail
src/app/admin/                      Users + rooms + demo controls
src/app/api/encounters/[id]/       /complete /dispatch /resume
                                    /send-to-diagnostics /labs /labs/prestage
                                    /flag-handoff /claim-handoff
                                    /ddi-scan /ddx /voice-query
src/app/api/lab-orders/[id]/       /claim /release /upload /confirm
src/app/api/lab-results/[id]/      /annotate
src/app/api/lab-orders/sweep        Cron — auto-release stale claims
src/components/                     EncounterEditor, HistoryPanel, etc.
src/lib/qwen.ts                     Text Qwen wrapper
src/lib/qwen-vision.ts              Vision Qwen wrapper (qwen2.5vl:7b)
src/lib/transcribe.ts               Deepgram nova-3-medical
src/lib/pdf-render-client.ts        Client-side PDF → PNG via pdfjs-dist
src/lib/lab-trends.ts               Lab series per canonical_key
src/lib/queueNotify.ts              pg_notify wrappers
src/app/api/queue/stream/route.ts   SSE endpoint (LISTEN)
```

24 migrations live, 25 in lib (one ahead — v24 was the latest). All idempotent.
