// Plain words for people who are not colour scientists. Only wording lives
// here: every value shown comes from the real pipeline and profiles.

import type { THRESHOLDS } from '../pipeline/config.ts';

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
