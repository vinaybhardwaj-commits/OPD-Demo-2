/**
 * Deepgram temp-key minting — ported from ETA lib/deepgram-token.ts.
 *
 * Why temp keys: the browser opens a WebSocket directly to Deepgram so
 * we get sub-300ms interim transcription latency. Browsers can't set
 * Authorization headers on WebSockets, so the API key goes in the
 * Sec-WebSocket-Protocol subprotocol (`new WebSocket(url, ["token", key])`).
 * That means whatever string we hand to the client is visible to the
 * browser process. The full DEEPGRAM_API_KEY would let an attacker
 * burn through the account; a temp key with usage:write only and
 * TTL=600s gives blast-radius bounded by ten minutes.
 *
 * Project ID is discovered lazily on first call and cached in module
 * state. Override via DEEPGRAM_PROJECT_ID env if needed.
 */

const DG = 'https://api.deepgram.com/v1';
const TTL_SECONDS = 600; // 10 minutes — covers any reasonable single session

let _projectIdCache: string | null = null;

async function getProjectId(): Promise<string> {
  if (_projectIdCache) return _projectIdCache;
  if (process.env.DEEPGRAM_PROJECT_ID) {
    _projectIdCache = process.env.DEEPGRAM_PROJECT_ID;
    return _projectIdCache;
  }
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error('DEEPGRAM_API_KEY not set');
  const res = await fetch(`${DG}/projects`, {
    headers: { Authorization: `Token ${key}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`projects_list_${res.status}: ${text.slice(0, 120)}`);
  }
  const json = (await res.json()) as {
    projects?: Array<{ project_id: string }>;
  };
  const id = json.projects?.[0]?.project_id;
  if (!id) throw new Error('no_project_in_projects_response');
  _projectIdCache = id;
  return id;
}

export type LiveToken = {
  key: string;
  expires_at: number; // ms epoch
  ttl_seconds: number;
};

export async function mintLiveToken(comment: string): Promise<LiveToken> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error('DEEPGRAM_API_KEY not set');
  const projectId = await getProjectId();

  const res = await fetch(`${DG}/projects/${projectId}/keys`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      comment,
      scopes: ['usage:write'],
      time_to_live_in_seconds: TTL_SECONDS,
      tags: ['opd2-live'],
    }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`mint_${res.status}: ${text.slice(0, 150)}`);
  }
  const json = (await res.json()) as { key?: string };
  if (!json.key) throw new Error('no_key_in_mint_response');
  return {
    key: json.key,
    expires_at: Date.now() + TTL_SECONDS * 1000,
    ttl_seconds: TTL_SECONDS,
  };
}
