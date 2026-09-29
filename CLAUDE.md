# CLAUDE.md — Field drug-test companion (SIH26231)

## STATUS: Session 4 CLOSED (2026-09-29) — clearer Retakes, eight drugs in two kits

**Read `docs/session4_handoff.md` first** (the user's three questions and
the answers, evidence, known issues), then `docs/session3_handoff.md`
(evaluator experience), `docs/session2_handoff.md` (records, kit,
evidence) and `docs/session1_handoff.md` (card pipeline).

The user asked why objects on the card give "lighting" Retakes when the light
looks fine, whether the app should show the object's colour, and whether it
can read more than three drugs; decision: "do all three" of the proposals.
The colour pipeline, thresholds, radius rule, signing and verification are
unchanged; v1 of the Marquis profile is kept unchanged for records made with
it.

- **Retake advice** (`retakeAdvice` in `src/ui/plain.ts`): new message
  "Glare in the white square" (shine on the test is no longer called glare
  on the card); uneven light names the darkest white patch after the
  gradient is removed and says when it is beside the white square;
  correction failures name no place (the worst squares are the dark greys
  whatever the cause); a refused white-square reading shows the marked-up
  card, and its colour under Technical details as "refused, not a result".
- **Kits**: Marquis v2 (heroin, morphine, codeine, oxycodone, mescaline;
  default) and **Mandelin v1** (cocaine, amphetamine, methamphetamine; "no
  colour" = RETAKE, never NEGATIVE). "Kit used" picker on the camera screen;
  the app offers only the newest version of each kit; the verifier re-runs
  each record with the version it cites. Each sample names its kit (`kitId`
  in the sidecar); fifth sample "Methamphetamine-type colour"
  (computer-drawn, Mandelin).

| Session 4 step | Merge |
|---|---|
| 0 Baseline; tag `session3-good` = 421f5fd (roll back: `git checkout session3-good`) | — |
| 1 Retake advice, glare in the white square, marked card on refusals | b601ab5 |
| 2 Kit builder for any NIJ reagent block; Marquis v2 (5 drugs); newest version per kit | 952d11b |
| 3 Mandelin kit (NIJ A.4 rows in the excerpt), samples bound to kits, kit-used line | ecf8c4d |
| CLOSE (docs, this file) | see git log |

## Session 3 (CLOSED 2026-09-29): the app is understandable to an evaluator

`docs/session3_handoff.md` (what changed for evaluators, the screenshot
list, known issues).

Session 3 changed only the experience: the colour pipeline, thresholds, kit
profile, classification rule and signing/verification are exactly Session 2's.
The only record change is the optional `image.source` ("camera" |
"sample-photo" | "sample-drawn"; absent in older records = camera; older
records still verify).

What an evaluator with no card now gets: Welcome → How it works → **Try with
sample images** (labelled samples, each run through the real pipeline) →
save one → Log → **Check log** → **See tamper detection** (real verifier on an
in-memory copy; the real log still passes). Officer mode is the app; photo
collection for the team lives in Settings → Developer tools (off by default,
banner on every screen while on). Plain words on every main screen, checked
by a jargon scan in the e2e tests; every number is under a collapsed
Technical details / Advanced / Developer tools.

| Session 3 step | Merge |
|---|---|
| 0 Baseline; tag `session2-good` = ad78869 (roll back: `git checkout session2-good`) | — |
| 1 UX audit (`docs/ux_audit.md`, `docs/audit/before/`) | cd9d661 |
| 2 Two modes (Developer tools, banner, migration note) | f4dcaa9 |
| 3 Sample images (`samples/`, `image.source`, Sample badge/filter, laptop column) | bf2cbb4 |
| 4 Welcome and How it works | 52e19dc |
| 5 Readable log, tamper demonstration, evaluator e2e | b0d0ae6 |
| 6 Plain words + jargon scan | b47cf57 |
| 7 Evaluator check (`docs/audit/after/`, before/after audit, offline samples) | 3d209ba |
| CLOSE (docs, this file) | see git log |

**User decisions (2026-09-29):** after the audit STOP: "do whatever you
think is best that would make the evaluators pass the prototype and it
impress them"; the four sample images were looked at and approved for the
public repo ("Yes, commit all 4").

## Session 2 (CLOSED 2026-09-28): records, kit, evidence

`docs/session2_handoff.md`: what exists, real vs synthetic evidence,
decisions, known issues, numbers for the slides.

The deliverable now works end to end: capture on the reference colour card →
card checks and colour correction → sample-zone reading → POSITIVE /
NEGATIVE / INCONCLUSIVE against a versioned kit profile → ECDSA-signed,
hash-chained record → searchable log → export → independent verifier.

Session 2 shipped one kit, the **Marquis opiate screen** (heroin, morphine,
codeine); since Session 4 there are two (`docs/kit_profiles.md`): Marquis v2
(adds oxycodone, mescaline) and Mandelin v1 (cocaine, amphetamine,
methamphetamine). All colours from **NIJ Standard-0604.01** Table 1,
`validation: "published-reference-only"`, each shown everywhere with its
line *"… — colours from NIJ Standard-0604.01, not yet checked against a real
reaction with this app"*. **POSITIVE has only been tested on synthetic
images.** Never present a synthetic result as real; never use a stand-in
object to fake a POSITIVE.

### Session 2 steps (all merged to `main`)

| Step | Merge |
|---|---|
| 0 Baseline (`incoming/`, `tools/.venv/` ignored) | 12677e0 |
| 1 Signed records + hash-chained log | 715b5ce |
| 2 Sample zone reading | 538fcd6 |
| 3 Marquis kit profile + classification | 10a089b |
| 4 Test flow (capture → verdict → signed record) | 754fb2a |
| 5 Log screen (search, verify, export) — pushed | 4e15997 |
| 6 UI refresh (light theme, Google Sans) | e597a59 |
| 7 Independent verifier + demo guide | f79f5e0, dc1eef2 |
| CLOSE (docs, this file) | see git log |

**Decisions (user, 2026-09-28):** kit colours from NIJ (no haldi photos);
Marquis radius = largest ΔE00 to the hue ±2.5 and chroma ±2 Munsell chips +
median leave-one-out error of the 3 non-registration real photos that pass
the card stage (3.96) → heroin 7.91, morphine 8.23, codeine 9.81; opium
excluded (Dristan 2.5 ΔE00, sugar overlap). Session 1 decisions still stand
(flat-field, white-normalised registration v2, method B, prototype
registration limit 6, no retake before submission).

**Open for the user to review:** the font is Google Sans (2025 OFL release,
name table and OFL.txt say SIL OFL 1.1), not Google Sans Flex as planned.

### Personal project: identity and remote

This is a personal project. **Never use a work or organisational email,
account, registry or repo for it, and never write such an address into the
repo.** No AI co-author trailer in commit messages (user's choice).

- Commit identity (repo-local config only; global config is not touched):
  `tiankari <271698808+tiankari@users.noreply.github.com>`.
- Only remote: `origin = https://tiankari@github.com/tiankari/drugtest.git`,
  with `credential.useHttpPath true` locally so git asks for this account. No
  SSH, no gh CLI. If git ever offers a stored login for another account, stop
  and tell the user; do not use or delete it. Ask before pushing (a push
  redeploys the live app). Trunk-based: short `session-N/<step>` branches,
  tests green, merged with `--no-ff`.
- GitHub Pages: https://tiankari.github.io/drugtest/ (base path `/drugtest/`
  in `vite.config.ts`).
- **Real photos stay out of git** (`.gitignore`): they show the user's home and
  the repo is public. Only file names and numbers appear in the docs. The same
  holds for `incoming/` (fonts, downloaded PDFs, demo exports built from real
  photos).

## Purpose

Phone app for Narcotics Control Bureau field officers, used alongside existing
colour-change drug-test kits. The officer places the reacted test on the printed
**reference colour card** (always this term in UI and docs; "mat" is fine in
code and file names; short UI messages say "card") and photographs it through
the app. The app corrects the photo's colours using the card, reads the
reaction colour, classifies it POSITIVE / NEGATIVE / INCONCLUSIVE against a
versioned kit profile, and makes a signed, tamper-evident record (timestamp,
GPS, operator ID, SHA-256 of the image) in a searchable log. **Presumptive
field result only; never replaces lab confirmation.** Official text:
`docs/problem_statement.md` — check work against it.

## Architecture rules (decided — do not change)

- Everything runs in the browser: static PWA, TypeScript + Vite. No backend, no
  server calls, no API keys, no CDN requests (fonts are self-hosted). Fully
  offline after first load. Photos and records never leave the phone except by
  the user's own export.
- No ML anywhere in the decision path. Deterministic maths: same pixels and
  same profiles in, same verdict out.
- `src/pipeline/` and `src/records/` are pure TypeScript with no DOM and no
  Node dependencies. Enforced by `tsconfig.pure.json` (lib ES2022 only) in
  `npm run typecheck`. WebCrypto is reached through the typed wrapper
  `src/records/webcrypto.ts` (the same `crypto.subtle` in browsers and Node);
  IndexedDB lives only in `src/ui/db.ts` / `log-store.ts` / `store.ts`,
  behind the `LogBackend` interface (Node tests use `MemoryLog`).
- Marker detection and homography in pure TS (OpenCV.js not needed). Ask the
  user before ever switching.
- Anything uncertain returns RETAKE (card or sample stage) or INCONCLUSIVE
  (classification). Never a guess. A RETAKE can never become a record.
- **What "no demo mode" means:** every result shown is computed by the real
  pipeline from real pixels at that moment. Bundled sample images are allowed
  because they go through the same code; each one is labelled as a sample
  (real photo, or computer-drawn) on every screen and in its record. No result
  is ever hard-coded. No mock results, no fallback that hides a failure; show
  real errors on screen (the raw error may sit under "Technical details").
- Never type reference data or thresholds from memory: take them from a saved
  source (`docs/references/`), derive them from our photos, or mark them
  provisional with a reason in `src/pipeline/config.ts`.
- Never loosen a threshold to make more real photos pass. Report it as a finding.
- Report separately what was verified on real photos vs only on synthetic
  tests.
- Plain words on the main screens (no ΔE00, CIELAB, hash, SHA-256, ECDSA,
  signature, chain, Laplacian, luma, clip, flat-field, leave-one-out,
  homography, threshold, registration outside Technical details, Advanced and
  Developer tools); `tests/e2e/jargon.ts` holds the list the e2e scan uses.
  Plain wording lives in `src/ui/plain.ts`; the sealed record keeps the
  technical reason. Synthetic kit profiles and references are test-only: never in
  `profiles/`, never in the real build (the e2e writes them for a throwaway
  `dist-e2e/` build and deletes them).
- Keep dependencies few: no UI framework, no IndexedDB wrapper, no crypto
  library, no icon library, no PDF library.

## Pixel contract (full text: `docs/pixel_contract.md`)

Frames come from the live `getUserMedia` stream (never the phone's camera app),
drawn 1:1 to an sRGB canvas and read with `getImageData`. That RGBA buffer is
analysed, saved as a lossless PNG with **no colour-profile chunk** (only
IHDR/IDAT/IEND), and hashed (`sha256` of the file, `pixelSha256` of the pixels).
Node scripts read captures only via `scripts/lib/capture-files.ts` (same
decoder, strict, verifies hashes). Colour maths in float64; sRGB per
IEC 61966-2-1; D65 white for XYZ and CIELAB. Correction is **relative
calibration against our own registered print**, not absolute colour measurement.

## Pipeline (one capture)

In the capture worker (`src/ui/workers/capture.worker.ts`):

1. `analyseMat` (`src/pipeline/analyse.ts`), unchanged from Session 1: frame
   checks → card detection → ID strip → sharpness on the card → patch sampling
   → glare → flat-field (plane fitted to the six whites) + residual uneven-light
   check → registered reference → correction (method B) with leave-one-out
   CIEDE2000 gate. PASS or RETAKE with the first failing reason.
2. `readSampleZone` (`src/pipeline/samplezone.ts`), PASS only: zone pixels
   (3 mm inside the outline) flat-fielded with the same light field and
   normalised to the photo's paper white; coloured if ΔE76 from white >
   3 × the white patches' 95th-percentile noise (floor 3); 0.5 mm edge
   erosion; regions in mm²; → "no coloured region", RETAKE (too small / two
   areas / glare with holes filled / patchy), or a region whose 10%-trimmed
   median is corrected with the card's own model. Mask for display.

On the main thread: `classify(kit, sample)` (`src/pipeline/kit.ts`) → no
region = the profile's `noColourResult`; exactly one outcome with a target
within its radius = that outcome; none or several = INCONCLUSIVE. Then
`buildRecordDraft` (`src/records/build.ts`) → `saveRecord` (sign + append,
`src/ui/log-store.ts`).

## Records and log (full text: `docs/records.md`)

Entry = `{ record, hash, signature }`; `hash` = hex SHA-256 of the canonical
JSON (keys sorted recursively, no whitespace, `JSON.stringify` numbers,
UTF-8; throws on undefined/NaN/Infinity/functions/non-plain objects);
`signature` = ECDSA P-256/SHA-256 over the same bytes, raw r||s, base64url.
Device key generated with `extractable = false`, stored as a CryptoKey in
IndexedDB with its public JWK/SPKI; `keyId` = SHA-256 of the SPKI. The chain:
`seq` from 0 and `prevHash` (64 zeros first). Plain meanings (use them in UI
and docs): the signature proves the record was not changed after signing on
this phone, not who the officer is; the chain stops removal from the middle,
insertion and reordering, but deleting the newest records is only caught
against a latest hash noted elsewhere; an offline phone cannot prove its clock
or GPS were honest; clearing site data deletes key and log together.

## Module map

| Path | What |
|---|---|
| `src/pipeline/colour.ts`, `ciede2000.ts` | sRGB ↔ linear ↔ XYZ ↔ CIELAB (D65, W3C constants); CIEDE2000. |
| `src/pipeline/mat.ts` | MAT v1 geometry and design colours; ID-strip codec. |
| `src/pipeline/quality.ts`, `components.ts`, `detect.ts`, `homography.ts`, `linalg.ts` | Frame checks, connected components, card detection/verification, homography, small solvers. |
| `src/pipeline/sample.ts`, `rectify.ts`, `flatfield.ts`, `correct.ts`, `reference.ts`, `analyse.ts` | Patch sampling, display warp, flat-field, correction A/B + leave-one-out, registered references (v2), the card pipeline. |
| `src/pipeline/samplezone.ts` | Sample-zone reader (Session 2). |
| `src/pipeline/kit.ts` | Kit profile format `fdtc.kit.v1`, `parseKitProfile`, `classify`, `latestVersions`, `NO_COLOUR_RETAKE`. |
| `src/pipeline/config.ts` | **Every threshold and parameter**, each provisional/derived with a reason. |
| `src/records/canonical.ts`, `webcrypto.ts` | Canonical JSON + UTF-8; typed WebCrypto, hex, base64(url). |
| `src/records/record.ts`, `keys.ts`, `log.ts`, `memory-backend.ts` | Record schema `fdtc.record.v1`, sign/verify, device key, `appendRecord`, `verifyLog`, `checkNotedHash`, in-memory backend. |
| `src/records/build.ts`, `search.ts` | Record draft from a capture; pure log search/filters. |
| `src/io/png.ts`, `crc32.ts`, `hash.ts`, `dataset.ts` | Strict PNG codec, SHA-256, data-collection tags and sidecar schema. |
| `src/ui/main.ts` | Router (Test / Log / Settings; Captures only during photo collection; `#/welcome` on first launch, `#/about` = How it works, `#/samples`, `#/result`, `#/record/<seq>`), SVG nav, photo-collection banner, one-time migration note, service-worker registration. |
| `src/ui/welcome-screen.ts`, `about-screen.ts` | Welcome (first launch) and How it works (5 steps, kit, card, privacy, build). |
| `src/ui/samples.ts`, `samples-screen.ts`, `current.ts` | Bundled samples (`samples/*.png` + sidecars, schema `fdtc.sample.v1` in `src/io/samples.ts`), run through the same capture worker; the capture shown on the result screen (camera or sample). |
| `src/ui/plain.ts` | Every plain-word text: verdict sentences, Retake reasons (short, live) and `retakeAdvice` (what the app saw, where, what to try), check names, log summaries, code-compare messages, threshold names. |
| `src/records/tamper.ts` | In-memory changed copy of the log for "See tamper detection" (the real verifier runs on it). |
| `src/ui/test-screen.ts`, `camera-screen.ts`, `camera.ts`, `capture.ts`, `geo.ts` | Operator gate, camera + live card guidance + test bar (kit, operator, location), capture, geolocation. |
| `src/ui/result-screen.ts`, `verdict.ts` | Verdict, swatches, mask, tick, Save; Session 1 details under "Technical details"; verdict badge + icons. |
| `src/ui/record-screen.ts`, `log-screen.ts`, `log-export.ts`, `log-store.ts`, `db.ts` | Record detail (3 checks), log (search, filters, verify, latest hash), export zip + VERIFY.md, IndexedDB (v2). |
| `src/ui/kits.ts`, `references.ts` | Bundle `profiles/kit_*.json` (newest version of each id offered; `DEFAULT_KIT_ID` = Marquis first) and `profiles/mat_reference_*.json` at build time. |
| `src/ui/settings*.ts`, `captures-screen.ts`, `about-screen.ts`, `export.ts`, `store.ts`, `dom.ts`, `styles.css` | Settings (operator ID, data collection, export), data-collection captures, About, helpers, the theme (all colours are `:root` tokens; camera uses `--cam-*`). |
| `src/ui/workers/` | `preview.worker.ts` (live guidance), `capture.worker.ts` (full analysis, sample zone, PNG, hashes). |
| `src/sw/sw.js` + `build/sw-plugin.ts` | Hand-written service worker; precache list from `dist/` (includes `fonts/`). |
| `public/fonts/` | Google Sans Latin variable subset (45 KB), OFL.txt, README.txt (how it was made). |
| `profiles/` | `mat_reference_1_{A,B}.json`, `kit_marquis_opiates_v2.json`, `kit_mandelin_stimulants_v1.json` (offered), `kit_marquis_opiates_v1.json` (kept for records made with it). |
| `docs/references/` | Saved sources: W3C colour excerpt, NIJ 0604.01 excerpt (Table 1 A.5 and A.4 blocks, Table 3 rows, appendices), RIT Munsell `real.dat` + README, Bradford excerpt. |
| `scripts/` | `generate-mat.ts`, `register-mat.ts`, `validate-mat.ts`, `validate-sample.ts`, `build-kit-profile.ts`, `validate-kit.ts`, `verify-log.ts`, `make-demo-export.ts`, `make-samples.ts`; `lib/` (capture-files, references, kits, verify-export, fake-camera, pdf, card). |
| `tools/munsell_crosscheck.py` | colour-science cross-check (needs the local `tools/.venv`, not a dependency). |
| `tests/unit`, `tests/browser`, `tests/e2e`, `tests/helpers` | Node unit tests (251); real-Chromium tests (pixel contract, IndexedDB log); built-app e2e: data collection (35 checks), full test flow (52), **evaluator path** (113, phone + laptop, no card, five samples, both kits, jargon scan), offline; synthetic card renderer with sample marks and patch-colour override, record fixtures. |
| `samples/` | The 5 bundled sample images (3 real photos cropped to the card, reviewed by the user; 2 computer-drawn: Marquis heroin, Mandelin methamphetamine), each with the `kitId` it is read with. Built by `scripts/make-samples.ts [--only=<id>]` into `samples-review/` (git-ignored) first; the four older ones rebuild byte-identical. |
| `scripts/audit-walkthrough.ts` | UX walkthrough screenshots (`docs/audit/<phase>/`, computer-drawn cards only). |

## What is verified, and on what

### On real photos (19 captures, 2 phones; `docs/validation/`)

- Session 1 (`mat_v1.md`): pixel contract on every photo; detection correct on
  every photo with four corners; should-fail 5/5 RETAKE; accepted: Nothing
  Phone daylight/tube, 6 registration shots, the soft half-card shadow.
- Sample zone (`sample_zone_v1.md`): 6/6 empty registration zones → no
  coloured region; 3/3 accepted cap photos → region found (the cap overhangs
  the zone). Cap spread 3.3 ΔE00 before correction, 4.0 after.
- Kit (`kit_marquis_v1.md`): empty zones → NEGATIVE (6), cap → INCONCLUSIVE
  (3, 35-38 ΔE00 from heroin), card RETAKEs never classified (10). Marquis v2
  (`kit_marquis_v2.md`): the same, cap nearest mescaline 24-28 (radius 10.5).
  Mandelin v1 (`kit_mandelin_v1.md`): empty zones → RETAKE (6, as designed),
  cap → INCONCLUSIVE (3), card RETAKEs (10).
- Retake advice on the real photos: the OnePlus torch refusal is glare in the
  white square (the glossy cap); both warm-bulb refusals have the darkest
  white patch beside the white square (the cap's shadow).
- Verifier: a Node-built demo export of the 9 accepted real photos verifies;
  re-analysis gives the same 9 verdicts.
- No real drug reaction has been photographed. No Session 2 screen has run on
  a real phone.

### On synthetic data only (never evidence about phones)

- Session 1 items (CIEDE2000 vs Sharma 2005; detection; correction; full
  pipeline) as before.
- Records: chain, edits, deletions, insertions, reordering, foreign key,
  private-key export refused, last-record deletion caught only with a noted
  hash (Node and Chromium IndexedDB, incl. the v1 → v2 upgrade keeping
  captures).
- Sample reader: blob within 3 ΔE00 through cast + tone curve + perspective;
  each RETAKE reason.
- Kit: rendered published colours → targets POSITIVE, chlorpromazine and
  propoxyphene POSITIVE (known false positives), other non-targets and opium
  INCONCLUSIVE. Mandelin: all three targets POSITIVE; brompheniramine and
  methaqualone POSITIVE cocaine (known); **Mace POSITIVE methamphetamine**
  (read error on a clipped yellow-green); cocaine's colour is outside sRGB.
- Wrong kit selected (published colours): Marquis colours with the Mandelin
  kit all INCONCLUSIVE; Mandelin colours with the Marquis kit: salt and
  procaine POSITIVE mescaline.
- Built app, fake camera (`test:e2e:result`, 49 checks): the whole flow,
  export verified in Node, tamper and truncation caught, Chromium vs Node
  re-analysis difference 1.7 × 10⁻¹³. Offline with the font (Pixel 7
  emulation).

Not verified: real phones on the Session 2 flow, Safari/iOS, speed on a cheap
Android phone.

## Thresholds (`src/pipeline/config.ts`)

| Threshold | Value | Status |
|---|---|---|
| `blurMinLaplacianVariance` | 680 | **derived** (one blurred real photo) |
| `DEFAULT_CORRECTION_METHOD` | B | **derived**, weak evidence |
| `highlightClipLevel` | 254 | provisional |
| `maxHighlightClipFraction` | 0.02 | provisional |
| `shadowClipLevel` | 3 | provisional |
| `maxShadowClipFraction` | 0.10 | provisional |
| `minMedianLuma` | 50 | provisional |
| `idCellMargin` | 0.15 | provisional (closest real cell 17.2%) |
| `minPatchSourcePixels` | 400 | provisional |
| `maxClipFraction` | 0.02 | provisional |
| `maxResidualWhiteRatio` | 1.20 | provisional |
| `maxLooMeanDeltaE00` / `maxLooP90DeltaE00` | 5 / 10 | provisional |
| `maxRegistrationSpreadDeltaE00` | 6 | provisional — **prototype standard** |
| `sampleWhiteNoiseFactor` | 3 | provisional (× white-paper noise; real empty zones: noise 1.9-2.8 → threshold 5.6-8.2) |
| `sampleMinDeltaE` | 3 | provisional floor |
| `sampleEdgeErodeMm` | 0.5 | provisional |
| `sampleNoiseFloorMm2` | 2 | provisional |
| `sampleMinAreaMm2` / `sampleSecondRegionMm2` | 10 / 10 | provisional |
| `maxSampleClipFraction` | 0.02 | provisional |
| `sampleDarkLevel` | 10 | provisional |
| `maxSampleSpreadDeltaE` | 15 | provisional (real cap 3.4-5.8) |

Kit radii live in the profile, not in `config.ts`: Marquis heroin 7.91,
morphine 8.23, codeine 9.81, oxycodone 9.89, mescaline 10.48; Mandelin
cocaine 9.57, amphetamine 8.70, methamphetamine 9.47 ΔE00 (derivation in the
profiles and `docs/kit_profiles.md`).

## Dependencies (keep few)

| Package | Kind | Why |
|---|---|---|
| `fflate` | runtime | zlib for the PNG codec; zip export of captures and the log. |
| `vite`, `typescript`, `vitest`, `@vitest/browser-playwright`, `playwright`, `@vitejs/plugin-basic-ssl`, `@types/node` | dev | Build, types, unit/browser/e2e tests, LAN HTTPS. |

Local-only tools (not dependencies, not committed): `tools/.venv` with
colour-science (Munsell cross-check), fonttools + brotli (font subsetting),
pypdf (reading source PDFs). Deliberately not used: Workbox, a PDF library,
an IndexedDB wrapper, a UI framework, a crypto library, an icon library,
OpenCV.js.

## Commands and conventions

- `npm run typecheck && npm test && npm run test:browser` before committing;
  `npm run test:e2e`, `npm run test:e2e:result` and `npm run test:e2e:evaluator`
  after UI/capture changes;
  `npm run test:offline -- [url] [--mobile]` after a deploy (or against a local
  `preview` from `.claude/launch.json`: `http://localhost:4173/drugtest/`).
- `node scripts/validate-mat.ts`, `validate-sample.ts`, `validate-kit.ts`
  regenerate the reports in `docs/validation/` from `data/real/`.
- `node scripts/build-kit-profile.ts --kit=<marquis|mandelin>` (analysis, into
  `incoming/`) / `--write` (the profile). Commit the script before
  `--write` so `provenance.commit` names the script that built it.
  `node scripts/validate-kit.ts [--kit=<id>]` writes one report per offered kit.
- `node scripts/verify-log.ts <export> [--noted <hash>] [--reanalyse]`.
- `node scripts/make-samples.ts [--only=<id>]` (→ `samples-review/`, a person looks before copying to `samples/`); `node scripts/audit-walkthrough.ts after` (screenshots; still Session 3's set in `docs/audit/after/`).
- Imports use `.ts` extensions; erasable TS only (no enums, parameter
  properties, namespaces). On Windows, write edit scripts to files (inline
  heredocs with quotes break, repeatedly) and keep LF line endings. In those
  scripts use `split(a).join(b)`, not `replace`: a `$$` in the new text
  becomes `$`.
- Builds and `vite preview` serve at `/drugtest/`; the dev server at `/`.
  Set `BASE_PATH` from PowerShell (Git Bash rewrites `/x/` into a path).
- An old service worker on localhost:4173 serves a stale build: unregister it
  and reload (the browser pane showed Session 1's UI until then).

## Known debt

- Session 4: no Session 4 screen has run on a real phone; Mandelin never says
  NEGATIVE (no source on the reagent's own colour); Mace reads POSITIVE
  methamphetamine on the synthetic check; a Mandelin test read with the
  Marquis kit left selected can read salt or procaine as mescaline (the
  result says which kit it was read as); the kit picker truncates long names
  on a narrow phone; five samples ≈ 4.0 MB of the offline cache.
- Session 3: no Session 3 screen has run on a real phone yet (only Pixel 7
  emulation and laptop size in Chromium/Edge); the NEGATIVE sample is a
  registration photo of copy A (the same photos built the reference, so it is
  an easy case).

- **No real reaction photographed**: both kit profiles are published-reference
  only; POSITIVE is synthetic-only for all eight drugs. A forensic laboratory must photograph real
  reactions on the card and replace the numbers (`docs/kit_profiles.md`).
- Absolute accuracy of the correction unknown (relative calibration; hand-held
  dusk registration, limit 6). OnePlus corrections mostly fail the gate.
- Known false positives inside the radii: Marquis chlorpromazine,
  propoxyphene; Mandelin brompheniramine, methaqualone (cocaine). Marquis
  MDA (no notation) and Mace (7Y) not converted.
- NEGATIVE = no colour, indistinguishable from an empty zone (officer's tick +
  signed photo).
- All sample-zone thresholds provisional; only one real test object (a glossy
  cap wider than the zone).
- Deleting the newest records only caught with a noted hash; key and log lost
  if site data is cleared; one key per browser profile, no rotation or merge.
- Offline phone cannot prove its clock or GPS.
- Live guidance covers the card, not the sample; liquid in a glass not read.
- "Marquis is colourless" cited from Wikipedia (secondary).
- Font is Google Sans, not Google Sans Flex.
- Flat-field on sRGB-decoded values; preview vs capture downscale differ;
  detection ~0.25-0.5 s/frame on desktop, phone speed unmeasured.

## Next steps

1. Real Marquis and Mandelin reactions photographed by a laboratory (and the
   unreacted reagents) → measured centres and spreads
   (`validated-on-real-photos`), non-targets checked; Mace against
   methamphetamine on real photos.
2. Haldi kit (coloured negative, `noColourResult: "RETAKE"`) with its photo set.
3. Run the Session 2 flow on real phones; measure speeds; Safari/iOS.
4. Registration retake flat in daylight with the exposure lock.
5. Liquid-in-glass reading, live sample guidance, key backup/rotation.
