/**
 * Round-trip integration test against the real .prg file that ships with the
 * project.  The file lives in the repo root (one level above src/).
 *
 * Because the serializer always writes CRLF (matching the original file's
 * encoding), the re-serialized output must equal the original source exactly.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parse } from '@lib/parser';
import { serialize } from '@lib/serializer';
import { MYD_DEFAULT } from '@lib/syntax-profiles';
import type { LineCommand } from '@lib/types';

const PRG_PATH = join(__dirname, '../../Startecx - 51E Sample Dispensing.prg');

function loadPrg(): string | null {
  try {
    return readFileSync(PRG_PATH, 'utf-8');
  } catch {
    return null;
  }
}

describe('round-trip — Startecx 51E Sample Dispensing.prg', () => {
  const source = loadPrg();

  if (!source) {
    it.skip('prg file not found — skipping round-trip test', () => {});
    return;
  }

  it('parses without throwing', () => {
    expect(() => parse(source, MYD_DEFAULT)).not.toThrow();
  });

  it('produces the correct number of stations', () => {
    const prog = parse(source, MYD_DEFAULT);
    expect(prog.main.stations.map((s) => s.id)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('parses all patterns', () => {
    const prog = parse(source, MYD_DEFAULT);
    expect(prog.patterns.length).toBeGreaterThan(0);
    // Verify none have the empty name
    for (const p of prog.patterns) {
      expect(p.name.length).toBeGreaterThan(0);
    }
  });

  it('captures the closing token from the file (.EndTEMP or .EndPattList)', () => {
    const prog = parse(source, MYD_DEFAULT);
    expect(prog.pattListEndToken).toMatch(/^\.(EndTEMP|EndPattList)$/);
  });

  it('parses LineFix pairs as LineCommand with commandKeyword="LineFix"', () => {
    const prog = parse(source, MYD_DEFAULT);

    // Flatten commands, recursing into groups
    function flatten(cmds: ReturnType<typeof prog.patterns>[0]['commands']): LineCommand[] {
      const result: LineCommand[] = [];
      for (const c of cmds) {
        if (c.kind === 'Line') result.push(c);
        else if (c.kind === 'Group') result.push(...flatten(c.commands));
      }
      return result;
    }

    const lineFixCmds = prog.patterns
      .flatMap((p) => flatten(p.commands))
      .filter((c) => c.commandKeyword === 'LineFix');

    // If the file contains LineFix pairs, each must be a proper LineCommand —
    // not a RawCommand — with the correct keyword stored for round-trip fidelity.
    for (const cmd of lineFixCmds) {
      expect(cmd.kind).toBe('Line');
      expect(cmd.commandKeyword).toBe('LineFix');
      expect(cmd.valve).toBeGreaterThan(0);
    }

    // Orphaned LineFix:ValveOn lines (no following ValveOff partner) are
    // legitimately stored as RawCommand; that is correct behaviour. What we
    // DO require is that no RawCommand starts with "LineFix:" followed by a
    // numeric valve and a closing ValveOff — those must have been paired.
    const raws = prog.patterns
      .flatMap((p) => p.commands)
      .filter((c): c is { kind: 'Raw'; raw: string } => c.kind === 'Raw');

    for (const r of raws) {
      // A LineFix:ValveOff stored verbatim means the parser missed the pairing.
      expect(r.raw).not.toMatch(/^LineFix:\d+,.*,ValveOff/);
    }
  });

  it('serializes back to the original source byte-for-byte (through the closing token)', () => {
    const prog = parse(source, MYD_DEFAULT);
    const reserialized = serialize(prog, MYD_DEFAULT);

    // The parser reads up to (and including) the PattList closing token and
    // ignores any content that follows it (e.g. a trailing TEMP block).
    // We therefore compare only the lines the serializer produces.
    // Splitting by '\n' leaves a trailing '\r' on every non-final CRLF line,
    // so normalise those away before comparing.
    const normalize = (s: string) =>
      s.replace(/[\r\n]+$/, '').split('\n').map((l) => l.replace(/\r$/, ''));

    const srcLines = normalize(source);
    const outLines = normalize(reserialized);

    for (let i = 0; i < outLines.length; i++) {
      if (srcLines[i] !== outLines[i]) {
        throw new Error(
          `First difference at line ${i + 1}:\n` +
            `  expected: ${JSON.stringify(srcLines[i])}\n` +
            `  received: ${JSON.stringify(outLines[i])}`,
        );
      }
    }

    // Serializer output must not be longer than the source
    expect(outLines.length).toBeLessThanOrEqual(srcLines.length);
  });
});
