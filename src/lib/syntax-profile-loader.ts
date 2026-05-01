import { CURRENT_SCHEMA_VERSION, type SyntaxDefinition } from './syntax-definition';
import type { SyntaxProfile, SoftwareType } from './syntax-profiles';

const DEFAULT_LINE_KEYWORDS = ['Line', 'LineFix'];

/**
 * Validates that `raw` conforms to the required fields of SyntaxDefinition.
 * Throws a descriptive Error if any required field is missing or not a non-empty string.
 * Unknown/optional fields are silently accepted for forward compatibility.
 */
export function validateDefinition(raw: unknown): SyntaxDefinition {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Syntax definition must be a non-null object.');
  }

  const obj = raw as Record<string, unknown>;
  const required = ['schemaVersion', 'id', 'displayName', 'softwareFamily', 'version'] as const;

  for (const field of required) {
    if (typeof obj[field] !== 'string' || (obj[field] as string).trim() === '') {
      throw new Error(
        `Syntax definition is missing required field "${field}" (must be a non-empty string).`,
      );
    }
  }

  return raw as SyntaxDefinition;
}

/**
 * Converts a validated SyntaxDefinition into the internal SyntaxProfile used
 * by the parser and serializer. Every optional field falls back to its
 * documented default so the resulting profile reproduces pre-existing behavior.
 *
 * Logs a console.warn (never throws) when def.schemaVersion is newer than
 * CURRENT_SCHEMA_VERSION.
 */
export function definitionToProfile(def: SyntaxDefinition): SyntaxProfile {
  const newerSchema = parseInt(def.schemaVersion, 10) > parseInt(CURRENT_SCHEMA_VERSION, 10);

  if (newerSchema) {
    console.warn(
      `Syntax definition ${def.id} was created for schema version ${def.schemaVersion} but this app supports up to version ${CURRENT_SCHEMA_VERSION}. Some settings may be ignored.`,
    );
  }

  const yAxisUp = def.display?.yAxisUp ?? false;
  const mainHeaderPresent = def.structure?.mainHeaderPresent ?? true;
  const pattListCloseToken = def.structure?.pattListCloseToken ?? '.EndTEMP';
  const lineEndingSetting = def.structure?.lineEnding ?? 'CRLF';
  const lineEnding = lineEndingSetting === 'LF' ? '\n' : '\r\n';
  const dotAllowsValveOff = def.commands?.dot?.allowsValveOff ?? true;
  const lineKeywords = def.commands?.line?.keywords;

  const parseOverrides = {
    dotAllowsValveOff,
    ...(lineKeywords !== undefined &&
    JSON.stringify(lineKeywords) !== JSON.stringify(DEFAULT_LINE_KEYWORDS)
      ? { lineKeywords }
      : {}),
  };

  const serializeOverrides = {
    lineEnding,
    pattListEndToken: pattListCloseToken,
    ...(!mainHeaderPresent ? { omitMainHeader: true as const } : {}),
  };

  const profile: SyntaxProfile = {
    softwareType: def.softwareFamily as SoftwareType,
    version: def.version,
    yAxisUp,
    parseOverrides,
    serializeOverrides,
    definitionId: def.id,
    definitionDisplayName: def.displayName,
    ...(def.notes ? { notes: def.notes } : {}),
    _loadedFromDefinition: true,
    _newerSchema: newerSchema,
  };

  return profile;
}
