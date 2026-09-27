// Generates the printable reference colour card (MAT v1):
//   print/mat_v1_<copy>.svg / .pdf   A6, one copy per file
//   print/mat_A4_sheet.pdf / .svg    copies A and B on one A4 page with crop marks
//   print/mat_v1_layout.json         geometry and design colours, for people and tools
// Run: npm run mat

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { srgb8ToLab } from '../src/pipeline/colour.ts';
import { MAT_V1, encodeMatId } from '../src/pipeline/mat.ts';
import { a4SheetDrawing, cardDrawing } from './lib/card.ts';
import { drawingToPdf } from './lib/pdf.ts';
import { drawingToSvg } from './lib/svg.ts';

const OUT = 'print';
const COPIES = ['A', 'B'] as const;

mkdirSync(OUT, { recursive: true });

for (const copy of COPIES) {
  const d = cardDrawing(MAT_V1, copy);
  writeFileSync(join(OUT, `mat_v1_${copy}.svg`), drawingToSvg(d));
  writeFileSync(join(OUT, `mat_v1_${copy}.pdf`), drawingToPdf(d));
}

const sheet = a4SheetDrawing(MAT_V1, COPIES);
writeFileSync(join(OUT, 'mat_A4_sheet.svg'), drawingToSvg(sheet));
writeFileSync(join(OUT, 'mat_A4_sheet.pdf'), drawingToPdf(sheet));

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const layoutJson = {
  note: 'Generated from src/pipeline/mat.ts. Design colours are what is sent to the printer, not what it prints; each copy must be registered.',
  version: MAT_V1.version,
  label: MAT_V1.label,
  sizeMm: [MAT_V1.widthMm, MAT_V1.heightMm],
  markers: MAT_V1.markers,
  sampleZone: MAT_V1.sampleZone,
  scaleBar: MAT_V1.scaleBar,
  idStrip: {
    ...MAT_V1.idStrip,
    encoding: 'cells 0-3 version (MSB first), cells 4-7 copy index A=1..O=15, cell 8 parity making the count of black cells odd',
    copies: Object.fromEntries(COPIES.map((c) => [c, encodeMatId(MAT_V1.version, c).map((b) => (b ? 1 : 0)).join('')])),
  },
  patches: MAT_V1.patches.map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    family: p.family,
    side: p.side,
    index: p.index,
    rectMm: p.rect,
    designSrgb8: p.design,
    designLabD65: srgb8ToLab(p.design).map((v) => round(v)),
  })),
};
writeFileSync(join(OUT, 'mat_v1_layout.json'), JSON.stringify(layoutJson, null, 2) + '\n');

console.log(`Wrote ${COPIES.length * 2 + 3} files to ${OUT}/ (${MAT_V1.patches.length} patches).`);
