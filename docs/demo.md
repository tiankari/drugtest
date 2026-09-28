# Demo guide

Live app: https://tiankari.github.io/drugtest/ (open it once online; it then
works offline). Everything below is a **presumptive field result**, never a
laboratory confirmation.

## Demo conditions (from the Session 1 evidence)

Only these conditions produced accepted photos on real phones
(`docs/validation/mat_v1.md`):

- **Phone:** Nothing Phone (3a). OnePlus Nord 5 photos were mostly refused
  (colour correction error 6-8 ΔE00, over the limit of 5).
- **Light:** daylight near a window, or a tube light. Not a warm bulb, not the
  phone torch (glare, uneven light).
- **Card:** registered copy A or B, **flat on a plain table**, no hand or phone
  shadow across it, filling the on-screen outline (the camera needs about
  6-7 px/mm; "Move closer" below 4).
- Hold steady until the guidance says **Ready — tap to capture**.

## Step by step on a real phone

1. **Settings → Operator ID**: type an ID (e.g. `DEMO-01`). Say plainly that
   the app does not verify it.
2. **Test**: the screen shows the kit line *"Marquis reagent — opiate screen"*
   and, in amber, *"Marquis opiate screen — colours from NIJ Standard-0604.01,
   not yet checked against a real reaction with this app"*, plus the location
   accuracy (allow location when asked; if denied, the record says so).
3. **Empty zone → NEGATIVE.** Photograph the card with nothing in the sample
   zone. The result is **NEGATIVE — No colour developed in the sample zone**.
   Point out: the app cannot tell a colourless test from an empty zone, which
   is why the officer must tick **"The test is in the sample zone"** before
   saving, and why the signed photo is kept. (For the demo, say out loud that
   the zone is empty; this is the honest reading of a colourless result.)
4. **Orange-red cap → INCONCLUSIVE.** Put the orange-red plastic cap in the
   sample zone and photograph again. The result is **INCONCLUSIVE — Colour
   matches no opiate reaction in the NIJ table** (the cap reads about 35 ΔE00
   from the nearest target, heroin, whose radius is 7.9). The screen shows the
   corrected cap colour next to the three target colours and the sampled area
   drawn on the straightened card.
5. **Save**: add a case reference (e.g. `DEMO-CASE-1`), tick the box, tap
   **Save signed record**. The record opens with three checks: ✓ Signature
   valid, ✓ Chain link intact, ✓ Photo matches record, and the plain meanings
   under them.
6. **Log**: both records, newest first. Show the search box (type the case
   reference) and the result filter. Tap **Verify whole log**: "✓ All checks
   passed — 2 records checked…". Show **Latest record hash** and explain why it
   should be noted down elsewhere (deleting the newest records is otherwise
   undetectable).
7. **Export whole log (.zip)**, then run the tamper demo below on a laptop.

**POSITIVE is shown only from the labelled synthetic test**
(`npm run test:e2e:result`, screenshots in its output folder, and the
synthetic section of `docs/validation/kit_marquis_v1.md`). No real Marquis
reaction has been photographed with this app. **No stand-in object may be used
to fake a POSITIVE** in a demo: the target colours come from a published
table, and showing a purple object as "heroin POSITIVE" would misrepresent what
has been tested.

## Tamper demo

1. Export the log from the app (Log → Export whole log) and copy the .zip to a
   laptop with this repository.
2. Check it untouched:

   ```
   node scripts/verify-log.ts fdtc_log_<time>.zip --noted <latest hash from the log screen>
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
   passes (a shorter chain is a valid chain), but `--noted <the hash you wrote
   down>` fails with "The noted hash is not in this log: records after it were
   deleted, or the note is wrong". This is why the latest hash must be noted
   outside the phone.
5. Optional: `--reanalyse` re-runs the full analysis on every exported photo
   with the bundled profiles and reports whether each verdict matches. On a
   demo export of the 9 accepted real photos (`node scripts/make-demo-export.ts`,
   written to the git-ignored `incoming/`) all 9 verdicts matched with a
   largest numeric difference of 0 (Node against Node); on records the app
   computed in Chromium, Node matched both verdicts with a largest difference
   of 1.7 × 10⁻¹³ (end-to-end test).
