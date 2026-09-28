// The whole card pipeline for one frame: quality checks, detection and
// orientation, ID strip, patch sampling, glare, uneven light, correction with
// leave-one-out error, and a PASS / RETAKE verdict with the reason in plain
// words. Anything uncertain is RETAKE, never a guess.

import { linearToSrgb, type Vec3 } from './colour.ts';
import { DEFAULT_CORRECTION_METHOD, PARAMS, THRESHOLDS, type CorrectionMethod } from './config.ts';
import { applyCorrection, fitCorrection, fitError, labOfLinear, leaveOneOut, type CorrectionModel, type ErrorStats } from './correct.ts';
import { detectCard, inset, readIdStrip, type Detection, type IdRead } from './detect.ts';
import { fieldRange, fitLightField, flatten, patchCentre, whiteRatio } from './flatfield.ts';
import { applyH, areaScale } from './homography.ts';
import { clampRect, type RgbaImage } from './image.ts';
import { MAT_V1, rectCentre, type RectMm } from './mat.ts';
import { checkFrame, checkScaleFactor, laplacianVariance, lumaPlane, MESSAGES, type FrameCheckReport } from './quality.ts';
import type { MatReference } from './reference.ts';
import { sampleRegion, type RegionSample } from './sample.ts';
import { luma601 } from './image.ts';

export type AnalysisCheckId = 'dark' | 'bright' | 'blur' | 'card' | 'closer' | 'glare' | 'uneven' | 'registered' | 'correction';

export interface AnalysisCheck {
  id: AnalysisCheckId;
  pass: boolean;
  message: string;
  value?: number;
  threshold?: number;
  detail?: string;
}

export interface PatchObservation extends RegionSample {
  id: string;
  /** Linear value after dividing out the fitted light gradient (what correction uses). */
  flat: Vec3;
}

export interface MethodResult {
  method: CorrectionMethod;
  model: CorrectionModel;
  loo: ErrorStats;
  fit: ErrorStats;
}

export interface MatAnalysis {
  verdict: 'PASS' | 'RETAKE';
  /** Plain-words reason for the first failing check; empty on PASS. */
  reason: string;
  checks: AnalysisCheck[];
  frame: FrameCheckReport;
  detection: Detection;
  copy?: string;
  version?: number;
  /** ID strip as read at full resolution (cell values, black/white references). */
  idRead?: IdRead;
  patches?: PatchObservation[];
  minPatchPixels?: number;
  sampleZone?: RegionSample;
  /** Central square of the sample zone (the test's reading area); `flat` is after the light field. */
  zoneCentre?: RegionSample & { flat: Vec3 };
  unevenLight?: {
    /** Brightest / dimmest white patch, as photographed. */
    ratio: number;
    /** The same after dividing out the fitted gradient: the checked figure. */
    residual: number;
    /** Relative change of the fitted light across the card corners. */
    gradient: number;
    whites: { id: string; Y: number }[];
  };
  correction?: {
    used: MethodResult;
    other: MethodResult | null;
    patches: { id: string; observedLab: Vec3; correctedLinear: Vec3; correctedLab: Vec3; referenceLab: Vec3 }[];
  };
}

export const CARD_MESSAGES = {
  'no-card': 'Show all four corners',
  incomplete: 'Show all four corners',
  multiple: 'Only one card in view',
  mirrored: 'Card looks mirrored — use the rear camera',
  'id-unreadable': 'Card ID unreadable — show the whole card, flat and in focus',
  closer: 'Move closer',
  glare: 'Glare on the card — tilt the phone',
  uneven: 'Uneven light — move out of the shadow',
  correction: 'Colour correction unreliable — retake in even light',
} as const;

export interface AnalyseOptions {
  /** Registered references by copy letter. */
  references?: Record<string, MatReference>;
  method?: CorrectionMethod;
  /** Also compute the other method (for comparison screens and validation). */
  bothMethods?: boolean;
  /** Multiply pixel counts by this (preview frames are downscaled copies of the full frame). */
  pixelScale?: number;
  /** Frame-check downscale factor (1 for an already downscaled preview). */
  checkScale?: number;
  /** Stop after the uneven-light check (live preview guidance). */
  guidanceOnly?: boolean;
  /** Side of the central sample-zone square to read, mm. */
  zoneCentreMm?: number;
}

const NEUTRAL = MAT_V1.patches.map((p) => p.role === 'neutral');

function finish(a: Omit<MatAnalysis, 'verdict' | 'reason'>): MatAnalysis {
  const failed = a.checks.find((c) => !c.pass);
  return { ...a, verdict: failed ? 'RETAKE' : 'PASS', reason: failed ? failed.message : '' };
}

export function analyseMat(img: RgbaImage, opts: AnalyseOptions = {}): MatAnalysis {
  const T = THRESHOLDS;
  const frame = checkFrame(img, opts.checkScale);
  const byId = Object.fromEntries(frame.checks.map((c) => [c.id, c]));
  const checks: AnalysisCheck[] = (['dark', 'bright', 'blur'] as const).map((id) => ({
    id,
    pass: byId[id].pass,
    message: MESSAGES[id],
    value: byId[id].value,
    threshold: byId[id].threshold,
  }));

  const detection = detectCard(img);
  if (!detection.ok) {
    checks.push({ id: 'card', pass: false, message: CARD_MESSAGES[detection.reason], detail: detection.detail });
    return finish({ checks, frame, detection });
  }
  const { H, Hinv } = detection;
  // Once the card is found, judge sharpness on the card itself, not the static
  // framing outline: a small card leaves the outline mostly flat table, which
  // scores low for the wrong reason (then "Move closer" is the right advice).
  const corners = [applyH(H, [0, 0]), applyH(H, [MAT_V1.widthMm, 0]), applyH(H, [MAT_V1.widthMm, MAT_V1.heightMm]), applyH(H, [0, MAT_V1.heightMm])];
  const bx = corners.map((p) => p[0]);
  const by = corners.map((p) => p[1]);
  const cardBox = clampRect({ x: Math.min(...bx), y: Math.min(...by), w: Math.max(...bx) - Math.min(...bx), h: Math.max(...by) - Math.min(...by) }, img.width, img.height);
  const cardSharpness = laplacianVariance(lumaPlane(img, cardBox, opts.checkScale ?? checkScaleFactor(img.width, img.height)));
  const blur = checks.find((c) => c.id === 'blur')!;
  blur.value = cardSharpness;
  blur.pass = cardSharpness >= T.blurMinLaplacianVariance.value;
  blur.detail = 'measured on the detected card';
  // Re-read the ID strip at full resolution.
  const lumaSample = (r: RectMm) => {
    const s = sampleRegion(img, H, Hinv, r, 0);
    return luma601(s.rgb8[0], s.rgb8[1], s.rgb8[2]);
  };
  const id = readIdStrip(lumaSample);
  if (!id.ok || id.version !== MAT_V1.version) {
    checks.push({ id: 'card', pass: false, message: CARD_MESSAGES['id-unreadable'], detail: id.reason ?? `version ${id.version}` });
    return finish({ checks, frame, detection, idRead: id });
  }
  checks.push({ id: 'card', pass: true, message: 'Card found', detail: `copy ${id.copy}, rotated ${Math.round(detection.rotationDeg)} deg` });

  const scale = opts.pixelScale ?? 1;
  const patches: (RegionSample & { id: string })[] = MAT_V1.patches.map((p) => ({ id: p.id, ...sampleRegion(img, H, Hinv, inset(p.rect, PARAMS.patchInsetMm)) }));
  const minPatchPixels = Math.min(...patches.map((p) => p.n)) * scale;
  // Area scale gives the same figure without sampling; use the smaller (edges of the frame can clip a patch).
  const predicted = Math.min(...MAT_V1.patches.map((p) => areaScale(H, rectCentre(p.rect)) * (p.rect.w - 2 * PARAMS.patchInsetMm) ** 2)) * scale;
  const pixels = Math.min(minPatchPixels, predicted);
  checks.push({ id: 'closer', pass: pixels >= T.minPatchSourcePixels.value, message: CARD_MESSAGES.closer, value: pixels, threshold: T.minPatchSourcePixels.value });

  const zone = inset(MAT_V1.sampleZone, PARAMS.sampleZoneInsetMm);
  const sampleZone = sampleRegion(img, H, Hinv, zone);
  const cz = opts.zoneCentreMm ?? 24;
  const zc = rectCentre(MAT_V1.sampleZone);
  const zoneCentre = sampleRegion(img, H, Hinv, { x: zc[0] - cz / 2, y: zc[1] - cz / 2, w: cz, h: cz });
  const worstPatch = patches.reduce((a, b) => (b.clipFraction > a.clipFraction ? b : a));
  const worstClip = Math.max(worstPatch.clipFraction, sampleZone.clipFraction);
  const where = sampleZone.clipFraction >= worstPatch.clipFraction ? 'sample zone' : `patch ${worstPatch.id}`;
  checks.push({
    id: 'glare',
    pass: worstClip <= T.maxClipFraction.value,
    message: CARD_MESSAGES.glare,
    value: worstClip,
    threshold: T.maxClipFraction.value,
    detail: `most clipped: ${where}`,
  });

  // Light: fit the smooth gradient to the whites, divide it out, and judge what is left.
  const rawById = Object.fromEntries(patches.map((p) => [p.id, p.linear])) as Record<string, Vec3>;
  const raw = whiteRatio(rawById);
  const field = fitLightField(rawById);
  if (!field) {
    checks.push({ id: 'uneven', pass: false, message: CARD_MESSAGES.uneven, detail: 'light field could not be fitted to the white patches' });
    return finish({ checks, frame, detection, copy: id.copy, version: id.version, idRead: id });
  }
  const flatPatches: PatchObservation[] = patches.map((p) => ({ ...p, flat: flatten(field, p.linear, patchCentre(p.id)) }));
  const residual = whiteRatio(Object.fromEntries(flatPatches.map((p) => [p.id, p.flat])) as Record<string, Vec3>).ratio;
  const gradient = fieldRange(field);
  checks.push({
    id: 'uneven',
    pass: residual <= T.maxResidualWhiteRatio.value,
    message: CARD_MESSAGES.uneven,
    value: residual,
    threshold: T.maxResidualWhiteRatio.value,
    detail: `whites ${raw.ratio.toFixed(3)} as photographed; smooth gradient ${gradient.toFixed(2)} removed`,
  });
  const zoneFlat = { ...zoneCentre, flat: flatten(field, zoneCentre.linear, zc) };

  const base = {
    checks,
    frame,
    detection,
    copy: id.copy,
    version: id.version,
    idRead: id,
    patches: flatPatches,
    minPatchPixels: pixels,
    sampleZone,
    zoneCentre: zoneFlat,
    unevenLight: { ratio: raw.ratio, residual, gradient, whites: raw.whites },
  };
  if (opts.guidanceOnly) return finish(base);

  const ref = opts.references?.[id.copy!];
  if (!ref || ref.matVersion !== id.version) {
    checks.push({ id: 'registered', pass: false, message: `Card copy ${id.copy} is not registered — register it first` });
    return finish(base);
  }
  checks.push({ id: 'registered', pass: true, message: `Copy ${id.copy} registered`, detail: ref.createdAt });

  const method = opts.method ?? DEFAULT_CORRECTION_METHOD.value;
  const obs = flatPatches.map((p) => p.flat);
  const refLin = MAT_V1.patches.map((p) => ref.patches[p.id].linear);
  const run = (m: CorrectionMethod): MethodResult | null => {
    const model = fitCorrection(obs, refLin, NEUTRAL, m);
    const loo = leaveOneOut(obs, refLin, NEUTRAL, m);
    const fit = fitError(obs, refLin, NEUTRAL, m);
    return model && loo && fit ? { method: m, model, loo, fit } : null;
  };
  const used = run(method);
  if (!used) {
    checks.push({ id: 'correction', pass: false, message: CARD_MESSAGES.correction, detail: 'correction could not be fitted' });
    return finish(base);
  }
  const other = opts.bothMethods ? run(method === 'A' ? 'B' : 'A') : null;
  const ok = used.loo.mean <= T.maxLooMeanDeltaE00.value && used.loo.p90 <= T.maxLooP90DeltaE00.value;
  checks.push({
    id: 'correction',
    pass: ok,
    message: CARD_MESSAGES.correction,
    value: used.loo.mean,
    threshold: T.maxLooMeanDeltaE00.value,
    detail: `leave-one-out mean ${used.loo.mean.toFixed(2)}, 90th pct ${used.loo.p90.toFixed(2)} (limits ${T.maxLooMeanDeltaE00.value}, ${T.maxLooP90DeltaE00.value})`,
  });
  const correctedPatches = MAT_V1.patches.map((p, i) => {
    const correctedLinear = applyCorrection(used.model, obs[i]);
    return { id: p.id, observedLab: labOfLinear(obs[i]), correctedLinear, correctedLab: labOfLinear(correctedLinear), referenceLab: ref.patches[p.id].lab };
  });
  return finish({ ...base, correction: { used, other, patches: correctedPatches } });
}

/** Linear RGB to displayable 8-bit sRGB (clipped), for screens. */
export function linearToDisplay8(rgb: Vec3): Vec3 {
  return rgb.map((c) => Math.round(Math.min(1, Math.max(0, linearToSrgb(c))) * 255)) as unknown as Vec3;
}

