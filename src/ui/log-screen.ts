// The log of signed records on this phone: latest record hash (to note
// down elsewhere), whole-log verification, search and filters, export.
// There is no edit and no delete.

import { checkNotedHash, type LogReport } from '../records/log.ts';
import type { LogEntry, Verdict } from '../records/record.ts';
import { isSampleRecord, kitsInLog, searchLog, type LogQuery } from '../records/search.ts';
import { errorText, h, toast } from './dom.ts';
import { canShareFiles, downloadBlob, shareBlob } from './export.ts';
import { buildLogZip } from './log-export.ts';
import { listEntries, verifyStoredLog } from './log-store.ts';
import { placeText, when } from './record-screen.ts';
import { verdictBadge } from './verdict.ts';

export const CLEAR_DATA_WARNING = 'Clearing this site’s data (or uninstalling the browser) deletes the signing key and the whole log together. Only an exported log survives that: export regularly.';

export function logRow(e: LogEntry, go: (route: string) => void): HTMLElement {
  const r = e.record;
  return h(
    'li',
    {},
    h(
      'button',
      { type: 'button', class: 'log-row', onclick: () => go(`#/record/${r.seq}`), 'aria-label': `Record ${r.seq}, ${r.result.verdict}` },
      verdictBadge(r.result.verdict),
      h(
        'span',
        { class: 'log-meta' },
        h('span', { class: 'log-when' }, `#${r.seq} · ${when(r.createdAt)}`, isSampleRecord(e) ? h('span', { class: 'sample-badge small' }, 'Sample') : null),
        h('span', {}, `Operator ${r.operator.id} · ${r.kit.name}`),
        h('span', { class: 'hint' }, `${r.caseRef ? `Case ${r.caseRef} · ` : ''}${placeText(r)}`),
      ),
    ),
  );
}

export function summariseReport(r: LogReport): string {
  if (r.count === 0) return 'The log is empty.';
  const n = (f: (c: LogReport['entries'][number]) => boolean) => r.entries.filter(f).length;
  const parts = [
    `${r.count} record${r.count === 1 ? '' : 's'} checked`,
    `signatures valid: ${n((c) => c.hashOk && c.signatureOk && c.keyOk)}/${r.count}`,
    `chain links intact: ${n((c) => c.chainOk)}/${r.count}`,
    `photos match: ${n((c) => c.photoOk === true)}/${r.count}`,
    `clock warnings: ${r.clockWarnings}`,
  ];
  return `${r.ok ? '✓ All checks passed' : `✗ ${r.failures} record${r.failures === 1 ? '' : 's'} failed`} — ${parts.join('; ')}.`;
}

/** Export buttons with the plain warning; used on the Log screen and in Settings. */
export function exportCard(): HTMLElement {
  const dl = h('button', { type: 'button', class: 'primary', id: 'export-log' }, 'Export whole log (.zip)');
  const share = h('button', { type: 'button', hidden: !canShareFiles() }, 'Share .zip');
  const status = h('p', { class: 'hint' });
  const run = async (how: 'download' | 'share') => {
    dl.disabled = share.disabled = true;
    status.textContent = 'Building the export…';
    try {
      const entries = await listEntries();
      if (!entries.length) throw new Error('There are no records to export yet');
      const z = await buildLogZip(entries);
      if (how === 'share') await shareBlob(z.blob, z.name);
      else downloadBlob(z.blob, z.name);
      status.textContent = `Exported ${entries.length} record${entries.length === 1 ? '' : 's'} as ${z.name}.`;
    } catch (e) {
      status.textContent = `Export failed: ${errorText(e)}`;
    } finally {
      dl.disabled = share.disabled = false;
    }
  };
  dl.addEventListener('click', () => void run('download'));
  share.addEventListener('click', () => void run('share'));
  return h(
    'div',
    { class: 'card export-card' },
    h('strong', {}, 'Export'),
    h('p', { class: 'hint' }, 'A .zip with every record (JSONL), every photo, the public key and VERIFY.md explaining how to check it.'),
    h('div', { class: 'button-row' }, dl, share),
    h('p', { class: 'warn-text' }, CLEAR_DATA_WARNING),
    status,
  );
}

export function logScreen(root: HTMLElement, go: (route: string) => void): () => void {
  let entries: LogEntry[] = [];
  const latest = h('button', { type: 'button', class: 'latest-hash', id: 'latest-hash', title: 'Tap to copy the full hash' });
  const latestHelp = h('p', { class: 'hint' }, 'Note this down outside the phone (case diary, a message). Deleting the newest records can only be detected by comparing with a hash noted earlier.');
  const noted = h('input', { type: 'text', id: 'noted-hash', placeholder: 'Check a hash noted earlier (12+ hex digits)', autocomplete: 'off', spellcheck: false });
  const notedBtn = h('button', { type: 'button', class: 'small' }, 'Check');
  const notedOut = h('p', { class: 'hint', role: 'status' });
  const verifyBtn = h('button', { type: 'button', id: 'verify-log' }, 'Verify whole log');
  const verifyOut = h('div', { class: 'verify-out', role: 'status', id: 'verify-out' });

  const search = h('input', { type: 'search', id: 'log-search', placeholder: 'Search operator, case ref, location note, record ID', autocomplete: 'off' });
  const fVerdict = h('select', { id: 'filter-result', 'aria-label': 'Result' }, h('option', { value: '' }, 'Any result'), ...(['POSITIVE', 'NEGATIVE', 'INCONCLUSIVE'] as Verdict[]).map((v) => h('option', { value: v }, v)));
  const fKit = h('select', { id: 'filter-kit', 'aria-label': 'Kit' }, h('option', { value: '' }, 'Any kit'));
  const fSamples = h('select', { id: 'filter-samples', 'aria-label': 'Samples' }, h('option', { value: 'all' }, 'Camera and samples'), h('option', { value: 'hide' }, 'Camera photos only'), h('option', { value: 'only' }, 'Samples only'));
  const fFrom = h('input', { type: 'date', id: 'filter-from', 'aria-label': 'From date' });
  const fTo = h('input', { type: 'date', id: 'filter-to', 'aria-label': 'To date' });
  const count = h('p', { class: 'hint', id: 'log-count' }, 'Loading…');
  const list = h('ul', { class: 'log-list' });

  root.append(
    h(
      'section',
      { class: 'page' },
      h('h1', {}, 'Log'),
      h('div', { class: 'card' }, h('strong', {}, 'Latest record hash'), latest, latestHelp, h('div', { class: 'phone-row' }, noted, notedBtn), notedOut),
      h('div', { class: 'card' }, verifyBtn, verifyOut),
      h(
        'div',
        { class: 'card filters' },
        search,
        h('div', { class: 'filter-row' }, fVerdict, fKit, fSamples),
        h('div', { class: 'filter-row' }, h('label', {}, 'From', fFrom), h('label', {}, 'To', fTo)),
      ),
      count,
      list,
      exportCard(),
    ),
  );

  const query = (): LogQuery => ({ text: search.value, verdict: fVerdict.value as Verdict | '', kitId: fKit.value, from: fFrom.value, to: fTo.value, samples: fSamples.value as LogQuery['samples'] });
  function renderList(): void {
    const shown = searchLog(entries, query());
    count.textContent = entries.length ? `${shown.length} of ${entries.length} signed record${entries.length === 1 ? '' : 's'}` : 'No records yet. Save a result from the Test screen.';
    list.replaceChildren(...shown.map((e) => logRow(e, go)));
  }
  for (const el of [search, fVerdict, fKit, fSamples, fFrom, fTo]) el.addEventListener('input', renderList);

  const full = () => (entries.length ? entries[entries.length - 1].hash : '');
  latest.addEventListener('click', async () => {
    if (!full()) return;
    try {
      await navigator.clipboard.writeText(full());
      toast('Full latest record hash copied');
    } catch {
      toast(`Copy failed; the hash is ${full()}`, 'error', 10000);
    }
  });
  notedBtn.addEventListener('click', () => (notedOut.textContent = checkNotedHash(entries, noted.value).message));
  verifyBtn.addEventListener('click', async () => {
    verifyBtn.disabled = true;
    verifyOut.className = 'verify-out';
    verifyOut.textContent = 'Checking every hash, signature, chain link and photo…';
    try {
      const r = await verifyStoredLog();
      verifyOut.className = `verify-out ${r.ok ? 'ok' : 'bad'}`;
      const bad = r.entries.filter((c) => c.problems.length || c.warnings.length);
      verifyOut.replaceChildren(h('p', { class: 'strong' }, summariseReport(r)), ...bad.map((c) => h('p', { class: 'hint' }, `Record ${c.seq}: ${[...c.problems, ...c.warnings.map((w) => `warning: ${w}`)].join('; ')}`)));
    } catch (e) {
      verifyOut.className = 'verify-out bad';
      verifyOut.textContent = `Verification could not run: ${errorText(e)}`;
    } finally {
      verifyBtn.disabled = false;
    }
  });

  let alive = true;
  void listEntries().then(
    (all) => {
      if (!alive) return;
      entries = all;
      latest.textContent = full() ? `${full().slice(0, 12)}…${full().slice(-6)}` : '— (no records yet)';
      latest.dataset.full = full();
      for (const k of kitsInLog(entries)) fKit.append(h('option', { value: k.id }, k.name));
      renderList();
    },
    (e) => (count.textContent = `Could not read the log: ${errorText(e)}`),
  );
  return () => {
    alive = false;
  };
}
