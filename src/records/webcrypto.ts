// The small part of WebCrypto the records code uses, typed without the DOM
// library so this folder stays pure (tsconfig.pure.json). The same global
// `crypto.subtle` exists in browsers (secure contexts, workers included) and
// in Node, so the app and the Node tests and scripts run identical code.
//
// Algorithms: ECDSA on P-256 with SHA-256. WebCrypto's signature format is the
// raw 64-byte r || s concatenation (IEEE P1363), not DER.

/** Structural stand-in for CryptoKey (a real CryptoKey satisfies it). */
export interface KeyHandle {
  readonly type: string;
  readonly extractable: boolean;
  readonly algorithm: unknown;
  readonly usages: readonly string[];
}

export interface JsonWebKeyLike {
  kty?: string;
  crv?: string;
  x?: string;
  y?: string;
  d?: string;
  ext?: boolean;
  key_ops?: string[];
  [k: string]: unknown;
}

interface Subtle {
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
  generateKey(algorithm: { name: string; namedCurve: string }, extractable: boolean, usages: string[]): Promise<{ publicKey: KeyHandle; privateKey: KeyHandle }>;
  sign(algorithm: { name: string; hash: string }, key: KeyHandle, data: Uint8Array): Promise<ArrayBuffer>;
  verify(algorithm: { name: string; hash: string }, key: KeyHandle, signature: Uint8Array, data: Uint8Array): Promise<boolean>;
  exportKey(format: 'spki' | 'pkcs8' | 'raw', key: KeyHandle): Promise<ArrayBuffer>;
  exportKey(format: 'jwk', key: KeyHandle): Promise<JsonWebKeyLike>;
  importKey(format: 'spki', data: Uint8Array, algorithm: { name: string; namedCurve: string }, extractable: boolean, usages: string[]): Promise<KeyHandle>;
  importKey(format: 'jwk', data: JsonWebKeyLike, algorithm: { name: string; namedCurve: string }, extractable: boolean, usages: string[]): Promise<KeyHandle>;
}

export function subtle(): Subtle {
  const c = (globalThis as unknown as { crypto?: { subtle?: Subtle } }).crypto;
  if (!c?.subtle) throw new Error('WebCrypto is not available (the app must be opened over HTTPS)');
  return c.subtle;
}

export const ECDSA_KEY = { name: 'ECDSA', namedCurve: 'P-256' } as const;
export const ECDSA_SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export async function sha256HexOf(bytes: Uint8Array): Promise<string> {
  return toHex(new Uint8Array(await subtle().digest('SHA-256', bytes)));
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function alphabet(url: boolean): string {
  return B64 + (url ? '-_' : '+/');
}

/** base64url without padding (RFC 4648 §5) when url is true; standard padded base64 otherwise. */
export function toBase64(bytes: Uint8Array, url = true): string {
  const a = alphabet(url);
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const left = bytes.length - i;
    s += a[(n >> 18) & 63] + a[(n >> 12) & 63] + (left > 1 ? a[(n >> 6) & 63] : url ? '' : '=') + (left > 2 ? a[n & 63] : url ? '' : '=');
  }
  return s;
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '');
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of clean) {
    let v = B64.indexOf(ch);
    if (v < 0) v = ch === '-' || ch === '+' ? 62 : ch === '_' || ch === '/' ? 63 : -1;
    if (v < 0) throw new Error(`Invalid base64 character "${ch}"`);
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}
