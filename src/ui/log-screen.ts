// The log of signed records on this phone, newest first.

import type { LogEntry } from '../records/record.ts';
import { errorText, h } from './dom.ts';
import { listEntries } from './log-store.ts';
import { placeText, when } from './record-screen.ts';
import { verdictBadge } from './verdict.ts';

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
        h('span', { class: 'log-when' }, `#${r.seq} · ${when(r.createdAt)}`),
        h('span', {}, `Operator ${r.operator.id} · ${r.kit.name}`),
        h('span', { class: 'hint' }, `${r.caseRef ? `Case ${r.caseRef} · ` : ''}${placeText(r)}`),
      ),
    ),
  );
}

export function logScreen(root: HTMLElement, go: (route: string) => void): () => void {
  const list = h('ul', { class: 'log-list' });
  const status = h('p', { class: 'hint' }, 'Loading…');
  root.append(h('section', { class: 'page' }, h('h1', {}, 'Log'), status, list));
  let alive = true;
  void listEntries().then(
    (entries) => {
      if (!alive) return;
      status.textContent = entries.length ? `${entries.length} signed record${entries.length === 1 ? '' : 's'} on this phone.` : 'No records yet. Save a result from the Test screen.';
      list.replaceChildren(...[...entries].reverse().map((e) => logRow(e, go)));
    },
    (e) => (status.textContent = `Could not read the log: ${errorText(e)}`),
  );
  return () => {
    alive = false;
  };
}
