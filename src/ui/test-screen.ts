// The Test screen: asks for the operator ID once (saved in Settings), then the
// camera with live card guidance. Data collection mode goes straight to the
// camera (no record is ever made there).

import { cameraScreen } from './camera-screen.ts';
import { h, toast } from './dom.ts';
import { loadSettings, updateSettings } from './settings.ts';

export function testScreen(root: HTMLElement, go: (route: string) => void): () => void {
  const s = loadSettings();
  if (s.dataCollection || s.operatorId.trim()) return cameraScreen(root, go);
  root.classList.remove('full');
  const input = h('input', { type: 'text', id: 'operator-id', placeholder: 'e.g. badge or service number', autocomplete: 'off', maxlength: 80 });
  const save = h('button', { type: 'submit', class: 'primary big' }, 'Save and continue');
  const form = h(
    'form',
    { class: 'page operator-form' },
    h('h1', {}, 'Your officer ID'),
    h('p', {}, 'It is written on every test you save. Enter it once; you can change it in Settings.'),
    h('p', { class: 'hint' }, 'The app does not check this ID. A saved test proves it was not changed afterwards, not who took it.'),
    h('label', { for: 'operator-id' }, h('strong', {}, 'Officer ID')),
    input,
    save,
    h('p', { class: 'hint' }, h('a', { href: '#/samples', class: 'nav-link' }, 'No card? Try a sample instead')),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return toast('Enter your officer ID', 'error');
    updateSettings({ operatorId: v });
    go(location.hash || '#/test');
  });
  root.append(form);
  input.focus();
  return () => {};
}
