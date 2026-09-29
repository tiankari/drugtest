// How it works (and About): five plain steps, the kits, the printed card,
// and the build.

import sheetUrl from '../../print/mat_A4_sheet.pdf?url';
import { h } from './dom.ts';
import { KITS } from './kits.ts';
import { targetName } from './plain.ts';
import { icon } from './verdict.ts';

const STEP_ICONS = {
  kit: 'M9 3h6M10 3v6.5L4.6 18.2A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-2.8L14 9.5V3M7.5 15h9',
  photo: 'M4 7h3l2-3h6l2 3h3v12H4zM12 17a4 4 0 1 0 0-8a4 4 0 0 0 0 8',
  light: 'M12 16a4 4 0 1 0 0-8a4 4 0 0 0 0 8M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  compare: 'M7 7h10M7 7l3-3M7 7l3 3M17 17H7M17 17l-3-3M17 17l-3 3',
  seal: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4M12 15v2',
};

export function aboutScreen(root: HTMLElement): () => void {
  const swState = h('span', {}, 'checking…');
  if (!('serviceWorker' in navigator)) swState.textContent = 'not supported by this browser';
  else if (import.meta.env.DEV) swState.textContent = 'not used in development';
  else {
    swState.textContent = 'installing… (stay online until this says installed)';
    void navigator.serviceWorker.ready.then(() => (swState.textContent = 'installed — works offline'));
  }
  const step = (path: string, title: string, text: string) => h('li', {}, h('span', { class: 'step-icon' }, icon(path)), h('span', { class: 'step-text' }, h('strong', {}, title), h('span', {}, text)));

  root.append(
    h(
      'section',
      { class: 'page' },
      h('h1', {}, 'How it works'),
      h(
        'ol',
        { class: 'how-steps' },
        step(STEP_ICONS.kit, 'Do the kit test as usual.', 'The app works alongside the colour-change kits officers already use.'),
        step(STEP_ICONS.photo, 'Put the test on the printed reference colour card and take a photo in the app.', 'The test goes in the white square; the card must be fully in view.'),
        step(STEP_ICONS.light, 'The card’s known colours let the app correct for the lighting.', 'Daylight, a tube light or a shadow change how colours look; the card’s colour squares show by how much.'),
        step(
          STEP_ICONS.compare,
          'The app compares the test colour with the kit’s reference colours: POSITIVE, NEGATIVE or INCONCLUSIVE.',
          'If the photo is not good enough (blur, shadow, glare, card too far, a corner hidden), it says Retake and why. This is detected automatically.',
        ),
        step(STEP_ICONS.seal, 'Saving makes a sealed record in the log.', 'It holds the time, the place, the officer and the photo’s fingerprint. Any later change to it is caught.'),
      ),
      h('div', { class: 'notice' }, 'It gives a presumptive field result. It never replaces laboratory confirmation.'),
      h(
        'div',
        { class: 'card kits' },
        h('strong', {}, KITS.length === 1 ? 'The kit' : `The ${KITS.length} kits`),
        KITS.length
          ? h('ul', { class: 'kit-list' }, ...KITS.map((k) => h('li', {}, h('strong', {}, k.name), `: ${k.detects.map(targetName).join(', ')}.`)))
          : h('p', {}, 'No kit is bundled in this build.'),
        h('p', {}, `${KITS.length > 1 ? 'Choose the kit you used on the camera screen: the same colour means different drugs with different reagents. ' : ''}Colours from NIJ Standard-0604.01 (a US Department of Justice standard), not yet checked on a real reaction.`),
      ),
      h(
        'div',
        { class: 'card' },
        h('strong', {}, 'The reference colour card'),
        h('p', {}, 'A printed card with 30 known colours, four black corner squares the app finds automatically, and a white square for the test. Print it in colour on A4 at 100% and check the 50 mm bar with a ruler. Each print is set up once in the app before use; the two cards used for this prototype (A and B) are set up already.'),
        h('a', { href: sheetUrl, download: 'mat_A4_sheet.pdf', class: 'button' }, 'Download card (A4 PDF)'),
      ),
      h(
        'div',
        { class: 'card' },
        h('strong', {}, 'Privacy'),
        h('p', {}, 'Everything runs on this phone. Photos are never uploaded. No server, no account.'),
      ),
      h('div', { class: 'button-row' }, h('a', { href: '#/samples', class: 'button' }, 'Try with sample images'), h('a', { href: '#/welcome', class: 'nav-link' }, 'Welcome screen')),
      h(
        'table',
        { class: 'kv small' },
        h('tr', {}, h('th', {}, 'Version'), h('td', {}, __APP_VERSION__)),
        h('tr', {}, h('th', {}, 'Build'), h('td', {}, `${__GIT_COMMIT__} · ${__BUILD_TIME__}`)),
        h('tr', {}, h('th', {}, 'Offline'), h('td', {}, swState)),
      ),
    ),
  );
  return () => {};
}
