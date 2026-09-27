# Field Test Companion (SIH26231)

A phone web app for Narcotics Control Bureau field officers that works alongside
existing colour-change drug-test kits. The officer stands the reacted test on a
printed **reference colour card**, photographs it through the app, and the app
corrects the colours using the card and reads the reaction colour. The output is
a **presumptive field result**; it never replaces laboratory confirmation.

Problem statement: [docs/problem_statement.md](docs/problem_statement.md).

- Static PWA, TypeScript + Vite. No backend, no server calls, no API keys.
  Works offline after the first load. Photos never leave the phone.
- No machine learning in the decision path: deterministic maths only.

## Commands

```bash
npm install
npm run dev:https      # LAN HTTPS dev server for camera checks on a phone (self-signed; no offline)
npm test               # unit tests (Node)
npm run test:browser   # pixel-contract tests in real Chromium (installed Edge on Windows)
npm run test:e2e       # built app + fake camera: data collection, export, hash checks
npm run typecheck      # app, no-DOM pipeline, Node scripts
npm run mat            # regenerate the printable reference colour card into print/
npm run build          # production build into dist/
```

Deployment: pushing to `main` runs `.github/workflows/deploy.yml`, which tests,
builds with the `/drugtest/` base path (set in `vite.config.ts`) and deploys to
GitHub Pages at https://tiankari.github.io/drugtest/.

Print the card: [print/PRINT_INSTRUCTIONS.md](print/PRINT_INSTRUCTIONS.md).
Developer notes: [CLAUDE.md](CLAUDE.md).
