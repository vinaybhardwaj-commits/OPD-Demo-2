# Sprint 2 — Queue + encounter lifecycle

**Status:** complete
**Started:** 2026-05-18
**Completed:** 2026-05-18
**Days budget:** 4-5
**Days actual:** 1 (single Cowork session, continuous from Sprint 1)
**Ship tag:** `sprint-2-shipped`

## Scope (from design doc §8)

Patient seed, visualised queue, encounter start/save/complete, queue state management, `/admin/demo-controls` panel. Deliverable: doctor picks from queue, opens and completes an encounter (no Rx or recording yet).

## Deliverables — what shipped

| Milestone | Commit | Deliverable |
|---|---|---|
| **M2.1** | `8333d2d` | Migrations v2 (seed V into `doctors`, MCI `DEMO-MCI-001`) + v3 (25 patients + 17 today's encounters: 12 completed / 3 paused / 2 ready). `isAllowedEmail` swapped to DB-backed async lookup; `ALLOWED_DOCTOR_EMAILS` env var no longer read. New `GET /api/queue` returning 4 buckets via `getQueueForDoctor()`. |
| **M2.2** | `ce29758` | Queue UI replaces the `/dashboard` placeholder. 4-lane layout per design doc §4.1 (Ready to resume → Waiting → At diagnostics → Completed). Header shows doctor + date + "X of Y seen". Server action `startEncounter` creates a row + redirects to the encounter screen. `/dashboard/encounters/[id]` stub keeps links resolving. |
| **M2.3** | `3f4b818` | `<EncounterEditor>` client component: chief complaint, 6-field vitals (BP sys/dia, HR, RR, temp °C, SpO₂), exam findings, assessment, 6-button disposition (discharge/follow_up/refer/diagnostics/admit/vaccinate). 800ms debounced auto-save → `PATCH /api/encounters/[id]`. Live encounter timer. `POST /api/encounters/[id]/complete` validates disposition + 409s on `already_completed` / `paused_for_diagnostics`. `PATCH` 409s on `encounter_completed_immutable`. |
| **M2.4** | `8101ed2` | `/admin/demo-controls` panel with 3 server actions: Reset today's queue, Add walk-in, Mark diagnostic ready (per-encounter). `src/lib/seed.ts` centralises the seed SQL + walk-in name pool. Middleware extended to gate `/admin/:path*`. Dashboard header gets a discreet `Demo` link. |

## Production URLs (auth required for all)

- **Queue:** https://opd-encounter-app-vinaybhardwaj-commits-projects.vercel.app/dashboard
- **Encounter screen:** `/dashboard/encounters/[id]` (linked from each queue card)
- **Demo controls:** https://opd-encounter-app-vinaybhardwaj-commits-projects.vercel.app/admin/demo-controls

## Lifecycle state machine implemented

```
       startEncounter
   ┌───────────────────┐
   │                   ▼
[waiting] → [active] ──── (PATCH … sets fields incl. disposition) ──→ [active]
              │
              │ POST /complete  (requires disposition)
              ▼
         [completed]   ←── 409 on second /complete
              ▲
              │ "Reset today's queue" action wipes + reseeds
              │
[paused_diagnostics] ──── markDiagnosticReady ────→ [ready_to_resume]
                                                          │
                                                          │ same /complete path
                                                          ▼
                                                     [completed]
```

`paused_diagnostics → completed` is blocked (409, with hint to resume — wiring for that ships in Sprint 6 along with the explicit `Send to diagnostics` modal).

## End-to-end smoke trail (verified)

1. Magic-link sign-in for `vinay.bhardwaj@even.in` — now hits the DB allowlist, returns `{ok:true,sent:true}`. Random email → same shape, no actual send (Resend log confirmed).
2. `GET /api/queue` returns 25 cards across 4 buckets (2/8/3/12).
3. `PATCH` vitals + chief complaint on a ready-to-resume encounter → 200, fields persist.
4. `POST /complete` without disposition → 400 `disposition_required`.
5. Set disposition → `POST /complete` → 200. Queue counts move correctly.
6. Re-complete → 409 `already_completed`. PATCH the completed → 409 `encounter_completed_immutable`.
7. `POST /complete` on paused_diagnostics → 409 with hint pointing to Sprint 6.
8. Real Next.js server-action POST to `actionReset` → queue counts restored to the original seed (2/8/3/12).

## Bugs found in sprint sweep

| # | Where | Fix |
|---|---|---|
| 1 | Initial allowlist swap left request/callback callers still calling sync `isAllowedEmail` | Added `await` at both sites; `tsc` caught it |

## Carry-overs into Sprint 3

- Encounter screen still uses textareas for chief complaint, exam findings, assessment. Sprint 3 brings: CC chip shortcuts, ICD-10 typeahead for assessment, prominent dictate mics per section, full section-dictation infrastructure.
- Prescription section is a placeholder card; Sprint 4 drops in the drug compose row using the M1.3 `<DrugTypeahead>`.
- Pause / resume choreography UI (Send-to-diagnostics modal, resume banner) → Sprint 6. The encounter lifecycle SQL is already designed to accept the transitions.
- Ambient recording indicator stub in the editor header → Sprint 5 replaces with the real chunk-upload + transcription state.
- All Sprint 0 carry-overs still open: DNS-verify `notifications.even.in` in Resend; move Vercel function region `iad1` → `bom1`/`sin1`.

## Retrospective

What worked: extracting `getQueueForDoctor()` so the JSON API and the SSR page share one SQL path saved a refactor in Sprint 6 when pause/resume needs the same query. Server actions made the start-encounter / demo-controls flows trivially safe (POST-only, no agent triggering). The encounter editor's 800ms debounced auto-save came together cleanly — saved/saving/error indicator was about 20 lines of state.

What didn't: the `EncounterPage` server component's `params` is now `Promise<{id: string}>` per Next 15.5; an old habit from Next 14 made me write a non-Promise version first, caught by `tsc`. Also: testing Next 15 server actions via curl required extracting the action hash from the rendered HTML and crafting a `Next-Action` POST — not pretty but works.

Sprint 3 (encounter screen + documentation polish) is next.
