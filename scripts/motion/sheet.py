# [[C121]]
"""A generic spreadsheet for comparison clips, built as pieces like a card's: a formula bar, column letters, row
numbers, a grid, cell text, the selected cell, and the colored boxes a spreadsheet draws around the cells a
formula refers to while it is being edited. It is not Solenoid's UI, so it wears a neutral system font and
plain spreadsheet chrome, and it has its own timeline of states.

Spec (scene.json "sheet"): { x, y, cols: [width…] (the first is the row-number column), letters: ["A", …],
  rowH, size, rows: [[cell text per letter], …],
  states: [{ name, cells?: { "B4": "850" }, formula?, select?: "B4", edit?: bool, note?: str }, …] }
Each state starts from the one before. `formula` is what the formula bar shows (the selected cell's formula);
with `edit` the selected cell shows the formula too and every reference in it gets a colored box.
"""
import re

from shapely.geometry import box as rect

import fonts
import geometry as G

BG, GRID, HEAD, HEAD_INK, INK, SELECT, BAR = (31, 31, 31, 1), (58, 58, 58, 1), (41, 41, 41, 1), (154, 160, 166, 1), (232, 232, 232, 1), (30, 142, 90, 1), (24, 24, 24, 1)
# reference colors in the order a spreadsheet hands them out
REF = [(91, 155, 213, 1), (232, 80, 79, 1), (168, 110, 214, 1), (76, 175, 80, 1), (230, 160, 40, 1)]
REGULAR, BOLD = fonts.system_face("Inter:style=Regular"), fonts.system_face("Inter:style=SemiBold")
REF_RE = re.compile(r"\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?")


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
            out.append((G._rings_evenodd([{"pts": [(pen + px * k, baseline - py * k) for px, py in c]} for c in contours]), ch, pen))
        pen += a
    return out


def refs(formula):
    """The formula's references in order of first appearance, each with its color and character span."""
    seen, out = {}, []
    for m in REF_RE.finditer(formula or ""):
        key = m.group(0).replace("$", "")
        if key not in seen:
            seen[key] = REF[len(seen) % len(REF)]
        out.append((key, seen[key], m.start(), m.end(), m))
    return out


def numeric(v):
    return bool(re.fullmatch(r"-?[\d,]*\.?\d+%?|#[A-Z/0!?]+", v.strip())) if v else False


def states(spec):
    """Each named state's full cell map and view, carried forward from the state before."""
    cells = {}
    for r, row in enumerate(spec["rows"], 1):
        for letter, v in zip(spec["letters"], row):
            cells[f"{letter}{r}"] = v
    view = {"formula": "", "select": None, "edit": False}
    out = []
    for st in spec["states"]:
        cells = {**cells, **st.get("cells", {})}
        view = {**view, **{k: st[k] for k in ("formula", "select", "edit") if k in st}}
        out.append((st["name"], dict(cells), dict(view)))
    return out


def build(spec, cells, view):
    """The sheet in one state, as (geometry, rgba, part, glyph or None) in paint order, and its flow box."""
    x0, y0, rh, cols, size = spec["x"], spec["y"], spec["rowH"], spec["cols"], spec.get("size", 15)
    letters, nrows = spec["letters"], len(spec["rows"])
    W = sum(cols)
    bar_h = rh + 4
    gy = y0 + bar_h + 10
    H = rh * (nrows + 1)
    xs = [x0]
    for w in cols:
        xs.append(xs[-1] + w)
    col_of = {letter: i + 1 for i, letter in enumerate(letters)}

    def cell_box(ref):
        m = re.fullmatch(r"([A-Z]+)(\d+)", ref)
        c, r = col_of.get(m.group(1)), int(m.group(2))
        if c is None or r > nrows:
            return None
        return xs[c], gy + r * rh, xs[c + 1], gy + (r + 1) * rh

    out = [(rect(x0 - 10, y0 - 10, x0 + W + 10, gy + H + 10), BAR, "body", None)]
    # the formula bar, its references colored while editing
    formula = view["formula"] or ""
    out.append((rect(x0, y0, x0 + W, y0 + bar_h), BG, "bar", None))
    out.append((rect(x0, y0, x0 + W, y0 + bar_h).exterior.buffer(0.5), GRID, "bar", None))
    out += [(g, HEAD_INK, "bar", ch) for g, ch, _ in text("fx", x0 + 12, y0 + bar_h * 0.66, size - 2, BOLD)]
    spans = refs(formula) if view["edit"] else []

    def ink_at(i):
        for _, col, a, b, _ in spans:
            if a <= i < b:
                return col
        return INK

    # each glyph knows its character index, so a reference's characters take its color
    pen_items = text(formula, x0 + 44, y0 + bar_h * 0.66, size, REGULAR)
    visible = [i for i, ch in enumerate(formula) if ch.strip()]
    for (g, ch, _), i in zip(pen_items, visible):
        out.append((g, ink_at(i), "bar", ch))
    # the grid: backgrounds, headers, cells
    out.append((rect(x0, gy, x0 + W, gy + H), BG, "grid", None))
    out.append((rect(x0, gy, x0 + W, gy + rh), HEAD, "grid", None))
    out.append((rect(x0, gy, x0 + cols[0], gy + H), HEAD, "grid", None))
    for i, letter in enumerate(letters, 1):
        out += [(g, HEAD_INK, "grid", ch) for g, ch, _ in text(letter, xs[i], gy + rh * 0.66, size - 3, BOLD, "center", cols[i])]
    sel = view["select"]
    for r in range(1, nrows + 1):
        y = gy + r * rh
        out += [(g, HEAD_INK, "grid", ch) for g, ch, _ in text(str(r), xs[0], y + rh * 0.66, size - 3, BOLD, "right", cols[0] - 12)]
        for i, letter in enumerate(letters, 1):
            ref = f"{letter}{r}"
            v = cells.get(ref, "")
            if view["edit"] and ref == sel:
                # the cell being edited shows its formula, references colored, spilling right
                items = text(formula, xs[i] + 6, y + rh * 0.66, size, REGULAR)
                vis = [k for k, ch in enumerate(formula) if ch.strip()]
                out += [(g, ink_at(k), f"cell:{ref}", ch) for (g, ch, _), k in zip(items, vis)]
                continue
            out += [(g, INK, f"cell:{ref}", ch) for g, ch, _ in text(v, xs[i] + 8, y + rh * 0.66, size, REGULAR, "right" if numeric(v) else "left", cols[i] - 16)]
    for x in xs:
        out.append((rect(x - 0.5, gy, x + 0.5, gy + H), GRID, "grid", None))
    for r in range(nrows + 2):
        y = gy + r * rh
        out.append((rect(x0, y - 0.5, x0 + W, y + 0.5), GRID, "grid", None))
    # reference boxes while editing: a colored outline over each referenced cell or range
    for key, col, _, _, m in spans:
        a = cell_box(f"{m.group(1)}{m.group(2)}")
        b = cell_box(f"{m.group(3)}{m.group(4)}") if m.group(3) else a
        if a and b:
            box = rect(min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))
            out.append((box, (*col[:3], 0.12), f"ref:{key}", None))
            out.append((box.exterior.buffer(1.0), col, f"ref:{key}", None))
    if sel:
        s = cell_box(sel)
        if s:
            out.append((rect(*s).exterior.buffer(1.25), SELECT, "select", None))
    return out, {"x": x0 - 10, "y": y0 - 10, "w": W + 20, "h": gy + H + 20 - (y0 - 10)}


def layout(spec):
    """Where each cell and the formula bar sit, in flow px: { "B4": [x, y, w, h], …, "bar": [x, y, w, h] }."""
    x0, y0, rh, cols = spec["x"], spec["y"], spec["rowH"], spec["cols"]
    bar_h = rh + 4
    gy = y0 + bar_h + 10
    xs = [x0]
    for w in cols:
        xs.append(xs[-1] + w)
    out = {"bar": [x0 + 44, y0, sum(cols) - 44, bar_h]}
    for r in range(1, len(spec["rows"]) + 1):
        for i, letter in enumerate(spec["letters"], 1):
            out[f"{letter}{r}"] = [xs[i], gy + r * rh, cols[i], rh]
    return out
