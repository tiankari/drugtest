Munsell renotation data, "real.dat" (Munsell Color Science Laboratory, RIT)

Source page:  https://www.rit.edu/science/munsell-color-science-lab-educational-resources
              (section "Munsell Renotation Data")
File:         http://www.rit-mcsl.org/MunsellRenotation/real.dat  (linked from that page)
Fetched:      2026-09-28
SHA-256:      493f6880948f159b1aec370c324b0e8fe50d5d169f3cf94d3ef8574f29793117  (real.dat, unchanged)

What the source page says about these files (summary, not verbatim):
- Six columns: Munsell hue, value, chroma, CIE x, y, Y.
- Chromaticities computed for illuminant C and the CIE 1931 2 degree observer.
- real.dat: real colours only (inside the MacAdam limits), the colours listed in the
  1943 renotation (Newhall, Judd and Nickerson, JOSA 33, 1943).
- The data come from Wyszecki & Stiles (2nd ed., 1982); the value scale is based on
  the original fifth-order polynomial relating Y/Y(MgO) to V. The page advises that,
  because modern instruments reference the perfect reflecting diffuser, the Y values
  be multiplied by 0.975 (Y of the smoked magnesium oxide reference white).
- It warns that none of these data should be confused with measurements from an
  actual Munsell Book of Color.

How scripts/build-kit-profile.ts uses it: exact table rows only (no interpolation);
Y x 0.975 / 100 gives Y relative to the perfect diffuser (white Y = 1); x, y, Y ->
XYZ under illuminant C; Bradford adaptation C -> D65 (see ../bradford-lindbloom-excerpt.txt);
CIELAB with the D65 white of src/pipeline/colour.ts.
