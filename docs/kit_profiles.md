# Kit profiles

A kit profile says which colours mean what for one field-test kit. It is data
(`profiles/kit_*.json`), bundled into the app at build time
(`src/ui/kits.ts`), validated on load (`parseKitProfile`), and cited in every
record by id, version and SHA-256 of its canonical JSON. The decision rule is
generic code (`src/pipeline/kit.ts#classify`); nothing in the code knows about
any particular kit.

The same colour means different drugs with different reagents, so the
officer picks the kit they used on the camera screen ("Kit used"; the Marquis
kit is the default). Each bundled sample image names the kit it is read with.

| Profile | Name | Reads | Shown as |
|---|---|---|---|
| `kit_marquis_opiates_v2.json` (offered) | Marquis reagent — opiate and mescaline screen | heroin, morphine, codeine, oxycodone, mescaline | *"Marquis opiate and mescaline screen — colours from NIJ Standard-0604.01, not yet checked against a real reaction with this app"* |
| `kit_mandelin_stimulants_v1.json` (offered) | Mandelin reagent — cocaine and amphetamine screen | cocaine, amphetamine, methamphetamine | *"Mandelin cocaine and amphetamine screen — colours from NIJ Standard-0604.01, not yet checked against a real reaction with this app"* |
| `kit_marquis_opiates_v1.json` (kept) | Marquis reagent — opiate screen | heroin, morphine, codeine | not offered; kept because records made with it cite it and the verifier re-runs each record with the version it cites |

The app offers only the newest version of each kit id (`latestVersions`);
`scripts/lib/kits.ts#loadKits` loads every version for the verifier.
Validation reports: `docs/validation/kit_marquis_v2.md`,
`docs/validation/kit_mandelin_v1.md` (and `kit_marquis_v1.md` for v1).

## Format (schema `fdtc.kit.v1`)

| Field | Meaning |
|---|---|
| `id`, `version`, `name` | identity (a changed colour, radius or target list means a new version) |
| `reagent`, `detects` | what the kit is and what it screens for |
| `validation` | `published-reference-only` or `validated-on-real-photos` |
| `validationLine` | the plain sentence shown wherever the profile is used |
| `source` | document, table, the exact rows used, URL, SHA-256 of the PDF, path of the saved excerpt |
| `colourConversion` | how the source colours became CIELAB (data, Y scale, adaptation, cross-check) |
| `outcomes[]` | per coloured outcome (`POSITIVE`, or `NEGATIVE` for kits whose negative has a colour): `targets[]` with `label`, source `notation`, `sourceName`, `sourceRow`, `lab` (CIELAB, D65), `radius` (CIEDE2000) and `radiusDerivation` (rule, chip term, the chips used, correction-error term) |
| `noColourResult` | what "no coloured region in the zone" means: `NEGATIVE` (reagent colourless when nothing reacts) or `RETAKE` (a kit whose negative has its own colour, or whose reagent is not known to be colourless) |
| `noColourNote`, `noMatchReason` | plain words for those cases (the Retake screen shows `noColourNote`) |
| `readingTime` | when the colour is final (within 1-2 min, NIJ §3.3) |
| `sampleReading` | the sample-zone limits in force when the profile was built |
| `knownNonTargetReactions[]` | other substances in the source table, their colour, nearest target, distance, and whether they fall inside a POSITIVE radius (known false positives); rows left out as targets say so and why |
| `provenance` | script, commit, options, `leftOut` (each usual-reagent row not made a target, with the reason), the real photos used for the correction-error term |
| `status` | one line on how thin the evidence is |

## Decision rule

1. A card or sample-zone RETAKE is never classified.
2. No coloured region → `noColourResult` (RETAKE reason: "No coloured region
   — this kit does not read “no colour” as NEGATIVE…").
3. Otherwise d = ΔE00(corrected sample, each target). Exactly one outcome with
   a target within its radius → that outcome, naming the nearest such target.
   None → INCONCLUSIVE (`noMatchReason`). More than one outcome →
   INCONCLUSIVE.

Same pixels and same profiles in, same verdict out.

## How the numbers are made

No photos of real reactions (and no physical samples) were available, and
colours are never typed from memory. The published source closest to the
problem statement is **NIJ Standard-0604.01** (US Department of Justice,
2000, public domain), whose Table 1 gives the final colour of each field-test
reagent with each drug in Munsell notation; a `*` marks the usual kit reagent
for that drug.

`node scripts/build-kit-profile.ts --kit=<marquis|mandelin>` (analysis, into
`incoming/kit_<name>_draft.md`) and `--write` (the profile):

- Munsell notations parsed from the saved excerpt
  `docs/references/nij-0604.01-excerpt.txt` (PDF SHA-256 `7a0faa66…dcd3`):
  the Table 1 block of the kit's reagent (A.5 Marquis, A.4 Mandelin).
- Munsell → xyY: exact rows of the RIT renotation data
  (`docs/references/munsell/real.dat`, illuminant C), Y × 0.975 (MgO → perfect
  diffuser, as the RIT page advises). No interpolation.
- Bradford C → D65 (matrix and C white from
  `docs/references/bradford-lindbloom-excerpt.txt`), CIELAB with the app's D65
  white. Cross-check against colour-science 0.4.7: largest difference
  0.005 ΔE00 over the 22 Marquis notations, 0.006 over the 26 Mandelin ones.
- Radius = largest ΔE00 to the neighbouring hue (±2.5) and chroma (±2) chips
  (NIJ §4.6 matches on hue and saturation) + the median leave-one-out
  correction error of the 3 real photos that pass the card stage and were not
  used to build the reference (3.96). User decision, 2026-09-28; the
  alternative with value neighbours gave 11.4-12.7 and put aspirin and
  Exedrine inside the heroin radius.
- Which rows are targets, and why each other `*` row is left out, is written
  in the kit spec in the script (it refuses a `*` row that is neither); the
  analysis shows, for every left-out row, what would fall inside its radius.

Presumptive colour tests have known false positives; that is why the result
must be confirmed in a laboratory.

### Marquis v2 (2026-09-29): five drugs

Heroin 7.91, morphine 8.23, codeine 9.81 (exactly v1), **oxycodone** (2.5P
6/4, pale violet) 9.89, **mescaline** (5YR 6/12, strong orange) 10.48.
Oxycodone and mescaline add no known false positive; chlorpromazine (4.8
from morphine) and propoxyphene (6.0 from codeine) remain the only ones.

Left out:

- **opium** (10R 3/2): Dristan 2.5 away, doxepin and sugar inside its radius
  (user decision, 2026-09-28);
- **benzphetamine** (7.5R 2/6): the amphetamine/methamphetamine end colour is
  4.4 away, so those would be named as benzphetamine;
- **d-amphetamine, d-methamphetamine**: the table gives a range (orange to
  dark reddish brown), not one final colour; a radius around the dark end
  (7.5R 2/4, 10.50) takes in doxepin (6.5), sugar (9.3) and Dristan (9.6);
- **MDA**: no Munsell notation ("Black").

Marquis is colourless before it reacts: the NIJ formula (appendix A.5) is
concentrated sulfuric acid with formaldehyde solution, and Wikipedia's
"Marquis reagent" article states the reagent is "initially clear and
colorless" (secondary source, no reference given there; retrieved
2026-09-28). So "no colour" is NEGATIVE, with the officer's tick that the
test is in the white square.

### Mandelin v1 (2026-09-29): cocaine and the amphetamines

Reagent A.4: 1.0 g ammonium vanadate in 100 mL concentrated sulfuric acid.
**Cocaine** (10YR 7/14, deep orange yellow) 9.57, **amphetamine** (5BG 5/6,
moderate bluish green) 8.70, **methamphetamine** (10GY 4/6, dark yellowish
green) 9.47. Known false positives (cocaine): **brompheniramine** (an
antihistamine, 5.6) and **methaqualone** (7.0). Salt reacts with this
reagent (NIJ Table 3), strong orange, 13.0 from cocaine: outside.

Left out: heroin (close to doxepin and propoxyphene, just outside), morphine
and opium (their radii take in doxepin and propoxyphene), codeine (exactly
chlorpromazine's colour; Exedrine and Dristan inside), mescaline (takes in
opium and Exedrine): opiates and mescaline are read with the Marquis kit.
Benzphetamine: not a drug this kit is for.

**No colour is RETAKE, never NEGATIVE**: no saved source says the reagent is
colourless before it reacts. A test that keeps a colour that is none of the
kit's colours reads INCONCLUSIVE.

Findings of the synthetic check (`docs/validation/kit_mandelin_v1.md`,
rendered images only):

- Cocaine's published colour is outside sRGB (what a screen or print can
  show): rendered clipped, it reads 5.8 from its target, still inside 9.6.
  A real cocaine reaction may read less saturated than the published colour.
- **Mace** (tear gas, 5GY 4/8) is 12.2 from methamphetamine by the published
  colours, but its rendered colour is clipped and the correction reads it 7.3
  away, inside 9.5: on the synthetic check it reads POSITIVE
  methamphetamine. The card has no patch that saturated in yellow-green.
- Brompheniramine and methaqualone read POSITIVE cocaine, as expected.

## How a forensic laboratory would validate a profile

The published colours were judged by eye against Munsell chips, in 2000, not
through this app, this card or these phones. To make a profile
`validated-on-real-photos`:

1. Register the laboratory's printed cards (daylight, flat, exposure lock).
2. React known standards with the kit (each target drug at several amounts
   around the detection limit, each listed non-target, **and the unreacted
   reagent on its own**), read at the profile's reading time.
3. Photograph every reaction on the card with this app in photo collection
   mode, on several phone models and under the lights officers meet
   (daylight, tube, warm bulb), 5+ replicates each (NIJ §4.6 uses five).
4. From the corrected colours, set each target to the measured centre and each
   radius to the measured spread (e.g. the 95th percentile distance of the
   replicates), check that non-targets fall outside, and derive INCONCLUSIVE
   bands from the overlap. Record the photo set in `provenance`. For Mandelin,
   the unreacted reagent's own colour decides whether "no colour" can become
   a coloured NEGATIVE outcome.
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
spreads from real photos (photo collection mode, new tags), not from a table,
and set `validation` to `validated-on-real-photos` only when those photos
exist.
