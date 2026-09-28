import { describe, expect, it } from 'vitest';
import { canonicalBytes, canonicalJson, CanonicalJsonError, utf8 } from '../../src/records/canonical.ts';

describe('canonical JSON', () => {
  it('sorts keys recursively and drops whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: true, y: null }], c: 'x' } })).toBe('{"a":{"c":"x","d":[3,{"y":null,"z":true}]},"b":1}');
  });

  it('does not depend on key insertion order', () => {
    const a = { seq: 1, record: { operator: { id: 'X' }, kit: { id: 'k', version: 1 } }, list: [1, 2] };
    const b = { list: [1, 2], record: { kit: { version: 1, id: 'k' }, operator: { id: 'X' } }, seq: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('keeps array order (arrays are data, not sets)', () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });

  it('uses JSON.stringify number and string forms', () => {
    expect(canonicalJson({ n: 0.1 + 0.2, e: 1e21, neg: -0, s: 'é"\n' })).toBe(`{"e":1e+21,"n":0.30000000000000004,"neg":0,"s":${JSON.stringify('é"\n')}}`);
  });

  it('encodes UTF-8 exactly like TextEncoder', () => {
    const s = canonicalJson({ t: 'Zürich — 東京 😀', k: 'plain' });
    expect(Array.from(canonicalBytes({ t: 'Zürich — 東京 😀', k: 'plain' }))).toEqual(Array.from(new TextEncoder().encode(s)));
    expect(Array.from(utf8('€'))).toEqual([0xe2, 0x82, 0xac]);
  });

  it.each([
    ['undefined in an object', { a: undefined }],
    ['undefined in an array', [1, undefined]],
    ['NaN', { a: NaN }],
    ['Infinity', { a: Infinity }],
    ['-Infinity', [-Infinity]],
    ['a function', { f: () => 1 }],
    ['a symbol', { s: Symbol('x') }],
    ['a bigint', { b: 1n }],
    ['a Date', { d: new Date(0) }],
    ['a typed array', { u: new Uint8Array(2) }],
    ['a Map', { m: new Map() }],
  ])('throws on %s', (_label, v) => {
    expect(() => canonicalJson(v)).toThrow(CanonicalJsonError);
  });

  it('names the path of the offending value', () => {
    expect(() => canonicalJson({ result: { distances: [{ d: NaN }] } })).toThrow(/\$\.result\.distances\[0\]\.d/);
  });
});
