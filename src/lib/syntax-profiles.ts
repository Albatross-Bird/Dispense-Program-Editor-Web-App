import type { Program } from './types';

// ── Profile interface ─────────────────────────────────────────────────────────

export type SoftwareType = 'MYD' | 'MYC' | 'MYT';

/**
 * Overrides applied during parsing.  Each key corresponds to a parsing
 * behaviour that might differ between software versions.
 */
export interface ParseOverrides {
  /** Token that ends the pattern list block. Default: auto-detect */
  pattListEndToken?: string;
  /** Whether Dot commands can carry ValveOff (true for all known versions) */
  dotAllowsValveOff?: boolean;
}

/**
 * Overrides applied during serialization.
 */
export interface SerializeOverrides {
  /** Token written to close the pattern list block */
  pattListEndToken?: string;
  /** Line ending to use. Default: '\r\n' */
  lineEnding?: string;
}

export interface SyntaxProfile {
  softwareType: SoftwareType;
  version: string;
  parseOverrides?: ParseOverrides;
  serializeOverrides?: SerializeOverrides;
}

// ── Built-in profiles ─────────────────────────────────────────────────────────

/**
 * Default profile for the current MYD format as observed in the wild.
 * The pattern list block ends with `.EndTEMP`.
 */
export const MYD_DEFAULT: SyntaxProfile = {
  softwareType: 'MYD',
  version: '1.0',
  parseOverrides: {
    dotAllowsValveOff: true,
  },
  serializeOverrides: {
    // Preserve the unusual .EndTEMP token used by the current MYD software.
    // The serializer falls back to the token stored in Program.pattListEndToken
    // when this override is absent, so most callers do not need to set it.
    lineEnding: '\r\n',
  },
};

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
