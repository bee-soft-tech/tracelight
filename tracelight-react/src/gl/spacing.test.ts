import { describe, expect, it } from 'vitest';
import { pushOutOne, relaxAll, type Center } from './spacing';

const MIN = 200;
const ITER = 3;

function dist(a: Center, b: Center): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function centers(entries: Record<string, Center>): Map<string, Center> {
  return new Map(Object.entries(entries).map(([id, c]) => [id, { ...c }]));
}

describe('pushOutOne', () => {
  it('projects the moving node out of a neighbor radius', () => {
    const m = centers({ a: { x: 0, y: 0 }, b: { x: 50, y: 0 } });
    const pushed = pushOutOne(m, 'b', MIN, ITER);
    expect(pushed).toBe(true);
    expect(dist(m.get('a')!, m.get('b')!)).toBeGreaterThanOrEqual(MIN - 1e-9);
    expect(m.get('a')).toEqual({ x: 0, y: 0 }); // only the dragged node moves
  });

  it('leaves already-distant nodes untouched and reports no push', () => {
    const m = centers({ a: { x: 0, y: 0 }, b: { x: 500, y: 0 } });
    expect(pushOutOne(m, 'b', MIN, ITER)).toBe(false);
    expect(m.get('b')).toEqual({ x: 500, y: 0 });
  });

  it('slides along the boundary: the push preserves the tangential component', () => {
    const m = centers({ a: { x: 0, y: 0 }, b: { x: 100, y: 30 } });
    pushOutOne(m, 'b', MIN, ITER);
    const b = m.get('b')!;
    expect(dist(m.get('a')!, b)).toBeGreaterThanOrEqual(MIN - 1e-9);
    // Pushed radially: still on the same side, same direction ratio.
    expect(b.x).toBeGreaterThan(0);
    expect(b.y).toBeGreaterThan(0);
    expect(b.y / b.x).toBeCloseTo(30 / 100);
  });

  it('relaxes through chained violations (escaping A can push into B)', () => {
    const m = centers({
      a: { x: 0, y: 0 },
      b: { x: MIN, y: 0 },
      dragged: { x: 60, y: 10 }, // inside a's radius; pushing out lands near b
    });
    pushOutOne(m, 'dragged', MIN, ITER);
    const d = m.get('dragged')!;
    expect(dist(m.get('a')!, d)).toBeGreaterThanOrEqual(MIN - 1e-6);
    expect(dist(m.get('b')!, d)).toBeGreaterThanOrEqual(MIN - 1e-6);
  });

  it('ignores an exactly coincident node (no defined push direction)', () => {
    const m = centers({ a: { x: 10, y: 10 }, b: { x: 10, y: 10 } });
    expect(pushOutOne(m, 'b', MIN, ITER)).toBe(false);
    expect(m.get('b')).toEqual({ x: 10, y: 10 });
  });

  it('is a no-op for an unknown id', () => {
    const m = centers({ a: { x: 0, y: 0 } });
    expect(pushOutOne(m, 'nope', MIN, ITER)).toBe(false);
  });
});

describe('relaxAll', () => {
  it('separates an overlapping pair symmetrically', () => {
    const m = centers({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } });
    expect(relaxAll(m, MIN, ITER)).toBe(true);
    const a = m.get('a')!;
    const b = m.get('b')!;
    expect(dist(a, b)).toBeGreaterThanOrEqual(MIN - 1e-9);
    expect(a.x + b.x).toBeCloseTo(100); // pushed half each way around the same midpoint
  });

  it('resolves a violating cluster within the iteration budget', () => {
    const m = centers({
      a: { x: 0, y: 0 },
      b: { x: 80, y: 0 },
      c: { x: 40, y: 60 },
    });
    relaxAll(m, MIN, 10);
    const list = Array.from(m.values());
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        expect(dist(list[i], list[j])).toBeGreaterThanOrEqual(MIN - 1);
      }
    }
  });

  it('does not move a layout that already satisfies the constraint', () => {
    const m = centers({ a: { x: 0, y: 0 }, b: { x: 260, y: 0 }, c: { x: 130, y: 210 } });
    expect(relaxAll(m, MIN, ITER)).toBe(false);
    expect(m.get('a')).toEqual({ x: 0, y: 0 });
    expect(m.get('b')).toEqual({ x: 260, y: 0 });
    expect(m.get('c')).toEqual({ x: 130, y: 210 });
  });
});
