// The bundled sample images: integrity (pixel contract) and what the REAL
// pipeline says for each. The expected outcome is only a label in the app; if
// the pipeline ever says something else, this test reports it (nothing is
// tuned to make a sample pass).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadReferences } from '../../scripts/lib/references.ts';
import { sha256Hex } from '../../src/io/hash.ts';
import { decodePng } from '../../src/io/png.ts';
import { SAMPLE_SCHEMA, type SampleSidecar } from '../../src/io/samples.ts';
import { analyseMat } from '../../src/pipeline/analyse.ts';
import { classify } from '../../src/pipeline/kit.ts';
import { currentKit, currentKits } from '../../scripts/lib/kits.ts';
import { readSampleZone } from '../../src/pipeline/samplezone.ts';

const DIR = 'samples';
const sidecars = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as SampleSidecar);
const refs = loadReferences();

describe('bundled sample images', () => {
  it('are the five planned samples, two kinds, each labelled and read with a bundled kit', () => {
    expect(sidecars.map((s) => s.id).sort()).toEqual(['blurred', 'drawn-opiate', 'drawn-stimulant', 'empty-card', 'orange-cap']);
    const kitIds = currentKits().map((k) => k.id);
    for (const s of sidecars) expect(kitIds).toContain(s.kitId);
    expect(sidecars.find((s) => s.id === 'drawn-stimulant')?.kitId).toBe('mandelin-stimulants');
    expect(sidecars.filter((s) => s.id !== 'drawn-stimulant').every((s) => s.kitId === 'marquis-opiates')).toBe(true);
    for (const s of sidecars) {
      expect(s.schema).toBe(SAMPLE_SCHEMA);
      expect(['sample-photo', 'sample-drawn']).toContain(s.kind);
      if (s.kind === 'sample-photo') expect(s.derivedFrom.crop).not.toBeNull();
    }
    expect(sidecars.filter((s) => s.kind === 'sample-drawn').map((s) => s.id).sort()).toEqual(['drawn-opiate', 'drawn-stimulant']);
  });

  it.each(sidecars.map((s) => [s.id, s] as const))('%s: file and pixel hashes match, PNG has no colour profile', async (_id, s) => {
    const bytes = new Uint8Array(readFileSync(join(DIR, s.file)));
    expect(await sha256Hex(bytes)).toBe(s.sha256);
    const img = decodePng(bytes); // strict: refuses colour-profile chunks
    expect(await sha256Hex(img.data)).toBe(s.pixelSha256);
    expect([img.width, img.height]).toEqual([s.width, s.height]);
  });

  it.each(sidecars.map((s) => [s.id, s] as const))('%s: the real pipeline with its kit gives the expected outcome', (_id, s) => {
    const kit = currentKit(s.kitId);
    const img = decodePng(new Uint8Array(readFileSync(join(DIR, s.file))));
    const a = analyseMat(img, { references: refs });
    const verdict = a.verdict !== 'PASS' ? 'RETAKE' : classify(kit, readSampleZone(img, a)).verdict;
    expect(verdict, `${s.id}: ${a.verdict === 'PASS' ? '' : a.reason}`).toBe(s.expected);
    if (s.id === 'blurred') expect(a.reason).toBe('Hold steady');
  }, 60_000);
});
