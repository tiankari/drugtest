// Assemble a record draft (everything except seq / prevHash, which the log
// adds) from one capture's analysis, sample reading and classification.
// Pure: no DOM, no clock, no randomness; the caller passes those in.

import type { MatAnalysis } from '../pipeline/analyse.ts';
import type { Classification, KitProfile } from '../pipeline/kit.ts';
import type { SampleReading } from '../pipeline/samplezone.ts';
import type { RecordDraft } from './log.ts';
import { RECORD_NOTICE, RECORD_SCHEMA, VERDICTS, type ImageSource, type JsonValue, type RecordLocation, type Verdict } from './record.ts';

export interface RecordInputs {
  recordId: string;
  /** ISO 8601 with offset, device clock at signing. */
  createdAt: string;
  capturedAt: string;
  timezoneOffsetMinutes: number;
  operatorId: string;
  caseRef: string;
  locationNote: string;
  officerConfirmedTestInZone: boolean;
  location: RecordLocation;
  userAgent: string;
  app: { version: string; commit: string };
  image: { sha256: string; pixelSha256: string; width: number; height: number };
  /** Camera photo, or a bundled sample image (labelled as such in the sealed record). */
  source: ImageSource;
  analysis: MatAnalysis;
  sample: SampleReading;
  classification: Classification;
  kit: KitProfile;
  kitSha256: string;
  referenceSha256: string;
}

/** Finite numbers only (canonical JSON refuses NaN / Infinity); anything else becomes null. */
const num = (v: number | undefined | null): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const vec = (v: readonly number[] | undefined): JsonValue => (v ? v.map((x) => num(x)) : null);
const text = (s: string): string | null => (s.trim() ? s.trim() : null);

export function sampleSummary(s: SampleReading): { [k: string]: JsonValue } {
  return {
    status: s.status,
    reason: s.reason,
    areaMm2: num(s.areaMm2),
    pixels: s.pixels,
    spread: num(s.spread),
    clipFraction: num(s.clipFraction),
    touchesEdge: s.touchesEdge,
    regionsMm2: s.regions.map((r) => num(r.areaMm2)),
    threshold: { whiteNoise: num(s.threshold.whiteNoise), factor: num(s.threshold.factor), deltaE: num(s.threshold.deltaE) },
    dropped: { clipped: s.dropped.clipped, dark: s.dropped.dark, trimmed: s.dropped.trimmed },
    observedLab: vec(s.observedLab),
    correctedLab: vec(s.correctedLab),
    method: s.method ?? null,
  };
}

export function buildRecordDraft(i: RecordInputs): RecordDraft {
  const a = i.analysis;
  const c = i.classification;
  if (a.verdict !== 'PASS' || !a.correction || !a.copy || a.version === undefined) throw new Error('Record refused: the card stage did not pass (RETAKE is never recorded)');
  if (!c.classified || !VERDICTS.includes(c.verdict as Verdict)) throw new Error(`Record refused: ${c.verdict} is not a classified result`);
  if (!i.operatorId.trim()) throw new Error('Record refused: operator ID is required');
  // The in-zone tick is the officer's statement about a real test; a sample image has no officer test to confirm.
  if (i.kit.noColourResult === 'NEGATIVE' && i.source === 'camera' && !i.officerConfirmedTestInZone) throw new Error('Record refused: confirm that the test is in the sample zone');
  if (i.source !== 'camera' && i.officerConfirmedTestInZone) throw new Error('Record refused: a sample image cannot be confirmed as a test in the zone');
  const td = (d: Classification['distances'][number]): { [k: string]: JsonValue } => ({
    outcome: d.outcome,
    targetId: d.targetId,
    label: d.label,
    notation: d.notation,
    deltaE00: num(d.deltaE00),
    radius: num(d.radius),
    inside: d.inside,
  });
  return {
    schema: RECORD_SCHEMA,
    recordId: i.recordId,
    createdAt: i.createdAt,
    capturedAt: i.capturedAt,
    timezoneOffsetMinutes: i.timezoneOffsetMinutes,
    operator: { id: i.operatorId.trim() },
    caseRef: text(i.caseRef),
    locationNote: text(i.locationNote),
    officerConfirmedTestInZone: i.officerConfirmedTestInZone,
    location: i.location,
    device: { keyId: '', userAgent: i.userAgent },
    app: i.app,
    image: { ...i.image, source: i.source },
    card: { version: a.version, copy: a.copy, referenceSha256: i.referenceSha256 },
    analysis: {
      cardVerdict: 'PASS',
      method: a.correction.used.method,
      looMean: a.correction.used.loo.mean,
      looP90: a.correction.used.loo.p90,
      unevenLight: a.unevenLight?.residual ?? NaN,
      sample: sampleSummary(i.sample),
    },
    kit: { id: i.kit.id, version: i.kit.version, name: i.kit.name, profileSha256: i.kitSha256, validation: i.kit.validation },
    result: { verdict: c.verdict as Verdict, reason: c.reason, nearest: c.nearest ? td(c.nearest) : null, distances: c.distances.map(td) },
    notice: RECORD_NOTICE,
  };
}
