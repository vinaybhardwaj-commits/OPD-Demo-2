# EHRC-Daily-Dash reuse map

_Files that lift from the Huddle codebase into OPD-Encounter-App. Source: §8 of `OPD-ENCOUNTER-APP-DESIGN.md`._

## Direct lift (rename + minor adaptation)
- [ ] `src/lib/huddle/offline-queue.ts` → `src/lib/recordings/offline-queue.ts`
- [ ] `src/lib/storage.ts` (full lift, change blob path prefixes only)
- [ ] `src/lib/huddle/speaker-identifier.ts` → simplify for 2-speaker case
- [ ] `src/app/api/huddle/[id]/chunk/route.ts` → `src/app/api/encounters/[id]/recordings/[recordingId]/chunks/route.ts`
- [ ] `src/app/api/huddle/[id]/transcribe/route.ts` → schema adaptation
- [ ] `src/app/api/huddle/[id]/audio/route.ts` → audio streaming endpoint
- [ ] Stale-recording cron pattern for abandoned encounter cleanup

## Selective lift (UI components)
- [ ] Big red record button + encounter timer
- [ ] Chunk-count indicator + upload progress
- [ ] Recording state badge
- [ ] Transcript viewer with speaker labels

## NOT reused (Daily-Dash-specific)
Departments / forms / KPI aggregation, HK module, Sewa module, surgical risk module, WhatsApp insights, async channel, Daily Dashboard routes.

## Realistic reuse fraction
~30–35% of recording-related code lifts wholesale, ~60% of broader UI patterns reused, 0% of Daily Dash domain logic.
