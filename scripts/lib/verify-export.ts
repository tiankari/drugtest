// Node side of log verification: read an exported log (.zip or its unzipped
// folder) and check it with the SAME pure code the app uses
// (src/records/log.ts#verifyLog). Optionally re-run the full analysis on each
// photo with the bundled profiles and compare the verdicts.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { decodePng } from '../../src/io/png.ts';
import { analyseMat } from '../../src/pipeline/analyse.ts';
import { ciede2000 } from '../../src/pipeline/ciede2000.ts';
import type { Vec3 } from '../../src/pipeline/colour.ts';
import { classify, parseKitProfile, type KitProfile } from '../../src/pipeline/kit.ts';
import { readSampleZone } from '../../src/pipeline/samplezone.ts';
import { canonicalJson } from '../../src/records/canonical.ts';
import { importPublicKey } from '../../src/records/keys.ts';
import { checkNotedHash, verifyLog, type LogReport } from '../../src/records/log.ts';
import type { LogEntry } from '../../src/records/record.ts';
import { sha256HexOf } from '../../src/records/webcrypto.ts';
import { loadReferences } from './references.ts';

export interface ExportFiles {
  files: Map<string, Uint8Array>;
  source: string;
}

export function readExport(path: string): ExportFiles {
  if (!existsSync(path)) throw new Error(`${path} does not exist`);
  const files = new Map<string, Uint8Array>();
  if (statSync(path).isDirectory()) {
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else files.set(relative(path, p).replace(/\\/g, '/'), new Uint8Array(readFileSync(p)));
      }
    };
    walk(path);
  } else {
    for (const [name, data] of Object.entries(unzipSync(new Uint8Array(readFileSync(path))))) files.set(name, data);
  }
  return { files, source: path };
}

export interface LineProblem {
  line: number;
  reason: string;
}

export interface VerifyExportResult {
  ok: boolean;
  entries: LogEntry[];
  report: LogReport | null;
  lineProblems: LineProblem[];
  keyId: string | null;
  noted: ReturnType<typeof checkNotedHash> | null;
  messages: string[];
}

export async function verifyExport(x: ExportFiles, opts: { noted?: string } = {}): Promise<VerifyExportResult> {
  const messages: string[] = [];
  const lineProblems: LineProblem[] = [];
  const jsonl = x.files.get('records.jsonl');
  const pkFile = x.files.get('public_key.json');
  if (!jsonl) throw new Error('records.jsonl is missing: this is not a whole-log export');
  if (!pkFile) throw new Error('public_key.json is missing');
  const pk = JSON.parse(strFromU8(pkFile)) as { publicSpki: string; keyId: string };
  const { key, keyId } = await importPublicKey(pk.publicSpki);
  if (keyId !== pk.keyId) messages.push(`public_key.json names key ${pk.keyId} but its SPKI hashes to ${keyId}`);
  const entries: LogEntry[] = [];
  strFromU8(jsonl)
    .split('\n')
    .forEach((line, i) => {
      if (!line.trim()) return;
      try {
        const e = JSON.parse(line) as LogEntry;
        if (!e || typeof e !== 'object' || !e.record || typeof e.hash !== 'string' || typeof e.signature !== 'string') throw new Error('not a { record, hash, signature } entry');
        entries.push(e);
      } catch (err) {
        lineProblems.push({ line: i + 1, reason: `line ${i + 1} of records.jsonl is not a valid entry: ${err instanceof Error ? err.message : String(err)}` });
      }
    });
  const report = await verifyLog(entries, { publicKey: key, keyId, photo: async (e) => x.files.get(`photos/${e.record?.image?.sha256}.png`) ?? null });
  const noted = opts.noted ? checkNotedHash(entries, opts.noted) : null;
  const ok = report.ok && lineProblems.length === 0 && messages.length === 0 && (noted ? noted.found : true);
  return { ok, entries, report, lineProblems, keyId, noted, messages };
}

// ---------- stretch: re-run the analysis ----------

export interface Reanalysis {
  seq: number;
  recorded: string;
  recomputed: string | null;
  match: boolean;
  note: string;
  /** Largest absolute difference over the compared numbers (LOO mean, LOO p90, uneven light, corrected CIELAB). */
  maxDiff: number | null;
}

function loadKits(dir = 'profiles'): KitProfile[] {
  return readdirSync(dir)
    .filter((f) => /^kit_.*\.json$/.test(f))
    .map((f) => parseKitProfile(JSON.parse(readFileSync(join(dir, f), 'utf8'))));
}

/** Default: the profiles in profiles/ (what the app bundles). Tests may pass their own. */
export async function reanalyse(x: ExportFiles, entries: LogEntry[], given: { references?: ReturnType<typeof loadReferences>; kits?: KitProfile[] } = {}): Promise<Reanalysis[]> {
  const refs = given.references ?? loadReferences();
  const kits = given.kits ?? loadKits();
  const out: Reanalysis[] = [];
  for (const e of entries) {
    const r = e.record;
    const base = { seq: r.seq, recorded: r.result.verdict };
    const png = x.files.get(`photos/${r.image.sha256}.png`);
    const kit = kits.find((k) => k.id === r.kit.id && k.version === r.kit.version);
    if (!png) {
      out.push({ ...base, recomputed: null, match: false, note: 'photo missing', maxDiff: null });
      continue;
    }
    if (!kit) {
      out.push({ ...base, recomputed: null, match: false, note: `kit ${r.kit.id} v${r.kit.version} is not in profiles/ (cannot re-run)`, maxDiff: null });
      continue;
    }
    const kitSha = await sha256HexOf(new TextEncoder().encode(canonicalJson(kit)));
    const ref = refs[r.card.copy];
    if (!ref) {
      out.push({ ...base, recomputed: null, match: false, note: `card copy ${r.card.copy} is not registered in profiles/ (cannot re-run)`, maxDiff: null });
      continue;
    }
    const img = decodePng(png);
    const a = analyseMat(img, { references: refs });
    if (a.verdict !== 'PASS') {
      out.push({ ...base, recomputed: 'RETAKE', match: false, note: `card stage now says RETAKE: ${a.reason}`, maxDiff: null });
      continue;
    }
    const s = readSampleZone(img, a);
    const c = classify(kit, s);
    const diffs: number[] = [Math.abs(a.correction!.used.loo.mean - r.analysis.looMean), Math.abs(a.correction!.used.loo.p90 - r.analysis.looP90), Math.abs((a.unevenLight?.residual ?? NaN) - r.analysis.unevenLight)];
    const recLab = r.analysis.sample.correctedLab as number[] | null;
    let note = kitSha === r.kit.profileSha256 ? 'same kit profile' : 'kit profile differs from the one recorded (profileSha256)';
    if (recLab && s.correctedLab) {
      diffs.push(...s.correctedLab.map((v, i) => Math.abs(v - recLab[i])));
      note += `; corrected colour ΔE00 ${ciede2000(s.correctedLab, recLab as unknown as Vec3).toExponential(1)}`;
    }
    out.push({ ...base, recomputed: c.verdict, match: c.verdict === r.result.verdict, note, maxDiff: Math.max(...diffs) });
  }
  return out;
}
