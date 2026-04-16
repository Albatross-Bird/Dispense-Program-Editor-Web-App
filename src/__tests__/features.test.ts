/**
 * Integration tests for features added in steps 5–6.
 *
 * 6A – Group round-trip: covered in parser.test.ts (Group/ENDGROUP section).
 *       Additional precise positional assertion added here.
 * 6B – Connected chain detection via computeHandles
 * 6C – Selection state (program-store)
 * 6D – Drag precision / coordinate serialization
 * 6E – Edge cases
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '@lib/parser';
import { serialize, fmtPoint, serializePatternCommand } from '@lib/serializer';
import { MYD_TABLETOP } from '@lib/syntax-profiles';
import type { LineCommand, DotCommand, GroupNode, PatternCommand } from '@lib/types';
import {
  computeHandles,
  clearRawForModified,
} from '../renderer/components/visualization/handles';
import { useProgramStore } from '../renderer/store/program-store';

// ── Shared helpers ─────────────────────────────────────────────────────────────

function crlf(lines: string[]): string {
  return lines.join('\r\n');
}

const HEADER = crlf([
  '.Main',
  'Station A:',
  'EndStation A',
  'Station B:',
  'EndStation B',
  'Station C:',
  'EndStation C',
  'Station D:',
  'EndStation D',
  '.EndMain',
]);

/** Create a minimal LineCommand for testing (no _raw, no id). */
function makeLine(
  id: string,
  start: [number, number, number],
  end: [number, number, number],
  kw: 'Line' | 'LineFix' = 'Line',
): LineCommand {
  return {
    kind: 'Line',
    id,
    commandKeyword: kw,
    disabled: false,
    valve: 1,
    startPoint: start,
    endPoint: end,
    flowRate: { value: 0.5, unit: 'mg/mm' },
  };
}

function makeDot(
  id: string,
  point: [number, number, number],
): DotCommand {
  return {
    kind: 'Dot',
    id,
    disabled: false,
    valve: 1,
    point,
    valveState: 'ValveOn',
  };
}

// ── 6A: Group round-trip (positional check) ───────────────────────────────────

describe('6A — GROUP/ENDGROUP serialization positions', () => {
  const GROUP_PRG = crlf([
    HEADER,
    '.PattList',
    '.Patt:grp',
    'Comment:##GROUP:MyGroup',
    'Line:1,(100.000,200.000,30.000),ValveOn',
    'Line:1,(100.000,100.000,30.000),ValveOff,0.5000 mg/mm',
    'Dot:2,(150.000,150.000,30.000),ValveOn',
    'Comment:##ENDGROUP:MyGroup',
    '.End',
    '.EndTEMP',
  ]);

  it('serialized output contains ##GROUP before commands', () => {
    const out = serialize(parse(GROUP_PRG, MYD_TABLETOP), MYD_TABLETOP);
    const lines = out.split('\r\n');
    const groupIdx   = lines.indexOf('Comment:##GROUP:MyGroup');
    const lineOnIdx  = lines.indexOf('Line:1,(100.000,200.000,30.000),ValveOn');
    const endGroupIdx = lines.indexOf('Comment:##ENDGROUP:MyGroup');
    expect(groupIdx).toBeGreaterThan(-1);
    expect(lineOnIdx).toBeGreaterThan(groupIdx);
    expect(endGroupIdx).toBeGreaterThan(lineOnIdx);
  });

  it('serialized output contains ##ENDGROUP after the last child', () => {
    const out = serialize(parse(GROUP_PRG, MYD_TABLETOP), MYD_TABLETOP);
    const lines = out.split('\r\n');
    const dotIdx      = lines.indexOf('Dot:2,(150.000,150.000,30.000),ValveOn');
    const endGroupIdx = lines.indexOf('Comment:##ENDGROUP:MyGroup');
    expect(dotIdx).toBeGreaterThan(-1);
    expect(endGroupIdx).toBe(dotIdx + 1);
  });

  it('round-trips the snippet exactly', () => {
    expect(serialize(parse(GROUP_PRG, MYD_TABLETOP), MYD_TABLETOP)).toBe(GROUP_PRG);
  });
});

// ── 6B: Connected chain detection ─────────────────────────────────────────────

describe('6B — chain/junction detection via computeHandles', () => {
  /**
   * For 3 fully-chained lines (A.end==B.start, B.end==C.start) the handles
   * should be:  [line-start(A), junction(A/B), junction(B/C), line-end(C)]
   */
  it('3 consecutive chained Lines produce 2 junction handles', () => {
    const A = makeLine('a', [0, 0, 0], [10, 0, 0]);
    const B = makeLine('b', [10, 0, 0], [20, 0, 0]);
    const C = makeLine('c', [20, 0, 0], [30, 0, 0]);
    const cmds: PatternCommand[] = [A, B, C];
    const ids = new Set(['a', 'b', 'c']);
    const handles = computeHandles(cmds, ids);
    const junctions = handles.filter((h) => h.role === 'junction');
    expect(junctions).toHaveLength(2);
    // Junction at A.end/B.start
    expect(junctions[0].wx).toBe(10);
    expect(junctions[0].targets).toHaveLength(2);
    // Junction at B.end/C.start
    expect(junctions[1].wx).toBe(20);
    expect(junctions[1].targets).toHaveLength(2);
  });

  it('total handle count for 3 fully-chained Lines is 4', () => {
    const A = makeLine('a', [0, 0, 0], [10, 0, 0]);
    const B = makeLine('b', [10, 0, 0], [20, 0, 0]);
    const C = makeLine('c', [20, 0, 0], [30, 0, 0]);
    const handles = computeHandles([A, B, C], new Set(['a', 'b', 'c']));
    expect(handles).toHaveLength(4);
  });

  it('break between B and C produces no junction at that gap', () => {
    const A = makeLine('a', [0, 0, 0], [10, 0, 0]);
    const B = makeLine('b', [10, 0, 0], [20, 0, 0]);
    const C = makeLine('c', [99, 0, 0], [110, 0, 0]); // disconnected
    const handles = computeHandles([A, B, C], new Set(['a', 'b', 'c']));
    // Only the A→B junction exists; B→C break produces separate handles
    const junctions = handles.filter((h) => h.role === 'junction');
    expect(junctions).toHaveLength(1);
    expect(junctions[0].wx).toBe(10);
    // Total: line-start(A), junction(A/B), line-end(B), line-start(C), line-end(C)
    expect(handles).toHaveLength(5);
    // C has its own independent line-start handle
    const cStart = handles.find((h) => h.role === 'line-start' && h.wx === 99);
    expect(cStart).toBeDefined();
  });

  it('LineFix commands chain with Line commands by coordinate match', () => {
    const A = makeLine('a', [0, 0, 0], [10, 0, 0], 'Line');
    const B = makeLine('b', [10, 0, 0], [20, 0, 0], 'LineFix');
    const C = makeLine('c', [20, 0, 0], [30, 0, 0], 'LineFix');
    const handles = computeHandles([A, B, C], new Set(['a', 'b', 'c']));
    const junctions = handles.filter((h) => h.role === 'junction');
    expect(junctions).toHaveLength(2);
  });

  it('a single Line with no neighbours produces line-start and line-end handles', () => {
    const A = makeLine('a', [5, 5, 0], [15, 5, 0]);
    const handles = computeHandles([A], new Set(['a']));
    expect(handles).toHaveLength(2);
    expect(handles[0].role).toBe('line-start');
    expect(handles[1].role).toBe('line-end');
  });

  it('Dot produces a single dot handle, not a junction', () => {
    const D = makeDot('d', [7, 7, 0]);
    const handles = computeHandles([D], new Set(['d']));
    expect(handles).toHaveLength(1);
    expect(handles[0].role).toBe('dot');
  });

  // 6E edge case: Line.end matching Dot.point is NOT a junction
  it('Line whose endPoint matches a Dot position does not create a junction', () => {
    const A = makeLine('a', [0, 0, 0], [10, 0, 0]);
    const D = makeDot('d', [10, 0, 0]); // same coords as A.end
    const handles = computeHandles([A, D], new Set(['a', 'd']));
    const junctions = handles.filter((h) => h.role === 'junction');
    expect(junctions).toHaveLength(0);
    // A should have line-end, D should have dot
    const lineEnd = handles.find((h) => h.role === 'line-end');
    const dot     = handles.find((h) => h.role === 'dot');
    expect(lineEnd).toBeDefined();
    expect(dot).toBeDefined();
  });

  // 6E edge case: Group containing the last command in a connected chain
  it('Line inside a selected Group chains with a top-level Line when both are in expandedIds', () => {
    const A = makeLine('a', [0, 0, 0], [10, 0, 0]);
    const B = makeLine('b', [10, 0, 0], [20, 0, 0]); // inside group
    const grp: GroupNode = {
      kind: 'Group', id: 'g1', name: 'G', commands: [B], collapsed: false,
    };
    const cmds: PatternCommand[] = [A, grp];
    // expandedIds contains A and B (not the group itself)
    const expandedIds = new Set(['a', 'b']);
    const handles = computeHandles(cmds, expandedIds);
    const junctions = handles.filter((h) => h.role === 'junction');
    expect(junctions).toHaveLength(1);
    expect(junctions[0].wx).toBe(10);
    expect(junctions[0].targets).toHaveLength(2);
  });
});

// ── 6C: Selection state ───────────────────────────────────────────────────────

describe('6C — selection state (program-store)', () => {
  // Reset selection before each test
  beforeEach(() => {
    useProgramStore.setState({
      selectedCommandIds: new Set<string>(),
      lastSelectedId: null,
    });
  });

  it('selectOne sets exactly one ID and updates lastSelectedId', () => {
    useProgramStore.getState().selectOne('id1');
    const { selectedCommandIds, lastSelectedId } = useProgramStore.getState();
    expect(selectedCommandIds.size).toBe(1);
    expect(selectedCommandIds.has('id1')).toBe(true);
    expect(lastSelectedId).toBe('id1');
  });

  it('selectOne(null) clears the selection', () => {
    useProgramStore.getState().selectOne('id1');
    useProgramStore.getState().selectOne(null);
    const { selectedCommandIds, lastSelectedId } = useProgramStore.getState();
    expect(selectedCommandIds.size).toBe(0);
    expect(lastSelectedId).toBeNull();
  });

  it('selectToggle adds an ID when not present', () => {
    useProgramStore.getState().selectToggle('id1');
    const { selectedCommandIds } = useProgramStore.getState();
    expect(selectedCommandIds.has('id1')).toBe(true);
  });

  it('selectToggle removes an ID when already selected', () => {
    useProgramStore.getState().selectOne('id1');
    useProgramStore.getState().selectToggle('id1');
    const { selectedCommandIds } = useProgramStore.getState();
    expect(selectedCommandIds.has('id1')).toBe(false);
    expect(selectedCommandIds.size).toBe(0);
  });

  it('selectToggle preserves other selected IDs', () => {
    useProgramStore.getState().selectOne('id1');
    useProgramStore.getState().selectToggle('id2');
    const { selectedCommandIds } = useProgramStore.getState();
    expect(selectedCommandIds.has('id1')).toBe(true);
    expect(selectedCommandIds.has('id2')).toBe(true);
  });

  it('selectRange selects from anchor to target (forward)', () => {
    useProgramStore.getState().selectOne('id1'); // anchor
    const allIds = ['id1', 'id2', 'id3', 'id4'];
    useProgramStore.getState().selectRange('id3', allIds);
    const { selectedCommandIds } = useProgramStore.getState();
    expect(selectedCommandIds.has('id1')).toBe(true);
    expect(selectedCommandIds.has('id2')).toBe(true);
    expect(selectedCommandIds.has('id3')).toBe(true);
    expect(selectedCommandIds.has('id4')).toBe(false);
    expect(selectedCommandIds.size).toBe(3);
  });

  it('selectRange selects from anchor to target (backward)', () => {
    useProgramStore.getState().selectOne('id4'); // anchor
    const allIds = ['id1', 'id2', 'id3', 'id4'];
    useProgramStore.getState().selectRange('id2', allIds);
    const { selectedCommandIds } = useProgramStore.getState();
    expect(selectedCommandIds.has('id2')).toBe(true);
    expect(selectedCommandIds.has('id3')).toBe(true);
    expect(selectedCommandIds.has('id4')).toBe(true);
    expect(selectedCommandIds.has('id1')).toBe(false);
  });

  it('selectRange falls back to single-select when there is no anchor', () => {
    // No prior selectOne → lastSelectedId = null
    const allIds = ['id1', 'id2', 'id3'];
    useProgramStore.getState().selectRange('id2', allIds);
    const { selectedCommandIds, lastSelectedId } = useProgramStore.getState();
    expect(selectedCommandIds.size).toBe(1);
    expect(selectedCommandIds.has('id2')).toBe(true);
    expect(lastSelectedId).toBe('id2');
  });

  it('selectRange preserves the anchor as lastSelectedId', () => {
    useProgramStore.getState().selectOne('id1');
    useProgramStore.getState().selectRange('id3', ['id1', 'id2', 'id3']);
    expect(useProgramStore.getState().lastSelectedId).toBe('id1');
  });

  it('clearSelection empties the set and nulls the anchor', () => {
    useProgramStore.getState().selectOne('id1');
    useProgramStore.getState().selectToggle('id2');
    useProgramStore.getState().clearSelection();
    const { selectedCommandIds, lastSelectedId } = useProgramStore.getState();
    expect(selectedCommandIds.size).toBe(0);
    expect(lastSelectedId).toBeNull();
  });
});

// ── 6D: Drag precision / coordinate serialization ─────────────────────────────

describe('6D — serialized coordinates after drag (no floating-point drift)', () => {
  it('fmtPoint formats to exactly 3 decimal places', () => {
    expect(fmtPoint([100.0, 200.0, 30.0])).toBe('(100.000,200.000,30.000)');
    expect(fmtPoint([1.5, 2.25, 0.125])).toBe('(1.500,2.250,0.125)');
  });

  it('clearRawForModified removes _raw from modified commands', () => {
    const line: LineCommand = {
      kind: 'Line', id: 'abc',
      commandKeyword: 'Line',
      disabled: false, valve: 1,
      startPoint: [100.123, 200.456, 30.0],
      endPoint:   [110.789, 210.012, 30.0],
      flowRate: { value: 0.5, unit: 'mg/mm' },
      _raw: {
        startPoint: '(100.123,200.456,30.000)',
        endPoint:   '(110.789,210.012,30.000)',
        flowRate:   '0.5000 mg/mm',
      },
    };
    clearRawForModified([line], new Set(['abc']));
    expect(line._raw).toBeUndefined();
  });

  it('serializer falls back to fmtPoint (3 dp) when _raw is absent', () => {
    const line: LineCommand = {
      kind: 'Line', id: 'abc',
      commandKeyword: 'Line',
      disabled: false, valve: 1,
      startPoint: [100.123456, 200.654321, 30.0],
      endPoint:   [150.999,    250.001,    30.0],
      flowRate: { value: 0.5, unit: 'mg/mm' },
    };
    const serialized = serializePatternCommand(line);
    // ValveOn line (start)
    expect(serialized[0]).toBe('Line:1,(100.123,200.654,30.000),ValveOn');
    // ValveOff line (end)
    expect(serialized[1]).toBe('Line:1,(150.999,250.001,30.000),ValveOff,0.5000 mg/mm');
  });

  it('simulates a full drag → save cycle with stable 3 dp output', () => {
    // Build a pattern with a line that has _raw strings
    const prg = crlf([
      HEADER,
      '.PattList',
      '.Patt:drag_test',
      'Line:1,(100.000,200.000,30.000),ValveOn',
      'Line:1,(150.000,200.000,30.000),ValveOff,0.5000 mg/mm',
      '.End',
      '.EndTEMP',
    ]);
    const program = parse(prg, MYD_TABLETOP);
    const pattern = program.patterns[0];
    const originalLine = pattern.commands[0] as LineCommand;
    expect(originalLine._raw).toBeDefined();

    // Simulate drag: update numeric coordinates, clear _raw
    const dragged: LineCommand = {
      ...originalLine,
      startPoint: [105.000, 200.000, 30.000],
      endPoint:   [155.000, 200.000, 30.000],
    };
    clearRawForModified([dragged], new Set([dragged.id!]));
    expect(dragged._raw).toBeUndefined();

    // Serialize the dragged command
    const out = serializePatternCommand(dragged);
    expect(out[0]).toBe('Line:1,(105.000,200.000,30.000),ValveOn');
    expect(out[1]).toBe('Line:1,(155.000,200.000,30.000),ValveOff,0.5000 mg/mm');
  });

  it('floating-point arithmetic from drag does not exceed 3 dp in output', () => {
    // A coordinate resulting from floating-point arithmetic
    const x = 0.1 + 0.2; // = 0.30000000000000004 in IEEE 754
    const line: LineCommand = {
      kind: 'Line', id: 'x',
      commandKeyword: 'Line',
      disabled: false, valve: 1,
      startPoint: [x, 0, 0],
      endPoint:   [x + 10, 0, 0],
      flowRate: { value: 0.5, unit: 'mg/mm' },
    };
    const out = serializePatternCommand(line);
    // toFixed(3) rounds correctly: 0.300 not 0.300000000000004
    expect(out[0]).toBe('Line:1,(0.300,0.000,0.000),ValveOn');
  });
});

// ── 6E: Edge cases ─────────────────────────────────────────────────────────────

describe('6E — edge cases', () => {
  it('empty pattern: parse produces 0 commands', () => {
    const prg = crlf([
      HEADER,
      '.PattList',
      '.Patt:empty',
      '.End',
      '.EndTEMP',
    ]);
    const prog = parse(prg, MYD_TABLETOP);
    expect(prog.patterns[0].commands).toHaveLength(0);
    expect(serialize(prog, MYD_TABLETOP)).toBe(prg);
  });

  it('pattern with only Comments: parse produces CommentCommand nodes, serialize preserves them', () => {
    const prg = crlf([
      HEADER,
      '.PattList',
      '.Patt:comments_only',
      'Comment:first',
      'Comment:second',
      '.End',
      '.EndTEMP',
    ]);
    const prog = parse(prg, MYD_TABLETOP);
    const cmds = prog.patterns[0].commands;
    expect(cmds).toHaveLength(2);
    expect(cmds.every((c) => c.kind === 'Comment')).toBe(true);
    expect(serialize(prog, MYD_TABLETOP)).toBe(prg);
    // computeHandles returns nothing for non-Line/Dot commands
    const handles = computeHandles(cmds, new Set(cmds.map((c) => c.id!).filter(Boolean)));
    expect(handles).toHaveLength(0);
  });

  it('Line.end matching Dot.point does NOT produce a junction handle (verified via computeHandles)', () => {
    const line = makeLine('l', [0, 0, 0], [10, 0, 0]);
    const dot  = makeDot('d', [10, 0, 0]);
    const handles = computeHandles([line, dot], new Set(['l', 'd']));
    expect(handles.filter((h) => h.role === 'junction')).toHaveLength(0);
  });

  it('LineFix and Line commands in a mixed chain work identically to all-Line chains', () => {
    const A = makeLine('a', [0, 0, 0], [10, 0, 0], 'LineFix');
    const B = makeLine('b', [10, 0, 0], [20, 0, 0], 'Line');
    const C = makeLine('c', [20, 0, 0], [30, 0, 0], 'LineFix');
    const handles = computeHandles([A, B, C], new Set(['a', 'b', 'c']));
    expect(handles.filter((h) => h.role === 'junction')).toHaveLength(2);
    expect(handles).toHaveLength(4);
  });

  it('group round-trip: groupSelection output serializes to GROUP/ENDGROUP comments', () => {
    // Simulate what groupSelection does: create a GroupNode in the AST
    const lineA: LineCommand = {
      kind: 'Line', id: 'la', commandKeyword: 'Line', disabled: false, valve: 1,
      startPoint: [0, 0, 0], endPoint: [10, 0, 0], flowRate: { value: 0.5, unit: 'mg/mm' },
    };
    const lineB: LineCommand = {
      kind: 'Line', id: 'lb', commandKeyword: 'Line', disabled: false, valve: 1,
      startPoint: [10, 0, 0], endPoint: [20, 0, 0], flowRate: { value: 0.5, unit: 'mg/mm' },
    };
    const grp: GroupNode = { kind: 'Group', id: 'g1', name: 'TestGroup', commands: [lineA, lineB], collapsed: false };
    const serialized = serializePatternCommand(grp);
    expect(serialized[0]).toBe('Comment:##GROUP:TestGroup');
    expect(serialized[serialized.length - 1]).toBe('Comment:##ENDGROUP:TestGroup');
    // Children are in between
    const childLines = serialized.slice(1, -1);
    expect(childLines).toHaveLength(4); // 2 lines × 2 file lines each (ValveOn + ValveOff)
  });

  it('save error state: clearSaveError resets to null', () => {
    useProgramStore.setState({ saveError: 'test error' });
    useProgramStore.getState().clearSaveError();
    expect(useProgramStore.getState().saveError).toBeNull();
  });
});
