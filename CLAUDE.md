# CLAUDE.md — Field drug-test companion (SIH26231)

## STATUS: PAUSED FOR PHOTOS (Session 1 checkpoint, after Step 3)

Steps 1–3 are built (scaffold + deploy, printable reference colour card, camera
and data-collection capture tool), committed and merged to `main` **locally
only**. Work is paused until real photos exist.

### Leftover checkpoint tasks (mini session, before photos)

The user chose to keep everything local until they set up a personal git
identity. **Never author commits with the work email or
associate it with this repo in any way.** All commits so far carry the
placeholder `unassigned <unassigned@localhost.invalid>`.

1. User gives their personal git name/email → set them repo-locally and rewrite
   every commit's author and committer from the placeholder (e.g. `git
   filter-branch --env-filter ... -- --all`, then drop `refs/original`) BEFORE
   any push.
2. User creates an empty GitHub repo (public on a free plan, for Pages); add it
   as `origin`; push `main`.
3. User switches on **Settings → Pages → Build and deployment → Source: GitHub
   Actions**. Confirm the workflow passes and the Pages URL loads, the service
   worker installs and an offline reload works.
4. User confirms on a phone: camera opens, live guidance shows, a data
   collection capture saves, and the .zip export works.

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
  local production preview, at `/` and under a `/<repo>/` sub-path.
- Colour conversions: internal consistency only (white point, matrix inverse,
  8-bit round trip). CIEDE2000 and published test vectors come in Step 4.
- MAT v1 layout constraints and ID-strip codec (every single-cell misread fails parity).
- Blur/exposure checks respond in the right direction on synthetic scenes.

Not verified: any phone. Safari/iOS untested. Thresholds unvalidated.

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
  `npm run test:e2e` after UI/capture changes.
- Phone testing: `npm run dev:https` works for camera checks but a self-signed
  certificate blocks service-worker registration; test offline on GitHub Pages.
- Git Bash rewrites arguments like `/repo/` into Windows paths; set `BASE_PATH`
  from PowerShell when building locally with a sub-path.

## Known debt (so far)

- Preview checks use the browser's canvas downscale; capture checks use the
  pipeline's box filter. Preview only guides; the capture check is recorded.
- Cross-engine last-bit differences in `Math.pow`/`cbrt` not measured.
- Encode time on a cheap Android phone not measured yet (sidecar records it).
