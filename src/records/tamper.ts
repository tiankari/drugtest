// "See tamper detection": make an in-memory COPY of the log with one record's
// result changed, so the real verifier (verifyLog) can be run on it next to
// the real log. The real log is never touched: the copy is a deep copy made
// through JSON (records are plain JSON by construction).

import type { LogEntry, Verdict } from './record.ts';

export interface TamperedCopy {
  copy: LogEntry[];
  /** Which record was changed, and how. */
  seq: number;
  from: Verdict;
  to: Verdict;
}

const SWAP: Record<Verdict, Verdict> = { POSITIVE: 'NEGATIVE', NEGATIVE: 'POSITIVE', INCONCLUSIVE: 'POSITIVE' };

/** A copy of the log with the result of the first record changed; null for an empty log. */
export function tamperedCopy(entries: readonly LogEntry[]): TamperedCopy | null {
  if (!entries.length) return null;
  const copy = JSON.parse(JSON.stringify(entries)) as LogEntry[];
  const target = copy[0].record;
  const from = target.result.verdict;
  const to = SWAP[from];
  target.result.verdict = to;
  return { copy, seq: target.seq, from, to };
}
