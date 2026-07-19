import { describe, expect, it } from 'vitest';
import { arrowhead } from './geometry';

describe('arrowhead', () => {
  it('points right for a rightward flow (left→right layout)', () => {
    const { base, left, right } = arrowhead({ x: 100, y: 50 }, { x: 5, y: 0 }, 10);
    // Base is pulled back along −dir by `size`; tip stays at (100, 50).
    expect(base).toEqual({ x: 90, y: 50 });
    // Wings are perpendicular to the flow, half a size to each side.
    expect(left).toEqual({ x: 90, y: 55 });
    expect(right).toEqual({ x: 90, y: 45 });
  });

  it('normalizes a non-unit direction vector', () => {
    // dir (3,4) has length 5; unit (0.6, 0.8), so base = tip − unit*size.
    const { base } = arrowhead({ x: 0, y: 0 }, { x: 3, y: 4 }, 10);
    expect(base.x).toBeCloseTo(-6);
    expect(base.y).toBeCloseTo(-8);
  });

  it('is robust to a zero-length direction', () => {
    const { base } = arrowhead({ x: 10, y: 10 }, { x: 0, y: 0 }, 10);
    expect(Number.isFinite(base.x)).toBe(true);
    expect(Number.isFinite(base.y)).toBe(true);
  });
});
