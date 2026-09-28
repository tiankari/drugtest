// The per-device signing key: ECDSA P-256, generated on first use with
// extractable = false, so the private key can sign but can never be read out
// (not by this app, not by an export). Only the public key is exported.
// Clearing the site's data deletes the key and the log together.

import { ECDSA_KEY, sha256HexOf, subtle, toBase64, fromBase64, type JsonWebKeyLike, type KeyHandle } from './webcrypto.ts';

export interface DeviceKey {
  id: 'device';
  privateKey: KeyHandle;
  publicKey: KeyHandle;
  publicJwk: JsonWebKeyLike;
  /** SubjectPublicKeyInfo DER, standard base64. */
  publicSpki: string;
  /** Hex SHA-256 of the SPKI bytes. */
  keyId: string;
  createdAt: string;
}

export async function generateDeviceKey(now: Date = new Date()): Promise<DeviceKey> {
  const s = subtle();
  const { publicKey, privateKey } = await s.generateKey(ECDSA_KEY, false, ['sign', 'verify']);
  if (privateKey.extractable) throw new Error('The private key came back extractable; refusing to use it');
  const spki = new Uint8Array(await s.exportKey('spki', publicKey));
  const jwk = await s.exportKey('jwk', publicKey);
  return {
    id: 'device',
    privateKey,
    publicKey,
    publicJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
    publicSpki: toBase64(spki, false),
    keyId: await sha256HexOf(spki),
    createdAt: now.toISOString(),
  };
}

/** Public key from exported SPKI (standard base64), for verifying a log elsewhere. */
export async function importPublicKey(spkiBase64: string): Promise<{ key: KeyHandle; keyId: string }> {
  const spki = fromBase64(spkiBase64);
  const key = await subtle().importKey('spki', spki, ECDSA_KEY, true, ['verify']);
  return { key, keyId: await sha256HexOf(spki) };
}
