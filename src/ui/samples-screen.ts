// "Try with sample images": for anyone without the printed card. Each sample
// runs through the full pipeline; the expected outcome is a label, not a result.

import { errorText, h } from './dom.ts';
import { KITS } from './kits.ts';
import { runSample, sampleKindText, SAMPLES } from './samples.ts';

export function samplesScreen(root: HTMLElement, go: (route: string) => void): () => void {
  const status = h('p', { class: 'hint', role: 'status' });
  let busy = false;
  const cards = SAMPLES.map((s) => {
    const btn = h('button', { type: 'button', class: 'sample-card', 'data-sample': s.id, 'aria-label': `Try the sample: ${s.title}` },
      h('img', { class: 'sample-thumb', src: s.url, alt: '', loading: 'lazy' }),
      h(
        'span',
        { class: 'sample-meta' },
        h('strong', {}, s.title),
        h('span', { class: `sample-badge ${s.kind}` }, sampleKindText(s.kind)),
        s.kind === 'sample-drawn' ? h('span', { class: 'hint' }, 'No real reaction was photographed; this shows what the app does with that colour.') : null,
        h('span', { class: 'hint sample-kit' }, `Read with: ${KITS.find((k) => k.id === s.kitId)?.name ?? `kit ${s.kitId} (not in this build)`}`),
        h('span', { class: 'expect' }, `We expect: ${s.expected === 'RETAKE' ? 'Retake, with the reason' : s.expected}`),
      ),
    );
    btn.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      for (const c of cards) c.disabled = true;
      status.textContent = `Analysing “${s.title}” with the same steps as a camera photo…`;
      try {
        await runSample(s);
        go('#/result');
      } catch (e) {
        status.textContent = `This sample could not be run: ${errorText(e)}`;
        for (const c of cards) c.disabled = false;
        busy = false;
      }
    });
    return btn;
  });
  root.append(
    h(
      'section',
      { class: 'page' },
      h('h1', {}, 'Try with sample images'),
      h('p', {}, 'No printed card? Pick a sample. The app reads it exactly as it reads a camera photo, then shows whatever it finds. You can save the result and see it in the log, marked as a sample.'),
      h('div', { class: 'sample-list' }, ...cards),
      status,
      h('p', { class: 'hint' }, 'The real photos were taken with the app on a Nothing Phone (3a) and cropped to the card. Samples are always labelled as samples, on screen and in saved tests.'),
    ),
  );
  return () => {};
}
