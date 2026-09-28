// The append-only, hash-chained log: appending a signed record, and verifying
// a whole log (the app's "Verify whole log" and the Node verifier use the
// same function).
//
// Storage sits behind LogBackend so the same code runs on IndexedDB in the app
// and in memory in the Node tests. There is deliberately no edit and no delete.

import type { DeviceKey } from './keys.ts';
import { assertSaveable, GENESIS_HASH, recordHash, signatureValid, signRecord, type FieldRecord, type LogEntry } from './record.ts';
import { sha256HexOf, type KeyHandle } from './webcrypto.ts';

export interface LogBackend {
  /** The newest entry, or null for an empty log. */
  last(): Promise<LogEntry | null>;
  /** Store the entry and its photo together, atomically; must reject if the seq already exists. */
  append(entry: LogEntry, png: Uint8Array): Promise<void>;
}

/** Everything in a record except the chain fields, which appendRecord fills in. */
export type RecordDraft = Omit<FieldRecord, 'seq' | 'prevHash'>;

/**
 * Sign and append one record. Checks, before anything is stored, that the
 * record may be saved, that the photo matches image.sha256, that it is signed
 * by this device's key, and that the fresh signature verifies.
 */
export async function appendRecord(backend: LogBackend, key: DeviceKey, draft: RecordDraft, png: Uint8Array): Promise<LogEntry> {
  const prev = await backend.last();
  const record: FieldRecord = { ...draft, seq: prev ? prev.record.seq + 1 : 0, prevHash: prev ? prev.hash : GENESIS_HASH };
  assertSaveable(record);
  if (record.device.keyId !== key.keyId) throw new Error('Record refused: device.keyId is not this device key');
  const photoHash = await sha256HexOf(png);
  if (photoHash !== record.image.sha256) throw new Error('Record refused: the photo does not match image.sha256');
  const entry = await signRecord(record, key.privateKey);
  if (!(await signatureValid(entry, key.publicKey))) throw new Error('Signing failed: the new signature does not verify');
  await backend.append(entry, png);
  return entry;
}

export interface EntryCheck {
  seq: number;
  recordId: string;
  /** Stored hash equals the hash recomputed from the record. */
  hashOk: boolean;
  /** Signature verifies with the log's public key over the record's canonical bytes. */
  signatureOk: boolean;
  /** seq continues the sequence and prevHash equals the previous record's (recomputed) hash. */
  chainOk: boolean;
  /** Stored photo re-hashes to image.sha256; null when no photo was available to check. */
  photoOk: boolean | null;
  /** device.keyId names the key the log was verified with. */
  keyOk: boolean;
  problems: string[];
  /** Not failures: e.g. the device clock went backwards. */
  warnings: string[];
}

export interface LogReport {
  count: number;
  /** Every check on every entry passed (warnings allowed; photos not provided are not failures). */
  ok: boolean;
  entries: EntryCheck[];
  latestHash: string | null;
  failures: number;
  clockWarnings: number;
  photosChecked: number;
}

export interface VerifyOptions {
  publicKey: KeyHandle;
  keyId: string;
  /** Photo bytes for an entry, or null if unavailable. Called one entry at a time. */
  photo?: (e: LogEntry) => Promise<Uint8Array | null>;
}

export async function verifyLog(entries: readonly LogEntry[], opts: VerifyOptions): Promise<LogReport> {
  const out: EntryCheck[] = [];
  let prevHash = GENESIS_HASH;
  let prevTime: number | null = null;
  let photosChecked = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const r = e.record;
    const problems: string[] = [];
    const warnings: string[] = [];
    let recomputed: string | null = null;
    try {
      recomputed = await recordHash(r);
    } catch (err) {
      problems.push(`record cannot be canonicalised: ${err instanceof Error ? err.message : String(err)}`);
    }
    const hashOk = recomputed !== null && recomputed === e.hash;
    if (recomputed !== null && !hashOk) problems.push('stored hash does not match the record (the record was changed)');
    const signatureOk = await signatureValid(e, opts.publicKey);
    if (!signatureOk) problems.push('signature does not verify with this log’s public key');
    const seqOk = r?.seq === i;
    const linkOk = r?.prevHash === prevHash;
    if (!seqOk) problems.push(`seq is ${String(r?.seq)} where ${i} was expected (a record is missing, extra or out of order)`);
    if (!linkOk) problems.push(i === 0 ? 'the first record does not start the chain' : `prevHash does not match record ${i - 1} (a record was removed, inserted, reordered or changed)`);
    const keyOk = r?.device?.keyId === opts.keyId;
    if (!keyOk) problems.push('record names a different device key');
    let photoOk: boolean | null = null;
    if (opts.photo) {
      const png = await opts.photo(e);
      if (png) {
        photoOk = (await sha256HexOf(png)) === r?.image?.sha256;
        photosChecked++;
        if (!photoOk) problems.push('stored photo does not match image.sha256');
      } else problems.push('photo missing');
    }
    const t = Date.parse(r?.createdAt);
    if (prevTime !== null && Number.isFinite(t) && t < prevTime) warnings.push('created earlier than the previous record (device clock changed?)');
    if (Number.isFinite(t)) prevTime = t;
    out.push({ seq: i, recordId: String(r?.recordId), hashOk, signatureOk, chainOk: seqOk && linkOk, photoOk, keyOk, problems, warnings });
    // Link the next record to what this record really hashes to.
    prevHash = recomputed ?? e.hash;
  }
  const failures = out.filter((c) => c.problems.length > 0).length;
  return {
    count: entries.length,
    ok: failures === 0,
    entries: out,
    latestHash: entries.length ? entries[entries.length - 1].hash : null,
    failures,
    clockWarnings: out.filter((c) => c.warnings.length > 0).length,
    photosChecked,
  };
}

export interface NotedHashCheck {
  /** The noted hash is in this log. */
  found: boolean;
  /** Seq of the record it names (if found). */
  seq: number | null;
  /** Records added after the noted one. */
  newer: number;
  message: string;
}

/**
 * Compare the log against a latest-record hash noted elsewhere earlier (case
 * diary, a message). The chain alone cannot notice the newest records being
 * deleted; this can, as long as the noted hash is in the log. A prefix of at
 * least 12 hex digits is accepted (the short form the log screen shows).
 */
export function checkNotedHash(entries: readonly LogEntry[], noted: string): NotedHashCheck {
  const n = noted.trim().toLowerCase();
  if (!/^[0-9a-f]{12,64}$/.test(n)) return { found: false, seq: null, newer: 0, message: 'Enter at least 12 hex digits of the noted hash' };
  const hits = entries.filter((e) => e.hash.startsWith(n));
  if (hits.length > 1) return { found: false, seq: null, newer: 0, message: 'That prefix matches more than one record; enter more digits' };
  if (hits.length === 0) return { found: false, seq: null, newer: 0, message: 'The noted hash is not in this log: records after it were deleted, or the note is wrong' };
  const seq = hits[0].record.seq;
  const newer = entries.length - 1 - entries.indexOf(hits[0]);
  return { found: true, seq, newer, message: newer === 0 ? 'The noted hash is the latest record' : `The noted hash is record ${seq}; ${newer} newer record(s) follow it` };
}
