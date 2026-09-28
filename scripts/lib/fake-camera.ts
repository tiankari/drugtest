// Fake camera for browser tests. Chromium's built-in fake camera stalls after
// one 2x2 frame on some machines, so tests launch Chromium with
// --use-file-for-fake-video-capture pointing at this generated Y4M clip:
// 4:2:0, 10 frames of colour bars with a moving block and per-pixel texture.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function writeFakeCameraClip(W = 640, H = 480): string {
  const dir = join('node_modules', '.cache', 'fdtc');
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `fake-camera-${W}x${H}.y4m`);
  const bars = [[235, 128, 128], [210, 16, 146], [170, 166, 16], [145, 54, 34], [106, 202, 222], [81, 90, 240], [41, 240, 110], [16, 128, 128]];
  const frames: Buffer[] = [Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`)];
  for (let f = 0; f < 10; f++) {
    const y = Buffer.alloc(W * H);
    const u = Buffer.alloc((W / 2) * (H / 2));
    const v = Buffer.alloc((W / 2) * (H / 2));
    for (let r = 0; r < H; r++)
      for (let c = 0; c < W; c++) {
        const inBlock = Math.abs(c - (W * 0.1 + f * W * 0.08)) < W * 0.06 && Math.abs(r - H / 2) < H * 0.08;
        const bar = bars[Math.floor((c / W) * bars.length)];
        y[r * W + c] = inBlock ? 235 : Math.min(235, Math.max(16, bar[0] + ((r * 7 + c * 13) % 9) - 4));
        if (r % 2 === 0 && c % 2 === 0) {
          u[(r / 2) * (W / 2) + c / 2] = inBlock ? 128 : bar[1];
          v[(r / 2) * (W / 2) + c / 2] = inBlock ? 128 : bar[2];
        }
      }
    frames.push(Buffer.from('FRAME\n'), y, u, v);
  }
  writeFileSync(file, Buffer.concat(frames));
  return file;
}

/** Chromium flags for a fake, auto-permitted camera playing the clip. */
export function fakeCameraArgs(W?: number, H?: number): string[] {
  return ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${writeFakeCameraClip(W, H)}`];
}

/** Local runs drive the installed Edge on Windows (no browser download); CI uses Playwright's Chromium. */
export const browserChannel = process.env.PW_CHANNEL ?? (process.env.CI ? undefined : process.platform === 'win32' ? 'msedge' : undefined);

/** Write RGBA frames as a Y4M clip (4:2:0, BT.601 limited range) for the fake camera. Returns the absolute path. */
export function writeY4mClip(name: string, frames: { width: number; height: number; data: Uint8Array | Uint8ClampedArray }[]): string {
  const { width: W, height: H } = frames[0];
  const dir = join('node_modules', '.cache', 'fdtc');
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `${name}.y4m`);
  const parts: Buffer[] = [Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`)];
  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  for (const f of frames) {
    const y = Buffer.alloc(W * H);
    const u = Buffer.alloc((W / 2) * (H / 2));
    const v = Buffer.alloc((W / 2) * (H / 2));
    const d = f.data;
    for (let i = 0; i < W * H; i++) y[i] = clamp(16 + 0.257 * d[i * 4] + 0.504 * d[i * 4 + 1] + 0.098 * d[i * 4 + 2]);
    for (let r = 0; r < H; r += 2)
      for (let c = 0; c < W; c += 2) {
        let R = 0;
        let G = 0;
        let B = 0;
        for (const [dy, dx] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
          const p = ((r + dy) * W + c + dx) * 4;
          R += d[p];
          G += d[p + 1];
          B += d[p + 2];
        }
        R /= 4;
        G /= 4;
        B /= 4;
        const j = (r / 2) * (W / 2) + c / 2;
        u[j] = clamp(128 - 0.148 * R - 0.291 * G + 0.439 * B);
        v[j] = clamp(128 + 0.439 * R - 0.368 * G - 0.071 * B);
      }
    parts.push(Buffer.from('FRAME\n'), y, u, v);
  }
  writeFileSync(file, Buffer.concat(parts));
  return file;
}
