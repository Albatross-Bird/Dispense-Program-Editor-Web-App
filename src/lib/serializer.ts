import type { Program, StationCommand, PatternCommand, Point3D, FlowRate, GroupNode } from './types';
import type { SyntaxProfile } from './syntax-profiles';
import { resolvePattListEndToken } from './syntax-profiles';

// ── Helpers for newly-created commands (not loaded from file) ─────────────────

/**
 * Format a Point3D for serialization.  Used only when there is no _raw string
 * (i.e. the command was created programmatically, not parsed from a file).
 * Uses 3 decimal places, which matches the most common format in .prg files.
 */
export function fmtPoint(p: Point3D): string {
  return `(${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)})`;
}

export function fmtFlowRate(fr: FlowRate): string {
  return fr.unit ? `${fr.value.toFixed(4)} ${fr.unit}` : `${fr.value}`;
}

function disablePrefix(disabled: boolean): string {
  return disabled ? 'Disable:' : '';
}

// ── Station commands ──────────────────────────────────────────────────────────

function serializeStationCommand(cmd: StationCommand): string {
  switch (cmd.kind) {
    case 'Comment':
      return `Comment:${cmd.text}`;
    case 'DO':
      return `${disablePrefix(cmd.disabled)}DO:${cmd.patternRef} ${cmd.rawAt}`;
  }
}

// ── Pattern commands ──────────────────────────────────────────────────────────

export function serializePatternCommand(cmd: PatternCommand): string[] {
  switch (cmd.kind) {
    case 'Comment':
      return [`Comment:${cmd.text}`];

    case 'Mark':
    case 'Laser':
    case 'Raw':
      return [cmd.raw];

    case 'Group': {
      const lines: string[] = [`Comment:##GROUP:${cmd.name}`];
      for (const child of cmd.commands) lines.push(...serializePatternCommand(child));
      lines.push(`Comment:##ENDGROUP:${cmd.name}`);
      return lines;
    }

    case 'Dot': {
      // Use stored raw point string for fidelity; fall back to formatted if absent.
      const pointStr = cmd._rawPoint ?? fmtPoint(cmd.point);
      return [`${disablePrefix(cmd.disabled)}Dot:${cmd.valve},${pointStr},${cmd.valveState}`];
    }

    case 'Line': {
      const prefix = disablePrefix(cmd.disabled);
      const kw = cmd.commandKeyword ?? 'Line';
      // Use raw strings when available (loaded from file) for byte-exact output.
      const startStr = cmd._raw?.startPoint ?? fmtPoint(cmd.startPoint);
      const endStr = cmd._raw?.endPoint ?? fmtPoint(cmd.endPoint);
      const flowStr = cmd._raw?.flowRate ?? fmtFlowRate(cmd.flowRate);
      return [
        `${prefix}${kw}:${cmd.valve},${startStr},ValveOn`,
        `${prefix}${kw}:${cmd.valve},${endStr},ValveOff,${flowStr}`,
      ];
    }
  }
}

// ── Block-level serializers (for per-block text views) ───────────────────────

export function serializeMainBlock(program: Program, profile?: import('./syntax-profiles').SyntaxProfile): string {
  const eol = '\r\n';
  const omitHeader = profile?.serializeOverrides?.omitMainHeader === true
    ? true
    : !program.hasMainHeader;
  const lines: string[] = omitHeader ? [] : ['.Main'];
  for (const station of program.main.stations) {
    lines.push(`Station ${station.id}:`);
    for (const cmd of station.commands) lines.push(serializeStationCommand(cmd));
    lines.push(`EndStation ${station.id}`);
  }
  lines.push('.EndMain');
  return lines.join(eol);
}

export function serializePattern(pattern: import('./types').Pattern): string {
  const eol = '\r\n';
  const lines: string[] = [`.Patt:${pattern.name}`];
  for (const cmd of pattern.commands) lines.push(...serializePatternCommand(cmd));
  lines.push('.End');
  return lines.join(eol);
}

// ── Top-level serializer ──────────────────────────────────────────────────────

export function serialize(program: Program, profile: SyntaxProfile): string {
  const eol = profile.serializeOverrides?.lineEnding ?? '\r\n';
  const lines: string[] = [];

  // Emit `.Main` header only when the profile does not suppress it AND the
  // program was originally parsed with a header present.
  const omitHeader =
    profile.serializeOverrides?.omitMainHeader === true ||
    !program.hasMainHeader;
  if (!omitHeader) lines.push('.Main');

  for (const station of program.main.stations) {
    lines.push(`Station ${station.id}:`);
    for (const cmd of station.commands) {
      lines.push(serializeStationCommand(cmd));
    }
    lines.push(`EndStation ${station.id}`);
  }
  lines.push('.EndMain');

  lines.push('.PattList');
  for (const pattern of program.patterns) {
    lines.push(`.Patt:${pattern.name}`);
    for (const cmd of pattern.commands) {
      lines.push(...serializePatternCommand(cmd));
    }
    lines.push('.End');
  }
  lines.push(resolvePattListEndToken(program, profile));

  // Preserve any TEMP section that was present in the source file verbatim.
  if (program.tempSection && program.tempSection.length > 0) {
    for (const rawLine of program.tempSection) lines.push(rawLine);
  }

  return lines.join(eol);
}
