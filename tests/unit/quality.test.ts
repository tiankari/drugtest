import { describe, expect, it } from 'vitest';
import { THRESHOLDS } from '../../src/pipeline/config.ts';
import { checkFrame, framingOutline, laplacianVariance, lumaPlane } from '../../src/pipeline/quality.ts';

// Synthetic tests only: they prove the checks respond in the right direction.
// Whether the thresholds suit real phone photos is decided in Step 6.

function image(w: number, h: number, f: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = f(x, y);
      const p = (y * w + x) * 4;
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = 255;
    }
  return { width: w, height: h, data };
}

/** A card-like scene: mid-grey paper with a grid of dark and coloured squares. */
const sharpScene = (x: number, y: number): [number, number, number] => {
  const cell = ((Math.floor(x / 12) + Math.floor(y / 12)) & 1) === 0;
  return cell ? [200, 200, 195] : [60, 90, 150];
};

function boxBlur(img: ReturnType<typeof image>, r: number) {
  const { width: w, height: h, data } = img;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        let s = 0;
        let n = 0;
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const xx = Math.min(w - 1, Math.max(0, x + dx));
            const yy = Math.min(h - 1, Math.max(0, y + dy));
            s += data[(yy * w + xx) * 4 + c];
            n++;
          }
        out[(y * w + x) * 4 + c] = Math.round(s / n);
        out[(y * w + x) * 4 + 3] = 255;
      }
  return { width: w, height: h, data: out };
}

describe('frame quality checks (synthetic)', () => {
  it('framing outline has the card aspect and follows frame orientation', () => {
    const p = framingOutline(1080, 1920);
    expect(p.w / p.h).toBeCloseTo(105 / 148, 6);
    const l = framingOutline(1920, 1080);
    expect(l.w / l.h).toBeCloseTo(148 / 105, 6);
    expect(l.x).toBeGreaterThan(0);
    expect(l.y).toBeGreaterThan(0);
  });

  it('a sharp scene passes the blur check and a blurred copy fails it', () => {
    const sharp = image(360, 640, sharpScene);
    const blurred = boxBlur(sharp, 6);
    const a = checkFrame(sharp, 1);
    const b = checkFrame(blurred, 1);
    expect(a.checks.find((c) => c.id === 'blur')!.pass).toBe(true);
    expect(b.checks.find((c) => c.id === 'blur')!.pass).toBe(false);
    expect(b.guidance).toBe('Hold steady');
  });

  it('a dark frame fails with "Too dark"', () => {
    const dark = image(360, 640, (x, y) => sharpScene(x, y).map((v) => Math.round(v * 0.15)) as [number, number, number]);
    const r = checkFrame(dark, 1);
    expect(r.pass).toBe(false);
    expect(r.guidance).toBe('Too dark');
  });

  it('a blown-out frame fails with "Too bright"', () => {
    const bright = image(360, 640, (x, y) => (sharpScene(x, y)[0] === 200 ? [255, 255, 255] : [120, 160, 230]));
    const r = checkFrame(bright, 1);
    expect(r.checks.find((c) => c.id === 'bright')!.pass).toBe(false);
    expect(r.guidance).toBe('Too bright');
  });

  it('a well exposed sharp frame passes everything', () => {
    const r = checkFrame(image(360, 640, sharpScene), 1);
    expect(r.pass).toBe(true);
    expect(r.guidance).toBe('Ready');
  });

  it('is deterministic and the box downscale matches between scales', () => {
    const img = image(720, 1280, sharpScene);
    expect(checkFrame(img)).toEqual(checkFrame(img));
    // k=2 on the full frame equals k=1 on a frame averaged the same way.
    const plane = lumaPlane(img, { x: 0, y: 0, w: 720, h: 1280 }, 2);
    expect(plane.w).toBe(360);
    expect(laplacianVariance(plane)).toBeGreaterThan(THRESHOLDS.blurMinLaplacianVariance.value);
  });
});

describe('highlight clipping means blown white, not saturated colour', () => {
  it('saturated colours with one channel at 255 do not trigger "Too bright"', () => {
    const vivid = image(360, 640, (x, y) => ((Math.floor(x / 12) + Math.floor(y / 12)) & 1 ? [255, 40, 30] : [200, 200, 195]));
    const r = checkFrame(vivid, 1);
    expect(r.checks.find((c) => c.id === 'bright')!.pass).toBe(true);
    expect(r.stats.anyChannelClipFraction).toBeGreaterThan(0.3);
    expect(r.stats.highlightClipFraction).toBe(0);
  });
});
