import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { layoutGraph, type NodePosition } from './layout';
import { GLScene, type ColorMode } from './gl/scene';
import type { RecordedTrace, TLNode } from './types';
import type { TracelightState } from './useTracelight';

const LAYOUT_DEBOUNCE_MS = 250;

export interface TraceGraphProps {
  /** The result of {@link useTracelight}. The renderer is purely presentational. */
  graph: TracelightState;
  nodeWidth?: number;
  nodeHeight?: number;
  /** LED flash fade-out, ms. Dot travel time is distance-scaled (see gl/constants.ts). */
  flashMs?: number;
  colorMode?: ColorMode;
  /** Show the FPS + live-dot-count overlay (default true). */
  showFps?: boolean;
  /** Show the min/avg/max timing labels over edges (default false). */
  showTimings?: boolean;
  /** Show the per-node request counter (default true; hide when reviewing a single request). */
  showCounts?: boolean;
  /** Show the zoom-in / zoom-out / fit controls (default true). */
  showControls?: boolean;
  /** Freeze live monitoring (Review mode): stop live dots and hold the graph still. */
  frozen?: boolean;
  /** When set, replay this captured request in slow motion, looping; null stops replay. */
  replayTrace?: RecordedTrace | null;
  /** Replay rate: 0.25 = ¼× (slower), 1 = 1×. */
  replaySpeed?: number;
  /** Called when an error (red) node is clicked, with that node. */
  onErrorSelect?: (node: TLNode) => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * WebGL (PixiJS) renderer for the live graph. Nodes/edges/dots are drawn on a batched GL canvas;
 * each request is a dot flowing along the hop it just crossed. React only owns the lifecycle; all
 * drawing/animation lives in {@link GLScene} on Pixi's ticker. nodeWidth/nodeHeight/flashMs/showFps
 * are read at mount.
 */
export function TraceGraph({
  graph,
  nodeWidth = 170,
  nodeHeight = 56,
  flashMs = 500,
  colorMode = 'system',
  showFps = true,
  showTimings = false,
  showCounts = true,
  showControls = true,
  frozen = false,
  replayTrace = null,
  replaySpeed = 1,
  onErrorSelect,
  className,
  style,
}: TraceGraphProps) {
  const { nodes, edges, onPulse, onLifecycle } = graph;

  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GLScene | null>(null);
  const positionsRef = useRef<Map<string, NodePosition>>(new Map());
  const latest = useRef({ nodes, edges, nodeWidth, nodeHeight, frozen, replayTrace, replaySpeed });
  latest.current = { nodes, edges, nodeWidth, nodeHeight, frozen, replayTrace, replaySpeed };
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
      showCounts,
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
      // Re-apply the current review/replay state: the `frozen`/`replayTrace` effects below ran
      // once at mount while the scene was still being created (async) and no-oped. Without this,
      // a scene recreated by a remount (e.g. tab switch) would default to live monitoring and drop
      // the single-request review.
      scene.setLive(!latest.current.frozen);
      if (latest.current.replayTrace) {
        scene.startReplay(latest.current.replayTrace.hops, latest.current.replaySpeed, true);
      }
    });

    return () => {
      cancelled = true;
      sceneRef.current = null;
      created?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Queue every hit on its request's playback (the scene drains queues on its ticker).
  useEffect(() => onPulse((p) => sceneRef.current?.pulse(p.traceId, p.from, p.to)), [onPulse]);

  // Request lifecycle: open creates the playback queue, close deletes it once it drains
  // (the terminal hop into the "Return <entry>" node arrives as a regular pulse).
  useEffect(
    () =>
      onLifecycle((e) => {
        if (e.type === 'open') sceneRef.current?.openTrace(e.traceId);
        else sceneRef.current?.closeTrace(e.traceId);
      }),
    [onLifecycle],
  );

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

  useEffect(() => {
    sceneRef.current?.setShowCounts(showCounts);
  }, [showCounts]);

  // Review mode: freeze/unfreeze live monitoring.
  useEffect(() => {
    sceneRef.current?.setLive(!frozen);
  }, [frozen]);

  // Slow-motion replay of a captured request (loops until cleared).
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (replayTrace) scene.startReplay(replayTrace.hops, replaySpeed, true);
    else scene.stopReplay();
  }, [replayTrace, replaySpeed]);

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
