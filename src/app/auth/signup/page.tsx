/**
 * /auth/signup?invite=<token>
 *
 * Accepts a v2.0.1 invite token. Server-side lookup of the token →
 *   - invalid/expired → renders an error state
 *   - valid → renders a one-button "Accept invite" form. Clicking it
 *     creates the doctors row with the staged role and signs the user
 *     in immediately, redirecting to the role-appropriate home.
 *
 * Public surface — not in middleware's matcher, no auth needed.
 */
import { pool } from '@/lib/db';
import { acceptInviteAction } from './actions';

export const dynamic = 'force-dynamic';

type InviteRow = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  accepted_at: string | null;
  expires_at: string;
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;

  if (!invite) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-even-white-DEFAULT px-6">
        <div className="max-w-sm rounded-xl border border-even-ink-200 bg-white p-6 text-center">
          <p className="text-sm text-even-ink-600">
            No invite token supplied. If you have an invite link, follow it
            directly.
          </p>
        </div>
      </main>
    );
  }

  const { rows } = await pool.query<InviteRow>(
    `SELECT id, email, name, role,
            accepted_at::text AS accepted_at,
            expires_at::text AS expires_at
       FROM invite_tokens WHERE token = $1 LIMIT 1`,
    [invite],
  );
  const row = rows[0];

  if (!row) {
    return <InviteError reason="not_found" />;
  }
  if (row.accepted_at) {
    return <InviteError reason="already_used" />;
  }
  const expiresAtMs = new Date(row.expires_at).getTime();
  if (Number.isFinite(expiresAtMs) && expiresAtMs < Date.now()) {
    return <InviteError reason="expired" />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-even-white-DEFAULT px-6">
      <div className="w-full max-w-sm rounded-xl border border-even-ink-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div
            aria-hidden
            className="h-8 w-8 rounded-full bg-even-blue ring-4 ring-even-blue-100"
          />
          <span className="text-sm font-medium uppercase tracking-[0.18em] text-even-navy">
            Even Hospital
          </span>
        </div>

        <h1 className="mb-2 text-xl font-semibold tracking-tight text-even-navy">
          You've been invited
        </h1>
        <p className="mb-4 text-sm text-even-ink-600">
          Accept the invite to create your Even OPD account.
        </p>

        <dl className="mb-6 space-y-2 rounded-lg border border-even-ink-100 bg-even-ink-50/50 p-3 text-xs">
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-even-ink-500">Email</dt>
            <dd className="font-mono text-sm text-even-navy">{row.email}</dd>
          </div>
          {row.name && (
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-even-ink-500">Name</dt>
              <dd className="text-sm text-even-navy">{row.name}</dd>
            </div>
          )}
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-even-ink-500">Role</dt>
            <dd className="text-sm font-medium uppercase tracking-wider text-even-blue-700">
              {row.role.replace('_', ' ')}
            </dd>
          </div>
        </dl>

        <form action={acceptInviteAction}>
          <input type="hidden" name="token" value={invite} />
          <button
            type="submit"
            className="w-full rounded-lg bg-even-blue px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-even-blue-700"
          >
            Accept & sign in
          </button>
        </form>
      </div>
    </main>
  );
}

function InviteError({ reason }: { reason: 'not_found' | 'expired' | 'already_used' }) {
  const labels: Record<typeof reason, { title: string; body: string }> = {
    not_found: {
      title: 'Invite not found',
      body: 'The invite token is invalid. Ask the admin who invited you to send a fresh link.',
    },
    expired: {
      title: 'Invite expired',
      body: 'This invite is past its expiry date. Ask the admin who invited you to send a fresh one.',
    },
    already_used: {
      title: 'Invite already used',
      body: 'This invite has been accepted. Sign in at /auth/login with your email.',
    },
  };
  const { title, body } = labels[reason];
  return (
    <main className="flex min-h-screen items-center justify-center bg-even-white-DEFAULT px-6">
      <div className="max-w-sm rounded-xl border border-even-pink-200 bg-white p-6">
        <h1 className="mb-2 text-lg font-semibold text-even-pink-900">{title}</h1>
        <p className="text-sm text-even-ink-600">{body}</p>
      </div>
    </main>
  );
}

