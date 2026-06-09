/**
 * /admin/users — invite + manage users (v2.0.1.2).
 *
 * Minimum-viable surface that lets an admin:
 *  1. See the existing users list grouped by role
 *  2. Generate an invite token for a new user (email + name + role)
 *  3. Copy the resulting signup URL to share manually (until Resend is wired)
 *  4. See pending invites and revoke them
 *
 * Full user-management (deactivate, role-change, audit log) lands in v2.0.2
 * along with /admin/rooms.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { pool } from '@/lib/db';
import {
  actionCreateInvite,
  actionRevokeInvite,
  actionChangeRole,
  actionDeactivate,
  actionReactivate,
} from './actions';

export const dynamic = 'force-dynamic';

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
  deactivated_at: string | null;
};

type InviteRow = {
  id: string;
  token: string;
  email: string;
  name: string | null;
  role: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
};

export default async function AdminUsersPage() {
  const session = await getCurrentUser();
  if (!session) redirect('/auth/login');

  const [usersRes, invitesRes] = await Promise.all([
    pool.query<UserRow>(
      `SELECT id, email, name, role,
              created_at::text AS created_at,
              deactivated_at::text AS deactivated_at
         FROM doctors ORDER BY role ASC, name ASC`,
    ),
    pool.query<InviteRow>(
      `SELECT id, token, email, name, role,
              created_at::text AS created_at,
              expires_at::text AS expires_at,
              accepted_at::text AS accepted_at
         FROM invite_tokens
        WHERE accepted_at IS NULL AND expires_at > NOW()
        ORDER BY created_at DESC`,
    ),
  ]);

  const usersByRole = new Map<string, UserRow[]>();
  for (const u of usersRes.rows) {
    const k = u.role;
    if (!usersByRole.has(k)) usersByRole.set(k, []);
    usersByRole.get(k)!.push(u);
  }

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
          <span className="text-[10px] font-mono text-even-ink-400">
            admin · users
          </span>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-6 py-8">
        <p className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-even-blue-700">
          v2.0.1 · M2
        </p>
        <h1 className="mb-2 text-2xl font-semibold tracking-tight text-even-navy">
          Users & invites
        </h1>
        <p className="mb-8 text-sm text-even-ink-600">
          Generate magic-link invites for staff. Full CRUD lands in v2.0.2.
        </p>

        {/* Invite form */}
        <div className="mb-8 rounded-xl border border-even-blue-200 bg-even-blue-50/40 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-even-navy">
            New invite
          </h2>
          <form action={actionCreateInvite} className="grid gap-3 sm:grid-cols-4">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-even-ink-500">
                Email
              </span>
              <input
                name="email"
                type="email"
                required
                placeholder="someone@even.in"
                className="w-full rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm focus:border-even-blue focus:outline-none focus:ring-2 focus:ring-even-blue-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-even-ink-500">
                Name (optional)
              </span>
              <input
                name="name"
                type="text"
                placeholder="Full name"
                className="w-full rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm focus:border-even-blue focus:outline-none focus:ring-2 focus:ring-even-blue-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-even-ink-500">
                Role
              </span>
              <select
                name="role"
                required
                defaultValue="doctor"
                className="w-full rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm"
              >
                <option value="doctor">Doctor</option>
                <option value="nurse">Triage Nurse</option>
                <option value="cce">CCE</option>
                <option value="lab_tech">Lab Tech</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <div className="sm:col-span-4">
              <button
                type="submit"
                className="rounded-lg bg-even-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-even-blue-700"
              >
                Generate invite
              </button>
            </div>
          </form>
        </div>

        {/* Pending invites */}
        {invitesRes.rows.length > 0 && (
          <div className="mb-8 rounded-xl border border-even-ink-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-even-navy">
              Pending invites ({invitesRes.rows.length})
            </h2>
            <ul className="space-y-2">
              {invitesRes.rows.map((iv) => (
                <li
                  key={iv.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-even-blue-100 bg-even-blue-50/30 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-even-navy">
                      {iv.email}
                      <span className="ml-2 rounded-full border border-even-blue-200 bg-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-even-blue-700">
                        {iv.role}
                      </span>
                    </div>
                    {iv.name && (
                      <div className="text-[11px] text-even-ink-500">{iv.name}</div>
                    )}
                    <div className="mt-1 text-[10px] text-even-ink-500">
                      Expires {iv.expires_at}
                    </div>
                    <code className="mt-1 block break-all rounded-md bg-white px-2 py-1 text-[10px] text-even-ink-600">
                      /auth/signup?invite={iv.token}
                    </code>
                  </div>
                  <form action={actionRevokeInvite}>
                    <input type="hidden" name="id" value={iv.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-even-pink-200 bg-even-pink-50 px-2 py-1 text-[10px] font-semibold text-even-pink-800 hover:bg-even-pink-100"
                    >
                      Revoke
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Users list */}
        <div className="rounded-xl border border-even-ink-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-even-navy">
            All users ({usersRes.rows.length})
          </h2>
          {['doctor', 'nurse', 'cce', 'lab_tech', 'admin'].map((role) => {
            const list = usersByRole.get(role) ?? [];
            if (list.length === 0) return null;
            return (
              <div key={role} className="mb-4 last:mb-0">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-even-ink-500">
                  {role.replace('_', ' ')} ({list.length})
                </p>
                <ul className="space-y-1">
                  {list.map((u) => (
                    <UserRowControls key={u.id} user={u} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function UserRowControls({ user }: { user: UserRow }) {
  const isDeactivated = !!user.deactivated_at;
  return (
    <li
      className={`flex flex-wrap items-center justify-between gap-3 rounded border px-3 py-1.5 text-sm ${
        isDeactivated
          ? 'border-even-ink-200 bg-even-ink-50/60 opacity-70'
          : 'border-even-ink-100 bg-white'
      }`}
    >
      <div className="min-w-0 flex-1">
        <span className="font-medium text-even-navy">{user.name}</span>
        <span className="ml-2 font-mono text-[11px] text-even-ink-500">{user.email}</span>
        {isDeactivated && (
          <span className="ml-2 rounded-full border border-even-pink-200 bg-even-pink-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-even-pink-800">
            deactivated
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <form action={actionChangeRole}>
          <input type="hidden" name="user_id" value={user.id} />
          <select
            name="role"
            defaultValue={user.role}
            className="rounded-md border border-even-ink-200 bg-white px-2 py-1 text-xs"
          >
            <option value="doctor">doctor</option>
            <option value="nurse">nurse</option>
            <option value="cce">cce</option>
            <option value="lab_tech">lab_tech</option>
            <option value="admin">admin</option>
          </select>
          <button
            type="submit"
            className="ml-1 rounded-md border border-even-ink-200 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-even-ink-600 hover:border-even-ink-300 hover:text-even-navy"
          >
            Save
          </button>
        </form>
        {isDeactivated ? (
          <form action={actionReactivate}>
            <input type="hidden" name="user_id" value={user.id} />
            <button
              type="submit"
              className="rounded-md border border-even-blue-200 bg-even-blue-50 px-2 py-1 text-[10px] font-semibold text-even-blue-800 hover:bg-even-blue-100"
            >
              Reactivate
            </button>
          </form>
        ) : (
          <form action={actionDeactivate}>
            <input type="hidden" name="user_id" value={user.id} />
            <button
              type="submit"
              className="rounded-md border border-even-pink-200 bg-even-pink-50 px-2 py-1 text-[10px] font-semibold text-even-pink-800 hover:bg-even-pink-100"
            >
              Deactivate
            </button>
          </form>
        )}
      </div>
    </li>
  );
}
