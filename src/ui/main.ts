import './styles.css';
import { aboutScreen } from './about-screen.ts';
import { cameraScreen } from './camera-screen.ts';
import { capturesScreen } from './captures-screen.ts';
import { clear, h } from './dom.ts';
import { resultScreen } from './result-screen.ts';
import { loadSettings, onSettings } from './settings.ts';
import { settingsScreen } from './settings-screen.ts';

type Screen = (root: HTMLElement, go: (route: string) => void) => () => void;

const ROUTES: Record<string, { title: string; screen: Screen; nav: boolean }> = {
  '#/camera': { title: 'Camera', screen: cameraScreen, nav: true },
  '#/captures': { title: 'Captures', screen: capturesScreen, nav: true },
  '#/settings': { title: 'Settings', screen: settingsScreen, nav: true },
  '#/about': { title: 'About', screen: aboutScreen, nav: true },
  '#/result': { title: 'Result', screen: resultScreen, nav: false },
};

const app = document.getElementById('app')!;
const main = h('main', { id: 'main' });
const updateBar = h('div', { class: 'update-bar', hidden: true });
const nav = h('nav', { class: 'tabs', 'aria-label': 'Sections' });
for (const [route, r] of Object.entries(ROUTES)) {
  if (r.nav) nav.append(h('a', { href: route, 'data-route': route }, r.title));
}
app.append(updateBar, main, nav);

let cleanup: (() => void) | null = null;

function go(route: string): void {
  if (location.hash !== route) location.hash = route;
  else render();
}

function render(): void {
  const route = ROUTES[location.hash] ? location.hash : '#/camera';
  cleanup?.();
  cleanup = null;
  clear(main);
  main.className = route === '#/camera' ? 'full' : '';
  for (const a of nav.querySelectorAll('a')) a.classList.toggle('active', a.dataset.route === route);
  cleanup = ROUTES[route].screen(main, go);
}

function renderModeFlag(): void {
  document.body.classList.toggle('dc-mode', loadSettings().dataCollection);
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
