// Bundled sample images ("No card? Try a sample"). They are ordinary files of
// the build (precached for offline use). Running one decodes it with the
// app's own strict PNG decoder, checks its pixels against its sidecar, and
// sends the pixels through the SAME capture worker as a camera frame: same
// card checks, correction, sample reading and classification. Nothing is
// hard-coded; the expected outcome is only a label.

import { SIDECAR_SCHEMA, type CaptureSidecar } from '../io/dataset.ts';
import { sha256Hex } from '../io/hash.ts';
import { decodePng } from '../io/png.ts';
import type { SampleSidecar } from '../io/samples.ts';
import { THRESHOLDS } from '../pipeline/config.ts';
import { processFrame } from './capture.ts';
import { setCurrentCapture } from './current.ts';

const pngs = import.meta.glob<string>('../../samples/*.png', { eager: true, query: '?url', import: 'default' });
const metas = import.meta.glob<{ default: SampleSidecar }>('../../samples/*.json', { eager: true });
const ORDER = ['empty-card', 'orange-cap', 'drawn-opiate', 'blurred'];

export interface BundledSample extends SampleSidecar {
  url: string;
}

export const SAMPLES: BundledSample[] = Object.entries(metas)
  .map(([path, m]) => ({ ...m.default, url: pngs[path.replace(/\.json$/, '.png')] }))
  .filter((s) => !!s.url)
  .sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));

function rank(id: string): number {
  const i = ORDER.indexOf(id);
  return i < 0 ? ORDER.length : i;
}

export function sampleKindText(kind: SampleSidecar['kind']): string {
  return kind === 'sample-drawn' ? 'Computer-drawn image' : 'Real photo';
}

/** Run one sample through the real capture path and make it the current capture. */
export async function runSample(s: BundledSample): Promise<void> {
  const res = await fetch(s.url);
  if (!res.ok) throw new Error(`Could not load the sample image (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const img = decodePng(bytes);
  const pixelSha = await sha256Hex(img.data);
  if (pixelSha !== s.pixelSha256) throw new Error('The sample image does not match its record of pixels; it was changed');
  const frame = new ImageData(new Uint8ClampedArray(img.data.buffer as ArrayBuffer, img.data.byteOffset, img.data.byteLength), img.width, img.height);
  const enc = await processFrame(frame);
  const sidecar: CaptureSidecar = {
    schema: SIDECAR_SCHEMA,
    file: s.file,
    sha256: enc.sha256,
    pixelSha256: enc.pixelSha256,
    capturedAt: s.capturedAt,
    timezoneOffsetMinutes: -new Date(s.capturedAt).getTimezoneOffset(),
    app: { version: __APP_VERSION__, commit: __GIT_COMMIT__, buildTime: __BUILD_TIME__ },
    mode: 'normal',
    dataCollection: null,
    image: { width: img.width, height: img.height, pixelFormat: 'RGBA8', source: `bundled sample image ${s.file} (${sampleKindText(s.kind)}): ${s.note}`, png: enc.info },
    camera: { label: 'none: bundled sample image', requested: {}, videoWidth: img.width, videoHeight: img.height, settings: {}, capabilities: null, torchOn: false, lock: null },
    checks: {
      pass: enc.report.pass,
      guidance: enc.report.guidance,
      results: enc.report.checks,
      stats: enc.report.stats,
      thresholds: Object.fromEntries(Object.entries(THRESHOLDS).map(([k, v]) => [k, { value: v.value, status: v.status }])),
    },
    analysis: null,
    device: { userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, screen: { width: screen.width, height: screen.height }, orientation: screen.orientation?.type ?? null },
    timingsMs: enc.timingsMs,
  };
  setCurrentCapture({
    sidecar,
    png: enc.png,
    analysis: enc.analysis,
    sample: enc.sample,
    rectified: enc.rectified,
    geo: { kind: 'unavailable', reason: 'sample image, not taken with this phone' },
    savedSeq: null,
    source: s.kind,
    sampleImage: s,
  });
}
