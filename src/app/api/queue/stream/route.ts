/**
 * GET /api/queue/stream?channel=<channel-name>
 *
 * Server-Sent Events stream. Opens a dedicated Postgres connection
 * (NOT the pool — LISTEN needs a session that survives between calls),
 * runs LISTEN on the requested channel, and forwards every NOTIFY as
 * an SSE 'data:' line.
 *
 * Channel naming convention (PRD §4.4):
 *   queue:global           — every state change anywhere (debug)
 *   queue:room:<room_id>   — events scoped to one OPD room
 *   queue:user:<user_id>   — events targeted at a specific user
 *                            (e.g. doctor's incoming queue notifications)
 *
 * Auth: any signed-in user. The events sent are deliberately tiny
 * ("dirty" markers) — no PHI in the payload, just a hint that the
 * client should call router.refresh().
 *
 * Lifetime:
 *   - Vercel Pro maxDuration is 800s. After that the connection
 *     terminates; EventSource on the client auto-reconnects.
 *   - The Postgres connection is closed on every disconnect (cleanup
 *     handler).
 *   - A heartbeat ': ping\\n\\n' fires every 25s so proxies don't kill
 *     the connection as idle.
 *
 * Producers: every state-changing server action calls
 *   pool.query("SELECT pg_notify($1, $2)", [channel, payload])
 * The pg_notify itself uses the regular HTTP-pooled @vercel/postgres
 * client; only the listening side needs a TCP session.
 */
import { NextResponse } from 'next/server';
import { Client } from 'pg';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 800; // Vercel Pro ceiling

// Channel names are constrained: alphanumerics, `-`, `_`, `:`. Caps allowed.
// Lets us pass-through queue:room:<uuid> without exposing arbitrary SQL.
const CHANNEL_RE = /^[A-Za-z0-9_:-]{1,128}$/;

function getConnString(): string | null {
  return (
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_URL_UNPOOLED ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL ||
    null
  );
}

export async function GET(req: Request) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const channel = url.searchParams.get('channel') ?? 'queue:global';
  if (!CHANNEL_RE.test(channel)) {
    return NextResponse.json({ ok: false, error: 'bad_channel' }, { status: 400 });
  }

  const connStr = getConnString();
  if (!connStr) {
    return NextResponse.json(
      { ok: false, error: 'postgres_url_missing' },
      { status: 500 },
    );
  }

  // Build the SSE stream
  const encoder = new TextEncoder();
  let pgClient: Client | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(line));
        } catch {
          // controller already closed
        }
      };

      // First event so the client knows the stream is alive.
      send(`: connected to ${channel}\n\n`);
      send(`event: hello\ndata: ${JSON.stringify({ channel, at: Date.now() })}\n\n`);

      // Open the dedicated TCP connection.
      try {
        pgClient = new Client({
          connectionString: connStr,
          // Neon serverless needs SSL but the connection string usually
          // includes ?sslmode=require. Explicitly pass ssl as
          // { rejectUnauthorized: false } for redundancy in case the
          // env var is missing the query param.
          ssl: { rejectUnauthorized: false },
        });
        await pgClient.connect();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'unknown';
        send(`event: error\ndata: ${JSON.stringify({ message: 'connect failed', detail: msg })}\n\n`);
        controller.close();
        return;
      }

      pgClient.on('notification', (msg) => {
        send(`event: notify\ndata: ${JSON.stringify({ channel: msg.channel, payload: msg.payload, at: Date.now() })}\n\n`);
      });

      pgClient.on('error', (e: Error) => {
        send(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`);
      });

      try {
        // Quote the channel name to handle colons / dashes.
        await pgClient.query(`LISTEN "${channel.replace(/"/g, '')}"`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'unknown';
        send(`event: error\ndata: ${JSON.stringify({ message: 'LISTEN failed', detail: msg })}\n\n`);
      }

      // Heartbeat — 25s, just under typical proxy idle-timeout windows.
      heartbeat = setInterval(() => {
        send(`: ping ${Date.now()}\n\n`);
      }, 25_000);
    },
    async cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (pgClient) {
        try {
          await pgClient.end();
        } catch {
          /* ignore */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // hint to nginx
    },
  });
}
