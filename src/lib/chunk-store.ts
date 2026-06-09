"use client";

/**
 * IndexedDB-backed chunk durability for in-flight recordings.
 *
 * Schema:
 *   DB: opd2-recordings (v1)
 *   Store: chunks  keyPath="key" (= "${encounter_id}|${idx-zero-padded-8}")
 *   Index: by_encounter on encounter_id
 *
 * Why composite key: ordered iteration within an encounter without
 * pulling the whole table. Why 8-zero-pad: lex sort = numeric sort
 * up to 99,999,999 chunks (~579 years at 250ms cadence).
 *
 * Crash recovery model: writes are fire-and-forget from RecordingScreen's
 * onChunk. If the tab crashes mid-recording, the chunks for that
 * encounter_id remain in IndexedDB. On HomeShell mount we scan for any
 * encounter_ids in the store; ones whose newest chunk is >30s old are
 * candidates for recovery (Discard / Keep until Submit pipeline lands).
 */

const DB_NAME = "opd2-recordings";
const DB_VERSION = 1;
const STORE = "chunks";
const INDEX = "by_encounter";

type ChunkRow = {
  key: string;
  encounter_id: string;
  chunk_idx: number;
  blob: Blob;
  mime_type: string;
  ts: number;
  // Sentinel rows written by markEncounterSubmitted() carry submitted=true so a
  // successfully-uploaded encounter is hidden from recovery even if the
  // post-submit chunk purge failed (it would otherwise resurface as
  // "unfinished" and invite a duplicate upload).
  submitted?: boolean;
};

function submittedMarkerKey(encounter_id: string): string {
  return `${encounter_id}|__submitted__`;
}

export type EncounterSummary = {
  encounter_id: string;
  chunk_count: number;
  total_bytes: number;
  first_ts: number;
  last_ts: number;
  mime_type: string;
};

function isClient(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function buildKey(encounter_id: string, idx: number): string {
  return `${encounter_id}|${String(idx).padStart(8, "0")}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isClient()) {
      reject(new Error("indexeddb_not_available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex(INDEX, "encounter_id", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb_open_failed"));
    req.onblocked = () => reject(new Error("idb_blocked"));
  });
}

export async function putChunk(
  encounter_id: string,
  chunk_idx: number,
  blob: Blob,
  mime_type: string,
): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const row: ChunkRow = {
        key: buildKey(encounter_id, chunk_idx),
        encounter_id,
        chunk_idx,
        blob,
        mime_type,
        ts: Date.now(),
      };
      const req = store.put(row);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error("put_failed"));
    });
  } finally {
    db.close();
  }
}

export async function listEncounterSummaries(): Promise<EncounterSummary[]> {
  if (!isClient()) return [];
  const db = await openDb();
  try {
    return await new Promise<EncounterSummary[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      const acc = new Map<string, EncounterSummary>();
      const submitted = new Set<string>();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const row = cursor.value as ChunkRow;
          if (row.submitted) {
            // Sentinel marker — record that this encounter was uploaded; do not
            // count it as a recoverable chunk.
            submitted.add(row.encounter_id);
            cursor.continue();
            return;
          }
          const existing = acc.get(row.encounter_id);
          if (existing) {
            existing.chunk_count += 1;
            existing.total_bytes += row.blob.size;
            if (row.ts < existing.first_ts) existing.first_ts = row.ts;
            if (row.ts > existing.last_ts) existing.last_ts = row.ts;
          } else {
            acc.set(row.encounter_id, {
              encounter_id: row.encounter_id,
              chunk_count: 1,
              total_bytes: row.blob.size,
              first_ts: row.ts,
              last_ts: row.ts,
              mime_type: row.mime_type,
            });
          }
          cursor.continue();
        } else {
          resolve(
            Array.from(acc.values())
              .filter((e) => !submitted.has(e.encounter_id))
              .sort((a, b) => b.last_ts - a.last_ts),
          );
        }
      };
      req.onerror = () => reject(req.error ?? new Error("scan_failed"));
    });
  } finally {
    db.close();
  }
}

export async function getChunksForEncounter(
  encounter_id: string,
): Promise<Blob[]> {
  const db = await openDb();
  try {
    return await new Promise<Blob[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const idx = store.index(INDEX);
      const req = idx.openCursor(IDBKeyRange.only(encounter_id));
      const rows: ChunkRow[] = [];
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          rows.push(cursor.value as ChunkRow);
          cursor.continue();
        } else {
          rows.sort((a, b) => a.chunk_idx - b.chunk_idx);
          resolve(rows.map((r) => r.blob));
        }
      };
      req.onerror = () => reject(req.error ?? new Error("read_failed"));
    });
  } finally {
    db.close();
  }
}

/**
 * Write a small sentinel row marking an encounter as successfully uploaded, so
 * listEncounterSummaries() hides it from the recovery modal even when the
 * subsequent purge fails (a non-fatal but confusing "unfinished" resurfacing
 * that could trigger a duplicate submit). Best-effort: callers should ignore a
 * throw here. The marker shares the encounter_id, so purgeEncounter() also
 * removes it.
 */
export async function markEncounterSubmitted(encounter_id: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const row: ChunkRow = {
        key: submittedMarkerKey(encounter_id),
        encounter_id,
        chunk_idx: -1,
        blob: new Blob([]),
        mime_type: "",
        ts: Date.now(),
        submitted: true,
      };
      const req = store.put(row);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error("mark_submitted_failed"));
    });
  } finally {
    db.close();
  }
}

export async function purgeEncounter(encounter_id: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const idx = store.index(INDEX);
      const req = idx.openCursor(IDBKeyRange.only(encounter_id));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error ?? new Error("purge_failed"));
    });
  } finally {
    db.close();
  }
}

/**
 * Probe whether IndexedDB is actually writable RIGHT NOW. Returns false when
 * storage is unavailable — most importantly iOS Safari **Private Browsing**,
 * where opening the DB can succeed but writes fail / quota is zero. Used by the
 * preflight check to warn the clinician (recording still works via the
 * in-memory fallback, but won't survive a tab reload).
 */
export async function probeIdbWritable(): Promise<boolean> {
  if (!isClient()) return false;
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const testKey = `__probe__|${Date.now()}`;
        const row: ChunkRow = {
          key: testKey,
          encounter_id: "__probe__",
          chunk_idx: 0,
          blob: new Blob([new Uint8Array([1])]),
          mime_type: "application/octet-stream",
          ts: Date.now(),
        };
        const req = store.put(row);
        req.onsuccess = () => {
          const del = store.delete(testKey);
          del.onsuccess = () => resolve();
          del.onerror = () => resolve(); // write worked; cleanup failing is ok
        };
        req.onerror = () => reject(req.error ?? new Error("probe_put_failed"));
        tx.onabort = () => reject(tx.error ?? new Error("probe_tx_abort"));
      });
      return true;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

export async function purgeAllOlderThan(maxAgeMs: number): Promise<number> {
  if (!isClient()) return 0;
  const summaries = await listEncounterSummaries();
  const cutoff = Date.now() - maxAgeMs;
  let purged = 0;
  for (const s of summaries) {
    if (s.last_ts < cutoff) {
      await purgeEncounter(s.encounter_id);
      purged += 1;
    }
  }
  return purged;
}
