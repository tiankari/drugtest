// Stored data-collection captures: progress against the shot list, export
// as one .zip (download or share), delete.

import { TAG_INFO } from '../io/dataset.ts';
import { clear, errorText, formatBytes, h, toast } from './dom.ts';
import { buildExportZip, canShareFiles, downloadBlob, shareBlob } from './export.ts';
import { deleteAllCaptures, deleteCapture, listCaptures, storageEstimate, type StoredCapture } from './store.ts';

export function capturesScreen(root: HTMLElement): () => void {
  const urls: string[] = [];
  const summary = h('div', { class: 'card' });
  const list = h('ul', { class: 'capture-list' });
  const exportBtn = h('button', { type: 'button', class: 'primary' }, 'Download all as .zip');
  const shareBtn = h('button', { type: 'button', hidden: !canShareFiles() }, 'Share .zip');
  const deleteAllBtn = h('button', { type: 'button', class: 'danger' }, 'Delete all');
  const status = h('p', { class: 'hint' });
  root.append(
    h(
      'section',
      { class: 'page' },
      h('h1', {}, 'Collected photos (for the team)'),
      h('p', { class: 'hint' }, 'Saved on this phone only. Export the .zip and unzip it into data/real/ in the repo; the folders already match.'),
      summary,
      h('div', { class: 'button-row' }, exportBtn, shareBtn, deleteAllBtn),
      status,
      list,
    ),
  );

  let captures: StoredCapture[] = [];

  async function refresh(): Promise<void> {
    try {
      captures = await listCaptures();
    } catch (e) {
      status.textContent = `Could not read captures: ${errorText(e)}`;
      return;
    }
    renderSummary();
    renderList();
    const est = await storageEstimate();
    const total = captures.reduce((n, c) => n + c.png.size, 0);
    status.textContent = `${captures.length} captures, ${formatBytes(total)}${est ? ` · storage used ${formatBytes(est.usage)} of ${formatBytes(est.quota)}` : ''}`;
    exportBtn.disabled = shareBtn.disabled = deleteAllBtn.disabled = captures.length === 0;
  }

  function renderSummary(): void {
    const count = (pred: (c: StoredCapture) => boolean) => captures.filter(pred).length;
    const dc = (c: StoredCapture) => c.sidecar.dataCollection;
    const phones = [...new Set(captures.map((c) => dc(c)?.phone).filter(Boolean))];
    const lightingPhones = [...new Set(captures.filter((c) => dc(c) && TAG_INFO[dc(c)!.tag].folder === 'lighting').map((c) => dc(c)!.phone))];
    const rows: [string, string][] = [
      ['Card set-up photos, card A', `${count((c) => dc(c)?.tag === 'registration' && dc(c)?.copy === 'A')} of 3`],
      ['Card set-up photos, card B', `${count((c) => dc(c)?.tag === 'registration' && dc(c)?.copy === 'B')} of 3`],
      ['Lighting photos (test object)', `${count((c) => !!dc(c) && TAG_INFO[dc(c)!.tag].folder === 'lighting')} (need 15+, from 2+ phones; ${lightingPhones.length} so far)`],
      ['Photos the app must refuse', `${count((c) => !!dc(c) && TAG_INFO[dc(c)!.tag].folder === 'should_fail')} (about 6)`],
      ['Phones on this device', phones.join(', ') || '—'],
    ];
    clear(summary);
    summary.append(h('table', { class: 'kv' }, ...rows.map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, v)))));
  }

  function renderList(): void {
    urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    clear(list);
    for (const c of captures) {
      const sc = c.sidecar;
      const failed = sc.checks.results.filter((r) => !r.pass).map((r) => r.message);
      let img: HTMLElement = h('div', { class: 'thumb' });
      if (c.thumb) {
        const u = URL.createObjectURL(c.thumb);
        urls.push(u);
        img = h('img', { class: 'thumb', src: u, alt: '' });
      }
      const del = h('button', { type: 'button', class: 'small danger' }, 'Delete');
      del.addEventListener('click', async () => {
        if (!confirm(`Delete ${c.id}.png from this phone? This cannot be undone.`)) return;
        await deleteCapture(c.id);
        await refresh();
      });
      list.append(
        h(
          'li',
          {},
          img,
          h(
            'div',
            { class: 'meta' },
            h('div', { class: 'name' }, `${c.id}.png`),
            h('div', {}, `${sc.image.width}×${sc.image.height} · ${formatBytes(c.png.size)} · checks ${sc.checks.pass ? 'pass' : `fail (${failed.join(', ')})`}`),
            h('div', { class: 'hash' }, `sha256 ${sc.sha256.slice(0, 16)}…`),
          ),
          del,
        ),
      );
    }
  }

  async function withZip(action: (blob: Blob, name: string) => Promise<void> | void): Promise<void> {
    exportBtn.disabled = shareBtn.disabled = true;
    status.textContent = 'Building .zip…';
    try {
      const { blob, name } = await buildExportZip(captures);
      await action(blob, name);
      status.textContent = `${name} (${formatBytes(blob.size)}) ready.`;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') status.textContent = 'Share cancelled.';
      else {
        status.textContent = `Export failed: ${errorText(e)}`;
        toast(`Export failed: ${errorText(e)}`, 'error', 8000);
      }
    } finally {
      exportBtn.disabled = shareBtn.disabled = captures.length === 0;
    }
  }

  exportBtn.addEventListener('click', () => void withZip((b, n) => downloadBlob(b, n)));
  shareBtn.addEventListener('click', () => void withZip((b, n) => shareBlob(b, n)));
  deleteAllBtn.addEventListener('click', async () => {
    if (!confirm(`Delete all ${captures.length} captures from this phone? Export them first. This cannot be undone.`)) return;
    await deleteAllCaptures();
    await refresh();
  });

  void refresh();
  return () => urls.forEach((u) => URL.revokeObjectURL(u));
}
