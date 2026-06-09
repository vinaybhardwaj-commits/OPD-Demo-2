/**
 * <RegisterPatientModal> — CCE patient registration flow (v2.0.3.2).
 *
 * UX:
 *   1. Phone-search field at the top. 150ms debounced lookup via
 *      /api/patients/search.
 *   2. If a match appears, CCE clicks it → form below pre-fills with
 *      that patient's name, age, sex, phone, allergies (locked, hint:
 *      "Existing patient · loaded from chart").
 *   3. If no match (or CCE clicks "Use a new patient instead"), the
 *      form below is blank and editable.
 *   4. Always required: intake reason (free text + 6 quick chips).
 *   5. Always required: room assignment (select shows current queue
 *      count per room).
 *   6. Submit calls the server action; modal closes on success.
 *
 * Escape closes; click backdrop closes. Disabled-while-submitting.
 */
'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { actionRegisterPatient } from '@/app/reception/actions';

type Match = {
  id: string;
  mrn: string;
  name: string;
  age_years: number;
  sex: 'M' | 'F' | 'O' | null;
  phone_e164: string | null;
  known_allergies: string | null;
};

type Room = {
  id: string;
  name: string;
  doctor_name: string | null;
  queue_count: number;
};

const QUICK_REASONS = [
  'BP follow-up',
  'Diabetes follow-up',
  'Fever',
  'Cough / cold',
  'Body ache',
  'Annual check-up',
];

export function RegisterPatientModal({ rooms }: { rooms: Room[] }) {
  const [open, setOpen] = useState(false);
  const [phoneQuery, setPhoneQuery] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [picked, setPicked] = useState<Match | null>(null);
  const [reason, setReason] = useState('');
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    setPhoneQuery('');
    setMatches([]);
    setPicked(null);
    setReason('');
    setRoomId(rooms[0]?.id ?? '');
    setError(null);
  }, [rooms]);

  const close = useCallback(() => {
    if (pending) return;
    setOpen(false);
    setTimeout(reset, 200);
  }, [pending, reset]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Debounced phone search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (phoneQuery.trim().length < 2) {
      setMatches([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/patients/search?q=${encodeURIComponent(phoneQuery.trim())}`,
          { cache: 'no-store' },
        );
        if (!r.ok) {
          setMatches([]);
          return;
        }
        const j = (await r.json()) as { matches?: Match[] };
        setMatches(j.matches ?? []);
      } catch {
        setMatches([]);
      }
    }, 150);
  }, [phoneQuery]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    const fd = new FormData(e.currentTarget);
    if (picked) fd.set('existing_patient_id', picked.id);
    if (!fd.get('intake_visit_reason')) {
      setError('Please enter the visit reason.');
      return;
    }
    if (!fd.get('room_id')) {
      setError('Please pick a room.');
      return;
    }
    startTransition(async () => {
      try {
        await actionRegisterPatient(fd);
        close();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Registration failed.');
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-even-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-even-blue-700"
      >
        + Register patient
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            aria-hidden
            onClick={close}
            className="fixed inset-0 z-40 bg-black/30"
          />
          {/* Modal */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Register patient"
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
          >
            <div className="my-8 w-full max-w-2xl rounded-2xl border border-even-ink-200 bg-white p-6 shadow-2xl">
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="text-xl font-semibold tracking-tight text-even-navy">
                  Register patient
                </h2>
                <button
                  type="button"
                  onClick={close}
                  disabled={pending}
                  aria-label="Close"
                  className="rounded-md border border-even-ink-200 bg-white px-2 py-1 text-xs text-even-ink-500 hover:text-even-navy disabled:opacity-50"
                >
                  ✕
                </button>
              </div>

              {/* Phone search */}
              <div className="mb-4">
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-even-ink-500">
                  Search existing patient (phone / name / MRN)
                </label>
                <input
                  type="search"
                  value={phoneQuery}
                  onChange={(e) => setPhoneQuery(e.target.value)}
                  placeholder="9844112233 or Mohan Rao"
                  className="w-full rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm focus:border-even-blue focus:outline-none focus:ring-2 focus:ring-even-blue-100"
                />
                {matches.length > 0 && !picked && (
                  <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-even-ink-200 bg-white shadow-sm">
                    {matches.map((m) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setPicked(m);
                            setMatches([]);
                            setPhoneQuery(m.name);
                          }}
                          className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-even-blue-50"
                        >
                          <span>
                            <span className="font-medium text-even-navy">
                              {m.name}
                            </span>
                            <span className="ml-1 text-[10px] uppercase tracking-wider text-even-ink-500">
                              {m.age_years}
                              {m.sex ?? ''} ·{' '}
                              <span className="font-mono">{m.mrn}</span>
                            </span>
                          </span>
                          {m.phone_e164 && (
                            <span className="font-mono text-[10px] text-even-ink-400">
                              {m.phone_e164}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {picked && (
                  <div className="mt-2 flex items-center justify-between rounded-lg border border-even-blue-200 bg-even-blue-50 px-3 py-2 text-xs">
                    <span>
                      <span className="font-semibold text-even-blue-800">
                        Existing patient
                      </span>{' '}
                      · loaded from chart
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setPicked(null);
                        setPhoneQuery('');
                      }}
                      className="text-[10px] uppercase tracking-wider text-even-blue-700 hover:underline"
                    >
                      Use a new patient instead
                    </button>
                  </div>
                )}
              </div>

              <form onSubmit={onSubmit} className="space-y-4">
                {/* Patient fields */}
                <fieldset
                  className="grid grid-cols-2 gap-3 rounded-lg border border-even-ink-100 bg-even-ink-50/40 p-3"
                  disabled={pending}
                >
                  <legend className="px-1 text-[10px] uppercase tracking-wider text-even-ink-500">
                    Patient
                  </legend>
                  <label className="block">
                    <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-even-ink-500">
                      Name
                    </span>
                    <input
                      name="name"
                      required={!picked}
                      readOnly={!!picked}
                      defaultValue={picked?.name ?? ''}
                      key={`name-${picked?.id ?? 'new'}`}
                      className="w-full rounded-md border border-even-ink-200 bg-white px-2 py-1.5 text-sm read-only:bg-even-ink-50 read-only:text-even-ink-500"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-even-ink-500">
                      Phone
                    </span>
                    <input
                      name="phone_e164"
                      type="tel"
                      required={!picked}
                      readOnly={!!picked}
                      defaultValue={picked?.phone_e164 ?? ''}
                      key={`phone-${picked?.id ?? 'new'}`}
                      placeholder="+919844..."
                      className="w-full rounded-md border border-even-ink-200 bg-white px-2 py-1.5 text-sm read-only:bg-even-ink-50 read-only:text-even-ink-500"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-even-ink-500">
                      Age (years)
                    </span>
                    <input
                      name="age_years"
                      type="number"
                      min={0}
                      max={120}
                      required={!picked}
                      readOnly={!!picked}
                      defaultValue={picked?.age_years ?? ''}
                      key={`age-${picked?.id ?? 'new'}`}
                      className="w-full rounded-md border border-even-ink-200 bg-white px-2 py-1.5 text-sm read-only:bg-even-ink-50 read-only:text-even-ink-500"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-even-ink-500">
                      Sex
                    </span>
                    <select
                      name="sex"
                      required={!picked}
                      disabled={!!picked}
                      defaultValue={picked?.sex ?? ''}
                      key={`sex-${picked?.id ?? 'new'}`}
                      className="w-full rounded-md border border-even-ink-200 bg-white px-2 py-1.5 text-sm disabled:bg-even-ink-50 disabled:text-even-ink-500"
                    >
                      <option value="">—</option>
                      <option value="M">Male</option>
                      <option value="F">Female</option>
                      <option value="O">Other</option>
                    </select>
                  </label>
                  <label className="col-span-2 block">
                    <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-even-ink-500">
                      Known allergies (optional)
                    </span>
                    <input
                      name="known_allergies"
                      readOnly={!!picked}
                      defaultValue={picked?.known_allergies ?? ''}
                      key={`allergies-${picked?.id ?? 'new'}`}
                      placeholder="e.g., Penicillin (rash, 2018)"
                      className="w-full rounded-md border border-even-ink-200 bg-white px-2 py-1.5 text-sm read-only:bg-even-ink-50 read-only:text-even-ink-500"
                    />
                  </label>
                </fieldset>

                {/* Intake reason */}
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-wider text-even-ink-500">
                    Visit reason
                  </label>
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {QUICK_REASONS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setReason(r)}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                          reason === r
                            ? 'bg-even-blue text-white shadow-sm'
                            : 'bg-white text-even-navy ring-1 ring-even-ink-200 hover:ring-even-blue-300'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  <input
                    name="intake_visit_reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                    placeholder="What brings them in today?"
                    className="w-full rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm"
                  />
                </div>

                {/* Room select */}
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-wider text-even-ink-500">
                    Assign to room
                  </label>
                  <select
                    name="room_id"
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                    required
                    className="w-full rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm"
                  >
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                        {r.doctor_name ? ` · ${r.doctor_name}` : ''}{' '}
                        ({r.queue_count} ahead)
                      </option>
                    ))}
                  </select>
                </div>

                {error && (
                  <div className="rounded-md border border-even-pink-200 bg-even-pink-50 px-3 py-2 text-xs text-even-pink-800">
                    {error}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={close}
                    disabled={pending}
                    className="rounded-lg border border-even-ink-200 bg-white px-4 py-2 text-sm font-medium text-even-ink-600 hover:text-even-navy disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={pending}
                    className="rounded-lg bg-even-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-even-blue-700 disabled:cursor-wait disabled:opacity-60"
                  >
                    {pending ? 'Registering…' : 'Register & send to triage'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}
    </>
  );
}
