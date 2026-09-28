// Every threshold in one place.
//
// Each entry says whether it is PROVISIONAL (a reasoned starting value, not
// yet checked against real photos) or DERIVED (computed from named real
// photos by a stated rule). Until Step 6 all of them are provisional.
// Do not loosen a threshold just to make more real photos pass.

export type ThresholdStatus = 'provisional' | 'derived';

export interface Threshold {
  readonly value: number;
  readonly unit: string;
  readonly status: ThresholdStatus;
  /** One line: why this value (provisional) or which files and rule produced it (derived). */
  readonly reason: string;
}

export const THRESHOLDS = {
  blurMinLaplacianVariance: {
    value: 680,
    unit: 'variance of the 4-neighbour Laplacian of 8-bit luma at check scale, on the detected card (framing outline if no card)',
    status: 'derived',
    reason:
      'Geometric mean of the only motion-blurred real photo (fail-blur_nothing-phone-3a_A_20260928T120754449Z: 488) and the least sharp non-blurred one (fail-shadow_nothing-phone-3a_A_20260928T120640832Z: 960). One blurred example only: re-derive when more exist. (Was 50 provisional, which let the blurred photo pass.)',
  },
  highlightClipLevel: {
    value: 254,
    unit: '8-bit channel value at or above which a channel counts as clipped',
    status: 'provisional',
    reason: 'Browser YUV-to-RGB conversion can land saturated pixels on 254 as well as 255.',
  },
  maxHighlightClipFraction: {
    value: 0.02,
    unit: 'fraction of pixels inside the framing outline blown to white (all three channels clipped)',
    status: 'provisional',
    reason: 'Blown paper white destroys the white reference; 2% allows a few specular pixels. Saturated printed colours can clip one channel legitimately, so that is left to the per-patch check.',
  },
  shadowClipLevel: {
    value: 3,
    unit: '8-bit value at or below which a pixel (max channel) counts as crushed black',
    status: 'provisional',
    reason: 'Printed black markers normally photograph well above 3; only true underexposure crushes to 0-3.',
  },
  maxShadowClipFraction: {
    value: 0.1,
    unit: 'fraction of pixels inside the framing outline with max channel crushed',
    status: 'provisional',
    reason: 'Corner markers are under 4% of the card area, so more than 10% crushed means the frame is too dark.',
  },
  minMedianLuma: {
    value: 50,
    unit: 'median 8-bit Rec. 601 luma inside the framing outline',
    status: 'provisional',
    reason: 'The card is mostly white; a median this low means the scene is far too dark for colour work.',
  },
  idCellMargin: {
    value: 0.15,
    unit: 'fraction of the (white - black) luma range either side of the midpoint where an ID cell counts as unreadable',
    status: 'provisional',
    reason: 'Printed cells read near marker black or paper white; one within 15% of the midpoint is not clearly either, so the ID is refused rather than guessed.',
  },
  minPatchSourcePixels: {
    value: 400,
    unit: "camera pixels inside each patch's central 5 x 5 mm sampling square (minimum over all patches)",
    status: 'provisional',
    reason: 'About 4 px/mm: below that, lens blur and a 1 mm placement error eat into the 5 mm square and the median mixes in the neighbouring colours.',
  },
  maxClipFraction: {
    value: 0.02,
    unit: 'fraction of pixels in any patch sampling square, or in the sample zone, with any channel at or above highlightClipLevel',
    status: 'provisional',
    reason: 'A clipped channel is not a measurement; 2% allows stray specks but not a glare spot.',
  },
  maxResidualWhiteRatio: {
    value: 1.2,
    unit: 'brightest / dimmest linear luminance of the six white patches (W_T, W_B, W_L, W_R1, W_R2, N1) AFTER the fitted smooth light gradient is divided out',
    status: 'provisional',
    reason: 'A smooth gradient is now corrected (user decision, 2026-09-28); what remains is local shadow the plane cannot model. Real registration photos leave 1.03-1.06, the cap-shadow warm-bulb photo 2.26. To be derived from the retake set.',
  },

  maxLooMeanDeltaE00: {
    value: 5,
    unit: 'mean leave-one-out CIEDE2000 over the card patches after correction',
    status: 'provisional',
    reason: 'Neighbouring reaction colour families differ by roughly 10 or more; a correction that cannot predict its own card within 5 on average cannot separate them.',
  },
  maxLooP90DeltaE00: {
    value: 10,
    unit: '90th percentile leave-one-out CIEDE2000 over the card patches after correction',
    status: 'provisional',
    reason: 'Guards against a few badly predicted colours hidden behind a good mean.',
  },
  maxRegistrationSpreadDeltaE00: {
    value: 6,
    unit: 'largest CIEDE2000 between any two registration shots, for any patch, after flat-field and per-shot white normalisation',
    status: 'provisional',
    reason:
      'PROTOTYPE STANDARD (hackathon, 2026-09-28, user decision): raised from 3 to accept the only registration shots available (copy A 5.23, copy B 5.50; hand-held at dusk). References are correspondingly less precise; a flat-on-table daylight retake should bring this back to 3.',
  },

} as const satisfies Record<string, Threshold>;

/** Fixed parameters (not pass/fail thresholds). */
export const PARAMS = {
  /** Checks run on a copy downscaled by an integer box factor to about this long side. */
  checkLongSide: 640,
  /** The framing outline covers this fraction of the frame's limiting dimension. */
  framingFraction: 0.85,
  /** Requested capture resolution (the phone may deliver something else; we record what it delivers). */
  requestWidth: 1920,
  requestHeight: 1080,
  /** Card detection runs on a copy box-downscaled to about this long side (full resolution as fallback). */
  detectLongSide: 960,
  /** Adaptive threshold: local window radius = short side / this; dark if luma < local mean x ratio. */
  thresholdWindowDivisor: 12,
  thresholdRatio: 0.75,
  /** Smallest marker bounding box considered, in detection-scale pixels. */
  markerMinBoxPx: 64,
  /** Patches are sampled in their central square, this far in from each edge (10 mm patch -> 5 mm square). */
  patchInsetMm: 2.5,
  /** Sample zone clip check covers the zone interior this far in from the outline. */
  sampleZoneInsetMm: 3,
  /** Trimmed median: drop this fraction of pixels at each end of the luma order, then per-channel median. */
  trimFraction: 0.1,
} as const;

export type CorrectionMethod = 'A' | 'B';

/**
 * Default correction method. PROVISIONAL until Step 6 compares A and B on real
 * photos: A = 3x3 matrix in linear RGB; B = per-channel neutral-ramp curves, then 3x3.
 */
export const DEFAULT_CORRECTION_METHOD: { value: CorrectionMethod; status: ThresholdStatus; reason: string } = {
  value: 'B',
  status: 'derived',
  reason:
    'docs/validation/mat_v1.md (2026-09-28, prototype registration): B kept the test colour more consistent across lightings in 3 of 4 groups (both phones 20.1 vs A 23.4; Nothing 13.2 vs 18.1; accepted photos 4.9 vs 9.1; OnePlus favoured A, 11.1 vs 12.7); leave-one-out about equal (A 6.2, B 6.7). Weak evidence: glossy cap, 8 photos.',
};
