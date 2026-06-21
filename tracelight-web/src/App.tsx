import { useState } from 'react';
import { TraceGraph, useTracelight } from '@tracelight/react';
import '@tracelight/react/styles.css';

const DEFAULT_WS = `ws://${window.location.hostname || 'localhost'}:8080/tracelight/ws`;

export default function App() {
  const [url, setUrl] = useState(DEFAULT_WS);
  const [activeUrl, setActiveUrl] = useState(DEFAULT_WS);
  const graph = useTracelight(activeUrl);

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
      </header>

      <main className="canvas">
        <TraceGraph graph={graph} fitView showControls showBackground />
      </main>
    </div>
  );
}
