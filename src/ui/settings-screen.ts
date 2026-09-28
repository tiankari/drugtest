// Settings: the officer ID, downloading the log, About. Everything for the
// team (photo collection, phone model, camera request, thresholds) sits in a
// collapsed "Developer tools" section, off by default.

import { phoneSlug } from '../io/dataset.ts';
import { PARAMS, THRESHOLDS } from '../pipeline/config.ts';
import { h, toast } from './dom.ts';
import { exportCard } from './log-screen.ts';
import { COLLECTION_LINE, THRESHOLD_NAMES } from './plain.ts';
import { loadSettings, onSettings, updateSettings } from './settings.ts';

export function settingsScreen(root: HTMLElement): () => void {
  const s = loadSettings();
  const operator = h('input', { type: 'text', id: 'operator', value: s.operatorId, placeholder: 'e.g. badge or service number', autocomplete: 'off', maxlength: 80 });
  operator.addEventListener('change', () => {
    updateSettings({ operatorId: operator.value.trim() });
    toast(operator.value.trim() ? 'Officer ID saved' : 'Officer ID cleared: you will be asked for it before the next test');
  });

  // Developer tools
  const dcToggle = h('input', { type: 'checkbox', id: 'dc-toggle', ...(s.dataCollection ? { checked: true } : {}) });
  const phone = h('input', { type: 'text', id: 'phone', value: s.phoneModel, placeholder: 'e.g. Redmi Note 12', autocomplete: 'off' });
  const slug = h('span', { class: 'hint' });
  const renderSlug = () => (slug.textContent = phoneSlug(phone.value) ? `File names will use: ${phoneSlug(phone.value)}` : 'Needed before collecting photos.');
  renderSlug();
  const phoneCard = h('div', { class: 'card', hidden: !s.dataCollection }, h('label', { for: 'phone' }, h('strong', {}, 'Phone model (for photo file names)')), phone, slug);
  dcToggle.addEventListener('change', () => updateSettings({ dataCollection: dcToggle.checked }));
  phone.addEventListener('input', renderSlug);
  phone.addEventListener('change', () => {
    updateSettings({ phoneModel: phone.value.trim() });
    toast('Phone model saved');
  });
  const off = onSettings((n) => {
    dcToggle.checked = n.dataCollection;
    phoneCard.hidden = !n.dataCollection;
  });

  const thresholdRows = (Object.keys(THRESHOLDS) as (keyof typeof THRESHOLDS)[]).map((k) => {
    const t = THRESHOLDS[k];
    return h(
      'li',
      { class: 'threshold' },
      h('span', { class: 'plain-name' }, THRESHOLD_NAMES[k]),
      h('span', { class: 'tech-name' }, `${k} = ${t.value} (${t.unit}) · `, h('span', { class: `badge ${t.status}` }, t.status)),
    );
  });

  const dev = h(
    'details',
    { class: 'dev-tools', id: 'dev-tools' },
    h('summary', {}, 'Developer tools'),
    h(
      'div',
      { class: 'tech-body' },
      h(
        'div',
        { class: 'card' },
        h('label', { class: 'toggle', for: 'dc-toggle' }, dcToggle, h('span', {}, h('strong', {}, 'Photo collection'))),
        h('p', { class: 'hint' }, COLLECTION_LINE),
        h('p', { class: 'hint' }, 'While it is on, capture works even when checks fail (so deliberately bad photos can be collected), each photo is tagged and saved on this phone, and the Captures tab appears.'),
      ),
      phoneCard,
      h(
        'div',
        { class: 'card' },
        h('strong', {}, 'Camera request'),
        h('p', { class: 'hint' }, `Rear camera, ${PARAMS.requestWidth}×${PARAMS.requestHeight} requested. What the phone delivers is recorded with every photo.`),
      ),
      h(
        'div',
        { class: 'card' },
        h('strong', {}, 'Checks and their limits'),
        h('p', { class: 'hint' }, 'Provisional = a reasoned starting value, not yet checked against enough real photos. Derived = computed from named real photos.'),
        h('ul', { class: 'thresholds' }, ...thresholdRows),
      ),
    ),
  );

  root.append(
    h(
      'section',
      { class: 'page' },
      h('h1', {}, 'Settings'),
      h(
        'div',
        { class: 'card' },
        h('label', { for: 'operator' }, h('strong', {}, 'Officer ID')),
        operator,
        h('p', { class: 'hint' }, 'Written on every test you save. The app does not check it.'),
      ),
      h('h2', {}, 'Saved tests'),
      exportCard(),
      h('div', { class: 'card' }, h('a', { href: '#/about', class: 'nav-link' }, 'About this app and how it works'), h('a', { href: '#/welcome', class: 'nav-link' }, 'Welcome screen')),
      dev,
    ),
  );
  return () => off();
}
