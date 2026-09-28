// Record fixtures for the Node tests. SYNTHETIC: field values are made up;
// only the chain, hashing and signing are under test.

import { sha256Hex } from '../../src/io/hash.ts';
import type { DeviceKey } from '../../src/records/keys.ts';
import type { RecordDraft } from '../../src/records/log.ts';
import { RECORD_NOTICE, RECORD_SCHEMA } from '../../src/records/record.ts';

/** A small fake "photo" (not a real PNG; only its bytes are hashed). */
export function fakePhoto(i: number): Uint8Array {
  return Uint8Array.from({ length: 64 }, (_, k) => (i * 31 + k * 7) & 0xff);
}

export async function draft(key: DeviceKey, i: number, png = fakePhoto(i)): Promise<RecordDraft> {
  const t = new Date(Date.UTC(2026, 8, 28, 10, i, 0));
  const sha = await sha256Hex(png);
  return {
    schema: RECORD_SCHEMA,
    recordId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    createdAt: t.toISOString(),
    capturedAt: t.toISOString(),
    timezoneOffsetMinutes: 330,
    operator: { id: `OFFICER-${i % 2}` },
    caseRef: i % 2 ? `CASE-${i}` : null,
    locationNote: null,
    officerConfirmedTestInZone: true,
    location: i % 3 ? { lat: 28.6 + i / 1000, lon: 77.2, accuracyM: 12, fixAt: t.toISOString(), source: 'browser geolocation' } : { unavailable: 'permission denied' },
    device: { keyId: key.keyId, userAgent: 'test' },
    app: { version: '0.0.0', commit: 'test' },
    image: { sha256: sha, pixelSha256: 'a'.repeat(64), width: 1080, height: 1920 },
    card: { version: 1, copy: 'A', referenceSha256: 'b'.repeat(64) },
    analysis: { cardVerdict: 'PASS', method: 'B', looMean: 3.7, looP90: 7.1, unevenLight: 1.09, sample: { found: false } },
    kit: { id: 'test-kit', version: 1, name: 'Test kit', profileSha256: 'c'.repeat(64), validation: 'published-reference-only' },
    result: { verdict: i % 2 ? 'INCONCLUSIVE' : 'NEGATIVE', reason: 'synthetic', nearest: null, distances: [] },
    notice: RECORD_NOTICE,
  };
}
