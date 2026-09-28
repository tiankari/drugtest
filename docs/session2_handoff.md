# Session 2 handoff (2026-09-28)

Project: SIH26231, Digital Companion for Field Drug Testing. Submission
2026-09-29. Live app: https://tiankari.github.io/drugtest/ (repo
github.com/tiankari/drugtest, branch `main`). Session 1's handoff
(`docs/session1_handoff.md`) still describes the card pipeline.

The required deliverable, *"a working mobile/web application prototype
demonstrating image capture, automated result classification, and
generation of a signed digital record"*, now exists end to end: capture →
card check and correction → sample-zone reading → POSITIVE / NEGATIVE /
INCONCLUSIVE against a versioned kit profile → ECDSA-signed, hash-chained
record → searchable log → export → independent verifier.

## What exists (new in Session 2)

| Step | What | Where |
|---|---|---|
| 1 | Signed records (schema `fdtc.record.v1`), canonical JSON, non-extractable ECDSA P-256 device key, append-only hash-chained log in IndexedDB (`fdtc` v2: `keys`, `records`, `photos`; `captures` kept), whole-log verification, noted-latest-hash check | `src/records/`, `src/ui/db.ts`, `src/ui/log-store.ts`, `docs/records.md` |
| 2 | Sample-zone reader: noise-derived coloured-pixel threshold per photo, edge erosion, regions in mm², glare with holes filled, trimmed median corrected with the card's own model; RETAKE reasons in plain words | `src/pipeline/samplezone.ts`, `docs/sample_zone.md`, `docs/validation/sample_zone_v1.md` |
| 3 | Kit profile format (`fdtc.kit.v1`) and decision rule; the **Marquis opiate screen** from NIJ Standard-0604.01 Table 1 (heroin, morphine, codeine) | `src/pipeline/kit.ts`, `profiles/kit_marquis_opiates_v1.json`, `scripts/build-kit-profile.ts`, `scripts/validate-kit.ts`, `docs/kit_profiles.md`, `docs/validation/kit_marquis_v1.md`, sources in `docs/references/` |
| 4 | Test flow: Test / Log / Settings navigation (inline SVG icons), operator ID first, kit line + validation status + geolocation on the camera screen, result screen (verdict word + icon + colour, sample vs target swatches, sampled mask on the straightened card, in-zone tick, Save signed record; Session 1 details collapsed), record detail with three checks | `src/ui/test-screen.ts`, `camera-screen.ts`, `result-screen.ts`, `record-screen.ts`, `geo.ts`, `src/records/build.ts` |
| 5 | Log screen: newest first, search (operator, case ref, location note, record ID), filters (result, kit, dates), Verify whole log, latest record hash (tap to copy), export (whole log or one record) with VERIFY.md | `src/ui/log-screen.ts`, `src/records/search.ts`, `src/ui/log-export.ts` |
| 6 | Light high-contrast theme (all colours `:root` tokens; camera stays dark), touch targets ≥ 48 px, self-hosted Google Sans (OFL) 45 KB Latin subset, precached | `src/ui/styles.css`, `public/fonts/` |
| 7 | Independent verifier (`--noted`, `--reanalyse`), demo export builder, tamper demo | `scripts/verify-log.ts`, `scripts/lib/verify-export.ts`, `scripts/make-demo-export.ts`, `docs/demo.md` |

## Evidence

### On real photos (the 19 Session 1 photos in `data/real/mat/`, 2 phones)

No real drug reaction has been photographed. The only test object is an
orange-red glossy plastic cap (wider than the sample zone); the registration
photos show an empty zone.

- **Sample-zone reader** (`docs/validation/sample_zone_v1.md`): all 6
  registration photos → "no coloured region"; all 3 photos with the cap that
  pass the card stage (Nothing Phone daylight, tube, soft half-card shadow) →
  coloured region found, reaching the zone edge. Cap spread across those 3:
  3.3 ΔE00 before correction, 4.0 after (6.5 with flat-field only).
- **Classification with the Marquis profile** (`docs/validation/kit_marquis_v1.md`):
  6 empty-zone photos → NEGATIVE; 3 cap photos → INCONCLUSIVE (35-38 ΔE00 from
  heroin, the nearest target, radius 7.9); the 10 photos refused at the card
  stage are never classified. Exactly as expected.
- **Correction-error term**: median leave-one-out 3.96 ΔE00 over those 3 cap
  photos (registration photos excluded because they built the reference).
- **Verifier on a demo export of the 9 accepted real photos**
  (`scripts/make-demo-export.ts`, Node-signed, not app-made): all pass; the
  re-analysis gives the same 9 verdicts, numeric difference 0.

### On synthetic data only (never evidence about phones or reactions)

- Records: 5-record chain verifies; editing any field breaks hash and
  signature; deleting, inserting or reordering a middle record breaks the
  chain; another key is caught; private-key export throws (Node and
  Chromium); deleting the last record is caught only against a noted hash.
- Sample reader: a purple blob read within 3 ΔE00 of its true colour through
  a warm cast, tone curve and perspective; tiny blob, two blobs, glare and a
  two-colour test each give the right RETAKE.
- Kit: rendered squares of each published colour → heroin, morphine, codeine
  POSITIVE; chlorpromazine and propoxyphene POSITIVE (known false positives);
  every other non-target and opium INCONCLUSIVE.
- Built app with a fake camera (`npm run test:e2e:result`, 49 checks, TEST-ONLY
  kit and reference in a throwaway build): operator → guidance → capture →
  POSITIVE → save → record detail ✓✓✓ → log → search/filter → Verify whole log
  → export → the export verifies in Node; an edited verdict and a deleted
  newest record are caught; Node re-analysis matches the Chromium verdicts
  (largest numeric difference 1.7 × 10⁻¹³).
- Offline (local build, Pixel 7 emulation): reload, font, capture, export
  with the network cut.

**Not verified:** Session 2 screens on a real phone (geolocation, IndexedDB
persistence, signing speed, sample reading speed), Safari/iOS, any real
reaction.

## Decisions taken by the user (2026-09-28)

- Kit colours from **NIJ Standard-0604.01** (no haldi photos tonight).
- Marquis radius = hue + chroma neighbour chips + the 3.96 correction-error
  term (non-registration photos only).
- **Opium excluded** as a target (overlaps Dristan 2.5 ΔE00 and sugar).
- Pushed the first complete version after STEP 5 (`4e15997`).

Decisions made by me within the rules, for review: the font in
`incoming/fonts/` is **Google Sans (2025 OFL release), not Google Sans Flex**;
its name table and OFL.txt both say SIL OFL 1.1, so it was used. The "Marquis
is colourless" citation is secondary (Wikipedia; the UNODC manual is a scanned
PDF).

## Known issues

1. POSITIVE is untested on any real reaction; the target colours are a 2000
   publication's visual Munsell matches, not measurements through this app.
2. Absolute accuracy of the correction is unknown (relative calibration
   against our own print, registered hand-held at dusk; prototype limit 6).
3. Known false positives of Marquis inside the POSITIVE radii: chlorpromazine,
   propoxyphene. MDA ("Black", no notation) and Mace (7Y, not a table hue)
   could not be converted; oxycodone (an opioid) is not a target.
4. NEGATIVE cannot be told apart from an empty zone; the officer's tick and
   the signed photo are the only safeguard.
5. All nine sample-zone thresholds are provisional; the cap is glossy and
   larger than the zone, so they are barely exercised on real photos.
6. OnePlus Nord 5 photos are mostly refused at the card stage.
7. Deleting the newest records is only caught against a noted hash; clearing
   site data deletes the key and log (only an export survives); one key per
   browser profile, no rotation, no multi-device merge.
8. An offline phone cannot prove its clock or GPS were honest.
9. Live guidance covers the card, not the sample.

## Next steps

1. Photograph real Marquis reactions (a forensic laboratory, several drugs,
   amounts, phones and lights) and replace the published colours with
   measured centres and spreads (`validated-on-real-photos`).
2. The haldi kit (coloured negative, `noColourResult: RETAKE`) with its own
   photo set.
3. Run the Session 2 flow on real phones; measure sample-reading and signing
   time.
4. Retake the registration flat in daylight with the exposure lock.
5. Liquid-in-glass reading and live sample guidance.

## Numbers for the slides

- The Munsell → CIELAB conversion agrees with the colour-science library to
  0.005 ΔE00 on all 22 colours used (`profiles/kit_marquis_opiates_v1.json`,
  `colourConversion.crossCheck`).
- On the 19 real photos: 6 of 6 empty-card photos read NEGATIVE, 3 of 3
  accepted orange-cap photos read INCONCLUSIVE, and the 10 bad photos were
  refused, never guessed (`docs/validation/kit_marquis_v1.md`).
- Changing one verdict in an exported log is caught at that exact record and
  breaks the next link of the chain (`docs/demo.md`, `tests/e2e/result.e2e.ts`).
- The same photo gives the same verdict in the phone's browser and on a
  laptop; the largest numeric difference was 0.00000000000017
  (`tests/e2e/result.e2e.ts`).
- The signing key cannot be exported, not even by the app itself
  (`tests/unit/records.test.ts`, `tests/browser/log-store.browser.test.ts`).
- The whole app, including its 45 KB font, works with the network cut
  (`tests/e2e/offline.e2e.ts`).
- 203 unit tests, 8 real-browser tests and 76 end-to-end checks pass
  (`npm test`, `npm run test:browser`, `npm run test:e2e`, `npm run test:e2e:result`).
- Heroin, morphine and codeine match radii are 7.9, 8.2 and 9.8 ΔE00; two
  known look-alikes (chlorpromazine, propoxyphene) fall inside, which is why
  the result is presumptive (`docs/validation/kit_marquis_v1.md`).
