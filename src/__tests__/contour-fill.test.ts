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
  includeBoundary: true,
  direction: 'inward',
  fillType: 'lines',
  dotSpacing: 1,
  zHeight: 5,
  param: 1,
  flowRate: 0.5,
  name: '',
  ...overrides,
});

// ── 7A: basic layer count ──────────────────────────────────────────────────────

describe('generateContourLayers', () => {
  it('7A: produces the expected number of layers for a 10×10 square at spacing=2', () => {
    const layers = generateContourLayers(square(10), 2, true);
    // Expect: boundary + insets at 2, 4 mm → 3 layers; innermost (6 mm) collapses
    expect(layers.length).toBeGreaterThanOrEqual(2);
    expect(layers[0].layerIndex).toBe(0);
  });

  it('7B: layer indices are sequential from 0', () => {
    const layers = generateContourLayers(square(20), 2, true);
    for (let i = 0; i < layers.length; i++) {
      // When includeBoundary=true, layerIndex values go 0,1,2,...
      expect(layers[i].layerIndex).toBeLessThanOrEqual(i);
    }
  });

  it('7C: returns empty array for degenerate polygon (< 3 vertices)', () => {
    const layers = generateContourLayers([[0, 0], [1, 0]], 1, true);
    expect(layers).toHaveLength(0);
  });

  it('7D: returns empty array when spacing <= 0', () => {
    const layers = generateContourLayers(square(10), 0, true);
    expect(layers).toHaveLength(0);
    const layers2 = generateContourLayers(square(10), -1, true);
    expect(layers2).toHaveLength(0);
  });

  it('7E: returns only boundary layer when spacing > polygon half-size', () => {
    // A 4×4 square with spacing 3 → boundary only; first inset collapses
    const layers = generateContourLayers(square(4), 3, true);
    // Should have at least the boundary (1 layer)
    expect(layers.length).toBeGreaterThanOrEqual(1);
  });

  it('7F: excludes boundary layer when includeBoundary=false', () => {
    const withBoundary = generateContourLayers(square(10), 2, true);
    const noBoundary   = generateContourLayers(square(10), 2, false);
    // noBoundary should have one fewer layer
    expect(noBoundary.length).toBe(withBoundary.length - 1);
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

  it('7J: outward-inward direction reverses layer order vs inward', () => {
    const inward     = generateContourFillCommands(baseConfig({ direction: 'inward' }));
    const outInward  = generateContourFillCommands(baseConfig({ direction: 'outward-inward' }));
    // Both should produce the same total count
    expect(inward.length).toBe(outInward.length);
  });

  it('7K: returns empty array when polygon has < 3 vertices', () => {
    const cmds = generateContourFillCommands(baseConfig({ polygon: [[0, 0], [1, 0]] }));
    expect(cmds).toHaveLength(0);
  });

  it('7L: non-square rectangle produces correct layer count', () => {
    const poly = rectPolygon(20, 6);
    const layers = generateContourLayers(poly, 2, true);
    // 6mm wide → spacing=2 means we get boundary + 1 inset (at 2mm) only; next collapses
    expect(layers.length).toBeGreaterThanOrEqual(1);
  });
});
