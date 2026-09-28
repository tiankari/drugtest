// Kit profiles bundled at build time from profiles/kit_*.json, validated on
// load. A profile that fails validation is an error shown on screen, never
// silently skipped.

import { parseKitProfile, type KitProfile } from '../pipeline/kit.ts';
import { canonicalBytes } from '../records/canonical.ts';
import { sha256HexOf } from '../records/webcrypto.ts';

const modules = import.meta.glob<{ default: unknown }>('../../profiles/kit_*.json', { eager: true });

export const KITS: KitProfile[] = Object.values(modules)
  .map((m) => parseKitProfile(m.default))
  .sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version);

/** The kit chosen in Settings, or the first bundled one. */
export function selectedKit(kitId: string): KitProfile {
  if (!KITS.length) throw new Error('No kit profile is bundled in this build');
  return KITS.find((k) => k.id === kitId) ?? KITS[0];
}

/** SHA-256 of the canonical JSON of a profile or card reference (what a record cites). */
export function canonicalSha256(value: unknown): Promise<string> {
  return sha256HexOf(canonicalBytes(value));
}
