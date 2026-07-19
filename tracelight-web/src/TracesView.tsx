import { useRef, useState, type ChangeEvent } from 'react';
import { TraceWaterfall } from './TraceWaterfall';
import type { StoredTrace } from './usePersistedTraces';

interface TracesViewProps {
  traces: StoredTrace[];
  /** The shared selected request (also drives the graph's review mode). */
  selectedKey: string | null;
  /** Select a request (null clears). Reflected on the Graph tab. */
  onSelect: (key: string | null) => void;
  onImport: (file: File) => Promise<number>;
  onExport: () => void;
  onClear: () => void;
}

/**
 * The "Traces" tab: a Zipkin-style list of stored requests with a per-request waterfall, plus the
 * persistence controls (Import / Export / Clear) — kept separate from the graph's Reset counters,
 * which never touches stored data. Selection is controlled by {@link App} so it stays in sync with
 * the graph: picking a request here makes the Graph tab review that request's route.
 */
export function TracesView({
  traces,
  selectedKey,
  onSelect,
  onImport,
  onExport,
  onClear,
}: TracesViewProps) {
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const current = traces.find((t) => t.key === selectedKey) ?? null;

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be re-imported
    if (!file) return;
    setError(null);
    try {
      await onImport(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    }
  };

  const confirmClear = () => {
    if (window.confirm(`Delete all ${traces.length} stored request(s) from this browser?`)) {
      onClear();
    }
  };

  return (
    <main className="traces">
      <div className="traces__actions">
        <button onClick={() => fileRef.current?.click()}>⬆ Import</button>
        <button onClick={onExport} disabled={traces.length === 0}>
          ⬇ Export
        </button>
        <button className="danger" onClick={confirmClear} disabled={traces.length === 0}>
          🗑 Clear stored
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={onFile}
        />
        {error && <span className="traces__error">{error}</span>}
        <span className="muted">{traces.length} stored</span>
      </div>

      <div className="traces__body">
        <ul className="trace-list">
          {traces.length === 0 && (
            <li className="trace-list__empty">
              No stored requests. Press ● Record on the Graph tab to capture some, or Import a file.
            </li>
          )}
          {traces
            .map((t, i) => ({ t, i }))
            .reverse()
            .map(({ t, i }) => (
              <li key={t.key}>
                <button
                  className={`trace-list__item ${selectedKey === t.key ? 'is-active' : ''}`}
                  onClick={() => onSelect(t.key)}
                  title="Show this request's route on the Graph tab"
                >
                  <span className="trace-list__entry" title={t.entry}>
                    #{i + 1} {t.entry}
                  </span>
                  <span className="trace-list__meta">
                    {t.hops.length} hops · {t.totalMs.toFixed(1)} ms
                  </span>
                  <time className="trace-list__time">{new Date(t.at).toLocaleTimeString()}</time>
                </button>
              </li>
            ))}
        </ul>

        <div className="waterfall-pane">
          {current ? (
            <TraceWaterfall trace={current} />
          ) : (
            <div className="waterfall-pane__empty">Select a request to see its timeline.</div>
          )}
        </div>
      </div>
    </main>
  );
}
