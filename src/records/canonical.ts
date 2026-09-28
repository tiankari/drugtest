// Canonical JSON: the exact bytes a record's hash and signature cover.
//
//   - object keys sorted recursively (JavaScript's default string order,
//     i.e. by UTF-16 code units), at every depth;
//   - no whitespace;
//   - strings and numbers in JSON.stringify form;
//   - only plain objects, arrays, strings, finite numbers, booleans and null.
//
// Anything JSON.stringify would silently drop or change (undefined, NaN,
// Infinity, functions, symbols, Dates, Maps, typed arrays…) throws instead, so
// two parties can never disagree about what was signed.

export class CanonicalJsonError extends Error {
  override name = 'CanonicalJsonError';
}

function isPlainObject(v: object): boolean {
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

function encode(v: unknown, path: string): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'string':
      return JSON.stringify(v);
    case 'boolean':
      return v ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(v)) throw new CanonicalJsonError(`${path}: ${v} is not a finite number`);
      return JSON.stringify(v);
    case 'undefined':
      throw new CanonicalJsonError(`${path}: undefined is not allowed`);
    case 'function':
      throw new CanonicalJsonError(`${path}: a function is not allowed`);
    case 'object':
      break;
    default:
      throw new CanonicalJsonError(`${path}: a ${typeof v} is not allowed`);
  }
  if (Array.isArray(v)) return `[${v.map((x, i) => encode(x, `${path}[${i}]`)).join(',')}]`;
  if (!isPlainObject(v)) throw new CanonicalJsonError(`${path}: only plain objects are allowed (got ${Object.prototype.toString.call(v)})`);
  const keys = Object.keys(v).sort();
  const o = v as Record<string, unknown>;
  return `{${keys.map((k) => `${JSON.stringify(k)}:${encode(o[k], `${path}.${k}`)}`).join(',')}}`;
}

export function canonicalJson(value: unknown): string {
  return encode(value, '$');
}

/** UTF-8 bytes of a string (ES2022 has no TextEncoder; canonical JSON never contains lone surrogates). */
export function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

export function canonicalBytes(value: unknown): Uint8Array {
  return utf8(canonicalJson(value));
}
