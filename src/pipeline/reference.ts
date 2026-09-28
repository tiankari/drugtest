// Registered reference values for one printed copy of the card.
//
// This is RELATIVE calibration: the reference is what our own registered print
// looked like in good photos (median of the registration photos), not an
// absolute colour measurement. Correction maps a new photo onto that
// appearance. Written by scripts/register-mat.ts into profiles/.

import { ciede2000 } from './ciede2000.ts';
import { srgb8ToLinear, type Vec3 } from './colour.ts';
import { labOfLinear } from './correct.ts';
import { median } from './linalg.ts';

export const REFERENCE_SCHEMA = 'fdtc.matref.v1';

export interface ReferenceSource {
  file: string;
  sha256: string;
  pixelSha256: string;
  capturedAt: string;
  phone: string;
}

export interface ReferencePatch {
  /** Median over registration photos of the trimmed-median 8-bit value. */
  rgb8: Vec3;
  linear: Vec3;
  lab: Vec3;
  /** Largest CIEDE2000 between any two registration photos for this patch. */
  spreadDeltaE00: number;
}

export interface MatReference {
  schema: typeof REFERENCE_SCHEMA;
  matVersion: number;
  copy: string;
  createdAt: string;
  phones: string[];
  note: string;
  sources: ReferenceSource[];
  patches: Record<string, ReferencePatch>;
  maxSpreadDeltaE00: number;
  maxSpreadPatch: string;
  pipeline: { commit: string };
}

/** Combine per-photo patch samples (8-bit trimmed medians) into reference values. */
export function combineRegistration(perPhoto: Record<string, Vec3>[]): { patches: Record<string, ReferencePatch>; maxSpread: number; maxSpreadPatch: string } {
  const ids = Object.keys(perPhoto[0]);
  const patches: Record<string, ReferencePatch> = {};
  let maxSpread = 0;
  let maxSpreadPatch = '';
  for (const id of ids) {
    const vals = perPhoto.map((p) => p[id]);
    const rgb8: Vec3 = [median(vals.map((v) => v[0])), median(vals.map((v) => v[1])), median(vals.map((v) => v[2]))];
    const labs = vals.map((v) => labOfLinear(srgb8ToLinear(v)));
    let spread = 0;
    for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) spread = Math.max(spread, ciede2000(labs[i], labs[j]));
    const linear = srgb8ToLinear(rgb8);
    patches[id] = { rgb8, linear, lab: labOfLinear(linear), spreadDeltaE00: spread };
    if (spread > maxSpread) {
      maxSpread = spread;
      maxSpreadPatch = id;
    }
  }
  return { patches, maxSpread, maxSpreadPatch };
}
