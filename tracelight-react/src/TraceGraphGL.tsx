import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { layoutGraph, type NodePosition } from './layout';
import { GLScene, type ColorMode } from './gl/scene';
import type { TLNode } from './types';
import type { TracelightState } from './useTracelight';

const LAYOUT_DEBOUNCE_MS = 250;

export interface TraceGraphGLProps {
  /** The result of {@link useTracelight}. The renderer is purely presentational. */
  graph: TracelightState;
  nodeWidth?: number;
  nodeHeight?: number;
  /** Dot travel time / flash fade-out, ms. */
  flashMs?: number;
  colorMode?: ColorMode;
  /** Show the FPS + live-dot-count overlay (default true). */
  showFps?: boolean;
  /** Show the min/avg/max timing labels over edges (default true). */
  showTimings?: boolean;
  /** Show the zoom-in / zoom-out / fit controls (default true). */
  showControls?: boolean;
  /** Called when an error (red) node is clicked, with that node. */
  onErrorSelect?: (node: TLNode) => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * Experimental WebGL (PixiJS) renderer for the live graph — same data as {@link TraceGraph},
 * but nodes/edges/dots are drawn on a batched GL canvas. Each request is a dot flowing along
 * the hop it just crossed. React only owns the lifecycle; all drawing/animation lives in
 * {@link GLScene} on Pixi's ticker. nodeWidth/nodeHeight/flashMs/showFps are read at mount.
 */
export function TraceGraphGL({
  graph,
  nodeWidth = 170,
  nodeHeight = 56,
  flashMs = 500,
  colorMode = 'system',
  showFps = true,
  showTimings = true,
  showControls = true,
  onErrorSelect,
  className,
  style,
}: TraceGraphGLProps) {
  const { nodes, edges, onPulse } = graph;

  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GLScene | null>(null);
  const positionsRef = useRef<Map<string, NodePosition>>(new Map());
  const latest = useRef({ nodes, edges, nodeWidth, nodeHeight });
  latest.current = { nodes, edges, nodeWidth, nodeHeight };
  // Keep the latest callback in a ref so the scene (created once) always calls the current one.
  const onErrorSelectRef = useRef(onErrorSelect);
  onErrorSelectRef.current = onErrorSelect;

  // Create the Pixi scene once; subsequent updates flow through sync()/pulse()/setColorMode().
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let created: GLScene | null = null;
    let cancelled = false;

    GLScene.create(container, {
      nodeW: nodeWidth,
      nodeH: nodeHeight,
      flashMs,
      colorMode,
      showFps,
      showTimings,
      onErrorSelect: (id) => {
        const node = latest.current.nodes.find((n) => n.id === id);
        if (node) onErrorSelectRef.current?.(node);
      },
    }).then((scene) => {
      if (cancelled) {
        scene.destroy();
        return;
      }
      created = scene;
      sceneRef.current = scene;
      scene.sync(latest.current.nodes, latest.current.edges, positionsRef.current);
    });

    return () => {
      cancelled = true;
      sceneRef.current = null;
      created?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Spawn a dot + flashes on every hit.
  useEffect(() => onPulse((p) => sceneRef.current?.pulse(p.from, p.to)), [onPulse]);

  // Reconcile topology + counters whenever the graph changes.
  useEffect(() => {
    sceneRef.current?.sync(nodes, edges, positionsRef.current);
  }, [nodes, edges]);

  useEffect(() => {
    sceneRef.current?.setColorMode(colorMode);
  }, [colorMode]);

  useEffect(() => {
    sceneRef.current?.setShowTimings(showTimings);
  }, [showTimings]);

  // Lay out only nodes that lack a position (preserve the rest), debounced — same strategy
  // as the React Flow renderer, so both stay visually identical and never thrash.
  const nodeKey = useMemo(() => nodes.map((n) => n.id).join('|'), [nodes]);
  useEffect(() => {
    if (latest.current.nodes.every((n) => positionsRef.current.has(n.id))) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const { nodes: ns, edges: es, nodeWidth: w, nodeHeight: h } = latest.current;
      layoutGraph(ns, es, { nodeWidth: w, nodeHeight: h }).then((pos) => {
        if (cancelled) return;
        pos.forEach((p, id) => {
          if (!positionsRef.current.has(id)) positionsRef.current.set(id, p);
        });
        sceneRef.current?.sync(latest.current.nodes, latest.current.edges, positionsRef.current);
      });
    }, LAYOUT_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [nodeKey]);

  return (
    <div
      className={className}
      style={{ position: 'relative', width: '100%', height: '100%', ...style }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {showControls && (
        <div className="tl-gl-controls">
          <button type="button" aria-label="Zoom in" onClick={() => sceneRef.current?.zoomBy(1.2)}>
            +
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => sceneRef.current?.zoomBy(1 / 1.2)}>
            −
          </button>
          <button type="button" aria-label="Fit view" onClick={() => sceneRef.current?.fitView()}>
            ⤢
          </button>
        </div>
      )}
    </div>
  );
}
