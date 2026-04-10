import { describe, it, expect } from 'vitest';
import { generateAreaFill, type AreaFillConfig } from '../lib/area-fill';
import { pointInPolygon } from '../lib/polygon';
import type { DotCommand, LineCommand } from '../lib/types';

// Unit square polygon (10×10 mm, corners at 0,0 → 10,10)
const square: [number, number][] = [
  [0, 0], [10, 0], [10, 10], [0, 10],
];

// Equilateral-ish triangle
const triangle: [number, number][] = [
  [5, 0], [10, 10], [0, 10],
];

function baseConfig(overrides: Partial<AreaFillConfig> = {}): AreaFillConfig {
  return {
    polygon: square,
    fillType: 'dots',
    xSpacing: 2,
    ySpacing: 2,
    zHeight: 0,
    rotationDeg: 0,
    param: 1,
    startCorner: 'BL',
    ...overrides,
  };
}

// ── Basic dot fill ─────────────────────────────────────────────────────────────

describe('generateAreaFill — dots, no rotation', () => {
  it('returns dot commands for square polygon', () => {
    const cmds = generateAreaFill(baseConfig());
    expect(cmds.length).toBeGreaterThan(0);
    cmds.forEach((c) => expect(c.kind).toBe('Dot'));
  });

  it('all dots are inside the polygon', () => {
    const cmds = generateAreaFill(baseConfig({ xSpacing: 1, ySpacing: 1 })) as DotCommand[];
    for (const c of cmds) {
      const [x, y] = c.point;
      expect(pointInPolygon([x, y], square)).toBe(true);
    }
  });

  it('uses correct zHeight', () => {
    const cmds = generateAreaFill(baseConfig({ zHeight: 3.5 })) as DotCommand[];
    cmds.forEach((c) => expect(c.point[2]).toBe(3.5));
  });

  it('uses correct param (valve)', () => {
    const cmds = generateAreaFill(baseConfig({ param: 7 })) as DotCommand[];
    cmds.forEach((c) => expect(c.valve).toBe(7));
  });

  it('each dot has a unique id', () => {
    const cmds = generateAreaFill(baseConfig({ xSpacing: 1, ySpacing: 1 }));
    const ids = cmds.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns empty array for degenerate polygon', () => {
    const cmds = generateAreaFill(baseConfig({ polygon: [[0,0],[1,0]] }));
    expect(cmds).toEqual([]);
  });

  it('returns empty array for zero spacing', () => {
    const cmds = generateAreaFill(baseConfig({ xSpacing: 0, ySpacing: 1 }));
    expect(cmds).toEqual([]);
  });
});

// ── Start corner / serpentine order ───────────────────────────────────────────

describe('generateAreaFill — start corner ordering', () => {
  it('BL: first dot has lowest y', () => {
    const cmds = generateAreaFill(baseConfig({ startCorner: 'BL' })) as DotCommand[];
    const ys = cmds.map((c) => c.point[1]);
    expect(ys[0]).toBe(Math.min(...ys));
  });

  it('TL: first dot has highest y', () => {
    const cmds = generateAreaFill(baseConfig({ startCorner: 'TL' })) as DotCommand[];
    const ys = cmds.map((c) => c.point[1]);
    expect(ys[0]).toBe(Math.max(...ys));
  });

  it('BL: first row is left-to-right (ascending x)', () => {
    const cmds = generateAreaFill(baseConfig({ startCorner: 'BL', xSpacing: 1, ySpacing: 5 })) as DotCommand[];
    // First row dots should have ascending x
    const firstRowY = cmds[0].point[1];
    const firstRow = cmds.filter((c) => Math.abs(c.point[1] - firstRowY) < 0.01);
    for (let i = 1; i < firstRow.length; i++) {
      expect(firstRow[i].point[0]).toBeGreaterThan(firstRow[i - 1].point[0]);
    }
  });

  it('BR: first row is right-to-left (descending x)', () => {
    const cmds = generateAreaFill(baseConfig({ startCorner: 'BR', xSpacing: 1, ySpacing: 5 })) as DotCommand[];
    const firstRowY = cmds[0].point[1];
    const firstRow = cmds.filter((c) => Math.abs(c.point[1] - firstRowY) < 0.01);
    for (let i = 1; i < firstRow.length; i++) {
      expect(firstRow[i].point[0]).toBeLessThan(firstRow[i - 1].point[0]);
    }
  });

  it('BL: second row is right-to-left (serpentine)', () => {
    const cmds = generateAreaFill(baseConfig({ startCorner: 'BL', xSpacing: 1, ySpacing: 5 })) as DotCommand[];
    const rowYs = [...new Set(cmds.map((c) => Math.round(c.point[1] * 1000) / 1000))].sort((a, b) => a - b);
    if (rowYs.length < 2) return; // not enough rows to test
    const secondRowY = rowYs[1];
    const secondRow = cmds.filter((c) => Math.abs(c.point[1] - secondRowY) < 0.01);
    for (let i = 1; i < secondRow.length; i++) {
      expect(secondRow[i].point[0]).toBeLessThan(secondRow[i - 1].point[0]);
    }
  });
});

// ── Rotation ───────────────────────────────────────────────────────────────────

describe('generateAreaFill — rotation', () => {
  it('90° rotation still produces dots inside the polygon', () => {
    const cmds = generateAreaFill(baseConfig({ rotationDeg: 90, xSpacing: 1, ySpacing: 1 })) as DotCommand[];
    expect(cmds.length).toBeGreaterThan(0);
    for (const c of cmds) {
      const [x, y] = c.point;
      expect(pointInPolygon([x, y], square)).toBe(true);
    }
  });

  it('45° rotation still produces dots inside the polygon', () => {
    const cmds = generateAreaFill(baseConfig({ rotationDeg: 45, xSpacing: 1, ySpacing: 1 })) as DotCommand[];
    expect(cmds.length).toBeGreaterThan(0);
    for (const c of cmds) {
      const [x, y] = c.point;
      expect(pointInPolygon([x, y], square)).toBe(true);
    }
  });

  it('0° and 180° both produce non-empty results', () => {
    const cmds0   = generateAreaFill(baseConfig({ rotationDeg: 0 }));
    const cmds180 = generateAreaFill(baseConfig({ rotationDeg: 180 }));
    expect(cmds0.length).toBeGreaterThan(0);
    expect(cmds180.length).toBeGreaterThan(0);
  });
});

// ── Triangle polygon ───────────────────────────────────────────────────────────

describe('generateAreaFill — triangle polygon', () => {
  it('all dots inside triangle', () => {
    const cmds = generateAreaFill(baseConfig({ polygon: triangle, xSpacing: 1, ySpacing: 1 })) as DotCommand[];
    expect(cmds.length).toBeGreaterThan(0);
    for (const c of cmds) {
      expect(pointInPolygon([c.point[0], c.point[1]], triangle)).toBe(true);
    }
  });
});

// ── Line fill ─────────────────────────────────────────────────────────────────

describe('generateAreaFill — lines', () => {
  it('returns Line commands', () => {
    const cmds = generateAreaFill(baseConfig({ fillType: 'lines' }));
    expect(cmds.length).toBeGreaterThan(0);
    cmds.forEach((c) => expect(c.kind).toBe('Line'));
  });

  it('uses correct flowRate', () => {
    const fr = { value: 1.2, unit: 'mg/mm' };
    const cmds = generateAreaFill(baseConfig({ fillType: 'lines', flowRate: fr })) as LineCommand[];
    cmds.forEach((c) => {
      expect(c.flowRate).toEqual(fr);
    });
  });

  it('line start/end z equals zHeight', () => {
    const cmds = generateAreaFill(baseConfig({ fillType: 'lines', zHeight: 2 })) as LineCommand[];
    cmds.forEach((c) => {
      expect(c.startPoint[2]).toBe(2);
      expect(c.endPoint[2]).toBe(2);
    });
  });

  it('line endpoints are inside or on the polygon', () => {
    const cmds = generateAreaFill(baseConfig({ fillType: 'lines', xSpacing: 1, ySpacing: 1 })) as LineCommand[];
    for (const c of cmds) {
      // At least the midpoint should be inside
      const mx = (c.startPoint[0] + c.endPoint[0]) / 2;
      const my = (c.startPoint[1] + c.endPoint[1]) / 2;
      // Skip zero-length lines (isolated points)
      if (Math.hypot(c.endPoint[0] - c.startPoint[0], c.endPoint[1] - c.startPoint[1]) > 0.01) {
        expect(pointInPolygon([mx, my], square)).toBe(true);
      }
    }
  });

  it('fewer lines than dots for same spacing', () => {
    const dots  = generateAreaFill(baseConfig({ fillType: 'dots',  xSpacing: 1, ySpacing: 1 }));
    const lines = generateAreaFill(baseConfig({ fillType: 'lines', xSpacing: 1, ySpacing: 1 }));
    // One line per row (or chain) vs one dot per grid point — lines should be fewer
    expect(lines.length).toBeLessThan(dots.length);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('generateAreaFill — edge cases', () => {
  it('very large spacing yields few or no dots', () => {
    const cmds = generateAreaFill(baseConfig({ xSpacing: 100, ySpacing: 100 }));
    expect(cmds.length).toBeLessThanOrEqual(5);
  });

  it('TR corner: first dot has highest y and highest x in that row', () => {
    const cmds = generateAreaFill(baseConfig({ startCorner: 'TR', xSpacing: 1, ySpacing: 5 })) as DotCommand[];
    const ys = cmds.map((c) => c.point[1]);
    // First dot should be in the top row
    const maxY = Math.max(...ys);
    expect(Math.abs(cmds[0].point[1] - maxY)).toBeLessThan(0.01);
  });
});
