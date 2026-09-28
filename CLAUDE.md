# CLAUDE.md — Field drug-test companion (SIH26231)

## STATUS: Session 1 Steps 1–5 done; Step 6 PAUSED for a registration retake

Built: scaffold + offline PWA + Pages deploy, printable reference colour card
(MAT v1), camera and data-collection tool, card detection / rectification /
ID strip / colour correction (Step 4), live guidance and result screen
(Step 5), registration and validation scripts (Step 6).

**Blocker:** no printed copy is registered. The first registration shots
(hand-held against a wall at dusk) were each fine on their own but the three
shots of a copy disagree by 5.2 (A) / 5.5 (B) ΔE00 even after removing
exposure/white-balance drift and the light gradient; the limit is 3. So
colour correction has not run on a real photo, the method is not chosen and
the correction thresholds are not derived. The user is retaking (protocol in
`data/real/README.md`): cards flat on a table, steady daylight, exposure/WB
lock, and a dried haldi stain as the lighting test object.

**Design decisions taken on real data (user, 2026-09-28):**
1. **Flat-field, then check.** A per-channel plane fitted to the six white
   patches is divided out before correction (`src/pipeline/flatfield.ts`); the
   uneven-light check now applies to what remains (`maxResidualWhiteRatio`).
   Consequence: the soft half-card shadow photo (`fail-shadow`) is no longer
   refused by the light check (residual 1.14); if it PASSes once a copy is
   registered, report it as the headline finding.
2. **Registration normalises each shot to its own white patches** (after
   flat-field) before the median and the spread; reference schema v2 (paper
   white = 1). Limit stays 3 ΔE00 until re-derived.
3. **Optional exposure/WB lock for registration shots** where the phone
   offers manual modes (Camera tab, tag `registration`). Recorded in the
   sidecar (`camera.lock`). Untested on a real phone; the fake camera offers no
   manual modes, so only the fallback is tested.
4. **Dried haldi stain** replaces the glossy cap for the lighting set.

**When the retake arrives:**
1. Count PNGs per folder and per tag; verify hashes (`loadCapture`). Earlier
   sets live in `data/real/archive/`; never mix them into `data/real/mat/`.
2. `node scripts/register-mat.ts` → `profiles/mat_reference_1_{A,B}.json`.
3. `node scripts/validate-mat.ts` → `docs/validation/mat_v1.md` (reports the
   current set and every archived set separately).
4. Choose the default method from the data (`DEFAULT_CORRECTION_METHOD`),
   derive or keep-as-debt every provisional threshold, rewrite this file, merge.
5. The user decides whether real photos may go into the public repo.

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
  redeploys the live app).
- GitHub Pages: https://tiankari.github.io/drugtest/ (base path `/drugtest/`
  in `vite.config.ts`).
- **Real photos stay out of git** (`.gitignore`): they show the user's home and
  the repo is public. Only file names and numbers appear in the docs.

## Purpose

Phone app for Narcotics Control Bureau field officers, used alongside existing
colour-change drug-test kits. The officer places the reacted test on the printed
**reference colour card** (always this term in UI and docs; "mat" is fine in
code and file names; short UI messages say "card") and photographs it through
the app. The app corrects the photo's colours using the card, reads the
reaction colour, classifies it POSITIVE / NEGATIVE / INCONCLUSIVE against a
versioned kit profile, and makes a tamper-evident record (timestamp, GPS,
operator ID, SHA-256 of the image) in a searchable log. **Presumptive field
result only; never replaces lab confirmation.** Official text:
`docs/problem_statement.md` — check work against it.

## Architecture rules (decided — do not change)

- Everything runs in the browser: static PWA, TypeScript + Vite. No backend, no
  server calls, no API keys. Fully offline after first load. Photos never leave
  the phone except by the user's own export.
- No ML anywhere in the decision path. Deterministic maths: same pixels in, same
  result out.
- The colour pipeline (`src/pipeline/`) is pure TypeScript with no DOM and no
  Node dependencies; its input is a plain RGBA buffer. Enforced by
  `tsconfig.pure.json` (lib ES2022 only) in `npm run typecheck`.
- Marker detection and homography in pure TS (working on real photos; OpenCV.js
  not needed). Ask the user before ever switching.
- Anything uncertain returns RETAKE (Session 1) or INCONCLUSIVE (Session 2). Never a guess.
- No demo mode, no mock results, no fallback that hides a failure. Show real errors on screen.
- Never type reference data from memory when a source exists: fetch it, derive
  it from our data, or ask the user.
- Never loosen a threshold to make more real photos pass. Report it as a finding.
- Report separately what was verified on real photos vs only on synthetic tests.

## Pixel contract (full text: `docs/pixel_contract.md`)

Frames come from the live `getUserMedia` stream (never the phone's camera app),
drawn 1:1 to an sRGB canvas and read with `getImageData`. That RGBA buffer is
analysed, saved as a lossless PNG with **no colour-profile chunk** (only
IHDR/IDAT/IEND), and hashed (`sha256` of the file, `pixelSha256` of the pixels)
in a JSON sidecar. Node scripts read captures only via
`scripts/lib/capture-files.ts` (same decoder, strict, verifies hashes; the
validation script aborts on any mismatch). Colour maths in float64; sRGB per
IEC 61966-2-1; D65 white for XYZ and CIELAB. Correction is **relative
calibration against our own registered print**, not absolute colour measurement.

## Pipeline (one frame)

`src/pipeline/analyse.ts#analyseMat` runs, in order, and stops at nothing
silently — every check is recorded, the first failure is the RETAKE reason:
1. Frame checks: too dark / too bright (framing outline), sharpness.
2. Detection (`detect.ts`): box-downscale to ~960 px, adaptive threshold,
   3×3 closing, connected components; square blobs, solid or with one centred
   hole (the top-left key). For each holed blob, TR/BL/BR are searched at the
   layout's distances with clockwise order (mirror → refused); every candidate
   quad is verified: marker sizes vs homography, white patches brighter than
   markers, neutral ramp darkening in order, ID strip decodes to MAT v1. Two
   valid cards → refused. Largest valid quad wins (true corners are outermost).
3. ID strip re-read at full resolution (odd parity; 0 and 15 reserved).
4. Sharpness re-measured on the detected card.
5. Patch sampling (`sample.ts`): camera pixels whose centres map inside each
   patch's central 5 × 5 mm; trimmed median (10% off each luma end); "Move
   closer" if the smallest patch has too few camera pixels.
6. Glare: clipped fraction in every patch and in the sample zone.
7. Light: a per-channel plane is fitted to the 6 white patches and divided
   out of every patch and the sample reading; RETAKE if the whites are still
   uneven afterwards (local shadow the plane cannot model).
8. Registered reference for the copy read (bundled from `profiles/`).
9. Correction (`correct.ts`): A = 3×3 in linear RGB; B = per-channel power-law
   curves fitted on the neutral ramp, then 3×3. Leave-one-out CIEDE2000 decides.

## Module map

| Path | What |
|---|---|
| `src/pipeline/colour.ts` | sRGB ↔ linear ↔ XYZ ↔ CIELAB (D65). Constants from W3C CSS Color 4 (`docs/references/`). |
| `src/pipeline/ciede2000.ts` | CIEDE2000 (Sharma, Wu & Dalal 2005). |
| `src/pipeline/mat.ts` | MAT v1 geometry (mm) and design colours; ID-strip codec. Source of truth for print and pipeline. |
| `src/pipeline/quality.ts` | Blur (variance of Laplacian), exposure, framing outline, luma planes. |
| `src/pipeline/components.ts`, `detect.ts` | Connected components, holes, quad fit; card detection, verification, ID strip reading. |
| `src/pipeline/homography.ts`, `linalg.ts` | Normalised DLT homography; small solvers, medians, percentiles. |
| `src/pipeline/sample.ts`, `rectify.ts` | Patch sampling from camera pixels; canonical warp for display. |
| `src/pipeline/flatfield.ts` | Planar light field from the six whites; flat-fielding; white ratios. |
| `src/pipeline/correct.ts`, `reference.ts` | Methods A/B, leave-one-out; registered-reference format (v2) and white-normalised combination. |
| `src/pipeline/analyse.ts` | The whole pipeline and PASS/RETAKE with plain-words reasons. |
| `src/pipeline/config.ts` | **Every threshold and parameter**, each provisional/derived with a reason. |
| `src/io/png.ts`, `crc32.ts`, `hash.ts`, `dataset.ts` | Strict PNG codec, SHA-256, tags/naming/zip folders/sidecar schema. |
| `src/ui/` | Shell, camera + live card guidance + overlay, capture, result screen, IndexedDB store, zip export, settings. |
| `src/ui/workers/` | `preview.worker.ts` (live analysis on a downscaled frame), `capture.worker.ts` (full analysis, PNG, hashes, rectified card). |
| `src/ui/references.ts` | Bundles `profiles/mat_reference_*.json` at build time. |
| `src/sw/sw.js` + `build/sw-plugin.ts` | Hand-written service worker; precache list from `dist/` (cache lookups ignore Vary). |
| `scripts/generate-mat.ts` + `scripts/lib/` | Print files (hand-written PDF writer); `capture-files.ts` (Node side of the contract); `fake-camera.ts` (Y4M clips). |
| `scripts/register-mat.ts`, `scripts/validate-mat.ts` | Registration → `profiles/`; real-photo validation → `docs/validation/mat_v1.md`. |
| `tests/unit`, `tests/browser`, `tests/e2e`, `tests/helpers/synth-card.ts` | Unit (Node), real-browser pixel contract, built-app end-to-end; synthetic card renderer. |

## What is verified, and on what

### On real photos (13 captures, 2 phones, `docs/validation/mat_v1.md`)

Nothing has been registered, so **no colour correction has run on a real photo.**

- **Pixel contract:** all 13 PNGs decode in Node to exactly the pixels the app
  analysed (file and pixel SHA-256 match every sidecar). Both phones delivered
  1080×1920.
- **Detection:** all 10 photos with four visible corners detected, copy A and
  MAT v1 read correctly, orientation 0°, 6.4–7.3 px/mm (3.2 on the "too far"
  photo) — despite the uncut A4 sheet putting copy B's markers in frame,
  textured backgrounds and paper sheen. Early versions produced two **wrong
  quads that passed parity** (read as copy C, version 2); fixed by requiring
  the neutral-ramp order and a known version, and by verifying every
  bottom-right candidate. Covered corner → refused ("Card ID unreadable");
  glare photo → refused ("Show all four corners").
- **Should-fail:** 5/5 RETAKE, none passed; right reason for blur, far, shadow
  (3/5). No banding photo was collected.
- **Uneven light (headline finding, led to decision 1):** as photographed, the
  white-patch ratio was 1.17–3.04 on the 8 lighting photos and 1.24–1.61 on
  the 6 registration photos: 13 of 14 good-intent photos over the old 1.20
  limit. Causes seen: a top-to-bottom gradient in close-up shots (phone and
  hand block light; the far shot measures 1.04) and the cap's own shadow
  (warm-bulb shot, one white at 0.19 vs ~0.5). After flat-field the residual
  is 1.025–1.055 on registration photos and 1.04–1.36 on lighting photos
  (2.26 on the cap-shadow shot, still RETAKE).
- **Registration repeatability:** three back-to-back hand-held shots of one
  copy disagree by 8.3 / 9.2 ΔE00 raw, mostly auto-exposure drift (one shot
  ~10% brighter on every patch); 5.2 / 5.5 after per-shot white
  normalisation and flat-field (median over patches ~3). Rejected.
- **Scratch experiment (not the app; checks waived, copy A registered from
  those shots anyway):** leave-one-out 3–7.7 ΔE00 per lighting photo (lower
  with flat-field); the glossy cap still spread 18.7–23.6 ΔE00 across lights
  and phones after correction (19.4 before). Inconclusive about matte
  reaction colours: the cap is glossy and more saturated than any patch.
- **Glare:** the torch reflects off the glossy cap: 5.4% of the sample zone
  clipped on the OnePlus torch shot → RETAKE.
- **The test colour before correction** (orange-red cap, central 24 mm): its
  CIELAB spreads by 14.9 ΔE00 across lights on the Nothing Phone (3a), 16.4 on
  the OnePlus Nord 5, 19.4 across both phones. After-correction spreads:
  blocked.
- **ID strip margin:** closest cell to the midpoint 17.2% of range (torch
  shot) against a 15% refusal margin — thin under torch light.
- **Sharpness on the card:** sharp photos 960–3847, motion-blurred 488.

### On synthetic data only (never evidence about phones)

- CIEDE2000: all 34 rows of the Sharma, Wu & Dalal (2005) data to 4 decimal places.
- Detection: rotations 0/90/180/270 resolve TL and orientation; perspective;
  copy B; mirrored image refused; two complete cards refused; covered corner refused.
- Correction: a pure cast is undone (LOO < 0.5); tone curve + cast: B beats A
  (B < 1, A > 2); leave-one-out ≥ in-sample residual.
- Full pipeline: PASS under cast + tone curve + perspective + 180°, B better
  than A; RETAKE for half-card shadow (ratio > 1.5), glare spot, small card,
  unregistered copy.
- Built app with a fake camera: data collection capture/export keeps the pixel
  contract; phone emulation offline; live guidance "Ready", green card
  outline + TOP arrow, result screen PASS with all fields (throwaway synthetic
  reference for copy N, never committed); data collection never shows a result.
- Offline on the live Pages site (desktop and Pixel 7 emulation, network cut).

Not verified: any real phone running Steps 4–5 (live guidance, result screen),
Safari/iOS, speed on a cheap Android phone.

## Thresholds (`src/pipeline/config.ts`)

| Threshold | Value | Status |
|---|---|---|
| `blurMinLaplacianVariance` | 680 | **derived**: geometric mean of the one motion-blurred real photo (488) and the least sharp non-blurred one (960). One blurred example; re-derive with more. |
| `highlightClipLevel` | 254 | provisional |
| `maxHighlightClipFraction` | 0.02 | provisional (all real photos 0–0.1% blown white) |
| `shadowClipLevel` | 3 | provisional |
| `maxShadowClipFraction` | 0.10 | provisional |
| `minMedianLuma` | 50 | provisional (real photos 155–191; far shot 70) |
| `idCellMargin` | 0.15 | provisional (closest real cell 17.2%) |
| `minPatchSourcePixels` | 400 | provisional, consistent with data (good 930–1227, far 256) |
| `maxClipFraction` | 0.02 | provisional (torch/cap 5.4% → RETAKE) |
| `maxResidualWhiteRatio` | 1.20 | provisional — residual after flat-field (registration 1.03–1.06, lighting 1.04–1.36, cap shadow 2.26); replaces the raw-ratio limit |
| `maxLooMeanDeltaE00` | 5 | provisional (no real correction yet) |
| `maxLooP90DeltaE00` | 10 | provisional |
| `maxRegistrationSpreadDeltaE00` | 3 | provisional |
| `DEFAULT_CORRECTION_METHOD` | B | provisional (synthetic only) |

## Dependencies (keep few)

| Package | Kind | Why |
|---|---|---|
| `fflate` | runtime | zlib for the PNG codec; zip export of captures. Small, no deps. |
| `vite` | dev | Dev server and production build (PWA shell, workers). |
| `typescript` | dev | Type checking (TS 7). Node runs `.ts` scripts natively (type stripping). |
| `vitest` | dev | Unit tests (Node) and browser-mode tests. |
| `@vitest/browser-playwright`, `playwright` | dev | Real-Chromium pixel-contract tests and e2e tests. Local runs use installed Edge. |
| `@vitejs/plugin-basic-ssl` | dev | Self-signed HTTPS for `npm run dev:https` (phone camera on the LAN). |
| `@types/node` | dev | Types for scripts and tests. |

Deliberately not used: Workbox, a PDF library, an IndexedDB wrapper, a UI
framework, OpenCV.js.

## Commands and conventions

- `npm run typecheck && npm test && npm run test:browser` before committing;
  `npm run test:e2e` and `npm run test:e2e:result` after UI/capture changes;
  `npm run test:offline -- [url] [--mobile]` after a deploy.
- Imports use `.ts` extensions; erasable TS only (no enums, parameter
  properties, namespaces). On Windows, write edit scripts to files (inline
  heredocs with quotes break) and keep LF line endings.
- Builds and `vite preview` serve at `/drugtest/`; the dev server at `/`.
  Set `BASE_PATH` from PowerShell (Git Bash rewrites `/x/` into a path).
- `npm run dev:https` gives the camera on a phone over the LAN, but a
  self-signed certificate blocks the service worker.

## Known debt

- **Registration photos missing** — blocks real-photo correction, the method
  choice and five thresholds (above).
- **Registration retake pending**; the exposure/WB lock is unproven on a phone.
- Flat-field runs on sRGB-decoded values, which the phone's tone curve makes
  only approximately linear.
- With flat-field, a soft half-card shadow is corrected rather than refused;
  whether that is acceptable depends on the correction error once registered.
- Photo set is thin: 8 lighting photos (asked 15+), 5 should-fail, no banding;
  cards not cut apart; a glossy cap stood in for the orange strip.
- The printer rendered colours far from design (teal nearly black, greys
  brownish): fewer distinct patches for the fit; registration absorbs the
  offset but not the lost range.
- Covered-corner and glare photos are refused with less helpful messages
  ("Card ID unreadable", "Show all four corners").
- Preview uses the browser's canvas downscale; capture uses the pipeline's box
  filter. Preview only guides; the capture analysis is recorded.
- Detection takes ~0.25–0.5 s per full frame on a desktop; phone speed unmeasured.
- Cross-engine last-bit differences in `Math.pow`/`cbrt` not measured.
- Real photos are only on this machine; validation is reproducible only here
  until the user decides how to share them.

## Session 2 should build

- **Kit profiles** (versioned, like the card): colour regions per outcome for
  each kit, including a fully tested **"haldi test" profile** (turmeric with a
  safe alkaline household solution — a proxy we can legally handle), with its
  own real photo set.
- **Reading the sample zone**, including liquid in a glass: find the test in
  the zone, avoid glass highlights, rims and shadows, report what was sampled.
- **Classification** POSITIVE / NEGATIVE / INCONCLUSIVE with INCONCLUSIVE bands
  derived from real photos (spread of corrected colours per outcome), never
  from memory.
- **Tamper-evident records** signed with a non-extractable WebCrypto ECDSA key
  per device — described plainly as "proves the record was not changed after
  signing on this device", not "proves who the officer is". Record:
  timestamp, GPS, operator ID, SHA-256 of the capture PNG, kit and card
  versions, verdict, the analysis summary.
- **A hash-chained log**: each record includes the previous record's hash, so a
  record cannot be removed from the middle, inserted or reordered later without
  breaking the chain. Be plain that an offline phone cannot prove its own
  clock or GPS were honest.
- **The searchable log** (by date, operator, kit, result, place).
