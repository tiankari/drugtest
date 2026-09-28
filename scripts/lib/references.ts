// The registered card references in profiles/, as the app bundles them.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MatReference } from '../../src/pipeline/reference.ts';

export function loadReferences(dir = 'profiles'): Record<string, MatReference> {
  const refs: Record<string, MatReference> = {};
  for (const f of readdirSync(dir)) {
    const m = /^mat_reference_(\d+)_([A-N])\.json$/.exec(f);
    if (m) refs[m[2]] = JSON.parse(readFileSync(join(dir, f), 'utf8')) as MatReference;
  }
  return refs;
}
