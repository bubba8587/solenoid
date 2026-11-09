# [[C121]]
"""The capture's pieces as flat geometry, in flow px (y down): every box, border ring, SVG fill and stroke,
slider part and glyph as a polygon the way the browser rasterizes it (CSS radii and border splits, SVG caps,
joins, miter limits and clips, glyph outlines from the app's own fonts at Chrome's pen positions), then
triangulated. No renderer here: export.py hands the triangles to the three.js player.
"""
import json
import math
import re

import shapely
from shapely.geometry import LinearRing, LineString, Polygon
from shapely.ops import triangulate as _delaunay, unary_union

import fonts


def rounded_rect(x, y, w, h, radii, seg=10):
    """CSS box with per-corner radii [tl, tr, br, bl] (each clamped to half the box)."""
    if w <= 0 or h <= 0:
        return None
    tl, tr, br, bl = (min(max(r, 0), w / 2, h / 2) for r in radii)
    pts = []

    def arc(cx, cy, r, a0):
        if r <= 0:
            pts.append((cx, cy))
            return
        for i in range(seg + 1):
            a = a0 + (math.pi / 2) * i / seg
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))

    arc(x + w - tr, y + tr, tr, -math.pi / 2)
    arc(x + w - br, y + h - br, br, 0)
    arc(x + bl, y + h - bl, bl, math.pi / 2)
    arc(x + tl, y + tl, tl, math.pi)
    return Polygon(pts)


def border_rings(p):
    """A CSS border as (polygon, color) pieces: the ring between the border box and the padding box, whose
    inner radii are the outer ones less the adjoining widths; one piece per side color."""
    b, rad, (wt, wr, wb, wl) = p["box"], p["radii"], p["widths"]
    outer = rounded_rect(b["x"], b["y"], b["w"], b["h"], rad)
    ix, iy, iw, ih = b["x"] + wl, b["y"] + wt, b["w"] - wl - wr, b["h"] - wt - wb
    inner_r = [max(0, rad[0] - max(wt, wl)), max(0, rad[1] - max(wt, wr)), max(0, rad[2] - max(wb, wr)), max(0, rad[3] - max(wb, wl))]
    inner = rounded_rect(ix, iy, iw, ih, inner_r)
    ring = outer.difference(inner) if inner is not None else outer
    cols = p["colors"]
    widths = p["widths"]
    if all(c == cols[0] for c in cols if c) and all(c for c, w in zip(cols, widths) if w > 0):
        return [(ring, cols[0])]
    # per side: the trapezoid between the border-box edge and the padding-box edge (CSS splits corners on
    # the line from outer to inner corner); together the four tile the ring.
    x0, y0, x1, y1 = b["x"], b["y"], b["x"] + b["w"], b["y"] + b["h"]
    ox0, oy0, ox1, oy1 = ix, iy, ix + iw, iy + ih
    quads = [
        [(x0, y0), (x1, y0), (ox1, oy0), (ox0, oy0)],
        [(x1, y0), (x1, y1), (ox1, oy1), (ox1, oy0)],
        [(x1, y1), (x0, y1), (ox0, oy1), (ox1, oy1)],
        [(x0, y1), (x0, y0), (ox0, oy0), (ox0, oy1)],
    ]
    out = []
    for q, c, w in zip(quads, cols, widths):
        if c and w > 0 and c[3] > 0:
            piece = ring.intersection(Polygon(q).buffer(0))
            if not piece.is_empty:
                out.append((piece, c))
    return out


def _rings_evenodd(subs):
    geo = None
    for s in subs:
        pts = s["pts"]
        if len(pts) < 3:
            continue
        poly = Polygon(pts).buffer(0)
        geo = poly if geo is None else geo.symmetric_difference(poly)
    return geo


def svg_geom(p):
    """An SVG fill or stroke as a polygon, as the browser rasterizes it (caps, joins, miter limit, clip)."""
    if p["kind"] == "fill":
        g = _rings_evenodd(p["subs"])
    else:
        cap = {"butt": "flat", "round": "round", "square": "square"}.get(p["cap"], "flat")
        join = {"miter": "mitre", "round": "round", "bevel": "bevel"}.get(p["join"], "mitre")
        parts = []
        for s in p["subs"]:
            pts = s["pts"]
            if len(pts) < 2:
                continue
            closed = s["closed"] or (len(pts) > 2 and math.dist(pts[0], pts[-1]) < 1e-3)
            line = LinearRing(pts) if closed and len(pts) > 2 else LineString(pts)
            parts.append(line.buffer(p["width"] / 2, cap_style=cap, join_style=join, mitre_limit=p.get("miter") or 4, quad_segs=8))
        g = unary_union(parts) if parts else None
    if g is not None and p.get("clip"):
        g = g.intersection(Polygon(p["clip"]).buffer(0))
    return g


def glyph_geom(ch, x, baseline, font):
    """One character's outline at Chrome's pen position, from the face Chrome drew it with."""
    got = fonts.glyph(font["family"], font["weight"], font["italic"], ch)
    if not got:
        return None
    contours, upm, _ = got
    k = font["size"] / upm
    return _rings_evenodd([{"pts": [(x + px * k, baseline - py * k) for px, py in c]} for c in contours])



def piece_list(c):
    """A card's paint as (geometry, rgba, prim, glyph char or None) in paint order. Text splits into glyphs."""
    out = []
    for p in c["prims"]:
        k = p["kind"]
        if k == "box":
            out.append((rounded_rect(p["box"]["x"], p["box"]["y"], p["box"]["w"], p["box"]["h"], p["radii"]), p["color"], p, None))
        elif k == "border":
            for g, col in border_rings(p):
                out.append((g, col, p, None))
        elif k in ("fill", "stroke"):
            out.append((svg_geom(p), p["color"], p, None))
        elif k == "text":
            for chd in p["chars"]:
                out.append((glyph_geom(chd["ch"], chd["x"], chd.get("y", p["baseline"]), p["font"]), p["color"], p, chd["ch"]))
    return out



def prim_key(p):
    """A prim's identity across states: everything but the element index, rounded."""
    def r(v):
        if isinstance(v, float):
            return round(v, 2)
        if isinstance(v, list):
            return [r(x) for x in v]
        if isinstance(v, dict):
            return {k: r(x) for k, x in v.items() if k != "el"}
        return v
    return json.dumps(r(p), sort_keys=True)


def element_path(c, el):
    """The element chain from the card root to `el`, as class lists — for clips to group pieces by part."""
    chain = []
    while el >= 0:
        e = c["elements"][el]
        chain.append(e)
        el = e["parent"]
    return list(reversed(chain))


def part_of(c, el):
    """The card part a piece belongs to, by the nearest ancestor that names one."""
    names = [
        ("react-flow__handle", "socket"),
        ("solenoid-node__header", "header"),
        ("solenoid-node__frame-head", "header"),
        ("solenoid-node__frame", "frame"),
        ("solenoid-node__display-value", "hero"),
        ("solenoid-node__io-row--hero", "hero"),
        ("solenoid-segbtn", "segbtn"),
        ("solenoid-expr__rendered", "formula"),
        ("solenoid-node__io-row", "row"),
        ("solenoid-node__value-input", "input"),
        ("solenoid-slider-node-range", "slider"),
    ]
    for e in reversed(element_path(c, el)):
        for cls, name in names:
            if cls in e["cls"]:
                return name
    return "body"


def triangles(geom):
    """A polygon (holes allowed) → (vertices, faces), vertices in flow px."""
    if geom is None or geom.is_empty:
        return [], []
    tris = []
    for poly in getattr(geom, "geoms", [geom]):
        if poly.geom_type != "Polygon" or poly.area < 1e-6:
            continue
        try:
            tris.extend(shapely.constrained_delaunay_triangles(poly).geoms)
        except shapely.errors.GEOSException:
            # a near-degenerate ring (a glyph's hairline, a sliver of a clip): plain Delaunay over its
            # vertices, kept where the triangle sits inside the shape
            tris.extend(t for t in _delaunay(poly) if poly.contains(t.representative_point()))
    verts, index, faces = [], {}, []
    for t in tris:
        f = []
        for c in list(t.exterior.coords)[:3]:
            key = (round(c[0], 3), round(c[1], 3))
            if key not in index:
                index[key] = len(verts)
                verts.append(key)
            f.append(index[key])
        if len(set(f)) == 3:
            faces.append(f)
    return verts, faces


def cable_vertices(layer):
    """The path's corners when it is straight segments (M/L, as cablePaths draws), else its samples."""
    d = layer["d"]
    if re.fullmatch(r"[\sML\d.,eE+-]+", d):
        nums = [float(v) for v in re.findall(r"-?[\d.]+(?:e-?\d+)?", d)]
        pts = list(zip(nums[0::2], nums[1::2]))
    else:
        pts = [tuple(p) for p in layer["points"]]
    out = [pts[0]]
    for p in pts[1:]:
        if math.dist(p, out[-1]) > 1e-6:
            out.append(p)
    return out


def ribbon(layer):
    """An SVG stroke as a ribbon: butt caps, miter joins, one quad per segment sharing the miter vertices so a
    translucent cable never doubles at a bend. Returns (vertices, u along the length 0..1, faces)."""
    pts = cable_vertices(layer)
    hw = layer["width"] / 2
    n = len(pts)
    dirs = []
    for i in range(n - 1):
        dx, dy = pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]
        L = math.hypot(dx, dy)
        dirs.append((dx / L, dy / L))
    cum = [0.0]
    for i in range(1, n):
        cum.append(cum[-1] + math.dist(pts[i - 1], pts[i]))
    verts, us = [], []
    for i, p in enumerate(pts):
        if i == 0 or i == n - 1:
            d = dirs[0] if i == 0 else dirs[-1]
            nx, ny, k = -d[1], d[0], 1.0
        else:
            a, b = dirs[i - 1], dirs[i]
            mx, my = -(a[1] + b[1]), a[0] + b[0]
            ml = math.hypot(mx, my) or 1
            nx, ny = mx / ml, my / ml
            k = 1 / max(0.2, nx * -a[1] + ny * a[0])
        verts += [(p[0] + nx * hw * k, p[1] + ny * hw * k), (p[0] - nx * hw * k, p[1] - ny * hw * k)]
        us += [cum[i] / cum[-1]] * 2
    faces = [f for i in range(n - 1) for f in ((2 * i, 2 * i + 2, 2 * i + 3), (2 * i, 2 * i + 3, 2 * i + 1))]
    return verts, us, faces, pts
