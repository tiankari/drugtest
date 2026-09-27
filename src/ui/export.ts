// Export all stored captures as one .zip laid out like data/real/ in the repo:
//   mat/registration/<copy>/, mat/lighting/, mat/should_fail/
// PNGs are stored uncompressed (already deflated). Streams chunks into Blob
// parts so a cheap phone does not need the whole archive in one buffer.

import { strToU8, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { phoneSlug, compactUtc, zipFolder } from '../io/dataset.ts';
import type { StoredCapture } from './store.ts';

export async function buildExportZip(captures: StoredCapture[]): Promise<{ blob: Blob; name: string }> {
  const parts: Blob[] = [];
  let failure: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) failure = err;
    else parts.push(new Blob([chunk as Uint8Array<ArrayBuffer>]));
  });

  const manifest: { exportedAt: string; app: string; files: { path: string; sha256: string; pixelSha256: string }[] } = {
    exportedAt: new Date().toISOString(),
    app: `${__APP_VERSION__} (${__GIT_COMMIT__})`,
    files: [],
  };

  for (const c of captures) {
    const sc = c.sidecar;
    const folder = sc.dataCollection ? zipFolder(sc.dataCollection.tag, sc.dataCollection.copy) : 'captures';
    const png = new Uint8Array(await c.png.arrayBuffer());
    const f = new ZipPassThrough(`${folder}/${c.id}.png`);
    zip.add(f);
    f.push(png, true);
    const j = new ZipDeflate(`${folder}/${c.id}.json`, { level: 6 });
    zip.add(j);
    j.push(strToU8(JSON.stringify(sc, null, 2) + '\n'), true);
    manifest.files.push({ path: `${folder}/${c.id}.png`, sha256: sc.sha256, pixelSha256: sc.pixelSha256 });
  }
  const m = new ZipDeflate('export_manifest.json', { level: 6 });
  zip.add(m);
  m.push(strToU8(JSON.stringify(manifest, null, 2) + '\n'), true);
  zip.end();
  if (failure) throw failure;

  const phones = [...new Set(captures.map((c) => c.sidecar.dataCollection?.phone).filter(Boolean))] as string[];
  const who = phones.length === 1 ? phoneSlug(phones[0]) : 'captures';
  return { blob: new Blob(parts, { type: 'application/zip' }), name: `fdtc_${who}_${compactUtc(new Date().toISOString())}.zip` };
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function canShareFiles(): boolean {
  try {
    const probe = new File([new Uint8Array(1)], 'probe.zip', { type: 'application/zip' });
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

export async function shareBlob(blob: Blob, name: string): Promise<void> {
  const file = new File([blob], name, { type: 'application/zip' });
  await navigator.share({ files: [file], title: name });
}
