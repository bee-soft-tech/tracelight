import { describe, expect, it } from 'vitest';
import { deriveRoutes, reachableSubgraph } from './routeView';
import type { TLEdge, TLNode } from './types';

function node(id: string, kind: TLNode['kind'], count = 0): TLNode {
  return { id, label: id, kind, count };
}

function edge(from: string, to: string): TLEdge {
  return { id: `${from}->${to}`, from, to };
}

describe('deriveRoutes', () => {
  it('keeps only entry nodes, sorted alphabetically, carrying counts', () => {
    const nodes = [
      node('GET /orders', 'entry', 7),
      node('svc.load', 'point', 99),
      node('GET /health', 'entry', 3),
      node('boom', 'error', 1),
    ];
    expect(deriveRoutes(nodes)).toEqual([
      { id: 'GET /health', label: 'GET /health', count: 3 },
      { id: 'GET /orders', label: 'GET /orders', count: 7 },
    ]);
  });

  it('excludes the synthetic "Return <entry>" nodes (also registered as entries)', () => {
    const nodes = [
      node('GET /orders', 'entry', 7),
      node('Return GET /orders', 'entry', 7),
    ];
    expect(deriveRoutes(nodes)).toEqual([{ id: 'GET /orders', label: 'GET /orders', count: 7 }]);
  });

  it('returns nothing when there are no entry nodes', () => {
    expect(deriveRoutes([node('svc.load', 'point')])).toEqual([]);
  });
});

describe('reachableSubgraph', () => {
  it('follows a linear chain, including the Return terminal', () => {
    const nodes = [
      node('GET /a', 'entry'),
      node('svc', 'point'),
      node('Return GET /a', 'entry'),
    ];
    const edges = [edge('GET /a', 'svc'), edge('svc', 'Return GET /a')];
    const sub = reachableSubgraph(nodes, edges, 'GET /a');
    expect([...sub.ids].sort()).toEqual(['GET /a', 'Return GET /a', 'svc']);
    expect(sub.nodes).toHaveLength(3);
    expect(sub.edges).toHaveLength(2);
  });

  it('excludes nodes reachable only from a different entry', () => {
    const nodes = [
      node('GET /a', 'entry'),
      node('GET /b', 'entry'),
      node('shared', 'point'),
      node('only-b', 'point'),
    ];
    const edges = [edge('GET /a', 'shared'), edge('GET /b', 'shared'), edge('GET /b', 'only-b')];
    const sub = reachableSubgraph(nodes, edges, 'GET /a');
    expect([...sub.ids].sort()).toEqual(['GET /a', 'shared']);
    // The edge from the other entry into the shared node is dropped (its `from` is out of view).
    expect(sub.edges).toEqual([edge('GET /a', 'shared')]);
  });

  it('includes a shared point in every route that reaches it', () => {
    const nodes = [node('GET /a', 'entry'), node('GET /b', 'entry'), node('shared', 'point')];
    const edges = [edge('GET /a', 'shared'), edge('GET /b', 'shared')];
    expect(reachableSubgraph(nodes, edges, 'GET /a').ids.has('shared')).toBe(true);
    expect(reachableSubgraph(nodes, edges, 'GET /b').ids.has('shared')).toBe(true);
  });

  it('terminates on a cycle', () => {
    const nodes = [node('GET /a', 'entry'), node('x', 'point'), node('y', 'point')];
    const edges = [edge('GET /a', 'x'), edge('x', 'y'), edge('y', 'x')];
    const sub = reachableSubgraph(nodes, edges, 'GET /a');
    expect([...sub.ids].sort()).toEqual(['GET /a', 'x', 'y']);
  });

  it('returns an empty slice for an unknown entry', () => {
    const sub = reachableSubgraph([node('GET /a', 'entry')], [], 'nope');
    expect(sub.nodes).toEqual([]);
    expect(sub.edges).toEqual([]);
    expect(sub.ids.size).toBe(0);
  });
});
