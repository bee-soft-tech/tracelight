import { useEffect, useState } from 'react';
import { TraceGraph, useTracelight } from '@tracelight/react';
import '@tracelight/react/styles.css';

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
  const graph = useTracelight(activeUrl);
  const [theme, toggleTheme] = useTheme();

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">⚡ Tracelight</span>

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

        <span className="muted">
          {graph.nodes.length} nodes · {graph.edges.length} edges
        </span>

        <button
          className="theme-toggle"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label="Toggle dark mode"
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </header>

      <main className="canvas">
        <TraceGraph graph={graph} fitView showControls showBackground colorMode={theme} />
      </main>
    </div>
  );
}
