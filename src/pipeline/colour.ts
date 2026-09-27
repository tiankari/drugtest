// Colour space conversions. Pure float64 maths, no DOM, no Node.
//
// sRGB per IEC 61966-2-1 (piecewise transfer function, D65 white).
// XYZ and CIELAB use the D65 white point, derived from its CIE 1931
// chromaticity (x, y) = (0.3127, 0.3290), so sRGB white maps exactly to
// L* = 100, a* = b* = 0. No chromatic adaptation is applied anywhere.
//
// Constants are taken from the W3C CSS Color Module Level 4 sample code
// (rational-form matrices, CIE rational epsilon/kappa); see
// docs/references/w3c-css-color-4-excerpt.txt. CSS uses a D50 Lab; this
// project deliberately uses the same Lab formula with the D65 white.

export type Vec3 = readonly [number, number, number];

/** D65 reference white in XYZ with Y = 1. */
export const D65_WHITE: Vec3 = [0.3127 / 0.329, 1.0, (1.0 - 0.3127 - 0.329) / 0.329];

/** Linear sRGB (D65) to CIE XYZ (D65), row-major. */
export const M_LINEAR_SRGB_TO_XYZ: readonly Vec3[] = [
  [506752 / 1228815, 87881 / 245763, 12673 / 70218],
  [87098 / 409605, 175762 / 245763, 12673 / 175545],
  [7918 / 409605, 87881 / 737289, 1001167 / 1053270],
];

/** CIE XYZ (D65) to linear sRGB (D65), row-major. */
export const M_XYZ_TO_LINEAR_SRGB: readonly Vec3[] = [
  [12831 / 3959, -329 / 214, -1974 / 3959],
  [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
  [705 / 12673, -2585 / 12673, 705 / 667],
];

const LAB_EPSILON = 216 / 24389;
const LAB_KAPPA = 24389 / 27;

/** sRGB-encoded component in [0, 1] to linear light. Extended to negatives by reflection. */
export function srgbToLinear(v: number): number {
  const a = Math.abs(v);
  if (a <= 0.04045) return v / 12.92;
  return Math.sign(v) * Math.pow((a + 0.055) / 1.055, 2.4);
}

/** Linear-light component to sRGB encoding. Extended to negatives by reflection. */
export function linearToSrgb(v: number): number {
  const a = Math.abs(v);
  if (a > 0.0031308) return Math.sign(v) * (1.055 * Math.pow(a, 1 / 2.4) - 0.055);
  return 12.92 * v;
}

export function mulMat3(m: readonly Vec3[], v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

export function linearRgbToXyz(rgb: Vec3): Vec3 {
  return mulMat3(M_LINEAR_SRGB_TO_XYZ, rgb);
}

export function xyzToLinearRgb(xyz: Vec3): Vec3 {
  return mulMat3(M_XYZ_TO_LINEAR_SRGB, xyz);
}

export function xyzToLab(xyz: Vec3, white: Vec3 = D65_WHITE): Vec3 {
  const f = (t: number) => (t > LAB_EPSILON ? Math.cbrt(t) : (LAB_KAPPA * t + 16) / 116);
  const fx = f(xyz[0] / white[0]);
  const fy = f(xyz[1] / white[1]);
  const fz = f(xyz[2] / white[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToXyz(lab: Vec3, white: Vec3 = D65_WHITE): Vec3 {
  const fy = (lab[0] + 16) / 116;
  const fx = lab[1] / 500 + fy;
  const fz = fy - lab[2] / 200;
  const fx3 = fx * fx * fx;
  const fz3 = fz * fz * fz;
  const x = fx3 > LAB_EPSILON ? fx3 : (116 * fx - 16) / LAB_KAPPA;
  const y = lab[0] > LAB_KAPPA * LAB_EPSILON ? fy * fy * fy : lab[0] / LAB_KAPPA;
  const z = fz3 > LAB_EPSILON ? fz3 : (116 * fz - 16) / LAB_KAPPA;
  return [x * white[0], y * white[1], z * white[2]];
}

/** 8-bit sRGB triple to linear RGB in [0, 1]. */
export function srgb8ToLinear(rgb: Vec3): Vec3 {
  return [srgbToLinear(rgb[0] / 255), srgbToLinear(rgb[1] / 255), srgbToLinear(rgb[2] / 255)];
}

export function srgb8ToLab(rgb: Vec3): Vec3 {
  return xyzToLab(linearRgbToXyz(srgb8ToLinear(rgb)));
}

/** CIELAB to 8-bit sRGB, rounded and clipped. `clipped` reports whether any channel left [0, 255]. */
export function labToSrgb8(lab: Vec3): { rgb: Vec3; clipped: boolean } {
  const lin = xyzToLinearRgb(labToXyz(lab));
  let clipped = false;
  const enc = lin.map((c) => {
    const v = Math.round(linearToSrgb(c) * 255);
    if (v < 0 || v > 255) clipped = true;
    return Math.min(255, Math.max(0, v));
  });
  return { rgb: [enc[0], enc[1], enc[2]], clipped };
}

/** Relative luminance Y (D65, Y of white = 1) of a linear RGB triple. */
export function linearLuminance(rgb: Vec3): number {
  const m = M_LINEAR_SRGB_TO_XYZ[1];
  return m[0] * rgb[0] + m[1] * rgb[1] + m[2] * rgb[2];
}
