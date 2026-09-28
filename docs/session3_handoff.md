# Session 3 handoff (2026-09-29): the app is understandable to an evaluator

Live app: https://tiankari.github.io/drugtest/. Rollback to Session 2 in one
command: `git checkout session2-good` (tag on ad78869).

## Why

The maker could not follow the Session 2 app on a real phone: it was still in
data collection mode (no result, empty log, nothing said why), team labels
looked like officer features, the empty log's code check said records were
deleted, Settings showed raw threshold names, and an evaluator with no printed
card saw nothing at all. Goal: an SIH evaluator with no card understands the
app in two minutes and can try every feature.

## What did NOT change

The colour pipeline, every threshold, the Marquis kit profile, the
classification rule, and the signing and verification logic. The only record
change is the optional `image.source` field. The real-photo evidence in
`docs/session2_handoff.md` and `docs/validation/` stands as it was.

## What changed

| Area | Now |
|---|---|
| Modes | Officer mode is the app. Photo collection (the old data collection mode) is a switch in Settings → **Developer tools** (collapsed, off by default): "For the team: saves test photos to improve the app. No results, no records." While it is on, a banner on **every** screen says so, with **Turn off**. Team tags have plain names ("Deliberately blurred photo (checks the app refuses it)"). On the first launch after the update a phone left in collection mode is switched off once, with a note saying where the switch now lives. |
| Samples | "No card? Try a sample" on Welcome, the Test screen, the ID form and the camera error. Four samples, each labelled: Empty card (real photo), Orange cap (real photo), Opiate-type colour (computer-drawn, no real reaction photographed), Blurred photo (real photo). Each runs through the same capture worker, pipeline and classification as a camera photo; the expected outcome is only a label. Real ones are cropped to the card (+2 mm), lossless, with sidecars naming the source file and its SHA-256; the user looked at all four before they were committed. Records may be saved from samples: `image.source`, Sample badge, "Samples only / Camera photos only" filter, no location, no in-zone tick. |
| Welcome / How it works | First launch opens Welcome: the one-line description, **Start a test (needs the printed card)**, **Try with sample images**, the prototype line. How it works: five numbered steps with inline SVG icons, the kit's status, the card and its PDF (each print is set up once), privacy, the build. |
| Log | Two plain lines on top ("like numbered pages in a register"); an empty log says what to do and shows nothing else; **Check log** reports in plain words; **See tamper detection** changes one result in an in-memory copy and runs the real verifier on it next to the real log, which is re-checked ("Your real log was not changed."); Advanced → **Log code to write down** with Compare messages right for every state; **Download log (for the lab)**. Record detail: "Not changed since it was saved", "Nothing removed or inserted before it", "Photo is the original"; codes under Technical details. |
| Plain words | Result sentences for non-scientists (numbers under Technical details, the sealed reason unchanged); three camera steps; plain live guidance and Retake reasons; a RETAKE shows only its reason and one button; threshold names in plain words in Developer tools; a jargon scan of the visible text of the main screens runs in the e2e tests (with a self-check that it catches jargon). |
| Laptop | The app is a centred phone-width column; the camera screen says a phone and the card are needed and points to the samples. |

## Evidence

- **Samples through the real pipeline** (`tests/unit/samples.test.ts`,
  `tests/e2e/evaluator.e2e.ts`): empty card → NEGATIVE, orange cap →
  INCONCLUSIVE, computer-drawn opiate colour → POSITIVE, blurred → RETAKE
  ("Hold steady"). All four as expected; nothing was tuned.
- **Evaluator path e2e** (87 checks, real build, fresh browser, no camera,
  Pixel 7 emulation and 1366 px laptop): welcome → How it works → samples →
  each result → save one → log → Check log passes → tamper detection fails the
  copy at record 0 → the real log still passes; the jargon scan finds nothing
  on welcome, How it works, samples, results, saved test, log, camera and
  settings.
- Existing suites green: 216 unit, 8 browser, data collection e2e (35 checks,
  incl. banner on every screen, Turn off and the one-time migration), test
  flow e2e (51), offline (local build, mobile): a sample runs with the network
  cut; precache 3.40 MB, of which samples 3.05 MB.
- **Not verified:** any Session 3 screen on a real phone (emulation only).

## Screenshots

`docs/audit/before/` (32 states, Session 2 app) and `docs/audit/after/` (43
states, Session 3 app), phone and laptop, computer-drawn cards only. The
before/after list and a decision with its after status for every screen
element: `docs/ux_audit.md`.

## Known issues

1. No Session 3 screen has been tried on a real phone yet.
2. The NEGATIVE sample is a registration photo of card A, one of the photos
   the reference was built from, so it is an easy case for the correction.
3. The POSITIVE sample is computer-drawn: a real Marquis reaction has still
   never been photographed with the app.
4. The samples add 3.05 MB to the first (online) load.
5. The RETAKE badge keeps the word RETAKE (the audit proposed "Retake photo").
6. All Session 2 known issues stand (`docs/session2_handoff.md`).

## For a demo

`docs/demo.md`: A (two minutes, no card), B (officer, with the card), C
(checking a downloaded log on a computer; the tamper demo).
