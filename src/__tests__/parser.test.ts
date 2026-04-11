import { describe, it, expect } from 'vitest';
import { parse } from '@lib/parser';
import { serialize } from '@lib/serializer';
import { MYD_DEFAULT } from '@lib/syntax-profiles';
import type {
  LineCommand,
  DotCommand,
  CommentCommand,
  RawCommand,
  GroupNode,
} from '@lib/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function crlf(lines: string[]): string {
  return lines.join('\r\n');
}

// ── Minimal well-formed program ───────────────────────────────────────────────

const MINIMAL_PRG = crlf([
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
  '.PattList',
  '.EndTEMP',
]);

// ── Comprehensive sample covering all command types ───────────────────────────
// Note: coordinate values are chosen so that parseFloat(s).toString() === s
// (i.e., no trailing zeros that would be dropped).  This allows the round-trip
// assertion to use the _raw fallback when _raw is not populated (it always IS
// populated by the parser, but the format function path is tested by creating
// commands programmatically).

const SAMPLE_PRG = crlf([
  '.Main',
  'Station A:',
  'Comment:Metal',
  'DO:METAPOR - STANDARD - ORDER 2 AT(338.348,356.491,46.036)-(181.779,356.277,46.036)Single A',
  'Disable:DO:METAPOR - STANDARD AT(338.348,356.491,46.036)Single A',
  'EndStation A',
  'Station B:',
  'EndStation B',
  'Station C:',
  'EndStation C',
  'Station D:',
  'EndStation D',
  '.EndMain',
  '.PattList',
  '.Patt:t4',
  'Laser:1 AT(162.486,80.078,30.944)',
  'Line:1,(154.038,248.558,30.689),ValveOn',
  'Line:1,(154.038,134.030,30.689),ValveOff,0.5000 mg/mm',
  'Line:1,(155.038,134.030,30.689),ValveOn',
  'Line:1,(155.038,248.556,30.689),ValveOff,0.5000 mg/mm',
  'Comment:Line0',
  'Disable:Line:1,(156.038,248.556,30.689),ValveOn',
  'Disable:Line:1,(156.038,134.028,30.689),ValveOff,0.5000 mg/mm',
  '.End',
  '.Patt:VacuumSamplesMetalV1',
  'Mark:1,(338.551,356.371,46.036)-(181.806,356.551,46.036)Two',
  'Laser:3 AT(343.584,181.804,28.474)-(338.622,107.510,28.474)-(365.930,127.038,28.474)',
  'Comment:0.25 mg/dot',
  'Dot:2,(335.464,228.666,28.801),ValveOn',
  'Line:2,(333.099,180.203,28.619),ValveOn',
  'Line:2,(333.804,180.640,29.322),ValveOff,0.900 mg/mm',
  '.End',
  '.Patt:t4Pics',
  'Dot:1,(159.744,139.454,30.691),ValveOff',
  '.End',
  '.Patt:withArc',
  'Line:2,(341.945,128.064,28.622),ValveOn',
  'Line:2,(341.945,100.000,28.622),ValveOff,0.5000 mg/mm',
  'Arc:2,(341.945,128.064,28.622),ValveOn',
  'ArcMid:2,(341.369,127.405,29.329),ValveOn',
  'Arc:2,(340.771,127.897,29.329),ValveOff,0.5000 mg/mm',
  '.End',
  '.Patt:orphanedValveOn',
  'Line:2,(344.360,128.049,28.626),ValveOn',
  'Line:2,(343.783,127.350,29.328),ValveOn',
  'Line:2,(343.187,127.800,29.328),ValveOff,0.500 mg/mm',
  '.End',
  '.EndTEMP',
]);

// ── parse — minimal program ───────────────────────────────────────────────────

describe('parse — minimal program', () => {
  it('parses without throwing', () => {
    expect(() => parse(MINIMAL_PRG, MYD_DEFAULT)).not.toThrow();
  });

  it('produces 4 stations with no commands', () => {
    const prog = parse(MINIMAL_PRG, MYD_DEFAULT);
    expect(prog.main.stations).toHaveLength(4);
    for (const s of prog.main.stations) expect(s.commands).toHaveLength(0);
  });

  it('produces no patterns', () => {
    expect(parse(MINIMAL_PRG, MYD_DEFAULT).patterns).toHaveLength(0);
  });

  it('captures .EndTEMP as pattListEndToken', () => {
    expect(parse(MINIMAL_PRG, MYD_DEFAULT).pattListEndToken).toBe('.EndTEMP');
  });
});

// ── parse — main block ────────────────────────────────────────────────────────

describe('parse — main block', () => {
  const prog = parse(SAMPLE_PRG, MYD_DEFAULT);

  it('has 4 stations in the correct order', () => {
    expect(prog.main.stations.map((s) => s.id)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('parses a Comment in station A', () => {
    const comment = prog.main.stations[0].commands.find(
      (c): c is CommentCommand => c.kind === 'Comment',
    );
    expect(comment?.text).toBe('Metal');
  });

  it('parses an enabled DO command', () => {
    const doCmd = prog.main.stations[0].commands.find(
      (c) => c.kind === 'DO' && !c.disabled,
    ) as any;
    expect(doCmd).toBeDefined();
    expect(doCmd.patternRef).toBe('METAPOR - STANDARD - ORDER 2');
    expect(doCmd.coordinates.start).toEqual([338.348, 356.491, 46.036]);
    expect(doCmd.coordinates.end).toEqual([181.779, 356.277, 46.036]);
    expect(doCmd.station).toBe('Single A');
  });

  it('parses a disabled DO command', () => {
    const doCmd = prog.main.stations[0].commands.find(
      (c) => c.kind === 'DO' && c.disabled,
    ) as any;
    expect(doCmd).toBeDefined();
    expect(doCmd.patternRef).toBe('METAPOR - STANDARD');
  });

  it('parses empty stations correctly', () => {
    expect(prog.main.stations[1].commands).toHaveLength(0);
    expect(prog.main.stations[2].commands).toHaveLength(0);
    expect(prog.main.stations[3].commands).toHaveLength(0);
  });
});

// ── parse — patterns ──────────────────────────────────────────────────────────

describe('parse — patterns', () => {
  const prog = parse(SAMPLE_PRG, MYD_DEFAULT);

  it('parses the correct number of patterns', () => {
    expect(prog.patterns).toHaveLength(5);
  });

  it('captures pattern names correctly', () => {
    expect(prog.patterns.map((p) => p.name)).toEqual([
      't4',
      'VacuumSamplesMetalV1',
      't4Pics',
      'withArc',
      'orphanedValveOn',
    ]);
  });

  describe('t4 — Line command pairing', () => {
    const t4 = parse(SAMPLE_PRG, MYD_DEFAULT).patterns.find((p) => p.name === 't4')!;

    it('has a Laser command stored verbatim', () => {
      const laser = t4.commands.find((c) => c.kind === 'Laser');
      expect((laser as any).raw).toBe('Laser:1 AT(162.486,80.078,30.944)');
    });

    it('parses enabled Line commands with correct fields', () => {
      const lines = t4.commands.filter(
        (c): c is LineCommand => c.kind === 'Line' && !c.disabled,
      );
      expect(lines).toHaveLength(2);
      expect(lines[0].valve).toBe(1);
      expect(lines[0].startPoint).toEqual([154.038, 248.558, 30.689]);
      expect(lines[0].endPoint).toEqual([154.038, 134.03, 30.689]);
      expect(lines[0].flowRate).toEqual({ value: 0.5, unit: 'mg/mm' });
    });

    it('preserves raw coordinate strings for serialization fidelity', () => {
      const lines = t4.commands.filter(
        (c): c is LineCommand => c.kind === 'Line' && !c.disabled,
      );
      // The raw strings preserve trailing zeros that parseFloat drops
      expect(lines[0]._raw.startPoint).toBe('(154.038,248.558,30.689)');
      expect(lines[0]._raw.endPoint).toBe('(154.038,134.030,30.689)');
      expect(lines[0]._raw.flowRate).toBe('0.5000 mg/mm');
    });

    it('parses a Comment between Line commands', () => {
      const comment = t4.commands.find(
        (c): c is CommentCommand => c.kind === 'Comment',
      );
      expect(comment?.text).toBe('Line0');
    });

    it('parses a disabled Line pair', () => {
      const disabled = t4.commands.filter(
        (c): c is LineCommand => c.kind === 'Line' && c.disabled,
      );
      expect(disabled).toHaveLength(1);
      expect(disabled[0].startPoint).toEqual([156.038, 248.556, 30.689]);
    });
  });

  describe('VacuumSamplesMetalV1 — Mark, Dot, Line', () => {
    const p = parse(SAMPLE_PRG, MYD_DEFAULT).patterns.find(
      (p) => p.name === 'VacuumSamplesMetalV1',
    )!;

    it('stores Mark verbatim', () => {
      const mark = p.commands.find((c) => c.kind === 'Mark') as any;
      expect(mark.raw).toBe('Mark:1,(338.551,356.371,46.036)-(181.806,356.551,46.036)Two');
    });

    it('parses a Dot with ValveOn', () => {
      const dot = p.commands.find((c): c is DotCommand => c.kind === 'Dot')!;
      expect(dot.valve).toBe(2);
      expect(dot.point).toEqual([335.464, 228.666, 28.801]);
      expect(dot.valveState).toBe('ValveOn');
      expect(dot._rawPoint).toBe('(335.464,228.666,28.801)');
    });

    it('parses a Line command', () => {
      const line = p.commands.find((c): c is LineCommand => c.kind === 'Line')!;
      expect(line.flowRate).toEqual({ value: 0.9, unit: 'mg/mm' });
      expect(line._raw.flowRate).toBe('0.900 mg/mm');
    });
  });

  describe('t4Pics — Dot with ValveOff', () => {
    it('parses a Dot with ValveOff state', () => {
      const p = parse(SAMPLE_PRG, MYD_DEFAULT).patterns.find(
        (p) => p.name === 't4Pics',
      )!;
      const dot = p.commands[0] as DotCommand;
      expect(dot.kind).toBe('Dot');
      expect(dot.valveState).toBe('ValveOff');
      expect(dot.disabled).toBe(false);
    });
  });

  describe('withArc — Arc fallback to RawCommand', () => {
    const p = parse(SAMPLE_PRG, MYD_DEFAULT).patterns.find(
      (p) => p.name === 'withArc',
    )!;

    it('keeps the clean Line pair as a LineCommand', () => {
      const line = p.commands.find((c): c is LineCommand => c.kind === 'Line');
      expect(line).toBeDefined();
      expect(line!.startPoint).toEqual([341.945, 128.064, 28.622]);
    });

    it('stores Arc/ArcMid as RawCommands', () => {
      const raws = p.commands.filter((c): c is RawCommand => c.kind === 'Raw');
      expect(raws).toHaveLength(3);
      expect(raws[0].raw).toBe('Arc:2,(341.945,128.064,28.622),ValveOn');
      expect(raws[1].raw).toBe('ArcMid:2,(341.369,127.405,29.329),ValveOn');
      expect(raws[2].raw).toBe('Arc:2,(340.771,127.897,29.329),ValveOff,0.5000 mg/mm');
    });
  });

  describe('orphanedValveOn — consecutive ValveOn lines', () => {
    const p = parse(SAMPLE_PRG, MYD_DEFAULT).patterns.find(
      (p) => p.name === 'orphanedValveOn',
    )!;

    it('stores the orphaned ValveOn as RawCommand', () => {
      const raw = p.commands.find((c): c is RawCommand => c.kind === 'Raw');
      expect(raw?.raw).toBe('Line:2,(344.360,128.049,28.626),ValveOn');
    });

    it('pairs the following ValveOn+ValveOff as LineCommand', () => {
      const line = p.commands.find((c): c is LineCommand => c.kind === 'Line')!;
      expect(line.startPoint).toEqual([343.783, 127.35, 29.328]);
      expect(line.endPoint).toEqual([343.187, 127.8, 29.328]);
      expect(line._raw.endPoint).toBe('(343.187,127.800,29.328)');
    });
  });
});

// ── serialize — round-trip ────────────────────────────────────────────────────

describe('serialize — round-trip', () => {
  it('round-trips the minimal program exactly', () => {
    const prog = parse(MINIMAL_PRG, MYD_DEFAULT);
    expect(serialize(prog, MYD_DEFAULT)).toBe(MINIMAL_PRG);
  });

  it('round-trips the comprehensive sample exactly', () => {
    const prog = parse(SAMPLE_PRG, MYD_DEFAULT);
    expect(serialize(prog, MYD_DEFAULT)).toBe(SAMPLE_PRG);
  });

  it('preserves Mark and Laser raw text', () => {
    const out = serialize(parse(SAMPLE_PRG, MYD_DEFAULT), MYD_DEFAULT);
    expect(out).toContain('Mark:1,(338.551,356.371,46.036)-(181.806,356.551,46.036)Two');
    expect(out).toContain(
      'Laser:3 AT(343.584,181.804,28.474)-(338.622,107.510,28.474)-(365.930,127.038,28.474)',
    );
  });

  it('preserves trailing zeros in coordinates via _raw', () => {
    const out = serialize(parse(SAMPLE_PRG, MYD_DEFAULT), MYD_DEFAULT);
    // 134.030 has a trailing zero that parseFloat would drop
    expect(out).toContain('Line:1,(154.038,134.030,30.689),ValveOff,0.5000 mg/mm');
  });

  it('preserves disabled Line prefix', () => {
    const out = serialize(parse(SAMPLE_PRG, MYD_DEFAULT), MYD_DEFAULT);
    expect(out).toContain('Disable:Line:1,(156.038,248.556,30.689),ValveOn');
    expect(out).toContain('Disable:Line:1,(156.038,134.028,30.689),ValveOff,0.5000 mg/mm');
  });

  it('preserves disabled DO prefix', () => {
    const out = serialize(parse(SAMPLE_PRG, MYD_DEFAULT), MYD_DEFAULT);
    expect(out).toContain(
      'Disable:DO:METAPOR - STANDARD AT(338.348,356.491,46.036)Single A',
    );
  });

  it('preserves Arc/ArcMid lines verbatim', () => {
    const out = serialize(parse(SAMPLE_PRG, MYD_DEFAULT), MYD_DEFAULT);
    expect(out).toContain('Arc:2,(341.945,128.064,28.622),ValveOn');
    expect(out).toContain('ArcMid:2,(341.369,127.405,29.329),ValveOn');
  });

  it('uses .EndTEMP as the closing token', () => {
    const out = serialize(parse(SAMPLE_PRG, MYD_DEFAULT), MYD_DEFAULT);
    expect(out.trimEnd()).toMatch(/\.EndTEMP$/);
  });

  it('splits LineCommand into ValveOn + ValveOff lines', () => {
    const out = serialize(parse(SAMPLE_PRG, MYD_DEFAULT), MYD_DEFAULT);
    const lines = out.split('\r\n');
    const onIdx = lines.indexOf('Line:1,(154.038,248.558,30.689),ValveOn');
    expect(onIdx).toBeGreaterThan(-1);
    expect(lines[onIdx + 1]).toBe('Line:1,(154.038,134.030,30.689),ValveOff,0.5000 mg/mm');
  });
});

// ── LineFix commands ──────────────────────────────────────────────────────────

const MINIMAL_HEADER = crlf([
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

describe('LineFix commands', () => {
  const LINEFIX_PRG = crlf([
    ...MINIMAL_HEADER.split('\r\n'),
    '.PattList',
    '.Patt:lf',
    'LineFix:2,(281.736,387.720,46.379),ValveOn',
    'LineFix:2,(280.874,388.267,47.082),ValveOff,0.500 mg/mm',
    '.End',
    '.EndTEMP',
  ]);

  it('parses a LineFix pair as LineCommand with commandKeyword="LineFix"', () => {
    const prog = parse(LINEFIX_PRG, MYD_DEFAULT);
    const cmds = prog.patterns[0].commands;
    expect(cmds).toHaveLength(1);
    const cmd = cmds[0] as LineCommand;
    expect(cmd.kind).toBe('Line');
    expect(cmd.commandKeyword).toBe('LineFix');
    expect(cmd.valve).toBe(2);
    expect(cmd.startPoint).toEqual([281.736, 387.72, 46.379]);
    expect(cmd.endPoint).toEqual([280.874, 388.267, 47.082]);
    expect(cmd.flowRate).toEqual({ value: 0.5, unit: 'mg/mm' });
    expect(cmd._raw?.startPoint).toBe('(281.736,387.720,46.379)');
    expect(cmd._raw?.flowRate).toBe('0.500 mg/mm');
  });

  it('round-trips LineFix exactly (preserves "LineFix" keyword)', () => {
    expect(serialize(parse(LINEFIX_PRG, MYD_DEFAULT), MYD_DEFAULT)).toBe(LINEFIX_PRG);
  });

  it('does NOT pair a LineFix ValveOn with a Line ValveOff (stores both verbatim)', () => {
    const mixed = crlf([
      ...MINIMAL_HEADER.split('\r\n'),
      '.PattList',
      '.Patt:mixed',
      'LineFix:1,(1.000,2.000,3.000),ValveOn',
      'Line:1,(1.000,1.000,3.000),ValveOff,0.500 mg/mm',
      '.End',
      '.EndTEMP',
    ]);
    const prog = parse(mixed, MYD_DEFAULT);
    const cmds = prog.patterns[0].commands;
    // Both stored as Raw since keywords differ
    expect(cmds).toHaveLength(2);
    expect(cmds[0].kind).toBe('Raw');
    expect(cmds[1].kind).toBe('Raw');
  });

  it('normal Line commands still get commandKeyword="Line"', () => {
    const prog = parse(SAMPLE_PRG, MYD_DEFAULT);
    const t4 = prog.patterns.find((p) => p.name === 't4')!;
    const lines = t4.commands.filter((c): c is LineCommand => c.kind === 'Line');
    for (const l of lines) {
      expect(l.commandKeyword).toBe('Line');
    }
  });
});

// ── Group / ENDGROUP ──────────────────────────────────────────────────────────

describe('Group/ENDGROUP parsing', () => {
  const GROUP_PRG = crlf([
    ...MINIMAL_HEADER.split('\r\n'),
    '.PattList',
    '.Patt:grouped',
    'Comment:##GROUP:MyGroup',
    'Line:1,(100.000,200.000,30.000),ValveOn',
    'Line:1,(100.000,100.000,30.000),ValveOff,0.500 mg/mm',
    'Dot:2,(150.000,150.000,30.000),ValveOn',
    'Comment:##ENDGROUP:MyGroup',
    '.End',
    '.EndTEMP',
  ]);

  it('wraps enclosed commands in a GroupNode', () => {
    const prog = parse(GROUP_PRG, MYD_DEFAULT);
    const cmds = prog.patterns[0].commands;
    expect(cmds).toHaveLength(1);
    const grp = cmds[0] as GroupNode;
    expect(grp.kind).toBe('Group');
    expect(grp.name).toBe('MyGroup');
    expect(grp.collapsed).toBe(false);
  });

  it('parses the correct children inside the group', () => {
    const prog = parse(GROUP_PRG, MYD_DEFAULT);
    const grp = prog.patterns[0].commands[0] as GroupNode;
    expect(grp.commands).toHaveLength(2);
    expect(grp.commands[0].kind).toBe('Line');
    expect(grp.commands[1].kind).toBe('Dot');
  });

  it('round-trips GROUP/ENDGROUP exactly', () => {
    expect(serialize(parse(GROUP_PRG, MYD_DEFAULT), MYD_DEFAULT)).toBe(GROUP_PRG);
  });

  it('handles multiple groups in the same pattern', () => {
    const src = crlf([
      ...MINIMAL_HEADER.split('\r\n'),
      '.PattList',
      '.Patt:multi',
      'Comment:##GROUP:Alpha',
      'Dot:1,(1.000,1.000,1.000),ValveOn',
      'Comment:##ENDGROUP:Alpha',
      'Comment:##GROUP:Beta',
      'Dot:2,(2.000,2.000,2.000),ValveOn',
      'Comment:##ENDGROUP:Beta',
      '.End',
      '.EndTEMP',
    ]);
    const prog = parse(src, MYD_DEFAULT);
    const cmds = prog.patterns[0].commands;
    expect(cmds).toHaveLength(2);
    expect((cmds[0] as GroupNode).name).toBe('Alpha');
    expect((cmds[1] as GroupNode).name).toBe('Beta');
    expect(serialize(prog, MYD_DEFAULT)).toBe(src);
  });

  it('commands outside groups are still parsed normally', () => {
    const src = crlf([
      ...MINIMAL_HEADER.split('\r\n'),
      '.PattList',
      '.Patt:mixed',
      'Dot:1,(1.000,1.000,1.000),ValveOn',
      'Comment:##GROUP:G',
      'Dot:2,(2.000,2.000,2.000),ValveOn',
      'Comment:##ENDGROUP:G',
      'Dot:3,(3.000,3.000,3.000),ValveOn',
      '.End',
      '.EndTEMP',
    ]);
    const prog = parse(src, MYD_DEFAULT);
    const cmds = prog.patterns[0].commands;
    expect(cmds).toHaveLength(3);
    expect(cmds[0].kind).toBe('Dot');
    expect(cmds[1].kind).toBe('Group');
    expect(cmds[2].kind).toBe('Dot');
    expect(serialize(prog, MYD_DEFAULT)).toBe(src);
  });
});

// ── GROUP without matching ENDGROUP (defensive fallback) ─────────────────────

describe('GROUP without matching ENDGROUP', () => {
  const UNMATCHED_PRG = crlf([
    ...MINIMAL_HEADER.split('\r\n'),
    '.PattList',
    '.Patt:unmatched',
    'Comment:##GROUP:Orphan',
    'Line:1,(100.000,200.000,30.000),ValveOn',
    'Line:1,(100.000,100.000,30.000),ValveOff,0.500 mg/mm',
    '.End',
    '.EndTEMP',
  ]);

  it('treats the unmatched GROUP marker as a regular Comment', () => {
    const prog = parse(UNMATCHED_PRG, MYD_DEFAULT);
    const cmds = prog.patterns[0].commands;
    expect(cmds[0].kind).toBe('Comment');
    expect((cmds[0] as CommentCommand).text).toBe('##GROUP:Orphan');
  });

  it('still parses the remaining commands after the unmatched GROUP', () => {
    const prog = parse(UNMATCHED_PRG, MYD_DEFAULT);
    const cmds = prog.patterns[0].commands;
    // Comment:##GROUP:Orphan + Line pair = 2 commands
    expect(cmds).toHaveLength(2);
    expect(cmds[1].kind).toBe('Line');
  });

  it('ENDGROUP without GROUP is treated as a regular Comment', () => {
    const src = crlf([
      ...MINIMAL_HEADER.split('\r\n'),
      '.PattList',
      '.Patt:orphan_end',
      'Comment:##ENDGROUP:NoStart',
      'Dot:1,(1.000,1.000,1.000),ValveOn',
      '.End',
      '.EndTEMP',
    ]);
    const prog = parse(src, MYD_DEFAULT);
    const cmds = prog.patterns[0].commands;
    expect(cmds[0].kind).toBe('Comment');
    expect((cmds[0] as CommentCommand).text).toBe('##ENDGROUP:NoStart');
    expect(cmds[1].kind).toBe('Dot');
  });
});

// ── Nested groups ─────────────────────────────────────────────────────────────

describe('Nested groups', () => {
  it('parses two levels of nesting', () => {
    const src = crlf([
      ...MINIMAL_HEADER.split('\r\n'),
      '.PattList',
      '.Patt:nested',
      'Comment:##GROUP:Outer',
      'Dot:1,(1.000,1.000,1.000),ValveOn',
      'Comment:##GROUP:Inner',
      'Dot:2,(2.000,2.000,2.000),ValveOn',
      'Comment:##ENDGROUP:Inner',
      'Dot:3,(3.000,3.000,3.000),ValveOn',
      'Comment:##ENDGROUP:Outer',
      '.End',
      '.EndTEMP',
    ]);
    const prog = parse(src, MYD_DEFAULT);
    const cmds = prog.patterns[0].commands;
    expect(cmds).toHaveLength(1);
    const outer = cmds[0] as GroupNode;
    expect(outer.kind).toBe('Group');
    expect(outer.name).toBe('Outer');
    expect(outer.commands).toHaveLength(3); // Dot + Inner group + Dot
    const inner = outer.commands[1] as GroupNode;
    expect(inner.kind).toBe('Group');
    expect(inner.name).toBe('Inner');
    expect(inner.commands).toHaveLength(1);
    expect(inner.commands[0].kind).toBe('Dot');
  });

  it('round-trips two levels of nesting exactly', () => {
    const src = crlf([
      ...MINIMAL_HEADER.split('\r\n'),
      '.PattList',
      '.Patt:nested',
      'Comment:##GROUP:Outer',
      'Dot:1,(1.000,1.000,1.000),ValveOn',
      'Comment:##GROUP:Inner',
      'Dot:2,(2.000,2.000,2.000),ValveOn',
      'Comment:##ENDGROUP:Inner',
      'Dot:3,(3.000,3.000,3.000),ValveOn',
      'Comment:##ENDGROUP:Outer',
      '.End',
      '.EndTEMP',
    ]);
    expect(serialize(parse(src, MYD_DEFAULT), MYD_DEFAULT)).toBe(src);
  });

  it('unclosed outer group flattens to root; mismatched ENDGROUP closes innermost', () => {
    // ##ENDGROUP:Outer arrives but innermost open group is "Inner" — parser
    // closes "Inner" (innermost rule, name is ignored).  "Outer" then has no
    // matching ENDGROUP so at EOF it is flushed: the ##GROUP:Outer marker
    // becomes a plain Comment and Inner's GroupNode is emitted to root.
    const src = crlf([
      ...MINIMAL_HEADER.split('\r\n'),
      '.PattList',
      '.Patt:unclosed',
      'Comment:##GROUP:Outer',
      'Comment:##GROUP:Inner',
      'Dot:1,(1.000,1.000,1.000),ValveOn',
      'Comment:##ENDGROUP:Outer',
      '.End',
      '.EndTEMP',
    ]);
    const prog = parse(src, MYD_DEFAULT);
    const cmds = prog.patterns[0].commands;
    // root = [Comment:##GROUP:Outer, GroupNode(Inner)]
    expect(cmds).toHaveLength(2);
    expect(cmds[0].kind).toBe('Comment');
    expect((cmds[0] as CommentCommand).text).toBe('##GROUP:Outer');
    const inner = cmds[1] as GroupNode;
    expect(inner.kind).toBe('Group');
    expect(inner.name).toBe('Inner');
    expect(inner.commands).toHaveLength(1);
    expect(inner.commands[0].kind).toBe('Dot');
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('round-trips a program with an empty .PattList', () => {
    const src = crlf([
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
      '.PattList',
      '.EndTEMP',
    ]);
    const prog = parse(src, MYD_DEFAULT);
    expect(prog.patterns).toHaveLength(0);
    expect(serialize(prog, MYD_DEFAULT)).toBe(src);
  });

  it('round-trips a pattern with only comments', () => {
    const src = crlf([
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
      '.PattList',
      '.Patt:comments_only',
      'Comment:first',
      'Comment:second',
      '.End',
      '.EndTEMP',
    ]);
    const prog = parse(src, MYD_DEFAULT);
    expect(prog.patterns[0].commands).toHaveLength(2);
    expect(serialize(prog, MYD_DEFAULT)).toBe(src);
  });

  it('handles LF-only line endings during parsing', () => {
    const lfSrc = MINIMAL_PRG.replace(/\r\n/g, '\n');
    const prog = parse(lfSrc, MYD_DEFAULT);
    expect(prog.main.stations).toHaveLength(4);
    // Serializer always emits CRLF per MYD_DEFAULT profile
    expect(serialize(prog, MYD_DEFAULT)).toContain('\r\n');
  });

  it('throws on missing .Main/.EndMain', () => {
    expect(() => parse('.PattList\r\n.EndTEMP', MYD_DEFAULT)).toThrow(
      'Missing .Main/.EndMain block',
    );
  });

  it('throws on missing .PattList', () => {
    expect(() => parse('.Main\r\n.EndMain', MYD_DEFAULT)).toThrow(
      'Missing .PattList block',
    );
  });

  it('preserves the orphaned ValveOn line verbatim through round-trip', () => {
    const src = crlf([
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
      '.PattList',
      '.Patt:orphan',
      'Line:2,(344.360,128.049,28.626),ValveOn',
      'Line:2,(343.783,127.350,29.328),ValveOn',
      'Line:2,(343.187,127.800,29.328),ValveOff,0.500 mg/mm',
      '.End',
      '.EndTEMP',
    ]);
    expect(serialize(parse(src, MYD_DEFAULT), MYD_DEFAULT)).toBe(src);
  });

  it('preserves a disabled DO command through round-trip', () => {
    const src = crlf([
      '.Main',
      'Station A:',
      'Disable:DO:MY PATTERN AT(1.000,2.000,3.000)Single A',
      'EndStation A',
      'Station B:',
      'EndStation B',
      'Station C:',
      'EndStation C',
      'Station D:',
      'EndStation D',
      '.EndMain',
      '.PattList',
      '.EndTEMP',
    ]);
    expect(serialize(parse(src, MYD_DEFAULT), MYD_DEFAULT)).toBe(src);
  });
});
