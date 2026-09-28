import './styles.css';
import { aboutScreen } from './about-screen.ts';
import { capturesScreen } from './captures-screen.ts';
import { clear, h } from './dom.ts';
import { stopGeo } from './geo.ts';
import { logScreen } from './log-screen.ts';
import { recordScreen } from './record-screen.ts';
import { resultScreen } from './result-screen.ts';
import { samplesScreen } from './samples-screen.ts';
import { COLLECTION_BANNER, MIGRATION_NOTE } from './plain.ts';
import { loadSettings, onSettings, updateSettings } from './settings.ts';
import { settingsScreen } from './settings-screen.ts';
import { testScreen } from './test-screen.ts';
import { icon } from './verdict.ts';

type Screen = (root: HTMLElement, go: (route: string) => void, param?: string) => () => void;

// Inline SVG icons (24x24 strokes), always shown with a text label.
const NAV_ICONS = {
  test: 'M9 3h6M10 3v6.5L4.6 18.2A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-2.8L14 9.5V3M7.5 15h9',
  log: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  captures: 'M4 7h3l2-3h6l2 3h3v12H4zM12 17a4 4 0 1 0 0-8a4 4 0 0 0 0 8',
  settings: 'M12 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1',
};

interface Route {
  title: string;
  screen: Screen;
  /** Shown in the bottom navigation: always, only in data collection mode, or never. */
  nav: 'always' | 'dc' | false;
  icon?: string;
  /** Full-screen camera layout. */
  full?: boolean;
}

const ROUTES: Record<string, Route> = {
  '#/test': { title: 'Test', screen: testScreen, nav: 'always', icon: NAV_ICONS.test, full: true },
  '#/log': { title: 'Log', screen: logScreen, nav: 'always', icon: NAV_ICONS.log },
  '#/captures': { title: 'Captures', screen: capturesScreen, nav: 'dc', icon: NAV_ICONS.captures },
  '#/settings': { title: 'Settings', screen: settingsScreen, nav: 'always', icon: NAV_ICONS.settings },
  '#/about': { title: 'About', screen: aboutScreen, nav: false },
  '#/result': { title: 'Result', screen: resultScreen, nav: false },
  '#/samples': { title: 'Samples', screen: samplesScreen, nav: false },
  '#/record': { title: 'Record', screen: recordScreen, nav: false },
};
/** Session 1 links. */
const ALIASES: Record<string, string> = { '#/camera': '#/test' };

const app = document.getElementById('app')!;
const main = h('main', { id: 'main' });
const updateBar = h('div', { class: 'update-bar', hidden: true });
// Photo collection (team only) is announced on EVERY screen while it is on.
const collectBanner = h(
  'div',
  { class: 'dc-banner collect-banner', role: 'status', hidden: true },
  h('span', {}, COLLECTION_BANNER),
  h('button', { type: 'button', class: 'small', id: 'collection-off', onclick: () => updateSettings({ dataCollection: false }) }, 'Turn off'),
);
const noteBar = h('div', { class: 'note-bar', role: 'status', hidden: true });
const nav = h('nav', { class: 'tabs', 'aria-label': 'Sections' });
for (const [route, r] of Object.entries(ROUTES)) {
  if (!r.nav) continue;
  nav.append(h('a', { href: route, 'data-route': route, 'data-nav': r.nav }, r.icon ? icon(r.icon, 'nav-icon') : null, h('span', { class: 'nav-label' }, r.title)));
}
app.append(updateBar, noteBar, collectBanner, main, nav);

let cleanup: (() => void) | null = null;

function parse(hash: string): { route: string; param?: string } {
  if (hash.startsWith('#/record/')) return { route: '#/record', param: hash.slice('#/record/'.length) };
  const route = ALIASES[hash] ?? hash;
  return ROUTES[route] ? { route } : { route: '#/test' };
}

function go(route: string): void {
  if (location.hash !== route) location.hash = route;
  else render();
}

function render(): void {
  const { route, param } = parse(location.hash);
  cleanup?.();
  cleanup = null;
  clear(main);
  const r = ROUTES[route];
  main.className = r.full ? 'full' : '';
  // Location is only needed while testing.
  if (route !== '#/test' && route !== '#/result') stopGeo();
  const active = route === '#/result' || route === '#/samples' ? '#/test' : route === '#/record' ? '#/log' : route;
  for (const a of nav.querySelectorAll('a')) a.classList.toggle('active', a.dataset.route === active);
  cleanup = r.screen(main, go, param);
}

function renderModeFlag(): void {
  const dc = loadSettings().dataCollection;
  document.body.classList.toggle('dc-mode', dc);
  collectBanner.hidden = !dc;
  for (const a of nav.querySelectorAll<HTMLAnchorElement>('a[data-nav="dc"]')) a.hidden = !dc;
  if (!dc && location.hash === '#/captures') go('#/settings');
}

// Session 3: photo collection moved into Developer tools. On the first launch
// after the update, a phone left in collection mode is switched back to
// officer mode, once, with a note saying so.
{
  const s = loadSettings();
  if (!s.s3Migrated) {
    updateSettings({ s3Migrated: true, dataCollection: false });
    if (s.dataCollection) {
      noteBar.hidden = false;
      noteBar.replaceChildren(h('span', {}, MIGRATION_NOTE), h('button', { type: 'button', class: 'small', onclick: () => (noteBar.hidden = true) }, 'OK'));
    }
  }
}

window.addEventListener('hashchange', render);
onSettings(renderModeFlag);
renderModeFlag();
render();

// Service worker: production builds only. A self-signed dev certificate
// blocks registration, so offline behaviour is tested on GitHub Pages.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // The first install also fires controllerchange (clients.claim); only an
  // update the user accepted should reload the page.
  let updateAccepted = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateAccepted) return;
    updateAccepted = false;
    location.reload();
  });
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
    .then((reg) => {
      const offer = (worker: ServiceWorker) => {
        const accept = () => {
          updateAccepted = true;
          worker.postMessage('SKIP_WAITING');
        };
        updateBar.hidden = false;
        updateBar.replaceChildren(h('span', {}, 'A new version is ready.'), h('button', { type: 'button', onclick: accept }, 'Update now'));
      };
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
        });
      });
    })
    .catch((e: unknown) => {
      updateBar.hidden = false;
      updateBar.textContent = `Offline support failed to install: ${e instanceof Error ? e.message : String(e)}`;
    });
}
