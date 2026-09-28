// In-memory LogBackend with the same append rules as the IndexedDB one
// (rejects a seq that already exists). Used by the Node tests and the Node
// verifier; the app uses src/ui/log-store.ts.

import type { LogBackend } from './log.ts';
import type { LogEntry } from './record.ts';

export class MemoryLog implements LogBackend {
  readonly entries: LogEntry[] = [];
  readonly photos = new Map<number, Uint8Array>();

  async last(): Promise<LogEntry | null> {
    return this.entries.length ? this.entries[this.entries.length - 1] : null;
  }

  async append(entry: LogEntry, png: Uint8Array): Promise<void> {
    if (this.entries.some((e) => e.record.seq === entry.record.seq)) throw new Error(`seq ${entry.record.seq} already exists`);
    this.entries.push(entry);
    this.photos.set(entry.record.seq, png);
  }
}
