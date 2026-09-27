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
    value: 50,
    unit: 'variance of the 4-neighbour Laplacian of 8-bit luma, at check scale, inside the framing outline',
    status: 'provisional',
    reason: 'Below the common ~100 rule of thumb for 640 px frames because the card is mostly flat white; to be derived from fail-blur vs registration photos.',
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
} as const;
