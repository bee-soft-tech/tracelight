/** A point in the code (a graph node). */
export interface TLNode {
  id: string;
  label: string;
  kind: 'entry' | 'point' | 'error';
  count: number;
  /** Exception message — present only on `error` nodes. */
  message?: string;
  /** Top stack frames — present only on `error` nodes. */
  stack?: string[];
}

/** Cumulative latency of crossing an edge, in milliseconds, since the last reset. */
export interface TLEdgeTiming {
  /** Fastest observed traversal (ms). */
  min: number;
  /** Mean traversal (ms). */
  avg: number;
  /** Slowest observed traversal (ms). */
  max: number;
  /** Number of timed samples. */
  samples: number;
}

/** A directed transition between two points, discovered from traffic. */
export interface TLEdge extends Partial<TLEdgeTiming> {
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

export interface PulseEvent extends Partial<TLEdgeTiming> {
  type: 'pulse';
  traceId: string;
  from: string;
  to: string;
  count: number;
}

/** Aggregated hits over one server-side flush window (heavy-traffic mode). */
export interface BatchEvent {
  type: 'batch';
  nodes: { id: string; count: number; delta: number }[];
  edges: ({ id: string; from: string; to: string; delta: number } & Partial<TLEdgeTiming>)[];
}

export interface ResetEvent {
  type: 'reset';
}

export type TracelightEvent =
  | SnapshotEvent
  | TopologyEvent
  | PulseEvent
  | BatchEvent
  | ResetEvent;
