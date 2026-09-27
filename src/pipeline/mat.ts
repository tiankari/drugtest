// MAT v1: geometry and design colours of the printed reference colour card.
//
// Single source of truth. The print generator draws from this, and the
// pipeline uses the same numbers as canonical coordinates after
// rectification. All lengths in millimetres, origin at the card's top-left
// corner, y pointing down, card in portrait orientation.
//
// Design colours are what we SEND to the printer. They are not what the
// printer produces: each printed copy is photographed and registered, and
// correction targets the registered values (relative calibration).

import type { Vec3 } from './colour.ts';

export interface RectMm {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export type Corner = 'TL' | 'TR' | 'BR' | 'BL';
export type Side = 'top' | 'right' | 'bottom' | 'left';
export type PatchRole = 'neutral' | 'white' | 'chromatic' | 'primary';

export interface MarkerSpec {
  readonly corner: Corner;
  readonly rect: RectMm;
  /** White square in the centre; only the TL marker has one (orientation key). */
  readonly hole: RectMm | null;
}

export interface PatchSpec {
  readonly id: string;
  readonly name: string;
  readonly role: PatchRole;
  /** Colour family the patch stands in for (reaction colours these kits produce). */
  readonly family: string;
  /** Design colour sent to the printer, 8-bit sRGB. */
  readonly design: Vec3;
  readonly side: Side;
  /** Index along its side, clockwise order is not implied. */
  readonly index: number;
  readonly rect: RectMm;
}

export interface MatLayout {
  readonly version: number;
  readonly label: string;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly markers: readonly MarkerSpec[];
  readonly patches: readonly PatchSpec[];
  readonly idStrip: { readonly frame: RectMm; readonly cells: readonly RectMm[] };
  readonly sampleZone: RectMm;
  readonly scaleBar: { readonly rect: RectMm; readonly lengthMm: number; readonly segmentMm: number };
}

export const MAT_V1_VERSION = 1;

const CARD_W = 105;
const CARD_H = 148;
const MARKER = 12;
const MARGIN = 4;
const HOLE = 4;
const PATCH = 10;

// Top/bottom rows: 6 patches between the corner markers, 2.5 mm quiet zone to each marker.
const ROW_X0 = 18.5;
const ROW_PITCH = 11.6;
const TOP_ROW_Y = 5;
const BOTTOM_ROW_Y = 133;
// Side columns: 9 patches between the corner markers, 3 mm quiet zone to each marker.
const COL_Y0 = 19;
const COL_PITCH = 12.5;
const LEFT_COL_X = 5;
const RIGHT_COL_X = 90;

type PatchDef = readonly [id: string, name: string, role: PatchRole, family: string, hex: string];

const W = (id: string): PatchDef => [id, 'White (paper)', 'white', 'white', 'FFFFFF'];

// Neutral ramp hex values are CIELAB L* = 100, 82, 65, 49, 34, 20 (a* = b* = 0)
// converted with labToSrgb8, then frozen here so MAT v1 can never drift.
const TOP: readonly PatchDef[] = [
  ['Y1', 'Lemon yellow', 'chromatic', 'yellow', 'F5E050'],
  ['O2', 'Deep orange', 'chromatic', 'orange', 'E06A1E'],
  ['P1', 'Magenta purple', 'chromatic', 'purple', 'A23D7F'],
  W('W_T'),
  ['BL1', 'Medium blue', 'chromatic', 'blue', '3F72C0'],
  ['Y2', 'Turmeric yellow', 'chromatic', 'yellow', 'E8A820'],
];
const RIGHT: readonly PatchDef[] = [
  ['V2', 'Lavender', 'chromatic', 'violet', 'A897D6'],
  W('W_R1'),
  ['R', 'Primary red', 'primary', 'red', 'D02828'],
  ['BR1', 'Medium brown', 'chromatic', 'brown', '9A6A40'],
  ['BG1', 'Teal', 'chromatic', 'blue-green', '1F8A8A'],
  ['P2', 'Deep purple', 'chromatic', 'purple', '5E2A6E'],
  ['G', 'Primary green', 'primary', 'green', '2E9A40'],
  W('W_R2'),
  ['BG2', 'Sea green', 'chromatic', 'blue-green', '5DB8A4'],
];
// Bottom row listed left to right.
const BOTTOM: readonly PatchDef[] = [
  ['RB2', 'Maroon brown', 'chromatic', 'reddish-brown', '8A3324'],
  ['BL2', 'Dark blue', 'chromatic', 'blue', '23386E'],
  W('W_B'),
  ['BR2', 'Dark brown', 'chromatic', 'brown', '5E3B22'],
  ['B', 'Primary blue', 'primary', 'blue', '2A3C9C'],
  ['V1', 'Blue violet', 'chromatic', 'violet', '6A4FB0'],
];
const LEFT: readonly PatchDef[] = [
  ['N1', 'Neutral 1 (white, L*100)', 'neutral', 'neutral', 'FFFFFF'],
  ['N2', 'Neutral 2 (L*82)', 'neutral', 'neutral', 'CCCCCC'],
  ['N3', 'Neutral 3 (L*65)', 'neutral', 'neutral', '9E9E9E'],
  ['N4', 'Neutral 4 (L*49)', 'neutral', 'neutral', '747474'],
  ['N5', 'Neutral 5 (L*34)', 'neutral', 'neutral', '505050'],
  ['N6', 'Neutral 6 (near-black, L*20)', 'neutral', 'neutral', '303030'],
  ['RB1', 'Rust red-brown', 'chromatic', 'reddish-brown', 'B5452A'],
  W('W_L'),
  ['O1', 'Light orange', 'chromatic', 'orange', 'F2A05A'],
];

function hexToRgb(hex: string): Vec3 {
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function buildPatches(): PatchSpec[] {
  const out: PatchSpec[] = [];
  const add = (defs: readonly PatchDef[], side: Side, rectFor: (i: number) => RectMm) => {
    defs.forEach(([id, name, role, family, hex], i) => {
      out.push({ id, name, role, family, design: hexToRgb(hex), side, index: i, rect: rectFor(i) });
    });
  };
  add(TOP, 'top', (i) => ({ x: ROW_X0 + i * ROW_PITCH, y: TOP_ROW_Y, w: PATCH, h: PATCH }));
  add(RIGHT, 'right', (i) => ({ x: RIGHT_COL_X, y: COL_Y0 + i * COL_PITCH, w: PATCH, h: PATCH }));
  add(BOTTOM, 'bottom', (i) => ({ x: ROW_X0 + i * ROW_PITCH, y: BOTTOM_ROW_Y, w: PATCH, h: PATCH }));
  add(LEFT, 'left', (i) => ({ x: LEFT_COL_X, y: COL_Y0 + i * COL_PITCH, w: PATCH, h: PATCH }));
  return out;
}

const ID_CELL = 5;
const ID_CELLS = 9;
const ID_X0 = (CARD_W - ID_CELL * ID_CELLS) / 2;
const ID_Y0 = 19;

export const MAT_V1: MatLayout = {
  version: MAT_V1_VERSION,
  label: 'MAT v1',
  widthMm: CARD_W,
  heightMm: CARD_H,
  markers: [
    {
      corner: 'TL',
      rect: { x: MARGIN, y: MARGIN, w: MARKER, h: MARKER },
      hole: { x: MARGIN + (MARKER - HOLE) / 2, y: MARGIN + (MARKER - HOLE) / 2, w: HOLE, h: HOLE },
    },
    { corner: 'TR', rect: { x: CARD_W - MARGIN - MARKER, y: MARGIN, w: MARKER, h: MARKER }, hole: null },
    { corner: 'BR', rect: { x: CARD_W - MARGIN - MARKER, y: CARD_H - MARGIN - MARKER, w: MARKER, h: MARKER }, hole: null },
    { corner: 'BL', rect: { x: MARGIN, y: CARD_H - MARGIN - MARKER, w: MARKER, h: MARKER }, hole: null },
  ],
  patches: buildPatches(),
  idStrip: {
    frame: { x: ID_X0, y: ID_Y0, w: ID_CELL * ID_CELLS, h: ID_CELL },
    cells: Array.from({ length: ID_CELLS }, (_, k) => ({ x: ID_X0 + k * ID_CELL, y: ID_Y0, w: ID_CELL, h: ID_CELL })),
  },
  sampleZone: { x: (CARD_W - 70) / 2, y: 38, w: 70, h: 70 },
  scaleBar: { rect: { x: (CARD_W - 50) / 2, y: 112, w: 50, h: 1.6 }, lengthMm: 50, segmentMm: 10 },
};

// ---------------------------------------------------------------------------
// ID strip codec. 9 cells read left to right on the upright card:
//   cells 0-3: mat version 1..14, most significant bit first
//   cells 4-7: copy index, A = 1 ... N = 14
//   cell  8  : parity, chosen so the number of BLACK cells is ODD.
// 0 and 15 are never issued in either field. With odd parity that means an
// all-white strip (missing, washed out) and an all-black strip (shadowed,
// covered) both fail to decode. true = black cell = bit 1.

export const COPY_LETTERS = 'ABCDEFGHIJKLMN';

export function copyIndex(letter: string): number {
  const i = COPY_LETTERS.indexOf(letter.toUpperCase());
  if (letter.length !== 1 || i < 0) throw new Error(`Copy letter must be one of ${COPY_LETTERS}, got "${letter}"`);
  return i + 1;
}

export function encodeMatId(version: number, copyLetter: string): boolean[] {
  if (!Number.isInteger(version) || version < 1 || version > 14) throw new Error(`Mat version must be 1..14, got ${version}`);
  const c = copyIndex(copyLetter);
  const bits: boolean[] = [];
  for (let b = 3; b >= 0; b--) bits.push(((version >> b) & 1) === 1);
  for (let b = 3; b >= 0; b--) bits.push(((c >> b) & 1) === 1);
  const ones = bits.filter(Boolean).length;
  bits.push(ones % 2 === 0); // make the total count odd
  return bits;
}

export type MatIdResult =
  | { ok: true; version: number; copy: string }
  | { ok: false; reason: 'parity' | 'version-reserved' | 'copy-reserved' | 'length' };

export function decodeMatId(bits: readonly boolean[]): MatIdResult {
  if (bits.length !== ID_CELLS) return { ok: false, reason: 'length' };
  if (bits.filter(Boolean).length % 2 !== 1) return { ok: false, reason: 'parity' };
  let version = 0;
  let copy = 0;
  for (let i = 0; i < 4; i++) version = (version << 1) | (bits[i] ? 1 : 0);
  for (let i = 4; i < 8; i++) copy = (copy << 1) | (bits[i] ? 1 : 0);
  if (version === 0 || version === 15) return { ok: false, reason: 'version-reserved' };
  if (copy === 0 || copy === 15) return { ok: false, reason: 'copy-reserved' };
  return { ok: true, version, copy: COPY_LETTERS[copy - 1] };
}

export function rectCentre(r: RectMm): readonly [number, number] {
  return [r.x + r.w / 2, r.y + r.h / 2];
}
