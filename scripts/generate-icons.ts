// App icons: the MAT v1 card itself, rasterised from the layout, on the app's
// dark background. Written with our own PNG encoder. Run: npm run icons

import { mkdirSync, writeFileSync } from 'node:fs';
import { encodePng } from '../src/io/png.ts';
import { MAT_V1, type RectMm } from '../src/pipeline/mat.ts';

type RGB = readonly [number, number, number];

function icon(size: number, cardFraction: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  const fill = (x0: number, y0: number, x1: number, y1: number, c: RGB) => {
    for (let y = Math.max(0, Math.round(y0)); y < Math.min(size, Math.round(y1)); y++) {
      for (let x = Math.max(0, Math.round(x0)); x < Math.min(size, Math.round(x1)); x++) {
        const p = (y * size + x) * 4;
        data[p] = c[0];
        data[p + 1] = c[1];
        data[p + 2] = c[2];
        data[p + 3] = 255;
      }
    }
  };
  fill(0, 0, size, size, [16, 20, 24]);
  const s = (size * cardFraction) / MAT_V1.heightMm; // px per mm
  const ox = (size - MAT_V1.widthMm * s) / 2;
  const oy = (size - MAT_V1.heightMm * s) / 2;
  const rect = (r: RectMm, c: RGB) => fill(ox + r.x * s, oy + r.y * s, ox + (r.x + r.w) * s, oy + (r.y + r.h) * s, c);

  rect({ x: 0, y: 0, w: MAT_V1.widthMm, h: MAT_V1.heightMm }, [255, 255, 255]);
  for (const m of MAT_V1.markers) {
    rect(m.rect, [0, 0, 0]);
    if (m.hole) rect(m.hole, [255, 255, 255]);
  }
  for (const p of MAT_V1.patches) {
    const white = p.design[0] === 255 && p.design[1] === 255 && p.design[2] === 255;
    rect(p.rect, white ? [228, 228, 228] : p.design);
  }
  const z = MAT_V1.sampleZone;
  const t = 1.2;
  rect({ x: z.x, y: z.y, w: z.w, h: t }, [0, 0, 0]);
  rect({ x: z.x, y: z.y + z.h - t, w: z.w, h: t }, [0, 0, 0]);
  rect({ x: z.x, y: z.y, w: t, h: z.h }, [0, 0, 0]);
  rect({ x: z.x + z.w - t, y: z.y, w: t, h: z.h }, [0, 0, 0]);
  return encodePng({ width: size, height: size, data }).png;
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', icon(192, 0.9));
writeFileSync('public/icons/icon-512.png', icon(512, 0.9));
// Maskable icons may be cropped to a circle of 80% diameter; 0.64 keeps the card's corners inside it.
writeFileSync('public/icons/icon-maskable-512.png', icon(512, 0.64));
console.log('Wrote public/icons/*.png');
