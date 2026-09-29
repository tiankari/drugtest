// Plain words for people who are not colour scientists. Only wording lives
// here: every value shown comes from the real pipeline and profiles.

import { CARD_MESSAGES, type MatAnalysis } from '../pipeline/analyse.ts';
import { linearLuminance } from '../pipeline/colour.ts';
import { THRESHOLDS } from '../pipeline/config.ts';
import { WHITE_IDS } from '../pipeline/flatfield.ts';
import { NO_COLOUR_RETAKE, type Classification, type KitProfile } from '../pipeline/kit.ts';
import { MAT_V1, type PatchSpec } from '../pipeline/mat.ts';
import { SAMPLE_MESSAGES } from '../pipeline/samplezone.ts';
import type { EntryCheck, LogReport, NotedHashCheck } from '../records/log.ts';

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

/** Plain version of a RETAKE reason (card or sample stage), short enough for the live camera guidance. */
export function plainRetake(reason: string): string {
  if (reason === 'Show all four corners') return SHOW_WHOLE_CARD;
  if (reason === CARD_MESSAGES.correction) return 'The card’s colours could not be read reliably — check for a shadow on the colour squares, or retake in daylight or under a tube light';
  if (/^Card copy .+ is not registered/.test(reason)) return 'This printed card is not set up in the app yet (only the team’s cards A and B are) — try a sample instead';
  if (reason === 'The sample zone was not read') return 'The white square could not be read — retake the photo';
  return reason;
}

// ---- Retake advice on the result screen: what went wrong, where, and what to try ----

export interface RetakeAdvice {
  /** One sentence: what the app saw. */
  why: string;
  /** What to try; empty when the sentence says it all. */
  tips: string[];
  /** The marked-up card is worth showing (the sample stage refused what it read). */
  showMask: boolean;
}

const ZONE = MAT_V1.sampleZone;

/** Gap in mm between a patch and the white square (0 when they touch). */
function gapToZone(p: PatchSpec): number {
  const dx = Math.max(ZONE.x - (p.rect.x + p.rect.w), p.rect.x - (ZONE.x + ZONE.w), 0);
  const dy = Math.max(ZONE.y - (p.rect.y + p.rect.h), p.rect.y - (ZONE.y + ZONE.h), 0);
  return Math.hypot(dx, dy);
}

/** Patches this close to the white square are the ones a test's shadow falls on (the side columns are 2.5 mm away). */
const BESIDE_ZONE_MM = 3;
const besideZone = (p: PatchSpec) => gapToZone(p) <= BESIDE_ZONE_MM;

/** "the small white patch on the right edge (beside the lower corner of the white square)" */
function whereIs(p: PatchSpec): string {
  const edge = { top: 'in the top row', bottom: 'in the bottom row', left: 'on the left edge', right: 'on the right edge' }[p.side];
  if (!besideZone(p)) return `the small white patch ${edge}`;
  const upper = p.rect.y + p.rect.h / 2 < ZONE.y + ZONE.h / 2;
  return `the small white patch ${edge} (beside the ${upper ? 'upper' : 'lower'} corner of the white square)`;
}

const SHADOW_TIP = 'Keep the test flat and inside the white square, with nothing over the colour squares beside it.';
const HAND_TIP = 'Hold the phone straight above the card so that your hand and the phone do not shade it.';
const EVEN_LIGHT_TIP = 'Light the card evenly: daylight or a tube light, not a lamp from one side.';
const MASK_TIP = 'The picture below marks what the app counted as colour.';
/** Smallest round spot that still reads: the minimum area after the edge is trimmed off, as a diameter. */
const MIN_SPOT_MM = Math.ceil(2 * Math.sqrt(THRESHOLDS.sampleMinAreaMm2.value / Math.PI) + 2 * THRESHOLDS.sampleEdgeErodeMm.value);

/** The darkest white patch once the smooth light gradient is taken out (what a shadow on one patch shows as). */
function darkestWhite(a: MatAnalysis): PatchSpec | null {
  const whites = (a.patches ?? []).filter((p) => WHITE_IDS.includes(p.id));
  if (!whites.length) return null;
  const d = whites.reduce((m, p) => (linearLuminance(p.flat) < linearLuminance(m.flat) ? p : m));
  return MAT_V1.patches.find((p) => p.id === d.id) ?? null;
}

/**
 * Plain advice for a RETAKE. `reason` is the sealed/technical reason (card
 * or sample stage); the analysis, when given, says where on the card the
 * problem is; the kit, when given, says why "no colour" is not a result. The
 * measurements behind it stay in Technical details.
 */
export function retakeAdvice(reason: string, a?: MatAnalysis | null, kit?: KitProfile | null): RetakeAdvice {
  const out = (why: string, tips: string[] = [], showMask = false): RetakeAdvice => ({ why, tips, showMask });
  if (reason === CARD_MESSAGES.uneven) {
    const p = a ? darkestWhite(a) : null;
    if (!p) return out('Part of the card is darker than the rest, so the app cannot correct the light.', [SHADOW_TIP, HAND_TIP, EVEN_LIGHT_TIP]);
    return out(
      `Part of the card is darker than the rest: ${whereIs(p)} looks darker than the other white patches.`,
      besideZone(p) ? ['That patch is right next to the white square, where a raised or wide test casts its shadow. ' + SHADOW_TIP, HAND_TIP, EVEN_LIGHT_TIP] : [HAND_TIP, EVEN_LIGHT_TIP],
    );
  }
  if (reason === CARD_MESSAGES.glare) return out('Glare on the card’s colour squares.', ['Tilt the phone a little, so the light is not reflected straight into the camera.', 'Turn the torch off if it is on.']);
  if (reason === CARD_MESSAGES.glareZone) {
    return out('Shine in the white square: part of it is too bright to read.', ['A shiny, glossy or wet test (or plastic wrapping) reflects the light into the camera. Tilt the phone a little, or move the light.', 'Turn the torch off if it is on.']);
  }
  // Which squares came out worst does not say why (on the real photos the dark greys are worst whatever the cause), so no place is named here.
  if (reason === CARD_MESSAGES.correction) {
    return out('The app could not read the card’s colour squares well enough to trust the colours.', [
      'Coloured or uneven light usually causes this: retake in daylight or under a tube light, away from coloured lamps, with the torch off.',
      'Also check that nothing covers or shades the colour squares. ' + SHADOW_TIP,
    ]);
  }
  if (reason === SAMPLE_MESSAGES.small) return out('The coloured area in the white square is too small to read.', [`Put more of the test in the white square (a spot at least about ${MIN_SPOT_MM} mm across).`, MASK_TIP], true);
  if (reason === SAMPLE_MESSAGES.two) {
    return out('The app sees two separate coloured areas in the white square.', ['Use one test at a time.', 'A dark shadow beside the test also counts as a coloured area: light the card from above and keep the test flat.', MASK_TIP], true);
  }
  if (reason === SAMPLE_MESSAGES.glare) return out('Shine on the test: part of it is too bright to read.', ['A shiny or wet surface reflects the light into the camera: tilt the phone a little, or move the light.', MASK_TIP], true);
  if (reason === SAMPLE_MESSAGES.patchy) {
    return out('The colour in the white square is uneven, so the app cannot read one colour.', ['A shadow at the edge of the test, a printed label or a mix of colours causes this.', 'Let the colour finish developing, and keep only the test in the white square.', 'The picture below marks what the app read.'], true);
  }
  if (reason === NO_COLOUR_RETAKE) return out('Nothing coloured in the white square, and this kit does not read that as NEGATIVE.', [kit ? kit.noColourNote : 'Put the test in the white square and take the photo again.']);
  return out(plainRetake(reason));
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

// ---- The log and record checks in plain words (each maps one verifier result) ----


export const CHECK_NAMES = {
  sealed: 'Not changed since it was saved',
  linked: 'Nothing removed or inserted before it',
  photo: 'Photo is the original',
} as const;

export function plainChecks(c: EntryCheck): { key: keyof typeof CHECK_NAMES; ok: boolean; text: string }[] {
  return [
    { key: 'sealed', ok: c.hashOk && c.signatureOk && c.keyOk, text: CHECK_NAMES.sealed },
    { key: 'linked', ok: c.chainOk, text: CHECK_NAMES.linked },
    { key: 'photo', ok: c.photoOk === true, text: c.photoOk === null ? 'Photo not checked' : CHECK_NAMES.photo },
  ];
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** One line for the whole log. */
export function plainLogSummary(r: LogReport): string {
  if (r.count === 0) return 'No saved tests yet.';
  if (r.ok) return r.count === 1 ? '✓ 1 saved test: not changed, nothing removed or inserted, photo original.' : `✓ All ${r.count} saved tests: not changed, nothing removed or inserted, photos original.`;
  return `✗ ${r.failures} of ${plural(r.count, 'saved test')} fail a check:`;
}

/** One line per record that fails (or has a clock warning). */
export function plainProblems(r: LogReport): string[] {
  const out: string[] = [];
  for (const c of r.entries) {
    const bad = plainChecks(c).filter((k) => !k.ok && k.text !== 'Photo not checked');
    if (bad.length) out.push(`Record ${c.seq}: ${bad.map((k) => `✗ ${k.text}`).join(' · ')}`);
    if (c.warnings.length) out.push(`Record ${c.seq}: note — the phone’s clock was set earlier than for the record before it.`);
  }
  return out;
}

/** The "Log code to write down" comparison, correct for every state. */
export function plainNotedCode(total: number, c: NotedHashCheck, typed: string): string {
  if (total === 0) return 'No saved tests yet, so there is no code to compare.';
  if (!/^[0-9a-f]{12,64}$/i.test(typed.trim())) return 'Type at least the first 12 characters of the code you wrote down (digits 0-9 and letters a-f).';
  if (!c.found) return c.message.startsWith('That prefix') ? 'That start matches more than one test; type more characters.' : 'This code is not in this log: tests saved after it were deleted, or the code was copied wrongly.';
  if (c.newer === 0) return 'This is the latest code: nothing has been removed since you wrote it down.';
  return `This code belongs to record ${c.seq}; ${plural(c.newer, 'test has', 'tests have')} been saved after it. Nothing before it has been removed.`;
}
