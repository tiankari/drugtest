// The log of saved tests on this phone. Plain words on top; "Check log" and
// "See tamper detection" run the real verifier; the code to write down and
// its comparison sit in a collapsed "Advanced" section. No edit, no delete.

import { checkNotedHash, verifyLog, type LogReport } from '../records/log.ts';
import type { LogEntry, Verdict } from '../records/record.ts';
import { isSampleRecord, kitsInLog, searchLog, type LogQuery } from '../records/search.ts';
import { tamperedCopy } from '../records/tamper.ts';
import { errorText, h, toast } from './dom.ts';
import { canShareFiles, downloadBlob, shareBlob } from './export.ts';
import { buildLogZip } from './log-export.ts';
import { deviceKey, listEntries, photoBytes, verifyStoredLog } from './log-store.ts';
import { plainChecks, plainLogSummary, plainNotedCode, plainProblems, plural } from './plain.ts';
import { placeText, when } from './record-screen.ts';
import { verdictBadge } from './verdict.ts';

export const CLEAR_DATA_WARNING = 'If this browser’s data is cleared, the saved tests are deleted with it. Download the log regularly.';
export const LOG_INTRO = [
  'Every saved test is sealed on this phone and linked to the one before it, like numbered pages in a register.',
  'If anyone changes, removes or reorders a record, Check log shows exactly which one.',
];

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
        h('span', {}, `Officer ${r.operator.id} · ${r.kit.name}`),
        h('span', { class: 'hint' }, `${r.caseRef ? `Case ${r.caseRef} · ` : ''}${placeText(r)}`),
      ),
    ),
  );
}

/** "Download log (for the lab)" with the plain warning; on the Log screen and in Settings. */
export function exportCard(): HTMLElement {
  const dl = h('button', { type: 'button', class: 'primary', id: 'export-log' }, 'Download log (for the lab)');
  const share = h('button', { type: 'button', hidden: !canShareFiles() }, 'Share log file');
  const status = h('p', { class: 'hint' });
  const run = async (how: 'download' | 'share') => {
    dl.disabled = share.disabled = true;
    status.textContent = 'Preparing the file…';
    try {
      const entries = await listEntries();
      if (!entries.length) throw new Error('There are no saved tests to download yet');
      const z = await buildLogZip(entries);
      if (how === 'share') await shareBlob(z.blob, z.name);
      else downloadBlob(z.blob, z.name);
      status.textContent = `Downloaded ${plural(entries.length, 'saved test')} as ${z.name}.`;
    } catch (e) {
      status.textContent = `Download failed: ${errorText(e)}`;
    } finally {
      dl.disabled = share.disabled = false;
    }
  };
  dl.addEventListener('click', () => void run('download'));
  share.addEventListener('click', () => void run('share'));
  return h(
    'div',
    { class: 'card export-card' },
    h('strong', {}, 'Download log (for the lab)'),
    h('p', { class: 'hint' }, 'One file with every saved test, its photo, and instructions for checking it on a computer.'),
    h('div', { class: 'button-row' }, dl, share),
    h('p', { class: 'warn-text' }, CLEAR_DATA_WARNING),
    status,
  );
}

function reportBlock(r: LogReport, cls: string): HTMLElement {
  return h('div', { class: `verify-block ${cls} ${r.ok ? 'ok' : 'bad'}` }, h('p', { class: 'strong' }, plainLogSummary(r)), ...plainProblems(r).map((p) => h('p', { class: 'hint' }, p)));
}

export function logScreen(root: HTMLElement, go: (route: string) => void): () => void {
  let entries: LogEntry[] = [];
  const intro = h('div', { class: 'log-intro' }, ...LOG_INTRO.map((t) => h('p', {}, t)));
  const count = h('p', { class: 'hint', id: 'log-count' }, 'Loading…');
  const list = h('ul', { class: 'log-list' });
  const empty = h(
    'div',
    { class: 'card empty-log', hidden: true },
    h('p', {}, 'No saved tests yet. Run a test or try a sample, then tap Save.'),
    h('div', { class: 'button-row' }, h('a', { href: '#/samples', class: 'button' }, 'Try a sample'), h('a', { href: '#/test', class: 'nav-link' }, 'Start a test')),
  );

  // Check log and tamper detection
  const verifyBtn = h('button', { type: 'button', id: 'verify-log', class: 'primary' }, 'Check log');
  const verifyOut = h('div', { class: 'verify-out', role: 'status', id: 'verify-out' });
  const tamperBtn = h('button', { type: 'button', id: 'tamper-demo' }, 'See tamper detection');
  const tamperOut = h('div', { class: 'tamper-out', role: 'status', id: 'tamper-out' });
  const checks = h(
    'div',
    { class: 'card', hidden: true },
    h('div', { class: 'button-row' }, verifyBtn, tamperBtn),
    verifyOut,
    h('p', { class: 'hint' }, 'Tamper detection changes one result in a copy of the log, in memory only, and runs the same check on the copy.'),
    tamperOut,
  );

  // Search and filters
  const search = h('input', { type: 'search', id: 'log-search', placeholder: 'Search officer, case, place', autocomplete: 'off' });
  const fVerdict = h('select', { id: 'filter-result', 'aria-label': 'Result' }, h('option', { value: '' }, 'Any result'), ...(['POSITIVE', 'NEGATIVE', 'INCONCLUSIVE'] as Verdict[]).map((v) => h('option', { value: v }, v)));
  const fKit = h('select', { id: 'filter-kit', 'aria-label': 'Kit' }, h('option', { value: '' }, 'Any kit'));
  const fSamples = h('select', { id: 'filter-samples', 'aria-label': 'Samples' }, h('option', { value: 'all' }, 'Camera and samples'), h('option', { value: 'hide' }, 'Camera photos only'), h('option', { value: 'only' }, 'Samples only'));
  const fFrom = h('input', { type: 'date', id: 'filter-from', 'aria-label': 'From date' });
  const fTo = h('input', { type: 'date', id: 'filter-to', 'aria-label': 'To date' });
  const filters = h(
    'div',
    { class: 'card filters', hidden: true },
    search,
    h('div', { class: 'filter-row' }, fVerdict, fKit, fSamples),
    h('div', { class: 'filter-row' }, h('label', {}, 'From', fFrom), h('label', {}, 'To', fTo)),
  );

  // Advanced: the code to write down
  const code = h('button', { type: 'button', class: 'latest-hash', id: 'latest-hash', title: 'Tap to copy the whole code' });
  const noted = h('input', { type: 'text', id: 'noted-hash', placeholder: 'Code you wrote down earlier', autocomplete: 'off', spellcheck: false });
  const notedBtn = h('button', { type: 'button', class: 'small', id: 'noted-check' }, 'Compare');
  const notedOut = h('p', { class: 'hint', role: 'status', id: 'noted-out' });
  const advanced = h(
    'details',
    { class: 'advanced', id: 'log-advanced', hidden: true },
    h('summary', {}, 'Advanced'),
    h(
      'div',
      { class: 'tech-body' },
      h('strong', {}, 'Log code to write down'),
      code,
      h('p', { class: 'hint' }, 'Write this code in your case diary or send it to a supervisor. If the newest saved tests are ever deleted, the log will no longer end with this code.'),
      h('div', { class: 'phone-row' }, noted, notedBtn),
      notedOut,
    ),
  );

  const page = h('section', { class: 'page' }, h('h1', {}, 'Log'), intro, empty, checks, filters, count, list, advanced, exportCard());
  root.append(page);

  const query = (): LogQuery => ({ text: search.value, verdict: fVerdict.value as Verdict | '', kitId: fKit.value, from: fFrom.value, to: fTo.value, samples: fSamples.value as LogQuery['samples'] });
  function renderList(): void {
    const shown = searchLog(entries, query());
    count.textContent = `${shown.length} of ${plural(entries.length, 'saved test')}`;
    list.replaceChildren(...shown.map((e) => logRow(e, go)));
  }
  for (const el of [search, fVerdict, fKit, fSamples, fFrom, fTo]) el.addEventListener('input', renderList);

  const full = () => (entries.length ? entries[entries.length - 1].hash : '');
  code.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(full());
      toast('Whole log code copied');
    } catch {
      toast(`Copy failed; the code is ${full()}`, 'error', 10000);
    }
  });
  notedBtn.addEventListener('click', () => (notedOut.textContent = plainNotedCode(entries.length, checkNotedHash(entries, noted.value), noted.value)));

  verifyBtn.addEventListener('click', async () => {
    verifyBtn.disabled = true;
    verifyOut.textContent = 'Checking the log…';
    try {
      verifyOut.replaceChildren(reportBlock(await verifyStoredLog(), 'real'));
    } catch (e) {
      verifyOut.textContent = `The check could not run: ${errorText(e)}`;
    } finally {
      verifyBtn.disabled = false;
    }
  });

  tamperBtn.addEventListener('click', async () => {
    tamperBtn.disabled = true;
    tamperOut.textContent = 'Changing a copy and checking it…';
    try {
      const real = await listEntries();
      const t = tamperedCopy(real);
      if (!t) throw new Error('There are no saved tests yet');
      const k = await deviceKey();
      // The same verifier as Check log, on the changed copy (photos from this phone).
      const onCopy = await verifyLog(t.copy, { publicKey: k.publicKey, keyId: k.keyId, photo: (e) => photoBytes(e.record.seq) });
      const onReal = await verifyStoredLog(real);
      const failing = onCopy.entries.filter((c) => c.problems.length);
      tamperOut.replaceChildren(
        h(
          'div',
          { class: `verify-block tamper-copy ${onCopy.ok ? 'ok' : 'bad'}` },
          h('p', { class: 'strong' }, `In a copy, record ${t.seq}’s result was changed from ${t.from} to ${t.to}. Check log on the copy:`),
          ...failing.map((c) => h('p', {}, `Record ${c.seq}: `, ...plainChecks(c).filter((k) => !k.ok).map((k) => h('span', { class: 'bad-check' }, `✗ ${k.text} `)))),
          onCopy.ok ? h('p', {}, 'The copy passed. This should never happen; please report it.') : null,
        ),
        h('div', { class: `verify-block tamper-real ${onReal.ok ? 'ok' : 'bad'}` }, h('p', { class: 'strong' }, plainLogSummary(onReal)), h('p', {}, 'Your real log was not changed.')),
      );
    } catch (e) {
      tamperOut.textContent = `Tamper detection could not run: ${errorText(e)}`;
    } finally {
      tamperBtn.disabled = false;
    }
  });

  let alive = true;
  void listEntries().then(
    (all) => {
      if (!alive) return;
      entries = all;
      const has = entries.length > 0;
      empty.hidden = has;
      checks.hidden = filters.hidden = count.hidden = list.hidden = advanced.hidden = !has;
      if (!has) {
        count.textContent = 'No saved tests yet.';
        return;
      }
      code.textContent = `${full().slice(0, 12)}…${full().slice(-6)}`;
      code.dataset.full = full();
      for (const k of kitsInLog(entries)) fKit.append(h('option', { value: k.id }, k.name));
      renderList();
    },
    (e) => (count.textContent = `Could not read the log: ${errorText(e)}`),
  );
  return () => {
    alive = false;
  };
}
