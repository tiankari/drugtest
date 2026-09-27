// SHA-256 via WebCrypto. The same global exists in browsers (secure
// contexts, including workers) and in Node >= 19, so app and scripts share it.

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const view = new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', view);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
