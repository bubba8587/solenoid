# [[C121]]
"""Builds a captured graph (capture.mjs → scene.json) in Blender from the app's own geometry: every box,
border ring, SVG fill and stroke (frames, sockets, icons), slider part and glyph becomes its own flat mesh in
paint order, parented by card, so a clip can pull a card apart and put it back. Cables are ribbons on their
real paths; the canvas is a plane with the real dot grid. Run under Blender's Python (the `bpy` wheel, with
shapely and fonttools beside it).

Display-referred, like the browser: colors go in as their sRGB values and the view transform is Raw, so a
translucent cable or border blends on encoded values as Chrome blends it, not in linear light (where the
app's 72%-opacity gold cables would read ~20% brighter).
Units: one flow px is S Blender units; flow y runs down, Blender y up. Within a card, paint order i sits at
z = i * DZ, so a clip can explode a card along z and the flat stack is the app's stacking.
"""
import json
import math
import os
import re
import sys

import bpy
import shapely
from shapely.geometry import LinearRing, LineString, Polygon
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(__file__))
import fonts  # noqa: E402

S = 0.01
DZ = 0.0004
Z_CABLE = -0.002


def reset(width=1920, height=1080, fps=60):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.view_settings.view_transform = "Raw"
    sc.view_settings.look = "None"
    sc.display_settings.display_device = "sRGB"
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 0
    sc.cycles.transparent_max_bounces = 64
    sc.cycles.caustics_reflective = sc.cycles.caustics_refractive = False
    sc.render.dither_intensity = 0
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = width, height, 100
    sc.render.fps = fps
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    sc.world = bpy.data.worlds.new("void")
    sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs[1].default_value = 0
    return sc


# ---- materials -------------------------------------------------------------------------------------------

_mats = {}


def flat(rgba, name=None):
    """A flat emission of an sRGB color (0..255) at its CSS alpha. One material per color, shared; a clip that
    fades a part gives it its own copy (`own`)."""
    key = tuple(round(v, 4) for v in rgba)
    if key in _mats and name is None:
        return _mats[key]
    m = bpy.data.materials.new(name or "flat %d,%d,%d,%.3f" % tuple(key))
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (rgba[0] / 255, rgba[1] / 255, rgba[2] / 255, 1)
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    fade = nt.nodes.new("ShaderNodeValue")
    fade.name = "fade"
    fade.outputs[0].default_value = 1.0
    a = nt.nodes.new("ShaderNodeMath")
    a.operation = "MULTIPLY"
    a.inputs[1].default_value = rgba[3]
    nt.links.new(fade.outputs[0], a.inputs[0])
    nt.links.new(a.outputs[0], mix.inputs["Fac"])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    if name is None:
        _mats[key] = m
    return m


def own(ob):
    """Give an object its own copy of its material, so its `fade` can be keyframed alone."""
    m = ob.data.materials[0].copy()
    ob.data.materials[0] = m
    return m


# ---- 2D geometry (flow px, y down) -------------------------------------------------------------------------


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


# ---- meshes ----------------------------------------------------------------------------------------------


def mesh_from(geom, name):
    """A polygon (holes allowed) → a triangulated flat mesh in Blender units, centered on its bounds."""
    if geom is None or geom.is_empty:
        return None, None
    tris = []
    for poly in getattr(geom, "geoms", [geom]):
        if poly.geom_type != "Polygon" or poly.area < 1e-6:
            continue
        try:
            tris.extend(shapely.constrained_delaunay_triangles(poly).geoms)
        except shapely.errors.GEOSException:
            # a near-degenerate ring (a glyph's hairline, a sliver of a clip): plain Delaunay over its
            # vertices, kept where the triangle sits inside the shape
            from shapely.ops import triangulate
            tris.extend(t for t in triangulate(poly) if poly.contains(t.representative_point()))
    verts, index, faces = [], {}, []
    for t in tris:
        f = []
        for c in list(t.exterior.coords)[:3]:
            key = (round(c[0], 5), round(c[1], 5))
            if key not in index:
                index[key] = len(verts)
                verts.append(key)
            f.append(index[key])
        if len(set(f)) == 3:
            faces.append(f)
    if not faces:
        return None, None
    minx, miny, maxx, maxy = geom.bounds
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    me = bpy.data.meshes.new(name)
    me.from_pydata([((x - cx) * S, -(y - cy) * S, 0) for x, y in verts], [], faces)
    for poly in me.polygons:  # all faces toward the camera (+z)
        if poly.normal.z < 0:
            poly.flip()
    me.validate()
    return me, (cx, cy)


def obj(name, me, parent=None, loc=(0, 0, 0)):
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    ob.location = loc
    for attr in ("visible_diffuse", "visible_glossy", "visible_transmission", "visible_volume_scatter", "visible_shadow"):
        setattr(ob, attr, False)
    return ob


def empty(name, loc=(0, 0, 0), parent=None):
    ob = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    if parent is not None:
        ob.parent = parent
    return ob


# ---- cards -----------------------------------------------------------------------------------------------


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


def build_card(c, z0=0.0, tag="", keep=None, root=None):
    """One card: an empty at the card's center (flow box), every piece a child at its own place and paint
    depth. Each piece carries `el` (the element that painted it), `kind`, `glyph`, `order`, `part` and its
    rest place (`rest`) for clips to animate from and settle back to. `keep` limits it to some prims (by
    index), under an existing `root`: how a clip adds the pieces one state changes."""
    b = c["box"]
    cx, cy = b["x"] + b["w"] / 2, b["y"] + b["h"] / 2
    if root is None:
        root = empty(f"card:{c['title']}{tag}", (cx * S, -cy * S, z0))
        root["box"] = [b["x"], b["y"], b["w"], b["h"]]
    index = {id(p): i for i, p in enumerate(c["prims"])}
    pieces = []
    for i, (g, col, p, ch) in enumerate(piece_list(c)):
        if keep is not None and index[id(p)] not in keep:
            continue
        me, ctr = mesh_from(g, f"{c['title']}:{i}")
        if me is None:
            continue
        me.materials.append(flat(col))
        ob = obj(f"{c['title']}{tag}:{i}:{p['kind']}" + (f":{ch}" if ch else ""), me, root, ((ctr[0] - cx) * S, -(ctr[1] - cy) * S, (i + 1) * DZ))
        ob["el"], ob["kind"], ob["order"], ob["prim"], ob["part"] = p["el"], p["kind"], i, index[id(p)], part_of(c, p["el"])
        if ch:
            ob["glyph"] = ch
        ob["rest"] = list(ob.location)
        ob["center"] = list(ctr)
        minx, miny, maxx, maxy = g.bounds
        ob["size"] = [maxx - minx, maxy - miny]
        pieces.append(ob)
    return root, pieces


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


# ---- cables ----------------------------------------------------------------------------------------------


def _vertices(layer):
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


def cable(name, layer):
    """An SVG stroke as a ribbon mesh (butt caps, miter joins, shared corner vertices so a translucent cable
    never doubles at a bend). UV.x runs 0..1 along it, for the material's `reveal` and `pulse`."""
    pts = _vertices(layer)
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
    verts = []
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
        verts.append(((p[0] + nx * hw * k) * S, -(p[1] + ny * hw * k) * S, 0))
        verts.append(((p[0] - nx * hw * k) * S, -(p[1] - ny * hw * k) * S, 0))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], [(2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1) for i in range(n - 1)])
    uv = me.uv_layers.new()
    for f in me.polygons:
        for li in f.loop_indices:
            vi = me.loops[li].vertex_index
            uv.data[li].uv = (cum[vi // 2] / cum[-1], vi % 2)
        if f.normal.z < 0:
            f.flip()
    me.materials.append(cable_material(name, layer))
    ob = obj(name, me, loc=(0, 0, Z_CABLE))
    ob["length"] = cum[-1]
    ob["ends"] = [list(pts[0]), list(pts[-1])]
    return ob


def cable_material(name, layer, glow=(1.0, 0.86, 0.45)):
    """The cable's stroke (its CSS color at its opacity) plus two Value nodes to keyframe: `reveal`, how much
    of it is drawn from the source end (0..1), and `pulse`, where a hot head rides (off 0..1 to hide it). The
    head adds light above 1.0 only, so a glare thresholded at 1 blooms it and never the cards."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    N = nt.nodes.new
    L = nt.links.new

    def math_(op, a=None, b=None, name=None):
        n = N("ShaderNodeMath")
        n.operation = op
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L(v, n.inputs[i])
        if name:
            n.name = name
        return n.outputs[0]

    out = N("ShaderNodeOutputMaterial")
    sep = N("ShaderNodeSeparateXYZ")
    L(N("ShaderNodeUVMap").outputs["UV"], sep.inputs[0])
    u = sep.outputs["X"]
    reveal = N("ShaderNodeValue"); reveal.name = "reveal"; reveal.outputs[0].default_value = 1.0
    pulse = N("ShaderNodeValue"); pulse.name = "pulse"; pulse.outputs[0].default_value = -1.0
    width = N("ShaderNodeValue"); width.name = "pulse_width"; width.outputs[0].default_value = 0.05
    shown = math_("LESS_THAN", u, reveal.outputs[0])
    d = math_("DIVIDE", math_("SUBTRACT", u, pulse.outputs[0]), width.outputs[0])
    head = math_("EXPONENT", math_("MULTIPLY", math_("POWER", d, 2.0), -1.0))
    head = math_("MULTIPLY", head, shown)
    base = N("ShaderNodeEmission"); base.inputs["Color"].default_value = (layer["color"][0] / 255, layer["color"][1] / 255, layer["color"][2] / 255, 1)
    hot = N("ShaderNodeEmission"); hot.inputs["Color"].default_value = (*glow, 1)
    L(math_("MULTIPLY", head, 4.0, name="pulse_gain"), hot.inputs["Strength"])
    add = N("ShaderNodeAddShader")
    L(base.outputs[0], add.inputs[0]); L(hot.outputs[0], add.inputs[1])
    alpha = math_("MAXIMUM", math_("MULTIPLY", shown, layer["color"][3]), head)
    mix = N("ShaderNodeMixShader")
    L(alpha, mix.inputs["Fac"])
    L(N("ShaderNodeBsdfTransparent").outputs[0], mix.inputs[1])
    L(add.outputs[0], mix.inputs[2])
    L(mix.outputs[0], out.inputs["Surface"])
    return m


# ---- canvas ----------------------------------------------------------------------------------------------


def canvas(bg, extent):
    """The canvas plane: its color with a dot of `radius` on every multiple of `gap` (CanvasBacking.tsx),
    drawn procedurally so it stays crisp at any distance."""
    x, y, w, h = extent
    m = bpy.data.materials.new("canvas")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    N, L = nt.nodes.new, nt.links.new
    out = N("ShaderNodeOutputMaterial")
    geo = N("ShaderNodeNewGeometry")
    sep = N("ShaderNodeSeparateXYZ")
    L(geo.outputs["Position"], sep.inputs[0])

    def m_(op, a, b=None):
        n = N("ShaderNodeMath")
        n.operation = op
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L(v, n.inputs[i])
        return n.outputs[0]

    gap = bg["gap"] * S
    # distance to the nearest grid point, in flow px
    dx = m_("SUBTRACT", m_("MULTIPLY", m_("ROUND", m_("DIVIDE", sep.outputs["X"], gap)), gap), sep.outputs["X"])
    dy = m_("SUBTRACT", m_("MULTIPLY", m_("ROUND", m_("DIVIDE", sep.outputs["Y"], gap)), gap), sep.outputs["Y"])
    dist = m_("DIVIDE", m_("SQRT", m_("ADD", m_("POWER", dx, 2.0), m_("POWER", dy, 2.0))), S)
    dot = m_("LESS_THAN", dist, bg["radius"])
    mix = N("ShaderNodeMix")
    mix.data_type = "RGBA"
    L(dot, mix.inputs["Factor"])
    mix.inputs["A"].default_value = (*[v / 255 for v in bg["color"][:3]], 1)
    mix.inputs["B"].default_value = (*[v / 255 for v in bg["dot"][:3]], 1)
    em = N("ShaderNodeEmission")
    L(mix.outputs["Result"], em.inputs["Color"])
    L(em.outputs[0], out.inputs["Surface"])
    # a grid, not one quad: a single huge quad loses a triangle to precision at grazing angles
    n = 24
    verts = [((x + w * i / n) * S, -(y + h * j / n) * S, 0) for j in range(n + 1) for i in range(n + 1)]
    faces = [(j * (n + 1) + i, (j + 1) * (n + 1) + i, (j + 1) * (n + 1) + i + 1, j * (n + 1) + i + 1) for j in range(n) for i in range(n)]
    me = bpy.data.meshes.new("canvas")
    me.from_pydata(verts, [], faces)
    me.materials.append(m)
    ob = obj("canvas", me, loc=(0, 0, -0.01))
    return ob


# ---- cameras ---------------------------------------------------------------------------------------------


def ortho_camera(box, scale):
    """A top-down orthographic camera framing flow box (x, y, w, h) at `scale` render px per flow px."""
    sc = bpy.context.scene
    cam = bpy.data.cameras.new("ortho")
    cam.type = "ORTHO"
    x, y, w, h = box
    sc.render.resolution_x, sc.render.resolution_y = round(w * scale), round(h * scale)
    cam.sensor_fit = "HORIZONTAL" if w >= h else "VERTICAL"
    cam.ortho_scale = max(w, h) * S
    cam.clip_start, cam.clip_end = 0.01, 100
    ob = bpy.data.objects.new("ortho", cam)
    sc.collection.objects.link(ob)
    ob.location = ((x + w / 2) * S, -(y + h / 2) * S, 10)
    sc.camera = ob
    return ob


def load(capture_dir):
    return json.load(open(os.path.join(capture_dir, "scene.json")))


def build_flat(scene, state):
    """The whole graph at rest in one state: cards, cables, canvas. Returns (cards, cables, canvas)."""
    st = scene["states"][state]
    cards = {c["title"]: build_card(c) for c in st["cards"]}
    cables = [cable(f"cable:{e['id']}:{j}", layer) for e in st["cables"] for j, layer in enumerate(e["layers"])]
    ref = scene["reference"]
    cv = canvas(scene["background"], (ref["x"] - 6000, ref["y"] - 6000, ref["w"] + 12000, ref["h"] + 12000))
    return cards, cables, cv
