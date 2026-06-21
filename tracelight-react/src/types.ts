/** A point in the code (a graph node). */
export interface TLNode {
  id: string;
  label: string;
  kind: 'entry' | 'point';
  count: number;
}

/** A directed transition between two points, discovered from traffic. */
export interface TLEdge {
  id: string;
  from: string;
  to: string;
}

export interface SnapshotEvent {
  type: 'snapshot';
  nodes: TLNode[];
  edges: TLEdge[];
}

export interface TopologyEvent {
  type: 'topology';
  nodes?: TLNode[];
  edges?: TLEdge[];
}

export interface PulseEvent {
  type: 'pulse';
  traceId: string;
  from: string;
  to: string;
  count: number;
}

export interface ResetEvent {
  type: 'reset';
}

export type TracelightEvent = SnapshotEvent | TopologyEvent | PulseEvent | ResetEvent;
