// Welcome: the first screen on first launch (and from Settings). Says in one
// line what the app does and offers the two ways in.

import { h } from './dom.ts';
import { updateSettings } from './settings.ts';

export function welcomeScreen(root: HTMLElement, go: (route: string) => void): () => void {
  updateSettings({ welcomed: true });
  root.append(
    h(
      'section',
      { class: 'page welcome' },
      h('img', { class: 'welcome-icon', src: `${import.meta.env.BASE_URL}icons/icon-192.png`, alt: '', width: 72, height: 72 }),
      h('h1', {}, 'Field Test Companion'),
      h('p', { class: 'lead' }, 'Reads a field drug-test kit with the phone camera, gives a result, and saves a sealed record.'),
      h('button', { type: 'button', class: 'primary big', id: 'welcome-start', onclick: () => go('#/test') }, 'Start a test (needs the printed card)'),
      h('button', { type: 'button', class: 'big', id: 'welcome-samples', onclick: () => go('#/samples') }, 'Try with sample images'),
      h('a', { href: '#/about', class: 'nav-link center' }, 'How it works'),
      h('p', { class: 'hint center' }, 'Prototype for Smart India Hackathon 2026, SIH26231. Presumptive result only.'),
    ),
  );
  return () => {};
}
