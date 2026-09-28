// Independent verifier for an exported log.
//
//   node scripts/verify-log.ts <export.zip | unzipped folder> [--noted <hash>] [--reanalyse]
//
// Checks every record's hash, signature, chain link and photo hash with the
// same code the app uses, and prints PASS, or the exact record and reason for
// each failure (exit code 1). --noted compares with a latest-record hash noted
// elsewhere (catches deleted newest records). --reanalyse re-runs the full
// analysis on each photo with the profiles in profiles/ and reports whether
// each verdict matches, plus the largest numeric difference.

import { reanalyse, readExport, verifyExport } from './lib/verify-export.ts';

const args = process.argv.slice(2);
const path = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--noted');
const notedIdx = args.indexOf('--noted');
const noted = notedIdx >= 0 ? args[notedIdx + 1] : undefined;
if (!path) {
  console.error('usage: node scripts/verify-log.ts <export.zip | folder> [--noted <hash>] [--reanalyse]');
  process.exit(2);
}

const x = readExport(path);
const v = await verifyExport(x, { noted });
const r = v.report!;
console.log(`Log: ${path}`);
console.log(`Records: ${r.count}; public key ${v.keyId}; latest hash ${r.latestHash ?? '—'}`);
for (const m of v.messages) console.log(`FAIL  ${m}`);
for (const p of v.lineProblems) console.log(`FAIL  ${p.reason}`);
for (const c of r.entries) {
  if (c.problems.length) for (const p of c.problems) console.log(`FAIL  record ${c.seq} (${c.recordId}): ${p}`);
  for (const w of c.warnings) console.log(`WARN  record ${c.seq} (${c.recordId}): ${w}`);
}
if (v.noted) console.log(`${v.noted.found ? 'PASS' : 'FAIL'}  noted hash: ${v.noted.message}`);
else console.log('NOTE  deleting the newest records is only caught with --noted <latest hash noted elsewhere>');

if (args.includes('--reanalyse')) {
  console.log('\nRe-analysis with the profiles in profiles/:');
  const rs = await reanalyse(x, v.entries);
  for (const a of rs) console.log(`${a.match ? 'SAME' : 'DIFF'}  record ${a.seq}: recorded ${a.recorded}, now ${a.recomputed ?? '—'}${a.maxDiff !== null ? `, largest numeric difference ${a.maxDiff.toExponential(2)}` : ''} (${a.note})`);
  const worst = rs.filter((a) => a.maxDiff !== null).reduce((m, a) => Math.max(m, a.maxDiff!), 0);
  console.log(`Verdicts matching: ${rs.filter((a) => a.match).length}/${rs.length}; largest numeric difference ${worst.toExponential(2)}`);
}

console.log(v.ok ? `\nPASS  all ${r.count} records: hashes, signatures, chain links and photos` : `\nFAIL  ${r.failures + v.lineProblems.length + v.messages.length + (v.noted && !v.noted.found ? 1 : 0)} problem(s)`);
process.exit(v.ok ? 0 : 1);
