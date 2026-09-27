import type { Vec3 } from '../../src/pipeline/colour.ts';
import { PT_TO_MM, type Drawing, type Shape } from './drawing.ts';

const hex = (c: Vec3) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
const n = (v: number) => (Math.round(v * 1000) / 1000).toString();
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function shapeToSvg(s: Shape, indent: string): string {
  switch (s.kind) {
    case 'rect': {
      const fill = s.fill ? hex(s.fill) : 'none';
      const stroke = s.stroke ? ` stroke="${hex(s.stroke)}" stroke-width="${n(s.strokeWidth ?? 0.25)}"` : '';
      return `${indent}<rect x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}" fill="${fill}"${stroke}/>`;
    }
    case 'line':
      return `${indent}<line x1="${n(s.x1)}" y1="${n(s.y1)}" x2="${n(s.x2)}" y2="${n(s.y2)}" stroke="${hex(s.stroke)}" stroke-width="${n(s.strokeWidth)}"/>`;
    case 'text': {
      const anchor = s.anchor && s.anchor !== 'start' ? ` text-anchor="${s.anchor}"` : '';
      const weight = s.bold ? ' font-weight="bold"' : '';
      return `${indent}<text x="${n(s.x)}" y="${n(s.y)}" font-family="Helvetica, Arial, sans-serif" font-size="${n(s.sizePt * PT_TO_MM)}"${weight}${anchor} fill="${hex(s.fill ?? [0, 0, 0])}">${esc(s.text)}</text>`;
    }
    case 'group': {
      const t = `translate(${n(s.translate[0])} ${n(s.translate[1])})${s.rotateDeg ? ` rotate(${s.rotateDeg})` : ''}`;
      const inner = s.children.map((c) => shapeToSvg(c, indent + '  ')).join('\n');
      return `${indent}<g transform="${t}">\n${inner}\n${indent}</g>`;
    }
  }
}

export function drawingToSvg(d: Drawing): string {
  const body = d.shapes.map((s) => shapeToSvg(s, '  ')).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(d.widthMm)}mm" height="${n(d.heightMm)}mm" viewBox="0 0 ${n(d.widthMm)} ${n(d.heightMm)}">`,
    `  <title>${esc(d.title)}</title>`,
    body,
    '</svg>',
    '',
  ].join('\n');
}
