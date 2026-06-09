/**
 * POST /api/encounters/[id]/claim-handoff
 *
 * v2.3 — Multi-doctor handoff claim (pull model).
 *
 * Any signed-in doctor can claim an encounter that has a pending
 * handoff (handoff_note set, handoff_ack_by NULL). The claim:
 *   1. Stamps handoff_ack_by + handoff_ack_at with the claimer.
 *   2. Flips encounter.doctor_id to the claimer (so it shows in their
 *      /dashboard queue going forward).
 *   3. Appends the claimer to contributors_json with via='handoff_claim'.
 *      If contributors_json is still the migration-v23 backfilled
 *      single-entry initial, no need to also append the prior owner —
 *      they're already there.
 *
 * If the claimer is the SAME doctor who originally owned the encounter
 * (e.g. they flagged it, no one else has claimed yet, they change
 * their mind and self-ack), we still stamp handoff_ack but don't
 * shuffle the contributors list — they're already there.
 *
 * Auth: any doctor or admin.
 * Allowed encounter states: anything other than 'completed' (a
 * paused_diagnostics encounter CAN be claimed; the new doctor picks
 * up where the prior one left off).
 *
 * On success the response includes the encounter's room_id so a
 * notifyRoom fires for the SSE listeners.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { notifyRoom } from '@/lib/queueNotify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (session.role !== 'doctor' && session.role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'forbidden_role' }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'bad_id' }, { status: 400 });
  }

  // Claimer's doctors-row id.
  const { rows: meRows } = await pool.query<{ id: string }>(
    `SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1`,
    [session.email],
  );
  const claimerId = meRows[0]?.id;
  if (!claimerId) {
    return NextResponse.json({ ok: false, error: 'doctor_not_seeded' }, { status: 500 });
  }

  // Load encounter + verify there IS a pending handoff.
  const { rows: encRows } = await pool.query<{
    id: string;
    status: string;
    doctor_id: string;
    room_id: string | null;
    handoff_note: string | null;
    handoff_ack_by: string | null;
    contributors_json: Array<{
      doctor_id: string;
      joined_at: string;
      via: string;
    }>;
  }>(
    `SELECT id, status::text AS status, doctor_id, room_id,
            handoff_note, handoff_ack_by, contributors_json
     FROM encounters WHERE id = $1 LIMIT 1`,
    [id],
  );
  const enc = encRows[0];
  if (!enc) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  if (enc.status === 'completed') {
    return NextResponse.json(
      { ok: false, error: 'encounter_completed_immutable' },
      { status: 409 },
    );
  }
  if (!enc.handoff_note) {
    return NextResponse.json(
      { ok: false, error: 'no_pending_handoff' },
      { status: 409 },
    );
  }
  if (enc.handoff_ack_by) {
    return NextResponse.json(
      {
        ok: false,
        error: 'already_claimed',
        detail: `Handoff was already claimed by another doctor.`,
      },
      { status: 409 },
    );
  }

  // Append claimer to contributors_json unless they're already in it.
  const alreadyIn = enc.contributors_json.some(
    (c) => c.doctor_id === claimerId,
  );
  const nextContributors = alreadyIn
    ? enc.contributors_json
    : [
        ...enc.contributors_json,
        {
          doctor_id: claimerId,
          joined_at: new Date().toISOString(),
          via: 'handoff_claim' as const,
        },
      ];

  await pool.query(
    `UPDATE encounters
     SET doctor_id = $2,
         handoff_ack_by = $2,
         handoff_ack_at = NOW(),
         contributors_json = $3::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [id, claimerId, JSON.stringify(nextContributors)],
  );

  await notifyRoom(enc.room_id ?? null, `handoff_claimed:${id}`);

  return NextResponse.json({
    ok: true,
    encounter_id: id,
    new_owner_doctor_id: claimerId,
    self_claim: enc.doctor_id === claimerId,
  });
}
