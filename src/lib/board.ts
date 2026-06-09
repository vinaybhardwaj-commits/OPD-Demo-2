/**
 * Clinic Board fetcher (Surface A) — OPD-Demo-2 P0.4 shell.
 *
 * One query feeds the lifecycle lane board: every encounter that is
 * either from today or still in flight, bucketed into the five lanes
 * via LANE_OF. The legacy /dashboard queue remains untouched (lossless);
 * the board reads the NEW two-track columns from migration 40.
 */
import { pool } from '@/lib/db';
import {
  LANE_OF,
  LANE_ORDER,
  type BoardLane,
  type ClinicalStatus,
  type ProcessingStatus,
  type EncounterPhase,
} from '@/lib/lifecycle';

export type BoardCard = {
  id: string;
  encounter_number: string;
  clinical_status: ClinicalStatus;
  processing_status: ProcessingStatus;
  current_phase: EncounterPhase;
  started_at: string | null;
  chief_complaint: string | null;
  patient_name: string;
  age_years: number;
  sex: string | null;
  session_count: number;
  has_note_draft: boolean;
};

export type BoardLanes = Record<BoardLane, BoardCard[]>;

export async function getBoard(): Promise<BoardLanes> {
  const { rows } = await pool.query<{
    id: string;
    encounter_number: string;
    clinical_status: ClinicalStatus;
    processing_status: ProcessingStatus;
    current_phase: EncounterPhase;
    started_at: string | null;
    chief_complaint: string | null;
    patient_name: string;
    age_years: number;
    sex: string | null;
    session_count: string;
    has_note_draft: boolean;
  }>(
    `SELECT
       e.id,
       e.encounter_number,
       e.clinical_status,
       e.processing_status,
       e.current_phase,
       e.started_at::text AS started_at,
       COALESCE(e.chief_complaint_text, array_to_string(e.chief_complaint_chips, ', ')) AS chief_complaint,
       p.name AS patient_name,
       p.age_years,
       p.sex,
       (SELECT COUNT(*) FROM encounter_sessions s WHERE s.encounter_id = e.id)::text AS session_count,
       (e.note_json IS NOT NULL) AS has_note_draft
     FROM encounters e
     JOIN patients p ON p.id = e.patient_id
     WHERE e.clinical_status IS NOT NULL
       AND (e.encounter_date = CURRENT_DATE
            OR e.clinical_status NOT IN ('complete','cancelled'))
     ORDER BY e.started_at DESC NULLS LAST
     LIMIT 200`,
  );

  const lanes: BoardLanes = { to_see: [], in_workup: [], back_ready: [], review_queue: [], done: [] };
  for (const r of rows) {
    const lane = LANE_OF[r.clinical_status] ?? 'to_see';
    lanes[lane].push({ ...r, session_count: Number(r.session_count) });
  }
  // Done lane reads newest-first already; active lanes oldest-first (aging).
  for (const lane of LANE_ORDER) {
    if (lane !== 'done') lanes[lane].reverse();
  }
  return lanes;
}
