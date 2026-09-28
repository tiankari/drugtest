# Kit profiles

A kit profile says which colours mean what for one field-test kit. It is data
(`profiles/kit_*.json`), bundled into the app at build time
(`src/ui/kits.ts`), validated on load (`parseKitProfile`), and cited in every
record by id, version and SHA-256 of its canonical JSON. The decision rule is
generic code (`src/pipeline/kit.ts#classify`); nothing in the code knows about
any particular kit.

The only profile shipped: **`profiles/kit_marquis_opiates_v1.json`, "Marquis
reagent — opiate screen"**, built by `scripts/build-kit-profile.ts`, validated
in `docs/validation/kit_marquis_v1.md`. Shown on every screen, record and doc
that uses it: *"Marquis opiate screen — colours from NIJ Standard-0604.01, not
yet checked against a real reaction with this app"*.

## Format (schema `fdtc.kit.v1`)

| Field | Meaning |
|---|---|
| `id`, `version`, `name` | identity (a changed colour or radius means a new version) |
| `reagent`, `detects` | what the kit is and what it screens for |
| `validation` | `published-reference-only` or `validated-on-real-photos` |
| `validationLine` | the plain sentence shown wherever the profile is used |
| `source` | document, table, the exact rows used, URL, SHA-256 of the PDF, path of the saved excerpt |
| `colourConversion` | how the source colours became CIELAB (data, Y scale, adaptation, cross-check) |
| `outcomes[]` | per coloured outcome (`POSITIVE`, or `NEGATIVE` for kits whose negative has a colour): `targets[]` with `label`, source `notation`, `sourceName`, `sourceRow`, `lab` (CIELAB, D65), `radius` (CIEDE2000) and `radiusDerivation` (rule, chip term, the chips used, correction-error term) |
| `noColourResult` | what "no coloured region in the zone" means: `NEGATIVE` (reagent colourless when nothing reacts) or `RETAKE` (kit whose negative has its own colour) |
| `noColourNote`, `noMatchReason` | plain words for those cases |
| `readingTime` | when the colour is final (Marquis: within 1-2 min, NIJ §3.3) |
| `sampleReading` | the sample-zone limits in force when the profile was built |
| `knownNonTargetReactions[]` | other substances in the source table, their colour, nearest target, distance, and whether they fall inside a POSITIVE radius (known false positives) |
| `provenance` | script, commit, options chosen, the real photos used for the correction-error term |
| `status` | one line on how thin the evidence is |

## Decision rule

1. A card or sample-zone RETAKE is never classified.
2. No coloured region → `noColourResult`.
3. Otherwise d = ΔE00(corrected sample, each target). Exactly one outcome with
   a target within its radius → that outcome, naming the nearest such target.
   None → INCONCLUSIVE ("Colour matches no opiate reaction in the NIJ table").
   More than one outcome → INCONCLUSIVE.

Same pixels and same profiles in, same verdict out.

## Why tonight's colours come from the NIJ standard

The plan was a "haldi test" profile with bands derived from our own photos of
real reactions. No such photos (and no physical samples) were available for
the submission, and colours are never typed from memory. The published source
closest to the problem statement is **NIJ Standard-0604.01** (US Department
of Justice, 2000, public domain), whose Table 1 gives the final colour of each
field-test reagent with each drug in Munsell notation. The Marquis reagent
(A.5) is the usual kit reagent for heroin, morphine and codeine (rows marked
`*`), and it is colourless before it reacts, so "no colour" can mean NEGATIVE.

How the numbers were made (`scripts/build-kit-profile.ts`):

- Munsell notations parsed from the saved excerpt
  `docs/references/nij-0604.01-excerpt.txt` (PDF SHA-256 `7a0faa66…dcd3`).
- Munsell → xyY: exact rows of the RIT renotation data
  (`docs/references/munsell/real.dat`, illuminant C), Y × 0.975 (MgO → perfect
  diffuser, as the RIT page advises). No interpolation.
- Bradford C → D65 (matrix and C white from
  `docs/references/bradford-lindbloom-excerpt.txt`), CIELAB with the app's D65
  white. Cross-check against colour-science 0.4.7: largest difference 0.005
  ΔE00 over 22 notations.
- Radius = largest ΔE00 to the neighbouring hue (±2.5) and chroma (±2) chips
  (NIJ §4.6 matches on hue and saturation) + the median leave-one-out
  correction error of the 3 real photos that pass the card stage and were not
  used to build the reference (3.96). Heroin 7.91, morphine 8.23, codeine 9.81.
  (User decision, 2026-09-28; the alternative with value neighbours gave
  11.4-12.7 and put aspirin and Exedrine inside the heroin radius.)
- Opium (10R 3/2) was **excluded**: Dristan (5R 3/2) is 2.5 ΔE00 from it and
  sugar overlaps it.
- Known false positives inside a POSITIVE radius: **chlorpromazine** (4.8 from
  morphine) and **propoxyphene** (6.0 from codeine). Presumptive colour tests
  have such false positives; that is why the result must be confirmed in a
  laboratory.

Marquis is colourless before it reacts: the NIJ formula (appendix A.5) is
concentrated sulfuric acid with formaldehyde solution, and Wikipedia's
"Marquis reagent" article states the reagent is "initially clear and
colorless" (secondary source, no reference given there; retrieved
2026-09-28). The UNODC manual *Rapid Testing Methods of Drugs of Abuse* was
fetched but is a scanned PDF with no searchable text, so it could not be
quoted tonight.

## How a forensic laboratory would validate a profile

The published colours were judged by eye against Munsell chips, in 2000, not
through this app, this card or these phones. To make a profile
`validated-on-real-photos`:

1. Register the laboratory's printed cards (daylight, flat, exposure lock).
2. React known standards with the kit (each target drug at several amounts
   around the detection limit, and each listed non-target), read at the
   profile's reading time.
3. Photograph every reaction on the card with this app in data collection
   mode, on several phone models and under the lights officers meet (daylight,
   tube, warm bulb), 5+ replicates each (NIJ §4.6 uses five).
4. From the corrected colours, set each target to the measured centre and each
   radius to the measured spread (e.g. the 95th percentile distance of the
   replicates), check that non-targets fall outside, and derive INCONCLUSIVE
   bands from the overlap. Record the photo set in `provenance`.
5. Publish it as a new profile version; records keep citing the version they
   were made with.

## Adding a kit whose negative has a colour (e.g. haldi)

A haldi (turmeric) stain stays yellow when negative and turns red-brown with an
alkaline solution. Such a kit has two coloured outcomes:

- `outcomes`: `NEGATIVE` with the yellow target(s) and `POSITIVE` with the
  red-brown target(s), each with a radius from the measured spread of real
  photos;
- `noColourResult: "RETAKE"` (no colour means the test is missing, not
  negative), so the in-zone tick is not needed;
- a colour between or outside both → INCONCLUSIVE, automatically.

Build it with a script like `build-kit-profile.ts` but taking the centres and
spreads from real photos (data collection mode, new tags), not from a table,
and set `validation` to `validated-on-real-photos` only when those photos
exist.
