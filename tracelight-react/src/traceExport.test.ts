import { describe, expect, it } from 'vitest';
import { parseTraceExport, serializeTraces } from './traceExport';
import type { RecordedTrace } from './types';

const sample: RecordedTrace = {
  id: 3,
  entry: 'GET /search',
  hops: [
    { from: 'GET /search', to: 'svc', ms: 5 },
    { from: 'svc', to: 'db', ms: undefined },
  ],
  totalMs: 5,
  at: 1_700_000_000_000,
};

describe('traceExport', () => {
  it('round-trips through serialize → JSON → parse', () => {
    const json = JSON.stringify(serializeTraces([sample]));
    expect(parseTraceExport(json)).toEqual([sample]);
  });

  it('accepts a bare array of traces', () => {
    expect(parseTraceExport(JSON.stringify([sample]))).toEqual([sample]);
  });

  it('rejects non-JSON text', () => {
    expect(() => parseTraceExport('{not json')).toThrow(/valid JSON/i);
  });

  it('rejects an envelope whose traces are the wrong shape', () => {
    const bad = JSON.stringify({ version: 1, traces: [{ id: 'x', entry: 'GET /y' }] });
    expect(() => parseTraceExport(bad)).toThrow(/wrong shape/i);
  });

  it('rejects a payload with no traces array', () => {
    expect(() => parseTraceExport(JSON.stringify({ version: 1 }))).toThrow(/array of traces/i);
  });
});
