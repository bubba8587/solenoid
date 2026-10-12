# [[C121]]
"""Order total, ~9.5 s at 60 fps: four cards assemble from an exploded stack of their own layers, the cables
draw on with hot heads, the Discount slider sweeps 0.15 → 0.40 through the app's own states (thumb, value and
the hero total all as the app laid them out), and the camera settles straight on with a long lens so the
last frame is the graph exactly at rest.
  python scripts/motion/clips/order_total.py <capture dir> <out dir> [--frames a-b] [--samples n] [--scale pct] [--check]
--check renders the last frame's scene through an orthographic camera and holds it against the app's own
shot of the final state (the built cards must come to rest as the app draws them).
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import engine  # noqa: E402

S = engine.S
FPS = 60
args = sys.argv[1:]
cap, out = os.path.abspath(args[0]), os.path.abspath(args[1])
opt = lambda k, d=None: args[args.index(k) + 1] if k in args else d  # noqa: E731
os.makedirs(out, exist_ok=True)


def F(t):
    return int(round(t * FPS)) + 1


def ease(t):
    t = min(1, max(0, t))
    return 4 * t * t * t if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2


# ---- timeline (seconds) ----
CARD_START = {"Unit price": 0.12, "Quantity": 0.62, "Discount": 0.94, "Order total": 1.40}
WAVE, PIECE = 0.95, 0.55
CABLE_START, CABLE_STAGGER, CABLE_DRAW = 3.05, 0.16, 0.75
SWEEP = (4.55, 7.15)
END = 9.6

sc = engine.reset()
sc.frame_start, sc.frame_end = 1, F(END)
scene = engine.load(cap)
names = list(scene["states"])
base = scene["states"][names[0]]
ref = scene["reference"]

# ---- build: the first state whole, then each later state's own pieces, hidden until its turn ----
cards, pieces = {}, {}
for c in base["cards"]:
    root, ps = engine.build_card(c)
    cards[c["title"]], pieces[c["title"]] = (root, c), ps
base_keys = {c["title"]: [engine.prim_key(p) for p in c["prims"]] for c in base["cards"]}
by_state = {names[0]: {t: ps for t, ps in pieces.items()}}
for name in names[1:]:
    st = scene["states"][name]
    by_state[name] = {}
    for c in st["cards"]:
        root, _ = cards[c["title"]]
        keys = set(base_keys[c["title"]])
        keep = {i for i, p in enumerate(c["prims"]) if engine.prim_key(p) not in keys}
        if keep:
            _, ps = engine.build_card(c, tag=f"@{name}", keep=keep, root=root)
            by_state[name][c["title"]] = ps
# which base pieces each state replaces
replaced = {}
for name in names[1:]:
    st = scene["states"][name]
    for c in st["cards"]:
        keys = {engine.prim_key(p) for p in c["prims"]}
        for ob in pieces[c["title"]]:
            if base_keys[c["title"]][ob["prim"]] not in keys:
                replaced.setdefault(ob.name, set()).add(name)

cables = [engine.cable(f"cable:{e['id']}:{j}", layer) for e in base["cables"] for j, layer in enumerate(e["layers"])]
engine.canvas(scene["background"], (ref["x"] - 60000, ref["y"] - 60000, ref["w"] + 120000, ref["h"] + 120000))


def key(ob, path, frame):
    ob.keyframe_insert(path, frame=frame)


def set_interp(ob, interp, easing):
    """Blender 5 keeps fcurves in action slots/layers; set every key's interpolation on this object."""
    ad = ob.animation_data
    if not ad or not ad.action:
        return
    curves = []
    if hasattr(ad.action, "layers"):
        for layer in ad.action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    curves.extend(bag.fcurves)
    else:
        curves = ad.action.fcurves
    for fc in curves:
        for kp in fc.keyframe_points:
            kp.interpolation, kp.easing = interp, easing


# ---- cards assemble: an exploded stack (each layer lifted by its paint order) drops into place, top to
# bottom; panels unfold, glyphs type across, sockets pop ----
for title, ps in pieces.items():
    root, c = cards[title]
    bx, by, bw, bh = c["box"]["x"], c["box"]["y"], c["box"]["w"], c["box"]["h"]
    t_card = CARD_START[title]
    n = max(p["order"] for p in ps) + 1
    for ob in ps:
        cx, cy = ob["center"]
        u, v = (cy - by) / bh, (cx - bx) / bw
        w_, h_ = ob["size"]
        big = w_ * h_ > 0.35 * bw * bh or (w_ > 0.9 * bw and ob["kind"] in ("border", "stroke") and h_ > 0.5 * bh)
        rest = Vector(ob["rest"])
        if big:  # the card body and its frame unfold from the header line down
            t0 = t_card
            ob.scale = (1, 1e-3, 1)
            ob.location = rest + Vector((0, (bh / 2 - (cy - by)) * S, 0))
            key(ob, "scale", F(t0)); key(ob, "location", F(t0))
            ob.scale = (1, 1, 1); ob.location = rest
            key(ob, "scale", F(t0 + 0.42)); key(ob, "location", F(t0 + 0.42))
            set_interp(ob, "EXPO", "EASE_OUT")
            continue
        t0 = t_card + 0.12 + WAVE * u + (0.30 if ob.get("glyph") else 0.10) * v
        lift = 0.35 + 1.9 * ob["order"] / n
        spread = Vector(((cx - (bx + bw / 2)) * S * 0.35, -(cy - (by + bh / 2)) * S * 0.35, lift))
        ob.location = rest + spread
        ob.scale = (1e-3, 1e-3, 1e-3)
        ob.rotation_euler = (0, 0, (0.35 if ob.get("glyph") else 0.12) * (1 if ob["order"] % 2 else -1))
        for p_ in ("location", "scale", "rotation_euler"):
            key(ob, p_, F(t0))
        ob.location, ob.scale, ob.rotation_euler = rest, (1, 1, 1), (0, 0, 0)
        dur = 0.32 if ob.get("glyph") else PIECE
        for p_ in ("location", "scale", "rotation_euler"):
            key(ob, p_, F(t0 + dur))
        set_interp(ob, "BACK" if ob["part"] == "socket" else "EXPO", "EASE_OUT")

# ---- cables draw on from the source, a hot head riding the tip, then running off the end ----
for i, cb in enumerate(cables):
    nt = cb.data.materials[0].node_tree
    reveal, pulse = nt.nodes["reveal"].outputs[0], nt.nodes["pulse"].outputs[0]
    t0 = CABLE_START + i * CABLE_STAGGER
    for t, r, p in ((0, 0, -1), (t0, 0, -0.2), (t0 + CABLE_DRAW, 1, 1.0), (t0 + CABLE_DRAW + 0.35, 1, 1.4)):
        reveal.default_value, pulse.default_value = r, p
        reveal.keyframe_insert("default_value", frame=F(t))
        pulse.keyframe_insert("default_value", frame=F(t))
    cb["src_t0"] = t0

# ---- the sweep: state by state, as the app lays each one out; a pulse runs down the Discount cable on each
# step, so the change is seen to travel to the total ----
n_states = len(names)
switch = {}
for f in range(F(SWEEP[0]), F(SWEEP[1]) + 1):
    t = (f - F(SWEEP[0])) / (F(SWEEP[1]) - F(SWEEP[0]))
    switch[f] = min(n_states - 1, int(round(ease(t) * (n_states - 1))))
changes = [(f, k) for f, k in sorted(switch.items()) if f == F(SWEEP[0]) or switch.get(f - 1) != k]


def show(ob, frames_on):
    """hide_render keyed per state change: visible exactly on the frames in `frames_on` (a predicate)."""
    last = None
    for f in [1] + [f for f, _ in changes] + [F(END) + 1]:
        vis = frames_on(f)
        if vis != last:
            ob.hide_render = not vis
            ob.keyframe_insert("hide_render", frame=f)
            last = vis


def state_at(f):
    if f < F(SWEEP[0]):
        return names[0]
    return names[switch.get(f, n_states - 1)]


for name, per in by_state.items():
    if name == names[0]:
        continue
    for title, ps in per.items():
        for ob in ps:
            show(ob, lambda f, name=name: state_at(f) == name)
for title, ps in pieces.items():
    for ob in ps:
        if ob.name in replaced:
            show(ob, lambda f, gone=replaced[ob.name]: state_at(f) not in gone)

db = cards["Discount"][1]["box"]
disc_cables = [cb for cb in cables if db["x"] <= cb["ends"][0][0] <= db["x"] + db["w"] + 20 and db["y"] <= cb["ends"][0][1] <= db["y"] + db["h"]]
for cb in disc_cables:
    nt = cb.data.materials[0].node_tree
    pulse = nt.nodes["pulse"].outputs[0]
    t = SWEEP[0] - 0.05
    while t < SWEEP[1] + 0.2:
        for dt, p in ((0, -0.15), (0.42, 1.15)):
            pulse.default_value = p
            pulse.keyframe_insert("default_value", frame=F(t + dt))
        t += 0.30

# ---- camera: low and close across the cards, rising while the cables draw, then straight on, the lens
# lengthening as it backs off so the last frame is near-orthographic ----
gx, gy, gw, gh = ref["x"], ref["y"], ref["w"], ref["h"]
center = Vector(((gx + gw / 2) * S, -(gy + gh / 2) * S, 0))
hero = cards["Order total"][1]["hero"] or cards["Order total"][1]["box"]
hero_c = Vector(((hero["x"] + hero["w"] / 2) * S, -(hero["y"] + hero["h"] / 2) * S, 0))
db_ = cards["Discount"][1]["box"]
disc_c = Vector(((db_["x"] + db_["w"] / 2) * S, -(db_["y"] + db_["h"] * 0.72) * S, 0))
mid = (disc_c + hero_c) / 2
cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
sc.collection.objects.link(cam)
sc.camera = cam
cam.rotation_mode = "QUATERNION"
cam_data.dof.use_dof = True
cam_data.clip_start, cam_data.clip_end = 0.05, 3000
sens_h = 36 * 9 / 16
final_lens = 180
final = center + Vector((0, 0, final_lens * gh * S * 1.06 / sens_h))
first = cards["Unit price"][1]["box"]
first_c = Vector(((first["x"] + first["w"] / 2) * S, -(first["y"] + first["h"] / 2) * S, 0))
pq = Vector(((first["x"] + 150) * S, -(first["y"] + 170) * S, 0))
# (time, camera, look-at, lens mm, f-stop)
SHOTS = [
    (0.0, first_c + Vector((-0.9, -1.9, 2.3)), first_c + Vector((0.2, 0.3, 0)), 28, 1.0),
    (1.5, pq + Vector((-1.7, -3.2, 3.7)), pq + Vector((0.6, 0.2, 0)), 30, 1.1),
    (2.7, center + Vector((-1.4, -4.4, 5.0)), center + Vector((0.2, 0.3, 0)), 34, 1.3),
    (3.9, center + Vector((0.4, -4.0, 6.2)), center + Vector((0.4, 0.1, 0)), 40, 1.6),
    (4.7, mid + Vector((1.0, -3.1, 6.3)), mid + Vector((0.25, 0, 0)), 42, 1.6),
    (7.0, mid + Vector((0.2, -2.3, 5.8)), mid + Vector((0.35, 0.05, 0)), 46, 1.9),
    (8.4, final, center, final_lens, 16),
    (END, final, center, final_lens, 16),
]


def hermite(ts, vals, t):
    """Catmull-Rom through (ts, vals), clamped at the ends, eased in time between keys."""
    if t <= ts[0]:
        return vals[0]
    if t >= ts[-1]:
        return vals[-1]
    i = max(k for k in range(len(ts) - 1) if ts[k] <= t)
    u = (t - ts[i]) / (ts[i + 1] - ts[i])
    p0, p1, p2, p3 = vals[max(i - 1, 0)], vals[i], vals[i + 1], vals[min(i + 2, len(vals) - 1)]
    u2, u3 = u * u, u * u * u
    return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3)


def look_quat(loc, look):
    """Camera looking at `look` with world +Y kept as screen up (no roll flips over the top)."""
    f = (look - loc).normalized()
    up = Vector((0, 1, 0))
    up = (up - up.dot(f) * f).normalized()
    right = f.cross(up)
    from mathutils import Matrix
    m = Matrix((right, up, -f)).transposed()
    return m.to_quaternion()


ts = [k[0] for k in SHOTS]
for f in range(1, F(END) + 1):
    t = (f - 1) / FPS
    loc = hermite(ts, [k[1] for k in SHOTS], t)
    look = hermite(ts, [k[2] for k in SHOTS], t)
    lens = math.exp(hermite(ts, [math.log(k[3]) for k in SHOTS], t))
    fstop = math.exp(hermite(ts, [math.log(k[4]) for k in SHOTS], t))
    cam.location, cam.rotation_quaternion = loc, look_quat(loc, look)
    cam_data.lens, cam_data.dof.aperture_fstop = lens, fstop
    cam_data.dof.focus_distance = (look - loc).length
    cam.keyframe_insert("location", frame=f)
    cam.keyframe_insert("rotation_quaternion", frame=f)
    cam_data.keyframe_insert("lens", frame=f)
    cam_data.dof.keyframe_insert("aperture_fstop", frame=f)
    cam_data.dof.keyframe_insert("focus_distance", frame=f)
set_interp(cam, "LINEAR", "AUTO")
set_interp(cam_data, "LINEAR", "AUTO")

# ---- look ----
sc.render.use_motion_blur = True
sc.render.motion_blur_shutter = 0.5
sc.cycles.samples = int(opt("--samples", 48))
sc.cycles.use_adaptive_sampling = True
sc.cycles.adaptive_threshold = 0.01
sc.render.resolution_percentage = int(opt("--scale", 100))
if opt("--threads"):
    sc.render.threads_mode, sc.render.threads = "FIXED", int(opt("--threads"))
comp = bpy.data.node_groups.new("bloom", "CompositorNodeTree")
comp.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
rl = comp.nodes.new("CompositorNodeRLayers")
gl = comp.nodes.new("CompositorNodeGlare")
gl.inputs["Type"].default_value = "Bloom"
gl.inputs["Threshold"].default_value = 1.0
gl.inputs["Strength"].default_value = 0.8
gl.inputs["Size"].default_value = 0.6
go = comp.nodes.new("NodeGroupOutput")
comp.links.new(rl.outputs["Image"], gl.inputs["Image"])
comp.links.new(gl.outputs["Image"], go.inputs[0])
sc.compositing_node_group = comp

# ---- the built cards must come to rest exactly: every piece back on its rest place at the last frame ----
sc.frame_set(F(END))
worst = 0.0
for ps in pieces.values():
    for ob in ps:
        worst = max(worst, (Vector(ob.location) - Vector(ob["rest"])).length, abs(1 - ob.scale.x), abs(1 - ob.scale.y), abs(ob.rotation_euler.z))
print(f"rest check: worst piece off rest by {worst:.2e} at frame {F(END)} (state {state_at(F(END))})")

if "--check" in args:
    # the final frame's scene, seen flat: hold it against the app's own shot of the final state
    import numpy as np
    from PIL import Image
    sc.compositing_node_group = None
    sc.render.use_motion_blur = False
    engine.ortho_camera((ref["x"], ref["y"], ref["w"], ref["h"]), ref["scale"])
    sc.cycles.samples = 16
    sc.render.filepath = os.path.join(out, "check-engine.png")
    bpy.ops.render.render(write_still=True)
    a = np.asarray(Image.open(os.path.join(cap, scene["states"][state_at(F(END))]["reference"])).convert("RGB")).astype(int)
    b = np.asarray(Image.open(sc.render.filepath).convert("RGB")).astype(int)
    h, w = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
    a, b = a[:h, :w], b[:h, :w]
    d = np.clip(np.abs(a - b) * 4, 0, 255).astype(np.uint8)
    Image.fromarray(np.concatenate([a.astype(np.uint8), b.astype(np.uint8), d], axis=1)).save(os.path.join(out, "check.png"))
    err = np.abs(a - b).max(axis=2)
    print(f"final frame vs app ({state_at(F(END))}): mean {np.abs(a - b).mean():.2f}/255, off >16: {(err > 16).mean() * 100:.2f}% → {os.path.join(out, 'check.png')}")
    sys.exit(0)

fr = opt("--frames")
a_, b_ = (int(x) for x in fr.split("-")) if fr else (sc.frame_start, sc.frame_end)
sc.render.filepath = os.path.join(out, "f_")
sc.render.image_settings.file_format = "PNG"
for f in range(a_, b_ + 1):
    sc.frame_set(f)
    sc.render.filepath = os.path.join(out, f"f_{f:04d}.png")
    if os.path.exists(sc.render.filepath) and "--force" not in args:
        continue
    bpy.ops.render.render(write_still=True)
