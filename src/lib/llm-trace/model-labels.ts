/**
 * v1.7 Sprint G — functional model labels for user-facing UI (lock #26).
 * Hides raw model strings like `qwen2.5:14b` from users. Trace JSON keeps
 * raw model names for admin forensics.
 *
 * Used both server-side (in /ask route emit messages) and client-side
 * (in TracePanel when rendering stage labels).
 */
const MODEL_TO_LABEL: Record<string, string> = {
  'qwen2.5:14b': 'reasoning model',
  'qwen2.5:7b': 'audit model',
  'llama3.1:8b': 'query rewriter',
  'mxbai-embed-large': 'embedding model',
  'nomic-embed-text': 'embedding model',
  'bge-reranker-v2-m3': 'reranker',
};

/** Map a raw model string to a user-facing functional label. */
export function modelLabel(model: string | undefined | null): string {
  if (!model) return 'model';
  return MODEL_TO_LABEL[model.toLowerCase()] || MODEL_TO_LABEL[model] || 'model';
}

/** Replace any known model strings inside a free-text message with their labels. */
export function sanitizeModelNames(msg: string): string {
  let out = msg;
  for (const [raw, label] of Object.entries(MODEL_TO_LABEL)) {
    out = out.split(raw).join(label);
  }
  return out;
}
