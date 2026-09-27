# CLAUDE.md — Field drug-test companion (SIH26231)

## STATUS: PAUSED FOR PHOTOS (Session 1 checkpoint, after Step 3)

Steps 1–3 are built (scaffold + deploy, printable reference colour card, camera
and data-collection capture tool) and merged to `main`. Work is paused until
real photos exist.

### Personal project: identity and remote

This is a personal project. **Never use a work or organisational email,
account, registry or repo for it, and never write such an address into the
repo.** No AI co-author trailer in commit messages (user's choice).

- Commit identity (repo-local config only; global config is not touched):
  `tiankari <271698808+tiankari@users.noreply.github.com>`.
- Only remote: `origin = https://tiankari@github.com/tiankari/drugtest.git`,
  with `credential.useHttpPath true` locally so git asks for this account. No
  SSH, no gh CLI. If git ever offers a stored login for another account, stop
  and tell the user; do not use or delete it.
- GitHub Pages base path `/drugtest/` is set in `vite.config.ts`.

### Checkpoint tasks

1. Done: the user pushed `main` to `origin`, signed in as tiankari.
2. Done: Pages source is GitHub Actions. The workflow run for `09e25d4` passed
   (typecheck, unit, browser pixel-contract tests on Linux Chromium, build,
   deploy). https://tiankari.github.io/drugtest/ serves that build, and
   `npm run test:offline` passed against it with the network cut: reload,
   capture, zip export with hash checks, card PDF download.
3. Automated stand-in done: `npm run test:offline -- --mobile` (Playwright's
   Pixel 7 profile: Android UA, touch, phone viewport; portrait 1080×1920 fake
   camera) passes offline, including capture at full 1080×1920 and export.
   It found and fixed a real bug: Chrome cropped a portrait-native camera to
   1080×1080 because the request was landscape-shaped; the camera request now
   prefers native modes (`resizeMode: 'none'`, `src/ui/camera.ts`).
   **Still pending (user): the real-phone check** — camera opens, live guidance
   shows, a data collection capture saves, the .zip export works. Emulation is
   not a phone: real sensors, rotation handling and speed are untested.

**When the user says the photos are in:** first print a count of PNGs per folder
under `data/real/mat/` and per tag (tag = first `_`-separated field of the file
name), then continue with Step 4 (detection, rectification, colour correction),
Step 5 (live guidance and result screen) and Step 6 (real-photo validation).
Verify every photo's hashes with `scripts/lib/capture-files.ts#loadCapture`
before using it.

Shot list the user is collecting (all through the app, data collection mode):
1. `data/real/mat/registration/<copy>/` — 3 per printed copy (A, B), soft indirect daylight.
2. `data/real/mat/lighting/` — 15+ across daylight, tube, warm bulb, phone torch, 2+ phones,
   same orange card strip fixed in the sample zone.
3. `data/real/mat/should_fail/` — ~6, one fault each: corner covered, shadow over half,
   glare on patches, motion blur, card too small, tube-light banding.

## Purpose

Phone app for Narcotics Control Bureau field officers, used alongside existing
colour-change drug-test kits. The officer places the reacted test on the printed
**reference colour card** (always this term in UI and docs; "mat" is fine in
code and file names) and photographs it through the app. The app corrects the
photo's colours using the card, reads the reaction colour, classifies it
POSITIVE / NEGATIVE / INCONCLUSIVE against a versioned kit profile, and makes a
tamper-evident record (timestamp, GPS, operator ID, SHA-256 of the image) in a
searchable log. **Presumptive field result only; never replaces lab
confirmation.** Official text: `docs/problem_statement.md` — check work against it.

## Architecture rules (decided — do not change)

- Everything runs in the browser: static PWA, TypeScript + Vite. No backend, no
  server calls, no API keys. Fully offline after first load. Photos never leave
  the phone except by the user's own export.
- No ML anywhere in the decision path. Deterministic maths: same pixels in, same
  result out.
- The colour pipeline (`src/pipeline/`) is pure TypeScript with no DOM and no
  Node dependencies; its input is a plain RGBA buffer. Enforced by
  `tsconfig.pure.json` (lib ES2022 only) in `npm run typecheck`.
- Marker detection and homography in pure TS. Use OpenCV.js only if pure TS
  proves unreliable on real photos — and ask the user before switching.
- Anything uncertain returns RETAKE (Session 1) or INCONCLUSIVE (Session 2). Never a guess.
- No demo mode, no mock results, no fallback that hides a failure. Show real errors on screen.
- Never type reference data from memory when a source exists (test vectors,
  published tables): fetch it, derive it from our data, or ask the user.
- Never loosen a threshold to make more real photos pass. Report it as a finding.
- Report separately what was verified on real photos vs only on synthetic tests.

## Pixel contract (full text: `docs/pixel_contract.md`)

Frames come from the live `getUserMedia` stream (never the phone's camera app),
drawn 1:1 to an sRGB canvas and read with `getImageData`. That RGBA buffer is
analysed, saved as a lossless PNG with **no colour-profile chunk** (only
IHDR/IDAT/IEND), and hashed (`sha256` of the file, `pixelSha256` of the pixels)
in a JSON sidecar. Node scripts read captures only via
`scripts/lib/capture-files.ts` (same decoder, strict, verifies hashes).
Colour maths in float64; sRGB per IEC 61966-2-1; D65 white for XYZ and CIELAB.

## Module map

| Path | What |
|---|---|
| `src/pipeline/colour.ts` | sRGB ↔ linear ↔ XYZ ↔ CIELAB (D65). Constants from W3C CSS Color 4 (`docs/references/`). |
| `src/pipeline/mat.ts` | MAT v1 geometry (mm) and design colours; ID-strip codec. Single source of truth for print and pipeline. |
| `src/pipeline/quality.ts` | Card-independent checks: blur (variance of Laplacian), exposure (blown white, crushed black, median luma); framing outline. |
| `src/pipeline/config.ts` | **Every threshold**, each marked provisional/derived with a one-line reason. |
| `src/pipeline/image.ts` | `RgbaImage` type, luma, rect clamp. |
| `src/io/png.ts`, `crc32.ts` | Strict lossless PNG codec (fflate zlib). |
| `src/io/hash.ts` | SHA-256 via WebCrypto (browser and Node). |
| `src/io/dataset.ts` | Data-collection tags, file naming, zip folders, sidecar schema. |
| `src/ui/` | App shell (hash routing), camera + live checks, capture, IndexedDB store, zip export, settings, about. |
| `src/ui/workers/` | `preview.worker.ts` (downscaled live checks), `capture.worker.ts` (full-res checks, PNG encode, hashes). |
| `src/sw/sw.js` + `build/sw-plugin.ts` | Hand-written service worker; plugin writes the precache list from `dist/` after build. |
| `scripts/generate-mat.ts` + `scripts/lib/{card,svg,pdf,drawing}.ts` | Printable card: A6 SVG/PDF per copy, A4 sheet with crop marks, layout JSON. Hand-written PDF writer. |
| `scripts/lib/capture-files.ts` | Node side of the pixel contract. |
| `scripts/lib/fake-camera.ts` | Y4M clip + Chromium flags for a fake camera in tests. |
| `print/` | Generated card files + `PRINT_INSTRUCTIONS.md`. |
| `profiles/` | (Step 4+) registered mat references; (Session 2) kit profiles. |
| `data/real/` | Real captures (PNG + sidecar) in the shot-list folders. |
| `docs/` | Problem statement, pixel contract, MAT v1 layout, references. |

## Verified so far

**On real photos: nothing yet.** No real photo exists until the shot list is done.

On synthetic data / automated tests only:
- PNG codec lossless round trip; colour chunks refused; CRC agrees with Node's `zlib.crc32`.
- Pixel contract in real Chromium (installed Edge): one PNG decoded by the app's
  decoder, the browser's native decoder and the Node path → identical bytes; a live
  fake-camera frame → `grabFrame` → encoder → Node decoder → exactly the analysed pixels.
- E2E on the built app (fake 1920×1080 camera): data collection mode, three tagged
  captures, zip export laid out as `mat/...`, every PNG's file and pixel hashes match
  its sidecar. PNG encode ≈ 0.4 s per 1920×1080 frame on a desktop (phone will be slower).
- Offline: service worker precache, update prompt, offline reload — checked in a
  local production preview, at `/` and under a sub-path; the e2e test passes with
  the built app served at `/drugtest/`; `npm run test:offline` (desktop and
  `--mobile`) passes against the live GitHub Pages site with the network cut.
- Colour conversions: internal consistency only (white point, matrix inverse,
  8-bit round trip). CIEDE2000 and published test vectors come in Step 4.
- MAT v1 layout constraints and ID-strip codec (every single-cell misread fails parity).
- Blur/exposure checks respond in the right direction on synthetic scenes.

Not verified: any real phone (only Pixel 7 emulation in desktop Chromium).
Safari/iOS untested. Thresholds unvalidated.

## Thresholds

All in `src/pipeline/config.ts`; **all provisional** (none derived from real data yet):
`blurMinLaplacianVariance` 50, `highlightClipLevel` 254, `maxHighlightClipFraction` 0.02,
`shadowClipLevel` 3, `maxShadowClipFraction` 0.10, `minMedianLuma` 50.

## Dependencies (keep few)

| Package | Kind | Why |
|---|---|---|
| `fflate` | runtime | zlib for the PNG codec; zip export of captures. Small, no deps. |
| `vite` | dev | Dev server and production build (PWA shell, workers). |
| `typescript` | dev | Type checking (TS 7). Node runs `.ts` scripts natively (type stripping). |
| `vitest` | dev | Unit tests (Node) and browser-mode tests. |
| `@vitest/browser-playwright`, `playwright` | dev | Real-Chromium pixel-contract tests and the e2e test. Local runs use installed Edge (no browser download). |
| `@vitejs/plugin-basic-ssl` | dev | Self-signed HTTPS for `npm run dev:https` so a phone on the LAN can open the camera. |
| `@types/node` | dev | Types for scripts and tests. |

Deliberately not used: Workbox (hand-written SW), a PDF library (hand-written
writer), an IndexedDB wrapper, a UI framework, OpenCV.js.

## Conventions

- Imports use explicit `.ts` extensions; only erasable TS syntax (no enums, no
  parameter properties, no namespaces) so Node can run scripts directly.
- `npm run typecheck && npm test && npm run test:browser` before committing;
  `npm run test:e2e` after UI/capture changes; `npm run test:offline -- [url]
  [--mobile]` against the deployed site after a deploy (defaults to the Pages URL).
- Phone testing: `npm run dev:https` works for camera checks but a self-signed
  certificate blocks service-worker registration; test offline on GitHub Pages.
- Builds and `vite preview` serve at `/drugtest/` (open http://localhost:4173/drugtest/);
  the dev server stays at `/`. To override with `BASE_PATH`, set it from
  PowerShell: Git Bash rewrites arguments like `/x/` into Windows paths.

## Known debt (so far)

- Preview checks use the browser's canvas downscale; capture checks use the
  pipeline's box filter. Preview only guides; the capture check is recorded.
- Cross-engine last-bit differences in `Math.pow`/`cbrt` not measured.
- Encode time on a cheap Android phone not measured yet (sidecar records it).
- Camera resolution and orientation on real phones unverified: the request is
  1920×1080 with `resizeMode: 'none'` preferred; what each phone delivers (and
  whether portrait frames arrive rotated) is recorded in every sidecar.
