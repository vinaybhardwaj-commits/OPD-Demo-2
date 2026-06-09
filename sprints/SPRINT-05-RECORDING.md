# Sprint 5 — Recording infrastructure

**Status:** complete
**Started:** 2026-05-18
**Completed:** 2026-05-18
**Days budget:** 5-6
**Days actual:** 1 (continuous from Sprint 4)
**Ship tag:** `sprint-5-shipped`

## Scope (from design doc §8)

Huddle-codebase reuse (offline queue, chunk upload, audio streaming, Deepgram + diarization, big red record button). Deliverable: real audio capture with real transcription.

## Deliverables — what shipped

| Milestone | Commit | Deliverable |
|---|---|---|
| **M5.1** | `730e885` + `d6e59ce` | Infrastructure: `@vercel/blob@2.3.3` dependency, Vercel Blob store `opd-encounter-app-blob` (sin1, private), `DEEPGRAM_API_KEY` copied from EHRC project. `src/lib/transcribe.ts` Deepgram client (nova-3-medical, en-IN). `POST /api/encounters/[id]/dictations` now accepts `multipart/form-data` audio → uploads to Blob → transcribes inline → stores row with `audio_blob_url` + `transcript_text`. `<DictateButton>` does real MediaRecorder capture, surfaces mic-permission errors, calls `onTranscript` → parent's section field auto-fills via new `appendTranscript()` helper. |
| **M5.2** | `2ccd4a7` | `GET/POST /api/encounters/[id]/recordings`. Snippet index auto-allocates as MAX+1 (Sprint 6's pause/resume increments naturally). Single-blob-per-snippet pattern (chunked offline-queue uploads land in Sprint 8 polish). `<AmbientRecorder>` "big red record button" mounted in encounter header next to the timer per design doc §4.2 — 10s timeslice MediaRecorder, full blob on stop, pulsing pink dot during recording. `<TranscriptViewer>` collapsible panel at the foot of the editor: snippet list with status chips (pending/complete/failed) + transcripts, refreshable via imperative handle so the recorder triggers a re-fetch on each snippet save. |

## Live URLs (auth required)

- **Encounter (with M5 components):** `/dashboard/encounters/[id]` — the encounter header now hosts the AmbientRecorder; the transcript panel collapses below the sections.
- **Section dictations API:** `/api/encounters/[id]/dictations` (multipart for audio)
- **Ambient recordings API:** `/api/encounters/[id]/recordings`

## Verified end-to-end (smoke)

1. Silent 1s WAV → multipart POST `/dictations` → HTTP 200, audio uploaded to private Blob, Deepgram returned `""` in 568ms, row written with `audio_blob_url` + empty transcript_text (correct for silent input)
2. Silent WAV → POST `/recordings` (3s) → snippet_index=0, status=complete, 1 chunk row
3. Second snippet → snippet_index=1 (auto-incremented), parallel structure to #1
4. `GET /recordings` → 2 rows with correct status + chunk counts
5. Encounter page renders HTTP 200 with all M5 surfaces

## Bugs found in sprint sweep

| # | Where | Fix |
|---|---|---|
| 1 | First put() failed: 'Cannot use public access on a private store' | `@vercel/blob@0.27` only accepted `access: 'public'`. Bumped to 2.3.3 which accepts `access: 'private'` for private stores. |
| 2 | npm install ENOTEMPTY on virtiofs rename | Installed `@vercel/blob` standalone in `/tmp/blob-install`, copied dist + transitive deps into Pulse/node_modules manually; updated package-lock via `--package-lock-only`. Same Cowork pattern we may need again next time virtiofs blocks a dep update. |

## Carry-overs into Sprint 6 (Pause / resume choreography)

- Pause / send-to-diagnostics modal + resume banner — the design doc §4.3 + §4.4 + §5 spec is locked, the schema already supports multi-snippet recording. Sprint 6 will increment snippet_index on resume + add the choreography UI.
- The `Sprint 8 retry` mention in the failed-transcript UI promise — Sprint 8 polish needs a recordings-retry admin tool for failed snippets.
- Chunked offline-queue upload pattern (Huddle codebase reuse) is deferred to Sprint 8. For pilot demo the single-blob path is sufficient; production needs the chunked path for resilience against tab crashes.
- Older carryovers still open: DNS-verify `notifications.even.in` in Resend; Vercel function region `iad1` → `bom1`/`sin1`; remove now-unused `ALLOWED_DOCTOR_EMAILS` env var.

## Retrospective

What worked: Deepgram's `nova-3-medical` model accepting audio bytes directly via POST kept the surface area small — no SDK, no async polling, just a fetch. The `<DictateButton>` from M3.3 swapped cleanly to real audio without changing its public API: the section editor's wiring of `onTranscript` was the only addition. `<TranscriptViewer>` using `useImperativeHandle` for refresh meant the recorder didn't need to know about the viewer.

What didn't: virtiofs blocked the standard `npm install` because of color-convert / bufferutil rename conflicts — had to install `@vercel/blob` standalone in `/tmp` and copy files in manually. Also: `@vercel/blob@0.27` (latest at the start of Sprint 5) didn't yet support private-access put() — bumped to 2.3.3.

Sprint 6 (pause/resume choreography) is next.
