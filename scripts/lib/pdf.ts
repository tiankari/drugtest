// Minimal single-page PDF 1.4 writer: filled/stroked rectangles, lines and
// text in the 14 standard fonts (Helvetica, Helvetica-Bold). Vector only,
// DeviceRGB, uncompressed content stream. No dependency.

import type { Vec3 } from '../../src/pipeline/colour.ts';
import { approxTextWidthMm, PT_TO_MM, type Drawing, type Shape } from './drawing.ts';

const MM_TO_PT = 72 / 25.4;
const f = (v: number) => (Math.round(v * 10000) / 10000).toString();
const rgb = (c: Vec3) => c.map((v) => f(v / 255)).join(' ');

function pdfString(s: string): string {
  if (!/^[\x20-\x7E]*$/.test(s)) throw new Error(`PDF writer only supports printable ASCII text, got: ${s}`);
  return '(' + s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') + ')';
}

function shapeOps(s: Shape, out: string[]): void {
  switch (s.kind) {
    case 'rect':
      if (s.fill) out.push(`${rgb(s.fill)} rg ${f(s.x)} ${f(s.y)} ${f(s.w)} ${f(s.h)} re f`);
      if (s.stroke) out.push(`${rgb(s.stroke)} RG ${f(s.strokeWidth ?? 0.25)} w ${f(s.x)} ${f(s.y)} ${f(s.w)} ${f(s.h)} re S`);
      return;
    case 'line':
      out.push(`${rgb(s.stroke)} RG ${f(s.strokeWidth)} w ${f(s.x1)} ${f(s.y1)} m ${f(s.x2)} ${f(s.y2)} l S`);
      return;
    case 'text': {
      const size = s.sizePt * PT_TO_MM; // user space is mm
      const width = approxTextWidthMm(s.text, s.sizePt, s.bold);
      const x = s.anchor === 'middle' ? s.x - width / 2 : s.anchor === 'end' ? s.x - width : s.x;
      // The page CTM flips y; the text matrix flips it back so glyphs stand upright.
      out.push(
        `BT ${rgb(s.fill ?? [0, 0, 0])} rg /${s.bold ? 'F2' : 'F1'} ${f(size)} Tf 1 0 0 -1 ${f(x)} ${f(s.y)} Tm ${pdfString(s.text)} Tj ET`,
      );
      return;
    }
    case 'group': {
      out.push('q');
      out.push(`1 0 0 1 ${f(s.translate[0])} ${f(s.translate[1])} cm`);
      if (s.rotateDeg === 90) out.push('0 1 -1 0 0 0 cm');
      for (const c of s.children) shapeOps(c, out);
      out.push('Q');
      return;
    }
  }
}

export function drawingToPdf(d: Drawing): Uint8Array {
  const wPt = d.widthMm * MM_TO_PT;
  const hPt = d.heightMm * MM_TO_PT;
  // Page CTM: millimetres, origin top-left, y down.
  const ops: string[] = [`${f(MM_TO_PT)} 0 0 ${f(-MM_TO_PT)} 0 ${f(hPt)} cm`];
  for (const s of d.shapes) shapeOps(s, ops);
  const content = ops.join('\n') + '\n';

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(wPt)} ${f(hPt)}] /TrimBox [0 0 ${f(wPt)} ${f(hPt)}] ` +
      '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Title ${pdfString(d.title)} /Creator (scripts/generate-mat.ts) /Producer (field-drug-test-companion) >>`,
  ];

  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${o.toString().padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  // Every character is in 0..255 (ASCII plus the binary comment), so Latin-1
  // bytes match the offsets computed on the string.
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i);
  return bytes;
}
