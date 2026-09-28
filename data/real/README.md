# Real photos

Every file here was captured **through the app in data collection mode**: a
lossless PNG of the exact pixels the app analysed, plus a JSON sidecar
(tag, phone, card copy, camera settings, lock state, check results, SHA-256 of
the file and of the pixels). See `docs/pixel_contract.md`.

**These photos are not in git** (`.gitignore`): they show the photographer's
surroundings and the repository is public.

To add photos: in the app, **Captures → Download all as .zip**, and drop the
zip into this folder (or unzip it here; the zip already contains the `mat/...`
folders). Do not rename files; the names carry the tag, phone and copy:
`<tag>_<phone>_<copy>_<UTC timestamp>.png`. Never add photos from the phone's
own camera app, screenshots or edited files; the scripts check every PNG
against its sidecar hashes.

## Layout

```
mat/                 the CURRENT set (what register-mat.ts and validate-mat.ts use)
  registration/A/    3 photos of printed copy A      (tag: registration)
  registration/B/    3 photos of printed copy B      (tag: registration)
  lighting/          one test object under many lights and 2+ phones
                     (tags: daylight, tube, warm-bulb, torch)
  should_fail/       deliberately bad photos, one fault each (tags: fail-*)
archive/<date-name>/ earlier sets, kept unchanged, reported separately
```

`archive/2026-09-28-first-set/` holds the first registration shots (hand-held
against a wall at dusk; rejected: the three shots of each copy disagreed) and
the first lighting set (a glossy orange-red cap as the test object).

## Retake shot list (MAT v1, second set)

**Registration — 3 photos per copy, one phone (the Nothing Phone can lock):**
- Cards cut apart. Only one card in view. Nothing in the sample zone.
- Card **lying flat on a plain table**, not held up.
- **Steady daylight** (late morning to mid-afternoon), near a window, no direct
  sun on the card, room lights off.
- Tag `registration`, pick the copy, frame the card, wait a second, tap
  **Lock exposure & white balance**, then take the 3 photos without moving the
  card or the phone much. Tap Unlock (or change tag) afterwards.

**Lighting — about 16 photos, both phones, copy A:**
- Test object: a **dried haldi (turmeric) stain**: smear a little haldi paste
  on plain white paper, let it dry completely (matte, no wet shine), cut a
  piece about 4 × 4 cm and tape it flat by its edges in the middle of the
  sample zone. It must not move between shots.
- 2 photos under each of `daylight`, `tube`, `warm-bulb`, `torch`, on each phone.
- Keep your hand and phone from shading the card as much as you can.

**Should fail:** the five in `mat/should_fail/` stay valid. Add `fail-banding`
if a tube light ever shows moving dark stripes on screen.
