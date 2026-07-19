import { describe, expect, it } from 'vitest';
import { waterfallLayout } from './waterfall';
import type { RecordedTrace } from './types';

function trace(hops: RecordedTrace['hops']): RecordedTrace {
  const totalMs = hops.reduce((s, h) => s + (h.ms ?? 0), 0);
  return { id: 0, entry: 'GET /x', hops, totalMs, at: 0 };
}

describe('waterfallLayout', () => {
  it('stacks hops so each starts where the previous ended', () => {
    const { rows, totalMs } = waterfallLayout(
      trace([
        { from: 'GET /x', to: 'a', ms: 5 },
        { from: 'a', to: 'b', ms: 40 },
        { from: 'b', to: 'Return GET /x', ms: 3 },
      ]),
    );
    expect(totalMs).toBe(48);
    expect(rows.map((r) => [r.offsetMs, r.widthMs])).toEqual([
      [0, 5],
      [5, 40],
      [45, 3],
    ]);
  });

  it('gives untimed hops zero width but still advances a row', () => {
    const { rows } = waterfallLayout(
      trace([
        { from: 'GET /x', to: 'a', ms: 10 },
        { from: 'a', to: 'b', ms: undefined },
        { from: 'b', to: 'c', ms: 6 },
      ]),
    );
    expect(rows.map((r) => [r.offsetMs, r.widthMs])).toEqual([
      [0, 10],
      [10, 0],
      [10, 6],
    ]);
    expect(rows[1].ms).toBeUndefined();
  });

  it('never returns a zero total (safe to divide) even with no timings', () => {
    const { totalMs } = waterfallLayout(trace([{ from: 'GET /x', to: 'a', ms: undefined }]));
    expect(totalMs).toBe(1);
  });

  it('handles a single timed hop', () => {
    const { rows, totalMs } = waterfallLayout(trace([{ from: 'GET /x', to: 'a', ms: 7 }]));
    expect(totalMs).toBe(7);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ offsetMs: 0, widthMs: 7 });
  });
});
