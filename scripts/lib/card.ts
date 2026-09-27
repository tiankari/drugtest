// Builds the vector drawing of one printed copy of the reference colour card
// from the MAT layout (src/pipeline/mat.ts). Nothing here invents geometry:
// every position the pipeline reads comes from the layout.

import type { Vec3 } from '../../src/pipeline/colour.ts';
import { encodeMatId, type MatLayout } from '../../src/pipeline/mat.ts';
import { BLACK, WHITE, type Drawing, type Shape } from './drawing.ts';

const OUTLINE_GREY: Vec3 = [150, 150, 150];

export function cardShapes(layout: MatLayout, copy: string): Shape[] {
  const s: Shape[] = [];
  const { widthMm: W, sampleZone: z, scaleBar } = layout;

  s.push({ kind: 'rect', x: 0, y: 0, w: W, h: layout.heightMm, fill: WHITE });

  for (const m of layout.markers) {
    s.push({ kind: 'rect', ...m.rect, fill: BLACK });
    if (m.hole) s.push({ kind: 'rect', ...m.hole, fill: WHITE });
  }

  for (const p of layout.patches) {
    const isPaper = p.design[0] === 255 && p.design[1] === 255 && p.design[2] === 255;
    // White patches are bare paper; a hairline grey outline at the patch edge
    // shows people where they are. Sampling stays well inside the edge.
    s.push({ kind: 'rect', ...p.rect, fill: p.design, ...(isPaper ? { stroke: OUTLINE_GREY, strokeWidth: 0.15 } : {}) });
  }

  // ID strip
  const bits = encodeMatId(layout.version, copy);
  layout.idStrip.cells.forEach((c, i) => s.push({ kind: 'rect', ...c, fill: bits[i] ? BLACK : WHITE }));
  s.push({ kind: 'rect', ...layout.idStrip.frame, stroke: BLACK, strokeWidth: 0.25 });

  // Labels
  const labelY = layout.idStrip.frame.y + layout.idStrip.frame.h + 6.2;
  s.push({ kind: 'text', x: z.x, y: labelY, sizePt: 12, bold: true, text: layout.label });
  s.push({ kind: 'text', x: z.x + z.w, y: labelY, sizePt: 12, bold: true, text: `COPY ${copy}`, anchor: 'end' });
  s.push({ kind: 'text', x: W / 2, y: z.y - 1.6, sizePt: 6.5, text: 'SAMPLE ZONE - stand the test here', anchor: 'middle' });

  // Sample zone outline, drawn just outside the 70 mm interior so the interior stays full size.
  const sw = 0.4;
  s.push({ kind: 'rect', x: z.x - sw / 2, y: z.y - sw / 2, w: z.w + sw, h: z.h + sw, stroke: BLACK, strokeWidth: sw });

  // 50 mm scale bar: alternating 10 mm segments, end ticks, labels.
  const b = scaleBar.rect;
  const segs = Math.round(scaleBar.lengthMm / scaleBar.segmentMm);
  for (let i = 0; i < segs; i++) {
    s.push({ kind: 'rect', x: b.x + i * scaleBar.segmentMm, y: b.y, w: scaleBar.segmentMm, h: b.h, fill: i % 2 === 0 ? BLACK : WHITE });
  }
  s.push({ kind: 'rect', ...b, stroke: BLACK, strokeWidth: 0.15 });
  for (const x of [b.x, b.x + b.w]) s.push({ kind: 'line', x1: x, y1: b.y - 1, x2: x, y2: b.y + b.h + 1, stroke: BLACK, strokeWidth: 0.2 });
  const tickLabelY = b.y + b.h + 3.6;
  s.push({ kind: 'text', x: b.x, y: tickLabelY, sizePt: 6.5, text: '0', anchor: 'middle' });
  s.push({ kind: 'text', x: b.x + b.w, y: tickLabelY, sizePt: 6.5, text: '50 mm', anchor: 'middle' });
  s.push({ kind: 'text', x: W / 2, y: tickLabelY, sizePt: 6.5, text: 'check with a ruler', anchor: 'middle' });

  // Footer
  s.push({ kind: 'text', x: W / 2, y: 123, sizePt: 6, bold: true, text: 'REFERENCE COLOUR CARD', anchor: 'middle' });
  s.push({ kind: 'text', x: W / 2, y: 126.4, sizePt: 5.5, text: 'Colour print at 100%. Do not laminate. Register before use.', anchor: 'middle' });
  s.push({ kind: 'text', x: W / 2, y: 129.4, sizePt: 5.5, text: 'Presumptive field aid only - not a laboratory result.', anchor: 'middle' });

  return s;
}

export function cardDrawing(layout: MatLayout, copy: string): Drawing {
  return {
    title: `${layout.label} reference colour card, copy ${copy} (A6, 105 x 148 mm)`,
    widthMm: layout.widthMm,
    heightMm: layout.heightMm,
    shapes: cardShapes(layout, copy),
  };
}

/**
 * A4 portrait sheet with two copies, each rotated 90 degrees, stacked with
 * crop marks. A4 prints at 100% far more reliably than A6.
 */
export function a4SheetDrawing(layout: MatLayout, copies: readonly [string, string]): Drawing {
  const PAGE_W = 210;
  const PAGE_H = 297;
  const GAP = 15;
  const cardWOnPage = layout.heightMm; // rotated
  const cardHOnPage = layout.widthMm;
  const x0 = (PAGE_W - cardWOnPage) / 2;
  const y0 = (PAGE_H - (2 * cardHOnPage + GAP)) / 2;
  const shapes: Shape[] = [];

  shapes.push({ kind: 'text', x: PAGE_W / 2, y: y0 - 20, sizePt: 11, bold: true, text: `${layout.label} reference colour card - copies ${copies[0]} and ${copies[1]}`, anchor: 'middle' });
  shapes.push({ kind: 'text', x: PAGE_W / 2, y: y0 - 14, sizePt: 8, text: 'Print in COLOUR on A4 at Actual size / 100%. Turn OFF fit-to-page. Matte card, 250-300 gsm. No lamination.', anchor: 'middle' });
  shapes.push({ kind: 'text', x: PAGE_W / 2, y: y0 - 9.5, sizePt: 8, text: 'Measure the 50 mm scale bar on each card with a ruler. Cut on the crop marks. Register each copy in the app before use.', anchor: 'middle' });

  copies.forEach((copy, i) => {
    const top = y0 + i * (cardHOnPage + GAP);
    // rotate(90): card (x, y) -> page (tx - y, ty + x); card spans page x in [tx - 148, tx].
    shapes.push({ kind: 'group', translate: [x0 + cardWOnPage, top], rotateDeg: 90, children: cardShapes(layout, copy) });
    shapes.push(...cropMarks(x0, top, x0 + cardWOnPage, top + cardHOnPage));
  });

  shapes.push({ kind: 'text', x: PAGE_W / 2, y: PAGE_H - 12, sizePt: 6, text: 'Generated by scripts/generate-mat.ts from the layout in src/pipeline/mat.ts. Never swap in a new print without registering it.', anchor: 'middle' });

  return { title: `${layout.label} reference colour card, A4 sheet, copies ${copies.join(' and ')}`, widthMm: PAGE_W, heightMm: PAGE_H, shapes };
}

function cropMarks(x0: number, y0: number, x1: number, y1: number): Shape[] {
  const OFF = 2;
  const LEN = 5;
  const sw = 0.25;
  const out: Shape[] = [];
  for (const [x, dx] of [[x0, -1], [x1, 1]] as const) {
    for (const [y, dy] of [[y0, -1], [y1, 1]] as const) {
      out.push({ kind: 'line', x1: x + dx * OFF, y1: y, x2: x + dx * (OFF + LEN), y2: y, stroke: BLACK, strokeWidth: sw });
      out.push({ kind: 'line', x1: x, y1: y + dy * OFF, x2: x, y2: y + dy * (OFF + LEN), stroke: BLACK, strokeWidth: sw });
    }
  }
  return out;
}
