# [[C121]]
"""Glyph outlines for the engine, from the same font files the app ships (@fontsource-variable), pinned to the
weight Chrome used. A character the face lacks falls back the way Chrome's does on Linux (fontconfig).
"""
import functools
import os
import subprocess

from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FACES = {
    "Atkinson Hyperlegible Next Variable": "atkinson-hyperlegible-next",
    "Atkinson Hyperlegible Next": "atkinson-hyperlegible-next",
    "Atkinson Hyperlegible Mono Variable": "atkinson-hyperlegible-mono",
    "Atkinson Hyperlegible Mono": "atkinson-hyperlegible-mono",
}


class _Flatten(BasePen):
    """Contours as point lists, curves flattened finely enough for 4K close-ups."""

    def __init__(self, glyphset, steps=10):
        super().__init__(glyphset)
        self.contours, self.cur, self.steps = [], None, steps

    def _moveTo(self, p):
        self.cur = [p]
        self.contours.append(self.cur)

    def _lineTo(self, p):
        self.cur.append(p)

    def _qCurveToOne(self, p1, p2):
        p0 = self.cur[-1]
        for i in range(1, self.steps + 1):
            t = i / self.steps
            a, b, c = (1 - t) ** 2, 2 * (1 - t) * t, t * t
            self.cur.append((a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]))

    def _curveToOne(self, p1, p2, p3):
        p0 = self.cur[-1]
        for i in range(1, self.steps + 1):
            t = i / self.steps
            a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
            self.cur.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))

    def _closePath(self):
        pass

    _endPath = _closePath


@functools.lru_cache(None)
def _face(path, weight):
    f = TTFont(path)
    if "fvar" in f:
        f = instancer.instantiateVariableFont(f, {"wght": weight})
    f.flavor = None
    return f


@functools.lru_cache(None)
def _fallback_path(ch):
    out = subprocess.run(["fc-match", "-f", "%{file}", f"sans-serif:charset={ord(ch):x}"], capture_output=True, text=True).stdout
    return out.strip() or None


def _candidates(family, italic):
    pkg = FACES.get(family)
    if not pkg:
        return []
    d = os.path.join(ROOT, "node_modules", "@fontsource-variable", pkg, "files")
    style = "italic" if italic else "normal"
    return [os.path.join(d, f"{pkg}-{sub}-wght-{style}.woff2") for sub in ("latin", "latin-ext")]


@functools.lru_cache(None)
def glyph(family, weight, italic, ch):
    """(contours in em units with y up, units per em, face file) for one character; None if nothing has it."""
    paths = [p for p in _candidates(family, italic) if os.path.exists(p)]
    fb = _fallback_path(ch)
    if fb:
        paths.append(fb)
    for p in paths:
        f = _face(p, weight)
        name = f.getBestCmap().get(ord(ch))
        if not name:
            continue
        gs = f.getGlyphSet()
        pen = _Flatten(gs)
        gs[name].draw(pen)
        return [c for c in pen.contours if len(c) > 2], f["head"].unitsPerEm, os.path.basename(p)
    return None
