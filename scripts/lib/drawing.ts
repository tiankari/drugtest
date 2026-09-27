// Minimal vector drawing model shared by the SVG and PDF writers.
// Units are millimetres, origin top-left, y down.

import type { Vec3 } from '../../src/pipeline/colour.ts';

export type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill?: Vec3; stroke?: Vec3; strokeWidth?: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: Vec3; strokeWidth: number }
  | {
      kind: 'text';
      x: number;
      /** Baseline y. */
      y: number;
      sizePt: number;
      text: string;
      bold?: boolean;
      fill?: Vec3;
      anchor?: 'start' | 'middle' | 'end';
    }
  | { kind: 'group'; translate: readonly [number, number]; rotateDeg: 0 | 90; children: Shape[] };

export interface Drawing {
  title: string;
  widthMm: number;
  heightMm: number;
  shapes: Shape[];
}

export const BLACK: Vec3 = [0, 0, 0];
export const WHITE: Vec3 = [255, 255, 255];

export const PT_TO_MM = 25.4 / 72;

/**
 * Rough Helvetica advance width in em, only used to centre or right-align
 * text in the PDF (PDF has no text-anchor). Cosmetic: it never affects any
 * geometry the pipeline reads.
 */
export function approxTextWidthMm(text: string, sizePt: number, bold = false): number {
  let em = 0;
  for (const ch of text) {
    if (ch === ' ') em += 0.28;
    else if (/[0-9]/.test(ch)) em += 0.556;
    else if (/[A-Z]/.test(ch)) em += ch === 'M' || ch === 'W' ? 0.85 : ch === 'I' ? 0.3 : 0.68;
    else if (/[a-z]/.test(ch)) em += /[ijl]/.test(ch) ? 0.24 : /[mw]/.test(ch) ? 0.8 : 0.53;
    else em += 0.33;
  }
  return em * sizePt * PT_TO_MM * (bold ? 1.05 : 1);
}
