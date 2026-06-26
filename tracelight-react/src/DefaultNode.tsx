import { Handle, Position, type NodeProps } from '@xyflow/react';
import { type ReactNode } from 'react';
import type { TLNode } from './types';

export interface TLNodeData {
  node: TLNode;
  /** True for a short window right after a request hit this node. */
  active: boolean;
  /**
   * Monotonic id bumped on every hit. Used as a React `key` on the flash overlay so the
   * CSS animation re-mounts and replays per hit — even when hits arrive faster than the
   * fade, which is what keeps the indicator alive under heavy traffic. 0 = never hit.
   */
  blink: number;
  /** Fade-out duration of the bullet flash, ms — kept equal to the edge flash. */
  flashMs?: number;
  /** Computed node width (px) — sized to the label + counter by the layout. */
  width?: number;
  renderNode?: (node: TLNode, active: boolean) => ReactNode;
  [key: string]: unknown;
}

/**
 * Default headless node: a labelled box with a live counter and a status bullet (idle red,
 * flashing green on each traversal). The bullet is a tiny GPU-composited opacity animation
 * re-keyed per hit, so it stays responsive at any traffic rate — unlike a box-shadow pulse
 * on the whole node, which is paint-heavy and freezes when the active class never toggles.
 * Styling lives in CSS classes; pass `renderNode` to replace the body entirely.
 */
export function DefaultNode({ data }: NodeProps) {
  const { node, active, blink, flashMs, width, renderNode } = data as TLNodeData;

  const isError = node.kind === 'error';

  return (
    <div
      className={`tl-node tl-node--${node.kind}`}
      style={width != null ? { width } : undefined}
    >
      <span className="tl-node__bullet">
        {isError ? (
          <span className="tl-node__bullet-error" />
        ) : (
          blink > 0 && (
            <span
              key={blink}
              className="tl-node__bullet-hit"
              style={flashMs != null ? { animationDuration: `${flashMs}ms` } : undefined}
            />
          )
        )}
      </span>
      <Handle type="target" position={Position.Left} className="tl-handle" />
      {renderNode ? (
        renderNode(node, active)
      ) : (
        <>
          <span className="tl-node__label">{node.label}</span>
          <span className="tl-node__count">{node.count}</span>
        </>
      )}
      <Handle type="source" position={Position.Right} className="tl-handle" />
    </div>
  );
}
