/**
 * Area fill generation — serpentine grid algorithm.
 * Pure functions, no side effects.
 */
import { pointInPolygon } from './polygon';
import type { PatternCommand, LineCommand, DotCommand } from './types';

// ── Local helpers ──────────────────────────────────────────────────────────────

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function computeCentroid(vertices: [number, number][]): [number, number] {
  const n = vertices.length;
  let sx = 0, sy = 0;
  for (const [x, y] of vertices) { sx += x; sy += y; }
  return [sx / n, sy / n];
}

function rotatePoint(
  pt: [number, number],
  center: [number, number],
  angleRad: number,
): [number, number] {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const dx = pt[0] - center[0];
  const dy = pt[1] - center[1];
  return [
    center[0] + dx * cos - dy * sin,
    center[1] + dx * sin + dy * cos,
  ];
}

// ── Config ─────────────────────────────────────────────────────────────────────

export interface AreaFillConfig {
  polygon: [number, number][];
  fillType: 'dots' | 'lines';
  xSpacing: number;
  ySpacing: number;
  zHeight: number;
  rotationDeg: number;
  param: number;           // 1-10
  startCorner: 'TL' | 'TR' | 'BL' | 'BR';
  flowRate?: { value: number; unit: string };
}

// ── Main export ────────────────────────────────────────────────────────────────

export function generateAreaFill(config: AreaFillConfig): PatternCommand[] {
  const {
    polygon,
    fillType,
    xSpacing,
    ySpacing,
    zHeight,
    rotationDeg,
    param,
    startCorner,
    flowRate = { value: 0.5, unit: 'mg/mm' },
  } = config;

  if (polygon.length < 3) return [];
  if (xSpacing <= 0 || ySpacing <= 0) return [];

  const angleRad = (rotationDeg * Math.PI) / 180;
  const centroid = computeCentroid(polygon);

  // Rotate polygon vertices into grid-aligned space (rotate by -θ)
  const rotatedPoly = polygon.map((v) => rotatePoint(v, centroid, -angleRad));

  // Bounding box of rotated polygon
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of rotatedPoly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // Generate grid row y-values
  const yValues: number[] = [];
  for (let y = minY; y <= maxY + 1e-9; y += ySpacing) {
    yValues.push(y);
  }

  // Order rows by start corner (BL/BR = ascending y = bottom first; TL/TR = descending y = top first)
  const bottomFirst = startCorner === 'BL' || startCorner === 'BR';
  if (!bottomFirst) yValues.reverse();

  // Serpentine x direction: BL/TL → row0 L→R; BR/TR → row0 R→L; alternates each row
  const row0LeftToRight = startCorner === 'BL' || startCorner === 'TL';

  const commands: PatternCommand[] = [];

  yValues.forEach((gy, rowIdx) => {
    const leftToRight = row0LeftToRight ? rowIdx % 2 === 0 : rowIdx % 2 === 1;

    // Generate x-values for this row
    const xValues: number[] = [];
    for (let x = minX; x <= maxX + 1e-9; x += xSpacing) {
      xValues.push(x);
    }
    if (!leftToRight) xValues.reverse();

    // Filter points by point-in-polygon (test against original polygon,
    // after rotating the grid point back to world space)
    const rowPoints: [number, number][] = [];
    for (const gx of xValues) {
      const worldPt = rotatePoint([gx, gy], centroid, angleRad);
      if (pointInPolygon(worldPt, polygon)) {
        rowPoints.push(worldPt);
      }
    }

    if (rowPoints.length === 0) return;

    if (fillType === 'dots') {
      for (const [wx, wy] of rowPoints) {
        const cmd: DotCommand = {
          kind: 'Dot',
          id: genId(),
          disabled: false,
          valve: param,
          point: [wx, wy, zHeight],
          valveState: 'ValveOn',
        };
        commands.push(cmd);
      }
    } else {
      // Lines: build connected chains of consecutive surviving points
      // A chain is a maximal run of consecutive (in the x-sweep order) points.
      // Since we already filtered and ordered rowPoints, consecutive entries
      // that came from consecutive x-grid positions form chains.
      // We detect breaks by checking if two adjacent world-points are
      // separated by more than √2 × max(xSpacing,ySpacing).
      const chainBreakDist = Math.sqrt(2) * xSpacing * 1.5;

      let chainStart = 0;
      for (let i = 1; i <= rowPoints.length; i++) {
        const isLast = i === rowPoints.length;
        const isBreak = !isLast && (() => {
          const [ax, ay] = rowPoints[i - 1];
          const [bx, by] = rowPoints[i];
          return Math.hypot(bx - ax, by - ay) > chainBreakDist;
        })();

        if (isLast || isBreak) {
          const chain = rowPoints.slice(chainStart, i);
          if (chain.length >= 2) {
            const cmd: LineCommand = {
              kind: 'Line',
              id: genId(),
              disabled: false,
              valve: param,
              startPoint: [chain[0][0], chain[0][1], zHeight],
              endPoint:   [chain[chain.length - 1][0], chain[chain.length - 1][1], zHeight],
              flowRate,
            };
            commands.push(cmd);
          } else if (chain.length === 1) {
            // Single isolated point — emit as a zero-length line (start == end)
            const cmd: LineCommand = {
              kind: 'Line',
              id: genId(),
              disabled: false,
              valve: param,
              startPoint: [chain[0][0], chain[0][1], zHeight],
              endPoint:   [chain[0][0], chain[0][1], zHeight],
              flowRate,
            };
            commands.push(cmd);
          }
          chainStart = i;
        }
      }
    }
  });

  return commands;
}
