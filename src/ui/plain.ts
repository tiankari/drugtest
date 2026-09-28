// Plain words for people who are not colour scientists. Only wording lives
// here: every value shown comes from the real pipeline and profiles.

import type { THRESHOLDS } from '../pipeline/config.ts';
import type { Classification } from '../pipeline/kit.ts';

/** Plain name for each threshold (shown first in Developer tools; the technical name goes underneath). */
export const THRESHOLD_NAMES: Record<keyof typeof THRESHOLDS, string> = {
  blurMinLaplacianVariance: 'Blur check — minimum sharpness',
  highlightClipLevel: 'Overexposure — brightness counted as blown out',
  maxHighlightClipFraction: 'Overexposure — share of the frame allowed to be blown out',
  shadowClipLevel: 'Underexposure — darkness counted as pure black',
  maxShadowClipFraction: 'Underexposure — share of the frame allowed to be pure black',
  minMedianLuma: 'Too dark — minimum overall brightness',
  idCellMargin: 'Card ID — how clearly each ID square must read',
  minPatchSourcePixels: 'Card too far — minimum camera pixels per colour square',
  maxClipFraction: 'Glare on the card — share of a colour square allowed to be blown out',
  maxResidualWhiteRatio: 'Uneven light — most unevenness left after the light correction',
  maxLooMeanDeltaE00: 'Correction quality — largest average error on the card',
  maxLooP90DeltaE00: 'Correction quality — largest error on the worst tenth of the card',
  maxRegistrationSpreadDeltaE00: 'Card set-up — most disagreement allowed between set-up photos',
  sampleWhiteNoiseFactor: 'Test area — how far from white paper counts as colour',
  sampleMinDeltaE: 'Test area — smallest colour difference ever counted',
  sampleEdgeErodeMm: 'Test area — edge trimmed off before reading',
  sampleNoiseFloorMm2: 'Test area — specks smaller than this are ignored',
  sampleMinAreaMm2: 'Test area — smallest test that can be read',
  sampleSecondRegionMm2: 'Test area — a second patch this big means two tests',
  maxSampleClipFraction: 'Glare on the test — share of the test allowed to be blown out',
  sampleDarkLevel: 'Test area — pixels too dark to use',
  maxSampleSpreadDeltaE: 'Patchy test — most colour variation allowed',
};

export const COLLECTION_LINE = 'For the team: saves test photos to improve the app. No results, no records.';
export const COLLECTION_BANNER = 'Photo collection is on: photos are saved for the team — no results, no records.';
export const MIGRATION_NOTE = 'Photo collection was on and has been turned off. It now lives in Settings → Developer tools.';

// ---- Verdict sentences for non-scientists (numbers stay in Technical details) ----


const SHOW_WHOLE_CARD = 'Show the whole card — all four black corners';

/** Plain version of a RETAKE reason (card or sample stage). */
export function plainRetake(reason: string): string {
  if (reason === 'Show all four corners') return SHOW_WHOLE_CARD;
  if (reason.startsWith('Colour correction unreliable')) return 'The light is too uneven or too coloured to read the card — retake in daylight or under a tube light';
  if (/^Card copy .+ is not registered/.test(reason)) return 'This printed card is not set up in the app yet (only the team’s cards A and B are) — try a sample instead';
  if (reason === 'The sample zone was not read') return 'The white square could not be read — retake the photo';
  return reason;
}

/** Short name of a target for sentences: "heroin (diacetylmorphine HCl)" -> "heroin". */
export function targetName(label: string): string {
  return label.split(' (')[0];
}

export function plainVerdictSentence(c: Classification): string {
  if (c.verdict === 'RETAKE') return plainRetake(c.reason);
  if (c.verdict === 'NEGATIVE' && !c.nearest) return 'No colour developed. The app cannot tell this from an empty white square; the saved photo shows which it was.';
  if (c.verdict === 'POSITIVE' || c.verdict === 'NEGATIVE') {
    const n = c.nearest ? targetName(c.nearest.label) : 'a reference colour';
    return `The test colour matches the colour this reagent turns with ${n} in the kit’s published table.`;
  }
  const several = c.distances.filter((d) => d.inside).map((d) => d.outcome);
  if (new Set(several).size > 1) return 'The test colour is close to more than one kind of result, so the app cannot decide.';
  return 'The test colour does not match any of this kit’s reaction colours, so the app cannot decide.';
}
