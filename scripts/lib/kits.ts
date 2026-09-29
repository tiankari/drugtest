// Kit profiles for Node scripts and tests: every version in profiles/ (the
// verifier re-runs old records with the version they cite), or the newest
// version of one kit (what the app offers for a new test).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestVersions, parseKitProfile, type KitProfile } from '../../src/pipeline/kit.ts';

export function loadKits(dir = 'profiles'): KitProfile[] {
  return readdirSync(dir)
    .filter((f) => /^kit_.*\.json$/.test(f))
    .sort()
    .map((f) => parseKitProfile(JSON.parse(readFileSync(join(dir, f), 'utf8'))));
}

/** The newest version of each kit, as the app bundles them. */
export function currentKits(dir = 'profiles'): KitProfile[] {
  return latestVersions(loadKits(dir)).sort((a, b) => a.id.localeCompare(b.id));
}

export function currentKit(id: string, dir = 'profiles'): KitProfile {
  const k = currentKits(dir).find((p) => p.id === id);
  if (!k) throw new Error(`No kit ${id} in ${dir}/`);
  return k;
}
