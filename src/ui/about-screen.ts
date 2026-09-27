import sheetUrl from '../../print/mat_A4_sheet.pdf?url';
import { h } from './dom.ts';

export function aboutScreen(root: HTMLElement): () => void {
  const swState = h('span', {}, 'checking…');
  if (!('serviceWorker' in navigator)) swState.textContent = 'not supported by this browser';
  else if (import.meta.env.DEV) swState.textContent = 'not used in development';
  else {
    swState.textContent = 'installing… (stay online until this says installed)';
    void navigator.serviceWorker.ready.then(() => (swState.textContent = 'installed — works offline'));
  }

  root.append(
    h(
      'section',
      { class: 'page' },
      h('h1', {}, 'About'),
      h(
        'div',
        { class: 'card' },
        h('p', {}, 'Field Test Companion works alongside existing colour-change drug-test kits. The officer photographs the reacted test on the reference colour card; the app corrects the colours using the card and reads the reaction colour.'),
        h('p', { class: 'strong' }, 'Its output is a presumptive field result. It never replaces laboratory confirmation.'),
        h('p', {}, 'Everything runs on this phone. Photos are never uploaded. No server, no account.'),
      ),
      h(
        'div',
        { class: 'card' },
        h('strong', {}, 'Reference colour card'),
        h('p', {}, 'Print in colour on A4 at 100% (no fit-to-page), check the 50 mm scale bar with a ruler, cut on the crop marks, and register each copy before use.'),
        h('a', { href: sheetUrl, download: 'mat_A4_sheet.pdf', class: 'button' }, 'Download card (A4 PDF)'),
      ),
      h(
        'table',
        { class: 'kv' },
        h('tr', {}, h('th', {}, 'Version'), h('td', {}, __APP_VERSION__)),
        h('tr', {}, h('th', {}, 'Build'), h('td', {}, `${__GIT_COMMIT__} · ${__BUILD_TIME__}`)),
        h('tr', {}, h('th', {}, 'Offline'), h('td', {}, swState)),
      ),
    ),
  );
  return () => {};
}
