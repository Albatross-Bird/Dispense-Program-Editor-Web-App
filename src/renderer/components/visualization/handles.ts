/**
 * Draggable handle system for the canvas editor.
 *
 * Handles appear on selected Line/LineFix and Dot commands. Where two
 * consecutive selected Lines share a common junction point, a single shared
 * (junction) handle is shown instead of two overlapping handles.
 *
 * All functions are pure — no React, no store access.
 */

import type { PatternCommand, LineCommand, DotCommand } from '@lib/types';
import type { Camera } from './camera';
import { worldToScreen } from './camera';

// ── Types ─────────────────────────────────────────────────────────────────────

export type HandleRole = 'line-start' | 'line-end' | 'dot' | 'junction';

export interface HandleTarget {
  cmdId: string;
  /** Which coordinate field this target controls. */
  field: 'startPoint' | 'endPoint' | 'point';
}

export interface Handle {
  wx: number;
  wy: number;
  wz: number;
  role: HandleRole;
  targets: HandleTarget[];
  /** World-space angle (radians) of the line direction. Only set for 'line-end'. */
  angle?: number;
  /** Screen-space hit radius in px. When set, hitTestHandle uses this instead of the
   *  global threshold so handles with larger visuals remain fully clickable at any zoom. */
  hitRadiusPx?: number;
}

// ── Deep-clone helpers ────────────────────────────────────────────────────────

/** Deep-clone a PatternCommand array, producing new Point3D arrays so
 *  mutations to coordinates don't affect the originals. */
export function deepCloneCommands(cmds: PatternCommand[]): PatternCommand[] {
  return cmds.map((cmd): PatternCommand => {
    switch (cmd.kind) {
      case 'Line':
        return {
          ...cmd,
          startPoint: [cmd.startPoint[0], cmd.startPoint[1], cmd.startPoint[2]],
          endPoint:   [cmd.endPoint[0],   cmd.endPoint[1],   cmd.endPoint[2]],
          _raw: cmd._raw ? { ...cmd._raw } : undefined,
        };
      case 'Dot':
        return { ...cmd, point: [cmd.point[0], cmd.point[1], cmd.point[2]] };
      case 'Group':
        return { ...cmd, commands: deepCloneCommands(cmd.commands) };
      default:
        return { ...cmd };
    }
  });
}

/** Clear _raw / _rawPoint on commands whose IDs are in the modified set so
 *  the serializer falls back to formatted numbers. */
export function clearRawForModified(
  cmds: PatternCommand[],
  modifiedIds: Set<string>,
): void {
  for (const cmd of cmds) {
    if (cmd.id && modifiedIds.has(cmd.id)) {
      if (cmd.kind === 'Line')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cmd as any)._raw = undefined;
      if (cmd.kind === 'Dot')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cmd as any)._rawPoint = undefined;
    }
    if (cmd.kind === 'Group') clearRawForModified(cmd.commands, modifiedIds);
  }
}

/** Recursively find a command by ID. */
export function findCmdById(
  cmds: PatternCommand[],
  id: string,
): PatternCommand | null {
  for (const c of cmds) {
    if (c.id === id) return c;
    if (c.kind === 'Group') {
      const f = findCmdById(c.commands, id);
      if (f) return f;
    }
  }
  return null;
}

// ── Handle computation ────────────────────────────────────────────────────────

/** Stable key for comparing two 3-D coordinates (3 decimal places). */
function coordKey(p: [number, number, number]): string {
  return `${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)}`;
}

/** Flatten selected Line/Dot commands in display order (depth-first). */
function flattenSelected(
  cmds: PatternCommand[],
  expandedIds: Set<string>,
): (LineCommand | DotCommand)[] {
  const result: (LineCommand | DotCommand)[] = [];
  for (const cmd of cmds) {
    if (cmd.kind === 'Group') {
      result.push(...flattenSelected(cmd.commands, expandedIds));
    } else if (cmd.id && expandedIds.has(cmd.id)) {
      if (cmd.kind === 'Line' || cmd.kind === 'Dot') result.push(cmd);
    }
  }
  return result;
}

/**
 * Build the list of handles for the current selection.
 *
 * @param cmds            Commands to search (may be the working copy during drag).
 * @param expandedIds     Selected IDs after group expansion.
 * @param cam             Camera state — when provided, hit radii scale with zoom.
 * @param lineThicknesses Per-valve line thickness in mm (index = valve-1).
 * @param dotSizes        Per-valve dot diameter in mm (index = valve-1).
 */
export function computeHandles(
  cmds: PatternCommand[],
  expandedIds: Set<string>,
  cam?: Camera,
  lineThicknesses?: number[],
  dotSizes?: number[],
): Handle[] {
  const selected = flattenSelected(cmds, expandedIds);
  if (selected.length === 0) return [];

  const handles: Handle[] = [];

  for (let i = 0; i < selected.length; i++) {
    const cmd = selected[i];
    if (!cmd.id) continue;

    // ── Per-command hit sizing (mirrors drawLine / drawDot sizing formulas) ──
    const valve    = cmd.valve;
    const thickMm  = lineThicknesses ? (lineThicknesses[valve - 1] ?? 0.5) : 0.5;
    const basePx   = cam ? thickMm * cam.zoom : null;
    const arrowPx  = basePx !== null ? Math.max(4, basePx * 3.5)  : null; // arrowSize
    const dotRPx   = basePx !== null ? Math.max(1.5, basePx * 1.2) : null; // dotRadius

    // ── Dot ───────────────────────────────────────────────────────────────────
    if (cmd.kind === 'Dot') {
      const dotMm   = dotSizes ? (dotSizes[valve - 1] ?? 1.0) : 1.0;
      const rPx     = cam ? (dotMm / 2) * cam.zoom : null;
      handles.push({
        wx: cmd.point[0], wy: cmd.point[1], wz: cmd.point[2],
        role: 'dot',
        targets: [{ cmdId: cmd.id, field: 'point' }],
        hitRadiusPx: rPx ?? undefined,
      });
      continue;
    }

    // ── Line ──────────────────────────────────────────────────────────────────
    const prev = i > 0 ? selected[i - 1] : null;
    const next = i + 1 < selected.length ? selected[i + 1] : null;

    // startPoint: skip if the previous line ends exactly here (junction was already emitted)
    const startIsJunction =
      prev?.kind === 'Line' &&
      coordKey(prev.endPoint as [number, number, number]) ===
        coordKey(cmd.startPoint as [number, number, number]);

    if (!startIsJunction) {
      // Square hit: circumscribed circle of the square covers all corners
      handles.push({
        wx: cmd.startPoint[0], wy: cmd.startPoint[1], wz: cmd.startPoint[2],
        role: 'line-start',
        targets: [{ cmdId: cmd.id, field: 'startPoint' }],
        hitRadiusPx: dotRPx !== null ? dotRPx * Math.SQRT2 : undefined,
      });
    }

    // endPoint: junction if the next selected line starts exactly here
    const endIsJunction =
      next?.kind === 'Line' &&
      next.id &&
      coordKey(cmd.endPoint as [number, number, number]) ===
        coordKey(next.startPoint as [number, number, number]);

    if (endIsJunction && next!.id) {
      handles.push({
        wx: cmd.endPoint[0], wy: cmd.endPoint[1], wz: cmd.endPoint[2],
        role: 'junction',
        targets: [
          { cmdId: cmd.id,   field: 'endPoint'   },
          { cmdId: next!.id, field: 'startPoint' },
        ],
        hitRadiusPx: arrowPx ?? undefined,
      });
    } else {
      const angle = Math.atan2(
        cmd.endPoint[1] - cmd.startPoint[1],
        cmd.endPoint[0] - cmd.startPoint[0],
      );
      handles.push({
        wx: cmd.endPoint[0], wy: cmd.endPoint[1], wz: cmd.endPoint[2],
        role: 'line-end',
        targets: [{ cmdId: cmd.id, field: 'endPoint' }],
        angle,
        hitRadiusPx: arrowPx ?? undefined,
      });
    }
  }

  return handles;
}

// ── Handle rendering ──────────────────────────────────────────────────────────

export function drawHandles(
  ctx: CanvasRenderingContext2D,
  handles: Handle[],
  cam: Camera,
): void {
  for (const h of handles) {
    const [sx, sy] = worldToScreen(h.wx, h.wy, cam);
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1.5;

    if (h.role === 'junction') {
      // Diamond — amber outline, transparent fill
      const s = 7;
      ctx.strokeStyle = '#fbbf24'; // amber-400
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.moveTo(sx,     sy - s);
      ctx.lineTo(sx + s, sy);
      ctx.lineTo(sx,     sy + s);
      ctx.lineTo(sx - s, sy);
      ctx.closePath();
      ctx.stroke();

    } else if (h.role === 'line-start') {
      // Visual is rendered by drawLine's selected-start-dot; nothing extra here.

    } else if (h.role === 'line-end') {
      // Visual is rendered by drawLine's selected-arrowhead rendering; nothing extra here.

    } else {
      // Dot — selection ring already drawn by drawDot(); nothing extra needed here.
    }

    ctx.restore();
  }
}

// ── Handle hit testing ────────────────────────────────────────────────────────

/** Return the handle closest to (sx,sy) that is within its hit radius.
 *  Each handle uses its own `hitRadiusPx` when set; `threshold` is the
 *  fallback for handles without one (e.g. junction diamonds). */
export function hitTestHandle(
  sx: number,
  sy: number,
  handles: Handle[],
  cam: Camera,
  threshold = 11,
): Handle | null {
  let best: Handle | null = null;
  let bestDist = Infinity;
  for (const h of handles) {
    const [hsx, hsy] = worldToScreen(h.wx, h.wy, cam);
    const d = Math.hypot(sx - hsx, sy - hsy);
    const r = h.hitRadiusPx ?? threshold;
    if (d <= r && d < bestDist) { bestDist = d; best = h; }
  }
  return best;
}
