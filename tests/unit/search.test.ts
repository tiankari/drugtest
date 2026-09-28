import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../../src/records/record.ts';
import { kitsInLog, searchLog } from '../../src/records/search.ts';

function entry(seq: number, over: Partial<LogEntry['record']> & { verdict?: 'POSITIVE' | 'NEGATIVE' | 'INCONCLUSIVE'; kitId?: string } = {}): LogEntry {
  const { verdict = 'NEGATIVE', kitId = 'marquis-opiates', ...rest } = over;
  return {
    hash: String(seq).padStart(64, '0'),
    signature: 'x',
    record: {
      seq,
      recordId: `rec-${seq}-uuid`,
      createdAt: `2026-09-${String(20 + seq).padStart(2, '0')}T10:00:00.000+05:30`,
      operator: { id: 'OFFICER-A' },
      caseRef: null,
      locationNote: null,
      kit: { id: kitId, version: 1, name: kitId === 'marquis-opiates' ? 'Marquis reagent — opiate screen' : 'Other kit', profileSha256: '', validation: 'published-reference-only' },
      result: { verdict, reason: '', nearest: null, distances: [] },
      ...rest,
    } as LogEntry['record'],
  };
}

const log = [
  entry(0),
  entry(1, { operator: { id: 'officer-b' }, caseRef: 'FIR 12/2026', verdict: 'POSITIVE' }),
  entry(2, { locationNote: 'Wagah checkpoint', verdict: 'INCONCLUSIVE', kitId: 'haldi' }),
  entry(3, { caseRef: 'fir 99' }),
];

describe('log search and filters', () => {
  it('newest first with no query', () => {
    expect(searchLog(log, {}).map((e) => e.record.seq)).toEqual([3, 2, 1, 0]);
  });
  it('text matches operator, case reference, location note and record id, case-insensitively', () => {
    expect(searchLog(log, { text: 'OFFICER-B' }).map((e) => e.record.seq)).toEqual([1]);
    expect(searchLog(log, { text: 'fir' }).map((e) => e.record.seq)).toEqual([3, 1]);
    expect(searchLog(log, { text: 'wagah' }).map((e) => e.record.seq)).toEqual([2]);
    expect(searchLog(log, { text: 'rec-0-' }).map((e) => e.record.seq)).toEqual([0]);
    expect(searchLog(log, { text: '  ' })).toHaveLength(4);
  });
  it('filters by result and kit', () => {
    expect(searchLog(log, { verdict: 'POSITIVE' }).map((e) => e.record.seq)).toEqual([1]);
    expect(searchLog(log, { kitId: 'haldi' }).map((e) => e.record.seq)).toEqual([2]);
    expect(searchLog(log, { verdict: 'NEGATIVE', kitId: 'marquis-opiates' }).map((e) => e.record.seq)).toEqual([3, 0]);
  });
  it('filters by local date, inclusive, and ignores malformed dates', () => {
    expect(searchLog(log, { from: '2026-09-21', to: '2026-09-22' }).map((e) => e.record.seq)).toEqual([2, 1]);
    expect(searchLog(log, { from: '2026-09-23' }).map((e) => e.record.seq)).toEqual([3]);
    expect(searchLog(log, { to: '2026-09-20' }).map((e) => e.record.seq)).toEqual([0]);
    expect(searchLog(log, { from: '28/09/2026' })).toHaveLength(4);
  });
  it('combines everything, and is deterministic', () => {
    const q = { text: 'fir', verdict: 'NEGATIVE' as const, from: '2026-09-22' };
    expect(searchLog(log, q).map((e) => e.record.seq)).toEqual([3]);
    expect(searchLog(log, q)).toEqual(searchLog([...log].reverse(), q));
  });
  it('lists the kits present', () => {
    expect(kitsInLog(log)).toEqual([
      { id: 'haldi', name: 'Other kit' },
      { id: 'marquis-opiates', name: 'Marquis reagent — opiate screen' },
    ]);
  });
});
