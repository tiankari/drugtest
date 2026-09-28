// Result screen for a normal-mode capture, top to bottom:
//   1. the verdict (word + icon + colour, never colour alone) and why;
//   2. the corrected sample colour next to the target colours, and what was
//      sampled drawn on the straightened card;
//   3. the kit's validation line; 4. the presumptive-result notice;
//   5. optional case reference and location note;
//   6. for kits where no colour means NEGATIVE, the required "test is in the
//      sample zone" tick;
//   7. "Save signed record" (never for RETAKE);
//   8. Session 1's card details, unchanged, under "Technical details".

import { ciede2000 } from '../pipeline/ciede2000.ts';
import { linearToDisplay8 } from '../pipeline/analyse.ts';
import { labToXyz, xyzToLinearRgb, type Vec3 } from '../pipeline/colour.ts';
import { THRESHOLDS } from '../pipeline/config.ts';
import { classify, type Classification, type KitProfile } from '../pipeline/kit.ts';
import { MAT_V1 } from '../pipeline/mat.ts';
import type { SampleReading } from '../pipeline/samplezone.ts';
import { buildRecordDraft } from '../records/build.ts';
import { isoWithOffset } from '../records/record.ts';
import { lastNormalCapture } from './camera-screen.ts';
import { errorText, formatBytes, h } from './dom.ts';
import { recordLocation, geoText } from './geo.ts';
import { canonicalSha256, selectedKit } from './kits.ts';
import { saveRecord } from './log-store.ts';
import { REFERENCES } from './references.ts';
import { loadSettings } from './settings.ts';
import { verdictBadge } from './verdict.ts';

const css = (c: Vec3) => `rgb(${c.map((v) => Math.round(Math.min(255, Math.max(0, v)))).join(',')})`;
const labCss = (lab: Vec3) => css(linearToDisplay8(xyzToLinearRgb(labToXyz(lab))));

export const PRESUMPTIVE = 'Presumptive result — send for laboratory confirmation';

function classifyCapture(kit: KitProfile, cardVerdict: string, cardReason: string, sample: SampleReading | null): Classification {
  if (cardVerdict !== 'PASS') return { verdict: 'RETAKE', reason: cardReason, classified: false, nearest: null, distances: [] };
  if (!sample) return { verdict: 'RETAKE', reason: 'The sample zone was not read', classified: false, nearest: null, distances: [] };
  return classify(kit, sample);
}

/** The straightened card with the sampled region drawn on it. */
function maskedCard(rectified: ImageData, sample: SampleReading | null): HTMLCanvasElement {
  const c = h('canvas', { class: 'review-img rectified masked', width: rectified.width, height: rectified.height, 'aria-label': 'Straightened card with the sampled area marked' });
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.putImageData(rectified, 0, 0);
  const k = rectified.width / MAT_V1.widthMm;
  const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const m = sample?.mask;
  if (m) {
    const cell = k / m.pxPerMm;
    for (let y = 0; y < m.h; y++)
      for (let x = 0; x < m.w; x++) {
        const v = m.cells[y * m.w + x];
        if (!v) continue;
        ctx.fillStyle = token(v === 1 ? '--mask-sampled' : '--mask-dropped');
        ctx.fillRect((m.x0Mm + x / m.pxPerMm) * k, (m.y0Mm + y / m.pxPerMm) * k, Math.ceil(cell), Math.ceil(cell));
      }
  }
  const z = MAT_V1.sampleZone;
  ctx.strokeStyle = token('--zone-outline');
  ctx.lineWidth = Math.max(2, k / 2);
  ctx.strokeRect(z.x * k, z.y * k, z.w * k, z.h * k);
  return c;
}

export function resultScreen(root: HTMLElement, go: (route: string) => void): () => void {
  const cap = lastNormalCapture;
  if (!cap) {
    go('#/test');
    return () => {};
  }
  const settings = loadSettings();
  const { analysis: a, sidecar: sc } = cap;
  const urls: string[] = [];
  let kit: KitProfile;
  try {
    kit = selectedKit(settings.kitId);
  } catch (e) {
    root.append(h('section', { class: 'page' }, h('h1', {}, 'Result'), h('div', { class: 'error-box' }, errorText(e))));
    return () => {};
  }
  const cls = classifyCapture(kit, a.verdict, a.reason, cap.sample);
  const isRetake = cls.verdict === 'RETAKE';

  // 1. Verdict
  const verdict = h('div', { class: `result-verdict v-${cls.verdict.toLowerCase()}`, role: 'status' }, verdictBadge(cls.verdict, 'large'), h('p', { class: 'why' }, cls.reason));

  // 2. Sample and targets
  const s = cap.sample;
  const swatches = h('div', { class: 'swatches' });
  if (s?.correctedLab) {
    swatches.append(h('div', { class: 'swatch sample' }, h('div', { class: 'chip', style: `background:${labCss(s.correctedLab)}` }), h('div', { class: 'cap' }, h('strong', {}, 'Sample (corrected)'), h('span', {}, `L ${s.correctedLab.map((v) => v.toFixed(1)).join(', ')}`))));
  } else if (s?.status === 'none') {
    swatches.append(h('div', { class: 'swatch sample' }, h('div', { class: 'chip empty' }, 'none'), h('div', { class: 'cap' }, h('strong', {}, 'Sample'), h('span', {}, 'No coloured region'))));
  }
  for (const o of kit.outcomes)
    for (const t of o.targets) {
      const d = cls.distances.find((x) => x.targetId === t.id);
      swatches.append(
        h(
          'div',
          { class: `swatch target${d?.inside ? ' inside' : ''}` },
          h('div', { class: 'chip', style: `background:${labCss(t.lab)}` }),
          h('div', { class: 'cap' }, h('strong', {}, `${o.verdict === 'POSITIVE' ? '' : `${o.verdict}: `}${t.label}`), h('span', {}, `${t.notation}${d ? ` · ΔE00 ${d.deltaE00.toFixed(1)} (radius ${t.radius.toFixed(1)})` : ` · radius ${t.radius.toFixed(1)}`}`)),
        ),
      );
    }
  const sampleFacts = s
    ? h(
        'p',
        { class: 'hint' },
        s.status === 'found' || (s.status === 'retake' && s.areaMm2 > 0)
          ? `Sampled ${s.areaMm2.toFixed(0)} mm² (${s.pixels} camera pixels), spread ${s.spread.toFixed(1)} ΔE76, clipped ${(s.clipFraction * 100).toFixed(1)}%${s.touchesEdge ? '; the coloured area reaches the edge of the zone' : ''}. Blue = sampled, pink = coloured but left out (edge, glare, dark, trimmed).`
          : s.status === 'none'
            ? `No pixel in the zone differs from the card's white by more than ${s.threshold.deltaE.toFixed(1)} ΔE76 (3 × this photo's paper noise). The app cannot tell a colourless test from an empty zone.`
            : s.reason,
      )
    : null;
  const picture = cap.rectified
    ? h('figure', { class: 'figure' }, maskedCard(cap.rectified, s), h('figcaption', { class: 'hint' }, 'The reference colour card, straightened by the app, with the sample zone outlined.'))
    : null;

  // 5-7. Inputs and saving
  const caseRef = h('input', { type: 'text', id: 'case-ref', placeholder: 'Case reference (optional)', autocomplete: 'off', maxlength: 120 });
  const locNote = h('input', { type: 'text', id: 'location-note', placeholder: 'Location note (optional), e.g. checkpoint name', autocomplete: 'off', maxlength: 200 });
  const needsTick = kit.noColourResult === 'NEGATIVE';
  const tick = h('input', { type: 'checkbox', id: 'in-zone' });
  const tickRow = needsTick ? h('label', { class: 'toggle tick', for: 'in-zone' }, tick, h('span', {}, h('strong', {}, 'The test is in the sample zone'), h('br'), h('span', { class: 'hint' }, 'Required: the app cannot tell a colourless test from an empty zone.'))) : null;
  const saveBtn = h('button', { type: 'button', class: 'primary big', id: 'save-record' }, 'Save signed record');
  const saveState = h('p', { class: 'hint' });
  const errorBox = h('div', { class: 'error-box', role: 'alert', hidden: true });
  const recordFacts = h('p', { class: 'hint' }, `Operator ${settings.operatorId || '— (set it in Settings)'} · ${geoText(cap.geo)} · signed with this phone's key.`);

  let saving = false;
  const renderSave = () => {
    const done = cap.savedSeq !== null;
    saveBtn.disabled = isRetake || saving || done || (needsTick && !tick.checked) || !settings.operatorId.trim();
    saveBtn.textContent = done ? `Saved as record ${cap.savedSeq}` : saving ? 'Signing and saving…' : 'Save signed record';
    saveState.textContent = isRetake
      ? 'A RETAKE is never recorded. Fix the problem above and take the photo again.'
      : !settings.operatorId.trim()
        ? 'Set your operator ID in Settings first.'
        : needsTick && !tick.checked && !done
          ? 'Tick the box above to confirm the test is in the sample zone.'
          : '';
  };
  tick.addEventListener('change', renderSave);

  saveBtn.addEventListener('click', async () => {
    if (saveBtn.disabled) return;
    saving = true;
    errorBox.hidden = true;
    renderSave();
    try {
      const ref = a.copy ? REFERENCES[a.copy] : undefined;
      if (!ref) throw new Error(`No registered reference for card copy ${a.copy ?? '?'}`);
      if (!s) throw new Error('The sample zone was not read');
      const [kitSha256, referenceSha256] = await Promise.all([canonicalSha256(kit), canonicalSha256(ref)]);
      const draft = buildRecordDraft({
        recordId: crypto.randomUUID(),
        createdAt: isoWithOffset(new Date()),
        capturedAt: isoWithOffset(new Date(sc.capturedAt)),
        timezoneOffsetMinutes: sc.timezoneOffsetMinutes,
        operatorId: settings.operatorId,
        caseRef: caseRef.value,
        locationNote: locNote.value,
        officerConfirmedTestInZone: needsTick ? tick.checked : false,
        location: recordLocation(cap.geo),
        userAgent: navigator.userAgent,
        app: { version: __APP_VERSION__, commit: __GIT_COMMIT__ },
        image: { sha256: sc.sha256, pixelSha256: sc.pixelSha256, width: sc.image.width, height: sc.image.height },
        analysis: a,
        sample: s,
        classification: cls,
        kit,
        kitSha256,
        referenceSha256,
      });
      const entry = await saveRecord(draft, cap.png);
      cap.savedSeq = entry.record.seq;
      go(`#/record/${entry.record.seq}`);
    } catch (e) {
      errorBox.hidden = false;
      errorBox.textContent = `Not saved: ${errorText(e)}`;
    } finally {
      saving = false;
      renderSave();
    }
  });
  renderSave();

  // 8. Session 1 content, unchanged, collapsed.
  const tech = technicalDetails(cap, urls);

  root.append(
    h(
      'section',
      { class: 'page result-page' },
      h('h1', {}, 'Result'),
      verdict,
      s || !isRetake ? h('div', { class: 'card' }, h('h2', {}, 'Sample colour and target colours'), swatches, sampleFacts) : null,
      picture,
      h('p', { class: 'kit-validation' }, h('strong', {}, `${kit.name}: `), kit.validationLine),
      h('div', { class: 'notice strong' }, PRESUMPTIVE),
      h(
        'div',
        { class: 'card' },
        h('label', { for: 'case-ref' }, h('strong', {}, 'Case reference')),
        caseRef,
        h('label', { for: 'location-note' }, h('strong', {}, 'Location note')),
        locNote,
        tickRow,
        recordFacts,
        saveBtn,
        saveState,
        errorBox,
      ),
      tech,
      h('div', { class: 'button-row' }, h('button', { type: 'button', onclick: () => go('#/test') }, 'Back to camera')),
    ),
  );
  return () => urls.forEach((u) => URL.revokeObjectURL(u));
}

/** Session 1's result content (card checks, straightened card, light, correction, 30 patches), unchanged. */
function technicalDetails(cap: NonNullable<typeof lastNormalCapture>, urls: string[]): HTMLElement {
  const { analysis: a, sidecar: sc } = cap;
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
    row(
      'Uneven light',
      a.unevenLight
        ? `${a.unevenLight.residual.toFixed(3)} after removing a smooth gradient of ${a.unevenLight.gradient.toFixed(2)} (limit ${T.maxResidualWhiteRatio.value}); ${a.unevenLight.ratio.toFixed(3)} as photographed`
        : '—',
    ),
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

  return h(
    'details',
    { class: 'tech' },
    h('summary', {}, 'Technical details'),
    h('div', { class: 'tech-body' },
      verdict,
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
    ),
  );
}
