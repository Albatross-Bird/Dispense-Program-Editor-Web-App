import type { Program } from './types';

// ── Profile interface ─────────────────────────────────────────────────────────

export type SoftwareType = 'MYD';

/**
 * Overrides applied during parsing.  Each key corresponds to a parsing
 * behaviour that might differ between software versions.
 */
export interface ParseOverrides {
  /** Token that ends the pattern list block. Default: auto-detect */
  pattListEndToken?: string;
  /** Whether Dot commands can carry ValveOff (true for all known versions) */
  dotAllowsValveOff?: boolean;
  /** Keywords recognized as dispense-line commands. Default: ["Line", "LineFix"] */
  lineKeywords?: string[];
}

/**
 * Overrides applied during serialization.
 */
export interface SerializeOverrides {
  /** Token written to close the pattern list block */
  pattListEndToken?: string;
  /** Line ending to use. Default: '\r\n' */
  lineEnding?: string;
  /**
   * When true, the serializer omits the `.Main` header line and writes the
   * station block starting directly with `Station A:`.
   * Used for MYD V.100.80.70.146R and later formats.
   */
  omitMainHeader?: boolean;
}

export interface SyntaxProfile {
  softwareType: SoftwareType;
  version: string;
  parseOverrides?: ParseOverrides;
  serializeOverrides?: SerializeOverrides;
  /**
   * When true the canvas uses a Y-up coordinate system: x=0,y=0 is the
   * bottom-left corner and positive Y moves upward.
   * When false/absent (default) the canvas uses Y-down (top-left origin).
   */
  yAxisUp?: boolean;

  // ── Fields populated when a profile is loaded from a .prgdef.json file ──

  /** Kebab-case id from the definition file, e.g. "MYD-V100-80-70-146R". */
  definitionId?: string;
  /** Human-readable label from the definition file. */
  definitionDisplayName?: string;
  /** Developer notes from the definition file's `notes` field. */
  notes?: string;
  /** True when this profile was constructed from a .prgdef.json definition. */
  _loadedFromDefinition?: true;
  /** True when the definition's schemaVersion exceeds what this build supports. */
  _newerSchema?: boolean;
  /** True when this profile was loaded from the user data directory, not the built-in resources. */
  _userInstalled?: boolean;
}

// ── Built-in profiles ─────────────────────────────────────────────────────────

/**
 * @deprecated Use the .prgdef.json definition files and loadAllProfiles().
 *  Kept as emergency fallback only. Do not use in new code.
 *
 * MYD V.100.80.70.146R — MYD software format observed in the wild.
 *
 * Structural differences from the MYD V1.200.80.68.02.45 (Tabletop) format:
 *  - No `.Main` header line; station block starts directly with `Station A:`
 *  - Pattern list closes with `.EndPattList` (not `.EndTEMP`)
 *  - A `.Patt:TEMP[…]` … `.End` … `.EndTEMP` working-copy section may follow
 *  - `Arc`/`ArcMid` commands appear as active (not `Disable:`-prefixed)
 *  - `Mark` has no needle-index prefix; `Laser` may have multiple waypoints
 *    (both already handled verbatim by the parser)
 */
export const MYD_V100: SyntaxProfile = {
  softwareType: 'MYD',
  version: '.100.80.70.146R',
  yAxisUp: true,
  serializeOverrides: {
    lineEnding: '\r\n',
    omitMainHeader: true,
    pattListEndToken: '.EndPattList',
  },
};

/**
 * @deprecated Use the .prgdef.json definition files and loadAllProfiles().
 *  Kept as emergency fallback only. Do not use in new code.
 *
 * MYD V1.200.80.68.02.45 (Tabletop) — standard tabletop format with `.Main` header and `.EndTEMP` / `.EndPattList` close token.
 */
export const MYD_TABLETOP: SyntaxProfile = {
  softwareType: 'MYD',
  version: '1.200.80.68.02.45 (Tabletop)',
  parseOverrides: {
    dotAllowsValveOff: true,
  },
  serializeOverrides: {
    lineEnding: '\r\n',
  },
};

/**
 * @deprecated Use the .prgdef.json definition files and loadAllProfiles().
 *  Kept as emergency fallback only. Do not use in new code.
 */
export const PROFILES: SyntaxProfile[] = [MYD_V100, MYD_TABLETOP];

/** Look up a profile by softwareType + version, falling back to MYD_V100. */
export function getProfile(softwareType: SoftwareType, version: string): SyntaxProfile {
  return PROFILES.find((p) => p.softwareType === softwareType && p.version === version) ?? MYD_V100;
}

/** Human-readable display name for a profile, e.g. "MYD V1.0". */
export function profileLabel(p: SyntaxProfile): string {
  return `${p.softwareType} V${p.version}`;
}

/**
 * Resolve the effective pattListEndToken for serialization.
 * Priority: serializeOverrides > program.pattListEndToken > fallback.
 */
export function resolvePattListEndToken(
  program: Program,
  profile: SyntaxProfile,
): string {
  return (
    profile.serializeOverrides?.pattListEndToken ??
    program.pattListEndToken ??
    '.EndTEMP'
  );
}
