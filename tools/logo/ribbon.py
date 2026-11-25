"""The ribbon of the logo of CHO: what the animations of the logo are made from.

The art of the logo (assets/cho-logo.svg) is one filled outline: a ribbon that
draws a butterfly. This finds a center line for that ribbon (points placed by
hand, with the half width of the ribbon at each), and cuts the ribbon in cells
across that line. Showing the cells in order draws the ribbon from one end to
the other.

The ribbon has two ends. The line goes from the pointed one, in the lower
right wing, to the open one, in the upper left wing.

    python3 tools/logo/ribbon.py     # measures the ribbon, and says what it found

It is used by stripe.py, ring.py and draw.py, which write the animations.
"""
import argparse
import hashlib
import json
import math
import re
import sys
import tempfile
from pathlib import Path

ASSETS = Path(__file__).resolve().parent.parent.parent / "assets"
LOGO = ASSETS / "cho-logo.svg"

# The numbers of the logo file: its size, and where its drawing is moved to.
W, H = 154.79971, 162.64861
TX, TY = -27.070453, -27.073235


def read_art():
    """The outline of the art, as the `d` of its path in the logo file."""
    source = LOGO.read_text(encoding="utf8")
    for part in (f'viewBox="0 0 {W} {H}"', f"translate({TX},{TY})"):
        if part not in source:
            raise SystemExit(f"{LOGO.name} has no {part}: the logo has changed, and the numbers here are of the old one")
    tag = re.search(r'<path\b[^>]*\bid="path1-9"[^>]*>', source, re.S)
    if tag is None:
        raise SystemExit(f"{LOGO.name} has no path with the id path1-9")
    return re.search(r'\sd="([^"]*)"', tag.group(0), re.S).group(1).strip()


D_ART = read_art()


# ---------------------------------------------------------------- the art
def flatten(d):
    """The outline as polygons (lists of points), in the canvas of the logo."""
    toks = re.findall(r"[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?", d)
    i, cmd, x, y, polys, cur = 0, None, 0.0, 0.0, [], []

    def num():
        nonlocal i
        v = float(toks[i])
        i += 1
        return v

    while i < len(toks):
        if re.match(r"[a-zA-Z]", toks[i]):
            cmd = toks[i]
            i += 1
            if cmd in "zZ":
                if cur:
                    polys.append(cur)
                    x, y = cur[0]
                    cur = []
                continue
        if cmd == "m":
            x += num()
            y += num()
            cur = [(x, y)]
            cmd = "l"
        elif cmd == "l":
            x += num()
            y += num()
            cur.append((x, y))
        elif cmd == "v":
            y += num()
            cur.append((x, y))
        elif cmd == "h":
            x += num()
            cur.append((x, y))
        elif cmd == "c":
            x1, y1, x2, y2, x3, y3 = (num() for _ in range(6))
            p0 = (x, y)
            p1 = (x + x1, y + y1)
            p2 = (x + x2, y + y2)
            p3 = (x + x3, y + y3)
            for k in range(1, 9):
                t = k / 8
                u = 1 - t
                cur.append((u**3*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t**3*p3[0],
                            u**3*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t**3*p3[1]))
            x, y = p3
        else:
            raise SystemExit(f"a path command this does not read: {cmd}")
    if cur:
        polys.append(cur)
    return [[(px + TX, py + TY) for px, py in poly] for poly in polys]


ART = flatten(D_ART)


def winding(px, py):
    """How many times the outline goes around a point: 0 is outside the art."""
    w = 0
    for poly in ART:
        n = len(poly)
        for k in range(n):
            x0, y0 = poly[k]
            x1, y1 = poly[(k + 1) % n]
            if y0 <= py:
                if y1 > py and (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0) > 0:
                    w += 1
            elif y1 <= py and (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0) < 0:
                w -= 1
    return w


# ------------------------------------------------------- the center line
# x, y, half width. From the end at the lower right wing to the end at the
# upper left one.
PTS = [
    # the pointed end, and the lower strand of the lower right wing
    (91, 104, 2.5), (96, 108.6, 3.4), (100, 111.9, 3.8), (105, 115.2, 4.6),
    (110, 117.9, 5.0), (115, 122.4, 3.6), (120, 124.2, 4.4), (126, 125.4, 6.2),
    (132, 124.8, 7.4), (137, 121.5, 8.6), (139.4, 116, 9.2), (139.6, 110, 9.4),
    (138, 103, 8.2), (135, 97.5, 7.4),
    # the small fold of the right: out along its lower edge, back along the upper
    (130, 93.2, 5), (124, 90.2, 2.6), (119, 87.6, 2.2), (115.4, 85.6, 2),
    (114.8, 84.6, 1.8),
    (117.5, 84.6, 1.8), (122, 86.3, 2.4), (128, 87.2, 5), (135, 88.6, 7.4),
    (140.5, 87, 9.6),
    # the upper right wing: up its right side, and over its top
    (143.6, 80.5, 10.9), (146, 72, 9), (146, 62, 7.8), (145.2, 52, 7.2),
    (143.2, 41, 6.4), (140, 30, 5.9), (135.6, 19.5, 5.4), (131, 12.5, 4),
    (126.5, 9, 3.2), (120.5, 7.4, 5), (112, 8.6, 9.3),
    # the long diagonal
    (104.5, 15.5, 9.4), (98.6, 27.5, 8.7), (93.6, 42.5, 7.7), (90.2, 56.5, 7.4),
    (88.3, 67.5, 7.2), (86.5, 82.5, 6.9), (84.2, 98, 7.4), (82, 108.5, 8.3),
    (80, 119, 9.1), (77, 131.5, 9.8), (72.6, 141.5, 10.6), (66, 149.5, 11.6),
    # the turn at the bottom, and up the left part
    (61, 155, 8), (55, 156.8, 6.6), (49, 153, 5.2), (44.2, 147.5, 6.6),
    (42.2, 140.5, 8.7), (42.4, 132.5, 10.6), (43.6, 125, 10.6),
    # the small fold of the left: out along its upper edge, back along the lower
    (45.4, 117, 8), (47.2, 111, 5.6), (53, 112.6, 2.6), (59, 114.6, 2.4),
    (63, 115.8, 2.2), (63.4, 117, 2),
    (60.5, 119.4, 2.4), (55, 121, 3.2), (48, 121.8, 4), (40, 122.4, 4.4),
    (33, 122.2, 3.8),
    # the upper left wing, to its end
    (27.2, 119.6, 3.8), (23.5, 114.4, 4.8), (16, 103, 6.6), (10.5, 89.5, 7.8),
    (8.3, 76, 8.3), (9.2, 64, 8.7), (13, 54.5, 8.9), (18.5, 48.5, 8.6),
    (24.5, 45.4, 7.7), (32, 45.6, 5.6), (40, 48.8, 3.4), (46, 53.6, 3.2),
    (51.5, 59.5, 4.6), (56.5, 65.5, 5.8), (61, 73.5, 6), (67, 82, 6),
]


def catmull(pts, per=14):
    """A smooth line through the points: `per` points of it for each of them."""
    out = []
    n = len(pts)
    for k in range(n - 1):
        p0 = pts[max(k - 1, 0)]
        p1 = pts[k]
        p2 = pts[k + 1]
        p3 = pts[min(k + 2, n - 1)]
        for j in range(per):
            t = j / per
            t2 = t * t
            t3 = t2 * t
            out.append(tuple(
                0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * t + (2*p0[c] - 5*p1[c] + 4*p2[c] - p3[c]) * t2
                       + (-p0[c] + 3*p1[c] - 3*p2[c] + p3[c]) * t3)
                for c in range(3)))
    out.append(pts[-1])
    return out


def resample(dense, step):
    """Points at equal distances along a dense line: (x, y, half width, s),
    where s is the distance from the start of the line."""
    acc = [0.0]
    for a, b in zip(dense, dense[1:]):
        acc.append(acc[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    total = acc[-1]
    n = max(1, round(total / step))
    out, k = [], 0
    for m in range(n + 1):
        s = total * m / n
        while k < len(acc) - 2 and acc[k + 1] < s:
            k += 1
        seg = acc[k + 1] - acc[k]
        t = 0 if seg == 0 else (s - acc[k]) / seg
        a, b = dense[k], dense[k + 1]
        out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, s))
    return out, total


# The line, and its length.
LINE, LC = resample(catmull(PTS), 2.2)


def tangent(k):
    """The direction of the line at its point k."""
    a = LINE[max(k - 1, 0)]
    b = LINE[min(k + 1, len(LINE) - 1)]
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = math.hypot(dx, dy) or 1
    return dx / n, dy / n


# ---------------------------------------------------------------- the cells
OVER = 0.35  # how far a cell reaches into the next one: no seam between two
# The half width of the ribbon at each point of the line, on each side. They
# start as the widths placed by hand, and refine() fits them to the art.
WL = [p[2] for p in LINE]
WR = [p[2] for p in LINE]
CELLS = []   # (polygon, s at which the head has passed it)


def make_cells():
    CELLS.clear()
    for k in range(len(LINE) - 1):
        (x0, y0, _, s0), (x1, y1, _, s1) = LINE[k], LINE[k + 1]
        tx0, ty0 = tangent(k)
        tx1, ty1 = tangent(k + 1)
        ax, ay = x0 - tx0 * OVER, y0 - ty0 * OVER
        bx, by = x1 + tx1 * OVER, y1 + ty1 * OVER
        quad = [(ax - ty0 * WL[k], ay + tx0 * WL[k]), (ax + ty0 * WR[k], ay - tx0 * WR[k]),
                (bx + ty1 * WR[k + 1], by - tx1 * WR[k + 1]), (bx - ty1 * WL[k + 1], by + tx1 * WL[k + 1])]
        CELLS.append((quad, s1))


def in_quad(q, px, py):
    inside = False
    for k in range(4):
        x0, y0 = q[k]
        x1, y1 = q[(k + 1) % 4]
        if (y0 > py) != (y1 > py) and px < (x1 - x0) * (py - y0) / (y1 - y0) + x0:
            inside = not inside
    return inside


def art_points(step=0.8):
    """The points of a grid that are in the art."""
    pts = []
    y = step / 2
    while y < H:
        x = step / 2
        while x < W:
            if winding(x, y) != 0:
                pts.append((x, y))
            x += step
        y += step
    return pts


def missed_points(pts):
    """The points that are in no cell."""
    return [p for p in pts if not any(in_quad(q, *p) for q, _ in CELLS)]


def widen(missed, grow=5.0):
    """Widen the ribbon where a point of the art is next to it, and not in it."""
    for px, py in missed:
        best = None
        for k, (x, y, _, _) in enumerate(LINE):
            tx, ty = tangent(k)
            along = (px - x) * tx + (py - y) * ty
            if abs(along) > 1.2:
                continue
            side = -(px - x) * ty + (py - y) * tx   # > 0: the left side
            cur = WL[k] if side > 0 else WR[k]
            need = abs(side) + 0.7
            if need - cur > grow:
                continue                            # another strand: not this one
            if best is None or need - cur < best[0]:
                best = (need - cur, k, side, need)
        if best:
            _, k, side, need = best
            for j in range(max(0, k - 1), min(len(LINE), k + 2)):
                if side > 0:
                    WL[j] = max(WL[j], need)
                else:
                    WR[j] = max(WR[j], need)


def cache_file():
    """Where the widths are kept from one run to the next: a file of the
    temporary folder of the system, named by this file and by the art, so a
    change of either measures the ribbon again."""
    key = hashlib.sha256(Path(__file__).read_bytes() + D_ART.encode("utf8")).hexdigest()[:16]
    return Path(tempfile.gettempdir()) / f"cho-logo-ribbon-{key}.json"


def refine(verbose=False):
    """Fit the widths of the ribbon to the art, so the cells cover it.

    Returns the points of the art that are still in no cell. It takes about 15
    seconds, once: the widths are kept in a file (see cache_file).
    """
    cache = cache_file()
    if cache.exists():
        data = json.loads(cache.read_text())
        WL[:] = data["WL"]
        WR[:] = data["WR"]
        make_cells()
        return [tuple(p) for p in data["left"]]
    print("measuring the ribbon: about 15 seconds, once", file=sys.stderr)
    missed = []
    for step in (0.8, 0.45):
        pts = art_points(step)
        for turn in range(5):
            missed = missed_points(pts)
            if verbose:
                print("grid", step, "turn", turn, "points", len(pts), "not covered", len(missed))
            if not missed:
                break
            widen(missed)
            make_cells()
    # a little more, on each side: no thin line of the art is left out
    for k in range(len(LINE)):
        WL[k] += 0.3
        WR[k] += 0.3
    make_cells()
    cache.write_text(json.dumps({"WL": WL, "WR": WR, "left": missed}))
    return missed


make_cells()


# ------------------------------------------- what the animations share
def fmt(v):
    """A number of an SVG file: two decimals, and no zero at its end."""
    return f"{v:.2f}".rstrip("0").rstrip(".")


def cell_d(q):
    """A polygon, as the `d` of a path."""
    return "M" + "L".join(f"{fmt(x)} {fmt(y)}" for x, y in q) + "z"


def ease_time(ease, p):
    """The part of the duration at which an animation with the timing
    function cubic-bezier(ease) is at the progress p."""
    x1, y1, x2, y2 = ease
    bez = lambda u, a, b: 3 * (1 - u) ** 2 * u * a + 3 * (1 - u) * u * u * b + u ** 3
    lo, hi = 0.0, 1.0
    for _ in range(50):
        mid = (lo + hi) / 2
        if bez(mid, y1, y2) < p:
            lo = mid
        else:
            hi = mid
    return bez(lo, x1, x2)


def parser(name, about):
    """The arguments of a script that writes an animation: the file it
    writes (`out`), and a folder for still frames (`frames`, or None)."""
    out = argparse.ArgumentParser(description=about)
    out.add_argument("--out", type=Path, default=ASSETS / name,
                     help=f"the file to write (default: assets/{name})")
    out.add_argument("--frames", type=Path, metavar="FOLDER",
                     help="also write still frames of the animation to this folder, to look at")
    return out


def write_frames(folder, name, frames):
    """Write still frames, as <name>-00.svg, <name>-01.svg, and so on."""
    folder.mkdir(parents=True, exist_ok=True)
    for n, text in enumerate(frames):
        (folder / f"{name}-{n:02d}.svg").write_text(text, encoding="utf8")
    print(f"{len(frames)} frames in {folder}")


def write(out, text):
    out.write_text(text, encoding="utf8")
    print(f"{out}: {len(text.encode('utf8'))} bytes")


if __name__ == "__main__":
    print("the outline:", len(ART), "polygon of", [len(p) for p in ART], "points")
    print("the line:", round(LC, 1), "long, in", len(CELLS), "cells")
    left = refine(verbose=True)
    print("points of the art in no cell, before the last widening:", len(left),
          [(round(x, 1), round(y, 1)) for x, y in left[:30]])
