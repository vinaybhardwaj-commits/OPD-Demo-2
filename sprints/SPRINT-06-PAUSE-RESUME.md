# Sprint 6 — Pause/resume choreography

**Status:** complete
**Started:** 2026-05-18
**Completed:** 2026-05-18
**Days budget:** 3-4
**Days actual:** 1 (continuous from Sprint 5)
**Ship tag:** `sprint-6-shipped`

## Scope (from design doc §8)

Send-to-diagnostics modal, status transitions, queue card animations, resume banner, multi-snippet recording. Deliverable: full split-encounter flow end-to-end.

## Deliverables — what shipped

| Milestone | Commit | Deliverable |
|---|---|---|
| **M6.1** | `6345ec5` | `POST /api/encounters/[id]/send-to-diagnostics` — accepts `{test, notes?}`, flips `active|ready_to_resume → paused_diagnostics`, sets `pending_diagnostic_test` + `paused_reason` (`diagnostics: <notes>` if provided), returns redirect target. `<SendToDiagnosticsModal>` per design doc §4.3 — 6 common-test grid (CXR / ECG / USG abdomen / Echo / CBC / Urine routine) + Custom + optional notes textarea. Encounter editor action bar gains a "Send to diagnostics" button next to "Submit & finish" (shown only when status is active or ready_to_resume). `patientName` threaded through from page → editor → modal. |
| **M6.2** | `e37c56b` | `POST /api/encounters/[id]/resume` — flips `ready_to_resume → active`. Idempotent (200 noop on active). 409 `still_paused` on `paused_diagnostics` with admin-action hint. 409 `encounter_completed_immutable` on completed. `<ResumeBanner>` replaces the previous inline placeholder: blue surround, "Ready to resume" eyebrow, test name shown, inline "Resume encounter" button that calls `/resume` then `router.refresh()`. M5.2's `AmbientRecorder` already auto-allocates `snippet_index = MAX + 1` so multi-snippet works for free. |

## Full lifecycle state machine (verified)

```
[waiting/no row] → startEncounter → [active]
                                         │
                                         ├──── PATCH …            (any time)
                                         │
                                         ├──── /send-to-diagnostics ──→ [paused_diagnostics]
                                         │                                     │
                                         │                                     │  Mark diagnostic ready
                                         │                                     │  (admin action; Pulse event in prod)
                                         │                                     ▼
                                         │                              [ready_to_resume]
                                         │                                     │
                                         │                                     │  /resume
                                         │                                     │  OR /complete with disposition
                                         │                                     ▼
                                         │                                 [active]
                                         │
                                         └──── /complete (disposition required) ──→ [completed]
```

Guards:
- PATCH 409 `encounter_completed_immutable` on completed
- /send-to-diagnostics 409 `already_paused` on paused_diagnostics
- /resume 409 `still_paused` on paused_diagnostics, 200 noop on active
- /complete 409 `paused_for_diagnostics` on paused_diagnostics (now with clearer "back as Ready to resume" message)

## End-to-end smoke (verified)

1. Send Aishwarya Rao to diagnostics (Chest x-ray + "R/O consolidation, urgent read") → 200, queue card moved ready_to_resume → at_diagnostics
2. POST /send-to-diagnostics again → 409 `already_paused`
3. POST /send-to-diagnostics on completed → 409 `encounter_completed_immutable`
4. POST /resume on paused_diagnostics → 409 `still_paused`
5. POST /resume on ready_to_resume (Naveen Gowda) → 200 status=active; queue counts move ready_to_resume 1→0, waiting 8→9
6. POST /resume on now-active → 200 noop=true
7. POST /resume on completed → 409 `encounter_completed_immutable`
8. Encounter page renders 200 across all three editable states (active / paused_diagnostics / ready_to_resume)
9. Multi-snippet path: M5.2 already proved snippet_index auto-MAX+1; no new wiring needed

## Bugs found in sprint sweep

| # | Where | Fix |
|---|---|---|
| 1 | Smoke test initially picked a `paused_diagnostics` encounter for the `/resume` success case | Test-only — the API correctly 409'd. Re-ran with a `ready_to_resume` encounter and 200'd as expected. |

## Carry-overs into Sprint 7 (Commit/submit + dispatch)

- Sprint 7 is the submit-and-dispatch sprint: confirmation modal per design doc §4.6, PDF generation with hospital letterhead, Twilio WhatsApp dispatch in sandbox mode. The encounter lifecycle work is now done — Sprint 7 only adds what happens AFTER `/complete`.
- Sprint 8 polish still owes: chunked offline-queue upload for recordings (Huddle codebase reuse), recordings-retry admin tool for failed transcripts, function region migration `iad1` → `bom1`/`sin1`, DNS-verify `notifications.even.in` in Resend.
- A minor product-design polish: the resume banner does NOT show "N min at diagnostics" because we don't track `paused_at` — we have `updated_at` only. If V wants the duration, add a `paused_at` column in a future migration.
- The Send-to-diagnostics modal could host the same M5.1 `<DictateButton>` to dictate the notes field. The `section` enum on `section_dictations` doesn't include a "diagnostics_notes" value yet — small follow-up if V wants voice notes in the modal.

## Retrospective

What worked: the state machine ended up well-scoped because M0.5's enum + M2.3's existing guards covered most transitions. M5.2's auto-increment snippet_index gave us multi-snippet for free — no Sprint 6 code change. The `<ResumeBanner>` calling `router.refresh()` after `/resume` means the editor re-mounts in active state with the banner gone — cleaner than maintaining client-side status state.

What didn't: smoke test workflow needed two iterations (initial test picked the wrong encounter status). And the admin-controls action hash extraction regex didn't pick up hashes on the new page render — not a blocker for Sprint 6 but worth noting for future curl-driven admin smoke tests.

Sprint 7 (commit/submit + dispatch) is next.
