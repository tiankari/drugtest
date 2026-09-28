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

/** SHA-256 of the canonical JSON of a profile or card reference (what a record cites). */
export function canonicalSha256(value: unknown): Promise<string> {
  return sha256HexOf(canonicalBytes(value));
}
