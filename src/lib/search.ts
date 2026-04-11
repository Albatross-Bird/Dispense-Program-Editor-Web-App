/**
 * Search logic — pure functions, no side effects.
 *
 * Each command is converted to a flat lower-case searchable text string;
 * the query is matched as a case-insensitive substring.
 */
import type { PatternCommand, Program, Point3D, FlowRate } from './types';

export type SearchScope = 'pattern' | 'program' | 'selection';

export interface SearchMatch {
  id: string;
  /** null = currently-displayed pattern; non-null = another pattern by name */
  patternName: string | null;
}

// ── Text representation ───────────────────────────────────────────────────────

function commandSearchText(cmd: PatternCommand): string {
  switch (cmd.kind) {
    case 'Line': {
      const kw = (cmd.commandKeyword ?? 'line').toLowerCase();
      const [sx, sy, sz] = cmd.startPoint;
      const [ex, ey, ez] = cmd.endPoint;
      return [
        kw, 'line',
        `p${cmd.valve}`, `param ${cmd.valve}`,
        sx.toFixed(3), sy.toFixed(3), sz.toFixed(3),
        ex.toFixed(3), ey.toFixed(3), ez.toFixed(3),
        cmd.flowRate.value.toFixed(4), cmd.flowRate.unit,
      ].join(' ');
    }
    case 'Dot': {
      const [px, py, pz] = cmd.point;
      return [
        'dot',
        `p${cmd.valve}`, `param ${cmd.valve}`,
        px.toFixed(3), py.toFixed(3), pz.toFixed(3),
        cmd.valveState.toLowerCase(),
      ].join(' ');
    }
    case 'Comment':
      return `comment ${cmd.text}`;
    case 'Mark':
      return `mark ${cmd.raw}`;
    case 'Laser':
      return `laser ${cmd.raw}`;
    case 'Raw':
      return cmd.raw;
    case 'Group':
      return `group ${cmd.name}`;
    default:
      return '';
  }
}

// ── Recursive collect ─────────────────────────────────────────────────────────

function collectMatches(
  cmds: PatternCommand[],
  queryLower: string,
  patternName: string | null,
  out: SearchMatch[],
): void {
  for (const cmd of cmds) {
    if (!cmd.id) continue;
    if (commandSearchText(cmd).toLowerCase().includes(queryLower)) {
      out.push({ id: cmd.id, patternName });
    }
    if (cmd.kind === 'Group') {
      collectMatches(cmd.commands, queryLower, patternName, out);
    }
  }
}

// ── Replace helpers ───────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive text replacement (all occurrences). */
function replaceCI(str: string, queryLower: string, replacement: string): string {
  return str.replace(new RegExp(escapeRegex(queryLower), 'gi'), replacement);
}

function formatPt(p: Point3D): string {
  return `(${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)})`;
}

function parsePt(s: string): Point3D {
  const inner = s.replace(/^\(/, '').replace(/\)$/, '');
  const parts = inner.split(',');
  if (parts.length !== 3) throw new Error('bad point');
  const [x, y, z] = parts.map(parseFloat);
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) throw new Error('non-finite');
  return [x, y, z];
}

function parseFlowRateStr(s: string): FlowRate {
  const idx = s.indexOf(' ');
  if (idx === -1) return { value: parseFloat(s), unit: '' };
  return { value: parseFloat(s.slice(0, idx)), unit: s.slice(idx + 1) };
}

/**
 * Attempt to apply a text replacement to a single command.
 *
 * Returns a new command with the replacement applied, or `null` if:
 *   - The command kind is not replaceable (Mark, Laser, Raw)
 *   - The command is a metadata comment (starts with `##`)
 *   - The query did not match any replaceable field
 *   - The replacement produced an unparseable result
 */
export function applyReplace(
  cmd: PatternCommand,
  queryLower: string,
  replacement: string,
): PatternCommand | null {
  switch (cmd.kind) {
    case 'Comment': {
      if (cmd.text.startsWith('##')) return null; // metadata — not replaceable
      const newText = replaceCI(cmd.text, queryLower, replacement);
      if (newText === cmd.text) return null;
      return { ...cmd, text: newText };
    }

    case 'Line': {
      const startStr = cmd._raw?.startPoint ?? formatPt(cmd.startPoint);
      const endStr   = cmd._raw?.endPoint   ?? formatPt(cmd.endPoint);
      const flowStr  = cmd._raw?.flowRate
        ?? (cmd.flowRate.value.toFixed(4) + (cmd.flowRate.unit ? ' ' + cmd.flowRate.unit : ''));
      const valveStr = `p${cmd.valve}`;

      const newStart = replaceCI(startStr, queryLower, replacement);
      const newEnd   = replaceCI(endStr,   queryLower, replacement);
      const newFlow  = replaceCI(flowStr,  queryLower, replacement);

      let newValve = cmd.valve;
      const valveText = replaceCI(valveStr, queryLower, replacement);
      if (valveText !== valveStr) {
        const n = parseInt(valveText.replace(/^p/i, ''), 10);
        if (!isNaN(n) && n >= 1 && n <= 10) newValve = n;
      }

      if (newStart === startStr && newEnd === endStr && newFlow === flowStr && newValve === cmd.valve) {
        return null;
      }

      try {
        return {
          ...cmd,
          valve: newValve,
          startPoint: parsePt(newStart),
          endPoint:   parsePt(newEnd),
          flowRate:   parseFlowRateStr(newFlow),
          _raw: undefined,
        };
      } catch { return null; }
    }

    case 'Dot': {
      const pointStr = cmd._rawPoint ?? formatPt(cmd.point);
      const valveStr = `p${cmd.valve}`;

      const newPoint = replaceCI(pointStr, queryLower, replacement);
      let newValve = cmd.valve;
      const valveText = replaceCI(valveStr, queryLower, replacement);
      if (valveText !== valveStr) {
        const n = parseInt(valveText.replace(/^p/i, ''), 10);
        if (!isNaN(n) && n >= 1 && n <= 10) newValve = n;
      }

      if (newPoint === pointStr && newValve === cmd.valve) return null;

      try {
        return { ...cmd, valve: newValve, point: parsePt(newPoint), _rawPoint: undefined };
      } catch { return null; }
    }

    case 'Group': {
      const newName = replaceCI(cmd.name, queryLower, replacement).trim();
      if (!newName || newName === cmd.name) return null;
      return { ...cmd, name: newName };
    }

    default:
      return null; // Mark, Laser, Raw — not replaceable
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function searchProgram(
  program: Program,
  currentPatternName: string | null,
  scope: SearchScope,
  query: string,
  selectedCommandIds: Set<string>,
): SearchMatch[] {
  const q = query.trim();
  if (!q) return [];
  const queryLower = q.toLowerCase();
  const results: SearchMatch[] = [];

  if (scope === 'program') {
    for (const pattern of program.patterns) {
      collectMatches(pattern.commands, queryLower, pattern.name, results);
    }
  } else if (scope === 'pattern') {
    if (currentPatternName === null) return [];
    const pattern = program.patterns.find((p) => p.name === currentPatternName);
    if (!pattern) return [];
    collectMatches(pattern.commands, queryLower, null, results);
  } else {
    // 'selection' — only commands whose ID is in selectedCommandIds
    if (currentPatternName === null) return [];
    const pattern = program.patterns.find((p) => p.name === currentPatternName);
    if (!pattern) return [];
    function collectSelected(cmds: PatternCommand[]) {
      for (const cmd of cmds) {
        if (!cmd.id) continue;
        if (selectedCommandIds.has(cmd.id) && commandSearchText(cmd).toLowerCase().includes(queryLower)) {
          results.push({ id: cmd.id, patternName: null });
        }
        if (cmd.kind === 'Group') collectSelected(cmd.commands);
      }
    }
    collectSelected(pattern.commands);
  }

  return results;
}
