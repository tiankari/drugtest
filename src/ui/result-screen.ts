// Result screen for a normal-mode capture: the reference colour card as the
// pipeline saw it, every check with its figure, and the colour correction
// (patch by patch, before and after). No classification yet (Session 2).

import { ciede2000 } from '../pipeline/ciede2000.ts';
import { linearToDisplay8 } from '../pipeline/analyse.ts';
import { labToXyz, xyzToLinearRgb, type Vec3 } from '../pipeline/colour.ts';
import { THRESHOLDS } from '../pipeline/config.ts';
import { MAT_V1 } from '../pipeline/mat.ts';
import { lastNormalCapture } from './camera-screen.ts';
import { formatBytes, h } from './dom.ts';

const css = (c: Vec3) => `rgb(${c.map((v) => Math.round(Math.min(255, Math.max(0, v)))).join(',')})`;

export function resultScreen(root: HTMLElement, go: (route: string) => void): () => void {
  const cap = lastNormalCapture;
  if (!cap) {
    go('#/camera');
    return () => {};
  }
  const { analysis: a, sidecar: sc } = cap;
  const urls: string[] = [];

  const verdict =
    a.verdict === 'PASS'
      ? h('div', { class: 'verdict pass' }, 'PASS — card checks and colour correction passed')
      : h('div', { class: 'verdict retake' }, `RETAKE — ${a.reason}`);

  let picture: HTMLElement;
  if (cap.rectified) {
    const c = h('canvas', { class: 'review-img rectified', width: cap.rectified.width, height: cap.rectified.height, 'aria-label': 'Rectified reference colour card' });
    c.getContext('2d')?.putImageData(cap.rectified, 0, 0);
    picture = h('figure', { class: 'figure' }, c, h('figcaption', { class: 'hint' }, 'The reference colour card, straightened by the app (what the colour reading used).'));
  } else {
    const u = URL.createObjectURL(new Blob([cap.png as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
    urls.push(u);
    picture = h('figure', { class: 'figure' }, h('img', { class: 'review-img', src: u, alt: 'Captured frame' }), h('figcaption', { class: 'hint' }, 'The card was not found in this photo.'));
  }

  const d = a.detection;
  const used = a.correction?.used;
  const other = a.correction?.other;
  const T = THRESHOLDS;
  const row = (k: string, v: string | Node) => h('tr', {}, h('th', {}, k), h('td', {}, v));
  const facts = h(
    'table',
    { class: 'kv' },
    row('Card copy (from ID strip)', a.copy ? `${a.copy} (MAT v${a.version})` : '—'),
    row('Orientation', d.ok ? `${d.orientation}° (${d.rotationDeg.toFixed(1)}°)` : '—'),
    row('Uneven light', a.unevenLight ? `${a.unevenLight.ratio.toFixed(3)} (limit ${T.maxWhiteLuminanceRatio.value})` : '—'),
    row('Correction method', used ? `${used.method === 'A' ? 'A — 3×3 matrix' : 'B — neutral-ramp curves, then 3×3 matrix'}` : '—'),
    row(
      'Leave-one-out error (ΔE00)',
      used ? `mean ${used.loo.mean.toFixed(2)}, 90th percentile ${used.loo.p90.toFixed(2)} (limits ${T.maxLooMeanDeltaE00.value}, ${T.maxLooP90DeltaE00.value})` : '—',
    ),
    row('Other method, for comparison', other ? `${other.method}: mean ${other.loo.mean.toFixed(2)}, 90th ${other.loo.p90.toFixed(2)}` : '—'),
    row('In-sample residual (flattering)', used ? `mean ${used.fit.mean.toFixed(2)}` : '—'),
    row('Pixels per patch (min)', a.minPatchPixels !== undefined ? `${a.minPatchPixels.toFixed(0)} (limit ${T.minPatchSourcePixels.value})` : '—'),
    row('Resolution', `${sc.image.width}×${sc.image.height}, PNG ${formatBytes(cap.png.length)}`),
    row('SHA-256 (PNG)', h('span', { class: 'hash' }, sc.sha256)),
    row('SHA-256 (pixels)', h('span', { class: 'hash' }, sc.pixelSha256)),
  );

  const checks = h(
    'ul',
    { class: 'checks' },
    ...a.checks.map((c) =>
      h(
        'li',
        { class: c.pass ? 'ok' : 'bad' },
        h('strong', {}, c.pass ? 'pass ' : 'FAIL '),
        `${c.id}${c.value !== undefined ? ` — ${c.value.toFixed(c.value < 10 ? 3 : 0)} (limit ${c.threshold})` : ''}${c.detail ? ` — ${c.detail}` : ''}${c.pass ? '' : ` — "${c.message}"`}`,
      ),
    ),
  );

  const grid = h('div', { class: 'patch-grid' });
  if (a.patches) {
    const corr = a.correction?.patches;
    for (const p of MAT_V1.patches) {
      const obs = a.patches.find((q) => q.id === p.id)!;
      const cp = corr?.find((q) => q.id === p.id);
      const after = cp ? linearToDisplay8(cp.correctedLinear) : null;
      const refSw = cp ? linearToDisplay8(xyzToLinearRgb(labToXyz(cp.referenceLab))) : null;
      const de = cp ? ciede2000(cp.correctedLab, cp.referenceLab) : null;
      grid.append(
        h(
          'div',
          { class: 'patch' },
          h('div', { class: 'sw', style: `background:${css(obs.rgb8)}`, title: 'before correction' }),
          h('div', { class: 'sw', style: after ? `background:${css(after)}` : '', title: 'after correction' }),
          h('div', { class: 'sw', style: refSw ? `background:${css(refSw)}` : '', title: 'registered reference' }),
          h('div', { class: 'pid' }, p.id),
          h('div', { class: 'pde' }, de !== null ? de.toFixed(1) : ''),
        ),
      );
    }
  }

  root.append(
    h(
      'section',
      { class: 'page' },
      h('h1', {}, 'Result'),
      verdict,
      h('div', { class: 'notice' }, 'This shows the reference colour card and the colour correction only. Reading the test and the POSITIVE / NEGATIVE / INCONCLUSIVE result come next. Any field result is presumptive and never replaces laboratory confirmation.'),
      picture,
      h('h2', {}, 'Checks'),
      checks,
      h('h2', {}, 'Details'),
      facts,
      a.patches
        ? h(
            'div',
            {},
            h('h2', {}, 'Patches: before · after · reference'),
            h('p', { class: 'hint' }, a.correction ? 'Each patch: the camera\'s colour, the corrected colour, the registered reference, and the corrected-vs-reference ΔE00.' : 'No correction: this card copy is not registered, or an earlier check failed.'),
            grid,
          )
        : null,
      h('div', { class: 'button-row' }, h('button', { type: 'button', class: 'primary', onclick: () => go('#/camera') }, 'Back to camera')),
    ),
  );
  return () => urls.forEach((u) => URL.revokeObjectURL(u));
}

