// The pipeline's only input type: a plain RGBA pixel buffer.

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** Row-major RGBA, 8 bits per channel, length width * height * 4. */
  readonly data: Uint8Array | Uint8ClampedArray;
}

export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Luma of gamma-encoded 8-bit RGB (Rec. 601 weights), exact in float64. */
export function luma601(r: number, g: number, b: number): number {
  return (299 * r + 587 * g + 114 * b) / 1000;
}

/** Clamp a rectangle to integer pixel bounds inside the image. */
export function clampRect(r: PixelRect, width: number, height: number): PixelRect {
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(width, Math.ceil(r.x + r.w));
  const y1 = Math.min(height, Math.ceil(r.y + r.h));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}
