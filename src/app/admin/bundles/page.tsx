/**
 * /admin/bundles — diagnostic bundle CRUD.
 *
 * Server component: auth + initial list fetch. Client component handles
 * create / edit / delete via the v3.4 endpoints.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { pool } from '@/lib/db';
import { AdminBundlesClient, type BundleRow } from '@/components/AdminBundlesClient';

export const dynamic = 'force-dynamic';

export default async function AdminBundlesPage() {
  const session = await getCurrentUser();
  if (!session) redirect('/auth/login');

  const { rows } = await pool.query<BundleRow>(
    `SELECT b.id, b.name, b.description, b.specialty_tag, b.is_active,
            (SELECT COUNT(*)::int FROM diagnostic_bundle_items WHERE bundle_id = b.id) AS n_items,
            b.created_at::text AS created_at
     FROM diagnostic_bundles b
     WHERE b.is_active = true
     ORDER BY b.name ASC`,
  );

  return (
    <main className="min-h-screen bg-even-white-DEFAULT">
      <header className="border-b border-even-ink-100 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link
            href="/dashboard"
            className="text-xs font-medium uppercase tracking-wider text-even-ink-500 hover:text-even-navy"
          >
            ← Back
          </Link>
          <span className="text-[10px] font-mono text-even-ink-400">
            admin · diagnostic bundles
          </span>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-8">
        <p className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-even-blue-700">
          v3.4 · diagnostic ordering
        </p>
        <h1 className="mb-2 text-2xl font-semibold tracking-tight text-even-navy">
          Diagnostic bundles
        </h1>
        <p className="mb-6 text-sm text-even-ink-600">
          Hand-curated test panels. Pre-anaesthesia, Diabetic FU, Chest-pain workup, etc.
          One bundle = many service_codes from the EHRC catalog. Doctors pick a bundle from
          the strip and all its tests land in the cart with one tap.
        </p>

        <AdminBundlesClient initialBundles={rows} />
      </section>
    </main>
  );
}
