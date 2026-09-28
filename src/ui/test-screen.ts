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
    h('h1', {}, 'Operator ID'),
    h('p', {}, 'Every record carries the ID of the officer who ran the test. Enter it once; it is saved on this phone and can be changed in Settings.'),
    h('p', { class: 'hint' }, 'The app does not check this ID against anything: a record proves it was not changed after signing, not who the officer was.'),
    h('label', { for: 'operator-id' }, h('strong', {}, 'Operator ID')),
    input,
    save,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return toast('Enter your operator ID', 'error');
    updateSettings({ operatorId: v });
    go(location.hash || '#/test');
  });
  root.append(form);
  input.focus();
  return () => {};
}
