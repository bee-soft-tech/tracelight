import { Handle, Position, type NodeProps } from '@xyflow/react';
import { type ReactNode } from 'react';
import type { TLNode } from './types';

export interface TLNodeData {
  node: TLNode;
  /** True for a short window right after a request hit this node (drives the blink). */
  active: boolean;
  renderNode?: (node: TLNode, active: boolean) => ReactNode;
  [key: string]: unknown;
}

/**
 * Default headless node: a labelled box with a live counter that blinks while `active`.
 * Stateless — the parent decides when it is active — so it cannot blink spuriously on
 * re-render. Styling lives in CSS classes (`tl-node`, `tl-node--entry`, `tl-node--pulse`),
 * or pass `renderNode` to replace the body entirely.
 */
export function DefaultNode({ data }: NodeProps) {
  const { node, active, renderNode } = data as TLNodeData;

  return (
    <div className={`tl-node tl-node--${node.kind}${active ? ' tl-node--pulse' : ''}`}>
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
