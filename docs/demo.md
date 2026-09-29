# Demo guide

Live app: https://tiankari.github.io/drugtest/ (open it once online; it then
works offline, samples included). Everything it shows is a **presumptive
field result**, never a laboratory confirmation.

## A. Two-minute walkthrough for an evaluator (no card needed)

Works on a phone or a laptop (on a laptop the app shows as a phone-width
column). Every result below is computed by the real pipeline from the image's
pixels at that moment; nothing is hard-coded.

1. **Open the link.** The Welcome screen says what the app does in one line
   and offers **Start a test (needs the printed card)** and **Try with sample
   images**. Tap **How it works** for the five steps (30 seconds).
2. **Try with sample images.** Five samples, each labelled *Real photo* or
   *Computer-drawn image*, with the kit it is read with and what we expect:
   - **Empty card** (real photo) → **NEGATIVE**: no colour developed.
   - **Orange cap, not a drug-test colour** (real photo) → **INCONCLUSIVE**:
     the colour matches none of the kit's reaction colours.
   - **Opiate-type colour** (computer-drawn; no real reaction was
     photographed) → **POSITIVE**: matches the published colour of the
     Marquis reaction with heroin.
   - **Methamphetamine-type colour** (computer-drawn, read with the
     **Mandelin** kit) → **POSITIVE**: matches the published colour of the
     Mandelin reaction with methamphetamine. The same colour would mean
     nothing with the Marquis kit: the reagent decides what a colour means.
   - **Blurred photo** (real photo) → **RETAKE**, "Hold steady": the app
     refuses a bad photo instead of guessing.
   Each result shows the test colour next to the kit's colours and the area
   the app read on the straightened card. **Technical details** (collapsed)
   holds every number. How it works lists the two kits and the eight drugs
   they read (Marquis: heroin, morphine, codeine, oxycodone, mescaline;
   Mandelin: cocaine, amphetamine, methamphetamine).
3. **Save one.** On the POSITIVE sample, type any officer ID (e.g.
   `EVALUATOR-1`), optionally a case reference, and tap **Save sealed
   record**. The saved test opens with three checks: ✓ Not changed since it
   was saved, ✓ Nothing removed or inserted before it, ✓ Photo is the
   original. It is marked **Sample**.
4. **Log.** The saved test is listed with a Sample badge. Tap **Check log**:
   "✓ 1 saved test: not changed, nothing removed or inserted, photo
   original."
5. **See tamper detection.** The app copies the log in memory, changes one
   record's result in the copy, and runs the same check on the copy: it shows
   ✗ Not changed since it was saved at record 0 (and ✗ Nothing removed or
   inserted before it at record 1, if there are two), next to the real log,
   which still passes — "Your real log was not changed."

## B. Walkthrough for an officer (with the printed card)

Only these conditions produced accepted photos on real phones
(`docs/validation/mat_v1.md`): **Nothing Phone (3a)**; **daylight near a
window or a tube light** (not a warm bulb, not the phone torch); the
registered card **A or B flat on a plain table**, no hand or phone shadow,
filling the on-screen outline.

1. **Start a test** → type your officer ID once (saved; change it in
   Settings). Allow location when asked; if refused, saved tests say so.
2. The camera screen shows three steps: **1. Put the test in the white
   square. 2. Fit the card in the frame. 3. Hold still and tap Capture.** It
   also shows **Kit used** (Marquis first; choose Mandelin if that is the kit
   you used), what the kit reads, its line (colours from NIJ
   Standard-0604.01, not yet checked against a real reaction) and the
   location accuracy. The guidance says **Ready — tap to capture** when the
   card is found, sharp and evenly lit.
3. **Empty white square → NEGATIVE.** The app cannot tell a colourless test
   from an empty square, so the officer must tick **The test is in the white
   square** before saving (for a demo, say out loud that the square is
   empty).
4. **Orange cap in the square → INCONCLUSIVE**, with its colour next to the
   kit's colours. An object that is raised, wide or shiny can give a
   **Retake** instead: the Retake screen says what the app saw and where
   (for example "the small white patch on the left edge (beside the lower
   corner of the white square) looks darker than the other white patches",
   or "Shine in the white square"), and what to try. Keep it flat and inside
   the white square.
   With the **Mandelin** kit an empty square is a Retake, never NEGATIVE (no
   source says the reagent is colourless).
5. **Save sealed record** with a case reference; the saved test opens with
   its three checks. The **Log** lists it; **Check log** passes.
6. **Log → Advanced → Log code to write down**: the short code that should go
   into the case diary. Deleting the newest saved tests is only detectable by
   comparing with a code written down earlier (**Compare**).
7. **Download log (for the lab)**, then run the file check below on a laptop.

**POSITIVE on a real card is not possible yet**: no real Marquis or Mandelin
reaction has been photographed with this app. POSITIVE is shown only from the labelled
computer-drawn sample (and the synthetic tests). **No stand-in object may be
used to fake a POSITIVE** in a demo.

Photo collection for the team (Settings → Developer tools) must be **off** for
a demo; while it is on, a banner on every screen says so, with **Turn off**.

## C. Checking a downloaded log on a computer (tamper demo)

1. Download the log from the app (Log → Download log (for the lab)) and copy
   the .zip to a laptop with this repository.
2. Check it untouched:

   ```
   node scripts/verify-log.ts fdtc_log_<time>.zip --noted <log code from the app>
   ```

   Output on an app export from the end-to-end test (2 records):

   ```
   Records: 2; public key b26731426bbf…62a8f07; latest hash 2d938457ac0a…40c2ae6a
   PASS  all 2 records: hashes, signatures, chain links and photos
   ```

3. Unzip it, open `records.jsonl` in a text editor, change one
   `"verdict":"POSITIVE"` to `"verdict":"NEGATIVE"`, save, and run the script on
   the folder (or re-zip it). Real output for exactly that edit on record 0:

   ```
   FAIL  record 0 (80e04dc3-…): stored hash does not match the record (the record was changed)
   FAIL  record 0 (80e04dc3-…): signature does not verify with this log’s public key
   FAIL  record 1 (c2afb6b9-…): prevHash does not match record 0 (a record was removed, inserted, reordered or changed)
   FAIL  2 problem(s)
   ```

   Re-computing the `hash` field by hand does not help: the signature still
   fails, and it can only be made on the phone that holds the private key.
4. Delete the **last** line of `records.jsonl` instead: the chain alone still
   passes (a shorter chain is a valid chain), but `--noted <the code you wrote
   down>` fails with "The noted hash is not in this log: records after it were
   deleted, or the note is wrong". This is why the log code must be written
   down outside the phone.
5. Optional: `--reanalyse` re-runs the full analysis on every exported photo
   with the bundled profiles and reports whether each verdict matches. On a
   demo export of the 9 accepted real photos (`node scripts/make-demo-export.ts`,
   written to the git-ignored `incoming/`) all 9 verdicts matched with a
   largest numeric difference of 0 (Node against Node); on records the app
   computed in Chromium, Node matched both verdicts with a largest difference
   of 1.7 × 10⁻¹³ (end-to-end test).
