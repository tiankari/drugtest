// One saved test: its result in plain words, the photo, three checks
// re-computed now (not stored), the plain fields, and every code under a
// collapsed "Technical details".

import type { Classification, TargetDistance } from '../pipeline/kit.ts';
import type { EntryCheck } from '../records/log.ts';
import type { LogEntry } from '../records/record.ts';
import { sha256HexOf } from '../records/webcrypto.ts';
import { errorText, h } from './dom.ts';
import { downloadBlob } from './export.ts';
import { buildRecordZip } from './log-export.ts';
import { listEntries, photoOf, verifyStoredLog } from './log-store.ts';
import { CHECK_NAMES, plainChecks, plainVerdictSentence } from './plain.ts';
import { verdictBadge } from './verdict.ts';

/** What the checks mean, plainly (visible), and technically (in Technical details). */
export const PLAIN_MEANING = 'Sealed on this phone: any later change to this test, or removing or inserting tests before it, is caught. It does not prove who the officer was, and the time and place are what the phone reported.';
export const MEANINGS = [
  `“${CHECK_NAMES.sealed}”: the stored SHA-256 hash matches the record and the ECDSA P-256 signature verifies with this phone’s public key. It does not prove who the officer is: the officer ID is typed in, not checked.`,
  `“${CHECK_NAMES.linked}”: seq is continuous and prevHash equals the previous record’s hash (a hash chain). Deleting the newest records is only caught against a latest hash noted somewhere else (Log → Advanced → Log code to write down).`,
  `“${CHECK_NAMES.photo}”: the stored photo’s SHA-256 equals image.sha256 in the record.`,
  'An offline phone cannot prove its own clock or GPS were honest: the time and place are what this phone reported.',
];

export function placeText(r: LogEntry['record']): string {
  const loc = r.location;
  const coords = 'lat' in loc ? `${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)} (within ${Math.round(loc.accuracyM)} m)` : null;
  const src = r.image?.source;
  const none = src === 'sample-photo' || src === 'sample-drawn' ? 'sample image (no place)' : 'unavailable' in loc ? `no location (${loc.unavailable})` : '—';
  return [r.locationNote, coords].filter(Boolean).join(' · ') || none;
}

export function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

/** The sealed result as a Classification, for the plain sentence. */
function asClassification(r: LogEntry['record']): Classification {
  return { verdict: r.result.verdict, reason: r.result.reason, classified: true, nearest: (r.result.nearest as unknown as TargetDistance) ?? null, distances: r.result.distances as unknown as TargetDistance[] };
}

export function recordScreen(root: HTMLElement, go: (route: string) => void, param?: string): () => void {
  const seq = Number(param);
  const urls: string[] = [];
  const page = h('section', { class: 'page record-page' }, h('h1', {}, `Saved test, record ${Number.isInteger(seq) ? seq : '?'}`), h('p', { class: 'hint' }, 'Loading…'));
  root.append(page);
  let alive = true;

  void (async () => {
    try {
      const entries = await listEntries();
      const e = entries.find((x) => x.record.seq === seq);
      if (!alive) return;
      if (!e) {
        page.replaceChildren(h('h1', {}, 'Saved test not found'), h('p', {}, `There is no record ${param} in this phone’s log.`), h('button', { type: 'button', onclick: () => go('#/log') }, 'Back to log'));
        return;
      }
      // Seal and links for the whole log (cheap); the photo for this record only.
      const report = await verifyStoredLog(entries, { photos: false });
      const c = report.entries.find((x) => x.seq === entries.indexOf(e)) as EntryCheck;
      const photo = await photoOf(seq);
      const photoOk = photo ? (await sha256HexOf(new Uint8Array(await photo.arrayBuffer()))) === e.record.image.sha256 : false;
      if (!alive) return;
      render(e, { ...c, photoOk }, photo);
    } catch (err) {
      page.replaceChildren(h('h1', {}, `Record ${param}`), h('div', { class: 'error-box' }, `Could not load the saved test: ${errorText(err)}`));
    }
  })();

  function render(e: LogEntry, c: EntryCheck, photo: Blob | null): void {
    const r = e.record;
    const checks = h(
      'ul',
      { class: 'record-checks', 'aria-label': 'Checks' },
      ...plainChecks(c).map((k) => h('li', { class: k.ok ? 'ok' : 'bad' }, h('span', { class: 'mark', 'aria-hidden': 'true' }, k.ok ? '✓' : '✗'), h('span', {}, k.text))),
    );
    const problems = c.problems.length || c.warnings.length ? h('ul', { class: 'problems' }, ...c.warnings.map((w) => h('li', { class: 'warn' }, `Note: ${w}`))) : null;
    const row = (k: string, v: string | Node | null) => h('tr', {}, h('th', {}, k), h('td', {}, v ?? '—'));
    const code = (s: string) => h('span', { class: 'hash' }, s);
    const smp = r.analysis.sample as Record<string, unknown>;
    const lab = Array.isArray(smp.correctedLab) ? (smp.correctedLab as number[]).map((v) => v.toFixed(1)).join(', ') : null;
    const loc = r.location;
    const src = r.image.source;
    const isSample = src === 'sample-photo' || src === 'sample-drawn';
    const sampleNote = isSample
      ? h('div', { class: `sample-banner ${src}` }, h('strong', {}, `Sample · ${src === 'sample-drawn' ? 'Computer-drawn image' : 'Real photo'}`), h('span', {}, 'Made from a sample image bundled with the app, not from this phone’s camera.'))
      : null;
    const fields = h(
      'table',
      { class: 'kv' },
      row('Result', r.result.verdict),
      row('Saved at (phone’s clock)', when(r.createdAt)),
      row('Photo taken', when(r.capturedAt)),
      row('Officer ID (typed in, not checked)', r.operator.id),
      row('Case reference', r.caseRef),
      row('Place note', r.locationNote),
      row('Place (from the phone)', 'lat' in loc ? `${loc.lat.toFixed(6)}, ${loc.lon.toFixed(6)}, within ${Math.round(loc.accuracyM)} m` : isSample ? 'none (sample image)' : `none (${loc.unavailable})`),
      row('Officer confirmed the test is in the white square', r.officerConfirmedTestInZone ? 'yes' : isSample ? 'not asked (sample image)' : 'no'),
      row('Kit', `${r.kit.name}, version ${r.kit.version} (${r.kit.validation === 'published-reference-only' ? 'colours from a published table' : 'checked on real photos'})`),
      row('Photo from', isSample ? (src === 'sample-drawn' ? 'a computer-drawn sample image' : 'a real sample photo') : 'this phone’s camera'),
    );
    const tech = h(
      'details',
      { class: 'tech' },
      h('summary', {}, 'Technical details'),
      h(
        'div',
        { class: 'tech-body' },
        h('div', { class: 'meanings' }, ...MEANINGS.map((m) => h('p', {}, m))),
        c.problems.length ? h('ul', { class: 'problems' }, ...c.problems.map((p) => h('li', { class: 'bad' }, p))) : null,
        h(
          'table',
          { class: 'kv' },
          row('Reason (as sealed)', r.result.reason),
          row('Record ID', r.recordId),
          row('Sequence number', String(r.seq)),
          row('Recorded (ISO 8601)', r.createdAt),
          row('Photo taken (ISO 8601)', r.capturedAt),
          row('Card', `MAT v${r.card.version}, copy ${r.card.copy}`),
          row('Card reference SHA-256', code(r.card.referenceSha256)),
          row('Kit profile', `${r.kit.id} v${r.kit.version}, ${r.kit.validation}`),
          row('Kit profile SHA-256', code(r.kit.profileSha256)),
          row('Colour correction', `method ${r.analysis.method}, leave-one-out mean ${r.analysis.looMean.toFixed(2)} ΔE00 (90th pct ${r.analysis.looP90.toFixed(2)}), uneven light ${r.analysis.unevenLight.toFixed(3)}`),
          row('Sample zone', `${String(smp.reason ?? smp.status)}${typeof smp.areaMm2 === 'number' && smp.areaMm2 > 0 ? `, ${smp.areaMm2.toFixed(0)} mm²` : ''}${lab ? `, corrected CIELAB ${lab}` : ''}`),
          row('Nearest target', r.result.nearest ? `${String(r.result.nearest.label)} (${String(r.result.nearest.notation)}): ΔE00 ${Number(r.result.nearest.deltaE00).toFixed(1)}, radius ${Number(r.result.nearest.radius).toFixed(1)}` : null),
          row('Image source', src ?? 'camera (recorded before image.source existed)'),
          row('Record hash (SHA-256)', code(e.hash)),
          row('Previous record hash', code(r.prevHash)),
          row('Device key ID', code(r.device.keyId)),
          row('Signature (ECDSA P-256, r||s, base64url)', code(e.signature)),
          row('Photo SHA-256', code(r.image.sha256)),
          row('Pixels SHA-256', code(r.image.pixelSha256)),
          row('Image', `${r.image.width}×${r.image.height}`),
          row('App', `${r.app.version} (${r.app.commit})`),
        ),
      ),
    );
    let img: HTMLElement | null = null;
    if (photo) {
      const u = URL.createObjectURL(photo);
      urls.push(u);
      img = h('img', { class: 'review-img', src: u, alt: `Photo of saved test ${r.seq}` });
    }
    const exportBtn = h('button', { type: 'button', id: 'export-record' }, 'Download this test (for the lab)');
    exportBtn.addEventListener('click', async () => {
      try {
        const z = await buildRecordZip(e, photo);
        downloadBlob(z.blob, z.name);
      } catch (err) {
        exportBtn.after(h('div', { class: 'error-box' }, `Download failed: ${errorText(err)}`));
      }
    });
    const parts: (Node | null)[] = [
      h('h1', {}, `Saved test, record ${r.seq}`),
      sampleNote,
      h('div', { class: `result-verdict v-${r.result.verdict.toLowerCase()}` }, verdictBadge(r.result.verdict, 'large'), h('p', { class: 'why' }, plainVerdictSentence(asClassification(r)))),
      h('div', { class: 'notice strong' }, r.notice),
      checks,
      problems,
      h('p', { class: 'meaning' }, PLAIN_MEANING),
      img,
      fields,
      tech,
      h('div', { class: 'button-row' }, exportBtn, h('button', { type: 'button', onclick: () => go('#/log') }, 'Back to log')),
    ];
    page.replaceChildren(...parts.filter((p): p is Node => p !== null));
  }

  return () => {
    alive = false;
    urls.forEach((u) => URL.revokeObjectURL(u));
  };
}
