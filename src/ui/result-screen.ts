// Result screen for a camera photo or a bundled sample image, top to bottom:
//   1. sample label (samples only); the verdict (word + icon + colour, never
//      colour alone) and one plain sentence of why;
//   2. RETAKE: where the problem is and what to try (and, when the white
//      square was read but refused, what was read drawn on the card).
//      Otherwise: the test colour next to the kit's colours, and what was
//      read drawn on the card;
//   3. the kit's status; 4. the presumptive-result notice;
//   5. optional case reference and location note; 6. for camera photos with
//      kits where no colour means NEGATIVE, the required "test is in the
//      white square" tick; 7. "Save sealed record";
//   8. "Technical details" (collapsed): the numbers behind the result, then
//      Session 1's card details, unchanged.

import { ciede2000 } from '../pipeline/ciede2000.ts';
import { linearToDisplay8 } from '../pipeline/analyse.ts';
import { labToXyz, xyzToLinearRgb, type Vec3 } from '../pipeline/colour.ts';
import { THRESHOLDS } from '../pipeline/config.ts';
import { classify, type Classification, type KitProfile } from '../pipeline/kit.ts';
import { MAT_V1 } from '../pipeline/mat.ts';
import type { SampleReading } from '../pipeline/samplezone.ts';
import { buildRecordDraft } from '../records/build.ts';
import { isoWithOffset } from '../records/record.ts';
import { currentCapture, type CurrentCapture } from './current.ts';
import { errorText, formatBytes, h, toast } from './dom.ts';
import { geoSaveText, recordLocation } from './geo.ts';
import { canonicalSha256, selectedKit } from './kits.ts';
import { saveRecord } from './log-store.ts';
import { plainVerdictSentence, retakeAdvice, targetName } from './plain.ts';
import { REFERENCES } from './references.ts';
import { sampleKindText } from './samples.ts';
import { loadSettings, updateSettings } from './settings.ts';
import { verdictBadge } from './verdict.ts';

const css = (c: Vec3) => `rgb(${c.map((v) => Math.round(Math.min(255, Math.max(0, v)))).join(',')})`;
const labCss = (lab: Vec3) => css(linearToDisplay8(xyzToLinearRgb(labToXyz(lab))));

export const PRESUMPTIVE = 'Presumptive result — send for laboratory confirmation';

function classifyCapture(kit: KitProfile, cardVerdict: string, cardReason: string, sample: SampleReading | null): Classification {
  if (cardVerdict !== 'PASS') return { verdict: 'RETAKE', reason: cardReason, classified: false, nearest: null, distances: [] };
  if (!sample) return { verdict: 'RETAKE', reason: 'The sample zone was not read', classified: false, nearest: null, distances: [] };
  return classify(kit, sample);
}

/** The straightened card with the area that was read drawn on it. */
function maskedCard(rectified: ImageData, sample: SampleReading | null): HTMLCanvasElement {
  const c = h('canvas', { class: 'review-img rectified masked', width: rectified.width, height: rectified.height, 'aria-label': 'Straightened card with the area the app read marked' });
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.putImageData(rectified, 0, 0);
  const k = rectified.width / MAT_V1.widthMm;
  const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const m = sample?.mask;
  if (m) {
    const cell = k / m.pxPerMm;
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= m.w || y >= m.h ? 0 : m.cells[y * m.w + x]);
    for (let y = 0; y < m.h; y++)
      for (let x = 0; x < m.w; x++) {
        const v = m.cells[y * m.w + x];
        if (!v) continue;
        // A solid edge where the marking meets something else, so it shows on any test colour;
        // inside, a checker pattern, so the test's own colour stays visible through the marking.
        const edge = at(x - 1, y) !== v || at(x + 1, y) !== v || at(x, y - 1) !== v || at(x, y + 1) !== v;
        if (!edge && (x + y) % 2) continue;
        ctx.fillStyle = token(v === 1 ? (edge ? '--mask-sampled-edge' : '--mask-sampled') : edge ? '--mask-dropped-edge' : '--mask-dropped');
        ctx.fillRect((m.x0Mm + x / m.pxPerMm) * k, (m.y0Mm + y / m.pxPerMm) * k, Math.ceil(cell), Math.ceil(cell));
      }
  }
  const z = MAT_V1.sampleZone;
  ctx.strokeStyle = token('--zone-outline');
  ctx.lineWidth = Math.max(2, k / 2);
  ctx.strokeRect(z.x * k, z.y * k, z.w * k, z.h * k);
  return c;
}

/** The numbers behind the verdict (Technical details). */
function numbers(cls: Classification, s: SampleReading | null): HTMLElement {
  const row = (k: string, v: string) => h('tr', {}, h('th', {}, k), h('td', {}, v));
  const rows: HTMLElement[] = [row('Reason (as sealed in the record)', cls.reason)];
  if (s) {
    rows.push(row('Sample zone reading', `${s.status}${s.status === 'retake' ? ` (${s.reason})` : ''}`));
    rows.push(row('Coloured-pixel threshold', `${s.threshold.deltaE.toFixed(1)} ΔE76 (= ${s.threshold.factor} × white-paper noise ${s.threshold.whiteNoise.toFixed(2)})`));
    // A refused reading (e.g. patchy) still shows what was read; it is not a result and was never compared.
    const refused = s.status === 'retake' ? ' (refused, not a result)' : '';
    if (s.status === 'found' || s.observedLab) {
      rows.push(row(`Area read${refused}`, `${s.areaMm2.toFixed(0)} mm², ${s.pixels} camera pixels; spread ${s.spread.toFixed(1)} ΔE76; clipped ${(s.clipFraction * 100).toFixed(1)}%${s.touchesEdge ? '; reaches the zone edge' : ''}`));
      if (s.observedLab) rows.push(row(`CIELAB before correction${refused}`, s.observedLab.map((v) => v.toFixed(1)).join(', ')));
      if (s.correctedLab) rows.push(row(`CIELAB after correction${refused}`, s.correctedLab.map((v) => v.toFixed(1)).join(', ')));
    } else if (s.regions.length) {
      rows.push(row('Coloured areas found', s.regions.map((r) => `${r.areaMm2.toFixed(0)} mm²`).join(', ')));
    }
  }
  for (const d of cls.distances) rows.push(row(`ΔE00 to ${d.label} (${d.notation})`, `${d.deltaE00.toFixed(2)}, radius ${d.radius.toFixed(2)} → ${d.inside ? 'inside' : 'outside'}`));
  return h('div', {}, h('h2', {}, 'Numbers behind the result'), h('table', { class: 'kv' }, ...rows));
}

export function resultScreen(root: HTMLElement, go: (route: string) => void): () => void {
  const cap = currentCapture();
  if (!cap) {
    go('#/test');
    return () => {};
  }
  let settings = loadSettings();
  const { analysis: a, sidecar: sc } = cap;
  const urls: string[] = [];
  let kit: KitProfile;
  try {
    kit = selectedKit(settings.kitId);
  } catch (e) {
    root.append(h('section', { class: 'page' }, h('h1', {}, 'Result'), h('div', { class: 'error-box' }, errorText(e))));
    return () => {};
  }
  const isSample = cap.source !== 'camera';
  const cls = classifyCapture(kit, a.verdict, a.reason, cap.sample);
  const isRetake = cls.verdict === 'RETAKE';
  const again = isSample
    ? h('button', { type: 'button', class: isRetake ? 'primary big' : '', onclick: () => go('#/samples') }, 'Try another sample')
    : h('button', { type: 'button', class: isRetake ? 'primary big' : '', onclick: () => go('#/test') }, isRetake ? 'Take the photo again' : 'Take another photo');

  // 1. Sample label and verdict
  const sampleLabel = cap.sampleImage
    ? h(
        'div',
        { class: `sample-banner ${cap.sampleImage.kind}` },
        h('strong', {}, `Sample image · ${sampleKindText(cap.sampleImage.kind)}: ${cap.sampleImage.title}`),
        h('span', {}, cap.sampleImage.kind === 'sample-drawn' ? 'No real reaction was photographed. The result below is what the app computed from this image just now.' : 'The result below is what the app computed from this photo just now.'),
      )
    : null;
  const advice = isRetake ? retakeAdvice(cls.reason, a) : null;
  const verdict = h('div', { class: `result-verdict v-${cls.verdict.toLowerCase()}`, role: 'status' }, verdictBadge(cls.verdict, 'large'), h('p', { class: 'why' }, advice ? advice.why : plainVerdictSentence(cls)));

  // 2. The test colour next to the kit's colours (not for RETAKE: nothing was compared)
  const s = cap.sample;
  let colours: HTMLElement | null = null;
  if (!isRetake) {
    const swatches = h('div', { class: 'swatches' });
    if (s?.correctedLab) {
      swatches.append(h('div', { class: 'swatch sample' }, h('div', { class: 'chip', style: `background:${labCss(s.correctedLab)}` }), h('div', { class: 'cap' }, h('strong', {}, 'Your test'), h('span', {}, 'after the light correction'))));
    } else if (s?.status === 'none') {
      swatches.append(h('div', { class: 'swatch sample' }, h('div', { class: 'chip empty' }, 'none'), h('div', { class: 'cap' }, h('strong', {}, 'Your test'), h('span', {}, 'no colour in the white square'))));
    }
    for (const o of kit.outcomes)
      for (const t of o.targets) {
        const d = cls.distances.find((x) => x.targetId === t.id);
        swatches.append(
          h(
            'div',
            { class: `swatch target${d?.inside ? ' inside' : ''}` },
            h('div', { class: 'chip', style: `background:${labCss(t.lab)}` }),
            h('div', { class: 'cap' }, h('strong', {}, `${o.verdict === 'POSITIVE' ? '' : `${o.verdict}: `}${targetName(t.label)}`), h('span', {}, d ? (d.inside ? 'close match' : 'not a match') : 'reference colour')),
          ),
        );
      }
    const hint =
      s?.status === 'found'
        ? 'Blue: the area the app read. Pink: coloured edges it left out.'
        : 'Nothing in the white square differs from the card’s white paper. The app cannot tell a colourless test from an empty square.';
    colours = h('div', { class: 'card' }, h('h2', {}, 'Your test and the kit’s colours'), swatches, h('p', { class: 'hint' }, hint));
  }
  const showRefused = !!(advice?.showMask && s?.mask);
  const sampled = !!s?.mask?.cells.some((v) => v === 1);
  const picture = cap.rectified && (!isRetake || showRefused)
    ? h(
        'figure',
        { class: 'figure' },
        maskedCard(cap.rectified, s),
        h('figcaption', { class: 'hint' }, showRefused ? `What the app saw in the white square. ${sampled ? 'Blue: the part it read. Pink: coloured parts it left out.' : 'Pink: what it counted as colour.'}` : 'The reference colour card, straightened by the app, with the white square outlined.'),
      )
    : null;

  // 5-7. Saving (never for RETAKE)
  let saveCard: HTMLElement | null = null;
  if (!isRetake) {
    const caseRef = h('input', { type: 'text', id: 'case-ref', placeholder: 'Case reference (optional)', autocomplete: 'off', maxlength: 120 });
    const locNote = h('input', { type: 'text', id: 'location-note', placeholder: 'Place note (optional), e.g. checkpoint name', autocomplete: 'off', maxlength: 200 });
    const officer = h('input', { type: 'text', id: 'save-officer', placeholder: 'Your officer ID (needed to save)', autocomplete: 'off', maxlength: 80 });
    const officerRow = h('div', { class: 'officer-row' }, h('label', { for: 'save-officer' }, h('strong', {}, 'Officer ID')), officer);
    officerRow.hidden = !!settings.operatorId.trim();
    const needsTick = kit.noColourResult === 'NEGATIVE' && !isSample;
    const tick = h('input', { type: 'checkbox', id: 'in-zone' });
    const tickRow = needsTick ? h('label', { class: 'toggle tick', for: 'in-zone' }, tick, h('span', {}, h('strong', {}, 'The test is in the white square'), h('br'), h('span', { class: 'hint' }, 'Needed because the app cannot tell a colourless test from an empty square.'))) : null;
    const saveBtn = h('button', { type: 'button', class: 'primary big', id: 'save-record' }, 'Save sealed record');
    const saveState = h('p', { class: 'hint' });
    const errorBox = h('div', { class: 'error-box', role: 'alert', hidden: true });
    const recordFacts = h('p', { class: 'hint' });
    const renderFacts = () =>
      (recordFacts.textContent = isSample
        ? `Will be saved as a SAMPLE (${sampleKindText(cap.sampleImage!.kind).toLowerCase()}), with officer ${settings.operatorId || '—'} and the time, sealed on this phone. No place: the photo was not taken here.`
        : `Will be saved with officer ${settings.operatorId || '—'}, the time and ${geoSaveText(cap.geo)}, sealed on this phone.`);
    renderFacts();
    officer.addEventListener('change', () => {
      if (!officer.value.trim()) return;
      settings = updateSettings({ operatorId: officer.value.trim() });
      toast('Officer ID saved');
      renderFacts();
      renderSave();
    });

    let saving = false;
    const renderSave = () => {
      const done = cap.savedSeq !== null;
      saveBtn.disabled = saving || done || (needsTick && !tick.checked) || !settings.operatorId.trim();
      saveBtn.textContent = done ? `Saved as record ${cap.savedSeq}` : saving ? 'Sealing and saving…' : 'Save sealed record';
      saveState.textContent = !settings.operatorId.trim()
        ? 'Enter your officer ID above to save.'
        : needsTick && !tick.checked && !done
          ? 'Tick the box above to confirm the test is in the white square.'
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
          source: cap.source,
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
    saveCard = h(
      'div',
      { class: 'card' },
      h('label', { for: 'case-ref' }, h('strong', {}, 'Case reference')),
      caseRef,
      h('label', { for: 'location-note' }, h('strong', {}, 'Place note')),
      locNote,
      officerRow,
      tickRow,
      recordFacts,
      saveBtn,
      saveState,
      errorBox,
    );
  }

  const retakeHelp = isRetake
    ? h(
        'div',
        { class: 'card retake-help' },
        advice?.tips.length ? h('ul', { class: 'tips' }, ...advice.tips.map((tip) => h('li', {}, tip))) : null,
        h('p', {}, isSample ? 'This sample is meant to show a photo the app refuses. Nothing is saved for a Retake.' : 'Nothing is saved for a Retake. Fix the problem above and take the photo again.'),
        again,
      )
    : null;

  // 8. Technical details
  const tech = technicalDetails(cap, urls, numbers(cls, s));

  root.append(
    h(
      'section',
      { class: 'page result-page' },
      h('h1', {}, 'Result'),
      sampleLabel,
      verdict,
      retakeHelp,
      colours,
      picture,
      h('p', { class: 'kit-validation' }, h('strong', {}, `Kit: ${kit.name}. `), kit.validationLine),
      h('div', { class: 'notice strong' }, PRESUMPTIVE),
      saveCard,
      tech,
      isRetake ? null : h('div', { class: 'button-row' }, again),
    ),
  );
  return () => urls.forEach((u) => URL.revokeObjectURL(u));
}

/** Session 1's result content (card checks, straightened card, light, correction, 30 patches), unchanged. */
function technicalDetails(cap: CurrentCapture, urls: string[], behind: HTMLElement): HTMLElement {
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
      behind,
      h('h2', {}, 'Card checks'),
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
