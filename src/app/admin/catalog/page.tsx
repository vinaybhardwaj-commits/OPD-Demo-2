/**
 * /admin/catalog — diagnostic catalog browser + editor.
 *
 * Server component: auth check + initial fetch. Client component handles
 * search, filter, edit drawer. Same component reused (via the same GET
 * endpoint) by the v3.2 doctor strip + modal.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { pool } from '@/lib/db';
import { AdminCatalogClient, type CatalogRow } from '@/components/AdminCatalogClient';

export const dynamic = 'force-dynamic';

type ModalityCount = { modality: string; n: number };

export default async function AdminCatalogPage() {
  const session = await getCurrentUser();
  if (!session) redirect('/auth/login');

  // Initial fetch: first 50 rows alphabetic, plus per-modality counts.
  const [initial, counts, total] = await Promise.all([
    pool.query<CatalogRow>(
      `SELECT service_code, display_name, department, sub_department, service_type,
              modality, patient_types, is_active, is_outsourced, schedulable,
              multiple_sittings, description, patient_instructions, synonyms,
              standard_codes, tags, created_at::text AS created_at, updated_at::text AS updated_at
       FROM diagnostic_catalog
       WHERE is_active = true
       ORDER BY display_name ASC
       LIMIT 50`,
    ),
    pool.query<ModalityCount>(
      `SELECT modality, COUNT(*)::int AS n FROM diagnostic_catalog
       WHERE is_active = true GROUP BY modality ORDER BY n DESC`,
    ),
    pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM diagnostic_catalog WHERE is_active = true`,
    ),
  ]);

  return (
    <main className="min-h-screen bg-even-white-DEFAULT">
      <header className="border-b border-even-ink-100 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link
            href="/dashboard"
            className="text-xs font-medium uppercase tracking-wider text-even-ink-500 hover:text-even-navy"
          >
            ← Back
          </Link>
          <span className="text-[10px] font-mono text-even-ink-400">
            admin · diagnostic catalog
          </span>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-8">
        <p className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-even-blue-700">
          v3.1 · diagnostic ordering
        </p>
        <h1 className="mb-2 text-2xl font-semibold tracking-tight text-even-navy">
          Diagnostic catalog
        </h1>
        <p className="mb-6 text-sm text-even-ink-600">
          {total.rows[0]?.n ?? 0} active tests seeded from{' '}
          <span className="font-mono">EHRC_Latest_21052026.xlsx</span>. Search by display name,
          synonym, or sub-department. Click any row to edit synonyms,
          tags, patient instructions, and is-active.
        </p>

        <AdminCatalogClient
          initialRows={initial.rows}
          counts={counts.rows}
          totalActive={total.rows[0]?.n ?? 0}
        />
      </section>
    </main>
  );
}
