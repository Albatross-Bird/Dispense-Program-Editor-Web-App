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
    lineEnding: '\r\n',
  },
};

/** MYC V1.0 — same parser/serializer logic as MYD for now. */
export const MYC_V1: SyntaxProfile = {
  softwareType: 'MYC',
  version: '1.0',
  parseOverrides: {
    dotAllowsValveOff: true,
  },
  serializeOverrides: {
    lineEnding: '\r\n',
  },
};

/** MYT V1.0 — same parser/serializer logic as MYD for now. */
export const MYT_V1: SyntaxProfile = {
  softwareType: 'MYT',
  version: '1.0',
  parseOverrides: {
    dotAllowsValveOff: true,
  },
  serializeOverrides: {
    lineEnding: '\r\n',
  },
};

/** All registered profiles in display order. */
export const PROFILES: SyntaxProfile[] = [MYD_DEFAULT, MYC_V1, MYT_V1];

/** Look up a profile by softwareType + version, falling back to MYD_DEFAULT. */
export function getProfile(softwareType: SoftwareType, version: string): SyntaxProfile {
  return PROFILES.find((p) => p.softwareType === softwareType && p.version === version) ?? MYD_DEFAULT;
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
