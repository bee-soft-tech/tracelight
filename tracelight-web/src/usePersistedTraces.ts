import { useCallback, useEffect, useRef, useState } from 'react';
import { createStore, get, set, del } from 'idb-keyval';
import { parseTraceExport, serializeTraces, type RecordedTrace } from 'tracelight-react';

/**
 * Browser-local persistence for captured requests, backed by IndexedDB (via idb-keyval). Data lives
 * entirely in the browser — nothing is sent anywhere. Traces accumulate across recording sessions
 * until {@link PersistedTraces.clearStored} wipes them, and can be exported to / imported from a JSON
 * file to hand off to someone else for analysis.
 */

/** A stored request. The recorder's numeric `id` restarts each session, so we add a stable `key`. */
export interface StoredTrace extends RecordedTrace {
  key: string;
}

export interface PersistedTraces {
  /** All stored requests, oldest first. */
  stored: StoredTrace[];
  /** Append one captured request to storage (called while recording). */
  persist: (trace: RecordedTrace) => void;
  /** Wipe all stored requests. This is the "clear browser cache" action — persistence only. */
  clearStored: () => void;
  /** Merge a user-picked export file; resolves with the number of imported traces, throws on bad input. */
  importFile: (file: File) => Promise<number>;
  /** Download all stored requests as a shareable JSON file. */
  exportFile: () => void;
}

// A dedicated IndexedDB store so we never collide with anything else on the page.
const store = createStore('tracelight', 'traces');
const KEY = 'saved';
/** Cap stored traces so a long-lived cache can't grow without bound. */
const MAX_STORED = 500;

function newKey(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function usePersistedTraces(): PersistedTraces {
  const [stored, setStored] = useState<StoredTrace[]>([]);
  // Mirror in a ref so async writers see the latest list without re-subscribing.
  const storedRef = useRef<StoredTrace[]>([]);

  // Load whatever was persisted in a previous session, once.
  useEffect(() => {
    let alive = true;
    get<StoredTrace[]>(KEY, store)
      .then((v) => {
        if (alive && Array.isArray(v)) {
          storedRef.current = v;
          setStored(v);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const write = useCallback((next: StoredTrace[]) => {
    const capped = next.length > MAX_STORED ? next.slice(next.length - MAX_STORED) : next;
    storedRef.current = capped;
    setStored(capped);
    void set(KEY, capped, store).catch(() => {});
  }, []);

  const persist = useCallback(
    (trace: RecordedTrace) => {
      write([...storedRef.current, { ...trace, key: newKey() }]);
    },
    [write],
  );

  const clearStored = useCallback(() => {
    storedRef.current = [];
    setStored([]);
    void del(KEY, store).catch(() => {});
  }, []);

  const importFile = useCallback(
    async (file: File): Promise<number> => {
      const parsed = parseTraceExport(await file.text()); // throws on malformed input
      const withKeys: StoredTrace[] = parsed.map((t) => ({ ...t, key: newKey() }));
      write([...storedRef.current, ...withKeys]);
      return withKeys.length;
    },
    [write],
  );

  const exportFile = useCallback(() => {
    const envelope = serializeTraces(storedRef.current);
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tracelight-traces-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  return { stored, persist, clearStored, importFile, exportFile };
}
