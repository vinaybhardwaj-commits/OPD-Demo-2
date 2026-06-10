/**
 * Encounter Room loader (Surface B) — OPD-Demo-2 P1.1.
 * Lean fetch for the capture surface: identity strip + lifecycle +
 * sessions. The full structured-note editor stays on the classic page
 * until the dual-input merge (P1.3+).
 */
import { pool } from '@/lib/db';
import type { ClinicalStatus, ProcessingStatus, EncounterPhase, SessionPhase } from '@/lib/lifecycle';

export type RoomSession = {
  id: string;
  seq: number;
  phase: SessionPhase;
  status: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  detected_language: string | null;
  transcribed_at: string | null;
  transcribe_error: string | null;
  speaker_count: number | null;
  tagged_turns: number | null;
  diarized_at: string | null;
  diarize_error: string | null;
  note_generated_at: string | null;
  note_error: string | null;
};

export type RoomEncounter = {
  id: string;
  encounter_number: string;
  clinical_status: ClinicalStatus;
  processing_status: ProcessingStatus;
  current_phase: EncounterPhase;
  started_at: string | null;
  chief_complaint: string | null;
  intake_visit_reason: string | null;
  vitals: Record<string, unknown> | null;
  patient_id: string;
  patient_name: string;
  patient_mrn: string;
  age_years: number;
  sex: string | null;
  known_allergies: string | null;
  sessions: RoomSession[];
};

export async function loadRoomEncounter(id: string): Promise<RoomEncounter | null> {
  const { rows } = await pool.query(
    `SELECT e.id, e.encounter_number, e.clinical_status, e.processing_status,
            e.current_phase, e.started_at::text AS started_at,
            COALESCE(e.chief_complaint_text, array_to_string(e.chief_complaint_chips, ', ')) AS chief_complaint,
            e.intake_visit_reason, e.vitals,
            p.id AS patient_id, p.name AS patient_name, p.mrn AS patient_mrn,
            p.age_years, p.sex, p.known_allergies
     FROM encounters e
     JOIN patients p ON p.id = e.patient_id
     WHERE e.id = $1`,
    [id],
  );
  if (rows.length === 0) return null;

  const { rows: sessions } = await pool.query(
    `SELECT id, seq, phase, status, started_at::text AS started_at,
            ended_at::text AS ended_at, duration_seconds, detected_language,
            transcribed_at::text AS transcribed_at, transcribe_error,
            jsonb_array_length(speakers_json) AS speaker_count,
            jsonb_array_length(tagged_transcript) AS tagged_turns,
            diarized_at::text AS diarized_at, diarize_error,
            note_generated_at::text AS note_generated_at, note_error
     FROM encounter_sessions
     WHERE encounter_id = $1
     ORDER BY seq`,
    [id],
  );

  return { ...(rows[0] as Omit<RoomEncounter, 'sessions'>), sessions: sessions as RoomSession[] };
}
