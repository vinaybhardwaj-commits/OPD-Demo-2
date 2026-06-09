/**
 * Postgres access for OPD-Encounter-App.
 *
 * We use @vercel/postgres' pooled client. POSTGRES_URL is wired into the
 * Vercel project via the Vercel-Neon Marketplace integration (see M0.3).
 *
 * Pattern is the same one EHRC-Daily-Dash uses: `createPool` (not
 * `createClient`, which rejects pooled connection strings with
 * `invalid_connection_string`).
 */
import { createPool, type VercelPool } from '@vercel/postgres';

declare global {
  // eslint-disable-next-line no-var
  var __opdPgPool: VercelPool | undefined;
}

function makePool(): VercelPool {
  return createPool({
    connectionString: process.env.POSTGRES_URL,
  });
}

// Reuse the pool across module reloads in dev to avoid leaking connections.
export const pool: VercelPool =
  global.__opdPgPool ??
  (process.env.NODE_ENV === 'production' ? makePool() : (global.__opdPgPool = makePool()));
