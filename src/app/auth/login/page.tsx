/**
 * /auth/login — doctor sign-in entry point.
 *
 * Email-only magic-link form. Submits via client fetch to /api/auth/request,
 * then shows a "check your email" success state. Honors ?error= and
 * ?signed_out=1 query params for redirected-back flows.
 */
'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const e = params.get('error');
    if (e === 'invalid_or_expired') {
      setError('That sign-in link is invalid or has expired. Request a new one.');
    } else if (e === 'not_authorized') {
      setError('This email is not authorized for the OPD Encounter App.');
    } else if (e === 'wrong_role') {
      const attempted = params.get('attempted') ?? '';
      setError(
        `You don't have access to ${attempted}. Sign in with an account that has the right role for that surface.`,
      );
    }
  }, [params]);

  const signedOut = params.get('signed_out') === '1';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || j.error) {
        setError(j.error ?? 'Something went wrong. Try again.');
        return;
      }
      setSent(true);
    } catch {
      setError('Network error. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-even-white-DEFAULT px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <div
            aria-hidden
            className="h-8 w-8 rounded-full bg-even-blue ring-4 ring-even-blue-100"
          />
          <span className="text-sm font-medium uppercase tracking-[0.18em] text-even-navy">
            Even Hospital
          </span>
        </div>

        <h1 className="mb-2 text-2xl font-semibold tracking-tight text-even-navy">
          Sign in
        </h1>
        <p className="mb-8 text-sm text-even-ink-600">
          Enter your doctor email. We&apos;ll send you a sign-in link.
        </p>

        {sent ? (
          <div className="rounded-lg border border-even-blue-100 bg-even-blue-50 p-4 text-sm text-even-navy">
            <div className="mb-1 font-medium">Check your inbox.</div>
            <div className="text-even-ink-600">
              We sent a sign-in link to <span className="font-mono">{email}</span>.
              It expires in 15 minutes.
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-even-ink-500">
                Email
              </span>
              <input
                type="email"
                required
                autoFocus
                placeholder="you@even.in"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                className="w-full rounded-lg border border-even-ink-200 bg-white px-3 py-2.5 text-sm text-even-navy placeholder-even-ink-300 focus:border-even-blue focus:outline-none focus:ring-2 focus:ring-even-blue-100"
              />
            </label>

            {error && (
              <div className="rounded-md border border-even-pink-200 bg-even-pink-50 px-3 py-2 text-xs text-even-pink-800">
                {error}
              </div>
            )}

            {signedOut && !error && (
              <div className="rounded-md border border-even-ink-200 bg-even-ink-50 px-3 py-2 text-xs text-even-ink-600">
                You&apos;ve been signed out.
              </div>
            )}

            <button
              type="submit"
              disabled={busy || !email}
              className="w-full rounded-lg bg-even-blue px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 hover:bg-even-blue-700 focus:outline-none focus:ring-2 focus:ring-even-blue-100 focus:ring-offset-2"
            >
              {busy ? 'Sending…' : 'Send sign-in link'}
            </button>
          </form>
        )}

        {/* Demo role picker — disappears when DEMO_MODE=false on Vercel.
            One click per role signs you in as a seeded user and lands you
            on that role's home surface. Lets a non-Even visitor walk the
            full multi-actor v2 flow without needing real credentials. */}
        {!sent && (
          <div className="mt-6 border-t border-even-ink-100 pt-5">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-even-ink-400">
              Demo — try as any role
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <DemoButton
                role=""
                tone="navy"
                emoji="🩺"
                label="Doctor"
                who="Dr Vinay"
                surface="/dashboard"
              />
              <DemoButton
                role="cce"
                tone="blue"
                emoji="📋"
                label="CCE"
                who="Lalitha Krishnan"
                surface="/reception"
              />
              <DemoButton
                role="nurse"
                tone="amber"
                emoji="💉"
                label="Triage nurse"
                who="first seeded"
                surface="/triage"
              />
              <DemoButton
                role="lab_tech"
                tone="pink"
                emoji="🧪"
                label="Lab tech"
                who="Ramesh Kumar"
                surface="/lab"
              />
              <div className="sm:col-span-2">
                <DemoButton
                  role="admin"
                  tone="ink"
                  emoji="⚙️"
                  label="Admin (superuser)"
                  who="admin@even.in"
                  surface="/admin"
                />
              </div>
            </div>
            <p className="mt-3 text-[10px] text-even-ink-400">
              Each button signs you in as that role&apos;s seeded user
              and lands on the matching workstation. Real pilot doctors
              will use the magic link once{' '}
              <span className="font-mono">notifications.even.in</span>{' '}
              DNS is verified.
            </p>
            <a
              href="/demo/drug-ddi"
              className="mt-4 inline-flex w-full items-center justify-center rounded-lg border border-even-blue-200 bg-white px-4 py-2 text-xs font-semibold text-even-blue-800 transition hover:bg-even-blue-50"
            >
              💊 Try the standalone Qwen drug-interaction demo →
            </a>
          </div>
        )}

        <p className="mt-8 text-xs text-even-ink-400">
          OPD Encounter App · v2 + polish
        </p>
      </div>
    </main>
  );
}

/**
 * Demo-mode role button. Posts to /api/auth/demo-signin?role=<role> if
 * a role is provided; bare endpoint signs in as V (the default doctor).
 */
function DemoButton({
  role,
  tone,
  emoji,
  label,
  who,
  surface,
}: {
  role: '' | 'cce' | 'nurse' | 'lab_tech' | 'admin' | 'doctor';
  tone: 'navy' | 'blue' | 'amber' | 'pink' | 'ink';
  emoji: string;
  label: string;
  who: string;
  surface: string;
}) {
  const toneClass = (() => {
    switch (tone) {
      case 'navy':
        return 'border-even-navy-200 bg-even-navy-50 text-even-navy hover:bg-even-navy-100';
      case 'blue':
        return 'border-even-blue-200 bg-even-blue-50 text-even-blue-900 hover:bg-even-blue-100';
      case 'amber':
        return 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100';
      case 'pink':
        return 'border-even-pink-200 bg-even-pink-50 text-even-pink-900 hover:bg-even-pink-100';
      case 'ink':
      default:
        return 'border-even-ink-200 bg-even-ink-50 text-even-ink-700 hover:bg-even-ink-100';
    }
  })();
  const action =
    role === ''
      ? '/api/auth/demo-signin'
      : `/api/auth/demo-signin?role=${encodeURIComponent(role)}`;
  return (
    <form action={action} method="POST" className="block">
      <button
        type="submit"
        className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition ${toneClass}`}
      >
        <span aria-hidden className="text-base leading-none">
          {emoji}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold uppercase tracking-wider">
            {label}
          </span>
          <span className="block text-[10px] opacity-75">
            {who} · {surface}
          </span>
        </span>
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-even-white-DEFAULT">
          <div className="text-sm text-even-ink-400">Loading…</div>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
