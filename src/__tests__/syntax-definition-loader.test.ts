import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { validateDefinition } from '@lib/syntax-profile-loader';
import { definitionToProfile } from '@lib/syntax-profile-loader';

const PROFILES_DIR = resolve(__dirname, '../../resources/syntax-profiles');

function loadDef(filename: string) {
  const raw = JSON.parse(readFileSync(resolve(PROFILES_DIR, filename), 'utf-8'));
  return validateDefinition(raw);
}

// ── Test 1: validateDefinition rejects bad input ──────────────────────────────

describe('validateDefinition', () => {
  it('throws on null', () => {
    expect(() => validateDefinition(null)).toThrow();
  });

  it('throws on empty object, mentioning schemaVersion', () => {
    expect(() => validateDefinition({})).toThrow(/schemaVersion/);
  });

  it('passes when all required fields are present', () => {
    expect(() =>
      validateDefinition({
        schemaVersion: '1',
        id: 'test-id',
        displayName: 'Test',
        softwareFamily: 'MYD',
        version: '1.0',
      }),
    ).not.toThrow();
  });
});

// ── Test 2: MYD_V100 definition produces correct SyntaxProfile ────────────────

describe('definitionToProfile — MYD-V100-80-70-146R', () => {
  it('maps all fields correctly', () => {
    const def = loadDef('MYD-V100-80-70-146R.prgdef.json');
    const profile = definitionToProfile(def);

    expect(profile.yAxisUp).toBe(true);
    expect(profile.serializeOverrides?.omitMainHeader).toBe(true);
    expect(profile.serializeOverrides?.pattListEndToken).toBe('.EndPattList');
    expect(profile.serializeOverrides?.lineEnding).toBe('\r\n');
    expect(profile._loadedFromDefinition).toBe(true);
    expect(profile._newerSchema).toBe(false);
  });
});

// ── Test 3: MYD_TABLETOP definition produces correct SyntaxProfile ────────────

describe('definitionToProfile — MYD-TABLETOP-1200-80-68', () => {
  it('maps all fields correctly', () => {
    const def = loadDef('MYD-TABLETOP-1200-80-68.prgdef.json');
    const profile = definitionToProfile(def);

    expect(profile.yAxisUp).toBe(false);
    expect(profile.serializeOverrides?.omitMainHeader == null || profile.serializeOverrides.omitMainHeader === false).toBe(true);
    expect(profile.serializeOverrides?.pattListEndToken).toBe('.EndTEMP');
  });
});

// ── Test 4: newer schemaVersion logs a warning but does not throw ─────────────

describe('definitionToProfile — newer schemaVersion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warns and returns a profile with _newerSchema true', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const def = validateDefinition({
      schemaVersion: '99',
      id: 'future-id',
      displayName: 'Future',
      softwareFamily: 'MYD',
      version: '99.0',
    });

    let profile: ReturnType<typeof definitionToProfile> | undefined;
    expect(() => {
      profile = definitionToProfile(def);
    }).not.toThrow();

    expect(warnSpy).toHaveBeenCalled();
    expect(profile!._newerSchema).toBe(true);
  });
});

// ── Test 5: unknown fields are silently ignored ───────────────────────────────

describe('validateDefinition + definitionToProfile — unknown fields', () => {
  it('does not throw when extra fields are present', () => {
    const raw = {
      schemaVersion: '1',
      id: 'extra-fields',
      displayName: 'Extra',
      softwareFamily: 'MYD',
      version: '1.0',
      futureField: 'somevalue',
    };

    let def: ReturnType<typeof validateDefinition> | undefined;
    expect(() => {
      def = validateDefinition(raw);
    }).not.toThrow();

    expect(() => {
      definitionToProfile(def!);
    }).not.toThrow();
  });
});
