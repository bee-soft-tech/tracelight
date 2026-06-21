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
  /** Edge flash fade-out duration, ms. */
  flashMs?: number;
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
const BLINK_MS = 450;

/**
 * Renders the live trace graph with React Flow + elkjs (left→right layout).
 *
 * When a request crosses A→B, the destination node blinks and the connecting edge flashes.
 * All transient state lives here (the single source of truth): which edges/nodes are
 * currently active. Edges/nodes are stateless views of that map, so only the edges a
 * request actually traversed light up, regardless of how React Flow re-renders.
 */
export function TraceGraph({
  graph,
  nodeWidth = 170,
  nodeHeight = 56,
  flashMs = 500,
  renderNode,
  className,
  style,
  fitView = true,
  showControls = true,
  showBackground = true,
}: TraceGraphProps) {
  const { nodes, edges, onPulse } = graph;

  const [positions, setPositions] = useState<Map<string, NodePosition>>(new Map());

  const activeEdges = useRef<Map<string, number>>(new Map()); // edgeId -> flashId
  const activeNodes = useRef<Map<string, number>>(new Map()); // nodeId -> blinkId
  const edgeTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const nodeTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const seq = useRef(0);
  const [animTick, bumpTick] = useReducer((x: number) => x + 1, 0);
  const tickScheduled = useRef(false);

  const scheduleTick = () => {
    if (tickScheduled.current) return;
    tickScheduled.current = true;
    requestAnimationFrame(() => {
      tickScheduled.current = false;
      bumpTick();
    });
  };

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

  useEffect(() => {
    const unsubscribe = onPulse((pulse) => {
      // Flash the traversed edge A→B (restart its fade on every hit).
      const edgeId = `${pulse.from}->${pulse.to}`;
      activeEdges.current.set(edgeId, ++seq.current);
      const prevEdgeTimer = edgeTimers.current.get(edgeId);
      if (prevEdgeTimer) clearTimeout(prevEdgeTimer);
      edgeTimers.current.set(
        edgeId,
        setTimeout(() => {
          activeEdges.current.delete(edgeId);
          edgeTimers.current.delete(edgeId);
          scheduleTick();
        }, flashMs),
      );

      // Blink the destination node.
      const nodeId = pulse.to;
      activeNodes.current.set(nodeId, ++seq.current);
      const prevNodeTimer = nodeTimers.current.get(nodeId);
      if (prevNodeTimer) clearTimeout(prevNodeTimer);
      nodeTimers.current.set(
        nodeId,
        setTimeout(() => {
          activeNodes.current.delete(nodeId);
          nodeTimers.current.delete(nodeId);
          scheduleTick();
        }, BLINK_MS),
      );

      scheduleTick();
    });

    return () => {
      unsubscribe();
      edgeTimers.current.forEach(clearTimeout);
      nodeTimers.current.forEach(clearTimeout);
      edgeTimers.current.clear();
      nodeTimers.current.clear();
      activeEdges.current.clear();
      activeNodes.current.clear();
    };
  }, [onPulse, flashMs]);

  const rfNodes: Node[] = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: 'tl',
        position: positions.get(n.id) ?? { x: 0, y: 0 },
        data: { node: n, active: activeNodes.current.has(n.id), renderNode },
      })),
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
        data: { flashId: activeEdges.current.get(e.id) ?? null, flashMs },
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [edges, animTick, flashMs],
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
