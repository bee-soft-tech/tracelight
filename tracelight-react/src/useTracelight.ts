import { useCallback, useEffect, useRef, useState } from 'react';
import type { PulseEvent, TLEdge, TLNode, TracelightEvent } from './types';

export interface TracelightState {
  /** Current nodes with live counters. New array reference whenever something changes. */
  nodes: TLNode[];
  /** Current edges. */
  edges: TLEdge[];
  /** Whether the WebSocket is currently open. */
  connected: boolean;
  /** Subscribe to pulse events (for animations). Returns an unsubscribe function. */
  onPulse: (cb: (pulse: PulseEvent) => void) => () => void;
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
export function useTracelight(url: string): TracelightState {
  const [nodes, setNodes] = useState<TLNode[]>([]);
  const [edges, setEdges] = useState<TLEdge[]>([]);
  const [connected, setConnected] = useState(false);

  const nodesRef = useRef<Map<string, TLNode>>(new Map());
  const edgesRef = useRef<Map<string, TLEdge>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const listeners = useRef<Set<(pulse: PulseEvent) => void>>(new Set());
  const dirtyRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      setNodes(Array.from(nodesRef.current.values()));
      setEdges(Array.from(edgesRef.current.values()));
    });
  }, []);

  const onPulse = useCallback((cb: (pulse: PulseEvent) => void) => {
    listeners.current.add(cb);
    return () => {
      listeners.current.delete(cb);
    };
  }, []);

  const reset = useCallback(() => {
    wsRef.current?.send('reset');
  }, []);

  useEffect(() => {
    let closed = false;
    let retry = 0;
    let socket: WebSocket;

    const handle = (event: TracelightEvent) => {
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
          if (node) node.count = event.count;
          listeners.current.forEach((cb) => cb(event));
          break;
        }
        case 'reset':
          nodesRef.current.forEach((n) => {
            n.count = 0;
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

  return { nodes, edges, connected, onPulse, reset };
}
