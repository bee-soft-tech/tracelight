import { useCallback, useMemo, useRef } from 'react';
import { reachableSubgraph } from './routeView';
import type { LifecycleEvent, TracelightState } from './useTracelight';
import type { PulseEvent } from './types';

/**
 * Narrows a live {@link TracelightState} to a single route (its entry-node id): the returned
 * graph exposes only that route's reachable subgraph — including its terminal "Return <entry>"
 * node, which is the visible end of the flow. Its `onPulse`/`onLifecycle` wrappers drop events
 * for anything outside the route — so dots from other routes still streaming over the same socket
 * never animate on the focused canvas. `connected` and `reset` pass straight through.
 *
 * Before any route is known (`selectedRoute` is `null`) the graph is empty.
 */
export function useRouteView(graph: TracelightState, selectedRoute: string | null): TracelightState {
  const { nodes, edges, onPulse, onLifecycle } = graph;

  const view = useMemo(() => {
    if (selectedRoute == null) return { nodes: [], edges: [], ids: new Set<string>() };
    return reachableSubgraph(nodes, edges, selectedRoute);
  }, [nodes, edges, selectedRoute]);

  // The wrappers read visibility from a ref so their identity stays stable across renders
  // (subscribers in TraceGraph re-subscribe only when onPulse/onLifecycle change).
  const gate = useRef<{ ids: Set<string>; entry: string | null }>({ ids: new Set(), entry: null });
  gate.current = { ids: view.ids, entry: selectedRoute };

  const gatedPulse = useCallback(
    (cb: (pulse: PulseEvent) => void) =>
      onPulse((p) => {
        const { ids } = gate.current;
        if (!ids.has(p.from) || !ids.has(p.to)) return;
        cb(p);
      }),
    [onPulse],
  );

  const gatedLifecycle = useCallback(
    (cb: (event: LifecycleEvent) => void) =>
      onLifecycle((e) => {
        const { entry } = gate.current;
        // `open` names the entry directly; `close` carries it as `to`.
        const eventEntry = e.type === 'open' ? e.entry : e.to;
        if (entry == null || eventEntry !== entry) return;
        cb(e);
      }),
    [onLifecycle],
  );

  return {
    nodes: view.nodes,
    edges: view.edges,
    connected: graph.connected,
    onPulse: gatedPulse,
    onLifecycle: gatedLifecycle,
    reset: graph.reset,
  };
}
