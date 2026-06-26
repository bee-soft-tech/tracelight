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
  /** Minimum node width; a node grows past it to fit a long label + counter. */
  nodeWidth: number;
  nodeHeight: number;
}

export interface NodePosition {
  x: number;
  y: number;
  /** Computed node width (≥ the minimum), so renderers and edges match the layout exactly. */
  width: number;
}

// Inner spacing used when sizing a node to its content (must mirror the renderers' layout).
const LABEL_START = 24; // left padding + status LED
const LABEL_GAP = 10; // gap between label and counter
const COUNTER_RESERVE = 56; // room for the counter pill (stable, so counter growth never relayouts)
const RIGHT_PAD = 12;
const LABEL_FONT = '600 13px ui-sans-serif, system-ui, sans-serif';

let measureCtx: CanvasRenderingContext2D | null = null;

function measureLabel(text: string): number {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d');
    if (measureCtx) measureCtx.font = LABEL_FONT;
  }
  return measureCtx ? measureCtx.measureText(text).width : text.length * 7.5;
}

/** Width a node needs to fit {@code label} plus its counter, clamped to at least {@code min}. */
export function nodeWidthFor(label: string, min: number): number {
  const content = LABEL_START + Math.ceil(measureLabel(label)) + LABEL_GAP + COUNTER_RESERVE + RIGHT_PAD;
  return Math.max(min, content);
}

/**
 * Lays the graph out left→right with elkjs' layered algorithm. Each node is sized to its own
 * label + counter (so long names don't overlap the count), and the chosen width is returned in
 * the position so renderers and edge endpoints line up with the layout.
 */
export async function layoutGraph(
  nodes: TLNode[],
  edges: TLEdge[],
  options: LayoutOptions,
): Promise<Map<string, NodePosition>> {
  const positions = new Map<string, NodePosition>();
  if (nodes.length === 0) return positions;

  const widths = new Map(nodes.map((n) => [n.id, nodeWidthFor(n.label, options.nodeWidth)]));

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
      width: widths.get(n.id) ?? options.nodeWidth,
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
    positions.set(child.id, {
      x: child.x ?? 0,
      y: child.y ?? 0,
      width: widths.get(child.id) ?? options.nodeWidth,
    });
  });
  return positions;
}
