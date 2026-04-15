// ── Coordinate ────────────────────────────────────────────────────────────────

/** Numeric representation of a 3-D point — use for logic, display, math. */
export type Point3D = [x: number, y: number, z: number];

export interface FlowRate {
  value: number;
  unit: string; // e.g. "mg/mm"
}

// ── Main block ────────────────────────────────────────────────────────────────

export type StationId = 'A' | 'B' | 'C' | 'D';

export interface DOCommand {
  kind: 'DO';
  disabled: boolean;
  patternRef: string;
  /** Full AT(...) coordinate string, parsed verbatim */
  coordinates: {
    start: Point3D;
    end?: Point3D;
  };
  /** Station suffix, e.g. "Single A" */
  station: string;
  /**
   * The raw AT clause text starting from "AT(" — preserved verbatim so that
   * the serializer can write it back exactly, avoiding float-formatting drift.
   */
  rawAt: string;
}

export interface CommentCommand {
  kind: 'Comment';
  /** Runtime-only stable ID, generated during parsing. Never serialized. */
  id?: string;
  text: string;
}

export type StationCommand = DOCommand | CommentCommand;

export interface Station {
  id: StationId;
  commands: StationCommand[];
}

export interface MainBlock {
  stations: Station[];
}

// ── Patterns ──────────────────────────────────────────────────────────────────

/**
 * Internal raw strings for lossless serialization.
 * Parsed floats may lose trailing zeros (e.g. 134.030 → 134.03),
 * so we keep the original text alongside the numeric fields.
 */
export interface LineRaw {
  /** e.g. "(154.038,248.558,30.689)" */
  startPoint: string;
  /** e.g. "(154.038,134.030,30.689)" */
  endPoint: string;
  /** e.g. "0.5000 mg/mm". Absent when ValveOff has no flow rate (rare). */
  flowRate?: string;
}

export interface LineCommand {
  kind: 'Line';
  /** Runtime-only stable ID, generated during parsing. Never serialized. */
  id?: string;
  /**
   * Original keyword from the file. 'LineFix' is mechanically identical to
   * 'Line' but uses a different keyword; stored here so the serializer can
   * reproduce it exactly. Defaults to 'Line' when absent.
   */
  commandKeyword?: 'Line' | 'LineFix';
  disabled: boolean;
  valve: number;
  startPoint: Point3D;
  endPoint: Point3D;
  flowRate: FlowRate;
  /** Raw strings used by the serializer for byte-for-byte fidelity. Absent on programmatically-created commands. */
  _raw?: LineRaw;
}

export interface DotCommand {
  kind: 'Dot';
  /** Runtime-only stable ID, generated during parsing. Never serialized. */
  id?: string;
  disabled: boolean;
  valve: number;
  point: Point3D;
  /** ValveOn or ValveOff as written in the file */
  valveState: 'ValveOn' | 'ValveOff';
  /** Raw coordinate string, e.g. "(159.744,139.454,30.691)". Absent on programmatically-created commands. */
  _rawPoint?: string;
}

export interface MarkCommand {
  kind: 'Mark';
  /** Runtime-only stable ID, generated during parsing. Never serialized. */
  id?: string;
  /** Readonly – written back verbatim */
  raw: string;
}

export interface LaserCommand {
  kind: 'Laser';
  /** Runtime-only stable ID, generated during parsing. Never serialized. */
  id?: string;
  /** Readonly – written back verbatim */
  raw: string;
}

/**
 * Fallback for lines that don't fit any typed command:
 * Arc/ArcMid, orphaned ValveOn lines, ValveOn lines with flow rates, etc.
 * Stored and serialized verbatim for lossless round-tripping.
 */
export interface RawCommand {
  kind: 'Raw';
  /** Runtime-only stable ID, generated during parsing. Never serialized. */
  id?: string;
  raw: string;
}

/**
 * A named group of pattern commands, encoded in the file as:
 *   Comment:##GROUP:<name>
 *   ...commands...
 *   Comment:##ENDGROUP:<name>
 *
 * Groups may be arbitrarily nested.
 */
export interface GroupNode {
  kind: 'Group';
  /** Runtime-only stable ID, generated during parsing. Never serialized. */
  id?: string;
  name: string;
  commands: PatternCommand[];
  collapsed: boolean;
}

export type PatternCommand =
  | LineCommand
  | DotCommand
  | MarkCommand
  | LaserCommand
  | CommentCommand
  | RawCommand
  | GroupNode;

export interface Pattern {
  name: string;
  commands: PatternCommand[];
}

// ── Program (root AST node) ───────────────────────────────────────────────────

export interface Program {
  main: MainBlock;
  patterns: Pattern[];
  /** The token used to close the pattern list (.EndTEMP, .EndPattList, etc.) */
  pattListEndToken: string;
  /**
   * Whether the source file had a `.Main` header line before the station block.
   * False for MYD V.100.80.70.146R files, which start directly with `Station A:`.
   */
  hasMainHeader: boolean;
  /**
   * Raw lines of the `.Patt:TEMP[…]` … `.End` … `.EndTEMP` section that appears
   * after `.EndPattList` in some software versions.  Preserved verbatim so that
   * saving the file back does not silently discard the machine's working copy.
   */
  tempSection?: string[];
}
