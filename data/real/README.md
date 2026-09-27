# Real photos

Every file here was captured **through the app in data collection mode**: a
lossless PNG of the exact pixels the app analysed, plus a JSON sidecar
(tag, phone, card copy, camera settings, check results, SHA-256 of the file and
of the pixels). See `docs/pixel_contract.md`.

To add photos: in the app, **Captures → Download all as .zip**, then unzip the
archive **into this folder**. The zip already contains the `mat/...` folders
below. Do not rename files; the names carry the tag, phone and copy:
`<tag>_<phone>_<copy>_<UTC timestamp>.png`.

Never add photos taken with the phone's own camera app, screenshots, or edited
files. The validation script checks every PNG against its sidecar hashes.

## Layout and shot list (MAT v1)

```
mat/
  registration/A/   3 photos of printed copy A, soft indirect daylight near a window, no direct sun   (tag: registration)
  registration/B/   3 photos of printed copy B, same conditions                                   (tag: registration)
  lighting/         15+ photos across daylight, tube light, warm yellow bulb and phone torch,
                    from at least 2 phones; the same strip of orange card lies flat in the
                    sample zone and does not move between shots   (tags: daylight, tube, warm-bulb, torch)
  should_fail/      about 6 deliberately bad photos, one fault each
                    (tags: fail-corner, fail-shadow, fail-glare, fail-blur, fail-far, fail-banding)
```
