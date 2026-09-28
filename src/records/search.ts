// Search and filters for the log screen. Pure: the same entries and the same
// query always give the same list.
//
// Dates are the record's own local date (the first 10 characters of
// createdAt, which carries the phone's offset), so "28 Sep" means the day as
// the phone showed it when the record was signed.

import type { LogEntry, Verdict } from './record.ts';

export interface LogQuery {
  /** Case-insensitive; matches operator ID, case reference, location note or record ID. */
  text?: string;
  verdict?: Verdict | '';
  kitId?: string;
  /** Inclusive local dates, YYYY-MM-DD. */
  from?: string;
  to?: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function matches(e: LogEntry, q: LogQuery): boolean {
  const r = e.record;
  const t = q.text?.trim().toLowerCase();
  if (t) {
    const hay = [r.operator.id, r.caseRef ?? '', r.locationNote ?? '', r.recordId].map((s) => s.toLowerCase());
    if (!hay.some((s) => s.includes(t))) return false;
  }
  if (q.verdict && r.result.verdict !== q.verdict) return false;
  if (q.kitId && r.kit.id !== q.kitId) return false;
  const day = r.createdAt.slice(0, 10);
  if (q.from && DATE.test(q.from) && day < q.from) return false;
  if (q.to && DATE.test(q.to) && day > q.to) return false;
  return true;
}

/** Matching entries, newest first (highest seq first). */
export function searchLog(entries: readonly LogEntry[], q: LogQuery): LogEntry[] {
  return entries.filter((e) => matches(e, q)).sort((a, b) => b.record.seq - a.record.seq);
}

/** Kits that appear in the log, for the kit filter. */
export function kitsInLog(entries: readonly LogEntry[]): { id: string; name: string }[] {
  const m = new Map<string, string>();
  for (const e of entries) m.set(e.record.kit.id, e.record.kit.name);
  return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.id.localeCompare(b.id));
}
