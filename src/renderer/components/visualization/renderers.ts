import type { PatternCommand, LineCommand, DotCommand, MarkCommand, LaserCommand } from '@lib/types';
import type { Camera } from './camera';
import { worldToScreen } from './camera';

// ── Color palette ─────────────────────────────────────────────────────────────

export const VALVE_COLORS = [
  '#ef4444', // 1  red
  '#3b82f6', // 2  blue
  '#22c55e', // 3  green
  '#f59e0b', // 4  amber
  '#a855f7', // 5  purple
  '#06b6d4', // 6  cyan
  '#f97316', // 7  orange
  '#ec4899', // 8  pink
  '#84cc16', // 9  lime
  '#14b8a6', // 10 teal
] as const;

export function valveColor(valve: number): string {
  return VALVE_COLORS[(valve - 1) % VALVE_COLORS.length];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function arrowhead(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number,
  x2: number, y2: number,
  size: number,
) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(angle - Math.PI / 6), y2 - size * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - size * Math.cos(angle + Math.PI / 6), y2 - size * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

/** Try to extract (x, y) pairs from any raw string that contains (x,y,z) triplets. */
function parsePointsFromRaw(raw: string): [number, number][] {
  const pts: [number, number][] = [];
  const re = /\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*[-\d.]+\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    pts.push([parseFloat(m[1]), parseFloat(m[2])]);
  }
  return pts;
}

// ── Render config (thickness / dot size per param) ────────────────────────────

export interface RenderConfig {
  /** Line stroke widths in mm, indexed by param-1 (0..9). */
  lineThicknesses: number[];
  /** Dot diameters in mm, indexed by param-1 (0..9). */
  dotSizes: number[];
}

// ── Per-type drawers ──────────────────────────────────────────────────────────

export function drawLine(
  ctx: CanvasRenderingContext2D,
  cmd: LineCommand,
  cam: Camera,
  selected: boolean,
  suppressStartDot = false,
  lineWidthPx?: number,
  suppressStartSquare = false,
) {
  const color = valveColor(cmd.valve);
  const [x1, y1] = worldToScreen(cmd.startPoint[0], cmd.startPoint[1], cam);
  const [x2, y2] = worldToScreen(cmd.endPoint[0], cmd.endPoint[1], cam);

  ctx.save();

  const basePx = lineWidthPx ?? 1.5;

  // Scale arrowhead and start-dot relative to the line width.
  const arrowSize = Math.max(4, basePx * 3.5);
  const dotRadius = Math.max(1.5, basePx * 1.2);

  // Shorten the stroke so it ends at the arrowhead base rather than the tip,
  // preventing the square line cap from showing through the arrow triangle.
  const angle      = Math.atan2(y2 - y1, x2 - x1);
  const arrowDepth = arrowSize * Math.cos(Math.PI / 6); // height of the arrow triangle
  const ex = x2 - arrowDepth * Math.cos(angle);
  const ey = y2 - arrowDepth * Math.sin(angle);

  ctx.strokeStyle = selected ? '#ffffff' : color;
  ctx.lineWidth = basePx;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(ex, ey);
  ctx.stroke();

  // Arrowhead — selected: background fill + white outline so interior appears
  // transparent and the line body is hidden underneath. Unselected: solid fill.
  if (selected) {
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - arrowSize * Math.cos(angle - Math.PI / 6), y2 - arrowSize * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - arrowSize * Math.cos(angle + Math.PI / 6), y2 - arrowSize * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fillStyle = '#374151';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    arrowhead(ctx, x1, y1, x2, y2, arrowSize);
  }

  // Start handle:
  //  - Selected + not a selected junction → square (draggable endpoint)
  //  - Selected + selected junction (both sides selected) → suppress; diamond drawn by drawHandles
  //  - Unselected + not a connected start → dot
  //  - Unselected + connected start → suppress dot
  if (selected && !suppressStartSquare) {
    const half = dotRadius; // side = dotRadius * 2 == unselected circle diameter
    ctx.fillStyle = '#374151'; // matches canvas background fill in renderFrame
    ctx.fillRect(x1 - half, y1 - half, half * 2, half * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x1 - half, y1 - half, half * 2, half * 2);
  } else if (!selected && !suppressStartDot) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x1, y1, dotRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

export function drawDot(
  ctx: CanvasRenderingContext2D,
  cmd: DotCommand,
  cam: Camera,
  selected: boolean,
  dotRadiusPx?: number,
) {
  const color = valveColor(cmd.valve);
  const [sx, sy] = worldToScreen(cmd.point[0], cmd.point[1], cam);
  const r = dotRadiusPx ?? cam.zoom * 1.0;

  ctx.save();

  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  if (selected) {
    // White ring around the outside, keeping the valve color visible in the center
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.restore();
}

export function drawMark(
  ctx: CanvasRenderingContext2D,
  cmd: MarkCommand,
  cam: Camera,
  selected: boolean,
) {
  const pts = parsePointsFromRaw(cmd.raw);
  const color = selected ? '#ffffff' : '#ef4444';
  const size = 7;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  for (const [wx, wy] of pts) {
    const [sx, sy] = worldToScreen(wx, wy, cam);
    ctx.beginPath();
    ctx.moveTo(sx - size, sy); ctx.lineTo(sx + size, sy);
    ctx.moveTo(sx, sy - size); ctx.lineTo(sx, sy + size);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawLaser(
  ctx: CanvasRenderingContext2D,
  cmd: LaserCommand,
  cam: Camera,
  selected: boolean,
) {
  const pts = parsePointsFromRaw(cmd.raw);
  const color = selected ? '#ffffff' : '#a78bfa';
  const s = 7;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  for (const [wx, wy] of pts) {
    const [sx, sy] = worldToScreen(wx, wy, cam);
    ctx.beginPath();
    ctx.moveTo(sx,     sy - s);
    ctx.lineTo(sx + s, sy    );
    ctx.lineTo(sx,     sy + s);
    ctx.lineTo(sx - s, sy    );
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Pre-compute the set of start-point keys where a previous Line ends at the
 * same coordinate. These start dots should be suppressed.
 *
 * Non-Line, non-Group commands (Dots, Marks, Comments, Raw, Laser) are
 * skipped without breaking the chain. This matches the behaviour of
 * computeSelectedJunctionStarts and means a Dot or Mark placed between two
 * coordinate-connected Lines does not cause the second Line's start dot to
 * reappear. Only a Line whose startPoint doesn't match the previous Line's
 * endPoint resets the chain.
 */
export function computeConnectedStarts(commands: PatternCommand[]): Set<string> {
  const connected = new Set<string>();

  function ptKey(p: readonly [number, number, number] | number[]): string {
    return `${(p[0] as number).toFixed(3)},${(p[1] as number).toFixed(3)},${(p[2] as number).toFixed(3)}`;
  }

  function visit(cmds: PatternCommand[], prevEndKey: string | null): string | null {
    for (const cmd of cmds) {
      if (cmd.kind === 'Line') {
        const sk = ptKey(cmd.startPoint);
        if (prevEndKey !== null && prevEndKey === sk) connected.add(sk);
        prevEndKey = ptKey(cmd.endPoint);
      } else if (cmd.kind === 'Group') {
        prevEndKey = visit(cmd.commands, prevEndKey);
      }
      // All other kinds (Dot, Mark, Laser, Comment, Raw) are ignored —
      // they do not reset prevEndKey so they cannot break a connected chain.
    }
    return prevEndKey;
  }

  visit(commands, null);
  return connected;
}

/**
 * Pre-compute start-point keys that are "selected junctions": the preceding
 * selected Line ends at exactly this coordinate, so the junction diamond is
 * shown by drawHandles instead of the start square.
 *
 * Mirrors the `startIsJunction` logic in computeHandles (handles.ts) by
 * flattening selected Lines in depth-first document order and checking
 * consecutive connected pairs — the two systems must always agree.
 */
export function computeSelectedJunctionStarts(
  commands: PatternCommand[],
  selectedIds: Set<string>,
): Set<string> {
  const junctions = new Set<string>();

  function ptKey(p: readonly [number, number, number] | number[]): string {
    return `${(p[0] as number).toFixed(3)},${(p[1] as number).toFixed(3)},${(p[2] as number).toFixed(3)}`;
  }

  const selectedLines: LineCommand[] = [];
  function flatten(cmds: PatternCommand[]): void {
    for (const cmd of cmds) {
      if (cmd.kind === 'Group') flatten(cmd.commands);
      else if (cmd.kind === 'Line' && cmd.id && selectedIds.has(cmd.id))
        selectedLines.push(cmd);
    }
  }
  flatten(commands);

  for (let i = 1; i < selectedLines.length; i++) {
    const prev = selectedLines[i - 1];
    const curr = selectedLines[i];
    if (ptKey(prev.endPoint as [number, number, number]) ===
        ptKey(curr.startPoint as [number, number, number])) {
      junctions.add(ptKey(curr.startPoint as [number, number, number]));
    }
  }

  return junctions;
}

/**
 * Dispatch draw for any command type.
 * `selectedIds` is the set of selected command IDs (pre-expanded for groups).
 * `hiddenValves` is the set of valve numbers whose Line/Dot commands should be skipped.
 * `connectedStarts` is the pre-computed set of start-point keys with suppressed dots.
 * `selectedJunctionStarts` is the set of start-point keys where both the preceding
 *   and this selected Line connect — suppresses the start square in favour of the diamond.
 * Comment and Raw produce no canvas output.
 */
export function drawCommand(
  ctx: CanvasRenderingContext2D,
  cmd: PatternCommand,
  cam: Camera,
  selectedIds: Set<string>,
  hiddenValves: Set<number> = new Set(),
  connectedStarts: Set<string> = new Set(),
  renderConfig?: RenderConfig,
  selectedJunctionStarts: Set<string> = new Set(),
) {
  const isSelected = Boolean(cmd.id && selectedIds.has(cmd.id));

  switch (cmd.kind) {
    case 'Line': {
      if (!hiddenValves.has(cmd.valve)) {
        const sk = `${cmd.startPoint[0].toFixed(3)},${cmd.startPoint[1].toFixed(3)},${cmd.startPoint[2].toFixed(3)}`;
        const thickMm = renderConfig?.lineThicknesses[cmd.valve - 1] ?? 0.5;
        drawLine(ctx, cmd, cam, isSelected, connectedStarts.has(sk), thickMm * cam.zoom, selectedJunctionStarts.has(sk));
      }
      break;
    }
    case 'Dot': {
      if (!hiddenValves.has(cmd.valve)) {
        const diamMm = renderConfig?.dotSizes[cmd.valve - 1] ?? 1.0;
        drawDot(ctx, cmd, cam, isSelected, (diamMm / 2) * cam.zoom);
      }
      break;
    }
    case 'Mark':  drawMark(ctx, cmd, cam, isSelected);  break;
    case 'Laser': drawLaser(ctx, cmd, cam, isSelected); break;
    case 'Group':
      for (const child of cmd.commands) drawCommand(ctx, child, cam, selectedIds, hiddenValves, connectedStarts, renderConfig, selectedJunctionStarts);
      break;
    case 'Comment':
    case 'Raw':
      break;
  }
}

// ── Hit testing ───────────────────────────────────────────────────────────────

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Return the index of the closest hittable command within threshold pixels, or null. */
export function hitTest(
  sx: number, sy: number,
  commands: PatternCommand[],
  cam: Camera,
  threshold = 8,
): number | null {
  let bestIdx: number | null = null;
  let bestDist = threshold;

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    let dist = Infinity;

    if (cmd.kind === 'Line') {
      const [ax, ay] = worldToScreen(cmd.startPoint[0], cmd.startPoint[1], cam);
      const [bx, by] = worldToScreen(cmd.endPoint[0], cmd.endPoint[1], cam);
      dist = distToSegment(sx, sy, ax, ay, bx, by);
    } else if (cmd.kind === 'Dot') {
      const [px, py] = worldToScreen(cmd.point[0], cmd.point[1], cam);
      dist = Math.hypot(sx - px, sy - py);
    } else if (cmd.kind === 'Group') {
      // A hit on any child selects the group as a whole
      if (hitTest(sx, sy, cmd.commands, cam, threshold) !== null) dist = 0;
    }

    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  return bestIdx;
}

/**
 * Extract one fiducial per coordinate found in Mark commands.
 * A single Mark line can contain 1 or 2 (x,y,z) triplets (e.g.
 * "Mark:1,(338.551,356.371,46.036)-(181.806,356.551,46.036)Two"), so each
 * triplet becomes its own fiducial entry. Z is dropped.
 */
export function extractMarkFiducials(
  commands: PatternCommand[],
): { label: string; coord: [number, number] }[] {
  const result: { label: string; coord: [number, number] }[] = [];
  for (const cmd of commands) {
    if (cmd.kind === 'Mark') {
      const pts = parsePointsFromRaw(cmd.raw);
      for (const pt of pts) {
        result.push({ label: `Mark ${result.length + 1}`, coord: pt });
      }
    } else if (cmd.kind === 'Group') {
      result.push(...extractMarkFiducials(cmd.commands));
    }
  }
  return result;
}

/** Collect all drawable 2-D world points from a command list (for fit-to-view). */
export function collectPoints(commands: PatternCommand[]): [number, number][] {
  const pts: [number, number][] = [];
  for (const cmd of commands) {
    if (cmd.kind === 'Line') {
      pts.push(
        [cmd.startPoint[0], cmd.startPoint[1]],
        [cmd.endPoint[0], cmd.endPoint[1]],
      );
    } else if (cmd.kind === 'Dot') {
      pts.push([cmd.point[0], cmd.point[1]]);
    } else if (cmd.kind === 'Group') {
      pts.push(...collectPoints(cmd.commands));
    }
  }
  return pts;
}
