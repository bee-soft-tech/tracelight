import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useEffect, useRef, type ReactNode } from 'react';
import type { TLNode } from './types';

export interface TLNodeData {
  node: TLNode;
  /** Increments on every pulse hitting this node; used to retrigger the blink. */
  pulseSeq: number;
  renderNode?: (node: TLNode, active: boolean) => ReactNode;
  [key: string]: unknown;
}

/**
 * Default headless node: a labelled box with a live counter and a blink on each pulse.
 * Styling lives entirely in CSS classes (`tl-node`, `tl-node--entry`, ...), so consumers
 * can restyle freely or pass `renderNode` to replace the body completely.
 */
export function DefaultNode({ data }: NodeProps) {
  const { node, pulseSeq, renderNode } = data as TLNodeData;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !pulseSeq) return;
    // restart the CSS animation
    el.classList.remove('tl-node--pulse');
    void el.offsetWidth;
    el.classList.add('tl-node--pulse');
  }, [pulseSeq]);

  return (
    <div ref={ref} className={`tl-node tl-node--${node.kind}`}>
      <Handle type="target" position={Position.Left} className="tl-handle" />
      {renderNode ? (
        renderNode(node, pulseSeq > 0)
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
