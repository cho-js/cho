"""Writes assets/cho-logo-ring.svg: the ribbon of the logo as a ring, that
flows into the butterfly, and back, with no end.

    python3 tools/logo/ring.py [--out FILE] [--frames FOLDER]

The outline of the logo goes along one edge of its ribbon, from one end to the
other, and back along the other edge. Each point of it is given its place
along the ribbon (see ribbon.py for the line of the ribbon). The same point of
the ring is at that place around a circle: on the inner circle for one edge,
on the outer one for the other. So the two shapes have the same points, in the
same order, and a browser moves each point from one shape to the other.
"""
import math
import re

import ribbon as B

W, H = B.W, B.H
CX, CY = W / 2, H / 2 + 0.5   # the center of the ring
R, BAND = 58.0, 12.0          # its radius, and the width of its ribbon
OVERLAP = 9.0                 # degrees the two ends of the ring lie over each other
# seconds: the ring rests, flows to the butterfly, the butterfly rests, flows back
REST_RING, FLOW, REST_LOGO = 0.7, 2.8, 1.8
EASE = ".65 0 .3 1"           # the timing of a flow: a slow start, and a slow end


# ---- the outline, as absolute cubic segments
def segments(d):
    toks = re.findall(r"[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?", d)
    i, cmd, x, y, segs, start = 0, None, 0.0, 0.0, [], None

    def num():
        nonlocal i
        v = float(toks[i])
        i += 1
        return v

    def line(nx, ny):
        nonlocal x, y
        p0 = (x, y)
        p3 = (nx, ny)
        segs.append((p0, (x + (nx - x) / 3, y + (ny - y) / 3), (x + 2 * (nx - x) / 3, y + 2 * (ny - y) / 3), p3))
        x, y = nx, ny

    while i < len(toks):
        if re.match(r"[a-zA-Z]", toks[i]):
            cmd = toks[i]
            i += 1
            if cmd in "zZ":
                if (x, y) != start:
                    line(*start)
                continue
        if cmd == "m":
            x += num()
            y += num()
            start = (x, y)
            cmd = "l"
        elif cmd == "l":
            dx, dy = num(), num()
            line(x + dx, y + dy)
        elif cmd == "v":
            line(x, y + num())
        elif cmd == "h":
            line(x + num(), y)
        elif cmd == "c":
            v = [num() for _ in range(6)]
            p0 = (x, y)
            segs.append((p0, (x + v[0], y + v[1]), (x + v[2], y + v[3]), (x + v[4], y + v[5])))
            x, y = segs[-1][3]
    return [tuple((px + B.TX, py + B.TY) for px, py in s) for s in segs]


def split(seg, parts):
    """A cubic segment, cut in equal parts of its parameter: the same curve."""
    out = []
    p0, p1, p2, p3 = seg
    lerp = lambda a, b, u: (a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u)
    for k in range(parts, 1, -1):
        u = 1 / k
        a = lerp(p0, p1, u)
        b = lerp(p1, p2, u)
        c = lerp(p2, p3, u)
        d = lerp(a, b, u)
        e = lerp(b, c, u)
        m = lerp(d, e, u)
        out.append((p0, a, d, m))
        p0, p1, p2 = m, e, c
    out.append((p0, p1, p2, p3))
    return out


# shorter segments: a point of the outline is never far from one that has its place
SEGS = []
for seg in segments(B.D_ART):
    chord = math.hypot(seg[3][0] - seg[0][0], seg[3][1] - seg[0][1])
    SEGS += split(seg, max(1, math.ceil(chord / 7.5)))
N = len(SEGS)
NODES = [s[0] for s in SEGS]          # node k starts segment k; the last segment ends at node 0

# ---- the place of each node along the ribbon
LINE = B.LINE
M = len(LINE)
# the node at the pointed end of the ribbon: the outline turns back there
tip = min(range(N), key=lambda k: (NODES[k][0] - 92.8) ** 2 + (NODES[k][1] - 105.8) ** 2)


def monotone(nodes, down):
    """Places along the line, in order (down: from its end to its start), nearest to the nodes."""
    INF = 1e18
    idx = list(range(M - 1, -1, -1)) if down else list(range(M))
    cost = lambda n, j: (n[0] - LINE[j][0]) ** 2 + (n[1] - LINE[j][1]) ** 2
    best = [[INF] * M for _ in nodes]
    back = [[0] * M for _ in nodes]
    best[0][0] = cost(nodes[0], idx[0])
    for a in range(1, len(nodes)):
        run, arg = INF, 0
        for b in range(M):
            if best[a - 1][b] < run:
                run, arg = best[a - 1][b], b
            if run < INF:
                best[a][b] = run + cost(nodes[a], idx[b])
                back[a][b] = arg
    b = M - 1                                  # the last node is at the other end
    out = [0] * len(nodes)
    for a in range(len(nodes) - 1, -1, -1):
        out[a] = LINE[idx[b]][3]
        b = back[a][b]
    return out


def smooth(places, nodes, sigma=11.0, turns=2):
    """Places that change evenly along an edge: no step, and never a turn back.

    The nearest place of a node comes in steps, and a step is a corner in every
    shape between the two. The places are averaged along the edge, by its own
    length, with the two ends kept.
    """
    along = [0.0]
    for a, b in zip(nodes, nodes[1:]):
        along.append(along[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    out = list(places)
    for _ in range(turns):
        new = list(out)
        for k in range(1, len(out) - 1):
            # near an end, the window is as short as the way to that end
            reach = min(3 * sigma, along[k] - along[0], along[-1] - along[k])
            total = weight = 0.0
            for j in range(len(out)):
                d = along[j] - along[k]
                if abs(d) <= reach:
                    w = math.exp(-d * d / (2 * sigma * sigma))
                    total += w * out[j]
                    weight += w
            new[k] = total / weight
        out = new
    rising = out[-1] > out[0]
    for k in range(1, len(out)):
        out[k] = max(out[k], out[k - 1]) if rising else min(out[k], out[k - 1])
    return out


# an edge, from the end of the ribbon to its start, and the other edge, back
half1 = smooth(monotone(NODES[:tip + 1], down=True), NODES[:tip + 1])
half2 = smooth(monotone(NODES[tip:], down=False), NODES[tip:])
PLACE = half1 + half2[1:]
OUTER = [k > tip for k in range(N)]                 # the second edge is the outer circle

# ---- the angle of a place: where around the circle it is
# (place, degrees), counter-clockwise as it is seen, 0 at the right
ANCHORS = [(0, -90 - OVERLAP / 2), (150, 0), (318, 90), (545, 180), (B.LC, 270 + OVERLAP / 2)]


def angle(s):
    """A smooth curve through the anchors, that never turns back."""
    xs = [a[0] for a in ANCHORS]
    ys = [a[1] for a in ANCHORS]
    n = len(xs)
    d = [(ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]) for k in range(n - 1)]
    m = [d[0]] + [(d[k - 1] + d[k]) / 2 for k in range(1, n - 1)] + [d[-1]]
    for k in range(n - 1):
        if xs[k] <= s <= xs[k + 1] or k == n - 2:
            h = xs[k + 1] - xs[k]
            t = (s - xs[k]) / h
            return ((2*t**3 - 3*t*t + 1) * ys[k] + (t**3 - 2*t*t + t) * h * m[k]
                    + (-2*t**3 + 3*t*t) * ys[k + 1] + (t**3 - t*t) * h * m[k + 1])


def on_ring(deg, outer):
    r = R + BAND / 2 if outer else R - BAND / 2
    a = math.radians(deg)
    return (CX + r * math.cos(a), CY - r * math.sin(a))


def ring_segments():
    """The ring: a segment for each segment of the outline."""
    out = []
    for k in range(N):
        j = (k + 1) % N
        a0, a1 = angle(PLACE[k]), angle(PLACE[j])
        o0, o1 = OUTER[k], OUTER[j]
        p0, p3 = on_ring(a0, o0), on_ring(a1, o1)
        if o0 != o1:                    # across the ribbon: an end of it
            p1 = (p0[0] + (p3[0] - p0[0]) / 3, p0[1] + (p3[1] - p0[1]) / 3)
            p2 = (p0[0] + 2 * (p3[0] - p0[0]) / 3, p0[1] + 2 * (p3[1] - p0[1]) / 3)
        else:                           # along a circle: an arc
            r = R + BAND / 2 if o0 else R - BAND / 2
            da = math.radians(a1 - a0)
            kk = 4 / 3 * math.tan(da / 4) * r
            t0 = (-math.sin(math.radians(a0)), -math.cos(math.radians(a0)))
            t1 = (-math.sin(math.radians(a1)), -math.cos(math.radians(a1)))
            p1 = (p0[0] + kk * t0[0], p0[1] + kk * t0[1])
            p2 = (p3[0] - kk * t1[0], p3[1] - kk * t1[1])
        out.append((p0, p1, p2, p3))
    return out


RING = ring_segments()

# ---- the file
f = B.fmt
GRAD = f'<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="{f(W)}" y2="0"><stop offset="0" stop-color="#000097"/><stop offset="1" stop-color="#008dff"/></linearGradient>'


def still(t):
    """The shape at the part t of the way from the butterfly (0) to the ring (1)."""
    segs = [tuple((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) for a, b in zip(sa, sb))
            for sa, sb in zip(SEGS, RING)]
    d = f"M{f(segs[0][0][0])} {f(segs[0][0][1])}"
    for _, p1, p2, p3 in segs:
        d += f"C{f(p1[0])} {f(p1[1])} {f(p2[0])} {f(p2[1])} {f(p3[0])} {f(p3[1])}"
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W*4:.0f}" height="{H*4:.0f}" viewBox="0 0 {f(W)} {f(H)}">
<rect width="100%" height="100%" fill="#fff"/><defs>{GRAD}</defs>
<path fill="url(#g)" d="{d}z"/></svg>'''


def num(v, digits):
    """A number of a path, as short as it can be written."""
    s = f"{v:.{digits}f}".rstrip("0").rstrip(".")
    if s in ("", "-0", "-"):
        s = "0"
    if s.startswith("0."):
        s = s[1:]
    if s.startswith("-0."):
        s = "-" + s[2:]
    return s


def join(values, digits):
    """Numbers, with a space only where two would run together."""
    out = ""
    for v in values:
        s = num(v, digits)
        if out and not s.startswith("-"):
            out += " "
        out += s
    return out


def path_rel(segs, digits):
    """The path with relative commands: shorter, and the same commands for every shape."""
    x, y = segs[0][0]
    d = f"M{num(x, digits)} {num(y, digits)}"
    for _, p1, p2, p3 in segs:
        # each number is rounded from where the path is: the errors do not add up
        vals = []
        for px, py in (p1, p2, p3):
            vals += [round(px - x, digits), round(py - y, digits)]
        d += "c" + join(vals, digits)
        x += vals[4]
        y += vals[5]
    return d + "z"


def animated():
    ring = path_rel(RING, 2)
    logo = path_rel(SEGS, 3)    # the butterfly is the logo: as exact as its file
    total = REST_RING + FLOW + REST_LOGO + FLOW
    times = [0, REST_RING, REST_RING + FLOW, REST_RING + FLOW + REST_LOGO, total]
    key = ";".join(num(v / total, 2) if v else "0" for v in times[:-1]) + ";1"
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {num(W, 2)} {num(H, 2)}" role="img" aria-labelledby="t">
<title id="t">CHO</title>
<!-- The ribbon of the logo of CHO, as a ring that flows into the butterfly, and back. The butterfly is the outline of cho-logo.svg; the ring has the same points, around a circle. -->
<defs>{GRAD}</defs>
<path fill="url(#g)" d="{logo}">
<animate attributeName="d" dur="{num(total, 2)}s" repeatCount="indefinite" calcMode="spline" keyTimes="{key}" keySplines="0 0 1 1;{EASE};0 0 1 1;{EASE}" values="{ring};{ring};{logo};{logo};{ring}"/>
</path>
</svg>
'''


if __name__ == "__main__":
    args = B.parser("cho-logo-ring.svg", "Writes the ring that flows into the logo, and back.").parse_args()
    print("segments of the outline:", N, "the pointed end is node", tip)
    if args.frames:
        B.write_frames(args.frames, "ring", [still(t) for t in (0, 0.2, 0.4, 0.5, 0.6, 0.75, 0.9, 1)])
    B.write(args.out, animated())
