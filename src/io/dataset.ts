// Data collection: tags, file naming and the sidecar schema. Shared by the
// app (which writes captures) and the Node scripts (which read them).

import type { CheckResult, FrameCheckReport } from '../pipeline/quality.ts';
import type { EncodeInfo } from './png.ts';

export const DATA_TAGS = [
  'registration',
  'daylight',
  'tube',
  'warm-bulb',
  'torch',
  'fail-corner',
  'fail-shadow',
  'fail-glare',
  'fail-blur',
  'fail-far',
  'fail-banding',
] as const;
export type DataTag = (typeof DATA_TAGS)[number];

export const TAG_INFO: Record<DataTag, { label: string; hint: string; folder: 'registration' | 'lighting' | 'should_fail' }> = {
  registration: {
    label: 'Card set-up photo (clean card, 3 per card)',
    hint: 'Clean card lying flat on a table, steady daylight (not dusk), no direct sun. Tap Lock, then 3 photos without moving. 3 per card.',
    folder: 'registration',
  },
  daylight: { label: 'Test object in daylight', hint: 'Any test object in the white square. Do not move it between shots.', folder: 'lighting' },
  tube: { label: 'Test object under a tube light', hint: 'Any test object in the white square, fluorescent or LED tube light.', folder: 'lighting' },
  'warm-bulb': { label: 'Test object under a warm bulb', hint: 'Any test object in the white square, warm yellow bulb.', folder: 'lighting' },
  torch: { label: 'Test object lit by the phone torch', hint: 'Any test object in the white square, lit by the phone torch.', folder: 'lighting' },
  'fail-corner': { label: 'Corner covered (checks the app refuses it)', hint: 'Cover one black corner square with a finger or paper.', folder: 'should_fail' },
  'fail-shadow': { label: 'Shadow across half the card (checks the app refuses it)', hint: 'Cast a shadow over half the card.', folder: 'should_fail' },
  'fail-glare': { label: 'Glare spot on the colour squares (checks the app refuses it)', hint: 'Tilt the card until a light reflects off the colour squares.', folder: 'should_fail' },
  'fail-blur': { label: 'Deliberately blurred photo (checks the app refuses it)', hint: 'Move the phone while capturing.', folder: 'should_fail' },
  'fail-far': { label: 'Card too far away (checks the app refuses it)', hint: 'Step back so the card is small in the frame.', folder: 'should_fail' },
  'fail-banding': { label: 'Flickering tube-light bands (checks the app refuses it)', hint: 'Tube light with visible dark bands, if you can catch it.', folder: 'should_fail' },
};

export const COPIES = ['A', 'B'] as const;

/** Phone model to a filename-safe slug: lowercase a-z, 0-9 and single hyphens. */
export function phoneSlug(phone: string): string {
  return phone
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** 2026-09-27T10:15:30.123Z -> 20260927T101530123Z */
export function compactUtc(iso: string): string {
  return iso.replace(/[-:.]/g, '');
}

export function captureBaseName(tag: DataTag, phone: string, copy: string, isoTime: string): string {
  const slug = phoneSlug(phone);
  if (!slug) throw new Error('Phone model is empty');
  return `${tag}_${slug}_${copy}_${compactUtc(isoTime)}`;
}

export function parseCaptureName(name: string): { tag: DataTag; phone: string; copy: string; time: string } | null {
  const base = name.replace(/\.(png|json)$/i, '');
  const parts = base.split('_');
  if (parts.length !== 4) return null;
  const [tag, phone, copy, time] = parts;
  if (!(DATA_TAGS as readonly string[]).includes(tag)) return null;
  return { tag: tag as DataTag, phone, copy, time };
}

/** Folder inside the export zip, matching data/real/ in the repo. */
export function zipFolder(tag: DataTag, copy: string): string {
  const f = TAG_INFO[tag].folder;
  return f === 'registration' ? `mat/registration/${copy}` : `mat/${f}`;
}

export const SIDECAR_SCHEMA = 'fdtc.capture.v1';

export interface CaptureSidecar {
  schema: typeof SIDECAR_SCHEMA;
  file: string;
  /** SHA-256 of the PNG file bytes. */
  sha256: string;
  /** SHA-256 of the RGBA pixel buffer the pipeline analysed (what the PNG must decode to). */
  pixelSha256: string;
  capturedAt: string;
  timezoneOffsetMinutes: number;
  app: { version: string; commit: string; buildTime: string };
  mode: 'data-collection' | 'normal';
  dataCollection: { tag: DataTag; phone: string; copy: string } | null;
  image: {
    width: number;
    height: number;
    pixelFormat: 'RGBA8';
    source: string;
    png: EncodeInfo;
  };
  camera: {
    label: string;
    requested: Record<string, unknown>;
    videoWidth: number;
    videoHeight: number;
    settings: Record<string, unknown>;
    capabilities: Record<string, unknown> | null;
    torchOn: boolean;
    /** Exposure / white-balance lock requested for this shot (registration only), and what the phone did. */
    lock: { exposure: boolean; whiteBalance: boolean; error: string | null } | null;
  };
  checks: {
    pass: boolean;
    guidance: string;
    results: readonly CheckResult[];
    stats: FrameCheckReport['stats'];
    thresholds: Record<string, { value: number; status: string }>;
  };
  /** Summary of the full card analysis at capture (thresholds as they were then; validation re-runs it). */
  analysis: {
    verdict: 'PASS' | 'RETAKE';
    reason: string;
    copy: string | null;
    checks: { id: string; pass: boolean; value?: number; threshold?: number; detail?: string }[];
    unevenLight: number | null;
    method: string | null;
    looMean: { A?: number; B?: number };
  } | null;
  device: {
    userAgent: string;
    devicePixelRatio: number;
    screen: { width: number; height: number };
    orientation: string | null;
  };
  timingsMs: { checks: number; encode: number; hash: number };
}
