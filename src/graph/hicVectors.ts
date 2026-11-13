// [[A1]] visualGraphCalculator, [[html-in-canvas]]
// Mechanics: [[html-in-canvas#Cables and overlays on the canvas]]. Every SVG the viewport draws outside the cards (cables,
// ribbons, standoff bars, drawn cables) is copied onto the canvas as vectors in world coordinates, so nothing stays live DOM.

/** One stroked or filled shape, its path already in world coordinates. */
export interface VShape {
  path: Path2D;
  stroke: string | null;
  fill: string | null;
  /** World units, so it scales with the zoom as the DOM's stroke does. */
  width: number;
  alpha: number;
  dash: number[] | null;
  cap: CanvasLineCap;
  join: CanvasLineJoin;
}

const SHAPES = "path, line, circle, ellipse, rect, polyline, polygon";

const num = (el: Element, a: string): number => parseFloat(el.getAttribute(a) ?? "0") || 0;

/** A shape element's geometry as path data in its own user space; null for one that draws nothing. */
export function shapeD(tag: string, get: (attr: string) => number, raw: (attr: string) => string | null): string | null {
  switch (tag) {
    case "path": return raw("d");
    case "line": return `M ${get("x1")} ${get("y1")} L ${get("x2")} ${get("y2")}`;
    case "circle": {
      const cx = get("cx"), cy = get("cy"), r = get("r");
      return r > 0 ? `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z` : null;
    }
    case "ellipse": {
      const cx = get("cx"), cy = get("cy"), rx = get("rx"), ry = get("ry");
      return rx > 0 && ry > 0 ? `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z` : null;
    }
    case "rect": {
      const x = get("x"), y = get("y"), w = get("width"), h = get("height");
      return w > 0 && h > 0 ? `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z` : null;
    }
    case "polyline":
    case "polygon": {
      const pts = (raw("points") ?? "").trim().split(/[\s,]+/).map(Number);
      if (pts.length < 4 || pts.some((n) => !Number.isFinite(n))) return null;
      let d = `M ${pts[0]} ${pts[1]}`;
      for (let i = 2; i + 1 < pts.length; i += 2) d += ` L ${pts[i]} ${pts[i + 1]}`;
      return tag === "polygon" ? d + " Z" : d;
    }
    default: return null;
  }
}

/** A paint that shows: not `none`, not fully transparent. */
export function visiblePaint(css: string): string | null {
  const v = css.trim();
  if (!v || v === "none" || v === "transparent") return null;
  const m = /^rgba?\(([^)]*)\)$/.exec(v);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length === 4 && parseFloat(parts[3]) === 0) return null;
  }
  return v;
}

/** Every visible shape under `root`, with `toWorld` mapping screen px to world. The canvas layer hides and mutes a layer at `root` only (htmlCanvasLayer.css), so everything below it reads as the DOM shows it, and `root`'s own opacity is left out. */
export function snapshotVectors(root: Element, toWorld: DOMMatrix): VShape[] {
  const out: VShape[] = [];
  for (const el of root.querySelectorAll<SVGGraphicsElement>(SHAPES)) {
    if (el.closest("defs, clipPath, mask, marker, pattern, foreignObject")) continue;
    const cs = getComputedStyle(el);
    const stroke = visiblePaint(cs.stroke);
    const fill = visiblePaint(cs.fill);
    if (!stroke && !fill) continue;
    if (cs.visibility !== "visible" || el.getClientRects().length === 0) continue;
    let alpha = 1;
    for (let e: Element | null = el; e && e !== root; e = e.parentElement) alpha *= parseFloat(getComputedStyle(e).opacity) || 0;
    if (stroke) alpha *= parseFloat(cs.strokeOpacity) || 0;
    else alpha *= parseFloat(cs.fillOpacity) || 0;
    if (alpha <= 0) continue;
    const d = shapeD(el.tagName.toLowerCase(), (a) => num(el, a), (a) => el.getAttribute(a));
    const ctm = el.getScreenCTM();
    if (!d || !ctm) continue;
    const m = toWorld.multiply(DOMMatrix.fromMatrix(ctm));
    const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
    const path = new Path2D();
    path.addPath(new Path2D(d), m);
    const width = (parseFloat(cs.strokeWidth) || 0) * scale;
    // A draw-on reveal normalizes its dash to `pathLength`, which the canvas has no equivalent for; it draws the cable whole.
    const dashCss = el.hasAttribute("pathLength") ? "none" : cs.strokeDasharray;
    const dash = dashCss && dashCss !== "none" ? dashCss.split(/[\s,]+/).map((s) => (parseFloat(s) || 0) * scale) : null;
    out.push({
      path, stroke, fill: fill && el.tagName.toLowerCase() !== "line" ? fill : null, width, alpha,
      dash: dash && dash.some((n) => n > 0) ? dash : null,
      cap: (cs.strokeLinecap as CanvasLineCap) || "butt",
      join: (cs.strokeLinejoin as CanvasLineJoin) || "miter",
    });
  }
  return out;
}

/** A shape's style as a key, so shapes that share one stroke as one path. */
export function styleKey(s: Omit<VShape, "path">): string {
  return `${s.stroke}|${s.fill}|${s.width.toFixed(3)}|${s.alpha.toFixed(3)}|${s.dash?.join(",") ?? ""}|${s.cap}|${s.join}`;
}
