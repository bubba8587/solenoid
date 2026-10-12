# [[C121]]
"""A quick flag, not a gate: renders the engine's build of the graph flat (top-down, orthographic, at the
reference's scale) and puts it beside the app's own shot, with a diff, so a missing piece, an invented
border or a shifted row shows at a glance. Anti-aliasing and text rasterization will differ; structure must not.
  python scripts/motion/verify.py <capture dir> [state]
Writes <capture>/verify/engine.png and compare.png (app | engine | diff ×4).
"""
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
import engine  # noqa: E402

cap = os.path.abspath(sys.argv[1])
scene = engine.load(cap)
state = sys.argv[2] if len(sys.argv) > 2 else scene["reference"]["state"]
out = os.path.join(cap, "verify")
os.makedirs(out, exist_ok=True)

sc = engine.reset()
engine.build_flat(scene, state)
ref = scene["reference"]
engine.ortho_camera((ref["x"], ref["y"], ref["w"], ref["h"]), ref["scale"])
sc.cycles.samples = 16
sc.render.filepath = os.path.join(out, "engine.png")
bpy.ops.render.render(write_still=True)

a = np.asarray(Image.open(os.path.join(cap, scene["states"][state]["reference"])).convert("RGB")).astype(int)
b = np.asarray(Image.open(os.path.join(out, "engine.png")).convert("RGB")).astype(int)
h, w = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
a, b = a[:h, :w], b[:h, :w]
d = np.clip(np.abs(a - b) * 4, 0, 255).astype(np.uint8)
Image.fromarray(np.concatenate([a.astype(np.uint8), b.astype(np.uint8), d], axis=1)).save(os.path.join(out, "compare.png"))
err = np.abs(a - b).max(axis=2)
print(f"{state}: mean {np.abs(a - b).mean():.2f}/255, off >16: {(err > 16).mean() * 100:.2f}% of pixels → {os.path.join(out, 'compare.png')}")
