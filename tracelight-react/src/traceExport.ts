/**
 * Serialize captured requests to a shareable file and parse them back — pure, unit-testable.
 *
 * Export writes a versioned envelope; import accepts that envelope (or a bare array, for
 * hand-authored files) and validates every trace's shape so a bad paste fails loudly.
 */

import type { RecordedTrace, ReplayHop } from './types';

/** The JSON envelope written by Export and read by Import. */
export interface TraceExport {
  version: 1;
  exportedAt: number;
  traces: RecordedTrace[];
}

const CURRENT_VERSION = 1;

/** Wrap captured requests in the versioned export envelope. */
export function serializeTraces(traces: RecordedTrace[]): TraceExport {
  return { version: CURRENT_VERSION, exportedAt: Date.now(), traces };
}

function isHop(x: unknown): x is ReplayHop {
  if (typeof x !== 'object' || x === null) return false;
  const h = x as Record<string, unknown>;
  return (
    typeof h.from === 'string' &&
    typeof h.to === 'string' &&
    (h.ms === undefined || typeof h.ms === 'number')
  );
}

function isTrace(x: unknown): x is RecordedTrace {
  if (typeof x !== 'object' || x === null) return false;
  const t = x as Record<string, unknown>;
  return (
    typeof t.id === 'number' &&
    typeof t.entry === 'string' &&
    Array.isArray(t.hops) &&
    t.hops.every(isHop) &&
    typeof t.totalMs === 'number' &&
    typeof t.at === 'number'
  );
}

/**
 * Parse and validate an exported-traces file (raw text or an already-parsed value). Throws an
 * Error with a human-readable message on anything malformed so the UI can surface it. Accepts
 * either the `{ traces: [...] }` envelope or a bare array of traces.
 */
export function parseTraceExport(input: string | unknown): RecordedTrace[] {
  let data: unknown = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch {
      throw new Error('Not valid JSON.');
    }
  }
  const traces = Array.isArray(data) ? data : (data as { traces?: unknown } | null)?.traces;
  if (!Array.isArray(traces)) {
    throw new Error('Expected a { traces: [...] } object or an array of traces.');
  }
  if (!traces.every(isTrace)) {
    throw new Error('One or more traces have the wrong shape.');
  }
  return traces as RecordedTrace[];
}
