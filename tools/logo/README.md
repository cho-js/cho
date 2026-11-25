# The animations of the logo

The logo of CHO, `assets/cho-logo.svg`, is one ribbon that draws a butterfly.
The scripts here read that file, and write three animations of it to `assets/`:

| Script      | Writes                         | What is seen                                                        | Plays       |
| ----------- | ------------------------------ | ------------------------------------------------------------------- | ----------- |
| `stripe.py` | `assets/cho-logo-animated.svg` | A stripe comes in from the left, and settles as the logo            | once        |
| `ring.py`   | `assets/cho-logo-ring.svg`     | The ribbon is a ring, that flows into the butterfly, and back       | with no end |
| `draw.py`   | `assets/cho-logo-draw.svg`     | The ribbon is drawn from its open end, in the left wing, to its tip | once        |

`ribbon.py` is what the three share: it is not run to write a file.

```sh
python3 tools/logo/stripe.py
python3 tools/logo/ring.py
python3 tools/logo/draw.py
```

They need Python 3, and nothing else: no package is installed. They were run
with Python 3.14.

A script writes the same file, byte for byte, as long as nothing was changed. So
after a change, `git diff assets/` shows what the change did.

## Arguments

| Argument          | What it does                                                         | Scripts   |
| ----------------- | -------------------------------------------------------------------- | --------- |
| `--out FILE`      | Writes to this file, and not to `assets/`                            | all       |
| `--frames FOLDER` | Also writes still frames of the animation to this folder, to look at | all       |
| `--check`         | Also counts the points of the art that the ribbon leaves out         | `draw.py` |

The still frames are SVG files, with a white background, four times the size of
the logo: `stripe-00.svg`, `stripe-01.svg`, and so on. Open them in a browser.

## How the ribbon is found

The art of the logo is one filled outline. Nothing in the file says it is a
ribbon, so `ribbon.py` says it:

- **A center line**, `PTS`: about 80 points placed by hand, from the pointed end
  of the ribbon, in the lower right wing, to its open end, in the upper left
  one. Each has the half width of the ribbon there. A smooth line goes through
  them, and is cut every 2.2 units: it is about 649 units long.
- **Cells**: the ribbon is cut across that line, in about 295 pieces. Showing
  the cells in order draws the ribbon from one end to the other.
- **Widths**: the widths placed by hand are a start. `refine()` widens the
  ribbon until its cells cover the art.

Measuring the widths takes about 15 seconds. It is done once: they are kept in a
file of the temporary folder of the system, named by `ribbon.py` and by the art.
A change of either measures again.

## How each animation works

### `stripe.py`

The stripe is a line with a stroke, shown little by little with
`stroke-dashoffset`. It comes in level, and goes down to the pointed end of the
ribbon. From there the logo itself is shown, through a mask: each cell of the
ribbon is a shape of the mask, that appears when the head of the stripe passes
it. The last shape of the mask is the whole picture, so the end is the logo,
exactly.

It is CSS. With `prefers-reduced-motion`, the logo is shown, and nothing moves.

### `ring.py`

The outline of the logo goes along one edge of the ribbon, and back along the
other. Each point of it gets its place along the ribbon, and the same point of
the ring is at that place around a circle: the inner circle for one edge, the
outer one for the other. The two shapes have the same points, in the same order,
and the browser moves each point from one to the other.

The ribbon of the logo is a figure eight, and a ring is not: on the way, the
left wing turns over.

It is SMIL (`<animate>`), which a file cannot turn off: it does not follow
`prefers-reduced-motion`. A program that runs no SMIL shows the logo.

### `draw.py`

As `stripe.py`, with no stripe: the cells of the mask appear from the open end
of the ribbon to the pointed one. The open end is a slanted cut, so the first
lines across the ribbon are slanted as the cut is, and turn, little by little,
square to the ribbon. Each cell fades in for as long as the head takes to cross
it, so the head moves evenly.

It is CSS. With `prefers-reduced-motion`, or in a program that runs no
animation, the logo is shown.

## What to change

Each script has its numbers at its top:

| Script      | Numbers                                  | What they are                                           |
| ----------- | ---------------------------------------- | ------------------------------------------------------- |
| `stripe.py` | `DURATION`, `DELAY`, `EASE`              | The time, the wait before it, and the timing function   |
|             | `BAND`, `ENTRY_Y`, `DELTA`               | The width of the stripe, its height, where it joins     |
| `ring.py`   | `REST_RING`, `FLOW`, `REST_LOGO`, `EASE` | The seconds of each part of the loop, and the timing    |
|             | `R`, `BAND`, `OVERLAP`                   | The radius of the ring, its width, how its ends overlap |
| `draw.py`   | `DURATION`, `DELAY`, `EASE`              | The time, the wait before it, and the timing function   |
|             | `SPAN`                                   | The length over which the slanted start turns square    |

## When the logo changes

The scripts read the outline from `assets/cho-logo.svg`, and the rest is placed
by hand, for this drawing:

- `PTS`, the center line, in `ribbon.py`;
- the size of the logo and the place of its drawing, in `ribbon.py`: a logo file
  with other numbers stops the scripts, with a message;
- the two corners of the open end, `CUT_INNER` and `CUT_TIP`, in `draw.py`;
- the pointed end, `(92.8, 105.8)`, in `ring.py`;
- the colors of the gradient, in each script.
