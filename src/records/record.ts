// The signed field record (schema fdtc.record.v1) and its log entry.
//
// Stored entry = { record, hash, signature }:
//   hash      = hex SHA-256 of canonicalJson(record) as UTF-8 bytes;
//   signature = ECDSA P-256 / SHA-256 over those same bytes, in WebCrypto's
//               raw r || s form (64 bytes), base64url without padding.
//
// What this proves, plainly: the signature shows the record was not changed
// after it was signed on this device. It does not prove who the officer is
// (the operator ID is typed in, not verified). The chain (seq + prevHash)
// stops records being removed from the middle, inserted or reordered;
// deleting the newest records is caught only against a latest hash noted
// somewhere else. An offline phone cannot prove its own clock or GPS were
// honest.

import { canonicalBytes } from './canonical.ts';
import { ECDSA_SIGN, fromBase64, sha256HexOf, subtle, toBase64, type KeyHandle } from './webcrypto.ts';

export const RECORD_SCHEMA = 'fdtc.record.v1';
export const RECORD_NOTICE = 'Presumptive field result. Not a laboratory confirmation.';
/** prevHash of the first record (seq 0). */
export const GENESIS_HASH = '0'.repeat(64);

export type Verdict = 'POSITIVE' | 'NEGATIVE' | 'INCONCLUSIVE';
export const VERDICTS: readonly Verdict[] = ['POSITIVE', 'NEGATIVE', 'INCONCLUSIVE'];

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export type RecordLocation =
  | { lat: number; lon: number; accuracyM: number; fixAt: string; source: 'browser geolocation' }
  | { unavailable: string };

export interface FieldRecord {
  schema: typeof RECORD_SCHEMA;
  /** 0, 1, 2… in this device's log. */
  seq: number;
  /** Hash of the previous entry; GENESIS_HASH for seq 0. */
  prevHash: string;
  recordId: string;
  /** Device clock at signing, ISO 8601 with the local offset. */
  createdAt: string;
  capturedAt: string;
  timezoneOffsetMinutes: number;
  /** Typed by the officer in Settings; not verified. */
  operator: { id: string };
  caseRef: string | null;
  locationNote: string | null;
  /** The officer ticked "The test is in the sample zone" (required for kits where no colour means NEGATIVE). */
  officerConfirmedTestInZone: boolean;
  location: RecordLocation;
  device: { keyId: string; userAgent: string };
  app: { version: string; commit: string };
  image: { sha256: string; pixelSha256: string; width: number; height: number };
  card: { version: number; copy: string; referenceSha256: string };
  analysis: { cardVerdict: 'PASS'; method: string; looMean: number; looP90: number; unevenLight: number; sample: { [k: string]: JsonValue } };
  kit: { id: string; version: number; name: string; profileSha256: string; validation: string };
  result: { verdict: Verdict; reason: string; nearest: { [k: string]: JsonValue } | null; distances: { [k: string]: JsonValue }[] };
  notice: typeof RECORD_NOTICE;
}

export interface LogEntry {
  record: FieldRecord;
  hash: string;
  signature: string;
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Refuse anything that must never become a record. A RETAKE (card or sample
 * stage) is never classified, so it can never be saved.
 */
export function assertSaveable(r: FieldRecord): void {
  const bad = (m: string) => {
    throw new Error(`Record refused: ${m}`);
  };
  if (r.schema !== RECORD_SCHEMA) bad(`schema must be ${RECORD_SCHEMA}`);
  if (!Number.isInteger(r.seq) || r.seq < 0) bad('seq must be a whole number from 0');
  if (!HEX64.test(r.prevHash)) bad('prevHash must be 64 hex digits');
  if (r.seq === 0 && r.prevHash !== GENESIS_HASH) bad('the first record must link to the all-zero hash');
  if (!r.operator?.id?.trim()) bad('operator ID is required');
  if (r.analysis?.cardVerdict !== 'PASS') bad('the card stage did not pass (RETAKE is never recorded)');
  if (!VERDICTS.includes(r.result?.verdict)) bad(`verdict must be one of ${VERDICTS.join(', ')} (got ${String(r.result?.verdict)})`);
  if (!HEX64.test(r.image?.sha256 ?? '') || !HEX64.test(r.image?.pixelSha256 ?? '')) bad('image hashes are missing');
  if (!HEX64.test(r.device?.keyId ?? '')) bad('device key ID is missing');
  if (r.notice !== RECORD_NOTICE) bad('the presumptive-result notice is missing');
  if (Number.isNaN(Date.parse(r.createdAt)) || Number.isNaN(Date.parse(r.capturedAt))) bad('timestamps must be ISO 8601');
}

export function recordHash(r: FieldRecord): Promise<string> {
  return sha256HexOf(canonicalBytes(r));
}

export async function signRecord(r: FieldRecord, privateKey: KeyHandle): Promise<LogEntry> {
  const bytes = canonicalBytes(r);
  const [hash, sig] = await Promise.all([sha256HexOf(bytes), subtle().sign(ECDSA_SIGN, privateKey, bytes)]);
  return { record: r, hash, signature: toBase64(new Uint8Array(sig)) };
}

export async function signatureValid(e: LogEntry, publicKey: KeyHandle): Promise<boolean> {
  let sig: Uint8Array;
  try {
    sig = fromBase64(e.signature);
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  try {
    return await subtle().verify(ECDSA_SIGN, publicKey, sig, canonicalBytes(e.record));
  } catch {
    // A record that cannot be canonicalised (e.g. edited to contain NaN) was not what was signed.
    return false;
  }
}

/** ISO 8601 with the local UTC offset, e.g. 2026-09-28T20:31:05.123+05:30. */
export function isoWithOffset(d: Date): string {
  const off = -d.getTimezoneOffset();
  const local = new Date(d.getTime() + off * 60000);
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${local.toISOString().slice(0, 23)}${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}
