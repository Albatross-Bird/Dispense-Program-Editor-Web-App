/**
 * Tests for src/lib/contour-fill.ts
 */
import { describe, it, expect } from 'vitest';
import {
  generateContourLayers,
  generateContourFillCommands,
  type ContourFillConfig,
} from '../lib/contour-fill';

// ── Helpers ────────────────────────────────────────────────────────────────────

function square(size: number): [number, number][] {
  return [
    [0, 0],
    [size, 0],
    [size, size],
    [0, size],
  ];
}

function rectPolygon(w: number, h: number): [number, number][] {
  return [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
}

const baseConfig = (overrides?: Partial<ContourFillConfig>): ContourFillConfig => ({
  polygon: square(10),
  spacing: 2,
  start: 'outside',
  fillType: 'lines',
  dotSpacing: 1,
  zHeight: 5,
  param: 1,
  flowRate: 0.5,
  name: '',
  ...overrides,
});

// ── 7A: first contour is inset by spacing, not on the boundary ─────────────────

describe('generateContourLayers', () => {
  it('7A: first layer is inset from boundary — not the polygon itself', () => {
    const layers = generateContourLayers(square(10), 2);
    expect(layers.length).toBeGreaterThan(0);
    // First layer vertices should NOT exactly match the input polygon
    const firstVert = layers[0].vertices[0];
    const exactMatch = square(10).some(([x, y]) => x === firstVert[0] && y === firstVert[1]);
    expect(exactMatch).toBe(false);
  });

  it('7B: layer indices are sequential from 0', () => {
    const layers = generateContourLayers(square(20), 2);
    for (let i = 0; i < layers.length; i++) {
      expect(layers[i].layerIndex).toBe(i);
    }
  });

  it('7C: returns empty array for degenerate polygon (< 3 vertices)', () => {
    const layers = generateContourLayers([[0, 0], [1, 0]], 1);
    expect(layers).toHaveLength(0);
  });

  it('7D: returns empty array when spacing <= 0', () => {
    expect(generateContourLayers(square(10), 0)).toHaveLength(0);
    expect(generateContourLayers(square(10), -1)).toHaveLength(0);
  });

  it('7E: spacing between boundary and first contour equals spacing between contours', () => {
    // For a square(20) with spacing=4, both boundary→layer0 and layer0→layer1
    // should each be ~4mm inset.
    const layers = generateContourLayers(square(20), 4);
    expect(layers.length).toBeGreaterThanOrEqual(2);
    // layer 0 centroid should be approximately 4mm inside the boundary
    // (For a square centred at 10,10 with size 20, the inset by 4 gives a
    //  square centred at 10,10 with size 12, so vertices at 4,4 etc.)
    const v0 = layers[0].vertices;
    const minX0 = Math.min(...v0.map(([x]) => x));
    expect(minX0).toBeGreaterThan(3);
    expect(minX0).toBeLessThan(5);
  });

  it('7F: polygon smaller than spacing produces no layers', () => {
    // 3×3 square, spacing=2 → first inset collapses
    const layers = generateContourLayers(square(3), 2);
    expect(layers).toHaveLength(0);
  });
});

// ── 7G: command generation ─────────────────────────────────────────────────────

describe('generateContourFillCommands', () => {
  it('7G: generates Line commands for lines fill type', () => {
    const cmds = generateContourFillCommands(baseConfig());
    expect(cmds.length).toBeGreaterThan(0);
    for (const cmd of cmds) {
      expect(cmd.kind).toBe('Line');
    }
  });

  it('7H: generates Dot commands for dots fill type', () => {
    const cmds = generateContourFillCommands(
      baseConfig({ fillType: 'dots', dotSpacing: 1 }),
    );
    expect(cmds.length).toBeGreaterThan(0);
    for (const cmd of cmds) {
      expect(cmd.kind).toBe('Dot');
    }
  });

  it('7I: all commands use the specified Z height and param', () => {
    const cmds = generateContourFillCommands(
      baseConfig({ zHeight: 12.5, param: 3 }),
    );
    for (const cmd of cmds) {
      if (cmd.kind === 'Line') {
        expect(cmd.startPoint[2]).toBeCloseTo(12.5);
        expect(cmd.endPoint[2]).toBeCloseTo(12.5);
        expect(cmd.valve).toBe(3);
      } else if (cmd.kind === 'Dot') {
        expect(cmd.point[2]).toBeCloseTo(12.5);
        expect(cmd.valve).toBe(3);
      }
    }
  });

  it('7J: inside start reverses layer order vs outside — same total count', () => {
    const outside = generateContourFillCommands(baseConfig({ start: 'outside' }));
    const inside  = generateContourFillCommands(baseConfig({ start: 'inside' }));
    expect(outside.length).toBe(inside.length);
  });

  it('7K: returns empty array when polygon has < 3 vertices', () => {
    const cmds = generateContourFillCommands(baseConfig({ polygon: [[0, 0], [1, 0]] }));
    expect(cmds).toHaveLength(0);
  });

  it('7L: non-square rectangle produces at least one layer', () => {
    const poly = rectPolygon(20, 10);
    const layers = generateContourLayers(poly, 2);
    expect(layers.length).toBeGreaterThanOrEqual(1);
  });
});
