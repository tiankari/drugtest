# Field Test Companion (SIH26231)

**Digital Companion for Field Drug Testing** — Smart India Hackathon,
Ministry of Home Affairs.

A phone web app that works alongside the colour-change field kits already in
use (no new hardware). The officer stands the reacted test on a printed
**reference colour card**, photographs it through the app, and the app turns
that photo into a result the officer can defend:

- **Reads the colour, not the officer's eye.** The card's known patches
  correct the photo for light, white balance and exposure before the reaction
  colour is read.
- **Classifies, never guesses.** POSITIVE / NEGATIVE / INCONCLUSIVE against a
  versioned kit profile. Anything uncertain comes back as **Retake** with the
  reason, where the app saw it, and what to try.
- **Leaves evidence.** Every test becomes a signed, hash-chained record
  (timestamp, GPS, operator ID, SHA-256 of the photo) in a searchable,
  exportable log that an independent verifier can check on any computer.

**The output is a presumptive field result; it never replaces laboratory
confirmation.**

## Try it now

**Evaluators without the printed card:** open
https://tiankari.github.io/drugtest/ and tap **Try with sample images** — five
labelled samples (real photos and computer-drawn images) run through the real
pipeline: a NEGATIVE, an INCONCLUSIVE, two POSITIVES on different kits, and a
blurred photo the app refuses with **Retake**. The two-minute walkthrough,
including saving a record and a live tamper demonstration, is in
[docs/demo.md](docs/demo.md).

**With the card:** print it ([print/PRINT_INSTRUCTIONS.md](print/PRINT_INSTRUCTIONS.md)),
then Start a test and follow the three on-screen steps.
Open the link once online; the app then works fully offline.

## How a test works

1. **Capture** — the card and the test are photographed through the live
   camera. The app checks the card is found, sharp and evenly lit, and
   corrects the photo's colours against the card's known patches.
2. **Read** — the reacted zone is measured: coloured region found, its colour
   compared to the kit's published reaction colours.
3. **Classify** — the colour is matched against the selected kit's profile;
   no match or two possible matches is INCONCLUSIVE, not a guess.
4. **Record** — POSITIVE / NEGATIVE / INCONCLUSIVE is sealed into a signed,
   hash-chained record and shown in a searchable log.

Two kits are offered, with colours from **NIJ Standard-0604.01**:

| Kit | Screens for |
|---|---|
| Marquis (v2) | heroin, morphine, codeine, oxycodone, mescaline |
| Mandelin (v1) | cocaine, amphetamine, methamphetamine |

## Why the record can be trusted

- Records are signed on the phone with a non-extractable ECDSA P-256 key
  (WebCrypto) and chained by hash, so a saved record cannot be changed and
  none can be removed or inserted unnoticed.
- **Independent verification:** export the log and check it on any computer —
  `node scripts/verify-log.ts <export.zip> --noted <log code> --reanalyse`
  re-checks every hash, signature, chain link and photo, and can re-run the
  full image analysis to confirm each verdict. The tamper demo in
  [docs/demo.md](docs/demo.md) shows a real edit being caught.
- **No machine learning anywhere in the decision path** — deterministic
  maths only: same pixels and same profiles in, same verdict out.
- **Private and offline:** a static PWA with no backend, no server calls, no
  API keys. Photos and records never leave the phone except by the user's own
  export.

## Honest status (read before evaluating)

- The kit colours come from the published NIJ table
  (`validation: "published-reference-only"`); they are **not yet checked
  against a real reaction photographed with this app**. POSITIVE has only been
  exercised on labelled synthetic images, and every screen says so on the
  line *"colours from NIJ Standard-0604.01, not yet checked against a real
  reaction with this app."*
- What **has** been verified on real photos (19 captures, 2 phones): the
  pixel contract, card detection, the correction stage, sample-zone reading,
  and that bad photos are refused. Generated reports live in
  [docs/validation/](docs/validation/); no result is ever hard-coded.
- A real deployment needs a forensic laboratory to photograph real reactions
  and replace the profile numbers ([docs/kit_profiles.md](docs/kit_profiles.md)).

## Documentation

| Doc | What it covers |
|---|---|
| [docs/problem_statement.md](docs/problem_statement.md) | Official problem statement, saved verbatim |
| [docs/demo.md](docs/demo.md) | Evaluator walkthrough (no card), officer walkthrough, tamper demo |
| [docs/kit_profiles.md](docs/kit_profiles.md) | Both kit profiles: colours, radii, provenance |
| [docs/records.md](docs/records.md) | Record format, signatures, hash chain, what each check proves |
| [docs/pixel_contract.md](docs/pixel_contract.md) | How images are captured, encoded and hashed |
| [docs/mat_v1.md](docs/mat_v1.md) | The reference card: geometry and design colours |
| [docs/validation/](docs/validation/) | Generated validation reports on real photos |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Developer guide: architecture rules, module map, conventions |

## Development

```bash
npm install
npm run dev:https           # LAN HTTPS dev server for camera checks on a phone (self-signed)
npm run typecheck           # app, no-DOM pipeline, Node scripts
npm test                    # unit tests (Node)
npm run test:browser        # pixel-contract tests in real Chromium
npm run test:e2e            # built app + fake camera: data collection, export, hash checks
npm run test:e2e:result     # built app + fake camera: capture → verdict → signed record → export → verification
npm run test:e2e:evaluator  # real build, no card, phone + laptop: the evaluator path end to end
npm run test:offline        # deployed site with the network cut (add -- --mobile for phone emulation)
npm run mat                 # regenerate the printable reference card into print/
npm run build               # production build into dist/
```

Useful scripts: `node scripts/register-mat.ts` (registration photos → card
reference), `node scripts/validate-mat.ts`, `validate-sample.ts`,
`validate-kit.ts` (regenerate the reports in `docs/validation/` from
`data/real/`), `node scripts/build-kit-profile.ts --kit=marquis|mandelin`,
`node scripts/verify-log.ts` (check an exported log),
`node scripts/make-samples.ts` (rebuild the bundled samples).

## Deployment

Pushing to `main` runs `.github/workflows/deploy.yml`, which tests, builds
with the `/drugtest/` base path (set in `vite.config.ts`) and deploys to
GitHub Pages at https://tiankari.github.io/drugtest/.
