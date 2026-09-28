# Signed records and the hash-chained log

Code: `src/records/` (pure TypeScript, WebCrypto only; the same code runs in
the app and in Node), `src/ui/log-store.ts` (IndexedDB), `src/ui/db.ts`.
Tests: `tests/unit/records.test.ts`, `tests/unit/canonical.test.ts` (Node's
`crypto.subtle`), `tests/browser/log-store.browser.test.ts` (real Chromium,
IndexedDB).

## What it proves, in plain words

- **The signature** proves that a record was not changed after it was signed
  on this phone. It does **not** prove who the officer is: the operator ID is
  typed in Settings and is not checked against anything.
- **The chain** (each record carries the previous record's hash) means a
  record cannot be removed from the middle, inserted, or moved without the
  check failing. **Deleting the newest records is not caught by the chain on
  its own**: a shorter chain is still a valid chain. It is caught only if the
  latest record hash was noted somewhere else (case diary, a message to a
  supervisor). The log screen shows the latest hash for that reason.
- **Time and place** come from the phone's clock and the browser's
  geolocation. An offline phone cannot prove that its own clock or GPS were
  honest; the record states what the phone reported, and a record created
  earlier than the one before it is flagged as a warning.
- The record holds the SHA-256 of the capture PNG, so the stored or exported
  photo can be re-hashed and matched to it.

## Record (schema `fdtc.record.v1`)

One JSON object:

| Field | Meaning |
|---|---|
| `schema` | `"fdtc.record.v1"` |
| `seq` | 0, 1, 2… in this device's log |
| `prevHash` | `hash` of the previous entry; 64 zeros for seq 0 |
| `recordId` | random UUID |
| `createdAt` | device clock at signing, ISO 8601 with the local offset |
| `capturedAt`, `timezoneOffsetMinutes` | when the photo was taken |
| `operator.id` | typed by the officer in Settings (required, not verified) |
| `caseRef`, `locationNote` | optional free text, or `null` |
| `officerConfirmedTestInZone` | the officer ticked "The test is in the sample zone" |
| `location` | `{ lat, lon, accuracyM, fixAt, source: "browser geolocation" }` or `{ unavailable: "<reason>" }` |
| `device` | `keyId` (hex SHA-256 of the public key's SPKI), `userAgent` |
| `app` | version and commit of the build |
| `image` | `sha256` of the PNG file, `pixelSha256` of the RGBA pixels, width, height, and (since Session 3) `source`: `camera`, `sample-photo` or `sample-drawn`. Records saved before `source` existed have no such field; they are camera photos and still verify. |
| `card` | MAT version, copy letter, SHA-256 of the canonical JSON of the bundled reference |
| `analysis` | card verdict (always PASS), correction method, leave-one-out mean and 90th percentile, uneven-light figure, sample-zone summary |
| `kit` | profile id, version, name, SHA-256 of its canonical JSON, validation status |
| `result` | verdict (POSITIVE / NEGATIVE / INCONCLUSIVE), reason, nearest target, distances and radii used |
| `notice` | `"Presumptive field result. Not a laboratory confirmation."` |

A RETAKE (card or sample stage) is never classified and can never become a
record (`assertSaveable` refuses it). A record made from a bundled sample
image carries `image.source` = `sample-photo` / `sample-drawn`, has no
location ("sample image, not taken with this phone") and never the officer's
in-zone tick; the app shows it with a Sample badge.

## Stored entry, hash and signature

Stored entry = `{ record, hash, signature }`.

- **Canonical JSON** (`src/records/canonical.ts`): object keys sorted
  recursively (JavaScript string order), no whitespace, strings and numbers
  in `JSON.stringify` form. `undefined`, `NaN`, `Infinity`, functions,
  symbols, bigints and non-plain objects (Date, Map, typed arrays) throw, so
  nothing is silently dropped or changed. Encoded as UTF-8.
- `hash` = lowercase hex SHA-256 of those bytes.
- `signature` = ECDSA on curve P-256 with SHA-256 over **the same bytes**, in
  WebCrypto's raw form: the 32-byte `r` followed by the 32-byte `s` (IEEE
  P1363, 64 bytes, not DER), encoded as base64url without padding.

## The device key

Generated on first use with WebCrypto, `extractable = false`, and stored as a
`CryptoKey` in the app's IndexedDB database (`fdtc`, store `keys`). The
private key can sign but can never be read out, not even by the app or an
export. The public key is stored next to it as JWK and SPKI (standard
base64); `keyId` is the hex SHA-256 of the SPKI bytes. The app asks the
browser for persistent storage (`navigator.storage.persist()`).

**Clearing the site's data deletes the key and the log together.** Only an
exported log survives that.

## Storage

IndexedDB `fdtc` version 2 adds the stores `keys`, `records` (key =
`record.seq`) and `photos` (key = seq; the capture PNG) to Session 1's
`captures`, which is untouched by the upgrade. A record and its photo are
written in one transaction; `add` refuses an existing seq, and any failure
aborts both writes, so nothing is ever half-saved. The app has no edit and no
delete function for records.

## Verifying

`verifyLog` (`src/records/log.ts`) checks, for every entry:

1. the stored `hash` equals the hash recomputed from the record;
2. the signature verifies with the log's public key;
3. `seq` is continuous from 0 and `prevHash` equals the previous record's
   recomputed hash;
4. `device.keyId` names that public key;
5. the stored photo re-hashes to `image.sha256`.

A `createdAt` earlier than the previous record's is reported as a warning,
not a failure. `checkNotedHash` compares the log with a hash noted earlier
(at least 12 hex digits) and reports whether records after it were deleted.

## Checking an exported log independently

In the app: **Log → Verify whole log** (every hash, signature, chain link and
photo) and **Check** against a noted hash. Outside the app:

```
node scripts/verify-log.ts <export.zip | unzipped folder> [--noted <latest hash>] [--reanalyse]
```

It runs the same `verifyLog` the app uses and prints PASS, or the exact record
and reason for each failure (exit code 1). `--reanalyse` re-runs the whole
analysis on each photo with the profiles in `profiles/` and reports whether
each verdict matches and the largest numeric difference (browser vs Node:
1.7 × 10⁻¹³ in the end-to-end test). The export contains `VERIFY.md` with the
same explanation. The tamper demo is in `docs/demo.md`.
