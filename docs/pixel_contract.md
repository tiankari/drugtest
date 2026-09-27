# Pixel contract

The colour pipeline must see the same pixels in the field, in the app's
records, and in the Node validation script. This document says how that is
guaranteed and how it is tested.

## Why native camera photos are not used

Phone camera apps apply HDR and tone mapping the web app never sees, iPhones
save HEIC by default, and browsers colour-manage JPEGs differently depending on
the embedded profile. One JPEG can decode to different pixels in a browser and
in Node. So the app never reads photos taken by the phone's camera app.

## The contract

1. **Source.** The app captures one frame from the live `getUserMedia` video
   stream (rear camera). It draws the frame 1:1 into a 2D canvas created with
   `colorSpace: 'srgb'` and reads it back with `getImageData(..., { colorSpace: 'srgb' })`.
   Those RGBA bytes are the frame. (`src/ui/capture.ts`)
2. **Analysis.** The pipeline analyses exactly that RGBA buffer.
3. **Storage.** The buffer is saved as a lossless PNG written by our own encoder
   (`src/io/png.ts`). The file contains only `IHDR`, `IDAT` and `IEND` — no
   `iCCP`, `sRGB`, `gAMA`, `cHRM` or `cICP` chunk — so no decoder has a colour
   profile to apply. Opaque frames are stored as RGB (colour type 2) and decode
   back to the identical RGBA buffer with alpha 255.
4. **Hashes.** The JSON sidecar records `sha256` (of the PNG file bytes) and
   `pixelSha256` (of the RGBA buffer that was analysed).
5. **Reading.** The Node scripts read captures only through
   `scripts/lib/capture-files.ts`, which uses the same decoder. The decoder is
   strict: it checks every CRC and refuses colour chunks, interlacing, palettes
   and bit depths other than 8, because such a file did not come from our
   encoder. `loadCapture()` recomputes both hashes and reports whether they
   match the sidecar, so every real photo carries its own proof.

## Colour definitions

- **sRGB per IEC 61966-2-1**: piecewise transfer function (linear below
  0.04045, exponent 2.4 above), primaries and D65 white as in the standard.
- **XYZ and CIELAB use the D65 white point**, from its CIE 1931 chromaticity
  (x, y) = (0.3127, 0.3290). sRGB white therefore maps to L* = 100, a* = b* = 0.
  No chromatic adaptation is applied anywhere.
- **All colour maths in float64** (JavaScript numbers).
- Constants (rational-form sRGB↔XYZ matrices, CIE ε = 216/24389, κ = 24389/27)
  are taken from the W3C CSS Color Module Level 4 sample code, excerpted with
  source and date in `references/w3c-css-color-4-excerpt.txt`. CSS uses a D50
  Lab; this project uses the same Lab formula with the D65 white.
- Known property of the standard: its linear and power segments do not meet
  exactly at 0.04045 (a jump of about 2.3 × 10⁻⁹ in linear light, far below one
  8-bit step). A unit test pins this down.

## Tests

| Test | What it proves | Where |
|---|---|---|
| PNG round trip, many sizes, RGB and RGBA | Encoder is lossless | `tests/unit/png.test.ts` |
| Only IHDR/IDAT/IEND written; iCCP/sRGB/gAMA/cHRM/cICP refused | No colour profile can sneak in | `tests/unit/png.test.ts` |
| CRC agrees with Node's independent `zlib.crc32` | Chunks are valid PNG | `tests/unit/png.test.ts` |
| Fixture PNG decoded by the Node path | Node path gives the recorded pixels | `tests/unit/pixel-contract.test.ts` |
| **Same fixture decoded in a real browser by the app's decoder and by the browser's native decoder, compared byte-for-byte with the Node path** | One PNG, both paths, identical bytes | `tests/browser/pixel-contract.browser.test.ts` |
| **Live `getUserMedia` frame → app `grabFrame()` → app encoder → Node decoder** | The pixels Node reads are exactly the pixels the app analysed | `tests/browser/pixel-contract.browser.test.ts` |
| Built app, fake 1920×1080 camera, data collection → .zip export → every PNG checked against its sidecar hashes | The whole capture/export chain keeps the contract | `tests/e2e/data-collection.e2e.ts` |

The browser tests run in Chromium (installed Microsoft Edge locally, Playwright
Chromium in CI) with a fake camera playing a generated clip
(`scripts/lib/fake-camera.ts`).

## Limits (stated plainly)

- The browser converts the camera's YUV frames to RGB before we see them. That
  conversion is part of "the pixels the pipeline sees" and may differ between
  phones and browsers; it is recorded implicitly by the phone and user-agent
  fields in every sidecar.
- Browsers with anti-fingerprinting canvas noise (e.g. Brave, Firefox with
  `resistFingerprinting`) alter `getImageData` output. The pixel hash then still
  describes what was analysed, but the image is noisier than the camera frame.
- `Math.pow`, `Math.cbrt` and similar functions are not required by the
  language to be correctly rounded, so two JavaScript engines may differ in the
  last bit. Only a value sitting exactly on a threshold could flip. Not yet
  measured across engines; listed as debt.
- Only Chromium has been exercised by the automated browser tests. Safari on
  iPhone has not been tested yet.
