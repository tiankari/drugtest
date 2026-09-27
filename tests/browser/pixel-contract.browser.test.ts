// PIXEL CONTRACT, browser half. Runs in real Chromium.
//
// 1. A capture PNG loaded through both paths (the app in the browser, and the
//    Node validation path) gives byte-identical RGBA buffers. The browser's
//    own native decoder is checked too, since that is what any viewer uses.
// 2. The actual capture path: a live getUserMedia frame (Chromium's fake
//    camera) grabbed by the app's grabFrame(), encoded by the app's encoder,
//    then decoded by the Node path, returns exactly the pixels the pipeline
//    would have analysed.

import { describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { sha256Hex } from '../../src/io/hash.ts';
import { decodePng, encodePng } from '../../src/io/png.ts';
import { grabFrame } from '../../src/ui/capture.ts';
import expected from '../fixtures/pixel-contract.expected.json';
import fixtureUrl from '../fixtures/pixel-contract.png?url';

interface NodeDecoded {
  width: number;
  height: number;
  base64: string;
  pixelSha256: string;
}

declare module 'vitest/browser' {
  interface BrowserCommands {
    nodeDecodeFile: (path: string) => Promise<NodeDecoded>;
    nodeDecodeBytes: (base64Png: string) => Promise<NodeDecoded>;
  }
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function nativeDecode(png: Uint8Array, options?: ImageBitmapOptions): Promise<Uint8Array> {
  const bmp = await createImageBitmap(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }), options);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' })!;
  ctx.drawImage(bmp, 0, 0);
  return new Uint8Array(ctx.getImageData(0, 0, bmp.width, bmp.height, { colorSpace: 'srgb' }).data.buffer);
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

describe('pixel contract (real browser)', () => {
  it('one PNG through both paths: app decoder in the browser and Node decoder give identical bytes', async () => {
    const png = new Uint8Array(await (await fetch(fixtureUrl)).arrayBuffer());
    const app = decodePng(png);
    const node = await commands.nodeDecodeFile('tests/fixtures/pixel-contract.png');
    const nodeBytes = fromBase64(node.base64);

    expect([app.width, app.height]).toEqual([node.width, node.height]);
    expect(same(app.data, nodeBytes)).toBe(true);
    expect(await sha256Hex(app.data)).toBe(expected.pixelSha256);
    expect(node.pixelSha256).toBe(expected.pixelSha256);
  });

  it('the browser native decoder does not colour-manage our PNG (with and without colour conversion)', async () => {
    const png = new Uint8Array(await (await fetch(fixtureUrl)).arrayBuffer());
    const ref = decodePng(png).data;
    expect(same(await nativeDecode(png, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }), ref)).toBe(true);
    expect(same(await nativeDecode(png), ref)).toBe(true);
  });

  it('live capture: getUserMedia frame -> grabFrame -> encodePng -> Node decode returns the analysed pixels exactly', async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    try {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      for (let i = 0; i < 200 && (video.videoWidth === 0 || video.readyState < 2); i++) await new Promise((r) => setTimeout(r, 25));

      const { frame } = grabFrame(video);
      const analysed = new Uint8Array(frame.data.buffer.slice(0));
      expect(analysed.length).toBe(frame.width * frame.height * 4);
      // The fake camera draws a moving pattern; make sure it is not blank.
      expect(new Set(analysed.subarray(0, 40000)).size).toBeGreaterThan(8);

      const { png, info } = encodePng(frame);
      expect(info.colourType).toBe(2); // opaque video frame -> RGB
      const node = await commands.nodeDecodeBytes(toBase64(png));
      expect([node.width, node.height]).toEqual([frame.width, frame.height]);
      expect(same(fromBase64(node.base64), analysed)).toBe(true);
      expect(node.pixelSha256).toBe(await sha256Hex(analysed));
      expect(same(await nativeDecode(png, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }), analysed)).toBe(true);
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }
  });
});
