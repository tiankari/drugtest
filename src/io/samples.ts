// Sample images bundled with the app ("No card? Try a sample"). Every
// sample runs through the real pipeline; its `expected` outcome is shown only
// as "what we expect", never as a result.

export const SAMPLE_SCHEMA = 'fdtc.sample.v1';

export type SampleKind = 'sample-photo' | 'sample-drawn';

export interface SampleSidecar {
  schema: typeof SAMPLE_SCHEMA;
  id: string;
  title: string;
  kind: SampleKind;
  /** What we expect the app to say (for the label only). */
  expected: string;
  /** The kit the sample is read with (and its expected outcome is for), whatever kit is chosen on the camera screen. */
  kitId: string;
  file: string;
  /** SHA-256 of the PNG file and of its RGBA pixels. */
  sha256: string;
  pixelSha256: string;
  width: number;
  height: number;
  /** When the original photo was taken (real) or the image drawn. */
  capturedAt: string;
  note: string;
  /** Real samples: the capture it was cropped from and the crop rectangle. */
  derivedFrom: { file: string; sha256: string; pixelSha256: string; crop: { x: number; y: number; w: number; h: number } | null };
}
