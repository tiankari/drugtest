// One signed record: every field with a plain label, the photo, and three
// checks (signature, chain link, photo), each re-computed now, not stored.

import type { EntryCheck } from '../records/log.ts';
import type { LogEntry } from '../records/record.ts';
import { sha256HexOf } from '../records/webcrypto.ts';
import { errorText, h } from './dom.ts';
import { buildRecordZip } from './log-export.ts';
import { downloadBlob } from './export.ts';
import { listEntries, photoOf, verifyStoredLog } from './log-store.ts';
import { verdictBadge } from './verdict.ts';

/** The plain meanings of the checks (shown once, under the checks). */
export const MEANINGS = [
  'The signature shows this record was not changed after it was signed on this phone. It does not prove who the officer is: the operator ID is typed in, not checked.',
  'The chain means a record cannot be removed from the middle of the log, added in, or moved without this check failing. Deleting the newest records is only caught if the latest record hash was noted somewhere else (case diary, a message), which is why the log screen shows it.',
  'An offline phone cannot prove its own clock or GPS were honest: the time and place are what this phone reported.',
];

export function placeText(r: LogEntry['record']): string {
  const loc = r.location;
  const coords = 'lat' in loc ? `${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)} (±${Math.round(loc.accuracyM)} m)` : null;
  return [r.locationNote, coords].filter(Boolean).join(' · ') || ('unavailable' in loc ? `no location (${loc.unavailable})` : '—');
}

export function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

export function recordScreen(root: HTMLElement, go: (route: string) => void, param?: string): () => void {
  const seq = Number(param);
  const urls: string[] = [];
  const page = h('section', { class: 'page record-page' }, h('h1', {}, `Record ${Number.isInteger(seq) ? seq : '?'}`), h('p', { class: 'hint' }, 'Loading…'));
  root.append(page);
  let alive = true;

  void (async () => {
    try {
      const entries = await listEntries();
      const e = entries.find((x) => x.record.seq === seq);
      if (!alive) return;
      if (!e) {
        page.replaceChildren(h('h1', {}, 'Record not found'), h('p', {}, `There is no record ${param} in this phone's log.`), h('button', { type: 'button', onclick: () => go('#/log') }, 'Back to log'));
        return;
      }
      // Hash, signature and chain for the whole log (cheap); the photo for this record only.
      const report = await verifyStoredLog(entries, { photos: false });
      const c = report.entries.find((x) => x.seq === entries.indexOf(e)) as EntryCheck;
      const photo = await photoOf(seq);
      const photoOk = photo ? (await sha256HexOf(new Uint8Array(await photo.arrayBuffer()))) === e.record.image.sha256 : false;
      if (!alive) return;
      render(e, c, photo, photoOk);
    } catch (err) {
      page.replaceChildren(h('h1', {}, `Record ${param}`), h('div', { class: 'error-box' }, `Could not load the record: ${errorText(err)}`));
    }
  })();

  function render(e: LogEntry, c: EntryCheck, photo: Blob | null, photoOk: boolean): void {
    const r = e.record;
    const tick = (ok: boolean, label: string) => h('li', { class: ok ? 'ok' : 'bad' }, h('span', { class: 'mark', 'aria-hidden': 'true' }, ok ? '✓' : '✗'), h('span', {}, `${label}: ${ok ? 'yes' : 'NO'}`));
    const checks = h(
      'ul',
      { class: 'record-checks', 'aria-label': 'Checks' },
      tick(c.hashOk && c.signatureOk && c.keyOk, 'Signature valid'),
      tick(c.chainOk, 'Chain link intact'),
      tick(photoOk, 'Photo matches record'),
    );
    const problems = c.problems.length || c.warnings.length ? h('ul', { class: 'problems' }, ...c.problems.map((p) => h('li', { class: 'bad' }, p)), ...c.warnings.map((w) => h('li', { class: 'warn' }, `Warning: ${w}`))) : null;
    const row = (k: string, v: string | Node | null) => h('tr', {}, h('th', {}, k), h('td', {}, v ?? '—'));
    const hash = (s: string) => h('span', { class: 'hash' }, s);
    const smp = r.analysis.sample as Record<string, unknown>;
    const lab = Array.isArray(smp.correctedLab) ? (smp.correctedLab as number[]).map((v) => v.toFixed(1)).join(', ') : null;
    const loc = r.location;
    const fields = h(
      'table',
      { class: 'kv' },
      row('Result', r.result.verdict),
      row('Why', r.result.reason),
      row('Recorded (phone clock)', `${when(r.createdAt)} (${r.createdAt})`),
      row('Photo taken', r.capturedAt),
      row('Operator ID (typed, not verified)', r.operator.id),
      row('Case reference', r.caseRef),
      row('Location note', r.locationNote),
      row('Location (browser geolocation)', 'lat' in loc ? `${loc.lat.toFixed(6)}, ${loc.lon.toFixed(6)}, accuracy ±${Math.round(loc.accuracyM)} m, fix at ${loc.fixAt}` : `unavailable: ${loc.unavailable}`),
      row('Officer confirmed the test is in the sample zone', r.officerConfirmedTestInZone ? 'yes' : 'no'),
      row('Kit', `${r.kit.name} (${r.kit.id} v${r.kit.version}) — ${r.kit.validation}`),
      row('Kit profile SHA-256', hash(r.kit.profileSha256)),
      row('Card', `MAT v${r.card.version}, copy ${r.card.copy}`),
      row('Card reference SHA-256', hash(r.card.referenceSha256)),
      row('Colour correction', `method ${r.analysis.method}, leave-one-out mean ${r.analysis.looMean.toFixed(2)} ΔE00 (90th pct ${r.analysis.looP90.toFixed(2)}), uneven light ${r.analysis.unevenLight.toFixed(3)}`),
      row('Sample zone', `${String(smp.reason ?? smp.status)}${typeof smp.areaMm2 === 'number' && smp.areaMm2 > 0 ? `, ${smp.areaMm2.toFixed(0)} mm²` : ''}${lab ? `, corrected CIELAB ${lab}` : ''}`),
      row('Nearest target', r.result.nearest ? `${String(r.result.nearest.label)} (${String(r.result.nearest.notation)}): ΔE00 ${Number(r.result.nearest.deltaE00).toFixed(1)}, radius ${Number(r.result.nearest.radius).toFixed(1)}` : null),
      row('Record ID', r.recordId),
      row('Sequence number', String(r.seq)),
      row('Record hash (SHA-256)', hash(e.hash)),
      row('Previous record hash', hash(r.prevHash)),
      row('Device key ID', hash(r.device.keyId)),
      row('Signature (ECDSA P-256, r||s, base64url)', hash(e.signature)),
      row('Photo SHA-256', hash(r.image.sha256)),
      row('Pixels SHA-256', hash(r.image.pixelSha256)),
      row('Image', `${r.image.width}×${r.image.height}`),
      row('App', `${r.app.version} (${r.app.commit})`),
      row('Notice', r.notice),
    );
    let img: HTMLElement | null = null;
    if (photo) {
      const u = URL.createObjectURL(photo);
      urls.push(u);
      img = h('img', { class: 'review-img', src: u, alt: `Photo of record ${r.seq}` });
    }
    const exportBtn = h('button', { type: 'button' }, 'Export this record (JSON + photo)');
    exportBtn.addEventListener('click', async () => {
      try {
        const z = await buildRecordZip(e, photo);
        downloadBlob(z.blob, z.name);
      } catch (err) {
        exportBtn.after(h('div', { class: 'error-box' }, `Export failed: ${errorText(err)}`));
      }
    });
    const src = r.image.source;
    const sampleNote =
      src === 'sample-photo' || src === 'sample-drawn'
        ? h('div', { class: `sample-banner ${src}` }, h('strong', {}, `Sample · ${src === 'sample-drawn' ? 'Computer-drawn image' : 'Real photo'}`), h('span', {}, 'Made from a sample image bundled with the app, not from this phone’s camera.'))
        : null;
    const parts: (Node | null)[] = [
      h('h1', {}, `Record ${r.seq}`),
      sampleNote,
      h('div', { class: `result-verdict v-${r.result.verdict.toLowerCase()}` }, verdictBadge(r.result.verdict, 'large'), h('p', { class: 'why' }, r.result.reason)),
      h('div', { class: 'notice strong' }, r.notice),
      checks,
      problems,
      h('div', { class: 'meanings' }, ...MEANINGS.map((m) => h('p', {}, m))),
      img,
      fields,
      h('div', { class: 'button-row' }, exportBtn, h('button', { type: 'button', onclick: () => go('#/log') }, 'Back to log')),
    ];
    page.replaceChildren(...parts.filter((p): p is Node => p !== null));
  }

  return () => {
    alive = false;
    urls.forEach((u) => URL.revokeObjectURL(u));
  };
}
