// ── Schema version ────────────────────────────────────────────────────────────

/** Highest schemaVersion this build can fully interpret. */
export const CURRENT_SCHEMA_VERSION = '1';

// ── SyntaxDefinition interface ────────────────────────────────────────────────

/**
 * Represents the shape of a .prgdef.json syntax-definition file.
 * Required fields identify the definition; all other fields are optional and
 * fall back to safe defaults that reproduce the pre-existing behavior.
 */
export interface SyntaxDefinition {
  /** (required) Schema version of this file, e.g. "1". Used to detect
   *  definition files created for a newer version of the app. */
  schemaVersion: string;

  /** (required) Unique kebab-case identifier, e.g. "MYD-V100-80-70-146R". */
  id: string;

  /** (required) Human-readable label shown in the profile picker UI. */
  displayName: string;

  /** (required) Software family this definition belongs to, e.g. "MYD". */
  softwareFamily: string;

  /** (required) Version string exactly as it appears in the program file header. */
  version: string;

  /** Free-text description intended for developers; never displayed in the UI. */
  notes?: string;

  /** Visual display settings for the canvas. */
  display?: {
    /**
     * When true the canvas uses a Y-up coordinate system: x=0,y=0 is the
     * bottom-left corner and positive Y moves upward.
     * Default: false (Y-down, top-left origin).
     */
    yAxisUp?: boolean;
  };

  /** Settings that control how the file is parsed and serialized. */
  structure?: {
    /**
     * Whether the file begins with a `.Main` header line before the station
     * block.
     * Default: true. Set to false for formats (e.g. MYD V.100.80.70.146R)
     * that start directly with `Station A:`.
     */
    mainHeaderPresent?: boolean;

    /**
     * Token written after the last `.End` in the pattern list to close the
     * block, e.g. ".EndPattList".
     * Default: ".EndTEMP".
     */
    pattListCloseToken?: string;

    /**
     * Line-ending style written by the serializer.
     * Default: 'CRLF' (Windows-style \r\n).
     */
    lineEnding?: 'CRLF' | 'LF';
  };

  /** Settings that control which command keywords are recognized. */
  commands?: {
    /** Settings for dispense-line commands. */
    line?: {
      /**
       * Keywords that introduce a dispense-line command.
       * Default: ["Line", "LineFix"].
       */
      keywords?: string[];

      /**
       * How ValveOn / ValveOff tokens are paired within a line command.
       * Default: 'ValveOn-ValveOff'.
       */
      pairing?: 'ValveOn-ValveOff';
    };

    /** Settings for dot-dispense commands. */
    dot?: {
      /**
       * Keywords that introduce a dot command.
       * Default: ["Dot"].
       */
      keywords?: string[];

      /**
       * When false, all Dot commands in this format are ValveOn-only; a
       * ValveOff dot is considered malformed.
       * Default: true.
       */
      allowsValveOff?: boolean;
    };

    /** Settings for fiducial-mark commands. */
    fiducial?: {
      /**
       * Keywords that introduce a fiducial command.
       * Default: ["Mark"].
       */
      keywords?: string[];
    };

    /** Settings for laser commands. */
    laser?: {
      /**
       * Keywords that introduce a laser command.
       * Default: ["Laser"].
       */
      keywords?: string[];
    };

    /**
     * Keywords present in files of this version that the editor intentionally
     * does not interpret. Lines beginning with these keywords are stored
     * verbatim as RawCommand and written back unchanged.
     */
    unsupported?: string[];
  };
}
