// Export of the signed log (the only way records leave the phone, and the
// only copy that survives clearing the site's data):
//   records.jsonl        one stored entry { record, hash, signature } per line, oldest first
//   photos/<sha256>.png  each record's capture PNG, named by its SHA-256
//   public_key.json      the device public key (JWK and SPKI) and its key ID
//   export.json          when, which app, how many records, the latest hash
//   VERIFY.md            the format and how to check it

import { strToU8, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { compactUtc } from '../io/dataset.ts';
import type { LogEntry } from '../records/record.ts';
import { photoOf, publicKeyInfo } from './log-store.ts';

export const VERIFY_MD = `# Verifying this export

Field Test Companion (SIH26231). Presumptive field results; not laboratory confirmations.

## Files

- \`records.jsonl\`: one line per record, oldest first: \`{ "record": {...}, "hash": "...", "signature": "..." }\`.
- \`photos/<sha256>.png\`: the capture photo of each record, named by the SHA-256 of the file.
- \`public_key.json\`: the phone's public key (\`publicJwk\`, \`publicSpki\` = SubjectPublicKeyInfo DER in standard base64) and \`keyId\` = hex SHA-256 of the SPKI bytes.

## Checks, for every record

1. **Canonical JSON** of \`record\`: object keys sorted recursively (JavaScript string order), no whitespace, strings and numbers exactly as \`JSON.stringify\` writes them, UTF-8.
2. **Hash**: lowercase hex SHA-256 of those bytes must equal \`hash\`.
3. **Signature**: ECDSA, curve P-256, SHA-256, over the same bytes. \`signature\` is base64url (no padding) of the 64-byte raw \`r || s\` form WebCrypto produces (IEEE P1363, not DER). It must verify with the public key, and \`record.device.keyId\` must equal \`keyId\`.
4. **Chain**: \`record.seq\` is 0, 1, 2… in order; \`record.prevHash\` is the previous record's hash (64 zeros for seq 0).
5. **Photo**: SHA-256 of \`photos/<record.image.sha256>.png\` must equal \`record.image.sha256\`.

In the project repository, \`node scripts/verify-log.ts <this zip or its unzipped folder>\` runs all of these with the same code the app uses and prints PASS or the exact record and reason for each failure.

## What this proves, and what it does not

- The signature proves a record was not changed after it was signed on that phone. It does not prove who the officer was (the operator ID is typed in).
- The chain stops records being removed from the middle, inserted or reordered. Deleting the newest records is only caught against a latest-record hash noted elsewhere (case diary, a message): compare it with the last line of \`records.jsonl\`.
- An offline phone cannot prove its own clock or GPS were honest.
`;

interface ZipOut {
  add(path: string, data: Uint8Array, compress: boolean): void;
  finish(): Blob;
}

function zipWriter(): ZipOut {
  const parts: Blob[] = [];
  let failure: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) failure = err;
    else parts.push(new Blob([chunk as Uint8Array<ArrayBuffer>]));
  });
  return {
    add(path, data, compress) {
      const f = compress ? new ZipDeflate(path, { level: 6 }) : new ZipPassThrough(path);
      zip.add(f);
      f.push(data, true);
    },
    finish() {
      zip.end();
      if (failure) throw failure;
      return new Blob(parts, { type: 'application/zip' });
    },
  };
}

async function publicKeyFile(): Promise<Uint8Array> {
  const k = await publicKeyInfo();
  if (!k) throw new Error('This phone has no signing key yet (no record has been saved)');
  return strToU8(JSON.stringify({ algorithm: 'ECDSA P-256, SHA-256, raw r||s signatures', keyId: k.keyId, publicJwk: k.publicJwk, publicSpki: k.publicSpki, createdAt: k.createdAt }, null, 2) + '\n');
}

export async function buildLogZip(entries: LogEntry[]): Promise<{ blob: Blob; name: string }> {
  const z = zipWriter();
  z.add('records.jsonl', strToU8(entries.map((e) => JSON.stringify({ record: e.record, hash: e.hash, signature: e.signature })).join('\n') + (entries.length ? '\n' : '')), true);
  for (const e of entries) {
    const p = await photoOf(e.record.seq);
    if (!p) throw new Error(`The photo of record ${e.record.seq} is missing from this phone`);
    z.add(`photos/${e.record.image.sha256}.png`, new Uint8Array(await p.arrayBuffer()), false);
  }
  z.add('public_key.json', await publicKeyFile(), true);
  const now = new Date().toISOString();
  z.add('export.json', strToU8(JSON.stringify({ exportedAt: now, app: `${__APP_VERSION__} (${__GIT_COMMIT__})`, records: entries.length, latestHash: entries.length ? entries[entries.length - 1].hash : null }, null, 2) + '\n'), true);
  z.add('VERIFY.md', strToU8(VERIFY_MD), true);
  return { blob: z.finish(), name: `fdtc_log_${compactUtc(now)}.zip` };
}

export async function buildRecordZip(e: LogEntry, photo: Blob | null): Promise<{ blob: Blob; name: string }> {
  if (!photo) throw new Error(`The photo of record ${e.record.seq} is missing from this phone`);
  const z = zipWriter();
  z.add(`record_${e.record.seq}.json`, strToU8(JSON.stringify({ record: e.record, hash: e.hash, signature: e.signature }, null, 2) + '\n'), true);
  z.add(`photos/${e.record.image.sha256}.png`, new Uint8Array(await photo.arrayBuffer()), false);
  z.add('public_key.json', await publicKeyFile(), true);
  z.add('VERIFY.md', strToU8(VERIFY_MD), true);
  return { blob: z.finish(), name: `fdtc_record_${e.record.seq}_${e.record.recordId.slice(0, 8)}.zip` };
}
