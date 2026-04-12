/**
 * Contour fill generation — iterative inset algorithm.
 * Pure functions, no side effects.
 *
 * Uses clipper2-ts (inflatePathsD) to compute successive inset contours.
 * Each layer is offset from the PREVIOUS result so concave topologies
 * are handled correctly (e.g. a U-shape splits into two contours at the
 * right depth).
 *
 * The first contour is always inset by `spacing` from the polygon boundary,
 * so there is uniform spacing between the boundary and the outermost contour
 * as well as between every successive pair of contours.
 */
import { inflatePathsD, JoinType, EndType } from 'clipper2-ts';
import type { PatternCommand, LineCommand, DotCommand } from './types';

// ── Local helpers ──────────────────────────────────────────────────────────────

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── Config ─────────────────────────────────────────────────────────────────────

export interface ContourFillConfig {
  /** World-space polygon vertices defining the fill boundary. */
  polygon: [number, number][];
  /** Distance between successive contour layers, and from boundary to first contour (mm). */
  spacing: number;
  /**
   * "outside" — dispense outermost contour first, spiralling toward centre.
   * "inside"  — dispense innermost contour first, spiralling outward.
   */
  start: 'outside' | 'inside';
  /** "lines" = one Line cmd per edge segment; "dots" = dots along perimeter. */
  fillType: 'dots' | 'lines';
  /** Spacing between dots along each contour (only used when fillType = 'dots'). */
  dotSpacing: number;
  zHeight: number;
  param: number;
  flowRate: number;
  name: string;
}

export interface ContourLayer {
  vertices: [number, number][];
  /** 0 = outermost (first inset from boundary). */
  layerIndex: number;
}

// ── Core: generate contour layers ─────────────────────────────────────────────

/**
 * Returns an array of contour layers, each one inset further than the last.
 * The first layer is inset by `spacing` from the polygon boundary, so the
 * gap between the boundary and the outermost contour equals `spacing` — the
 * same as the gap between every subsequent pair of contours.
 * Stops when clipper2 returns no more paths.
 */
export function generateContourLayers(
  polygon: [number, number][],
  spacing: number,
): ContourLayer[] {
  if (polygon.length < 3 || spacing <= 0) return [];

  const layers: ContourLayer[] = [];

  // Convert to clipper2-ts PathsD: PathsD = Array<Array<{x,y}>>
  let currentPaths: { x: number; y: number }[][] = [
    polygon.map(([x, y]) => ({ x, y })),
  ];

  let layerIdx = 0;

  for (let iter = 0; iter < 1000; iter++) {
    // Inset by -spacing.  precision=4 is adequate for mm-range coordinates.
    const result = inflatePathsD(
      currentPaths,
      -spacing,
      JoinType.Round,
      EndType.Polygon,
      2.0,   // miterLimit
      4,     // precision
      0.1,   // arcTolerance
    );

    if (!result || result.length === 0) break;

    // Filter out degenerate paths (< 3 vertices).
    const valid = result.filter((path) => path.length >= 3);
    if (valid.length === 0) break;

    for (const path of valid) {
      layers.push({
        vertices: path.map((pt) => [pt.x, pt.y] as [number, number]),
        layerIndex: layerIdx,
      });
    }

    currentPaths = valid;
    layerIdx++;
  }

  return layers;
}

// ── Helpers: dot sampling and opening-point optimisation ──────────────────────

/**
 * Walk around the closed polygon and return dots at `spacing` intervals.
 * Starts at the first vertex.
 */
function sampleDotsAlongContour(
  verts: [number, number][],
  spacing: number,
): [number, number][] {
  if (verts.length < 2 || spacing <= 0) return [];

  const result: [number, number][] = [];
  const pts: [number, number][] = [...verts, verts[0]]; // close the loop

  let nextDist = 0; // cumulative distance at which to place the next dot
  let traveled = 0;

  // Always include the start point
  result.push([pts[0][0], pts[0][1]]);
  nextDist = spacing;

  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const segLen = Math.hypot(bx - ax, by - ay);
    if (segLen < 1e-9) continue;

    const segEnd = traveled + segLen;

    while (nextDist < segEnd - 1e-9) {
      const t = (nextDist - traveled) / segLen;
      result.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
      nextDist += spacing;
    }

    traveled = segEnd;
  }

  return result;
}

/**
 * Re-order `verts` so that the vertex closest to `prev` comes first.
 */
function reorderFromNearest(
  verts: [number, number][],
  prev: [number, number],
): [number, number][] {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < verts.length; i++) {
    const d = Math.hypot(verts[i][0] - prev[0], verts[i][1] - prev[1]);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  return [...verts.slice(bestIdx), ...verts.slice(0, bestIdx)];
}

// ── Main export ───────────────────────────────────────────────────────────────

export function generateContourFillCommands(config: ContourFillConfig): PatternCommand[] {
  const layers = generateContourLayers(config.polygon, config.spacing);
  if (layers.length === 0) return [];

  const orderedLayers =
    config.start === 'inside' ? [...layers].reverse() : layers;

  const commands: PatternCommand[] = [];
  let prevLastPt: [number, number] | null = null;

  for (const layer of orderedLayers) {
    let verts = layer.vertices;
    if (verts.length < 2) continue;

    // Rotate so the closest vertex to the previous layer's last point is first.
    if (prevLastPt) {
      verts = reorderFromNearest(verts, prevLastPt);
    }

    if (config.fillType === 'lines') {
      // One Line command per edge of the contour.
      for (let i = 0; i < verts.length; i++) {
        const p1 = verts[i];
        const p2 = verts[(i + 1) % verts.length];
        const cmd: LineCommand = {
          kind: 'Line',
          id: genId(),
          disabled: false,
          valve: config.param,
          startPoint: [p1[0], p1[1], config.zHeight],
          endPoint:   [p2[0], p2[1], config.zHeight],
          flowRate:   { value: config.flowRate, unit: 'mg/mm' },
        };
        commands.push(cmd);
      }
      prevLastPt = verts[verts.length - 1];
    } else {
      // Dot commands sampled along the contour perimeter.
      const dots = sampleDotsAlongContour(verts, config.dotSpacing);
      for (const [dx, dy] of dots) {
        const cmd: DotCommand = {
          kind: 'Dot',
          id: genId(),
          disabled: false,
          valve: config.param,
          point: [dx, dy, config.zHeight],
          valveState: 'ValveOn',
        };
        commands.push(cmd);
      }
      if (dots.length > 0) prevLastPt = dots[dots.length - 1];
    }
  }

  return commands;
}
