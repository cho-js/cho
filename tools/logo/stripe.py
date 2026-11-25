"""Writes assets/cho-logo-animated.svg: a stripe comes in from the left, and
instead of leaving on the other side, it settles as the logo.

    python3 tools/logo/stripe.py [--out FILE] [--frames FOLDER]

The stripe is a line with a stroke, that comes in level and goes down to the
pointed end of the ribbon. From there the ribbon is drawn by its cells (see
ribbon.py), each shown when the head of the stripe passes it. The stripe goes
a little way into the ribbon, to where the ribbon is as wide as it is, so the
two join with no step.
"""
import math

import ribbon as B

W, H = B.W, B.H
BAND = 6.4        # the width of the stripe that comes in
DELTA = 21.5      # how far the stripe goes on into the ribbon
ENTRY_Y = 58.0    # the height at which it comes in
DURATION = 3.8    # seconds, from the edge of the picture to the whole logo
DELAY = 0.25      # seconds of an empty picture, before it
EASE = (0.33, 0.4, 0.45, 1.0)   # fast in, and a slow end

f = B.fmt


def cubic(p0, p1, p2, p3, n=40):
    """Points of a cubic curve, without its first."""
    out = []
    for k in range(1, n + 1):
        t = k / n
        u = 1 - t
        out.append((u**3*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t**3*p3[0],
                    u**3*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t**3*p3[1]))
    return out


B.refine()

# the way in: from the left edge, level, then down to the end of the ribbon
START = (-10.0, ENTRY_Y)
lead = [START, (20.0, ENTRY_Y)] + cubic((20, ENTRY_Y), (38, ENTRY_Y), (48, 61), (61, 74)) + [(B.LINE[0][0], B.LINE[0][1])]
LIN = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(lead, lead[1:]))
H0 = -START[0]                      # the head is at the left edge
TOTAL = LIN + B.LC                  # where the head ends
RIBBON = B.LC - DELTA               # the length of the stripe, as it is drawn

inner = [(x, y) for x, y, _, s in B.LINE if 0 < s <= DELTA]
BAND_D = (f"M{f(START[0])} {f(ENTRY_Y)}H20C38 {f(ENTRY_Y)} 48 61 61 74"
          + "".join(f"L{f(x)} {f(y)}" for x, y in [lead[-1]] + inner))

GRADS = f'''<linearGradient id="a" gradientUnits="userSpaceOnUse" x1="27.070454" y1="0" x2="181.87019" y2="0"><stop offset="0" stop-color="#000097"/><stop offset="1" stop-color="#008dff"/></linearGradient>
<linearGradient id="b" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="{f(W)}" y2="0"><stop offset="0" stop-color="#000097"/><stop offset="1" stop-color="#008dff"/></linearGradient>'''
ART = f'<path transform="translate({B.TX},{B.TY})" fill="url(#a)" d="{B.D_ART}"/>'


def frame(p):
    """The picture when the head is at the part p of its way."""
    h = H0 + p * (TOTAL - H0)
    cells = "".join(f'<path d="{B.cell_d(q)}"/>' for q, s in B.CELLS if LIN + s <= h)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W*4:.0f}" height="{H*4:.0f}" viewBox="0 0 {f(W)} {f(H)}">
<rect width="100%" height="100%" fill="#fff"/>
<defs>{GRADS}<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="{f(W)}" height="{f(H)}"><g fill="#fff">{cells}</g></mask></defs>
<path d="{BAND_D}" fill="none" stroke="url(#b)" stroke-width="{BAND}" stroke-dasharray="{f(RIBBON)} 9999" stroke-dashoffset="{f(RIBBON - h)}"/>
<g mask="url(#m)">{ART}</g>
</svg>'''


def animated():
    cells = []
    for q, s in B.CELLS:
        p = (LIN + s - H0) / (TOTAL - H0)
        t = DELAY + DURATION * B.ease_time(EASE, min(max(p, 0), 1))
        cells.append(f'<path d="{B.cell_d(q)}" style="animation-delay:{t:.3f}s"/>')
    x1, y1, x2, y2 = EASE
    end = DELAY + DURATION
    # The last shape of the mask is the whole picture, at the end: what the
    # cells left out of the art, if anything, shows then.
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(W)} {f(H)}" role="img" aria-labelledby="t">
<title id="t">CHO</title>
<!-- The logo of CHO, drawn by its own ribbon: a stripe comes in from the left, and settles as the butterfly. Made from cho-logo.svg. -->
<defs>
{GRADS}
<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="{f(W)}" height="{f(H)}"><g class="c" fill="#fff">
{"".join(cells)}
<rect width="{f(W)}" height="{f(H)}" style="animation-delay:{end:.3f}s"/></g></mask>
</defs>
<style>
.s{{stroke-dasharray:{f(RIBBON)} 9999;stroke-dashoffset:{f(RIBBON - H0)};animation:s {DURATION}s cubic-bezier({x1},{y1},{x2},{y2}) {DELAY}s forwards}}
.c>*{{opacity:0;animation:c 1ms linear forwards}}
@keyframes s{{to{{stroke-dashoffset:{f(RIBBON - TOTAL)}}}}}
@keyframes c{{to{{opacity:1}}}}
@media (prefers-reduced-motion:reduce){{.s{{animation:none;stroke-dashoffset:{f(RIBBON - TOTAL)}}}.c>*{{animation:none;opacity:1}}}}
</style>
<path class="s" d="{BAND_D}" fill="none" stroke="url(#b)" stroke-width="{BAND}"/>
<g mask="url(#m)">{ART}</g>
</svg>
'''


if __name__ == "__main__":
    args = B.parser("cho-logo-animated.svg", "Writes the logo that a stripe settles into.").parse_args()
    print("the way in:", round(LIN, 1), "the ribbon:", round(B.LC, 1), "cells:", len(B.CELLS))
    if args.frames:
        B.write_frames(args.frames, "stripe", [frame(p) for p in (0.05, 0.14, 0.3, 0.5, 0.7, 0.86, 0.95, 1.0)])
    B.write(args.out, animated())
