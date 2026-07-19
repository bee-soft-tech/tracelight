import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CloseEvent,
  OpenEvent,
  PulseEvent,
  TLEdge,
  TLEdgeTiming,
  TLNode,
  TracelightEvent,
} from './types';

/** A request-lifecycle frame: the backend opened or closed a trace. */
export type LifecycleEvent = OpenEvent | CloseEvent;

/**
 * Returns a new edge object with the event's timing merged in, or the same edge when the
 * event carries no timing. New identity on change lets React Flow re-render just this edge.
 */
function withTiming(edge: TLEdge, src: Partial<TLEdgeTiming>): TLEdge {
  if (src.samples == null) return edge;
  return { ...edge, min: src.min, avg: src.avg, max: src.max, samples: src.samples };
}

export interface TracelightState {
  /** Current nodes with live counters. New array reference whenever something changes. */
  nodes: TLNode[];
  /** Current edges. */
  edges: TLEdge[];
  /** Whether the WebSocket is currently open. */
  connected: boolean;
  /** Subscribe to pulse events (for animations). Returns an unsubscribe function. */
  onPulse: (cb: (pulse: PulseEvent) => void) => () => void;
  /** Subscribe to request open/close events (for playback lifecycle). Returns an unsubscribe function. */
  onLifecycle: (cb: (event: LifecycleEvent) => void) => () => void;
  /** Ask the backend to zero all counters. */
  reset: () => void;
}

/**
 * Connects to a Tracelight WebSocket and maintains the live graph.
 *
 * Structural changes (snapshot/topology) and counter updates are flushed to React
 * state at most once per animation frame, so a high pulse rate never floods rendering.
 * Pulse events are also delivered to {@link TracelightState.onPulse} subscribers for
 * imperative animations (node blink, flying dot).
 */
export function useTracelight(url: string, frozen = false): TracelightState {
  const [nodes, setNodes] = useState<TLNode[]>([]);
  const [edges, setEdges] = useState<TLEdge[]>([]);
  const [connected, setConnected] = useState(false);

  const nodesRef = useRef<Map<string, TLNode>>(new Map());
  const edgesRef = useRef<Map<string, TLEdge>>(new Map());
  // While frozen (Review mode), incoming frames keep updating nodesRef/edgesRef but are NOT
  // flushed to React state — the whole view holds still until unfrozen, then catches up once.
  const frozenRef = useRef(frozen);
  const wsRef = useRef<WebSocket | null>(null);
  const listeners = useRef<Set<(pulse: PulseEvent) => void>>(new Set());
  const lifecycleListeners = useRef<Set<(event: LifecycleEvent) => void>>(new Set());
  const dirtyRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (frozenRef.current) return; // stay dirty; a catch-up flush runs on unfreeze
      if (!dirtyRef.current) return;
      dirtyRef.current = false;

      // Error nodes only appear once at least one exception has actually occurred. They are
      // never removed from the topology (so a reset just zeroes the counter), so we hide any
      // error node whose counter is 0 — and the edges leading into it — until it fires again.
      const hidden = new Set<string>();
      const nodes: TLNode[] = [];
      nodesRef.current.forEach((n) => {
        if (n.kind === 'error' && n.count === 0) hidden.add(n.id);
        else nodes.push(n);
      });
      const edges = Array.from(edgesRef.current.values()).filter((e) => !hidden.has(e.to));

      setNodes(nodes);
      setEdges(edges);
    });
  }, []);

  const onPulse = useCallback((cb: (pulse: PulseEvent) => void) => {
    listeners.current.add(cb);
    return () => {
      listeners.current.delete(cb);
    };
  }, []);

  const onLifecycle = useCallback((cb: (event: LifecycleEvent) => void) => {
    lifecycleListeners.current.add(cb);
    return () => {
      lifecycleListeners.current.delete(cb);
    };
  }, []);

  const reset = useCallback(() => {
    wsRef.current?.send('reset');
  }, []);

  // Reflect the frozen flag into a ref (so toggling it never re-runs the WS-connect effect) and,
  // when unfreezing, flush whatever accumulated in the refs while the view was held still.
  useEffect(() => {
    frozenRef.current = frozen;
    if (!frozen && dirtyRef.current) scheduleFlush();
  }, [frozen, scheduleFlush]);

  useEffect(() => {
    let closed = false;
    let retry = 0;
    let socket: WebSocket;

    const handle = (event: TracelightEvent) => {
      // Lifecycle frames are pure animation triggers: no counters/topology touched, so no
      // React flush — straight to the imperative subscribers.
      if (event.type === 'open' || event.type === 'close') {
        lifecycleListeners.current.forEach((cb) => cb(event));
        return;
      }
      switch (event.type) {
        case 'snapshot':
          nodesRef.current = new Map(event.nodes.map((n) => [n.id, { ...n }]));
          edgesRef.current = new Map(event.edges.map((e) => [e.id, { ...e }]));
          break;
        case 'topology':
          event.nodes?.forEach((n) => {
            if (!nodesRef.current.has(n.id)) nodesRef.current.set(n.id, { ...n });
          });
          event.edges?.forEach((e) => {
            if (!edgesRef.current.has(e.id)) edgesRef.current.set(e.id, { ...e });
          });
          break;
        case 'pulse': {
          const node = nodesRef.current.get(event.to);
          if (node) nodesRef.current.set(event.to, { ...node, count: event.count });
          const eid = `${event.from}->${event.to}`;
          const edge = edgesRef.current.get(eid);
          if (edge) edgesRef.current.set(eid, withTiming(edge, event));
          listeners.current.forEach((cb) => cb(event));
          break;
        }
        case 'batch': {
          event.nodes.forEach((nd) => {
            const node = nodesRef.current.get(nd.id);
            if (node) nodesRef.current.set(nd.id, { ...node, count: nd.count });
          });
          // One animation per active edge in the window keeps the UI light
          // regardless of how many hits the batch aggregated.
          event.edges.forEach((ed) => {
            const edge = edgesRef.current.get(ed.id);
            if (edge) edgesRef.current.set(ed.id, withTiming(edge, ed));
            if (ed.delta > 0) {
              listeners.current.forEach((cb) =>
                cb({ type: 'pulse', traceId: '-', from: ed.from, to: ed.to, count: 0 }),
              );
            }
          });
          break;
        }
        case 'reset':
          nodesRef.current.forEach((n, id) => {
            nodesRef.current.set(id, { ...n, count: 0 });
          });
          edgesRef.current.forEach((e, id) => {
            edgesRef.current.set(id, { ...e, min: undefined, avg: undefined, max: undefined, samples: undefined });
          });
          break;
      }
      dirtyRef.current = true;
      scheduleFlush();
    };

    const connect = () => {
      socket = new WebSocket(url);
      wsRef.current = socket;
      socket.onopen = () => {
        retry = 0;
        setConnected(true);
      };
      socket.onclose = () => {
        setConnected(false);
        if (!closed) {
          retry = Math.min(retry + 1, 10);
          setTimeout(connect, 300 * retry);
        }
      };
      socket.onerror = () => socket.close();
      socket.onmessage = (ev) => {
        try {
          handle(JSON.parse(ev.data) as TracelightEvent);
        } catch {
          /* ignore malformed frames */
        }
      };
    };

    connect();
    return () => {
      closed = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      socket?.close();
    };
  }, [url, scheduleFlush]);

  return { nodes, edges, connected, onPulse, onLifecycle, reset };
}
