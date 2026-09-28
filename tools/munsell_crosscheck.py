"""Independent cross-check of the Munsell -> CIELAB conversion (not used by the app).

Reads a JSON list of Munsell notations on stdin and prints, as JSON, CIELAB (D65)
computed with colour-science: munsell_colour_to_xyY (illuminant C), Bradford
adaptation C -> D65, XYZ_to_Lab. Run with the local venv:

    tools/.venv/Scripts/python.exe tools/munsell_crosscheck.py < notations.json
"""
import json
import sys
import warnings

import colour

warnings.filterwarnings("ignore")
obs = colour.CCS_ILLUMINANTS["CIE 1931 2 Degree Standard Observer"]
C, D65 = obs["C"], obs["D65"]
out = {}
for n in json.load(sys.stdin):
    xyY = colour.munsell_colour_to_xyY(n)
    XYZ = colour.xyY_to_XYZ(xyY)
    XYZa = colour.chromatic_adaptation(XYZ, colour.xy_to_XYZ(C), colour.xy_to_XYZ(D65), method="Von Kries", transform="Bradford")
    out[n] = {"xyY": [float(v) for v in xyY], "lab": [float(v) for v in colour.XYZ_to_Lab(XYZa, D65)]}
print(json.dumps({"colourScience": colour.__version__, "illuminantC": [float(v) for v in C], "d65": [float(v) for v in D65], "results": out}))
