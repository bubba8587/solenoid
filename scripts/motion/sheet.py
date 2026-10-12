# [[C121]]
"""A generic spreadsheet for comparison clips, built as pieces like a card's: a formula bar, column letters, row
numbers, a grid, cell text and a selected cell. It is not Solenoid's UI, so it wears a neutral system font and
plain spreadsheet chrome. Its cells take per-state overrides, keyed by the graph's state names, so it changes
in step with the graph (and, being a spreadsheet, with no visible path from cause to effect).

Spec (scene.json "sheet"): { x, y, cols: [width…] (first is the row-number column), letters: ["A", …], rowH,
  rows: [[label, value], …], formula, selected: [row, col] (1-based, col 1 = A), states: { name: { "B3": "16%" } } }
"""
from shapely.geometry import box as rect

import fonts
import geometry as G

BG, GRID, HEAD, HEAD_INK, INK, SELECT, BAR = (31, 31, 31, 1), (58, 58, 58, 1), (41, 41, 41, 1), (154, 160, 166, 1), (232, 232, 232, 1), (30, 142, 90, 1), (24, 24, 24, 1)
REGULAR, BOLD = fonts.system_face("Inter:style=Regular"), fonts.system_face("Inter:style=SemiBold")


def text(s, x, baseline, size, path, align="left", width=0):
    """Glyph polygons for s set in the font at `path`, aligned left, right or center within [x, x + width]."""
    adv = []
    for ch in s:
        g = fonts.face_glyph(path, ch)
        adv.append((g[1] / g[2]) * size if g else size * 0.3)
    pen = x + {"right": width - sum(adv), "center": (width - sum(adv)) / 2}.get(align, 0)
    out = []
    for ch, a in zip(s, adv):
        g = fonts.face_glyph(path, ch)
        if g and ch.strip():
            contours, _, upm = g
            k = size / upm
            out.append((G._rings_evenodd([{"pts": [(pen + px * k, baseline - py * k) for px, py in c]} for c in contours]), ch))
        pen += a
    return out


def build(spec, state):
    """The sheet in one state, as (geometry, rgba, part, glyph or None) in paint order."""
    cells = {}
    for r, (label, value) in enumerate(spec["rows"], 1):
        cells[f"A{r}"], cells[f"B{r}"] = label, value
    cells.update(spec.get("states", {}).get(state, {}))
    x0, y0, rh, cols = spec["x"], spec["y"], spec["rowH"], spec["cols"]
    W = sum(cols)
    bar_h = rh + 6
    grid_y = y0 + bar_h + 8
    H = rh * (len(spec["rows"]) + 1)
    out = [(rect(x0 - 10, y0 - 10, x0 + W + 10, grid_y + H + 10), BAR, "body", None)]
    # formula bar
    out.append((rect(x0, y0, x0 + W, y0 + bar_h), BG, "bar", None))
    out.append((rect(x0, y0, x0 + W, y0 + bar_h).exterior.buffer(0.5), GRID, "bar", None))
    out += [(g, HEAD_INK, "bar", ch) for g, ch in text("fx", x0 + 12, y0 + bar_h * 0.66, 13, BOLD)]
    out += [(g, INK, "bar", ch) for g, ch in text(spec["formula"], x0 + 44, y0 + bar_h * 0.66, 14, REGULAR)]
    # headers, cells
    out.append((rect(x0, grid_y, x0 + W, grid_y + H), BG, "grid", None))
    out.append((rect(x0, grid_y, x0 + W, grid_y + rh), HEAD, "grid", None))
    out.append((rect(x0, grid_y, x0 + cols[0], grid_y + H), HEAD, "grid", None))
    xs = [x0]
    for w in cols:
        xs.append(xs[-1] + w)
    for i, letter in enumerate(spec["letters"], 1):
        out += [(g, HEAD_INK, "grid", ch) for g, ch in text(letter, xs[i], grid_y + rh * 0.66, 12, BOLD, "center", cols[i])]
    for r in range(1, len(spec["rows"]) + 1):
        y = grid_y + r * rh
        out += [(g, HEAD_INK, "grid", ch) for g, ch in text(str(r), xs[0], y + rh * 0.66, 12, BOLD, "right", cols[0] - 12)]
        for i, letter in enumerate(spec["letters"], 1):
            v = cells.get(f"{letter}{r}", "")
            numeric = v.replace(".", "").replace("%", "").replace(",", "").isdigit()
            out += [(g, INK, f"cell:{letter}{r}", ch) for g, ch in text(v, xs[i] + 8, y + rh * 0.66, 14, REGULAR, "right" if numeric else "left", cols[i] - 16)]
    for x in xs:
        out.append((rect(x - 0.5, grid_y, x + 0.5, grid_y + H), GRID, "grid", None))
    for r in range(len(spec["rows"]) + 2):
        y = grid_y + r * rh
        out.append((rect(x0, y - 0.5, x0 + W, y + 0.5), GRID, "grid", None))
    sr, sc = spec["selected"]
    sel = rect(xs[sc], grid_y + sr * rh, xs[sc + 1], grid_y + (sr + 1) * rh)
    out.append((sel.exterior.buffer(1.25), SELECT, "select", None))
    return out, {"x": x0 - 10, "y": y0 - 10, "w": W + 20, "h": grid_y + H + 20 - (y0 - 10)}
