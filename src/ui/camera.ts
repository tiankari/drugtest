// Rear camera via getUserMedia. We request 1920x1080 and record whatever the
// phone actually delivers. White balance, exposure and focus are never locked
// (many phones refuse); their modes are recorded in every sidecar instead.

import { PARAMS } from '../pipeline/config.ts';

// resizeMode 'none' (a preference, ignored where unsupported) asks for one of
// the camera's native modes. Without it, Chrome meets a landscape 1920x1080
// request from a portrait-native camera by cropping to a 1080x1080 square.
// (In the Media Capture spec and Chrome, but not yet in TypeScript's DOM types.)
type VideoConstraints = MediaTrackConstraints & { resizeMode?: ConstrainDOMString };

const VIDEO: VideoConstraints = {
  facingMode: { ideal: 'environment' },
  width: { ideal: PARAMS.requestWidth },
  height: { ideal: PARAMS.requestHeight },
  resizeMode: { ideal: 'none' },
};

export const REQUESTED_CONSTRAINTS: MediaStreamConstraints = { audio: false, video: VIDEO };

export class CameraError extends Error {
  readonly hint: string;
  constructor(message: string, hint: string) {
    super(message);
    this.name = 'CameraError';
    this.hint = hint;
  }
}

export class Camera {
  readonly video: HTMLVideoElement;
  stream: MediaStream | null = null;
  torchOn = false;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  get track(): MediaStreamTrack | null {
    return this.stream?.getVideoTracks()[0] ?? null;
  }

  async start(): Promise<void> {
    if (!window.isSecureContext) {
      throw new CameraError('This page is not a secure context', 'The camera only works over HTTPS (or on localhost).');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new CameraError('navigator.mediaDevices.getUserMedia is not available', 'This browser cannot open the camera. Use Chrome on Android or Safari on iPhone.');
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(REQUESTED_CONSTRAINTS);
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      const hint =
        name === 'NotAllowedError'
          ? 'Camera permission was refused. Allow camera access for this site in the browser settings, then reload.'
          : name === 'NotFoundError'
            ? 'No camera was found on this device.'
            : name === 'NotReadableError'
              ? 'The camera is in use by another app, or the phone blocked it. Close other camera apps and retry.'
              : name === 'OverconstrainedError'
                ? 'The camera cannot satisfy the requested settings.'
                : 'The camera could not be opened.';
      throw new CameraError(msg, hint);
    }
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
    await this.waitForFrame();
    // Best effort only: continuous autofocus if offered. Never lock anything.
    const caps = this.capabilities();
    const focusModes = caps?.focusMode;
    if (Array.isArray(focusModes) && focusModes.includes('continuous')) {
      try {
        await this.track?.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] });
      } catch {
        // Recorded as-is in settings; not required.
      }
    }
  }

  private waitForFrame(): Promise<void> {
    return new Promise((resolve, reject) => {
      const started = performance.now();
      const tick = () => {
        if (this.video.videoWidth > 0 && this.video.readyState >= 2) resolve();
        else if (performance.now() - started > 10_000) reject(new CameraError('No video frame after 10 s', 'The camera opened but sent no picture. Reload the page.'));
        else requestAnimationFrame(tick);
      };
      tick();
    });
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.torchOn = false;
    this.lock = null;
  }

  settings(): Record<string, unknown> {
    const s = this.track?.getSettings();
    return s ? JSON.parse(JSON.stringify(s)) : {};
  }

  capabilities(): Record<string, unknown> | null {
    const t = this.track as (MediaStreamTrack & { getCapabilities?: () => MediaTrackCapabilities }) | null;
    if (!t?.getCapabilities) return null;
    try {
      return JSON.parse(JSON.stringify(t.getCapabilities()));
    } catch {
      return null;
    }
  }

  hasTorch(): boolean {
    return this.capabilities()?.torch === true;
  }

  /** Which of exposure / white balance this camera lets us hold fixed. */
  lockSupport(): { exposure: boolean; whiteBalance: boolean } {
    const caps = this.capabilities();
    const has = (k: string) => Array.isArray(caps?.[k]) && (caps![k] as unknown[]).includes('manual');
    return { exposure: has('exposureMode'), whiteBalance: has('whiteBalanceMode') };
  }

  /** Current lock state; null when not locked. Recorded in every sidecar. */
  lock: { exposure: boolean; whiteBalance: boolean; error: string | null } | null = null;

  /**
   * Hold exposure and white balance where they are now (optional; the app
   * never depends on it). Each is requested separately so one refusal does not
   * block the other. Whether a phone keeps its current values when switched
   * to manual is up to the phone: watch the preview and the checks.
   */
  async lockExposureAndWhiteBalance(): Promise<void> {
    const want = this.lockSupport();
    const errors: string[] = [];
    const applied = { exposure: false, whiteBalance: false };
    for (const [key, mode] of [['exposure', 'exposureMode'], ['whiteBalance', 'whiteBalanceMode']] as const) {
      if (!want[key]) continue;
      try {
        await this.track?.applyConstraints({ advanced: [{ [mode]: 'manual' } as MediaTrackConstraintSet] });
        applied[key] = this.settings()[mode] === 'manual';
        if (!applied[key]) errors.push(`${mode} stayed ${String(this.settings()[mode])}`);
      } catch (e) {
        errors.push(`${mode}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    this.lock = { ...applied, error: errors.length ? errors.join('; ') : null };
  }

  async unlock(): Promise<void> {
    if (!this.lock) return;
    const want = this.lockSupport();
    const set: Record<string, string> = {};
    if (want.exposure) set.exposureMode = 'continuous';
    if (want.whiteBalance) set.whiteBalanceMode = 'continuous';
    try {
      await this.track?.applyConstraints({ advanced: [set as MediaTrackConstraintSet] });
    } finally {
      this.lock = null;
    }
  }

  async setTorch(on: boolean): Promise<void> {
    await this.track?.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    this.torchOn = on;
  }

  label(): string {
    return this.track?.label ?? '';
  }
}
