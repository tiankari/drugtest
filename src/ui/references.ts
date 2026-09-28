// Registered card references bundled at build time from profiles/.
// A copy that is not registered here can never produce a PASS.

import type { MatReference } from '../pipeline/reference.ts';

const modules = import.meta.glob<{ default: MatReference }>('../../profiles/mat_reference_*.json', { eager: true });

export const REFERENCES: Record<string, MatReference> = Object.fromEntries(Object.values(modules).map((m) => [m.default.copy, m.default]));
