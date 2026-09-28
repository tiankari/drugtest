// Kit profile loader and the classification rule. The Marquis checks read the
// committed profile; the decision-rule checks use TEST-ONLY profiles built
// here (never written to profiles/).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ciede2000 } from '../../src/pipeline/ciede2000.ts';
import type { Vec3 } from '../../src/pipeline/colour.ts';
import { classify, KitProfileError, parseKitProfile, type KitProfile } from '../../src/pipeline/kit.ts';

const marquis = parseKitProfile(JSON.parse(readFileSync('profiles/kit_marquis_opiates_v1.json', 'utf8')));

function target(id: string, lab: Vec3, radius: number) {
  return { id, label: id, notation: `N ${id}`, sourceName: id, sourceRow: id, lab, radius, radiusDerivation: { rule: 'test', chipTerm: 0, chips: [], correctionErrorTerm: 0 } };
}

function testProfile(over: Partial<KitProfile> = {}): KitProfile {
  const base: KitProfile = {
    ...structuredClone(marquis),
    id: 'test-kit',
    outcomes: [
      { verdict: 'POSITIVE', label: 'positive', targets: [target('p1', [40, 40, 0], 8), target('p2', [40, 0, -40], 8)] },
      { verdict: 'NEGATIVE', label: 'coloured negative', targets: [target('n1', [80, 0, 60], 8)] },
    ],
  };
  return { ...base, ...over };
}

describe('the Marquis profile (from NIJ Standard-0604.01)', () => {
  it('has the three opiate targets with published-reference-only status', () => {
    expect(marquis.outcomes).toHaveLength(1);
    expect(marquis.outcomes[0].targets.map((t) => [t.id, t.notation])).toEqual([
      ['heroin', '7.5RP 3/10'],
      ['morphine', '10P 3/6'],
      ['codeine', '7.5P 2/4'],
    ]);
    expect(marquis.validation).toBe('published-reference-only');
    expect(marquis.validationLine).toBe('Marquis opiate screen — colours from NIJ Standard-0604.01, not yet checked against a real reaction with this app');
    expect(marquis.noColourResult).toBe('NEGATIVE');
    expect(marquis.readingTime.finalColourMinutes).toEqual([1, 2]);
  });

  it('target CIELAB agrees with colour-science 0.4.7 (values from the session prompt) within 0.2 ΔE00', () => {
    const cs: Record<string, Vec3> = { heroin: [30.2, 48.1, -2.7], morphine: [30.3, 26.5, -14.6], codeine: [20.2, 16.2, -12.0] };
    for (const t of marquis.outcomes[0].targets) expect(ciede2000(t.lab, cs[t.id])).toBeLessThan(0.2);
  });

  it('flags the known non-target reactions inside a POSITIVE radius', () => {
    expect(marquis.knownNonTargetReactions.filter((n) => n.insidePositiveRadius).map((n) => n.analyte).sort()).toEqual(['Chlorpromazine HCl', 'Propoxyphene HCl']);
  });

  it('classifies its own target colours POSITIVE, naming the target', () => {
    for (const t of marquis.outcomes[0].targets) {
      const c = classify(marquis, { status: 'found', reason: '', correctedLab: t.lab });
      expect(c.verdict).toBe('POSITIVE');
      expect(c.nearest?.targetId).toBe(t.id);
    }
  });
});

describe('classification rule', () => {
  const p = testProfile();

  it('inside one radius -> that outcome, nearest target named', () => {
    const c = classify(p, { status: 'found', reason: '', correctedLab: [42, 38, 2] });
    expect(c.verdict).toBe('POSITIVE');
    expect(c.nearest?.targetId).toBe('p1');
    expect(c.reason).toMatch(/p1/);
    expect(classify(p, { status: 'found', reason: '', correctedLab: [80, 2, 58] }).verdict).toBe('NEGATIVE');
  });

  it('outside all radii -> INCONCLUSIVE with the profile reason', () => {
    const c = classify(p, { status: 'found', reason: '', correctedLab: [60, -40, 40] });
    expect(c.verdict).toBe('INCONCLUSIVE');
    expect(c.reason.startsWith(p.noMatchReason)).toBe(true);
    expect(c.distances.every((d) => !d.inside)).toBe(true);
  });

  it('inside two outcomes -> INCONCLUSIVE', () => {
    const q = testProfile({
      outcomes: [
        { verdict: 'POSITIVE', label: 'positive', targets: [target('p1', [50, 20, 20], 10)] },
        { verdict: 'NEGATIVE', label: 'negative', targets: [target('n1', [50, 24, 24], 10)] },
      ],
    });
    const c = classify(q, { status: 'found', reason: '', correctedLab: [50, 22, 22] });
    expect(c.verdict).toBe('INCONCLUSIVE');
    expect(c.reason).toMatch(/more than one outcome/);
  });

  it('two targets of the SAME outcome both inside -> that outcome (the nearer one named)', () => {
    const q = testProfile({ outcomes: [{ verdict: 'POSITIVE', label: 'positive', targets: [target('a', [50, 20, 20], 10), target('b', [50, 26, 26], 10)] }] });
    const c = classify(q, { status: 'found', reason: '', correctedLab: [50, 25, 25] });
    expect(c.verdict).toBe('POSITIVE');
    expect(c.nearest?.targetId).toBe('b');
  });

  it('no coloured region -> the profile noColourResult', () => {
    expect(classify(p, { status: 'none', reason: '' }).verdict).toBe('NEGATIVE');
    const r = classify(testProfile({ noColourResult: 'RETAKE' }), { status: 'none', reason: '' });
    expect(r.verdict).toBe('RETAKE');
    expect(r.classified).toBe(false);
  });

  it('a sample RETAKE is never classified', () => {
    const c = classify(p, { status: 'retake', reason: 'Glare on the test', correctedLab: [42, 38, 2] });
    expect(c).toMatchObject({ verdict: 'RETAKE', reason: 'Glare on the test', classified: false, distances: [] });
  });

  it('same input, same output', () => {
    const s = { status: 'found' as const, reason: '', correctedLab: [41.3, 12.7, -20.1] as Vec3 };
    expect(classify(p, s)).toEqual(classify(p, s));
    expect(classify(marquis, s)).toEqual(classify(structuredClone(marquis), s));
  });
});

describe('profile loader', () => {
  const good = JSON.parse(readFileSync('profiles/kit_marquis_opiates_v1.json', 'utf8')) as Record<string, unknown>;
  it('accepts the committed profile', () => expect(() => parseKitProfile(good)).not.toThrow());
  it('rejects an unknown schema', () => expect(() => parseKitProfile({ ...good, schema: 'fdtc.kit.v2' })).toThrow(KitProfileError));
  it.each(['id', 'name', 'version', 'validation', 'validationLine', 'outcomes', 'noColourResult', 'source', 'readingTime', 'provenance', 'knownNonTargetReactions', 'status', 'detects'])(
    'rejects a profile missing %s',
    (k) => {
      const bad = { ...good };
      delete bad[k];
      expect(() => parseKitProfile(bad)).toThrow(KitProfileError);
    },
  );
  it('rejects a target without a radius or lab, and bad enum values', () => {
    const t = structuredClone(good) as { outcomes: { targets: Record<string, unknown>[] }[] };
    delete t.outcomes[0].targets[0].radius;
    expect(() => parseKitProfile(t)).toThrow(/radius/);
    const u = structuredClone(good) as { outcomes: { targets: Record<string, unknown>[] }[] };
    u.outcomes[0].targets[1].lab = [1, 2];
    expect(() => parseKitProfile(u)).toThrow(/lab/);
    expect(() => parseKitProfile({ ...good, validation: 'validated' })).toThrow(/validation/);
    expect(() => parseKitProfile({ ...good, noColourResult: 'INCONCLUSIVE' })).toThrow(/noColourResult/);
  });
});
