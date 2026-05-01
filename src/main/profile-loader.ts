import { join } from 'path';
import { readdirSync, readFileSync, mkdirSync } from 'fs';
import { app } from 'electron';
import { validateDefinition, definitionToProfile } from '../lib/syntax-profile-loader';
import type { SyntaxProfile } from '../lib/syntax-profiles';

export function getUserProfilesDir(): string {
  return join(app.getPath('userData'), 'syntax-profiles');
}

function scanDir(dir: string, userInstalled = false): SyntaxProfile[] {
  const profiles: SyntaxProfile[] = [];
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.prgdef.json'));
  } catch {
    return profiles;
  }
  for (const file of files) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as unknown;
      const def = validateDefinition(raw);
      const profile = definitionToProfile(def);
      profiles.push(userInstalled ? { ...profile, _userInstalled: true } : profile);
    } catch (err) {
      console.error(`[profile-loader] Failed to load "${file}":`, err);
    }
  }
  return profiles;
}

export function loadAllProfiles(): SyntaxProfile[] {
  const builtInDir = join(__dirname, '../../resources/syntax-profiles');
  const userDir = getUserProfilesDir();

  // Ensure user profiles directory exists so customers can drop files into it.
  try {
    mkdirSync(userDir, { recursive: true });
  } catch (err) {
    console.warn('[profile-loader] Could not create user profiles directory:', err);
  }

  // Scan built-in directory.
  let builtInProfiles: SyntaxProfile[] = [];
  try {
    builtInProfiles = scanDir(builtInDir);
  } catch {
    console.warn(`[profile-loader] Built-in profiles directory not found: ${builtInDir}`);
  }
  if (builtInProfiles.length === 0) {
    // readdirSync throws if dir is missing; scanDir swallows and returns [].
    // Emit the warning here so callers know the dir was absent or empty.
    console.warn(`[profile-loader] No built-in profiles loaded from: ${builtInDir}`);
  }

  const userProfiles = scanDir(userDir, true);

  // Merge: user profiles override built-ins sharing the same definitionId.
  const builtInIds = new Set(builtInProfiles.map((p) => p.definitionId));
  const map = new Map<string, SyntaxProfile>();
  for (const p of builtInProfiles) {
    if (p.definitionId) map.set(p.definitionId, p);
  }
  for (const p of userProfiles) {
    if (p.definitionId) map.set(p.definitionId, p);
  }

  const result = Array.from(map.values());

  // Sort: built-in profiles first, user-installed after; alphabetical within each group.
  result.sort((a, b) => {
    const aBuiltIn = builtInIds.has(a.definitionId);
    const bBuiltIn = builtInIds.has(b.definitionId);
    if (aBuiltIn !== bBuiltIn) return aBuiltIn ? -1 : 1;
    return (a.definitionDisplayName ?? '').localeCompare(b.definitionDisplayName ?? '');
  });

  return result;
}
