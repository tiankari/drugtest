// From one SYNTHETIC capture to a signed record: analysis -> sample reading ->
// classification -> buildRecordDraft -> appendRecord -> verifyLog.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/io/hash.ts';
import { encodePng } from '../../src/io/png.ts';
import { analyseMat } from '../../src/pipeline/analyse.ts';
import type { Vec3 } from '../../src/pipeline/colour.ts';
import { classify, parseKitProfile } from '../../src/pipeline/kit.ts';
import { combineRegistration, REFERENCE_SCHEMA, type MatReference } from '../../src/pipeline/reference.ts';
import { readSampleZone } from '../../src/pipeline/samplezone.ts';
import { buildRecordDraft, type RecordInputs } from '../../src/records/build.ts';
import { generateDeviceKey } from '../../src/records/keys.ts';
import { appendRecord, verifyLog } from '../../src/records/log.ts';
import { MemoryLog } from '../../src/records/memory-backend.ts';
import { placement, renderPhoto } from '../helpers/synth-card.ts';

const kit = parseKitProfile(JSON.parse(readFileSync('profiles/kit_marquis_opiates_v1.json', 'utf8')));

describe('record from a synthetic capture', () => {
  it('builds a draft the log accepts; refuses a RETAKE and a missing in-zone tick', async () => {
    const perPhoto = [1, 2, 3].map((seed) => {
      const a = analyseMat(renderPhoto(placement(720, 960, 500, 0), { camera: { noise: 2, seed, exposure: 0.9 } }), { guidanceOnly: true });
      return Object.fromEntries(a.patches!.map((p) => [p.id, p.flat])) as Record<string, Vec3>;
    });
    const c = combineRegistration(perPhoto);
    const ref: MatReference = { schema: REFERENCE_SCHEMA, matVersion: 1, copy: 'A', createdAt: '', phones: [], note: 'synthetic', sources: [], patches: c.patches, maxSpreadDeltaE00: c.maxSpread, maxSpreadPatch: c.maxSpreadPatch, pipeline: { commit: 't' } };
    const img = renderPhoto(placement(720, 960, 500, 0), { camera: { noise: 2, seed: 9, exposure: 0.9 } });
    const analysis = analyseMat(img, { references: { A: ref } });
    expect(analysis.verdict).toBe('PASS');
    const sample = readSampleZone(img, analysis);
    const classification = classify(kit, sample);
    expect(classification.verdict).toBe('NEGATIVE'); // empty zone, Marquis: no colour developed
    const { png } = encodePng(img);
    const key = await generateDeviceKey();
    const inputs: RecordInputs = {
      recordId: '11111111-1111-4111-8111-111111111111',
      createdAt: '2026-09-28T21:00:00.000+05:30',
      capturedAt: '2026-09-28T20:59:50.000+05:30',
      timezoneOffsetMinutes: 330,
      operatorId: ' OFFICER-1 ',
      caseRef: '',
      locationNote: 'Gate 2',
      officerConfirmedTestInZone: true,
      location: { unavailable: 'location permission denied' },
      userAgent: 'node',
      app: { version: '0.1.0', commit: 'test' },
      image: { sha256: await sha256Hex(png), pixelSha256: await sha256Hex(img.data), width: img.width, height: img.height },
      source: 'camera',
      analysis,
      sample,
      classification,
      kit,
      kitSha256: 'a'.repeat(64),
      referenceSha256: 'b'.repeat(64),
    };
    const draft = buildRecordDraft(inputs);
    expect(draft.operator.id).toBe('OFFICER-1');
    expect(draft.caseRef).toBeNull();
    expect(draft.result.verdict).toBe('NEGATIVE');
    expect(draft.analysis.sample.status).toBe('none');
    expect(draft.image.source).toBe('camera');
    const log = new MemoryLog();
    const entry = await appendRecord(log, key, { ...draft, device: { ...draft.device, keyId: key.keyId } }, png);
    expect(entry.record.seq).toBe(0);
    const r = await verifyLog(log.entries, { publicKey: key.publicKey, keyId: key.keyId, photo: async () => png });
    expect(r.ok).toBe(true);

    expect(() => buildRecordDraft({ ...inputs, officerConfirmedTestInZone: false })).toThrow(/sample zone/);
    expect(() => buildRecordDraft({ ...inputs, classification: { ...classification, verdict: 'RETAKE', classified: false } })).toThrow(/RETAKE/);
    expect(() => buildRecordDraft({ ...inputs, analysis: { ...analysis, verdict: 'RETAKE' } })).toThrow(/card stage/);
    expect(() => buildRecordDraft({ ...inputs, operatorId: '  ' })).toThrow(/operator/);
    // A sample image: no in-zone tick (there is no officer test), and it is labelled in the sealed record.
    const s = buildRecordDraft({ ...inputs, source: 'sample-photo', officerConfirmedTestInZone: false });
    expect(s.image.source).toBe('sample-photo');
    expect(s.officerConfirmedTestInZone).toBe(false);
    expect(() => buildRecordDraft({ ...inputs, source: 'sample-drawn', officerConfirmedTestInZone: true })).toThrow(/sample image/);
    const e2 = await appendRecord(log, key, { ...s, device: { ...s.device, keyId: key.keyId } }, png);
    expect(e2.record.seq).toBe(1);
    const r2 = await verifyLog(log.entries, { publicKey: key.publicKey, keyId: key.keyId, photo: async () => png });
    expect(r2.ok).toBe(true);
  }, 60_000);
});
