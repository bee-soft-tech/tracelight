import ELK from 'elkjs/lib/elk-api';
// Run the elk layout engine in a Web Worker so a relayout never blocks the UI thread.
// (The previous elk.bundled.js ran synchronously on the main thread — 20–70 ms per
// layout on a ~20-node graph, i.e. multiple dropped frames each time.)
import ElkWorker from 'elkjs/lib/elk-worker.min.js?worker';
import type { TLEdge, TLNode } from './types';

let elkInstance: InstanceType<typeof ELK> | null = null;

function getElk(): InstanceType<typeof ELK> {
  if (!elkInstance) {
    elkInstance = new ELK({ workerFactory: () => new ElkWorker() });
  }
  return elkInstance;
}

export interface LayoutOptions {
  nodeWidth: number;
  nodeHeight: number;
}

export interface NodePosition {
  x: number;
  y: number;
}

/**
 * Lays the graph out left→right with elkjs' layered algorithm.
 * Returns a map of node id → position. Runs off the main work via elk's bundled engine.
 */
export async function layoutGraph(
  nodes: TLNode[],
  edges: TLEdge[],
  options: LayoutOptions,
): Promise<Map<string, NodePosition>> {
  const positions = new Map<string, NodePosition>();
  if (nodes.length === 0) return positions;

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      'elk.spacing.nodeNode': '40',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    },
    children: nodes.map((n) => ({
      id: n.id,
      width: options.nodeWidth,
      height: options.nodeHeight,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      sources: [e.from],
      targets: [e.to],
    })),
  };

  const result = await getElk().layout(graph);
  result.children?.forEach((child) => {
    positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  });
  return positions;
}
