# UX audit — Session 3

Judged as an SIH evaluator who has never seen the app, has **no printed
card**, and opens the live link on a phone or a laptop.

Method: `node scripts/audit-walkthrough.ts before` builds the real app (real
profiles only) and drives it in Playwright at phone size (Pixel 7 emulation,
412 px) and laptop size (1366 × 860), with fake-camera clips of
**computer-drawn** cards only. Screenshots: `docs/audit/before/` (32 states,
JPEG); visible text of every state: `docs/audit/before/inventory.json`.
Covered: every screen, tab and button; photo collection ("data collection
mode") on and off; an empty log and a log with records; POSITIVE, NEGATIVE
and RETAKE results; no card in view; camera refused (the laptop case).

Decisions: **KEEP**, **REWORD** (new text given), **MOVE** (to Developer
tools, or to a collapsed Technical details / Advanced section as stated),
**REMOVE**. Section 9 lists what is missing altogether.

## Screenshots (before)

| # | State |
|---|---|
| 01 / 17 | First launch (phone / laptop): lands on the Operator ID form |
| 02 / 18 | Camera ready with a card in view |
| 03 / 19 | Result POSITIVE (computer-drawn heroin-colour test) |
| 04 / 20 | Result with Technical details open |
| 05 / 21 | Record detail after Save |
| 06 / 22 | Log with records |
| 07 / 23 | Log after Verify whole log and a wrong code check |
| 08 / 24 | Settings |
| 09 / 25 | About |
| 10 | Settings with data collection on |
| 11 | Camera in data collection mode |
| 12 | Data collection capture saved (toast) |
| 13 | Log while data collection is on (no hint why new tests are missing) |
| 14 | Captures |
| 15 / 26 | Empty log |
| 16 / 27 | Empty log + code check ("records after it were deleted") |
| 28 | Result NEGATIVE (empty zone) |
| 29 | Result RETAKE (two coloured areas) |
| 30 | Camera with no card in view |
| 31 / 32 | Camera refused / no camera (phone / laptop) |

## 1. Everywhere

| # | Element | Current text | What it does | Decision | New text / reason |
|---|---|---|---|---|---|
| 1.1 | Bottom navigation | Test · Log · Settings (+ Captures in data collection) | Switches screens | KEEP | Clear, icons + words. Captures only while photo collection is on (already). |
| 1.2 | Update bar | "A new version is ready. Update now" | Activates a new service worker | KEEP | Plain. |
| 1.3 | Toasts | e.g. "Operator ID saved", "Phone model saved" | Confirms an action | KEEP | Plain; (minor) a toast can sit over the verdict right after navigating (shot 29). |
| 1.4 | Laptop layout | Every screen stretched to 1366 px; the viewfinder is a strip in a black field | — | REWORD | Centred phone-width column on wide screens (STEP 3). |

## 2. First launch / Operator ID form (`#/test` with no ID; shots 01, 17)

| # | Element | Current text | What it does | Decision | New text / reason |
|---|---|---|---|---|---|
| 2.1 | Screen as first screen | (the app opens straight on this form) | Asks for the officer ID | REWORD | Show the Welcome screen first (STEP 4); ask for the ID only when the user chooses "Start a test". An evaluator does not know what the app is yet. |
| 2.2 | Heading | "Operator ID" | — | REWORD | "Your officer ID" |
| 2.3 | Paragraph | "Every record carries the ID of the officer who ran the test. Enter it once; it is saved on this phone and can be changed in Settings." | Explains | REWORD | "It is written on every test you save. Enter it once; you can change it in Settings." |
| 2.4 | Hint | "The app does not check this ID against anything: a record proves it was not changed after signing, not who the officer was." | Explains limits | REWORD | "The app does not check this ID. A saved test proves it was not changed afterwards, not who took it." ("signing" is jargon) |
| 2.5 | Input | placeholder "e.g. badge or service number" | — | KEEP | |
| 2.6 | Button | "Save and continue" | Saves ID, opens camera | KEEP | |

## 3. Test / camera screen, officer mode (shots 02, 18, 30, 31, 32)

| # | Element | Current text | What it does | Decision | New text / reason |
|---|---|---|---|---|---|
| 3.1 | Kit line | "Kit: Marquis reagent — opiate screen" | Names the kit | KEEP | |
| 3.2 | Kit status | "Marquis opiate screen — colours from NIJ Standard-0604.01, not yet checked against a real reaction with this app" | Honest status | KEEP | Required on every screen; plain. |
| 3.3 | Kit picker | (hidden with one kit) | Chooses kit | KEEP | |
| 3.4 | Operator link | "Operator: AUDIT-01 (change)" | Opens Settings | REWORD | "Officer: AUDIT-01 (change)" |
| 3.5 | Location, fix | "Location ±15 m" | Shows GPS accuracy | REWORD | "Location found (within 15 m)" |
| 3.6 | Location, none | "Location unavailable: location permission denied" | Explains | REWORD | "Location off (permission refused) — saved tests will say so" |
| 3.7 | Instructions | (none) | — | REWORD | Add three steps above the viewfinder: "1. Put the test in the white square. 2. Fit the card in the frame. 3. Hold still and tap Capture." (STEP 6) |
| 3.8 | Guidance, ready | "Ready — tap to capture" | Live status | KEEP | |
| 3.9 | Guidance, no card | "Show all four corners" | Live status | REWORD | "Show the whole card — all four black corners" |
| 3.10 | Guidance, other card messages | "Move closer", "Hold steady", "Too dark", "Too bright", "Only one card in view", "Glare on the card — tilt the phone", "Uneven light — move out of the shadow", "Card looks mirrored — use the rear camera" | Live status | KEEP | Plain and actionable. |
| 3.11 | Guidance, ID strip | "Card ID unreadable — show the whole card, flat and in focus" | Live status | KEEP | Plain. |
| 3.12 | Guidance / RETAKE, correction | "Colour correction unreliable — retake in even light" | Card-stage refusal | REWORD | "Light too uneven or coloured to read the card — try daylight or a tube light" |
| 3.13 | Guidance / RETAKE, unknown copy | "Card copy X is not registered — register it first" | Card-stage refusal | REWORD | "This printed card is not set up in the app yet (only the team's cards A and B are). Try a sample instead." Dead end today: there is no way to "register" in the app. |
| 3.14 | Resolution | "1080×1920" (bottom right) | Shows camera resolution | MOVE | Developer tools (photo collection only). Meaningless to an evaluator. |
| 3.15 | Shutter | round button, no text (aria "Capture") | Captures | KEEP | Enabled only when the card checks pass. |
| 3.16 | Torch | "Torch" (when the phone has one) | Toggles torch | KEEP | |
| 3.17 | Camera refused / no camera | "Camera unavailable" + "Camera permission was refused. Allow camera access for this site in the browser settings, then reload." + "Retry camera" | Error | REWORD | Keep the sentence and Retry; add "No camera or no card? Try a sample" button. On a laptop: "This needs a phone camera and the printed card." Dead end today. |
| 3.18 | Raw error code | "NotAllowedError: Permission denied" | Shows the real error | MOVE | Keep but small, under "Technical details" in the error box (no hidden failures; not the first thing a user reads). |

## 4. Test / camera screen, data collection mode (shots 10-14)

| # | Element | Current text | What it does | Decision | New text / reason |
|---|---|---|---|---|---|
| 4.1 | Banner (camera only) | "DATA COLLECTION MODE — captures are saved for the test set; no result is ever shown" | Warns | REWORD | On **every** screen: "Photo collection is on: photos are saved for the team, no results, no records. [Turn off]" (STEP 2). Today Log and Settings give no sign, so a user sees an empty log with no reason. |
| 4.2 | Settings switch | "Data collection mode" + long hint | Turns the mode on | MOVE | Developer tools (collapsed, off by default): "Photo collection" — "For the team: saves test photos to improve the app. No results, no records." |
| 4.3 | Tag picker | "registration \| daylight \| tube \| warm-bulb \| torch \| fail-corner \| fail-shadow \| fail-glare \| fail-blur \| fail-far \| fail-banding" | Chooses the photo's tag | REWORD | Plain labels, e.g. "Card set-up photo (clean card)", "Daylight", "Tube light", "Warm bulb", "Phone torch", "Corner covered (checks the app refuses it)", "Shadow across half the card (…)", "Glare spot on the patches (…)", "Deliberately blurred photo (…)", "Card too far away (…)", "Flickering tube light bands (…)". Shown only while photo collection is on (already). |
| 4.4 | Copy A / Copy B | "Copy A", "Copy B" | Which printed card | REWORD | "Card A", "Card B" (only while collecting). |
| 4.5 | Phone model | "Phone: Audit Phone (change)"; Settings field "Phone model" | Names files | MOVE | Developer tools (only while collecting). |
| 4.6 | Count | "registration A on this phone: 0 (need 3)" | Progress | REWORD | "Card set-up photos, card A: 0 of 3" |
| 4.7 | Lock | "Lock exposure & white balance" / "This phone cannot lock exposure or white balance (auto is fine)." | Registration lock | KEEP | Team-only, shown only for set-up photos. |
| 4.8 | Tag hints | e.g. "Dried haldi stain in the sample zone. Do not move it between shots." | Shot instructions | REWORD | Remove "haldi" (no haldi kit exists): "Any test object in the white square; do not move it between shots." |
| 4.9 | Metrics line | "sharp 1014/680 · blown 0.0% · median 111 · copy A · light 1.02/1.2" | Live numbers | KEEP | Team-only (collection mode). |
| 4.10 | Guidance | "Checks pass" / "… (capture still allowed)" | Live status | KEEP | |
| 4.11 | Save toast | "Saved registration_audit-phone_A_20260928T184825427Z.png" | Confirms | REWORD | "Photo saved for the team (Card set-up photo, card A)" |
| 4.12 | Captures heading | "Captures" | — | REWORD | "Collected photos (for the team)" |
| 4.13 | Captures hint | "Saved on this phone only. Export the .zip and unzip it into data/real/ in the repo; the folders already match." | Team instructions | KEEP | Team-only screen. |
| 4.14 | Captures summary | "Registration, copy A … (need 3)", "Lighting (orange strip) … (need 15+ …)", "Should fail … (about 6)" | Progress | REWORD | "Card set-up photos", "Lighting photos", "Photos the app must refuse"; drop "orange strip" (none exists). |
| 4.15 | Captures buttons / list | "Download all as .zip", "Share .zip", "Delete all", per-photo "Delete", sha256 | Export / delete | KEEP | Team-only. |

## 5. Result screen (shots 03, 04, 28, 29)

| # | Element | Current text | What it does | Decision | New text / reason |
|---|---|---|---|---|---|
| 5.1 | Heading | "Result" | — | KEEP | |
| 5.2 | Verdict badge | "POSITIVE" / "NEGATIVE" / "INCONCLUSIVE" / "RETAKE" + icon + colour | Verdict | REWORD | Keep POSITIVE/NEGATIVE/INCONCLUSIVE; show "RETAKE" as "Retake photo". |
| 5.3 | Reason, POSITIVE | "Colour matches heroin (diacetylmorphine HCl) (7.5RP 3/10): ΔE00 2.0, within 7.9" | Why | REWORD | "The test colour matches the colour this reagent turns with heroin in the published table." Numbers → Technical details. |
| 5.4 | Reason, INCONCLUSIVE | "Colour matches no opiate reaction in the NIJ table (nearest: heroin (…), ΔE00 37.5, radius 7.9)" | Why | REWORD | "The test colour does not match any opiate colour in the published table." |
| 5.5 | Reason, NEGATIVE | "No colour developed in the sample zone. The app cannot tell this from an empty zone; the photo shows which it was." | Why | REWORD | "No colour developed. (The app cannot tell this from an empty square; the saved photo shows which it was.)" |
| 5.6 | Reason, RETAKE | e.g. "Two separate coloured areas — use one test" | Why | KEEP | Plain. |
| 5.7 | Section heading | "Sample colour and target colours" | — | REWORD | "Your test and the kit's colours" |
| 5.8 | Sample swatch caption | "Sample (corrected)" + "L 63.0, 83.3, 43.9" | Shows the colour | REWORD | "Your test (after light correction)"; numbers → Technical details. |
| 5.9 | Target swatch captions | "heroin (diacetylmorphine HCl)" + "7.5RP 3/10 · ΔE00 2.0 (radius 7.9)" | Shows targets | REWORD | "Heroin — close match" / "not a match"; notation and numbers → Technical details. |
| 5.10 | Sample facts | "Sampled 227 mm² (10042 camera pixels), spread 1.1 ΔE76, clipped 0.0%. Blue = sampled, pink = …" | Explains the mask | REWORD | "Blue: the area the app read. Pink: coloured edges it left out." Numbers → Technical details. |
| 5.11 | Sample facts on RETAKE | "Sampled 95 mm² … spread 0.0 ΔE76, clipped 0.0%" | — | REMOVE | Wrong for the state (nothing was read; "spread 0.0" is not a measurement). |
| 5.12 | Target swatches on RETAKE | the three target colours | — | REMOVE | Nothing was compared; they only confuse. |
| 5.13 | No-colour text | "No pixel in the zone differs from the card's white by more than 7.0 ΔE76 (3 × this photo's paper noise). The app cannot tell …" | Explains | REWORD | "Nothing in the white square differs from the card's white paper." |
| 5.14 | Straightened card + caption | "The reference colour card, straightened by the app, with the sample zone outlined." | Shows what was read | KEEP | |
| 5.15 | Kit line | "Marquis reagent — opiate screen: Marquis opiate screen — colours from NIJ Standard-0604.01, …" | Status | REWORD | Drop the repeated name: "Kit status: colours from NIJ Standard-0604.01, not yet checked against a real reaction with this app." |
| 5.16 | Notice | "Presumptive result — send for laboratory confirmation" | Warning | KEEP | |
| 5.17 | Case reference / Location note | labels + inputs | Optional fields | KEEP | |
| 5.18 | In-zone tick | "The test is in the sample zone" / "Required: the app cannot tell a colourless test from an empty zone." | Required confirmation | REWORD | "The test is in the white square" / "Needed because the app cannot tell a colourless test from an empty square." |
| 5.19 | Record facts | "Operator AUDIT-01 · Location ±15 m · signed with this phone's key." | What will be saved | REWORD | "Will be saved with officer AUDIT-01, the location (within 15 m) and the time, sealed on this phone." |
| 5.20 | Save button | "Save signed record" | Signs and appends | REWORD | "Save sealed record" |
| 5.21 | Case/location/tick/Save on RETAKE | shown, Save disabled, "A RETAKE is never recorded. Fix the problem above and take the photo again." | — | REMOVE | Dead end on RETAKE: hide the form and show one "Take the photo again" button with the reason. |
| 5.22 | Technical details | Session 1 card checks, straightened card, details table, 30 patches | Developer detail | KEEP | Collapsed; the numbers removed above go here. |
| 5.23 | Back button | "Back to camera" | Returns | REWORD | "Take another photo" |

## 6. Record detail (shots 05, 21)

| # | Element | Current text | What it does | Decision | New text / reason |
|---|---|---|---|---|---|
| 6.1 | Heading | "Record 0" | — | REWORD | "Saved test, record 0" (keep the number the verifier and exports use). |
| 6.2 | Verdict + reason | as on the result screen | — | REWORD | Same plain sentences as 5.3-5.5. |
| 6.3 | Notice | "Presumptive field result. Not a laboratory confirmation." | Warning | KEEP | |
| 6.4 | Check 1 | "✓ Signature valid: yes" | Hash + signature + key check | REWORD | "✓ Not changed since it was saved" |
| 6.5 | Check 2 | "✓ Chain link intact: yes" | Chain check | REWORD | "✓ Nothing removed or inserted before it" |
| 6.6 | Check 3 | "✓ Photo matches record: yes" | Photo re-hash | REWORD | "✓ Photo is the original" |
| 6.7 | Meanings (3 paragraphs) | "The signature shows … The chain means … An offline phone cannot prove …" | Explains | REWORD | One plain paragraph visible ("Sealed on this phone: any change is caught. It does not prove who the officer was; the time and place are what the phone reported."); the technical wording → collapsed Technical details. |
| 6.8 | Fields: Result, Why, Photo taken, Case reference, Location note, Officer confirmed … | as labelled | — | KEEP | Plain. |
| 6.9 | Field: Recorded (phone clock) | "Recorded (phone clock)" | — | REWORD | "Saved at (phone's clock)" |
| 6.10 | Field: Operator ID (typed, not verified) | — | — | REWORD | "Officer ID (typed in, not checked)" |
| 6.11 | Field: Location (browser geolocation) | — | — | REWORD | "Place (from the phone)" |
| 6.12 | Field: Kit | "Marquis reagent — opiate screen (marquis-opiates v1) — published-reference-only" | — | REWORD | "Marquis reagent — opiate screen, version 1 (colours from a published table)" |
| 6.13 | Fields: Kit profile SHA-256, Card, Card reference SHA-256, Colour correction, Sample zone, Nearest target, Record ID, Sequence number, Record hash (SHA-256), Previous record hash, Device key ID, Signature (ECDSA P-256, r\|\|s, base64url), Photo SHA-256, Pixels SHA-256, Image, App | codes and numbers | Full record | MOVE | Collapsed "Technical details" on the same screen. |
| 6.14 | Field: Notice (last row) | "Presumptive field result. Not a laboratory confirmation." | Duplicate | REMOVE | Already shown at the top (6.3). |
| 6.15 | Export button | "Export this record (JSON + photo)" | Downloads zip | REWORD | "Download this test (for the lab)" |
| 6.16 | Back | "Back to log" | — | KEEP | |

## 7. Log (shots 06, 07, 13, 15, 16, 22, 23, 26, 27)

| # | Element | Current text | What it does | Decision | New text / reason |
|---|---|---|---|---|---|
| 7.1 | Heading | "Log" | — | KEEP | Add the two plain lines of STEP 5 under it. |
| 7.2 | Latest code card | "Latest record hash" + "4253ad0eae56…44fe77" | Shows / copies the latest hash | MOVE | Collapsed "Advanced": "Log code to write down" (short form) + one line why. |
| 7.3 | Its hint | "Note this down outside the phone (case diary, a message). Deleting the newest records can only be detected by comparing with a hash noted earlier." | Explains | REWORD | "Write this code in your case diary. If the newest saved tests are ever deleted, the log will no longer end with it." |
| 7.4 | Compare box | "Check a hash noted earlier (12+ hex digits)" + "Check" | Compares a noted hash | MOVE | Into Advanced, shown only when the log has records. |
| 7.5 | Compare, empty log | "The noted hash is not in this log: records after it were deleted, or the note is wrong" | — | REWORD | Wrong for the state: an empty log shows no compare box at all. With records: match → "This is the latest code: nothing has been removed since you wrote it down." / older → "This code is from test N; M tests were saved after it." / not found → "This code is not in this log: tests after it were deleted, or the code was copied wrongly." |
| 7.6 | Verify button | "Verify whole log" | Runs the verifier | REWORD | "Check log" |
| 7.7 | Verify summary | "✓ All checks passed — 2 records checked; signatures valid: 2/2; chain links intact: 2/2; photos match: 2/2; clock warnings: 0." | Result | REWORD | "✓ All 2 saved tests: not changed, nothing removed or inserted, photos original." Per-record problems in the same three plain phrases. |
| 7.8 | Search | placeholder "Search operator, case ref, location note, record ID" | Filters | REWORD | "Search officer, case or place" |
| 7.9 | Filters | "Any result …", "Any kit …", "From", "To" | Filters | KEEP | Add "Samples: include / only / hide" (STEP 3). |
| 7.10 | Count | "2 of 2 signed records" | — | REWORD | "2 of 2 saved tests" |
| 7.11 | Empty log | "No records yet. Save a result from the Test screen." with the code card, compare box, Verify, search and filters all still shown | — | REWORD | "No saved tests yet. Run a test or try a sample, then tap Save." Hide code, compare, Check log, search and filters while empty. |
| 7.12 | Log rows | "POSITIVE #1 · date · Operator … · kit / case · place" | Opens a record | KEEP | Add a "Sample" badge for sample records. |
| 7.13 | Export card | "Export" + "A .zip with every record (JSONL), every photo, the public key and VERIFY.md explaining how to check it." | Downloads the log | REWORD | "Download log (for the lab)" + "One file with every saved test, its photo and instructions for checking it." |
| 7.14 | Share | "Share .zip" | Share sheet | REWORD | "Share log file" |
| 7.15 | Clear-data warning | "Clearing this site's data (or uninstalling the browser) deletes the signing key and the whole log together. Only an exported log survives that: export regularly." | Warning | REWORD | "If this browser's data is cleared, the saved tests are deleted with it. Download the log regularly." |
| 7.16 | Log while photo collection is on | (nothing says why new tests are missing) | — | REWORD | The banner of 4.1 on every screen. |

## 8. Settings and About (shots 08, 09, 24, 25)

| # | Element | Current text | What it does | Decision | New text / reason |
|---|---|---|---|---|---|
| 8.1 | Operator ID card | "Operator ID" + "Written into every record you sign. The app does not verify it: …" | Edits the ID | REWORD | "Officer ID" + "Written on every test you save. The app does not check it." |
| 8.2 | Data collection card | "Data collection mode" + "For building the photo test set only. …" | Mode switch | MOVE | Developer tools (see 4.2). |
| 8.3 | Phone model card | "Phone model" / "Required for data collection." | — | MOVE | Developer tools, only while collecting. |
| 8.4 | Camera request card | "Camera request" / "Rear camera, 1920×1080 requested. …" | Info | MOVE | Developer tools. |
| 8.5 | Thresholds table | "Thresholds in use" + raw names (blurMinLaplacianVariance, highlightClipLevel, minMedianLuma, …) + badges | Info | MOVE | Developer tools; plain name first ("Blur check — minimum sharpness"), technical name and value underneath in small text. |
| 8.6 | Signed log section | "Signed log" + export card | Download | REWORD | "Saved tests" + "Download log (for the lab)". |
| 8.7 | About link | "About this app, the card PDF and the build" | Opens About | REWORD | "About this app and how it works" → Welcome / How it works (STEP 4). |
| 8.8 | About text | "Field Test Companion works alongside … register each copy before use." | Explains | REWORD | Replaced by Welcome + How it works; "register each copy" → "each printed card is set up once in the app before use". |
| 8.9 | Card PDF button | "Download card (A4 PDF)" | Downloads the card | KEEP | Also on How it works. |
| 8.10 | Version / Build / Offline table | "Version 0.1.0", "Build <commit> · <time>", "Offline: installed — works offline" | Info | KEEP | Small, at the bottom of About; useful when reporting a problem. |

## 9. Missing (to add)

| # | What | Why |
|---|---|---|
| 9.1 | Welcome screen (first launch, and from Settings → About) | Today an evaluator lands on an ID form with no idea what the app does. |
| 9.2 | "No card? Try a sample" (Welcome and Test screens), with 4 labelled samples | Without a printed card the live link shows no result at all. |
| 9.3 | "How it works" page | Nothing explains card → correction → comparison → sealed record. |
| 9.4 | Photo-collection banner on every screen, with "Turn off" | The maker's own phone was stuck in data collection with an empty log and no explanation. |
| 9.5 | "See tamper detection" on the Log | The sealed record is invisible to an evaluator otherwise. |
| 9.6 | Sample badge and filter | Sample records must never be mistaken for camera records. |
| 9.7 | Camera screen instructions (three steps) | The viewfinder gives no instruction before a card is in view. |

## Dead ends, wrong messages and jargon found

**Dead ends**
1. First launch → ID form → camera: no explanation and no way forward without a card (01, 17).
2. No camera / laptop / permission refused → "Camera unavailable" with a raw error and only "Retry" (31, 32).
3. Data collection left on → no result, the log stays empty, nothing on Log or Settings says why (13).
4. RETAKE result → a disabled Save form; the only way on is "Back to camera" at the bottom (29).
5. "Card copy X is not registered — register it first": the app has no way to register (3.13).

**Messages wrong for their state**
1. Empty log + code check: "records after it were deleted" (16, 27).
2. RETAKE result: "Sampled 95 mm² … spread 0.0" (29).
3. Captures summary "Lighting (orange strip)" and tag hints "Dried haldi stain": neither exists (14, 11).
4. The empty log still offers Verify whole log, search, filters and a code check (15).

**Jargon outside technical sections** ΔE00, ΔE76, CIELAB numbers ("L 63.0, 83.3, 43.9"), Munsell notation (7.5RP 3/10), radius, hash, SHA-256, signature / signed, ECDSA, chain, key ID, registration / registered, JSONL, VERIFY.md, public key, "published-reference-only", raw threshold names (Laplacian, luma, clip), "MAT v1", "copy A", "1080×1920", "diacetylmorphine HCl".

## Counts

| Decision | Rows |
|---|---|
| KEEP | 32 |
| REWORD | 61 |
| MOVE | 11 |
| REMOVE | 4 |
| Missing (to add) | 7 |
