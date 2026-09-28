# Field Test Companion (SIH26231)

A phone web app for Narcotics Control Bureau field officers that works alongside
existing colour-change drug-test kits. The officer stands the reacted test on a
printed **reference colour card**, photographs it through the app, and the app
corrects the colours using the card, reads the reaction colour, classifies it
POSITIVE / NEGATIVE / INCONCLUSIVE against a versioned kit profile, and saves a
signed, hash-chained record (time, GPS, operator ID, SHA-256 of the photo) in a
searchable log that can be exported and checked independently. The output is a
**presumptive field result**; it never replaces laboratory confirmation.

The only kit profile is the **Marquis opiate screen** (heroin, morphine,
codeine), with colours from NIJ Standard-0604.01, **not yet checked against a
real reaction with this app**; POSITIVE has been tested on synthetic images
only. See [docs/session2_handoff.md](docs/session2_handoff.md) for the evidence
and [docs/demo.md](docs/demo.md) for the demo and the tamper demo.

**Evaluators without the printed card:** open https://tiankari.github.io/drugtest/
and tap **Try with sample images**; the two-minute walkthrough is in
[docs/demo.md](docs/demo.md).

Problem statement: [docs/problem_statement.md](docs/problem_statement.md).

- Static PWA, TypeScript + Vite. No backend, no server calls, no API keys.
  Works offline after the first load. Photos never leave the phone.
- No machine learning in the decision path: deterministic maths only.
- Records are signed with a non-extractable ECDSA P-256 key per device (WebCrypto).

## Commands

```bash
npm install
npm run dev:https      # LAN HTTPS dev server for camera checks on a phone (self-signed; no offline)
npm test               # unit tests (Node)
npm run test:browser   # pixel-contract tests in real Chromium (installed Edge on Windows)
npm run test:e2e       # built app + fake camera: data collection, export, hash checks
npm run test:offline   # deployed site with the network cut: reload, capture, export, card PDF
                       # (add -- --mobile for Pixel 7 emulation with a portrait camera)
npm run test:e2e:evaluator  # real build, no card, phone + laptop: welcome, samples, save, log, tamper detection, jargon scan
npm run test:e2e:result  # built app + fake camera, synthetic card with a coloured test and a TEST-ONLY kit:
                         # capture -> verdict -> signed record -> log -> export -> independent verification
npm run typecheck      # app, no-DOM pipeline, Node scripts
node scripts/register-mat.ts   # registration photos -> profiles/mat_reference_1_<copy>.json
node scripts/validate-mat.ts   # every real photo -> docs/validation/mat_v1.md
node scripts/validate-sample.ts  # sample-zone reader on real photos -> docs/validation/sample_zone_v1.md
node scripts/build-kit-profile.ts  # NIJ + Munsell data -> Marquis profile analysis (--write to regenerate)
node scripts/validate-kit.ts   # the kit on real photos + synthetic colours -> docs/validation/kit_marquis_v1.md
node scripts/verify-log.ts <export.zip> [--noted <hash>] [--reanalyse]   # check an exported log
npm run mat            # regenerate the printable reference colour card into print/
npm run build          # production build into dist/
```

Deployment: pushing to `main` runs `.github/workflows/deploy.yml`, which tests,
builds with the `/drugtest/` base path (set in `vite.config.ts`) and deploys to
GitHub Pages at https://tiankari.github.io/drugtest/.

Print the card: [print/PRINT_INSTRUCTIONS.md](print/PRINT_INSTRUCTIONS.md).
Developer notes: [CLAUDE.md](CLAUDE.md).
