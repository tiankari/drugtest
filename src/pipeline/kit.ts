// Kit profiles (schema fdtc.kit.v1) and the classification rule.
//
// A profile lists, for each coloured outcome (POSITIVE, or NEGATIVE for kits
// whose negative has its own colour), target colours in CIELAB (D65) with a
// radius in CIEDE2000. The decision is deterministic:
//
//   - sample RETAKE (or card RETAKE)   -> never classified;
//   - no coloured region               -> the profile's noColourResult;
//   - otherwise, for each outcome, d = ΔE00(sample, each target). Exactly one
//     outcome with a target within its radius -> that outcome, naming the
//     nearest such target. None, or more than one -> INCONCLUSIVE with a plain
//     reason.
//
// Nothing here knows about any particular kit; profiles are data.

import { ciede2000 } from './ciede2000.ts';
import type { Vec3 } from './colour.ts';

export const KIT_SCHEMA = 'fdtc.kit.v1';
export type KitValidation = 'published-reference-only' | 'validated-on-real-photos';
export type ColouredOutcome = 'POSITIVE' | 'NEGATIVE';
export type KitVerdict = 'POSITIVE' | 'NEGATIVE' | 'INCONCLUSIVE';

export interface KitTarget {
  id: string;
  label: string;
  /** Source colour notation, e.g. Munsell "7.5RP 3/10". */
  notation: string;
  /** Colour name given by the source (e.g. ISCC-NIST). */
  sourceName: string;
  /** The source line this target was read from. */
  sourceRow: string;
  lab: Vec3;
  /** CIEDE2000 radius. */
  radius: number;
  radiusDerivation: {
    rule: string;
    chipTerm: number;
    chips: { notation: string; deltaE00: number }[];
    correctionErrorTerm: number;
  };
}

export interface KitOutcome {
  verdict: ColouredOutcome;
  label: string;
  targets: KitTarget[];
}

export interface KitNonTarget {
  analyte: string;
  sourceRow: string;
  notation: string | null;
  lab: Vec3 | null;
  /** Why it could not be converted (no notation, not an exact table entry). */
  note: string | null;
  nearestTarget: string | null;
  deltaE00: number | null;
  /** Inside some POSITIVE target radius: a known false positive of the reagent. */
  insidePositiveRadius: boolean;
}

export interface KitProfile {
  schema: typeof KIT_SCHEMA;
  id: string;
  version: number;
  name: string;
  reagent: string;
  detects: string[];
  validation: KitValidation;
  /** Shown on every screen, record and doc that uses the profile. */
  validationLine: string;
  source: { document: string; table: string; rows: string[]; url: string; pdfSha256: string; excerpt: string };
  colourConversion: { [k: string]: unknown };
  outcomes: KitOutcome[];
  noColourResult: 'NEGATIVE' | 'RETAKE';
  noColourNote: string;
  /** INCONCLUSIVE reason when the colour matches no outcome. */
  noMatchReason: string;
  readingTime: { finalColourMinutes: [number, number]; source: string };
  sampleReading: { [k: string]: unknown };
  knownNonTargetReactions: KitNonTarget[];
  provenance: { script: string; commit: string; generatedAt: string; correctionErrorPhotos: { file: string; looMean: number }[]; [k: string]: unknown };
  status: string;
}

export class KitProfileError extends Error {
  override name = 'KitProfileError';
}

function need(cond: unknown, what: string): void {
  if (!cond) throw new KitProfileError(`Kit profile rejected: ${what}`);
}

const isLab = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Validate a parsed profile. Throws KitProfileError on an unknown schema or a missing / malformed field. */
export function parseKitProfile(json: unknown): KitProfile {
  need(json && typeof json === 'object' && !Array.isArray(json), 'not an object');
  const p = json as Record<string, unknown>;
  need(p.schema === KIT_SCHEMA, `unknown schema ${JSON.stringify(p.schema)} (expected ${KIT_SCHEMA})`);
  for (const k of ['id', 'name', 'reagent', 'validationLine', 'noColourNote', 'noMatchReason', 'status'] as const) need(isStr(p[k]), `missing ${k}`);
  need(Number.isInteger(p.version) && (p.version as number) >= 1, 'missing version');
  need(p.validation === 'published-reference-only' || p.validation === 'validated-on-real-photos', 'validation must be published-reference-only or validated-on-real-photos');
  need(Array.isArray(p.detects) && p.detects.length > 0 && p.detects.every(isStr), 'missing detects');
  need(p.noColourResult === 'NEGATIVE' || p.noColourResult === 'RETAKE', 'noColourResult must be NEGATIVE or RETAKE');
  const src = p.source as Record<string, unknown> | undefined;
  need(src && isStr(src.document) && isStr(src.url) && Array.isArray(src.rows), 'missing source');
  const rt = p.readingTime as Record<string, unknown> | undefined;
  need(rt && Array.isArray(rt.finalColourMinutes) && rt.finalColourMinutes.length === 2, 'missing readingTime');
  need(p.provenance && typeof p.provenance === 'object', 'missing provenance');
  need(Array.isArray(p.knownNonTargetReactions), 'missing knownNonTargetReactions');
  need(Array.isArray(p.outcomes) && p.outcomes.length > 0, 'missing outcomes');
  const ids = new Set<string>();
  for (const o of p.outcomes as Record<string, unknown>[]) {
    need(o.verdict === 'POSITIVE' || o.verdict === 'NEGATIVE', `outcome verdict must be POSITIVE or NEGATIVE (got ${JSON.stringify(o.verdict)})`);
    need(isStr(o.label), 'outcome missing label');
    need(Array.isArray(o.targets) && o.targets.length > 0, `outcome ${String(o.verdict)} has no targets`);
    for (const t of o.targets as Record<string, unknown>[]) {
      need(isStr(t.id) && !ids.has(t.id as string), `target id missing or repeated (${String(t.id)})`);
      ids.add(t.id as string);
      need(isStr(t.label) && isStr(t.notation), `target ${String(t.id)} missing label or notation`);
      need(isLab(t.lab), `target ${String(t.id)} missing lab`);
      need(typeof t.radius === 'number' && t.radius > 0 && Number.isFinite(t.radius), `target ${String(t.id)} missing radius`);
      need(t.radiusDerivation && typeof t.radiusDerivation === 'object', `target ${String(t.id)} missing radiusDerivation`);
    }
  }
  const verdicts = (p.outcomes as { verdict: string }[]).map((o) => o.verdict);
  need(new Set(verdicts).size === verdicts.length, 'an outcome is listed twice');
  return json as KitProfile;
}

export interface TargetDistance {
  outcome: ColouredOutcome;
  targetId: string;
  label: string;
  notation: string;
  deltaE00: number;
  radius: number;
  inside: boolean;
}

export interface Classification {
  verdict: KitVerdict | 'RETAKE';
  reason: string;
  /** false when the sample (or card) stage was RETAKE: never classified. */
  classified: boolean;
  nearest: TargetDistance | null;
  distances: TargetDistance[];
}

export interface SampleForClassification {
  status: 'found' | 'none' | 'retake';
  reason: string;
  correctedLab?: Vec3;
}

export function classify(profile: KitProfile, sample: SampleForClassification): Classification {
  if (sample.status === 'retake') return { verdict: 'RETAKE', reason: sample.reason, classified: false, nearest: null, distances: [] };
  if (sample.status === 'none') {
    return profile.noColourResult === 'NEGATIVE'
      ? { verdict: 'NEGATIVE', reason: 'No colour developed in the sample zone. The app cannot tell this from an empty zone; the photo shows which it was.', classified: true, nearest: null, distances: [] }
      : { verdict: 'RETAKE', reason: 'No coloured region — this kit’s negative has its own colour; put the test in the sample zone', classified: false, nearest: null, distances: [] };
  }
  const lab = sample.correctedLab;
  if (!lab || !lab.every(Number.isFinite)) return { verdict: 'RETAKE', reason: 'Sample colour could not be measured', classified: false, nearest: null, distances: [] };
  const distances: TargetDistance[] = [];
  for (const o of profile.outcomes)
    for (const t of o.targets) {
      const d = ciede2000(lab, t.lab);
      distances.push({ outcome: o.verdict, targetId: t.id, label: t.label, notation: t.notation, deltaE00: d, radius: t.radius, inside: d <= t.radius });
    }
  const byDistance = [...distances].sort((a, b) => a.deltaE00 - b.deltaE00 || a.targetId.localeCompare(b.targetId));
  const matched = [...new Set(distances.filter((d) => d.inside).map((d) => d.outcome))];
  if (matched.length === 1) {
    const nearest = byDistance.find((d) => d.inside && d.outcome === matched[0])!;
    return {
      verdict: matched[0],
      reason: `Colour matches ${nearest.label} (${nearest.notation}): ΔE00 ${nearest.deltaE00.toFixed(1)}, within ${nearest.radius.toFixed(1)}`,
      classified: true,
      nearest,
      distances,
    };
  }
  if (matched.length === 0) {
    const n = byDistance[0];
    return { verdict: 'INCONCLUSIVE', reason: `${profile.noMatchReason} (nearest: ${n.label}, ΔE00 ${n.deltaE00.toFixed(1)}, radius ${n.radius.toFixed(1)})`, classified: true, nearest: n, distances };
  }
  return {
    verdict: 'INCONCLUSIVE',
    reason: `Colour is within range of more than one outcome (${matched.join(' and ')})`,
    classified: true,
    nearest: byDistance[0],
    distances,
  };
}
