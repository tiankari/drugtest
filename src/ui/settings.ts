// Per-device settings in localStorage (small, non-critical conveniences).
// Captures themselves live in IndexedDB (store.ts).

import { DATA_TAGS, type DataTag } from '../io/dataset.ts';

export interface Settings {
  dataCollection: boolean;
  phoneModel: string;
  tag: DataTag;
  copy: 'A' | 'B';
  /** Typed by the officer; required before a test. Not verified. */
  operatorId: string;
  /** Selected kit profile id (only matters when more than one kit is bundled). */
  kitId: string;
  /** The welcome screen has been shown once. */
  welcomed: boolean;
  /** Session 3 migration done (photo collection moved to Developer tools, turned off once). */
  s3Migrated: boolean;
}

const KEY = 'fdtc.settings.v1';
const DEFAULTS: Settings = { dataCollection: false, phoneModel: '', tag: 'registration', copy: 'A', operatorId: '', kitId: '', welcomed: false, s3Migrated: false };

type Listener = (s: Settings) => void;
const listeners = new Set<Listener>();

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const s = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
    if (!DATA_TAGS.includes(s.tag)) s.tag = DEFAULTS.tag;
    if (s.copy !== 'A' && s.copy !== 'B') s.copy = 'A';
    return s;
  } catch {
    return { ...DEFAULTS };
  }
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const s = { ...loadSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode or storage blocked: settings stay for this page only.
  }
  for (const l of listeners) l(s);
  return s;
}

export function onSettings(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
