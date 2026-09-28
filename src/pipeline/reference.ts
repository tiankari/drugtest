// Registered reference values for one printed copy of the card.
//
// This is RELATIVE calibration: the reference is what our own registered print
// looked like in good photos, not an absolute colour measurement. Correction
// maps a new photo onto that appearance. Written by scripts/register-mat.ts
// into profiles/.
//
// Each registration shot is first flat-fielded (light gradient removed), then
// normalised per channel so its white patches read 1.0 (paper white). Exposure
// and white-balance drift between shots therefore do not count as
// disagreement: the correction matrix absorbs both anyway. The reference is
// the per-patch median of the normalised shots; the spread is the largest
// CIEDE2000 between any two normalised shots.

import { ciede2000 } from './ciede2000.ts';
import { linearToSrgb, type Vec3 } from './colour.ts';
import { labOfLinear } from './correct.ts';
import { WHITE_IDS } from './flatfield.ts';
import { median } from './linalg.ts';

export const REFERENCE_SCHEMA = 'fdtc.matref.v2';

export interface ReferenceSource {
  file: string;
  sha256: string;
  pixelSha256: string;
  capturedAt: string;
  phone: string;
}

export interface ReferencePatch {
  /** Flat-fielded, white-normalised linear RGB (paper white = 1), median over shots. */
  linear: Vec3;
  lab: Vec3;
  /** For display only. */
  rgb8: Vec3;
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

/** Normalise one shot so its white patches read 1.0 per channel (median over the whites). */
export function normaliseToWhites(flatById: Record<string, Vec3>): Record<string, Vec3> {
  const w = [0, 1, 2].map((c) => median(WHITE_IDS.map((id) => flatById[id][c])));
  return Object.fromEntries(Object.entries(flatById).map(([id, v]) => [id, [v[0] / w[0], v[1] / w[1], v[2] / w[2]] as Vec3]));
}

/** Combine per-shot flat-fielded linear patch values into reference values. */
export function combineRegistration(perPhotoFlat: Record<string, Vec3>[]): { patches: Record<string, ReferencePatch>; maxSpread: number; maxSpreadPatch: string } {
  const perPhoto = perPhotoFlat.map(normaliseToWhites);
  const ids = Object.keys(perPhoto[0]);
  const patches: Record<string, ReferencePatch> = {};
  let maxSpread = 0;
  let maxSpreadPatch = '';
  for (const id of ids) {
    const vals = perPhoto.map((p) => p[id]);
    const linear: Vec3 = [median(vals.map((v) => v[0])), median(vals.map((v) => v[1])), median(vals.map((v) => v[2]))];
    const labs = vals.map((v) => labOfLinear(v));
    let spread = 0;
    for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) spread = Math.max(spread, ciede2000(labs[i], labs[j]));
    const rgb8 = linear.map((c) => Math.round(Math.min(1, Math.max(0, linearToSrgb(c))) * 255)) as unknown as Vec3;
    patches[id] = { linear, lab: labOfLinear(linear), rgb8, spreadDeltaE00: spread };
    if (spread > maxSpread) {
      maxSpread = spread;
      maxSpreadPatch = id;
    }
  }
  return { patches, maxSpread, maxSpreadPatch };
}
