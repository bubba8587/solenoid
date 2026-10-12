---
name: motion
description: Make motion graphics of Solenoid's node cards in Blender, built from the live app's own geometry (boxes, borders, SVG frames, sockets, icons, glyphs, cables) so cards can be taken apart and assembled on camera, with the rest frame checked against the app. Use when asked for animated or 3D shots of cards, a motion clip, or to add a clip.
---

# Motion graphics

`scripts/motion/` rebuilds cards in Blender from what the running app draws, never from a hand-made copy
([[C121]] motionFromAppGeometry, under [[B3]] sameNodeEverywhere). The app does the layout; the engine only
moves the pieces. Plain screen recordings of the app stay with the `demo-video` skill.

| File | Job |
|---|---|
| `capture.mjs` | Loads a graph into the dev app at zoom 1 and reads every card as paint-ordered pieces: box backgrounds, border rings (per-corner radii, per-side widths), SVG fills and strokes (frames, sockets, icons, CSS-mask icons, clip-paths, overflow clips), the slider thumb from its CSS rule, and each glyph at Chrome's own pen position. Also the cables' real paths and strokes, the canvas colors and dot spacing, and a reference screenshot per state. A `sweep` captures one state per step of a value. |
| `engine.py` | Turns the capture into Blender objects: one flat emission mesh per piece (shapely for strokes, rings and clips; glyphs from the app's own `@fontsource-variable` files pinned to Chrome's weight), parented per card with `rest`, `order`, `part` and `el` on each piece. Cables are ribbons with `reveal` and `pulse` inputs. |
| `fonts.py` | Glyph outlines from the woff2 files, instanced at the weight; fontconfig fallback for characters the face lacks. |
| `verify.py` | A flat orthographic render of the build beside the app's screenshot, plus a diff. A flag to look at, not a pixel gate. |
| `clips/<name>.py` | One clip each: build, choreography, camera, render. `--check` renders the last frame's scene flat and holds it against the app's shot of the final state; every run prints the rest check (how far any piece ends from its rest place). |
| `scenes/<name>.json` | The graph a clip captures (shot-graph short form, with x/y) and its states or sweep. |

## Set up (once per machine or container)

1. Dev server deps: `npm ci`.
2. A Python venv with Blender as a module and the geometry libraries:
   `python3 -m venv .dev/motion/venv && .dev/motion/venv/bin/pip install bpy shapely fonttools brotli pillow numpy`
   (`bpy` matches the venv's Python: 5.2 wants 3.13; the wheel is ~400 MB). Cycles renders on the CPU with no GPU or
   EGL; Eevee is not used.
3. `ffmpeg` for the encode.

## Run it

```
node scripts/motion/capture.mjs scripts/motion/scenes/order-total.json --out .dev/motion/order-total
PY=.dev/motion/venv/bin/python
$PY scripts/motion/verify.py .dev/motion/order-total            # look at verify/compare.png
$PY scripts/motion/clips/order_total.py .dev/motion/order-total .dev/motion/order-total/frames --check
$PY scripts/motion/clips/order_total.py .dev/motion/order-total .dev/motion/order-total/frames [--frames a-b] [--samples 32] [--scale 50] [--threads n]
ffmpeg -framerate 60 -i .dev/motion/order-total/frames/f_%04d.png -c:v libx264 -crf 14 -preset slow -pix_fmt yuv420p -movflags +faststart order-total.mp4
```

A frame takes ~15 s at 1080p with 32 samples on 4 cores; split a long clip across processes with `--frames` and
`--threads`. Test at `--scale 50 --samples 16` first and tile the stills: you can't watch video, so pull frames at
the moments that matter.

## Rules that keep a rebuild honest

- **Layout comes from the app.** If a piece looks wrong, fix the reader (`capture.mjs`), never the engine output
  by hand. The ones that bit: CSS paint order (positioned elements paint after flow content, and an auto-z one's
  positioned children join its parent's stack), SVG `overflow: hidden`, mask icons with their own transform, a
  `var()` color resolved inside an `<input>`.
- **Display-referred.** Colors go in as sRGB values with the Raw view transform, so translucent strokes blend as
  Chrome blends them. Light above 1.0 (cable pulses) is the only thing the bloom touches.
- **A value that changes on camera is a captured state**, laid out by the app, swapped in by `hide_render` keys.
- **Every clip ends at rest** and passes `--check`; the rest check must print 0.
- Never scale a piece to exactly 0 (Cycles renders the singular transform as giant black triangles); keep the
  camera looking at least ~45° down or the horizon shows past the canvas.

Renders and captures live in `.dev/motion/` (gitignored). A finished clip is committed only on the author's word.
