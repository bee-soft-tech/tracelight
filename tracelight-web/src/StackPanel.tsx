import type { TLNode } from 'tracelight-react';

/** Slide-in panel showing the message + stacktrace of a clicked error node. */
export function StackPanel({ node, onClose }: { node: TLNode; onClose: () => void }) {
  return (
    <aside className="stack-panel">
      <header className="stack-panel__head">
        <span className="stack-panel__title">{node.label}</span>
        <span className="stack-panel__count">{node.count}×</span>
        <button className="stack-panel__close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>
      {node.message && <p className="stack-panel__message">{node.message}</p>}
      <pre className="stack-panel__stack">
        {(node.stack ?? []).map((frame, i) => (
          <div key={i}>at {frame}</div>
        ))}
      </pre>
    </aside>
  );
}
