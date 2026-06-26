import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
  type OnNodesChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { DefaultNode, type TLNodeData } from './DefaultNode';
import { PulseEdge, type TLEdgeData } from './PulseEdge';
import { layoutGraph, type NodePosition } from './layout';
import type { TLEdge, TLNode } from './types';
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
  /** Drives React Flow's built-in chrome (controls, background, attribution). Default 'system'. */
  colorMode?: 'light' | 'dark' | 'system';
  /** Show the min/avg/max timing labels over edges (default true). */
  showTimings?: boolean;
}

const DEFAULT_NODE_TYPES: NodeTypes = { tl: DefaultNode };
const DEFAULT_EDGE_TYPES: EdgeTypes = { tl: PulseEdge };
const LAYOUT_DEBOUNCE_MS = 250;
const ZERO: NodePosition = { x: 0, y: 0 };

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
  colorMode = 'system',
  showTimings = true,
}: TraceGraphProps) {
  const { nodes, edges, onPulse } = graph;

  const [positions, setPositions] = useState<Map<string, NodePosition>>(new Map());
  // Mirrors of the latest props/state so the debounced layout effect can read them
  // without listing them as dependencies (which would re-trigger it on every change).
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const latest = useRef({ nodes, edges, nodeWidth, nodeHeight });
  latest.current = { nodes, edges, nodeWidth, nodeHeight };

  const activeEdges = useRef<Map<string, number>>(new Map()); // edgeId -> flashId
  const activeNodes = useRef<Map<string, number>>(new Map()); // nodeId -> blinkId
  const edgeTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const nodeTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const seq = useRef(0);
  const [animTick, bumpTick] = useReducer((x: number) => x + 1, 0);
  const tickScheduled = useRef(false);

  // Per-element object caches. We rebuild the arrays each animation frame, but reuse the
  // exact same Node/Edge object when nothing about that element changed — React Flow then
  // skips re-rendering it, so only the handful of blinking/updating elements actually paint.
  const rfNodeCache = useRef<Map<string, Node>>(new Map());
  const rfEdgeCache = useRef<Map<string, Edge>>(new Map());

  const scheduleTick = () => {
    if (tickScheduled.current) return;
    tickScheduled.current = true;
    requestAnimationFrame(() => {
      tickScheduled.current = false;
      bumpTick();
    });
  };

  // Persist manual drags into the position map. The layout effect only ever places
  // nodes that don't yet have a position, so a dragged node is never moved back.
  const onNodesChange: OnNodesChange = useCallback((changes) => {
    let moved = false;
    const moves = new Map<string, NodePosition>();
    for (const ch of changes) {
      if (ch.type === 'position' && ch.position) {
        moves.set(ch.id, ch.position);
        moved = true;
      }
    }
    if (!moved) return;
    setPositions((prev) => {
      const next = new Map(prev);
      moves.forEach((pos, id) => next.set(id, pos));
      return next;
    });
  }, []);

  // Re-layout only when the *set of nodes* changes (a new node needs placing) — not on
  // every new edge. We keep every existing position (auto-laid or hand-dragged) and adopt
  // elk coordinates only for nodes that don't have one yet, so the graph never teleports.
  // Debounced so a burst of discovery collapses into a single layout pass.
  const nodeKey = useMemo(() => nodes.map((n) => n.id).join('|'), [nodes]);

  useEffect(() => {
    if (latest.current.nodes.every((n) => positionsRef.current.has(n.id))) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const { nodes: ns, edges: es, nodeWidth: w, nodeHeight: h } = latest.current;
      layoutGraph(ns, es, { nodeWidth: w, nodeHeight: h }).then((pos) => {
        if (cancelled) return;
        setPositions((prev) => {
          let next = prev;
          pos.forEach((p, id) => {
            if (!next.has(id)) {
              if (next === prev) next = new Map(prev);
              next.set(id, p);
            }
          });
          return next;
        });
      });
    }, LAYOUT_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [nodeKey]);

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
        }, flashMs),
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

  const rfNodes: Node[] = useMemo(() => {
    const cache = rfNodeCache.current;
    return nodes.map((n) => {
      const position = positions.get(n.id) ?? ZERO;
      const blink = activeNodes.current.get(n.id) ?? 0; // monotonic seq, 0 when idle
      const cached = cache.get(n.id);
      const d = cached?.data as TLNodeData | undefined;
      // Reuse identity unless the node data, its latest hit, or its position changed.
      if (cached && d && d.node === n && d.blink === blink && d.flashMs === flashMs && d.renderNode === renderNode && cached.position === position) {
        return cached;
      }
      const fresh: Node = {
        id: n.id,
        type: 'tl',
        position,
        data: { node: n, active: blink > 0, blink, flashMs, renderNode },
      };
      cache.set(n.id, fresh);
      return fresh;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, positions, animTick, renderNode, flashMs]);

  const rfEdges: Edge[] = useMemo(() => {
    const cache = rfEdgeCache.current;
    return edges.map((e) => {
      const flashId = activeEdges.current.get(e.id) ?? null;
      const cached = cache.get(e.id);
      const d = cached?.data as (TLEdgeData & { edge?: TLEdge }) | undefined;
      // Reuse identity unless the flash restarted, the edge (timing) changed, or the
      // timing-label toggle flipped.
      if (cached && d && d.edge === e && d.flashId === flashId && d.flashMs === flashMs && d.showTimings === showTimings) {
        return cached;
      }
      const fresh: Edge = {
        id: e.id,
        source: e.from,
        target: e.to,
        type: 'tl',
        data: { edge: e, flashId, flashMs, showTimings, min: e.min, avg: e.avg, max: e.max, samples: e.samples },
      };
      cache.set(e.id, fresh);
      return fresh;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges, animTick, flashMs, showTimings]);

  return (
    <div className={className} style={{ width: '100%', height: '100%', ...style }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        nodeTypes={DEFAULT_NODE_TYPES}
        edgeTypes={DEFAULT_EDGE_TYPES}
        colorMode={colorMode}
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
