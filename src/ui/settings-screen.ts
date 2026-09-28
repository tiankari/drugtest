import { phoneSlug } from '../io/dataset.ts';
import { PARAMS, THRESHOLDS } from '../pipeline/config.ts';
import { h, toast } from './dom.ts';
import { loadSettings, updateSettings } from './settings.ts';

export function settingsScreen(root: HTMLElement): () => void {
  const s = loadSettings();
  const dcToggle = h('input', { type: 'checkbox', id: 'dc-toggle', ...(s.dataCollection ? { checked: true } : {}) });
  const phone = h('input', { type: 'text', id: 'phone', value: s.phoneModel, placeholder: 'e.g. Redmi Note 12', autocomplete: 'off' });
  const operator = h('input', { type: 'text', id: 'operator', value: s.operatorId, placeholder: 'e.g. badge or service number', autocomplete: 'off', maxlength: 80 });
  operator.addEventListener('change', () => {
    updateSettings({ operatorId: operator.value.trim() });
    toast(operator.value.trim() ? 'Operator ID saved' : 'Operator ID cleared: you will be asked for it before the next test');
  });
  const slug = h('span', { class: 'hint' });
  const renderSlug = () => (slug.textContent = phoneSlug(phone.value) ? `File names will use: ${phoneSlug(phone.value)}` : 'Required for data collection.');
  renderSlug();

  dcToggle.addEventListener('change', () => updateSettings({ dataCollection: dcToggle.checked }));
  phone.addEventListener('input', renderSlug);
  phone.addEventListener('change', () => {
    updateSettings({ phoneModel: phone.value.trim() });
    toast('Phone model saved');
  });

  const thresholdRows = Object.entries(THRESHOLDS).map(([k, t]) =>
    h('tr', {}, h('th', {}, k), h('td', {}, String(t.value)), h('td', {}, h('span', { class: `badge ${t.status}` }, t.status))),
  );

  root.append(
    h(
      'section',
      { class: 'page' },
      h('h1', {}, 'Settings'),
      h(
        'div',
        { class: 'card' },
        h('label', { for: 'operator' }, h('strong', {}, 'Operator ID')),
        operator,
        h('p', { class: 'hint' }, 'Written into every record you sign. The app does not verify it: a record proves it was not changed after signing on this phone, not who the officer was.'),
      ),
      h(
        'div',
        { class: 'card' },
        h('label', { class: 'toggle', for: 'dc-toggle' }, dcToggle, h('span', {}, h('strong', {}, 'Data collection mode'))),
        h(
          'p',
          { class: 'hint' },
          'For building the photo test set only. Capture works even when checks fail, so deliberately bad photos can be collected. It never shows a result. Each photo is tagged and saved on this phone until you export it.',
        ),
      ),
      h('div', { class: 'card' }, h('label', { for: 'phone' }, h('strong', {}, 'Phone model')), phone, slug),
      h(
        'div',
        { class: 'card' },
        h('strong', {}, 'Camera request'),
        h('p', { class: 'hint' }, `Rear camera, ${PARAMS.requestWidth}×${PARAMS.requestHeight} requested. What the phone actually delivers is shown on the camera screen and recorded in every capture.`),
      ),
      h(
        'div',
        { class: 'card' },
        h('strong', {}, 'Thresholds in use'),
        h('p', { class: 'hint' }, 'Provisional = a reasoned starting value not yet checked against real photos.'),
        h('table', { class: 'kv small' }, ...thresholdRows),
      ),
      h('div', { class: 'card' }, h('a', { href: '#/about', class: 'nav-link' }, 'About this app, the card PDF and the build')),
    ),
  );
  return () => {};
}
