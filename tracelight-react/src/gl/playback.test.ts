import { describe, expect, it } from 'vitest';
import { HOP_MAX_MS, HOP_MIN_MS, TRACE_TTL_MS } from './constants';
import {
  advance,
  createPlayback,
  enqueue,
  hopDuration,
  isDone,
  shouldEvict,
  type Hop,
  type HopGeom,
  type HopResolver,
} from './playback';

/** Straight horizontal trajectory of the given length starting at x = 100 * index. */
function geomAt(index: number, dist = 1000): HopGeom {
  const x = index * 100;
  return {
    start: { x, y: 0 },
    c1: { x: x + dist / 3, y: 0 },
    c2: { x: x + (2 * dist) / 3, y: 0 },
    end: { x: x + dist, y: 0 },
    dist,
  };
}

function hop(n: number): Hop {
  return { from: `n${n}`, to: `n${n + 1}` };
}

/** Resolves every hop to a `dist`-long segment (dist=1000 ⇒ dur clamps to HOP_MAX_MS). */
function resolver(dist = 1000): HopResolver {
  return (h) => geomAt(Number(h.from.slice(1)), dist);
}

describe('hopDuration', () => {
  it('scales with distance inside the clamp', () => {
    expect(hopDuration(800)).toBeCloseTo(120); // 800 * 0.15
  });

  it('clamps short hops to the minimum', () => {
    expect(hopDuration(10)).toBe(HOP_MIN_MS);
    expect(hopDuration(0)).toBe(HOP_MIN_MS);
  });

  it('clamps long hops to the maximum', () => {
    expect(hopDuration(10_000)).toBe(HOP_MAX_MS);
  });
});

describe('advance', () => {
  it('is idle with an empty queue', () => {
    const pb = createPlayback(0);
    expect(advance(pb, 16, resolver(), 16)).toBeNull();
    expect(isDone(pb)).toBe(true);
  });

  it('plays hops strictly in FIFO order, one at a time', () => {
    const pb = createPlayback(0);
    enqueue(pb, hop(0), 0);
    enqueue(pb, hop(1), 0);
    enqueue(pb, hop(2), 0);

    const seen: string[] = [];
    let now = 0;
    // 1000-long hops clamp to HOP_MAX_MS each; step well past the total.
    for (let i = 0; i < 100 && !isDone(pb); i++) {
      now += 16;
      const res = advance(pb, 16, resolver(), now, (h) => seen.push(h.from));
      if (res) expect(res.hop.from <= `n${seen.length}`).toBe(true);
    }
    expect(seen).toEqual(['n0', 'n1', 'n2']); // every hop completed, in order, none skipped
    expect(isDone(pb)).toBe(true);
  });

  it('each hop consumes its full duration — a burst does not collapse into one frame', () => {
    const pb = createPlayback(0);
    for (let i = 0; i < 10; i++) enqueue(pb, hop(i), 0);

    let frames = 0;
    let now = 0;
    while (!isDone(pb) && frames < 10_000) {
      now += 16;
      frames++;
      advance(pb, 16, resolver(), now);
    }
    // 10 hops × HOP_MAX_MS (1000-px hops clamp to 150 ms) = 1500 ms ≈ 94 16-ms frames.
    const totalMs = frames * 16;
    expect(totalMs).toBeGreaterThanOrEqual(10 * HOP_MAX_MS - 16);
    expect(totalMs).toBeLessThanOrEqual(10 * HOP_MAX_MS + 32);
  });

  it('carries leftover time across a hop boundary exactly', () => {
    const pb = createPlayback(0);
    enqueue(pb, hop(0), 0);
    enqueue(pb, hop(1), 0);

    // One giant frame covering hop 0 entirely (150 ms) plus half of hop 1.
    const res = advance(pb, HOP_MAX_MS + HOP_MAX_MS / 2, resolver(), 0);
    expect(res).not.toBeNull();
    expect(res!.hop.from).toBe('n1');
    // Hop 1 runs x=100..1100; at t=0.5 the bezier of a uniform segment sits at its middle.
    expect(res!.point.x).toBeCloseTo(600, 0);
  });

  it('rests on the endpoint the frame the last hop completes, then reports idle', () => {
    const pb = createPlayback(0);
    enqueue(pb, hop(0), 0);
    const res = advance(pb, HOP_MAX_MS + 5, resolver(), 0);
    expect(res!.point).toEqual({ x: 1000, y: 0 });
    expect(advance(pb, 16, resolver(), 16)).toBeNull();
  });

  it('interpolates linearly in time (no easing)', () => {
    const pb = createPlayback(0);
    enqueue(pb, hop(0), 0);
    // dist 1000 ⇒ dur = HOP_MAX_MS. Advance a quarter of it → t = 0.25.
    const res = advance(pb, HOP_MAX_MS / 4, resolver(), 0);
    // Uniformly spaced control points make the bezier's x linear in t: x = 1000 * t.
    expect(res!.point.x).toBeCloseTo(250, 0);
  });

  it('defers without consuming the hop, then resumes', () => {
    const pb = createPlayback(0);
    enqueue(pb, hop(0), 0);
    const deferAll: HopResolver = () => 'defer';
    expect(advance(pb, 16, deferAll, 16)).toBeNull();
    expect(pb.queue).toHaveLength(1); // still queued
    const res = advance(pb, 16, resolver(), 32); // drag ended — plays normally
    expect(res!.hop.from).toBe('n0');
  });

  it('pauses an in-flight hop when its node starts being dragged, then re-plays it', () => {
    const pb = createPlayback(0);
    enqueue(pb, hop(0), 0);
    // Fly a quarter of the hop.
    const mid = advance(pb, HOP_MAX_MS / 4, resolver(), 0);
    expect(mid!.point.x).toBeCloseTo(250, 0);
    expect(pb.active).not.toBeNull();
    // A drag begins on this hop's node: the dot hides and the hop is requeued, not consumed.
    const dragN0 = (h: Hop) => h.from === 'n0';
    expect(advance(pb, 16, resolver(), 16, undefined, undefined, dragN0)).toBeNull();
    expect(pb.active).toBeNull();
    expect(pb.queue).toHaveLength(1);
    // Drag ends: the hop re-resolves and plays from its start (new trajectory), not from where
    // the frozen path had drifted to.
    const res = advance(pb, HOP_MAX_MS / 4, resolver(), 32);
    expect(res!.hop.from).toBe('n0');
    expect(res!.point.x).toBeCloseTo(250, 0);
  });

  it('drops hops whose endpoints are unknown without spending time on them', () => {
    const pb = createPlayback(0);
    enqueue(pb, hop(0), 0);
    enqueue(pb, hop(1), 0);
    const dropFirst: HopResolver = (h) => (h.from === 'n0' ? null : geomAt(1));
    const res = advance(pb, 16, dropFirst, 16);
    expect(res!.hop.from).toBe('n1'); // n0 dropped, n1 starts immediately
  });

  it('honors an explicit per-hop duration (durationFor) over the distance default', () => {
    const pb = createPlayback(0);
    enqueue(pb, hop(0), 0);
    // Distance default would be HOP_MAX_MS (=150) for a 1000-px hop; force 600 ms instead.
    const durationFor = () => 600;
    // A quarter of the forced duration → t = 0.25 → x = 250 on the uniform 0..1000 segment.
    const res = advance(pb, 150, resolver(), 0, undefined, durationFor);
    expect(res!.point.x).toBeCloseTo(250, 0);
    // With the distance default the same 150 ms would have completed the hop (idle after).
    expect(isDone(pb)).toBe(false);
  });

});

describe('shouldEvict', () => {
  it('never evicts while hops are queued or in flight', () => {
    const pb = createPlayback(0);
    enqueue(pb, hop(0), 0);
    pb.closing = true;
    expect(shouldEvict(pb, TRACE_TTL_MS * 10, TRACE_TTL_MS)).toBe(false);
  });

  it('evicts as soon as a closing playback drains', () => {
    const pb = createPlayback(0);
    enqueue(pb, hop(0), 0);
    pb.closing = true;
    let now = 0;
    while (!isDone(pb)) {
      now += 16;
      advance(pb, 16, resolver(), now);
    }
    expect(shouldEvict(pb, now, TRACE_TTL_MS)).toBe(true);
  });

  it('evicts an idle non-closing playback only after the TTL (missed close)', () => {
    const pb = createPlayback(0);
    expect(shouldEvict(pb, TRACE_TTL_MS - 1, TRACE_TTL_MS)).toBe(false);
    expect(shouldEvict(pb, TRACE_TTL_MS + 1, TRACE_TTL_MS)).toBe(true);
  });
});
