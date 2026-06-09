/**
 * OPD-Demo-2 encounter lifecycle — the spine of the redesign.
 *
 * An encounter is no longer one continuous session: it is a state machine
 * spanning N recording sessions, N pause/resume (workup) cycles, background
 * CDMSS processing, and review-later editing. Two INDEPENDENT tracks
 * (borrowed from Evenscribe's "pipeline state != send state" rule):
 *
 *   clinical_status  — the lane the patient is in (what the doctor sees)
 *   processing_status — what the background pipeline is doing
 *
 * A card can be `back_ready` clinically while still `generating` its draft.
 *
 * Mapping from the legacy OPD status enum (kept, lossless):
 *   paused_diagnostics -> out_for_workup · ready_to_resume -> back_ready.
 *
 * See OPD-REDESIGN-WORKFLOW-DESIGN.md §2/§13.1 and migration 40.
 */

export type ClinicalStatus =
  | 'ready'            // triaged, vitals captured, in "To see"
  | 'in_room'          // doctor engaged, possibly recording
  | 'out_for_workup'   // paused on an initial disposition; patient away
  | 'back_ready'       // results returned; patient re-queued
  | 'processing'       // ended; stitch + full note build running
  | 'ready_for_review' // note + CDMSS ready in the Review Queue
  | 'finalizing'       // final disposition submitted; faithful transcription + Rx
  | 'complete'
  | 'cancelled';

export type ProcessingStatus = 'idle' | 'transcribing' | 'generating' | 'ready' | 'errored';

/** Which conversation the encounter is currently in. */
export type EncounterPhase = 'primary' | 'followup' | 'finalizing';

/** Phase of an individual recording session (encounter_sessions.phase). */
export type SessionPhase = 'primary' | 'followup' | 'final_disposition';

export type DispositionPhase = 'initial' | 'intermediate' | 'final';

/**
 * Allowed clinical transitions. Supports N workup cycles:
 *   back_ready -> in_room -> out_for_workup -> back_ready -> …
 * The simple single-visit path is in_room -> processing directly.
 * out_for_workup -> in_room covers "doctor recalls the patient before
 * results land" (results then attach to the follow-up session).
 */
export const CLINICAL_TRANSITIONS: Record<ClinicalStatus, ClinicalStatus[]> = {
  ready: ['in_room', 'cancelled'],
  in_room: ['out_for_workup', 'processing', 'cancelled'],
  out_for_workup: ['back_ready', 'in_room', 'cancelled'],
  back_ready: ['in_room', 'cancelled'],
  processing: ['ready_for_review', 'cancelled'],
  ready_for_review: ['finalizing', 'cancelled'],
  finalizing: ['complete'],
  complete: [],
  cancelled: [],
};

export function canTransition(from: ClinicalStatus, to: ClinicalStatus): boolean {
  return CLINICAL_TRANSITIONS[from]?.includes(to) ?? false;
}

export class LifecycleTransitionError extends Error {
  readonly from: ClinicalStatus;
  readonly to: ClinicalStatus;
  constructor(from: ClinicalStatus, to: ClinicalStatus) {
    super(`invalid clinical transition: ${from} -> ${to}`);
    this.name = 'LifecycleTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function assertTransition(from: ClinicalStatus, to: ClinicalStatus): void {
  if (!canTransition(from, to)) throw new LifecycleTransitionError(from, to);
}

/** Clinic Board lanes (Surface A). */
export type BoardLane = 'to_see' | 'in_workup' | 'back_ready' | 'review_queue' | 'done';

export const LANE_OF: Record<ClinicalStatus, BoardLane> = {
  ready: 'to_see',
  in_room: 'to_see', // shown in "To see" with an in-room badge
  out_for_workup: 'in_workup',
  processing: 'in_workup', // patient gone; work still happening in background
  back_ready: 'back_ready',
  ready_for_review: 'review_queue',
  finalizing: 'review_queue', // badge: finalizing in background
  complete: 'done',
  cancelled: 'done',
};

export const LANE_LABELS: Record<BoardLane, string> = {
  to_see: 'To see',
  in_workup: 'In workup',
  back_ready: 'Back & ready',
  review_queue: 'Review queue',
  done: 'Done',
};

export const LANE_ORDER: BoardLane[] = ['to_see', 'in_workup', 'back_ready', 'review_queue', 'done'];

/** Map a legacy OPD status enum value onto the new clinical lane. */
export function clinicalFromLegacyStatus(legacy: string): ClinicalStatus {
  switch (legacy) {
    case 'registered':
    case 'at_triage':
    case 'waiting_for_doctor':
      return 'ready';
    case 'active':
      return 'in_room';
    case 'paused_diagnostics':
      return 'out_for_workup';
    case 'ready_to_resume':
      return 'back_ready';
    case 'completed':
      return 'complete';
    default:
      return 'ready';
  }
}
