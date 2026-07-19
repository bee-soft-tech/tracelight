import { useEffect, useMemo, useRef, useState } from 'react';
import {
  TraceGraph,
  useTracelight,
  useRouteView,
  useTraceRecorder,
  deriveRoutes,
  type TLNode,
} from 'tracelight-react';
import 'tracelight-react/styles.css';
import { StackPanel } from './StackPanel';
import { RouteSelect } from './RouteSelect';
import { ReviewBar } from './ReviewBar';
import { TracesView } from './TracesView';
import { usePersistedTraces } from './usePersistedTraces';

const DEFAULT_WS = `ws://${window.location.hostname || 'localhost'}:8080/tracelight/ws`;

type Theme = 'light' | 'dark';
const THEME_KEY = 'tl-theme';

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Theme defaults to the browser preference; a toggle overrides it and persists the choice. */
function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' ? stored : systemTheme();
  });

  // Reflect onto <html> so the CSS variables (app + graph) switch.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Keep following the OS until the user makes an explicit choice.
  useEffect(() => {
    if (localStorage.getItem(THEME_KEY)) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setTheme(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = () =>
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      localStorage.setItem(THEME_KEY, next);
      return next;
    });

  return [theme, toggle];
}

export default function App() {
  const [url, setUrl] = useState(DEFAULT_WS);
  const [activeUrl, setActiveUrl] = useState(DEFAULT_WS);
  const [theme, toggleTheme] = useTheme();
  const [showTimings, setShowTimings] = useState(false);
  const [selectedError, setSelectedError] = useState<TLNode | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [tab, setTab] = useState<'graph' | 'traces'>('graph');

  // Browser-local persistence (IndexedDB), fed only while recording. Also the single source of
  // truth for "which captured request is selected" — shared between the Traces tab and the graph's
  // review mode, so a selection made in one is reflected in the other.
  const persisted = usePersistedTraces();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(0.25);

  // The selected captured request (null when live). Reviewing == a request is selected.
  const currentTrace = useMemo(
    () => persisted.stored.find((t) => t.key === selectedKey) ?? null,
    [persisted.stored, selectedKey],
  );
  const reviewing = currentTrace != null;

  // Freeze the live graph whenever a captured request is selected for review.
  const graph = useTracelight(activeUrl, reviewing);
  // Record from the RAW (ungated) stream so requests on every route are captured.
  const recorder = useTraceRecorder(graph);

  // Persist each captured request to the browser while (and only while) recording. Keyed on the
  // recorder's per-session monotonic `id` so it survives the recorder's in-memory 200-trace cap and
  // resets cleanly when a new session begins.
  const lastPersistedId = useRef(-1);
  const wasRecording = useRef(false);
  useEffect(() => {
    if (recorder.recording && !wasRecording.current) lastPersistedId.current = -1; // new session
    wasRecording.current = recorder.recording;
    if (!recorder.recording) return;
    for (const t of recorder.traces) {
      if (t.id > lastPersistedId.current) {
        persisted.persist(t);
        lastPersistedId.current = t.id;
      }
    }
  }, [recorder.recording, recorder.traces, persisted]);

  const routes = useMemo(() => deriveRoutes(graph.nodes), [graph.nodes]);

  // Always keep exactly one valid route selected: pick the first once routes appear, and
  // re-pick the first if the current selection disappears (e.g. after a reset prunes it).
  useEffect(() => {
    if (routes.length === 0) return;
    if (selectedRoute == null || !routes.some((r) => r.id === selectedRoute)) {
      setSelectedRoute(routes[0].id);
    }
  }, [routes, selectedRoute]);

  // In review, show the selected request's own route so all its nodes are laid out and visible.
  useEffect(() => {
    if (currentTrace) setSelectedRoute(currentTrace.entry);
  }, [currentTrace]);

  const backToLive = () => {
    setSelectedKey(null);
    setPlaying(false);
  };

  // Selecting a request — from the Traces tab OR the graph's ReviewBar — is what drives review;
  // both read the same selectedKey, so the choice stays in sync across tabs. Selecting starts
  // replay so switching to the graph immediately shows the request flowing along its route.
  const selectTrace = (key: string | null) => {
    setSelectedKey(key);
    if (key) setPlaying(true);
  };

  const startRecording = () => {
    setSelectedKey(null); // leave any review before a fresh capture session
    recorder.startRecording();
  };

  const stopRecordingAndReview = () => {
    recorder.stopRecording();
    const last = persisted.stored[persisted.stored.length - 1];
    if (last) selectTrace(last.key);
  };

  const clearStored = () => {
    setSelectedKey(null);
    persisted.clearStored();
  };

  // Escape leaves review and returns to live monitoring.
  useEffect(() => {
    if (!reviewing) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && backToLive();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [reviewing]);

  const view = useRouteView(graph, selectedRoute);

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">⚡ Tracelight</span>

        <span className="tabs" role="tablist">
          <button
            className={`tab ${tab === 'graph' ? 'is-active' : ''}`}
            onClick={() => setTab('graph')}
          >
            Graph
          </button>
          <button
            className={`tab ${tab === 'traces' ? 'is-active' : ''}`}
            onClick={() => setTab('traces')}
          >
            Traces{persisted.stored.length > 0 ? ` (${persisted.stored.length})` : ''}
          </button>
        </span>

        <span className={`status ${graph.connected ? 'status--on' : 'status--off'}`}>
          <span className="status__dot" />
          {graph.connected ? 'connected' : 'disconnected'}
        </span>

        <input
          className="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          spellCheck={false}
        />
        <button onClick={() => setActiveUrl(url)}>Connect</button>
        <button onClick={graph.reset}>Reset counters</button>

        {recorder.recording ? (
          <button className="rec rec--on" onClick={stopRecordingAndReview} title="Stop recording">
            ■ Stop ({recorder.traces.length})
          </button>
        ) : (
          <button
            className="rec"
            onClick={startRecording}
            title="Record incoming requests (leaves review)"
          >
            ● Record
          </button>
        )}

        <RouteSelect
          routes={routes}
          value={selectedRoute}
          onChange={setSelectedRoute}
          disabled={reviewing}
        />

        <span className="muted">
          {view.nodes.length} nodes · {view.edges.length} edges
        </span>

        <button
          className={`icon-btn ${showTimings ? '' : 'icon-btn--off'}`}
          onClick={() => setShowTimings((v) => !v)}
          title={showTimings ? 'Hide edge times' : 'Show edge times'}
          aria-label="Toggle edge times"
        >
          ⏱
        </button>

        <button
          className="theme-toggle"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label="Toggle dark mode"
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </header>

      {tab === 'graph' && reviewing && (
        <ReviewBar
          traces={persisted.stored}
          selected={Math.max(0, persisted.stored.findIndex((t) => t.key === selectedKey))}
          onSelect={(i) => selectTrace(persisted.stored[i]?.key ?? null)}
          playing={playing}
          onTogglePlay={() => setPlaying((p) => !p)}
          speed={speed}
          onSpeed={setSpeed}
          onBackToLive={backToLive}
        />
      )}

      {tab === 'graph' ? (
        <main className="canvas">
          <TraceGraph
            graph={view}
            colorMode={theme}
            showTimings={showTimings}
            frozen={reviewing}
            replayTrace={playing ? currentTrace : null}
            replaySpeed={speed}
            onErrorSelect={setSelectedError}
          />
          {selectedError && (
            <StackPanel node={selectedError} onClose={() => setSelectedError(null)} />
          )}
        </main>
      ) : (
        <TracesView
          traces={persisted.stored}
          selectedKey={selectedKey}
          onSelect={selectTrace}
          onImport={persisted.importFile}
          onExport={persisted.exportFile}
          onClear={clearStored}
        />
      )}
    </div>
  );
}
