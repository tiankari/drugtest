// Normal-mode capture review. Colour correction and classification are not
// built yet, so this shows exactly what was captured and checked, and says so.

import { lastNormalCapture } from './camera-screen.ts';
import { formatBytes, h } from './dom.ts';

export function reviewScreen(root: HTMLElement, go: (route: string) => void): () => void {
  const cap = lastNormalCapture;
  if (!cap) {
    go('#/camera');
    return () => {};
  }
  const sc = cap.sidecar;
  const url = URL.createObjectURL(new Blob([cap.png as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
  const failed = sc.checks.results.filter((r) => !r.pass);
  const verdict = sc.checks.pass
    ? h('div', { class: 'verdict pass' }, 'Capture checks passed')
    : h('div', { class: 'verdict retake' }, `RETAKE — ${failed.map((f) => f.message).join(', ')}`);

  root.append(
    h(
      'section',
      { class: 'page' },
      h('h1', {}, 'Capture'),
      verdict,
      h('div', { class: 'notice' }, 'Card detection, colour correction and the test result are not built yet (next build step). Nothing has been classified.'),
      h('img', { class: 'review-img', src: url, alt: 'Captured frame' }),
      h(
        'table',
        { class: 'kv' },
        h('tr', {}, h('th', {}, 'Resolution'), h('td', {}, `${sc.image.width}×${sc.image.height}`)),
        h('tr', {}, h('th', {}, 'PNG size'), h('td', {}, formatBytes(cap.png.length))),
        h('tr', {}, h('th', {}, 'SHA-256 (PNG)'), h('td', { class: 'hash' }, sc.sha256)),
        h('tr', {}, h('th', {}, 'SHA-256 (pixels)'), h('td', { class: 'hash' }, sc.pixelSha256)),
        ...sc.checks.results.map((r) => h('tr', {}, h('th', {}, r.id), h('td', {}, `${r.pass ? 'pass' : 'FAIL'} — ${r.value.toFixed(3)} (threshold ${r.threshold})`))),
      ),
      h('div', { class: 'button-row' }, h('button', { type: 'button', class: 'primary', onclick: () => go('#/camera') }, 'Back to camera')),
    ),
  );
  return () => URL.revokeObjectURL(url);
}
