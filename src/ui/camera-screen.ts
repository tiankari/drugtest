// Camera screen: live preview with plain-words guidance, the framing outline,
// and capture. Outside data collection mode, capture is enabled only when
// every live check passes. In data collection mode capture always fires (so
// deliberately bad photos can be collected) and no result is ever shown.

import { captureBaseName, COPIES, DATA_TAGS, phoneSlug, SIDECAR_SCHEMA, TAG_INFO, type CaptureSidecar, type DataTag } from '../io/dataset.ts';
import { THRESHOLDS, PARAMS } from '../pipeline/config.ts';
import { checkScaleFactor, framingOutline, type FrameCheckReport } from '../pipeline/quality.ts';
import { Camera, CameraError, REQUESTED_CONSTRAINTS } from './camera.ts';
import { FRAME_SOURCE, grabFrame, makeThumb, processFrame, type EncodedCapture } from './capture.ts';
import { errorText, h, toast } from './dom.ts';
import { loadSettings, onSettings, updateSettings } from './settings.ts';
import { listCaptures, putCapture, requestPersistence } from './store.ts';
import type { PreviewRequest, PreviewResponse } from './workers/preview.worker.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Last normal-mode capture, handed to the review screen. */
export let lastNormalCapture: { sidecar: CaptureSidecar; png: Uint8Array } | null = null;

export function cameraScreen(root: HTMLElement, go: (route: string) => void): () => void {
  let settings = loadSettings();
  const video = h('video', { playsinline: true, muted: true, autoplay: true, 'aria-label': 'Camera preview' });
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'overlay');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const outline = document.createElementNS(SVG_NS, 'rect');
  outline.setAttribute('class', 'outline');
  svg.append(outline);

  const guidance = h('div', { class: 'guidance', role: 'status', 'aria-live': 'polite' }, 'Starting camera…');
  const metrics = h('div', { class: 'metrics' });
  const dcBanner = h('div', { class: 'dc-banner' }, 'DATA COLLECTION MODE — captures are saved for the test set; no result is ever shown');
  const flash = h('div', { class: 'flash' });
  const errorBox = h('div', { class: 'camera-error', hidden: true });
  const viewport = h('div', { class: 'viewport' }, video, svg, guidance, metrics, flash, errorBox);

  // Data collection controls
  const tagSelect = h('select', { 'aria-label': 'Photo tag' });
  for (const t of DATA_TAGS) tagSelect.append(h('option', { value: t }, t));
  const copyButtons = COPIES.map((c) => h('button', { class: 'seg', type: 'button', 'data-copy': c }, `Copy ${c}`));
  const phoneInput = h('input', { type: 'text', placeholder: 'Phone model, e.g. Redmi Note 12', 'aria-label': 'Phone model', autocomplete: 'off' });
  const phoneSave = h('button', { type: 'button', class: 'small' }, 'Save');
  const phoneRow = h('div', { class: 'phone-row' }, phoneInput, phoneSave);
  const phoneLabel = h('button', { type: 'button', class: 'link' });
  const tagHint = h('div', { class: 'hint' });
  const counts = h('div', { class: 'hint counts' });
  const dcControls = h(
    'div',
    { class: 'dc-controls' },
    h('div', { class: 'dc-row' }, tagSelect, h('div', { class: 'segmented' }, ...copyButtons)),
    phoneRow,
    h('div', { class: 'dc-row small-row' }, phoneLabel, counts),
    tagHint,
  );

  const shutter = h('button', { class: 'shutter', type: 'button', 'aria-label': 'Capture', disabled: true });
  const torchBtn = h('button', { class: 'torch', type: 'button', hidden: true, 'aria-pressed': 'false' }, 'Torch');
  const resInfo = h('div', { class: 'res-info' });
  const controls = h('div', { class: 'controls' }, dcControls, h('div', { class: 'shutter-row' }, torchBtn, shutter, resInfo));

  const section = h('section', { class: 'camera-screen' }, dcBanner, viewport, controls);
  root.append(section);

  const camera = new Camera(video);
  let report: FrameCheckReport | null = null;
  let capturing = false;
  let stopped = false;
  let previewBusy = false;
  let previewTimer: number | undefined;
  let tagCounts = new Map<string, number>();

  const previewWorker = new Worker(new URL('./workers/preview.worker.ts', import.meta.url), { type: 'module' });
  const pvCanvas = document.createElement('canvas');
  const pvCtx = pvCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });

  function renderSettings(): void {
    const dc = settings.dataCollection;
    section.classList.toggle('dc', dc);
    dcBanner.hidden = !dc;
    dcControls.hidden = !dc;
    tagSelect.value = settings.tag;
    copyButtons.forEach((b) => b.classList.toggle('active', b.dataset.copy === settings.copy));
    const needPhone = dc && !phoneSlug(settings.phoneModel);
    phoneRow.hidden = !needPhone;
    phoneLabel.hidden = needPhone;
    phoneLabel.textContent = `Phone: ${settings.phoneModel} (change)`;
    tagHint.textContent = TAG_INFO[settings.tag].hint;
    renderCounts();
    renderShutter();
  }

  function renderCounts(): void {
    const key = `${settings.tag}|${settings.tag === 'registration' ? settings.copy : ''}`;
    const n = tagCounts.get(key) ?? 0;
    counts.textContent = settings.tag === 'registration' ? `registration ${settings.copy} on this phone: ${n} (need 3)` : `${settings.tag} on this phone: ${n}`;
  }

  async function refreshCounts(): Promise<void> {
    try {
      const all = await listCaptures();
      tagCounts = new Map();
      for (const c of all) {
        const dcInfo = c.sidecar.dataCollection;
        if (!dcInfo) continue;
        const key = `${dcInfo.tag}|${dcInfo.tag === 'registration' ? dcInfo.copy : ''}`;
        tagCounts.set(key, (tagCounts.get(key) ?? 0) + 1);
      }
      renderCounts();
    } catch (e) {
      counts.textContent = `Could not read saved captures: ${errorText(e)}`;
    }
  }

  function renderShutter(): void {
    const dc = settings.dataCollection;
    const ready = camera.stream !== null && !capturing;
    const phoneOk = !!phoneSlug(settings.phoneModel);
    shutter.disabled = !ready || (dc ? !phoneOk : !report?.pass);
    shutter.classList.toggle('armed', !shutter.disabled);
  }

  function renderReport(): void {
    if (!report) return;
    const dc = settings.dataCollection;
    guidance.textContent = report.pass ? (dc ? 'Checks pass' : 'Ready — tap to capture') : dc ? `${report.guidance} (capture still allowed)` : report.guidance;
    guidance.classList.toggle('ok', report.pass);
    guidance.classList.toggle('bad', !report.pass);
    outline.classList.toggle('ok', report.pass);
    const s = report.stats;
    metrics.hidden = !dc;
    metrics.textContent = `sharp ${s.laplacianVariance.toFixed(0)}/${THRESHOLDS.blurMinLaplacianVariance.value} · blown ${(s.highlightClipFraction * 100).toFixed(1)}% · crushed ${(s.shadowClipFraction * 100).toFixed(1)}% · median ${s.medianLuma}`;
    renderShutter();
  }

  function layoutOverlay(): void {
    const w = video.videoWidth;
    const hgt = video.videoHeight;
    if (!w || !hgt) return;
    svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
    const r = framingOutline(w, hgt);
    outline.setAttribute('x', String(r.x));
    outline.setAttribute('y', String(r.y));
    outline.setAttribute('width', String(r.w));
    outline.setAttribute('height', String(r.h));
    outline.setAttribute('stroke-width', String(Math.max(w, hgt) / 250));
    outline.setAttribute('rx', String(Math.max(w, hgt) / 200));
    const long = Math.max(w, hgt);
    const short = Math.min(w, hgt);
    const low = long < 1280;
    resInfo.textContent = `${w}×${hgt}${low ? ' (low)' : ''}`;
    resInfo.title = `Requested ${PARAMS.requestWidth}×${PARAMS.requestHeight}; phone delivers ${w}×${hgt}`;
    resInfo.classList.toggle('warn', low || short < 720);
  }

  function schedulePreview(): void {
    if (stopped) return;
    previewTimer = window.setTimeout(runPreview, 120);
  }

  function runPreview(): void {
    if (stopped) return;
    if (previewBusy || !pvCtx || video.readyState < 2 || !video.videoWidth) return schedulePreview();
    // Same integer factor the capture-time check uses, so both see a similar
    // scale. The browser's filter is not the pipeline's box filter, so the
    // preview only guides; the full-resolution check at capture is recorded.
    const k = checkScaleFactor(video.videoWidth, video.videoHeight);
    const pw = Math.max(1, Math.floor(video.videoWidth / k));
    const ph = Math.max(1, Math.floor(video.videoHeight / k));
    if (pvCanvas.width !== pw || pvCanvas.height !== ph) {
      pvCanvas.width = pw;
      pvCanvas.height = ph;
    }
    pvCtx.imageSmoothingEnabled = true;
    pvCtx.imageSmoothingQuality = 'high';
    pvCtx.drawImage(video, 0, 0, pw, ph);
    const img = pvCtx.getImageData(0, 0, pw, ph);
    previewBusy = true;
    const req: PreviewRequest = { width: pw, height: ph, buffer: img.data.buffer as ArrayBuffer };
    previewWorker.postMessage(req, [req.buffer]);
  }

  previewWorker.onmessage = (e: MessageEvent<PreviewResponse>) => {
    previewBusy = false;
    if (e.data.ok) {
      report = e.data.report;
      renderReport();
    } else {
      guidance.textContent = `Preview check failed: ${e.data.error}`;
      guidance.classList.add('bad');
    }
    schedulePreview();
  };
  previewWorker.onerror = (e) => {
    guidance.textContent = `Preview worker error: ${e.message}`;
    guidance.classList.add('bad');
  };

  async function startCamera(): Promise<void> {
    errorBox.hidden = true;
    guidance.textContent = 'Starting camera…';
    try {
      await camera.start();
      if (stopped) return camera.stop();
      layoutOverlay();
      torchBtn.hidden = !camera.hasTorch();
      camera.track?.addEventListener('ended', () => showError(new CameraError('The camera stream ended', 'The phone stopped the camera (app switched or locked).')));
      guidance.textContent = 'Checking…';
      renderShutter();
      schedulePreview();
    } catch (e) {
      showError(e);
    }
  }

  function showError(e: unknown): void {
    const hint = e instanceof CameraError ? e.hint : 'Unexpected error.';
    errorBox.hidden = false;
    errorBox.replaceChildren(
      h('strong', {}, hint),
      h('code', {}, e instanceof CameraError ? e.message : errorText(e)),
      h('button', { type: 'button', onclick: () => { camera.stop(); void startCamera(); } }, 'Retry camera'),
    );
    guidance.textContent = 'Camera unavailable';
    guidance.classList.add('bad');
    renderShutter();
  }

  function buildSidecar(iso: string, id: string, enc: EncodedCapture, width: number, height: number): CaptureSidecar {
    const dcOn = settings.dataCollection;
    return {
      schema: SIDECAR_SCHEMA,
      file: `${id}.png`,
      sha256: enc.sha256,
      pixelSha256: enc.pixelSha256,
      capturedAt: iso,
      timezoneOffsetMinutes: -new Date(iso).getTimezoneOffset(),
      app: { version: __APP_VERSION__, commit: __GIT_COMMIT__, buildTime: __BUILD_TIME__ },
      mode: dcOn ? 'data-collection' : 'normal',
      dataCollection: dcOn ? { tag: settings.tag, phone: settings.phoneModel.trim(), copy: settings.copy } : null,
      image: { width, height, pixelFormat: 'RGBA8', source: FRAME_SOURCE, png: enc.info },
      camera: {
        label: camera.label(),
        requested: JSON.parse(JSON.stringify(REQUESTED_CONSTRAINTS)),
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        settings: camera.settings(),
        capabilities: camera.capabilities(),
        torchOn: camera.torchOn,
      },
      checks: {
        pass: enc.report.pass,
        guidance: enc.report.guidance,
        results: enc.report.checks,
        stats: enc.report.stats,
        thresholds: Object.fromEntries(Object.entries(THRESHOLDS).map(([k, v]) => [k, { value: v.value, status: v.status }])),
      },
      device: {
        userAgent: navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio,
        screen: { width: screen.width, height: screen.height },
        orientation: screen.orientation?.type ?? null,
      },
      timingsMs: enc.timingsMs,
    };
  }

  async function capture(): Promise<void> {
    if (capturing) return;
    capturing = true;
    renderShutter();
    guidance.textContent = 'Saving…';
    try {
      const iso = new Date().toISOString();
      const { frame, canvas } = grabFrame(video);
      flash.classList.remove('go');
      void flash.offsetWidth;
      flash.classList.add('go');
      const thumb = await makeThumb(canvas);
      const { width, height } = frame;
      const enc = await processFrame(frame);
      if (settings.dataCollection) {
        const tag: DataTag = settings.tag;
        const id = captureBaseName(tag, settings.phoneModel, settings.copy, iso);
        const sidecar = buildSidecar(iso, id, enc, width, height);
        await putCapture({ id, createdAt: iso, png: new Blob([enc.png as Uint8Array<ArrayBuffer>], { type: 'image/png' }), thumb, sidecar });
        void requestPersistence();
        await refreshCounts();
        toast(`Saved ${id}.png${enc.report.pass ? '' : ` — checks failed: ${enc.report.checks.filter((c) => !c.pass).map((c) => c.message).join(', ')}`}`);
      } else {
        const id = `capture_${iso.replace(/[-:.]/g, '')}`;
        lastNormalCapture = { sidecar: buildSidecar(iso, id, enc, width, height), png: enc.png };
        go('#/review');
      }
    } catch (e) {
      toast(`Capture failed: ${errorText(e)}`, 'error', 8000);
    } finally {
      capturing = false;
      if (report) renderReport();
      renderShutter();
    }
  }

  // Events
  shutter.addEventListener('click', () => void capture());
  torchBtn.addEventListener('click', async () => {
    try {
      await camera.setTorch(!camera.torchOn);
      torchBtn.setAttribute('aria-pressed', String(camera.torchOn));
      torchBtn.classList.toggle('active', camera.torchOn);
    } catch (e) {
      toast(`Torch: ${errorText(e)}`, 'error');
    }
  });
  tagSelect.addEventListener('change', () => updateSettings({ tag: tagSelect.value as DataTag }));
  copyButtons.forEach((b) => b.addEventListener('click', () => updateSettings({ copy: b.dataset.copy as 'A' | 'B' })));
  phoneSave.addEventListener('click', () => {
    if (!phoneSlug(phoneInput.value)) return toast('Enter the phone model (letters or numbers)', 'error');
    updateSettings({ phoneModel: phoneInput.value.trim() });
  });
  phoneLabel.addEventListener('click', () => go('#/settings'));
  video.addEventListener('resize', layoutOverlay);
  video.addEventListener('loadedmetadata', layoutOverlay);
  const offSettings = onSettings((s) => {
    settings = s;
    renderSettings();
    renderReport();
  });
  const onVisible = () => {
    if (document.visibilityState === 'visible' && camera.track?.readyState === 'ended') {
      camera.stop();
      void startCamera();
    }
  };
  document.addEventListener('visibilitychange', onVisible);

  renderSettings();
  void refreshCounts();
  void startCamera();

  return () => {
    stopped = true;
    window.clearTimeout(previewTimer);
    previewWorker.terminate();
    camera.stop();
    offSettings();
    document.removeEventListener('visibilitychange', onVisible);
  };
}
