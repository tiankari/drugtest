// Verdict badge: a word, an icon and a colour together, so the result never
// depends on colour alone. Inline SVG, no icon library.

import { h } from './dom.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Icon paths on a 24x24 grid, drawn as strokes. */
const ICONS: Record<string, string> = {
  // plus in a circle
  POSITIVE: 'M12 2.5a9.5 9.5 0 1 0 0 19a9.5 9.5 0 1 0 0-19M12 7v10M7 12h10',
  // minus in a circle
  NEGATIVE: 'M12 2.5a9.5 9.5 0 1 0 0 19a9.5 9.5 0 1 0 0-19M7 12h10',
  // question mark in a circle
  INCONCLUSIVE: 'M12 2.5a9.5 9.5 0 1 0 0 19a9.5 9.5 0 1 0 0-19M9.2 9.3a2.9 2.9 0 1 1 4.3 2.5c-.9.5-1.5 1.1-1.5 2.2v.6M12 17.2v.3',
  // circular arrow
  RETAKE: 'M19 12a7 7 0 1 1-2.05-4.95M19 4.5v3.5h-3.5',
};

export function icon(path: string, cls = 'icon'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', path);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

export function verdictBadge(verdict: string, size: 'large' | 'chip' = 'chip'): HTMLElement {
  return h('span', { class: `verdict-badge ${size} v-${verdict.toLowerCase()}` }, icon(ICONS[verdict] ?? ICONS.INCONCLUSIVE), h('span', { class: 'word' }, verdict));
}
