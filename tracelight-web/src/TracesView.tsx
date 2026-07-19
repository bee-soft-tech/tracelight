import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { TraceGraph, type TracelightState } from 'tracelight-react';
import { TraceWaterfall } from './TraceWaterfall';
import type { StoredTrace } from './usePersistedTraces';

interface RouteGroup {
  entry: string;
  list: StoredTrace[];
  lastAt: number;
}

/** Group stored requests by their route (entry), most-recently-active route first. */
function groupByRoute(traces: StoredTrace[]): RouteGroup[] {
  const byEntry = new Map<string, StoredTrace[]>();
  for (const t of traces) {
    const list = byEntry.get(t.entry);
    if (list) list.push(t);
    else byEntry.set(t.entry, [t]);
  }
  return [...byEntry.entries()]
    .map(([entry, list]) => ({
      entry,
      list: [...list].sort((a, b) => b.at - a.at), // newest request first within a route
      lastAt: list.reduce((m, t) => Math.max(m, t.at), 0),
    }))
    .sort((a, b) => b.lastAt - a.lastAt);
}

interface TracesViewProps {
  traces: StoredTrace[];
  /** The shared selected request (also drives the graph's review mode). */
  selectedKey: string | null;
  /** Select a request (null clears). Reflected on the Graph tab. */
  onSelect: (key: string | null) => void;
  onImport: (file: File) => Promise<number>;
  onExport: () => void;
  onClear: () => void;
  /** Route subgraph of the selected request, for the flow preview under the waterfall. */
  graph: TracelightState;
  colorMode: 'light' | 'dark';
  replaySpeed: number;
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
  graph,
  colorMode,
  replaySpeed,
}: TracesViewProps) {
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const current = traces.find((t) => t.key === selectedKey) ?? null;

  // Requests are grouped by route: with lots of parallel traffic to many routes a flat list is
  // unusable. A stable global index (capture order) keeps each request's label consistent with
  // the graph's ReviewBar ("Request N / M").
  const groups = useMemo(() => groupByRoute(traces), [traces]);
  const indexByKey = useMemo(() => new Map(traces.map((t, i) => [t.key, i])), [traces]);

  const toggleGroup = (entry: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(entry)) next.delete(entry);
      else next.add(entry);
      return next;
    });

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
        <div className="trace-groups">
          {traces.length === 0 && (
            <div className="trace-list__empty">
              No stored requests. Press ● Record on the Graph tab to capture some, or Import a file.
            </div>
          )}
          {groups.map((g) => {
            const isCollapsed = collapsed.has(g.entry);
            const hasActive = selectedKey != null && g.list.some((t) => t.key === selectedKey);
            return (
              <section className="trace-group" key={g.entry}>
                <button
                  className={`trace-group__header ${hasActive ? 'has-active' : ''}`}
                  onClick={() => toggleGroup(g.entry)}
                  aria-expanded={!isCollapsed}
                  title={isCollapsed ? 'Expand route' : 'Collapse route'}
                >
                  <span className="trace-group__caret">{isCollapsed ? '▸' : '▾'}</span>
                  <span className="trace-group__route" title={g.entry}>
                    {g.entry}
                  </span>
                  <span className="trace-group__count">{g.list.length}</span>
                </button>

                {!isCollapsed && (
                  <ul className="trace-list">
                    {g.list.map((t) => (
                      <li key={t.key}>
                        <button
                          className={`trace-list__item ${selectedKey === t.key ? 'is-active' : ''}`}
                          onClick={() => onSelect(t.key)}
                          title="Show this request's route on the Graph tab"
                        >
                          <span className="trace-list__entry">
                            #{(indexByKey.get(t.key) ?? 0) + 1}
                          </span>
                          <span className="trace-list__meta">
                            {t.hops.length} hops · {t.totalMs.toFixed(1)} ms
                          </span>
                          <time className="trace-list__time">
                            {new Date(t.at).toLocaleTimeString()}
                          </time>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>

        <div className="trace-detail">
          {current ? (
            <>
              <div className="trace-detail__waterfall">
                <TraceWaterfall trace={current} />
              </div>
              {/* The same flow graph as the Graph tab, so you see a request's route and its
                  timeline together without switching tabs. */}
              <div className="trace-detail__graph">
                <TraceGraph
                  graph={graph}
                  colorMode={colorMode}
                  frozen
                  replayTrace={current}
                  replaySpeed={replaySpeed}
                  showControls={false}
                  showFps={false}
                />
              </div>
            </>
          ) : (
            <div className="trace-detail__empty">Select a request to see its timeline and flow.</div>
          )}
        </div>
      </div>
    </main>
  );
}
