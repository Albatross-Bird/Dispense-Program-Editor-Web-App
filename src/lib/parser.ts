import type {
  Program,
  MainBlock,
  Station,
  StationId,
  StationCommand,
  DOCommand,
  CommentCommand,
  Pattern,
  PatternCommand,
  LineCommand,
  DotCommand,
  MarkCommand,
  LaserCommand,
  RawCommand,
  GroupNode,
  Point3D,
  FlowRate,
} from './types';
import type { SyntaxProfile } from './syntax-profiles';

// ── ID generation ─────────────────────────────────────────────────────────────

/** Generate a short random runtime ID (never serialized). */
function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── Low-level helpers ─────────────────────────────────────────────────────────

/**
 * Parse "(x,y,z)" → [x, y, z] as numbers.
 * The raw string is kept by the caller for serialization fidelity.
 */
function parsePoint3D(raw: string): Point3D {
  const inner = raw.replace(/^\(/, '').replace(/\)$/, '');
  const parts = inner.split(',');
  if (parts.length !== 3) throw new Error(`Expected 3 coords in: "${raw}"`);
  return [parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2])];
}

function parseFlowRate(raw: string): FlowRate {
  const idx = raw.indexOf(' ');
  if (idx === -1) return { value: parseFloat(raw), unit: '' };
  return { value: parseFloat(raw.slice(0, idx)), unit: raw.slice(idx + 1) };
}

/** Strip the optional "Disable:" prefix. */
function stripDisable(line: string): { stripped: string; disabled: boolean } {
  if (line.startsWith('Disable:')) {
    return { stripped: line.slice('Disable:'.length), disabled: true };
  }
  return { stripped: line, disabled: false };
}

// ── DO command parsing ────────────────────────────────────────────────────────

function parseDOLine(body: string, disabled: boolean): DOCommand {
  // body = "DO:PatternName AT(x,y,z)[-(x,y,z)]StationSuffix"
  const atIdx = body.indexOf(' AT(');
  if (atIdx === -1) throw new Error(`DO command missing AT clause: "${body}"`);

  const patternRef = body.slice('DO:'.length, atIdx);
  const rawAt = body.slice(atIdx + 1); // everything from "AT(" onward

  const rest = rawAt;
  const closeIdx = rest.indexOf(')');
  if (closeIdx === -1) throw new Error(`Malformed AT clause: "${rest}"`);

  const firstCoordStr = rest.slice('AT'.length, closeIdx + 1); // "(x,y,z)"
  const startPoint = parsePoint3D(firstCoordStr);

  let after = rest.slice(closeIdx + 1);
  let endPoint: Point3D | undefined;
  if (after.startsWith('-(')) {
    const endClose = after.indexOf(')');
    endPoint = parsePoint3D(after.slice(1, endClose + 1));
    after = after.slice(endClose + 1);
  }

  return {
    kind: 'DO',
    disabled,
    patternRef,
    coordinates: { start: startPoint, end: endPoint },
    station: after.trim(),
    rawAt,
  };
}

// ── Line command parsing ──────────────────────────────────────────────────────

interface LineParts {
  valve: number;
  pointStr: string;  // raw "(x,y,z)" string
  point: Point3D;
  valveState: 'ValveOn' | 'ValveOff';
  flowRateStr?: string; // raw "0.5000 mg/mm" string
  flowRate?: FlowRate;
}

function parseLineParts(body: string, keyword: 'Line' | 'LineFix'): LineParts {
  // "Line:N,(x,y,z),ValveOn[,flow]"  or  "LineFix:N,(x,y,z),ValveOn[,flow]"
  const afterPrefix = body.slice(keyword.length + 1); // +1 for ':'
  const firstComma = afterPrefix.indexOf(',');
  const valve = parseInt(afterPrefix.slice(0, firstComma), 10);
  const rest = afterPrefix.slice(firstComma + 1);

  const closeParen = rest.indexOf(')');
  const pointStr = rest.slice(0, closeParen + 1);
  const point = parsePoint3D(pointStr);

  // rest after "(x,y,z)" is ",ValveOn" or ",ValveOff,0.5000 mg/mm"
  const afterPoint = rest.slice(closeParen + 2); // skip "),"
  const nextComma = afterPoint.indexOf(',');
  const valveState =
    nextComma === -1
      ? (afterPoint as 'ValveOn' | 'ValveOff')
      : (afterPoint.slice(0, nextComma) as 'ValveOn' | 'ValveOff');

  let flowRateStr: string | undefined;
  let flowRate: FlowRate | undefined;
  if (nextComma !== -1) {
    flowRateStr = afterPoint.slice(nextComma + 1);
    flowRate = parseFlowRate(flowRateStr);
  }

  return { valve, pointStr, point, valveState, flowRateStr, flowRate };
}

// ── Dot command parsing ───────────────────────────────────────────────────────

function parseDotLine(body: string, disabled: boolean): DotCommand {
  // "Dot:N,(x,y,z),ValveOn|ValveOff"
  const afterPrefix = body.slice('Dot:'.length);
  const firstComma = afterPrefix.indexOf(',');
  const valve = parseInt(afterPrefix.slice(0, firstComma), 10);
  const rest = afterPrefix.slice(firstComma + 1);

  const closeParen = rest.indexOf(')');
  const pointStr = rest.slice(0, closeParen + 1);
  const point = parsePoint3D(pointStr);
  const valveState = rest.slice(closeParen + 2).trim() as 'ValveOn' | 'ValveOff';

  return { kind: 'Dot', id: genId(), disabled, valve, point, valveState, _rawPoint: pointStr };
}

// ── Pattern block parser ──────────────────────────────────────────────────────

const RE_GROUP_START = /^##GROUP:(.+)$/;
const RE_GROUP_END   = /^##ENDGROUP:(.*)$/;

interface GroupFrame {
  name: string;
  commands: PatternCommand[];
}

/**
 * Stack-based parser that supports arbitrarily nested groups.
 *
 * Defensive rules:
 *  - Orphaned ##GROUP (no matching ##ENDGROUP): the ##GROUP: line is emitted
 *    as a plain Comment and its children are emitted at the parent level.
 *  - Orphaned ##ENDGROUP (no open group): emitted as a plain Comment.
 *  - Name-mismatched ##ENDGROUP: closes the innermost open group anyway.
 */
function parsePatternCommands(
  lines: string[],
  start: number,
  end: number,
): PatternCommand[] {
  const root: PatternCommand[] = [];
  const stack: GroupFrame[] = [];

  /** The command list we are currently appending to. */
  const target = (): PatternCommand[] =>
    stack.length > 0 ? stack[stack.length - 1].commands : root;

  let i = start;

  while (i < end) {
    const rawLine = lines[i];
    const { stripped, disabled } = stripDisable(rawLine);

    // ── Comment (and GROUP/ENDGROUP markers) ──────────────────────────────
    if (stripped.startsWith('Comment:')) {
      const text = stripped.slice('Comment:'.length);

      const startMatch = text.match(RE_GROUP_START);
      if (startMatch) {
        stack.push({ name: startMatch[1], commands: [] });
        i++;
        continue;
      }

      const endMatch = text.match(RE_GROUP_END);
      if (endMatch) {
        if (stack.length > 0) {
          const frame = stack.pop()!;
          const node: GroupNode = {
            kind: 'Group',
            id: genId(),
            name: frame.name,
            commands: frame.commands,
            collapsed: false,
          };
          target().push(node);
        } else {
          // ENDGROUP with no open group → plain Comment
          target().push({ kind: 'Comment', id: genId(), text });
        }
        i++;
        continue;
      }

      target().push({ kind: 'Comment', id: genId(), text });
      i++;
      continue;
    }

    // ── Mark / Laser (stored verbatim) ────────────────────────────────────
    if (stripped.startsWith('Mark:')) {
      target().push({ kind: 'Mark', id: genId(), raw: rawLine } as MarkCommand);
      i++;
      continue;
    }

    if (stripped.startsWith('Laser:')) {
      target().push({ kind: 'Laser', id: genId(), raw: rawLine } as LaserCommand);
      i++;
      continue;
    }

    // ── Dot ───────────────────────────────────────────────────────────────
    if (stripped.startsWith('Dot:')) {
      target().push(parseDotLine(stripped, disabled));
      i++;
      continue;
    }

    // ── Line / LineFix ────────────────────────────────────────────────────
    const isLine = stripped.startsWith('Line:');
    const isLineFix = stripped.startsWith('LineFix:');

    if (isLine || isLineFix) {
      const keyword: 'Line' | 'LineFix' = isLine ? 'Line' : 'LineFix';
      const parts = parseLineParts(stripped, keyword);

      if (parts.valveState === 'ValveOn') {
        // Form a LineCommand only when the immediately following line is a
        // clean same-keyword ValveOff partner.  Consecutive ValveOn lines
        // ("orphans") are stored verbatim as RawCommand for byte-for-byte
        // fidelity.
        if (i + 1 < end) {
          const nextRaw = lines[i + 1];
          const { stripped: nextStripped, disabled: nextDisabled } =
            stripDisable(nextRaw);
          if (nextStripped.startsWith(`${keyword}:`)) {
            const nextParts = parseLineParts(nextStripped, keyword);
            if (nextParts.valveState === 'ValveOff') {
              const cmd: LineCommand = {
                kind: 'Line',
                id: genId(),
                commandKeyword: keyword,
                disabled: disabled || nextDisabled,
                valve: parts.valve,
                startPoint: parts.point,
                endPoint: nextParts.point,
                flowRate: nextParts.flowRate ?? { value: 0, unit: '' },
                _raw: {
                  startPoint: parts.pointStr,
                  endPoint: nextParts.pointStr,
                  flowRate: nextParts.flowRateStr,
                },
              };
              target().push(cmd);
              i += 2;
              continue;
            }
          }
        }
        // Not a clean pair — store verbatim
        target().push({ kind: 'Raw', id: genId(), raw: rawLine });
        i++;
        continue;
      }

      // Orphaned ValveOff
      target().push({ kind: 'Raw', id: genId(), raw: rawLine });
      i++;
      continue;
    }

    // ── Unknown (Arc, ArcMid, etc.) — store verbatim ──────────────────────
    target().push({ kind: 'Raw', id: genId(), raw: rawLine });
    i++;
  }

  // Flush any unclosed groups: emit the ##GROUP: header as a plain Comment,
  // then splice the children into the parent (preserves backward compatibility).
  while (stack.length > 0) {
    const frame = stack.pop()!;
    const tgt = target();
    tgt.push({ kind: 'Comment', id: genId(), text: `##GROUP:${frame.name}` });
    for (const child of frame.commands) tgt.push(child);
  }

  return root;
}

// ── Main block parser ─────────────────────────────────────────────────────────

function parseMainBlock(
  lines: string[],
  start: number,
  end: number,
): MainBlock {
  const stations: Station[] = [];
  let i = start;

  while (i < end) {
    const line = lines[i];
    const m = line.match(/^Station ([A-D]):$/);
    if (!m) { i++; continue; }

    const id = m[1] as StationId;
    const endToken = `EndStation ${id}`;
    i++;
    const commands: StationCommand[] = [];

    while (i < end && lines[i] !== endToken) {
      const rawLine = lines[i];
      const { stripped, disabled } = stripDisable(rawLine);

      if (stripped.startsWith('Comment:')) {
        commands.push({ kind: 'Comment', text: stripped.slice('Comment:'.length) });
      } else if (stripped.startsWith('DO:')) {
        commands.push(parseDOLine(stripped, disabled));
      } else {
        throw new Error(`Unknown station command at line ${i + 1}: "${rawLine}"`);
      }
      i++;
    }

    i++; // skip EndStation line
    stations.push({ id, commands });
  }

  return { stations };
}

// ── Top-level parser ──────────────────────────────────────────────────────────

export function parse(source: string, _profile: SyntaxProfile): Program {
  const lines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();

  const mainStart = lines.indexOf('.Main');
  const mainEnd = lines.indexOf('.EndMain');
  if (mainStart === -1 || mainEnd === -1) {
    throw new Error('Missing .Main/.EndMain block');
  }

  const pattListStart = lines.indexOf('.PattList');
  if (pattListStart === -1) throw new Error('Missing .PattList block');

  // Auto-detect the closing token (.EndTEMP, .EndPattList, …)
  let pattListEnd = -1;
  let pattListEndToken = '.EndTEMP';
  for (let i = pattListStart + 1; i < lines.length; i++) {
    const t = lines[i];
    if (t.startsWith('.End') && t !== '.End') {
      pattListEnd = i;
      pattListEndToken = t;
      break;
    }
  }
  if (pattListEnd === -1) throw new Error('Missing closing token for .PattList block');

  const main = parseMainBlock(lines, mainStart + 1, mainEnd);

  const patterns: Pattern[] = [];
  let i = pattListStart + 1;

  while (i < pattListEnd) {
    const line = lines[i];
    const m = line.match(/^\.Patt:(.+)$/);
    if (!m) { i++; continue; }

    const name = m[1];
    i++;
    const bodyStart = i;
    while (i < pattListEnd && lines[i] !== '.End') i++;

    patterns.push({ name, commands: parsePatternCommands(lines, bodyStart, i) });
    i++; // skip .End
  }

  return { main, patterns, pattListEndToken };
}

// ── Partial-block helpers (used by the plain-text editor) ─────────────────────

/**
 * Parse just a pattern block into its command list.
 * `text` must include the `.Patt:name` header and `.End` footer.
 * Wraps in a minimal dummy program and delegates to the full parser.
 */
export function parsePatternBlock(text: string): PatternCommand[] {
  const wrapped = `.Main\n.EndMain\n.PattList\n${text.trim()}\n.EndTEMP`;
  const program = parse(wrapped, {} as SyntaxProfile);
  if (program.patterns.length === 0) throw new Error('No pattern block found in text');
  return program.patterns[0].commands;
}

/**
 * Parse just a main block.
 * `text` must include the `.Main` header and `.EndMain` footer.
 */
export function parseMainBlockText(text: string): MainBlock {
  const wrapped = `${text.trim()}\n.PattList\n.EndTEMP`;
  const program = parse(wrapped, {} as SyntaxProfile);
  return program.main;
}
