# Reading the sample zone

Code: `src/pipeline/samplezone.ts` (`readSampleZone`). Thresholds:
`src/pipeline/config.ts`, entries starting `sample…` and
`maxSampleClipFraction` (all provisional). Tests:
`tests/unit/samplezone.test.ts` (synthetic). Real photos:
`scripts/validate-sample.ts` → `docs/validation/sample_zone_v1.md`.

## Scope

A test **lying in the 70 mm sample zone**: a spot on paper, a strip, a swab or
a pouch. **Not built:** liquid in a glass (rims, meniscus and glass
highlights), and live guidance for the sample on the camera screen. The
reader runs only after the card stage has PASSed.

## Method

1. Every camera pixel whose centre maps inside the zone, 3 mm in from the
   printed outline, is flat-fielded with the same light field as the card
   patches and divided by this photo's own paper white (median of the six
   white patches), then converted to CIELAB.
2. **Coloured pixel**: ΔE76 from paper white above
   `sampleWhiteNoiseFactor` (3) × the white-paper noise of *this* photo (95th
   percentile of the same figure over every pixel of the white patches),
   and at least `sampleMinDeltaE` (3).
3. The mask's edge is trimmed by `sampleEdgeErodeMm` (0.5 mm); connected
   regions are measured in mm².
4. Result:
   - largest region under `sampleNoiseFloorMm2` (2 mm²) → **no coloured region**;
   - under `sampleMinAreaMm2` (10 mm²) → RETAKE "Coloured area too small";
   - a second region of at least `sampleSecondRegionMm2` (10 mm²) → RETAKE
     "Two separate coloured areas — use one test";
   - more than `maxSampleClipFraction` (2%) of the region (holes filled,
     since a highlight looks like paper) clipped → RETAKE "Glare on the test";
   - otherwise clipped and very dark pixels are dropped, the 10% luma-trimmed
     per-channel median is taken (as for the patches), and **the card's own
     correction** (method A or B, whichever the card used) is applied to that
     one value. There is no second correction path.
   - sampled pixels whose 90th-percentile ΔE76 from their median exceeds
     `maxSampleSpreadDeltaE` (15) → RETAKE "Test colour is patchy".
5. Reported: area (mm²) and pixel count sampled, dropped pixels, spread,
   clipped fraction, whether the region reaches the zone edge, CIELAB before
   and after correction, and a card-space mask (2 cells per mm) the result
   screen draws on the straightened card.

## What "no coloured region" means

**The app cannot tell a colourless negative from an empty zone**: both are
plain paper to the camera. What "no coloured region" means is decided by the
kit profile (`noColourResult`): NEGATIVE for reagents that stay colourless
when nothing reacts (then the officer must tick "The test is in the sample
zone"), RETAKE for kits whose negative has its own colour. The signed photo
shows which it was.

## Evidence

- **Synthetic** (never evidence about phones): a purple blob is found and read
  within 3 ΔE00 of its true colour under a warm cast, a tone curve and
  perspective (the uncorrected reading is more than 5 ΔE00 further off); an
  empty zone gives no coloured region; a tiny blob, two blobs, a glare spot
  and a two-colour test each give the right RETAKE; same pixels in, same
  reading out.
- **Real photos** (`docs/validation/sample_zone_v1.md`): the 6 registration
  photos (empty zone) give no coloured region; the 3 accepted photos with
  the orange-red cap find it. No real reaction has been read.
