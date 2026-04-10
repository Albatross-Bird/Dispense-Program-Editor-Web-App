import { describe, it, expect } from 'vitest';
import {
  pointInPolygon,
  polygonArea,
  nearestPointOnEdge,
  translatePolygon,
  polygonBoundingBox,
  generateLineFill,
  generateDotFill,
} from '../lib/polygon';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Unit square: (0,0)→(1,0)→(1,1)→(0,1) */
const UNIT_SQUARE: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];

/** Right-triangle: (0,0)→(4,0)→(0,3) */
const TRIANGLE: [number, number][] = [[0, 0], [4, 0], [0, 3]];

// ── pointInPolygon ─────────────────────────────────────────────────────────────

describe('pointInPolygon', () => {
  it('returns true for interior point in a square', () => {
    expect(pointInPolygon([0.5, 0.5], UNIT_SQUARE)).toBe(true);
  });

  it('returns false for exterior point outside a square', () => {
    expect(pointInPolygon([2, 2], UNIT_SQUARE)).toBe(false);
  });

  it('returns false for point clearly above the square', () => {
    expect(pointInPolygon([0.5, 5], UNIT_SQUARE)).toBe(false);
  });

  it('returns true for interior point in a triangle', () => {
    expect(pointInPolygon([1, 1], TRIANGLE)).toBe(true);
  });

  it('returns false for point outside the triangle', () => {
    expect(pointInPolygon([3, 3], TRIANGLE)).toBe(false);
  });

  it('returns false for degenerate polygon (< 3 vertices)', () => {
    expect(pointInPolygon([0.5, 0.5], [[0, 0], [1, 0]])).toBe(false);
  });

  it('handles a polygon with negative coordinates', () => {
    const poly: [number, number][] = [[-2, -2], [2, -2], [2, 2], [-2, 2]];
    expect(pointInPolygon([0, 0], poly)).toBe(true);
    expect(pointInPolygon([3, 0], poly)).toBe(false);
  });
});

// ── polygonArea ───────────────────────────────────────────────────────────────

describe('polygonArea', () => {
  it('computes area of unit square = 1', () => {
    expect(polygonArea(UNIT_SQUARE)).toBeCloseTo(1, 10);
  });

  it('computes area of 3×4 rectangle = 12', () => {
    const rect: [number, number][] = [[0, 0], [3, 0], [3, 4], [0, 4]];
    expect(polygonArea(rect)).toBeCloseTo(12, 10);
  });

  it('computes area of right triangle (base=4, height=3) = 6', () => {
    expect(polygonArea(TRIANGLE)).toBeCloseTo(6, 10);
  });

  it('is independent of winding order (CCW same as CW)', () => {
    const cw = [...UNIT_SQUARE].reverse() as [number, number][];
    expect(polygonArea(UNIT_SQUARE)).toBeCloseTo(polygonArea(cw), 10);
  });

  it('returns 0 for a degenerate (collinear) polygon', () => {
    const line: [number, number][] = [[0, 0], [1, 0], [2, 0]];
    expect(polygonArea(line)).toBeCloseTo(0, 10);
  });
});

// ── nearestPointOnEdge ────────────────────────────────────────────────────────

describe('nearestPointOnEdge', () => {
  it('returns foot of perpendicular for interior projection', () => {
    const result = nearestPointOnEdge([0.5, 1], [0, 0], [1, 0]);
    expect(result.point[0]).toBeCloseTo(0.5, 6);
    expect(result.point[1]).toBeCloseTo(0, 6);
    expect(result.t).toBeCloseTo(0.5, 6);
    expect(result.distance).toBeCloseTo(1, 6);
  });

  it('clamps to edgeStart when projection is before the segment', () => {
    const result = nearestPointOnEdge([-1, 0], [0, 0], [1, 0]);
    expect(result.point[0]).toBeCloseTo(0, 6);
    expect(result.t).toBeCloseTo(0, 6);
  });

  it('clamps to edgeEnd when projection is after the segment', () => {
    const result = nearestPointOnEdge([2, 0], [0, 0], [1, 0]);
    expect(result.point[0]).toBeCloseTo(1, 6);
    expect(result.t).toBeCloseTo(1, 6);
  });

  it('handles zero-length edge gracefully', () => {
    const result = nearestPointOnEdge([3, 4], [1, 1], [1, 1]);
    expect(result.point).toEqual([1, 1]);
    expect(result.t).toBe(0);
    expect(result.distance).toBeCloseTo(Math.hypot(2, 3), 6);
  });

  it('handles diagonal edge correctly', () => {
    // Edge from (0,0) to (1,1); point (1,0) projects to (0.5,0.5)
    const result = nearestPointOnEdge([1, 0], [0, 0], [1, 1]);
    expect(result.point[0]).toBeCloseTo(0.5, 6);
    expect(result.point[1]).toBeCloseTo(0.5, 6);
    expect(result.t).toBeCloseTo(0.5, 6);
    expect(result.distance).toBeCloseTo(Math.hypot(0.5, 0.5), 6);
  });
});

// ── translatePolygon ──────────────────────────────────────────────────────────

describe('translatePolygon', () => {
  it('shifts all vertices by (dx, dy)', () => {
    const result = translatePolygon(UNIT_SQUARE, 2, 3);
    expect(result).toEqual([[2, 3], [3, 3], [3, 4], [2, 4]]);
  });

  it('returns a new array (does not mutate input)', () => {
    const original: [number, number][] = [[0, 0], [1, 0], [1, 1]];
    const copy = original.map((p): [number, number] => [...p]);
    translatePolygon(original, 5, 5);
    expect(original).toEqual(copy);
  });

  it('handles negative translations', () => {
    const result = translatePolygon([[3, 3], [4, 3], [4, 4], [3, 4]], -3, -3);
    expect(result[0]).toEqual([0, 0]);
  });

  it('translating by (0,0) returns same coordinates', () => {
    const result = translatePolygon(UNIT_SQUARE, 0, 0);
    expect(result).toEqual(UNIT_SQUARE);
  });
});

// ── polygonBoundingBox ────────────────────────────────────────────────────────

describe('polygonBoundingBox', () => {
  it('returns correct bbox for unit square', () => {
    expect(polygonBoundingBox(UNIT_SQUARE)).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
  });

  it('returns correct bbox for triangle with negative coords', () => {
    const tri: [number, number][] = [[-2, 0], [0, 4], [3, -1]];
    const bb = polygonBoundingBox(tri);
    expect(bb.minX).toBe(-2);
    expect(bb.minY).toBe(-1);
    expect(bb.maxX).toBe(3);
    expect(bb.maxY).toBe(4);
  });

  it('handles a single-point polygon', () => {
    const bb = polygonBoundingBox([[5, 7]]);
    expect(bb).toEqual({ minX: 5, minY: 7, maxX: 5, maxY: 7 });
  });

  it('area of bbox >= polygonArea', () => {
    const bb = polygonBoundingBox(TRIANGLE);
    const bbArea = (bb.maxX - bb.minX) * (bb.maxY - bb.minY);
    expect(bbArea).toBeGreaterThanOrEqual(polygonArea(TRIANGLE));
  });
});

// ── generateLineFill ──────────────────────────────────────────────────────────

describe('generateLineFill', () => {
  it('returns empty array for < 3 vertices', () => {
    expect(generateLineFill([[0, 0], [1, 0]], 1, 0)).toHaveLength(0);
  });

  it('returns empty array for non-positive spacing', () => {
    expect(generateLineFill(UNIT_SQUARE, 0, 0)).toHaveLength(0);
    expect(generateLineFill(UNIT_SQUARE, -1, 0)).toHaveLength(0);
  });

  it('fills a 10×10 square with horizontal lines at spacing 1', () => {
    const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const lines = generateLineFill(sq, 1, 0);
    // Expect ~10 lines (y = 0,1,...,9 or 1..10 depending on rounding)
    expect(lines.length).toBeGreaterThanOrEqual(9);
    expect(lines.length).toBeLessThanOrEqual(11);
    // Each line should run horizontally (same y for start and end)
    for (const l of lines) {
      expect(l.start[1]).toBeCloseTo(l.end[1], 5);
    }
  });

  it('all generated line endpoints are inside (or on edge of) the polygon', () => {
    const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const lines = generateLineFill(sq, 2, 0);
    for (const { start, end } of lines) {
      expect(start[0]).toBeGreaterThanOrEqual(-1e-9);
      expect(start[0]).toBeLessThanOrEqual(10 + 1e-9);
      expect(end[0]).toBeGreaterThanOrEqual(-1e-9);
      expect(end[0]).toBeLessThanOrEqual(10 + 1e-9);
    }
  });

  it('produces vertical lines at angleDeg=90', () => {
    const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const lines = generateLineFill(sq, 2, 90);
    expect(lines.length).toBeGreaterThan(0);
    // Each line should be approximately vertical (same x for start and end)
    for (const l of lines) {
      expect(l.start[0]).toBeCloseTo(l.end[0], 3);
    }
  });

  it('returns no lines when spacing exceeds polygon height', () => {
    // Very large spacing means at most 1 scan line may exist
    const sq: [number, number][] = [[0, 0], [2, 0], [2, 2], [0, 2]];
    const lines = generateLineFill(sq, 100, 0);
    expect(lines.length).toBeLessThanOrEqual(1);
  });
});

// ── generateDotFill ───────────────────────────────────────────────────────────

describe('generateDotFill', () => {
  it('returns empty array for < 3 vertices', () => {
    expect(generateDotFill([[0, 0], [1, 0]], 1, 1)).toHaveLength(0);
  });

  it('returns empty array for non-positive spacing', () => {
    expect(generateDotFill(UNIT_SQUARE, 0, 1)).toHaveLength(0);
    expect(generateDotFill(UNIT_SQUARE, 1, 0)).toHaveLength(0);
  });

  it('fills a 10×10 square with dots at spacing 1', () => {
    const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const dots = generateDotFill(sq, 1, 1);
    // All grid points from 0..10 × 0..10 that are inside = many
    expect(dots.length).toBeGreaterThan(50);
  });

  it('all generated dots are inside the polygon', () => {
    const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const dots = generateDotFill(sq, 2, 2);
    for (const { point } of dots) {
      expect(pointInPolygon(point, sq)).toBe(true);
    }
  });

  it('does not generate dots outside a triangle', () => {
    const tri: [number, number][] = [[0, 0], [10, 0], [0, 10]];
    const dots = generateDotFill(tri, 1, 1);
    for (const { point } of dots) {
      expect(pointInPolygon(point, tri)).toBe(true);
    }
  });

  it('returns no dots when spacing exceeds polygon size', () => {
    const sq: [number, number][] = [[0, 0], [2, 0], [2, 2], [0, 2]];
    const dots = generateDotFill(sq, 100, 100);
    expect(dots.length).toBeLessThanOrEqual(1);
  });
});
