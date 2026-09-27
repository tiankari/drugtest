// Node side of the PIXEL CONTRACT: read a capture PNG (and its sidecar) with
// the same decoder the app uses, and verify it decodes to the pixels the app
// analysed. The validation and registration scripts read captures only
// through this module.

import { readFileSync, existsSync } from 'node:fs';
import type { CaptureSidecar } from '../../src/io/dataset.ts';
import { sha256Hex } from '../../src/io/hash.ts';
import { decodePng, type DecodedImage } from '../../src/io/png.ts';

export function readCapturePng(path: string): DecodedImage {
  return decodePng(new Uint8Array(readFileSync(path)));
}

export interface LoadedCapture {
  path: string;
  image: DecodedImage;
  sidecar: CaptureSidecar | null;
  fileSha256: string;
  pixelSha256: string;
  /** null when there is no sidecar to compare against. */
  fileHashMatches: boolean | null;
  pixelHashMatches: boolean | null;
}

export async function loadCapture(pngPath: string): Promise<LoadedCapture> {
  const bytes = new Uint8Array(readFileSync(pngPath));
  const image = decodePng(bytes);
  const jsonPath = pngPath.replace(/\.png$/i, '.json');
  const sidecar = existsSync(jsonPath) ? (JSON.parse(readFileSync(jsonPath, 'utf8')) as CaptureSidecar) : null;
  const fileSha256 = await sha256Hex(bytes);
  const pixelSha256 = await sha256Hex(image.data);
  return {
    path: pngPath,
    image,
    sidecar,
    fileSha256,
    pixelSha256,
    fileHashMatches: sidecar ? sidecar.sha256 === fileSha256 : null,
    pixelHashMatches: sidecar ? sidecar.pixelSha256 === pixelSha256 : null,
  };
}
