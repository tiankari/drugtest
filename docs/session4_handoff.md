# Session 4 handoff (2026-09-29): clearer Retakes, five Marquis drugs, a Mandelin kit

Live app: https://tiankari.github.io/drugtest/ (not redeployed until the
user says push). Rollback to Session 3 in one command:
`git checkout session3-good` (tag on 421f5fd).

## Why

The user asked three things after trying the app with objects on the card:

1. Why does it say Retake, blaming the light, when the light looks fine?
2. Should it not at least show the colour of the object?
3. Only three drugs (heroin, morphine, codeine): can there be more?

The user's decision: "do all three" of the proposals (clearer Retake
messages with the marked-up card; the Marquis kit with five drugs; a
Mandelin kit).

## What did NOT change

The colour pipeline, every threshold, the radius rule, the classification
rule (one reason string for "no colour" kits aside), signing and
verification. The v1 Marquis profile is unchanged and kept.

## 1. Why objects give "lighting" Retakes (the answer, with evidence)

The light checks do not measure the room; they check whether the card's own
white and colour squares look consistent. The side columns of squares are
2.5 mm from the white square, and 3 of the 6 white patches sit at its
corners, so an object's shadow, its side seen at an angle, or its shine
changes them. The real "lighting" photos all have an orange-red cap in the
white square (a correction of the first answer given in chat, which called
them empty-card photos): 2 of 8 pass; of the 6 refused, the OnePlus torch
photo was glare **in the white square** (the glossy cap), both warm-bulb
photos have the darkest white patch **beside the white square's lower-left
corner** (the cap's shadow, as Session 1 noted), OnePlus daylight is uneven
light with a bottom-row white patch darkest (not beside the white square),
and two fail the correction check (Nothing torch, OnePlus tube).

What changed (`src/ui/plain.ts#retakeAdvice`, `src/ui/result-screen.ts`):

- New card-stage message "Glare in the white square — tilt the phone" when
  the white square, not a colour square, is the most blown out (live
  guidance says it too).
- The Retake screen gives one sentence of what the app saw and a short list
  of what to try. Uneven light names the white patch that is darkest after
  the smooth gradient is removed and says when it is beside the white square.
- Correction failures name no place: on the real photos the worst squares
  are the dark greys whatever the cause (checked; a "beside the white square"
  hint would have been right about half the time by chance).
- When the white square was read but refused (two areas, too small, shine on
  the test, patchy), the marked-up card is shown; Technical details show the
  colour that was read, labelled "refused, not a result". Marked areas have a
  solid edge so they show on any colour.

## 2. Showing the colour

Unchanged in substance: when the card checks pass and one colour is read,
the result (INCONCLUSIVE for a colour that matches nothing) shows "Your
test" next to every kit colour, each marked "not a match". A Retake still
shows no colour on the main screen: it means the colours cannot be trusted.

## 3. More drugs: 3 → 8, in two kits

| Kit | Reads | Known false positives | No colour |
|---|---|---|---|
| Marquis v2 (default) | heroin, morphine, codeine, **oxycodone**, **mescaline** | chlorpromazine, propoxyphene (as v1) | NEGATIVE (with the officer's tick) |
| **Mandelin v1** (new) | cocaine, amphetamine, methamphetamine | brompheniramine, methaqualone (cocaine) | RETAKE (no source says the reagent is colourless) |

Details, left-out rows and reasons: `docs/kit_profiles.md`. The officer
chooses "Kit used" on the camera screen (Marquis first); the test bar says
what the kit reads; How it works lists both kits; a camera result says which
kit it was read as when more than one kit exists. Each sample names its kit
(new sample: "Methamphetamine-type colour", computer-drawn, Mandelin).

## Evidence

Real photos (19 captures, 2 phones; no real reaction of any reagent):

- Marquis v2 (`docs/validation/kit_marquis_v2.md`): empty zones NEGATIVE
  (6), cap INCONCLUSIVE (3; nearest mescaline 24-28 vs radius 10.5), card
  Retakes never classified (10).
- Mandelin v1 (`docs/validation/kit_mandelin_v1.md`): empty zones RETAKE (6,
  as designed), cap INCONCLUSIVE (3; nearest cocaine), card Retakes (10).
- Retake advice on the real photos: as in section 1.

Synthetic only:

- Every target of both kits reads POSITIVE on rendered cards; Marquis
  non-targets: only chlorpromazine and propoxyphene POSITIVE.
- Mandelin: cocaine's published colour is outside sRGB and reads 5.8 from
  its target (inside 9.6); **Mace (tear gas) reads POSITIVE
  methamphetamine** (published 12.2 away, read 7.3 inside 9.5: the card has
  no patch that saturated in yellow-green); brompheniramine and methaqualone
  POSITIVE cocaine, as expected.
- Wrong kit left selected (published colours only): Marquis reaction colours
  read with the Mandelin kit are all INCONCLUSIVE; Mandelin colours read with
  the Marquis kit give two POSITIVE mescaline (salt, procaine).
- Suites, all green: 251 unit, 8 browser, data collection e2e 35, test flow
  e2e 52 (adds the kit-used line), evaluator e2e 113 (five samples each with
  its kit, both kits on How it works, the labelled kit picker), offline on a
  local build with Pixel 7 emulation (precache 4.41 MB, samples 4.02 MB).

## Steps

| Step | Merge |
|---|---|
| 0 Baseline; tag `session3-good` = 421f5fd | — |
| 1 Retake advice, glare in the white square, marked card on refusals | b601ab5 |
| 2 Kit builder for any NIJ reagent block; Marquis v2; newest version per kit | 952d11b |
| 3 Mandelin kit, samples bound to kits, kit-used line | ecf8c4d |
| CLOSE (docs) | see git log |

Not pushed: the live app still runs Session 3 until the user says push.

## Known issues

1. No real reaction with either reagent has been photographed; POSITIVE is
   synthetic only, for all eight drugs.
2. Mandelin never says NEGATIVE; its unreacted colour is unknown.
3. Mace inside methamphetamine on the synthetic check; salt and procaine
   read as mescaline if a Mandelin test is read with the Marquis kit left
   selected (the result says which kit it was read as).
4. The kit picker truncates the long kit names on a narrow phone.
5. Five samples add about 4.0 MB to the first (online) load.
6. No Session 4 screen has run on a real phone (Pixel 7 emulation only).
7. All Session 3 and Session 2 known issues stand.
