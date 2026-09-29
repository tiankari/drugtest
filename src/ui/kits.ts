// Kit profiles bundled at build time from profiles/kit_*.json, validated on
// load. A profile that fails validation is an error shown on screen, never
// silently skipped. Only the newest version of each kit is offered; older
// versions are kept in profiles/ for the records made with them.

import { latestVersions, parseKitProfile, type KitProfile } from '../pipeline/kit.ts';
import { canonicalBytes } from '../records/canonical.ts';
import { sha256HexOf } from '../records/webcrypto.ts';

const modules = import.meta.glob<{ default: unknown }>('../../profiles/kit_*.json', { eager: true });

/** The kit a new phone starts with, and the first in the kit picker. */
export const DEFAULT_KIT_ID = 'marquis-opiates';

export const KITS: KitProfile[] = latestVersions(Object.values(modules).map((m) => parseKitProfile(m.default))).sort(
  (a, b) => Number(b.id === DEFAULT_KIT_ID) - Number(a.id === DEFAULT_KIT_ID) || a.id.localeCompare(b.id),
);

/** The kit chosen on the camera screen, or the default one. */
export function selectedKit(kitId: string): KitProfile {
  if (!KITS.length) throw new Error('No kit profile is bundled in this build');
  return KITS.find((k) => k.id === kitId) ?? KITS[0];
}

/** SHA-256 of the canonical JSON of a profile or card reference (what a record cites). */
export function canonicalSha256(value: unknown): Promise<string> {
  return sha256HexOf(canonicalBytes(value));
}
