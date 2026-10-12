---
name: motion
description: Make motion graphics of Solenoid's node cards with three.js, built from the live app's own geometry (boxes, borders, SVG frames, sockets, icons, glyphs, cables) so cards can be taken apart and assembled on camera, with the rest frame checked against the app. Use when asked for animated or 3D shots of cards, a motion clip, or to add a clip.
---

# Motion graphics

`scripts/motion/` rebuilds cards from what the running app draws, never from a hand-made copy
([[C121]] motionFromAppGeometry, under [[B3]] sameNodeEverywhere). The app does the layout; the player only
moves the pieces. Plain screen recordings of the app stay with the `demo-video` skill.

| File | Job |
|---|---|
| `capture.mjs` | Loads a graph into the dev app at zoom 1 and reads every card as pieces in CSS paint order: box backgrounds, border rings (per-corner radii, per-side widths), SVG fills and strokes (frames, sockets, icons, CSS-mask icons, clip-paths, overflow clips), the slider thumb from its CSS rule, and each glyph at Chrome's own pen position. Also the cables' real paths and strokes, the canvas colors and dot spacing, and a reference screenshot per state. A `sweep` captures one state per step of a value. |
| `geometry.py` | Each piece as a polygon the way the browser rasterizes it (shapely for strokes, rings, clips; glyphs from `fonts.py`), triangulated. |
| `fonts.py` | Glyph outlines from the app's own `@fontsource-variable` woff2 files, instanced at Chrome's weight; fontconfig fallback for characters the face lacks. |
| `export.py` | `scene.json` → `pieces.json`: every piece's triangles, color, order, part and state; later states add only the pieces they change. |
| `player.js` | The three.js player: pieces as flat meshes in paint order, cables as ribbons with `reveal`/`pulse`, the dot canvas as a shader. Each frame averages N renders jittered across the lens aperture, the shutter and the pixel: real depth of field, motion blur and anti-aliasing. Light above 1.0 (pulses) blooms. |
| `clips/<name>.js` | One clip each: `setup()` returns `pose(t)` (sets every piece and returns the camera shot) and `restError(t)`. Pure functions of time. |
| `render.mjs` | Headless Chromium on software WebGL, frames piped into ffmpeg. `--stills` for previews, `--check` for the rest check. |
| `scenes/<name>.json` | The graph a clip captures (shot-graph short form, with x/y) and its states or sweep. |

## Set up (once per machine or container)

`npm ci` (three is a dev dependency), `ffmpeg` on PATH, and a Python venv for the geometry:
`python3 -m venv .dev/motion/venv && .dev/motion/venv/bin/pip install shapely fonttools brotli`.

## Run it

```
node scripts/motion/capture.mjs scripts/motion/scenes/order-total.json --out .dev/motion/order-total
.dev/motion/venv/bin/python scripts/motion/export.py .dev/motion/order-total
node scripts/motion/render.mjs .dev/motion/order-total order-total --check          # rest check + check.png
node scripts/motion/render.mjs .dev/motion/order-total order-total --scale 50 --samples 2 --out draft.mp4    # a draft to watch first (~3 min)
node scripts/motion/render.mjs .dev/motion/order-total order-total --stills 0.6,3.4,5.5,9.6 --samples 8 --scale 50
node scripts/motion/render.mjs .dev/motion/order-total order-total --out order-total.mp4   # 1080p60
```

About 3 s a frame at 1080p with 16 samples on a 4-core container (no GPU). Preview with `--stills` at
`--scale 50 --samples 8` and tile the PNGs: you can't watch video, so look at the moments that matter.

## Rules that keep a rebuild honest

- **Layout comes from the app.** If a piece looks wrong, fix the reader (`capture.mjs`), never the geometry by
  hand. The ones that bit: CSS paint order (positioned elements paint after flow content, and an auto-z one's
  positioned children join its parent's stack), SVG `overflow: hidden`, mask icons with their own transform, a
  `var()` color resolved inside an `<input>`.
- **Display-referred.** Colors are their sRGB values and nothing converts them, so translucent strokes blend as
  Chrome blends them.
- **A value that changes on camera is a captured state**, laid out by the app and swapped in by visibility.
- **Every clip ends at rest** and passes `--check`: the rest check prints 0 and `check.png` (app | player | diff)
  shows the same cards.
- Keep the camera looking well down at the canvas, or the horizon shows past it.

Captures and renders live in `.dev/motion/` (gitignored). A finished clip is committed only on the author's word.
