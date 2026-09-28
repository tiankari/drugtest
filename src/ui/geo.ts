// Browser geolocation for records. Started when the Test screen opens so a fix
// is usually ready by capture; never blocks anything. If it is denied, times
// out or is unsupported, the record says so in plain words.
//
// An offline phone cannot prove its own GPS was honest: this is what the
// browser reported, nothing more.

import type { RecordLocation } from '../records/record.ts';

export type GeoState =
  | { kind: 'idle' }
  | { kind: 'waiting' }
  | { kind: 'fix'; lat: number; lon: number; accuracyM: number; fixAt: string }
  | { kind: 'unavailable'; reason: string };

let state: GeoState = { kind: 'idle' };
let watchId: number | null = null;
const listeners = new Set<(s: GeoState) => void>();

function set(s: GeoState): void {
  state = s;
  for (const l of listeners) l(s);
}

function reasonOf(e: GeolocationPositionError): string {
  if (e.code === e.PERMISSION_DENIED) return 'location permission denied';
  if (e.code === e.POSITION_UNAVAILABLE) return 'position unavailable';
  if (e.code === e.TIMEOUT) return 'no location fix within 30 s';
  return e.message || 'location error';
}

export function startGeo(): void {
  if (watchId !== null) return;
  if (!('geolocation' in navigator)) return set({ kind: 'unavailable', reason: 'this browser has no geolocation' });
  if (state.kind !== 'fix') set({ kind: 'waiting' });
  watchId = navigator.geolocation.watchPosition(
    (p) => set({ kind: 'fix', lat: p.coords.latitude, lon: p.coords.longitude, accuracyM: p.coords.accuracy, fixAt: new Date(p.timestamp).toISOString() }),
    (e) => {
      // Keep an earlier fix if there is one; otherwise report why there is none.
      if (state.kind !== 'fix') set({ kind: 'unavailable', reason: reasonOf(e) });
    },
    { enableHighAccuracy: true, timeout: 30_000, maximumAge: 60_000 },
  );
}

export function stopGeo(): void {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

export function geoState(): GeoState {
  return state;
}

export function onGeo(l: (s: GeoState) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** What goes into the record, from the state at capture time. */
export function recordLocation(s: GeoState): RecordLocation {
  if (s.kind === 'fix') return { lat: s.lat, lon: s.lon, accuracyM: s.accuracyM, fixAt: s.fixAt, source: 'browser geolocation' };
  if (s.kind === 'unavailable') return { unavailable: s.reason };
  return { unavailable: s.kind === 'waiting' ? 'no location fix yet when the photo was taken' : 'location was not requested' };
}

export function geoText(s: GeoState): string {
  if (s.kind === 'fix') return `Location found (within ${Math.round(s.accuracyM)} m)`;
  if (s.kind === 'waiting') return 'Finding location…';
  if (s.kind === 'unavailable') return `Location off (${s.reason}); saved tests will say so`;
  return 'Location not started';
}

/** For "Will be saved with …". */
export function geoSaveText(s: GeoState): string {
  if (s.kind === 'fix') return `the location (within ${Math.round(s.accuracyM)} m)`;
  return 'no location (the record says why)';
}
