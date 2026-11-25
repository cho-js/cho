"""Writes assets/cho-logo-draw.svg: the logo, drawn. Its ribbon grows from
the open end, in the left wing, along its own path, until the butterfly is
whole.

    python3 tools/logo/draw.py [--out FILE] [--frames FOLDER] [--check]

The ribbon is cut in cells across its center line (see ribbon.py), and the
cells show one after the other, from the open end. The open end of the ribbon
is a slanted cut, so the first lines across the ribbon are slanted as the cut
is, and turn, little by little, to lines that are square to the ribbon.

--check also counts the points of the art that are in no cell: such a point
shows at the very end only. There should be none.
"""
import math

import ribbon as B

W, H = B.W, B.H
DURATION = 4.0                 # seconds the ribbon takes, from end to end
DELAY = 0.35                   # seconds of an empty picture, before it
EASE = (0.42, 0.0, 0.4, 1.0)   # a slow start, and a slow end
MIN_FADE = 0.02                # the least time a cell takes to show
STEP = 2.2                     # the length of a cell, along the ribbon
OVER = 0.35                    # how far a cell reaches into the next one
SPAN = 45.0                    # the length over which the slanted line turns square
# the two corners of the open end, in the outline of the logo
CUT_INNER = (52.03, 69.26)
CUT_TIP = (71.25, 79.05)

f = B.fmt


def smooth(widths, reach=2):
    """Even widths along the ribbon, and never less than they were: the edge
    of the part that is drawn is a line, and not a row of steps."""
    n = len(widths)
    top = [max(widths[max(0, k - reach):k + reach + 1]) for k in range(n)]
    out = []
    for k in range(n):
        near = top[max(0, k - reach):k + reach + 1]
        out.append(max(widths[k], sum(near) / len(near)))
    return out


B.refine()
WL = smooth(B.WL)
WR = smooth(B.WR)
N = len(B.LINE) - 1
GAP = B.LC / N                 # the distance between two points of the line

# The two edges of the ribbon: a point of each, at each point of the line.
LEFT, RIGHT, TANGENT = [], [], []
for k, (x, y, _, _) in enumerate(B.LINE):
    tx, ty = B.tangent(k)
    TANGENT.append((tx, ty))
    LEFT.append((x - ty * WL[k], y + tx * WL[k]))
    RIGHT.append((x + ty * WR[k], y - tx * WR[k]))


def edge(points, u):
    """The point of an edge at the distance u from the open end, along the
    ribbon. Before the open end, and after the other one, it goes straight on."""
    at = (B.LC - u) / GAP
    if at <= 0:
        (x, y), (tx, ty) = points[0], TANGENT[0]
        return x + tx * at * GAP, y + ty * at * GAP
    if at >= N:
        (x, y), (tx, ty) = points[N], TANGENT[N]
        return x + tx * (at - N) * GAP, y + ty * (at - N) * GAP
    k = int(at)
    t = at - k
    (x0, y0), (x1, y1) = points[k], points[k + 1]
    return x0 + (x1 - x0) * t, y0 + (y1 - y0) * t


def crossing(points):
    """The distance from the open end at which an edge crosses the line of
    the cut, and how far the edge is from that line there."""
    (ax, ay), (bx, by) = CUT_INNER, CUT_TIP
    n = math.hypot(bx - ax, by - ay)
    best = None
    u = -12.0
    while u < 40:
        x, y = edge(points, u)
        d = abs((x - ax) * (by - ay) - (y - ay) * (bx - ax)) / n
        if best is None or d < best[0]:
            best = (d, u)
        u += 0.02
    return best[1], best[0]


U_INNER, D_INNER = crossing(LEFT)
U_TIP, D_TIP = crossing(RIGHT)
START = (U_INNER + U_TIP) / 2      # where the cut crosses the center line
SLANT = (U_INNER - U_TIP) / 2      # how far each end of the cut is from there
LENGTH = B.LC - START              # what is drawn


def slant(u):
    t = min(max((u - START) / SPAN, 0), 1)
    return SLANT * (1 - t * t * (3 - 2 * t))


def across(u):
    """The line across the ribbon, at the distance u from the open end."""
    s = slant(u)
    return edge(LEFT, u + s), edge(RIGHT, u - s)


# The cells, from the open end: (polygon, where the head enters it, where it
# leaves it), as parts of what is drawn, from 0 to 1.
CELLS = []
COUNT = round(LENGTH / STEP)
for j in range(COUNT):
    u0 = START + LENGTH * j / COUNT
    u1 = START + LENGTH * (j + 1) / COUNT
    # the first cell starts before the cut: nothing of the end is left out
    l0, r0 = across(u0 - (3.0 if j == 0 else OVER))
    l1, r1 = across(u1 + (3.0 if j == COUNT - 1 else OVER))
    CELLS.append(([l0, r0, r1, l1], j / COUNT, (j + 1) / COUNT))


def gradient(name):
    return (f'<linearGradient id="{name}" gradientUnits="userSpaceOnUse" x1="27.070454" y1="0" '
            f'x2="181.87019" y2="0"><stop offset="0" stop-color="#000097"/>'
            f'<stop offset="1" stop-color="#008dff"/></linearGradient>')


def art(name):
    return f'<path transform="translate({B.TX},{B.TY})" fill="url(#{name})" d="{B.D_ART}"/>'


def frame(p):
    """The picture when the head is at the part p of the ribbon."""
    cells = "".join(f'<path d="{B.cell_d(q)}" opacity="{min((p - a) / (b - a), 1):.2f}"/>'
                    for q, a, b in CELLS if p > a)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W * 4:.0f}" height="{H * 4:.0f}" viewBox="0 0 {f(W)} {f(H)}">
<rect width="100%" height="100%" fill="#fff"/>
<defs>{gradient("a")}<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="{f(W)}" height="{f(H)}"><g fill="#fff">{cells}</g></mask></defs>
<g mask="url(#m)">{art("a")}</g>
</svg>'''


def animated():
    cells = []
    for q, a, b in CELLS:
        start = DELAY + DURATION * B.ease_time(EASE, a)
        end = DELAY + DURATION * B.ease_time(EASE, b)
        fade = max(end - start, MIN_FADE)
        cells.append(f'<path d="{B.cell_d(q)}" style="animation-delay:{start:.3f}s;animation-duration:{fade:.3f}s"/>')
    end = DELAY + DURATION
    # A shape of the mask is shown when no animation says otherwise: a
    # program that runs no animation shows the whole logo. The animation of a
    # shape hides it until its time comes (`backwards`), then fades it in.
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(W)} {f(H)}" role="img" aria-labelledby="t">
<title id="t">CHO</title>
<!-- The logo of CHO, drawn: its ribbon grows from the open end, in the left wing, along its own path, until the butterfly is whole. Made from cho-logo.svg. -->
<defs>
{gradient("a")}
<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="{f(W)}" height="{f(H)}"><g class="c" fill="#fff">
{"".join(cells)}
<rect width="{f(W)}" height="{f(H)}" style="animation-delay:{end:.3f}s;animation-duration:1ms"/></g></mask>
</defs>
<style>
.c>*{{animation:c linear backwards}}
@keyframes c{{from{{opacity:0}}}}
@media (prefers-reduced-motion:reduce){{.c>*{{animation:none}}}}
</style>
<g mask="url(#m)">{art("a")}</g>
</svg>
'''


def not_covered(step=0.6):
    """The points of the art that are in no cell: they show at the very end only."""
    return [(round(px, 1), round(py, 1)) for px, py in B.art_points(step)
            if not any(B.in_quad(q, px, py) for q, _, _ in CELLS)]


if __name__ == "__main__":
    parser = B.parser("cho-logo-draw.svg", "Writes the logo that is drawn from its open end.")
    parser.add_argument("--check", action="store_true",
                        help="also count the points of the art that are in no cell (a few seconds)")
    args = parser.parse_args()
    print("the ribbon:", round(B.LC, 1), "drawn:", round(LENGTH, 1), "cells:", len(CELLS))
    print("the cut: the inner edge at", round(U_INNER, 2), "the outer edge at", round(U_TIP, 2),
          "it starts at", round(START, 2), "with a slant of", round(SLANT, 2))
    if args.check:
        left = not_covered()
        print("points of the art in no cell:", len(left), left[:40])
    if args.frames:
        B.write_frames(args.frames, "draw", [frame(p) for p in (0.004, 0.02, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.75, 0.9, 1.0)])
    B.write(args.out, animated())
