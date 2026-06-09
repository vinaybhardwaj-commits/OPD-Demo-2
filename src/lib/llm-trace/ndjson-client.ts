// Client-side NDJSON consumer
export type ServerEvent =
  | { type: 'progress'; stage: string; msg: string; ms?: number }
  | { type: 'sources'; items: unknown[] }
  | { type: 'token'; content: string }
  | { type: 'result'; data: unknown }
  | { type: 'done'; ms: number }
  | { type: 'critique'; severity: string; issue_count: number; details: Record<string, unknown> }  // v1.5
  | { type: 'draft_complete'; chars: number }                                                          // v1.6
  | { type: 'draft_superseded'; reason: string }                                                       // v1.6
  | { type: 'pubchem_facts'; data: unknown }                                                           // v1.9
  | { type: 'class_overlap'; pairs: unknown[] }                                                        // v1.9
  | { type: 'error'; message: string };

export async function consumeNdjson(
  resp: Response,
  onEvent: (ev: ServerEvent) => void
): Promise<void> {
  if (!resp.body) throw new Error('no body');
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  // Track whether the server emitted a clean 'done' event before the stream closed.
  // iOS Safari throws TypeError: 'Load failed' from reader.read() after the
  // server's clean close — even though we've already consumed all the data.
  // If we've seen 'done', swallow any subsequent read error.
  let sawDone = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const ev = JSON.parse(line) as ServerEvent;
          if (ev.type === 'done') sawDone = true;
          onEvent(ev);
        } catch {}
      }
    }
  } catch (e) {
    // Common iOS Safari case: server closed cleanly after 'done', reader.read()
    // throws TypeError 'Load failed'. We have all the data; this is benign.
    if (sawDone) return;
    // Otherwise the stream genuinely failed mid-flight — re-throw for the
    // caller's error handling to surface.
    throw e;
  }

  // flush any tail (shouldn't happen with our protocol but be defensive)
  const tail = buf.trim();
  if (tail) {
    try { onEvent(JSON.parse(tail) as ServerEvent); } catch {}
  }
}
