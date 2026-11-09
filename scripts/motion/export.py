# [[C121]]
"""capture.mjs's scene.json → pieces.json for the three.js player: every piece of every card triangulated
once, in flow px, with its color, paint order, part and the states it belongs to. The first state is built
whole; a later state adds only the pieces it changes (the slider thumb, a value's glyphs) and names the
first-state pieces it replaces, so a clip swaps exactly what the app re-laid out.
  python scripts/motion/export.py <capture dir>
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import geometry as G  # noqa: E402

cap = os.path.abspath(sys.argv[1])
scene = json.load(open(os.path.join(cap, "scene.json")))
names = list(scene["states"])
base = scene["states"][names[0]]


# A piece's identity across states: its card, its prim (by content) and which of that prim's pieces it is (a glyph,
# a border side). Each identity is triangulated once; it records the states it shows in and its paint position in
# each, since a state that re-lays a card out moves other pieces through the stacking order.
registry = {}
pieces = []


def place(ident, name, si, i, geom, col, **meta):
    """Register one piece of one state: triangulated the first time its identity is seen."""
    if ident not in registry:
        verts, faces = G.triangles(geom)
        if not faces:
            registry[ident] = None
            return
        minx, miny, maxx, maxy = geom.bounds
        cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
        piece = {
            **meta, "order": i, "color": [round(v, 4) for v in col], "center": [round(cx, 3), round(cy, 3)],
            "size": [round(maxx - minx, 3), round(maxy - miny, 3)],
            "verts": [round(v, 3) for x, y in verts for v in (x - cx, y - cy)], "faces": [i for f in faces for i in f],
            "state": name if si else None, "in": [], "orderIn": {},
        }
        registry[ident] = piece
        pieces.append(piece)
    piece = registry[ident]
    if piece is not None:
        piece["in"].append(name)
        piece["orderIn"][name] = i


for si, name in enumerate(names):
    for c in scene["states"][name]["cards"]:
        seen = {}
        for i, (geom, col, p, ch) in enumerate(G.piece_list(c)):
            k = G.prim_key(p)
            seen[k] = seen.get(k, -1) + 1
            place((c["title"], k, seen[k]), name, si, i, geom, col, card=c["title"], kind=p["kind"], part=G.part_of(c, p["el"]),
                  depth=len(G.element_path(c, p["el"])), glyph=ch)

# a comparison spreadsheet, when the scene has one: a pseudo-card of its own, matched across states the same way
sheet_card, sheet_states = None, []
if scene.get("sheet"):
    import sheet
    for si, (name, cells, view) in enumerate(sheet.states(scene["sheet"])):
        sheet_states.append(name)
        items, box = sheet.build(scene["sheet"], cells, view)
        for i, (geom, col, part, ch) in enumerate(items):
            place(("Spreadsheet", part, ch, tuple(round(v, 2) for v in geom.bounds), tuple(col)), name, si, i, geom, col,
                  card="Spreadsheet", kind="sheet", part=part, depth=0, glyph=ch)
    sheet_card = {"title": "Spreadsheet", "box": box, "hero": None, "cells": sheet.layout(scene["sheet"])}

# cables by path and color across states: a state that rewires the graph adds and drops cables
cable_reg = {}
cables = []
for name in names:
    for e in scene["states"][name]["cables"]:
        for layer in e["layers"]:
            key = (layer["d"], tuple(layer["color"]))
            if key not in cable_reg:
                verts, us, faces, pts = G.ribbon(layer)
                cable_reg[key] = {"id": e["id"], "color": layer["color"], "verts": [round(v, 3) for xy in verts for v in xy], "u": [round(u, 5) for u in us], "faces": [i for f in faces for i in f], "ends": [list(pts[0]), list(pts[-1])], "length": sum(((pts[i][0] - pts[i - 1][0]) ** 2 + (pts[i][1] - pts[i - 1][1]) ** 2) ** 0.5 for i in range(1, len(pts))), "in": []}
                cables.append(cable_reg[key])
            if name not in cable_reg[key]["in"]:
                cable_reg[key]["in"].append(name)

# every card any state has (a popup is open in some states only), at its first box
all_cards, seen_titles = [], set()
for n in names:
    for c in scene["states"][n]["cards"]:
        if c["title"] not in seen_titles:
            seen_titles.add(c["title"])
            all_cards.append({"title": c["title"], "box": c["box"], "hero": c["hero"]})

out = {
    "states": [{"name": n, "value": scene["states"][n].get("value"), "reference": scene["states"][n]["reference"], "box": scene["states"][n].get("referenceBox", scene["reference"])} for n in names],
    "cards": all_cards + ([sheet_card] if sheet_card else []),
    "pieces": pieces, "cables": cables, "background": scene["background"], "reference": scene["reference"], "sheetStates": sheet_states,
}
json.dump(out, open(os.path.join(cap, "pieces.json"), "w"), separators=(",", ":"))
print(f"{len(pieces)} pieces ({sum(1 for p in pieces if p['state'])} state-only), {len(cables)} cables → {os.path.join(cap, 'pieces.json')}")
