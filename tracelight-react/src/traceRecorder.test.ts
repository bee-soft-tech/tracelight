import { describe, expect, it } from 'vitest';
import { TraceRecorder } from './traceRecorder';

describe('TraceRecorder', () => {
  it('captures one request as an ordered trace with per-hop latency', () => {
    const r = new TraceRecorder();
    r.open('t1', 'GET /search', 0);
    r.pulse('t1', 'GET /search', 'search', 5, 1);
    r.pulse('t1', 'search', 'db', 40, 2);
    r.pulse('t1', 'db', 'Return GET /search', 3, 3);
    const trace = r.close('t1', 100);

    expect(trace).not.toBeNull();
    expect(trace!.entry).toBe('GET /search');
    expect(trace!.hops).toEqual([
      { from: 'GET /search', to: 'search', ms: 5 },
      { from: 'search', to: 'db', ms: 40 },
      { from: 'db', to: 'Return GET /search', ms: 3 },
    ]);
    expect(trace!.totalMs).toBe(48);
    expect(trace!.at).toBe(100);
  });

  it('demultiplexes two interleaved requests by traceId', () => {
    const r = new TraceRecorder();
    r.open('a', 'GET /search', 0);
    r.open('b', 'POST /order', 0);
    r.pulse('a', 'GET /search', 'search', 5, 1);
    r.pulse('b', 'POST /order', 'validate', 2, 1);
    r.pulse('a', 'search', 'db', 10, 2);
    const ta = r.close('a', 10);
    const tb = r.close('b', 11);

    expect(ta!.entry).toBe('GET /search');
    expect(ta!.hops.map((h) => h.to)).toEqual(['search', 'db']);
    expect(tb!.entry).toBe('POST /order');
    expect(tb!.hops.map((h) => h.to)).toEqual(['validate']);
    expect(ta!.id).not.toBe(tb!.id);
  });

  it('returns null for a request that produced no hops', () => {
    const r = new TraceRecorder();
    r.open('t1', 'GET /ping', 0);
    expect(r.close('t1', 1)).toBeNull();
  });

  it('returns null when closing an unknown trace', () => {
    const r = new TraceRecorder();
    expect(r.close('nope', 1)).toBeNull();
  });

  it('assigns monotonic ids across captures', () => {
    const r = new TraceRecorder();
    r.pulse('a', 'E', 'x', 1, 0);
    r.pulse('b', 'E', 'y', 1, 0);
    expect(r.close('a', 1)!.id).toBe(0);
    expect(r.close('b', 1)!.id).toBe(1);
  });
});
