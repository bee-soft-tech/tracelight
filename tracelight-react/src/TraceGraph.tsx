import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { DefaultNode } from './DefaultNode';
import { PulseEdge } from './PulseEdge';
import { layoutGraph, type NodePosition } from './layout';
import type { TLNode } from './types';
import type { TracelightState } from './useTracelight';

export interface TraceGraphProps {
  /** The result of {@link useTracelight}. The graph is purely presentational. */
  graph: TracelightState;
  nodeWidth?: number;
  nodeHeight?: number;
  /** Replace the body of a node (handles and blink are still provided). */
  renderNode?: (node: TLNode, active: boolean) => ReactNode;
  className?: string;
  style?: CSSProperties;
  fitView?: boolean;
  showControls?: boolean;
  showBackground?: boolean;
}

const DEFAULT_NODE_TYPES: NodeTypes = { tl: DefaultNode };
const DEFAULT_EDGE_TYPES: EdgeTypes = { tl: PulseEdge };

/**
 * Renders the live trace graph with React Flow + elkjs (left→right layout).
 * Re-layout happens only when the topology changes; pulses drive node blinks and
 * flying dots without recomputing positions.
 */
export function TraceGraph({
  graph,
  nodeWidth = 170,
  nodeHeight = 56,
  renderNode,
  className,
  style,
  fitView = true,
  showControls = true,
  showBackground = true,
}: TraceGraphProps) {
  const { nodes, edges, onPulse } = graph;

  const [positions, setPositions] = useState<Map<string, NodePosition>>(new Map());
  const nodePulse = useRef<Map<string, number>>(new Map());
  const edgePulse = useRef<Map<string, number>>(new Map());
  const [animTick, bumpAnim] = useReducer((x: number) => x + 1, 0);
  const animScheduled = useRef(false);

  // Recompute layout only when the set of node/edge ids changes.
  const structuralKey = useMemo(
    () => nodes.map((n) => n.id).join('|') + '##' + edges.map((e) => e.id).join('|'),
    [nodes, edges],
  );

  useEffect(() => {
    let cancelled = false;
    layoutGraph(nodes, edges, { nodeWidth, nodeHeight }).then((pos) => {
      if (!cancelled) setPositions(pos);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structuralKey, nodeWidth, nodeHeight]);

  // Route pulses to per-node / per-edge counters that retrigger animations,
  // batched to one re-render per frame.
  useEffect(() => {
    return onPulse((pulse) => {
      nodePulse.current.set(pulse.to, (nodePulse.current.get(pulse.to) ?? 0) + 1);
      const edgeId = `${pulse.from}->${pulse.to}`;
      edgePulse.current.set(edgeId, (edgePulse.current.get(edgeId) ?? 0) + 1);
      if (!animScheduled.current) {
        animScheduled.current = true;
        requestAnimationFrame(() => {
          animScheduled.current = false;
          bumpAnim();
        });
      }
    });
  }, [onPulse]);

  const rfNodes: Node[] = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: 'tl',
        position: positions.get(n.id) ?? { x: 0, y: 0 },
        data: { node: n, pulseSeq: nodePulse.current.get(n.id) ?? 0, renderNode },
      })),
    // animTick included so counts/blinks refresh each frame
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, positions, animTick, renderNode],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => ({
        id: e.id,
        source: e.from,
        target: e.to,
        type: 'tl',
        data: { pulseSeq: edgePulse.current.get(e.id) ?? 0 },
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [edges, animTick],
  );

  return (
    <div className={className} style={{ width: '100%', height: '100%', ...style }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={DEFAULT_NODE_TYPES}
        edgeTypes={DEFAULT_EDGE_TYPES}
        fitView={fitView}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
      >
        {showBackground && <Background />}
        {showControls && <Controls />}
      </ReactFlow>
    </div>
  );
}
