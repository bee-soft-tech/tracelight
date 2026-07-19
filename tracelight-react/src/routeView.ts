import type { TLEdge, TLNode } from './types';

/** A selectable route: an entry node, with its live request count for display. */
export interface RouteInfo {
  /** Entry-node id, e.g. "GET /orders". */
  id: string;
  /** Human label (same as id today, kept separate for flexibility). */
  label: string;
  /** How many requests have hit this route since the last reset. */
  count: number;
}

/** Backend prefix for the synthetic terminal node of each route (TracelightBroadcaster). */
const RETURN_PREFIX = 'Return ';

/**
 * The routes offered in the dropdown: one per real `entry` node, sorted alphabetically by label.
 * The backend registers each route's terminal node as an entry too (id `"Return <entry>"`), so
 * those are filtered out — they are not routes. The count is carried for display only; it never
 * affects ordering.
 */
export function deriveRoutes(nodes: TLNode[]): RouteInfo[] {
  return nodes
    .filter((n) => n.kind === 'entry' && !n.id.startsWith(RETURN_PREFIX))
    .map((n) => ({ id: n.id, label: n.label, count: n.count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** A graph slice: the nodes/edges to render plus the id set for quick membership checks. */
export interface Subgraph {
  nodes: TLNode[];
  edges: TLEdge[];
  ids: Set<string>;
}

/**
 * The subgraph reachable from `entryId` by following edges forward — i.e. everything a request
 * entering this route can touch, including its terminal "Return <entry>" node. Shared points (hit
 * by more than one route) appear in every route that can reach them. An unknown or absent entry
 * yields an empty slice.
 */
export function reachableSubgraph(nodes: TLNode[], edges: TLEdge[], entryId: string): Subgraph {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (!byId.has(entryId)) return { nodes: [], edges: [], ids: new Set() };

  // Adjacency: from -> [to, ...]
  const out = new Map<string, string[]>();
  for (const e of edges) {
    const list = out.get(e.from);
    if (list) list.push(e.to);
    else out.set(e.from, [e.to]);
  }

  const ids = new Set<string>([entryId]);
  const queue = [entryId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of out.get(cur) ?? []) {
      if (!ids.has(next) && byId.has(next)) {
        ids.add(next);
        queue.push(next);
      }
    }
  }

  return {
    nodes: nodes.filter((n) => ids.has(n.id)),
    edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
    ids,
  };
}
