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

// ── Per-type drawers ──────────────────────────────────────────────────────────

export function drawLine(
  ctx: CanvasRenderingContext2D,
  cmd: LineCommand,
  cam: Camera,
  selected: boolean,
) {
  const color = valveColor(cmd.valve);
  const [x1, y1] = worldToScreen(cmd.startPoint[0], cmd.startPoint[1], cam);
  const [x2, y2] = worldToScreen(cmd.endPoint[0], cmd.endPoint[1], cam);

  ctx.save();

  ctx.strokeStyle = selected ? '#ffffff' : color;
  ctx.lineWidth = selected ? 3 : 1.5;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.fillStyle = selected ? '#ffffff' : color;
  const arrowSize = Math.max(5, Math.min(10, cam.zoom * 1.5));
  arrowhead(ctx, x1, y1, x2, y2, arrowSize);

  // Start dot
  ctx.beginPath();
  ctx.arc(x1, y1, 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

export function drawDot(
  ctx: CanvasRenderingContext2D,
  cmd: DotCommand,
  cam: Camera,
  selected: boolean,
) {
  const color = valveColor(cmd.valve);
  const [sx, sy] = worldToScreen(cmd.point[0], cmd.point[1], cam);
  // World-space radius of 1 unit — scales with zoom exactly like line geometry.
  const r = cam.zoom * 1.0;

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
 * Dispatch draw for any command type.
 * `selectedIds` is the set of selected command IDs (pre-expanded for groups).
 * `hiddenValves` is the set of valve numbers whose Line/Dot commands should be skipped.
 * Comment and Raw produce no canvas output.
 */
export function drawCommand(
  ctx: CanvasRenderingContext2D,
  cmd: PatternCommand,
  cam: Camera,
  selectedIds: Set<string>,
  hiddenValves: Set<number> = new Set(),
) {
  const isSelected = Boolean(cmd.id && selectedIds.has(cmd.id));

  switch (cmd.kind) {
    case 'Line':
      if (!hiddenValves.has(cmd.valve)) drawLine(ctx, cmd, cam, isSelected);
      break;
    case 'Dot':
      if (!hiddenValves.has(cmd.valve)) drawDot(ctx, cmd, cam, isSelected);
      break;
    case 'Mark':  drawMark(ctx, cmd, cam, isSelected);  break;
    case 'Laser': drawLaser(ctx, cmd, cam, isSelected); break;
    case 'Group':
      for (const child of cmd.commands) drawCommand(ctx, child, cam, selectedIds, hiddenValves);
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
