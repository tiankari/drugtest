// The capture being looked at on the result screen: a camera photo, or a
// bundled sample image that went through exactly the same analysis.

import type { CaptureSidecar } from '../io/dataset.ts';
import type { SampleSidecar } from '../io/samples.ts';
import type { MatAnalysis } from '../pipeline/analyse.ts';
import type { SampleReading } from '../pipeline/samplezone.ts';
import type { ImageSource } from '../records/record.ts';
import type { GeoState } from './geo.ts';

export interface CurrentCapture {
  sidecar: CaptureSidecar;
  png: Uint8Array;
  analysis: MatAnalysis;
  sample: SampleReading | null;
  rectified: ImageData | null;
  /** Geolocation as it stood when the photo was taken (camera only). */
  geo: GeoState;
  /** Set once it became a record. */
  savedSeq: number | null;
  source: ImageSource;
  /** The bundled sample, when source is not the camera. */
  sampleImage: SampleSidecar | null;
}

let current: CurrentCapture | null = null;

export function currentCapture(): CurrentCapture | null {
  return current;
}

export function setCurrentCapture(c: CurrentCapture): void {
  current = c;
}
