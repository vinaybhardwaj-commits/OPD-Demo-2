/**
 * /admin/rooms — OPD room CRUD (v2.0.2.1).
 *
 * Lists all rooms with inline-edit forms (name, floor, specialty, default
 * doctor select). Active toggle per row. Add-room form at the bottom.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { pool } from '@/lib/db';
import { actionUpsertRoom, actionToggleActive } from './actions';

export const dynamic = 'force-dynamic';

type RoomRow = {
  id: string;
  name: string;
  floor: string | null;
  specialty: string | null;
  default_doctor_id: string | null;
  active: boolean;
};

type DoctorRow = { id: string; name: string; specialty: string | null };

export default async function AdminRoomsPage() {
  const session = await getCurrentUser();
  if (!session) redirect('/auth/login');

  const [roomsRes, doctorsRes] = await Promise.all([
    pool.query<RoomRow>(
      `SELECT id, name, floor, specialty, default_doctor_id, active
         FROM opd_rooms ORDER BY name ASC`,
    ),
    pool.query<DoctorRow>(
      `SELECT id, name, COALESCE(mci_registration_number, '') AS specialty
         FROM doctors WHERE role = 'doctor' ORDER BY name ASC`,
    ),
  ]);

  return (
    <main className="min-h-screen bg-even-white-DEFAULT">
      <header className="border-b border-even-ink-100 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link
            href="/dashboard"
            className="text-xs font-medium uppercase tracking-wider text-even-ink-500 hover:text-even-navy"
          >
            ← Back
          </Link>
          <span className="text-[10px] font-mono text-even-ink-400">admin · rooms</span>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-6 py-8">
        <p className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-even-blue-700">
          v2.0.2 · M1
        </p>
        <h1 className="mb-2 text-2xl font-semibold tracking-tight text-even-navy">
          OPD rooms
        </h1>
        <p className="mb-8 text-sm text-even-ink-600">
          Edit room metadata or assign a different default doctor. The CCE
          workstation (v2.0.3) uses this list when registering patients.
        </p>

        {/* Existing rooms */}
        <div className="mb-8 space-y-3">
          {roomsRes.rows.map((r) => (
            <RoomCard key={r.id} room={r} doctors={doctorsRes.rows} />
          ))}
        </div>

        {/* Add new room */}
        <div className="rounded-xl border border-even-blue-200 bg-even-blue-50/40 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-even-navy">
            Add a new room
          </h2>
          <form action={actionUpsertRoom} className="grid gap-3 sm:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-even-ink-500">
                Name
              </span>
              <input
                name="name"
                required
                placeholder="OPD-11"
                className="w-full rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm focus:border-even-blue focus:outline-none focus:ring-2 focus:ring-even-blue-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-even-ink-500">
                Floor
              </span>
              <input
                name="floor"
                placeholder="2nd floor"
                className="w-full rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-even-ink-500">
                Specialty
              </span>
              <input
                name="specialty"
                placeholder="ENT"
                className="w-full rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-even-ink-500">
                Default doctor
              </span>
              <select
                name="default_doctor_id"
                className="w-full rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">— None —</option>
                {doctorsRes.rows.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-flex items-center gap-2 sm:col-span-2">
              <input type="checkbox" name="active" defaultChecked />
              <span className="text-xs text-even-ink-600">Active</span>
            </label>
            <div className="sm:col-span-4">
              <button
                type="submit"
                className="rounded-lg bg-even-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-even-blue-700"
              >
                Add room
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}

function RoomCard({ room, doctors }: { room: RoomRow; doctors: DoctorRow[] }) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        room.active ? 'border-even-ink-200 bg-white' : 'border-even-ink-200 bg-even-ink-50/60 opacity-70'
      }`}
    >
      <form action={actionUpsertRoom} className="grid gap-3 sm:grid-cols-5">
        <input type="hidden" name="id" value={room.id} />
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-even-ink-500">
            Name
          </span>
          <input
            name="name"
            required
            defaultValue={room.name}
            className="w-full rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm font-semibold"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-even-ink-500">
            Floor
          </span>
          <input
            name="floor"
            defaultValue={room.floor ?? ''}
            className="w-full rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-even-ink-500">
            Specialty
          </span>
          <input
            name="specialty"
            defaultValue={room.specialty ?? ''}
            className="w-full rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-even-ink-500">
            Default doctor
          </span>
          <select
            name="default_doctor_id"
            defaultValue={room.default_doctor_id ?? ''}
            className="w-full rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm"
          >
            <option value="">— None —</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <label className="inline-flex items-center gap-2 text-xs text-even-ink-600">
            <input type="checkbox" name="active" defaultChecked={room.active} />
            <span>Active</span>
          </label>
        </div>
        <div className="sm:col-span-5">
          <button
            type="submit"
            className="rounded-md bg-even-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-even-blue-700"
          >
            Save changes
          </button>
        </div>
      </form>
    </div>
  );
}
