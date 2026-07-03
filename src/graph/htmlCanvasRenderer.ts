// HTML-in-Canvas renderer engine — the production core, framework-free so it can be
// driven by either the spike (HUD harness) or the real Canvas integration. It hands the
// browser the REAL node DOM (clones each node-view into a <canvas layoutsubtree>),
// captures it ONCE at a reference resolution, builds a mip pyramid of ImageBitmaps by
// pixel-downscaling that snapshot, and every frame drawImage's the level matching the
// zoom. Cables draw as one batched Path2D. Pan/zoom is just a camera transform — no DOM
// compositing, which is the whole point (see docs/renderer-decision.md, dev-notes
// 2026-06-27). Validated: 280 nodes, fully zoomed out, crisp → 165fps / 0.1–0.5ms draw.
//
// Requires the WICG HTML-in-Canvas API (ctx.drawElementImage / canvas.captureElementImage),
// Chrome-only behind chrome://flags/#canvas-draw-element. Gate construction on
// supportsHtmlInCanvas() — the engine assumes the API is present.

import { Camera } from "./pixi/pixiCamera";
import { cablePolyline } from "./pixi/pixiCableGeom";
import type { SnapCable } from "./pixi/pixiGraphSnapshot";
import type { CableShape } from "./cableShape";

// HMR: the engine is created imperatively (not a React component), so Vite would otherwise
// keep a STALE instance running after an edit to this file — code changes silently never
// apply until a manual full reload. Force a full reload on change so dev edits always take
// effect (this was the cause of "nothing I changed did anything").
if (import.meta.hot) import.meta.hot.accept(() => import.meta.hot?.invalidate());

// ── WICG HTML-in-Canvas typing (not in lib.dom yet) ──────────────────────────────
interface ElementImageLike { width: number; height: number; close?: () => void }
type Ctx2D = CanvasRenderingContext2D & {
  drawElementImage?: (el: Element | ElementImageLike, dx: number, dy: number, dw?: number, dh?: number) => DOMMatrix;
  reset?: () => void;
};
type LayoutCanvas = HTMLCanvasElement & {
  layoutSubtree?: boolean;
  requestPaint?: () => void;
  onpaint?: ((e: Event) => void) | null;
  captureElementImage?: (el: Element) => ElementImageLike;
};

// Reference capture resolution (CSS `zoom` on the clone). Kept at 1 so the clone lays out at
// true 1× — REF>1 supersamples for zoom-in crispness BUT rounds text line-boxes differently than
// the live DOM (a constant ~0.9px text drift, proven 2026-06-28). At 1 the cached texture is 1×,
// so zooming IN past 100% softens (upscaled capture); that's the accepted trade for faithful
// text/alignment. (A raster-time supersample to regain zoom-in crispness was tried but cost the
// validated build perf — reverted; see dev-notes. The crisp escape hatch is `live` mode.)
const REF: number = 1;
// Mip pyramid halves from REF down to ~MIP_MIN_PX. `scale` = texture px ÷ natural px.
const MIP_MIN_PX = 6;
// Default quality: target texture size ÷ on-screen size. 1 ≈ 1:1 (crisp). Validated free
// at the author's scale; tunable via setQuality. <1 = cheaper/softer.
const DEFAULT_QUALITY = 1.0;

/**
 * The mip-pyramid level `drawFrame` would pick for a given camera scale — the one
 * canonical "how far zoomed out are we, in discrete steps" computation. Exported
 * so anything gauging zoom "distance" (semantic zoom) keys off the SAME formula
 * the renderer already uses, rather than inventing a second raw-scale threshold
 * that would drift out of sync with it. Level i has scale REF/2^i; higher i = more
 * zoomed out. Pure — no renderer instance required.
 */
export function computeIdealMipLevel(scale: number, quality: number = DEFAULT_QUALITY, dpr: number = 1): number {
  const target = quality * scale * dpr;
  return Math.max(0, Math.floor(Math.log2(REF / Math.max(target, 1e-4))));
}
// Capture padding (CSS px). Sockets straddle the card edge (left/right:-5) and other chrome
// (focus rings, badges) overflow the body box, so we capture a PAD-inflated box and draw it
// back inflated. The node's x/y/w/h stay the CARD's (hit-test, cables, selection ring).
const PAD = 10;

/** A node to render. `el` is the live node-view inner element — the engine clones it. */
export interface EngineNodeSpec {
  id: string;
  el: HTMLElement;
  x: number; y: number; // world position (top-left)
  w: number; h: number; // natural CSS size
  isGroup: boolean;
}

interface PyramidLevel { scale: number; bmp: ImageBitmap }
interface EngineNode {
  id: string;
  refEl: HTMLElement;
  srcEl: HTMLElement; // the live original (diagnostics only — clone-vs-original position check)
  refImg: ElementImageLike | null;
  pyramid: PyramidLevel[];
  x: number; y: number; w: number; h: number;
  isGroup: boolean;
}
interface CableGeom { pts: { x: number; y: number }[]; minX: number; minY: number; maxX: number; maxY: number }
// A cable stored as offsets from its endpoint NODES, so it follows them live when they
// move — a socket's offset within its card is fixed, so endpoint = node.pos + offset. The
// absolute snapshot positions are kept as a fallback if an endpoint node isn't present.
interface CableSpec {
  sourceId: string; srcOffX: number; srcOffY: number; srcAbsX: number; srcAbsY: number; sourceAngleDeg: number | null;
  targetId: string; tgtOffX: number; tgtOffY: number; tgtAbsX: number; tgtAbsY: number; targetAngleDeg: number | null;
  color: string; // "#rrggbb" — source socket's data-type colour (DOM cable hue)
}

export interface RendererStats { fps: number; drawMs: number; visible: number; total: number; built: number; mip: number }

export class HtmlCanvasRenderer {
  readonly cam = new Camera();
  private readonly host: HTMLElement;
  private readonly canvas: LayoutCanvas;
  private readonly ctx: Ctx2D;
  private readonly scratch: LayoutCanvas;
  private readonly sctx: Ctx2D | null;

  private nodes: EngineNode[] = [];
  private readonly nodeById = new Map<string, EngineNode>();
  private cables: CableSpec[] = [];
  private cableGeoms: (CableGeom | null)[] = []; // parallel to `cables`; null = degenerate
  private cableShape: CableShape = "diagonal";
  private quality = DEFAULT_QUALITY;
  private dpr = 1;
  // Exact backing-store ÷ CSS-px ratio per axis (≈ dpr, but accounts for the integer rounding of
  // the backing store). The render CTM uses these, NOT dpr, so the canvas scale matches the DOM's.
  private bsx = 1;
  private bsy = 1;

  private dirty = true;
  private raf = 0;
  private captured = false;
  private building = false;
  private builtCount = 0;
  private disposed = false;

  // perf/HUD telemetry
  private lastDrawTs = 0;
  private fpsEMA = 0;
  private nVisible = 0;
  private lastFrameMs = 0;
  private curMip = 0;

  private selected = new Set<string>();
  private selectBox: { x: number; y: number; w: number; h: number } | null = null; // screen px
  // The renderer is the fast PAN/ZOOM layer. Active = draw the graph (during a gesture).
  // Inactive = clear to transparent so the real interactive DOM shows through (idle). The
  // canvas stays visible either way, so capture/paint keeps working in the background.
  private active = false;
  // Live mode: re-rasterize elements at the exact CTM each frame (pixel-identical to the DOM)
  // instead of blitting cached mip bitmaps. Faithful but costs a re-raster per visible node.
  private live = false;

  constructor(host: HTMLElement) {
    this.host = host;
    this.canvas = document.createElement("canvas") as LayoutCanvas;
    this.canvas.setAttribute("layoutsubtree", "");
    this.canvas.layoutSubtree = true;
    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d") as Ctx2D;

    this.scratch = document.createElement("canvas") as LayoutCanvas;
    this.scratch.setAttribute("layoutsubtree", "");
    this.sctx = this.scratch.getContext("2d") as Ctx2D | null;

    this.resize();
    // Paint event: capture (once) then a live draw. Drives the initial frame + capture.
    this.canvas.onpaint = this.onPaint;
    this.canvas.addEventListener("paint", this.onPaint as EventListener);
    this.raf = requestAnimationFrame(this.tick);
    if (this.canvas.requestPaint) this.canvas.requestPaint();
  }

  /** Camera transform from rete's area ({ k, x, y } in CSS px). */
  setTransform(scale: number, tx: number, ty: number): void {
    if (this.cam.scale === scale && this.cam.tx === tx && this.cam.ty === ty) return;
    this.cam.scale = scale; this.cam.tx = tx; this.cam.ty = ty;
    this.dirty = true;
  }

  setQuality(q: number): void { this.quality = q; this.dirty = true; }

  /** Draw the graph (true, during a pan/zoom gesture) or clear to transparent so the real
   *  interactive DOM shows through (false, idle). The canvas element stays visible so capture
   *  keeps working; only the contents toggle. */
  setActive(v: boolean): void {
    if (this.active === v) return;
    this.active = v;
    this.dirty = true;
  }

  /** Debug overlay: half-opacity canvas so it can be eyeballed ON TOP of the live DOM to
   *  measure any capture/position delta. */
  setDebug(on: boolean): void {
    this.canvas.style.opacity = on ? "0.5" : "";
  }

  /** Live (faithful) mode — re-rasterize per frame instead of cached bitmaps. */
  setLive(on: boolean): void { if (this.live !== on) { this.live = on; this.dirty = true; } }

  /** Which nodes draw a selection ring. No-ops when the set is unchanged. */
  setSelected(ids: Set<string>): void {
    if (ids.size === this.selected.size && [...ids].every((id) => this.selected.has(id))) return;
    this.selected = new Set(ids);
    this.dirty = true;
  }

  /** The live box-select rectangle in SCREEN px (or null to clear it). */
  setSelectBox(box: { x: number; y: number; w: number; h: number } | null): void {
    this.selectBox = box;
    this.dirty = true;
  }

  /** Ids of nodes whose world rect overlaps the given world rect (box-select). */
  nodesInWorldRect(r: { minX: number; minY: number; maxX: number; maxY: number }): string[] {
    const out: string[] = [];
    for (const n of this.nodes) {
      if (n.x + n.w >= r.minX && n.x <= r.maxX && n.y + n.h >= r.minY && n.y <= r.maxY) out.push(n.id);
    }
    return out;
  }

  /** Replace the whole node set (full rebuild). Clones each spec's element into the
   *  canvas, then captures + builds mips on the next paint. */
  setNodes(specs: EngineNodeSpec[]): void {
    this.releaseNodes();
    this.nodes = specs.map((s) => ({ id: s.id, refEl: this.cloneFor(s.el, s.w, s.h), srcEl: s.el, refImg: null, pyramid: [], x: s.x, y: s.y, w: s.w, h: s.h, isGroup: s.isGroup }));
    this.nodeById.clear();
    for (const n of this.nodes) this.nodeById.set(n.id, n);
    this.captured = false;
    this.builtCount = 0;
    this.dirty = true;
    if (this.canvas.requestPaint) this.canvas.requestPaint();
  }

  /** Re-capture a SUBSET of nodes at new geometry (e.g. groups that resized on tidy),
   *  leaving every other node's pyramid intact. Cheap vs a full setNodes rebuild. */
  updateNodes(specs: EngineNodeSpec[]): void {
    let changed = false;
    for (const s of specs) {
      const n = this.nodeById.get(s.id);
      if (!n) continue;
      n.x = s.x; n.y = s.y; n.w = s.w; n.h = s.h;
      n.refImg?.close?.(); n.refImg = null;
      for (const p of n.pyramid) p.bmp?.close?.();
      n.pyramid = [];
      n.refEl.remove();
      n.refEl = this.cloneFor(s.el, s.w, s.h);
      n.srcEl = s.el;
      changed = true;
    }
    if (!changed) return;
    this.captured = false; // re-capture only the reset nodes (captureRefs skips captured)
    this.builtCount = Math.max(0, this.nodes.filter((n) => n.pyramid.length).length);
    this.dirty = true;
    if (this.canvas.requestPaint) this.canvas.requestPaint();
  }

  // A PAD-inflated wrapper holding the cloned card, so overflowing chrome (sockets, focus
  // rings) is captured. The wrapper insets the card via PADDING (its content box is w×h, so
  // the card sits PAD in) rather than positioning the card, which keeps the card FAITHFUL:
  //  • No explicit width/height/box-sizing on the card — it keeps its own CSS + cloned inline
  //    styles, so fixed-width tiers, content height, and resize-pinned widths all ride along.
  //  • The card's `position` is NOT forced — the clone's own CSS class governs it, exactly like
  //    the live node. `.solenoid-node` is static, so its absolutely-positioned chrome (collapse
  //    chevron, group corner) anchors to rete's node-view div — the card's BORDER box; we
  //    reproduce that with the inner `rel` box (padding box == card border box). `.solenoid-note`
  //    is `position: relative`, so its resize handle anchors to the note card itself — and the
  //    `rel` box is simply bypassed. Forcing a single position value broke whichever root didn't
  //    match it (a forced `relative` shifted node chrome inside the border; a forced `static`
  //    shifted the note's resize handle to the border box — both proven 2026-06-28).
  private cloneFor(el: HTMLElement, w: number, h: number): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.position = "absolute"; // all wrappers stack at origin (paint-contained)
    wrap.style.left = "0"; wrap.style.top = "0"; wrap.style.margin = "0";
    wrap.style.boxSizing = "content-box";
    wrap.style.padding = `${PAD}px`;
    wrap.style.width = `${w}px`; wrap.style.height = `${h}px`; // content box = card box
    wrap.style.overflow = "visible";
    wrap.style.pointerEvents = "none";
    if (REF !== 1) wrap.style.setProperty("zoom", String(REF));
    // rete's node-view div stand-in: the positioning context for the card's absolutely-
    // positioned chrome. Zero padding/border/margin + width = card width, so its padding box
    // == the card's border box (where that chrome anchors live).
    const rel = document.createElement("div");
    rel.style.position = "relative";
    rel.style.margin = "0"; rel.style.padding = "0"; rel.style.border = "0";
    rel.style.boxSizing = "content-box";
    rel.style.width = `${w}px`;
    rel.style.pointerEvents = "none";
    const card = el.cloneNode(true) as HTMLElement;
    card.style.transform = "none";
    // Do NOT set position — let the clone's own CSS class govern it, exactly like the original.
    // `.solenoid-node` is static (chrome climbs to `rel` = the rete-div stand-in); `.solenoid-note`
    // is `position: relative` (its resize handle anchors to the note card itself). Forcing one
    // value broke the other — a forced `static` made the note's resize handle climb to `rel`
    // (the border box) instead of the note's padding box, a 1.75px shift (2026-06-28).
    card.style.margin = "0";
    card.style.pointerEvents = "none";
    HtmlCanvasRenderer.syncFormState(el, card);
    HtmlCanvasRenderer.uniquifyIds(card);
    rel.appendChild(card);
    wrap.appendChild(rel);
    this.canvas.appendChild(wrap);
    return wrap;
  }

  // cloneNode(true) copies an element's ATTRIBUTES but not the live form-control PROPERTIES
  // (input.value, select.selectedIndex/value, checkbox.checked, textarea.value). The app drives
  // these via the .value property (React controlled inputs), so a naive clone of a <select> shows
  // its FIRST <option> and an <input> its default — the "dropdown caches the first option" bug on
  // the Slicer category + Format Controller selects. Walk the original + clone in lockstep
  // (querySelectorAll yields the same order for a deep clone) and copy the live state across.
  private static syncFormState(orig: HTMLElement, clone: HTMLElement): void {
    const sel = "input, select, textarea";
    const src = orig.querySelectorAll<HTMLElement>(sel);
    const dst = clone.querySelectorAll<HTMLElement>(sel);
    if (src.length !== dst.length) return; // structure drift — bail rather than mis-map
    for (let i = 0; i < src.length; i++) {
      const s = src[i], d = dst[i];
      if (s instanceof HTMLSelectElement && d instanceof HTMLSelectElement) {
        // Mirror selectedIndex (so the chosen <option> paints) and also set selected attrs so
        // the captured render is unambiguous even before the clone is in the document.
        d.selectedIndex = s.selectedIndex;
        for (let o = 0; o < d.options.length; o++) d.options[o].selected = o === s.selectedIndex;
      } else if (s instanceof HTMLTextAreaElement && d instanceof HTMLTextAreaElement) {
        d.value = s.value; d.textContent = s.value;
      } else if (s instanceof HTMLInputElement && d instanceof HTMLInputElement) {
        if (s.type === "checkbox" || s.type === "radio") {
          d.checked = s.checked;
          if (s.checked) d.setAttribute("checked", ""); else d.removeAttribute("checked");
        } else {
          d.value = s.value; d.setAttribute("value", s.value);
        }
      }
    }
  }

  // Cloning a node copies its inline SVG <defs> verbatim, so any id (a combo socket's bicolor
  // split square is clipped by `<clipPath id=...>` referenced via url(#id)) now exists TWICE —
  // original + clone. A duplicate id makes url(#id) resolve to nothing, clipping the square away
  // to blank ("numlist sockets blank on render"). Rewrite every id in the clone to a unique value
  // and fix its references so each clone is self-contained.
  private static idSeq = 0;
  private static uniquifyIds(card: HTMLElement): void {
    const ided = card.querySelectorAll("[id]");
    if (!ided.length) return;
    const seq = ++HtmlCanvasRenderer.idSeq;
    const map: Array<[string, string]> = [];
    ided.forEach((el) => {
      const old = el.getAttribute("id");
      if (old) { const neu = `${old}__hc${seq}`; el.setAttribute("id", neu); map.push([old, neu]); }
    });
    if (!map.length) return;
    const REF_ATTRS = ["clip-path", "mask", "filter", "fill", "stroke", "marker-start", "marker-mid", "marker-end", "href", "xlink:href"];
    card.querySelectorAll("*").forEach((el) => {
      for (const attr of REF_ATTRS) {
        const v = el.getAttribute(attr);
        if (!v || !v.includes("#")) continue;
        let nv = v;
        for (const [old, neu] of map) {
          nv = nv.split(`url(#${old})`).join(`url(#${neu})`);
          if (nv === `#${old}`) nv = `#${neu}`; // href="#id"
        }
        if (nv !== v) el.setAttribute(attr, nv);
      }
      const st = el.getAttribute("style");
      if (st && st.includes("url(#")) {
        let ns = st;
        for (const [old, neu] of map) ns = ns.split(`url(#${old})`).join(`url(#${neu})`);
        if (ns !== st) el.setAttribute("style", ns);
      }
    });
  }

  /** Move one node (cheap — no re-capture; geometry only). Returns true if it moved.
   *  Cables touching it follow via relayoutCables(); the caller batches that per frame. */
  setNodePosition(id: string, x: number, y: number): boolean {
    const n = this.nodeById.get(id);
    if (n && (n.x !== x || n.y !== y)) { n.x = x; n.y = y; this.dirty = true; return true; }
    return false;
  }

  /** Store cables as offsets from their endpoint nodes (so they follow moves live), then
   *  route them once. Run on topology / shape change. */
  setCables(cables: SnapCable[], shape: CableShape): void {
    this.cableShape = shape;
    this.cables = cables.map((cb) => {
      const s = this.nodeById.get(cb.source), t = this.nodeById.get(cb.target);
      return {
        sourceId: cb.source, srcOffX: s ? cb.sx - s.x : 0, srcOffY: s ? cb.sy - s.y : 0, srcAbsX: cb.sx, srcAbsY: cb.sy, sourceAngleDeg: cb.sourceAngleDeg,
        targetId: cb.target, tgtOffX: t ? cb.ex - t.x : 0, tgtOffY: t ? cb.ey - t.y : 0, tgtAbsX: cb.ex, tgtAbsY: cb.ey, targetAngleDeg: cb.targetAngleDeg,
        color: HtmlCanvasRenderer.hexColor(cb.color),
      };
    });
    this.cableGeoms = new Array(this.cables.length).fill(null);
    this.relayoutCables();
  }

  /** Re-route cables from the CURRENT node positions (no DOM read). Pass `moved` to route
   *  only the cables touching those node ids (a drag/tidy step); omit it to route all. */
  relayoutCables(moved?: Set<string>): void {
    for (let i = 0; i < this.cables.length; i++) {
      const c = this.cables[i];
      if (moved && !moved.has(c.sourceId) && !moved.has(c.targetId)) continue;
      const s = this.nodeById.get(c.sourceId), t = this.nodeById.get(c.targetId);
      const sx = s ? s.x + c.srcOffX : c.srcAbsX, sy = s ? s.y + c.srcOffY : c.srcAbsY;
      const ex = t ? t.x + c.tgtOffX : c.tgtAbsX, ey = t ? t.y + c.tgtOffY : c.tgtAbsY;
      const pts = cablePolyline(this.cableShape, { sx, sy, ex, ey, sourceAngleDeg: c.sourceAngleDeg, targetAngleDeg: c.targetAngleDeg });
      this.cableGeoms[i] = HtmlCanvasRenderer.geomOf(pts);
    }
    this.dirty = true;
  }

  private static hexColor(n: number): string {
    return "#" + (n & 0xffffff).toString(16).padStart(6, "0");
  }

  private static geomOf(pts: { x: number; y: number }[]): CableGeom | null {
    if (pts.length < 2) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    return { pts, minX, minY, maxX, maxY };
  }

  /** Topmost non-group node containing the screen point, or null. */
  hitTest(sx: number, sy: number): string | null {
    const { wx, wy } = this.cam.toWorld(sx, sy);
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      if (n.isGroup) continue;
      if (wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h) return n.id;
    }
    return null;
  }

  resize(): void {
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    const cw = this.host.clientWidth || 1, ch = this.host.clientHeight || 1;
    this.canvas.width = Math.round(cw * this.dpr);
    this.canvas.height = Math.round(ch * this.dpr);
    // ACTUAL backing-store ÷ CSS ratio, per axis. The backing store is rounded to whole px, so
    // this is NOT exactly `dpr` (with a fractional dpr the gap is ~1e-4). The DOM is transformed
    // in CSS px at the true `k`; if the canvas CTM used the rounded-away `dpr` instead of this
    // ratio, its on-screen scale would differ from the DOM's by (ratio−dpr) — an error that
    // scales with WORLD COORDINATE × zoom, so distant nodes in a big graph drift, worse zoomed
    // in (proven 2026-06-28). Building the CTM from the exact ratio makes canvas == DOM.
    this.bsx = this.canvas.width / cw;
    this.bsy = this.canvas.height / ch;
    this.dirty = true;
  }

  requestRender(): void { this.dirty = true; }

  getStats(): RendererStats {
    return { fps: Math.round(this.fpsEMA), drawMs: Math.round(this.lastFrameMs * 10) / 10, visible: this.nVisible, total: this.nodes.length, built: this.builtCount, mip: this.curMip };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.onpaint = null;
    this.canvas.removeEventListener("paint", this.onPaint as EventListener);
    this.releaseNodes();
    this.canvas.remove();
  }

  // ── internals ──────────────────────────────────────────────────────────────────
  private releaseNodes(): void {
    for (const n of this.nodes) {
      n.refImg?.close?.();
      for (const p of n.pyramid) p.bmp?.close?.();
      n.refEl.remove();
    }
    this.nodes = [];
    this.nodeById.clear();
  }

  private captureRefs = (): void => {
    if (this.captured || typeof this.canvas.captureElementImage !== "function") return;
    let diagLogged = false; // log once per build (toggle html off/on to refresh)
    for (const n of this.nodes) {
      if (n.refImg) continue; // already captured — a targeted updateNodes leaves others intact
      try { n.refImg = this.canvas.captureElementImage!(n.refEl); } catch { n.refImg = null; }
      // Capture diagnostic (`window.__hcDiag = true`): real vs expected dims, so the px-level
      // mismatch can be reasoned from numbers, not eyeballing.
      if (n.refImg && !diagLogged && (window as unknown as { __hcDiag?: boolean }).__hcDiag) {
        diagLogged = true;
        const clone = (n.refEl.firstElementChild?.firstElementChild ?? n.refEl.firstElementChild) as HTMLElement | null; // wrap → rel → card
        // eslint-disable-next-line no-console
        console.log("[hc-diag]", {
          id: n.id, w: n.w, h: n.h, PAD, dpr: this.dpr,
          imgW: n.refImg.width, imgH: n.refImg.height, // capture px (= box·dpr; rounding is cosmetic, unused)
          cloneOffsetW: clone?.offsetWidth, cloneOffsetH: clone?.offsetHeight, // should == w / h
        });
        // Clone-vs-original SCREEN-position check. offset* (used before) was the wrong instrument:
        // it's offsetParent-relative, so card-anchored chrome (header/chevron/corner) whose
        // positioning context cloneFor changes reads Δ=0 while its true on-screen spot MOVED, and
        // it's integer-rounded so sub-px shifts vanish. This measures getBoundingClientRect
        // (true rendered box) relative to each CARD's rect, correcting the two different scales:
        // the ORIGINAL lives inside rete's area transform (camera scale k), the CLONE only has
        // zoom:REF. Divide each out → both land in card-local CSS px, directly comparable.
        const origCard = n.srcEl;
        const oEls = origCard.querySelectorAll<HTMLElement>("*");
        const cEls = clone ? clone.querySelectorAll<HTMLElement>("*") : null;
        if (!cEls || oEls.length !== cEls.length) {
          // eslint-disable-next-line no-console
          console.log(`[hc-pos] STRUCTURE MISMATCH — orig has ${oEls.length} descendants, clone has ${cEls?.length ?? 0}. The clone tree differs from the original (already our bug).`);
        } else {
          const k = this.cam.scale || 1; // original is inside the area's CSS transform
          const HTML_NS = "http://www.w3.org/1999/xhtml";
          const name = (e: Element) => `${e.tagName.toLowerCase()}.${(e.getAttribute("class") || "").split(" ").filter(Boolean).join(".")}`;
          const oCard = origCard.getBoundingClientRect(), cCard = clone!.getBoundingClientRect();
          const rows: { el: string; d_top: number; d_left: number; d_w: number; d_h: number; d_off: number; ctx: string }[] = [];
          let maxTop = 0, maxLeft = 0, maxW = 0, maxH = 0, htmlN = 0;
          for (let i = 0; i < oEls.length; i++) {
            if (oEls[i].namespaceURI !== HTML_NS) continue; // SVG/MathML: no clean box, vector
            htmlN++;
            const o = oEls[i], c = cEls[i];
            const ob = o.getBoundingClientRect(), cb = c.getBoundingClientRect();
            // card-local CSS px (un-scale each by its own factor)
            const oT = (ob.top - oCard.top) / k, oL = (ob.left - oCard.left) / k, oW = ob.width / k, oH = ob.height / k;
            const cT = (cb.top - cCard.top) / REF, cL = (cb.left - cCard.left) / REF, cW = cb.width / REF, cH = cb.height / REF;
            const dTop = +(cT - oT).toFixed(2), dLeft = +(cL - oL).toFixed(2), dW = +(cW - oW).toFixed(2), dH = +(cH - oH).toFixed(2);
            // Does the screen delta DISAGREE with the offsetParent-relative delta? Big d_off means
            // the positioning context changed in the clone (the offset* test's blind spot).
            const dOff = +((c.offsetTop - o.offsetTop) - dTop).toFixed(2);
            // Flag a changed offsetParent identity (the smoking gun for anchor shifts).
            const ctx = (o.offsetParent && name(o.offsetParent) === (c.offsetParent ? name(c.offsetParent) : "")) ? "" : `OP:${o.offsetParent ? name(o.offsetParent) : "null"}→${c.offsetParent ? name(c.offsetParent) : "null"}`;
            rows.push({ el: name(o), d_top: dTop, d_left: dLeft, d_w: dW, d_h: dH, d_off: dOff, ctx });
            maxTop = Math.max(maxTop, Math.abs(dTop)); maxLeft = Math.max(maxLeft, Math.abs(dLeft));
            maxW = Math.max(maxW, Math.abs(dW)); maxH = Math.max(maxH, Math.abs(dH));
          }
          // eslint-disable-next-line no-console
          console.log(`[hc-pos] HTML (${htmlN}/${oEls.length}) SCREEN Δ (card-local CSS px, k=${k.toFixed(3)}) — max |top|=${maxTop.toFixed(2)} |left|=${maxLeft.toFixed(2)} |w|=${maxW.toFixed(2)} |h|=${maxH.toFixed(2)}. d_off≠0 or ctx set = positioning-context change (offset* blind spot).`);
          // eslint-disable-next-line no-console
          console.table(rows);
        }
      }
    }
    this.captured = this.nodes.length === 0 || this.nodes.some((n) => n.refImg);
  };

  // Build the mip pyramid for every node from its reference snapshot. createImageBitmap
  // GPU-downscales the captured pixels (widgets keep proportions — no fractional-zoom
  // bloat). Primary path uses the snapshot as a source directly; scratch-canvas rasterize
  // is the fallback; if both fail the per-frame refImg draw still covers the node.
  private buildMips = async (): Promise<void> => {
    if (this.building) return; this.building = true;
    for (const n of this.nodes) {
      if (this.disposed) break;
      if (!n.refImg || n.pyramid.length) continue;
      const pw = n.w + 2 * PAD, ph = n.h + 2 * PAD; // captured (padded) box
      let top: ImageBitmap | null = null;
      try { top = await createImageBitmap(n.refImg as unknown as ImageBitmapSource); } catch { top = null; }
      if (!top && this.sctx && typeof this.sctx.drawElementImage === "function") {
        try {
          const refW = Math.max(1, Math.round(pw * REF)), refH = Math.max(1, Math.round(ph * REF));
          this.scratch.width = refW; this.scratch.height = refH;
          this.sctx.clearRect(0, 0, refW, refH);
          this.sctx.drawElementImage(n.refImg, 0, 0, refW, refH);
          top = await createImageBitmap(this.scratch, 0, 0, refW, refH);
        } catch { top = null; }
      }
      if (!top) { this.dirty = true; continue; }
      const levels: PyramidLevel[] = [{ scale: REF, bmp: top }];
      let cur = top, curScale = REF;
      while (Math.min(pw, ph) * curScale > MIP_MIN_PX * 2 && levels.length < 12) {
        const nw = Math.max(1, Math.round(pw * curScale / 2)), nh = Math.max(1, Math.round(ph * curScale / 2));
        let next: ImageBitmap;
        try { next = await createImageBitmap(cur, { resizeWidth: nw, resizeHeight: nh, resizeQuality: "high" }); }
        catch { break; }
        curScale /= 2;
        levels.push({ scale: curScale, bmp: next });
        cur = next;
      }
      n.pyramid = levels;
      this.builtCount++;
      this.dirty = true;
    }
    this.building = false;
  };

  private drawCables(vp: { minX: number; minY: number; maxX: number; maxY: number }): void {
    const { ctx, cam, bsx, bsy } = this;
    ctx.setTransform(bsx, 0, 0, bsy, 0, 0); // CSS-screen → backing (exact ratio, matches the DOM)
    ctx.lineWidth = 1.8; // matches the DOM cable's default visible stroke
    ctx.lineJoin = "round";
    // Each cable's hue follows its source socket's data type (like the DOM). Bucket the
    // visible cables by colour into one Path2D each, so the layer is a handful of strokes
    // (one per type colour present) rather than a stroke per cable.
    const byColor = new Map<string, Path2D>();
    for (let i = 0; i < this.cableGeoms.length; i++) {
      const g = this.cableGeoms[i];
      if (!g || g.maxX < vp.minX || g.minX > vp.maxX || g.maxY < vp.minY || g.minY > vp.maxY) continue;
      const color = this.cables[i]?.color ?? "#7a8296";
      let path = byColor.get(color);
      if (!path) { path = new Path2D(); byColor.set(color, path); }
      const s0 = cam.toScreen(g.pts[0].x, g.pts[0].y);
      path.moveTo(s0.sx, s0.sy);
      for (let j = 1; j < g.pts.length; j++) {
        const s = cam.toScreen(g.pts[j].x, g.pts[j].y);
        path.lineTo(s.sx, s.sy);
      }
    }
    for (const [color, path] of byColor) { ctx.strokeStyle = color; ctx.stroke(path); }
  }

  // The live box-select (lasso) rect, in SCREEN space so the stroke is a constant 1px. The
  // PER-NODE selection ring is NOT drawn here: the real accent ring is the `.solenoid-node--
  // selected::after` pseudo-element, which rides along in the captured clone (the layer
  // re-captures on selection change), so the canvas shows the SAME ring as the DOM rather than
  // a synthetic blue box that didn't match (2026-06-30).
  private drawSelection(): void {
    if (!this.selectBox) return;
    const { ctx, bsx, bsy } = this;
    ctx.setTransform(bsx, 0, 0, bsy, 0, 0); // CSS-screen → backing (exact ratio, matches the DOM)
    if (this.selectBox) {
      const b = this.selectBox;
      ctx.fillStyle = "rgba(96, 160, 255, 0.12)";
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(96, 160, 255, 0.8)";
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.setLineDash([]);
    }
  }

  // Draw one frame. useCached=true draws the pyramid bitmaps (the fast path); on the
  // initial paint (useCached=false) we draw live elements crisp while the pyramid builds.
  private drawFrame(useCached: boolean): void {
    const { ctx, cam, dpr, canvas, host } = this;
    if (!ctx.drawElementImage) return;
    const t0 = performance.now();
    if (typeof ctx.reset === "function") ctx.reset(); else ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.active) { this.lastFrameMs = performance.now() - t0; return; } // idle → transparent
    const { bsx, bsy } = this;
    const camCTM = () => ctx.setTransform(bsx * cam.scale, 0, 0, bsy * cam.scale, bsx * cam.tx, bsy * cam.ty);

    // Pick the pyramid level once (scale + quality are global).
    const idealI = computeIdealMipLevel(cam.scale, this.quality, dpr);
    this.curMip = useCached ? REF / Math.pow(2, idealI) : 0;

    const m = 40;
    const tl = cam.toWorld(-m, -m);
    const br = cam.toWorld(host.clientWidth + m, host.clientHeight + m);
    const vp = { minX: tl.wx, minY: tl.wy, maxX: br.wx, maxY: br.wy };
    const inView = (n: EngineNode): boolean => n.x + n.w >= vp.minX && n.x <= vp.maxX && n.y + n.h >= vp.minY && n.y <= vp.maxY;

    const drawOne = (n: EngineNode): boolean => {
      // Draw at the EXACT padded box. Card sits PAD in from the capture top-left, so anchor at
      // (x-PAD, y-PAD) and the card edge lands at x,y. (Width and height are both exact: the
      // clone lays out at 1× == the live node, so w/h are faithful — no aspect derivation.)
      const dx = n.x - PAD, dy = n.y - PAD, dw = n.w + 2 * PAD, dh = n.h + 2 * PAD;
      if (useCached) {
        if (n.pyramid.length) { ctx.drawImage(n.pyramid[Math.min(idealI, n.pyramid.length - 1)].bmp, dx, dy, dw, dh); return true; }
        if (n.refImg) { try { ctx.drawElementImage!(n.refImg, dx, dy, dw, dh); return true; } catch { return false; } }
        return false;
      }
      try { ctx.drawElementImage!(n.refEl, dx, dy, dw, dh); return true; } catch { return false; }
    };

    let drawn = 0;
    camCTM();
    for (const n of this.nodes) { if (n.isGroup && inView(n) && drawOne(n)) drawn++; }
    this.drawCables(vp);
    camCTM();
    for (const n of this.nodes) { if (!n.isGroup && inView(n) && drawOne(n)) drawn++; }
    this.nVisible = drawn;
    this.drawSelection();

    const t1 = performance.now();
    const dt = this.lastDrawTs ? t1 - this.lastDrawTs : 16;
    this.lastDrawTs = t1;
    const inst = 1000 / Math.max(1, dt);
    this.fpsEMA = this.fpsEMA ? this.fpsEMA * 0.8 + inst * 0.2 : inst;
    this.lastFrameMs = t1 - t0;
  }

  private onPaint = (): void => {
    if (!this.captured) { this.captureRefs(); if (this.captured) void this.buildMips(); }
    this.drawFrame(false);
  };

  private tick = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    // Drive capture to completion even when idle/inactive (so the background snapshot is
    // ready for the next gesture) — a paint event runs captureRefs + buildMips.
    if (!this.captured) {
      if (this.canvas.requestPaint) this.canvas.requestPaint(); else this.drawFrame(false);
      return;
    }
    if (!this.dirty) return;
    this.dirty = false;
    // Live mode: re-rasterize at the exact CTM via a paint (faithful), else blit cached mips.
    if (this.live && this.active && this.canvas.requestPaint) this.canvas.requestPaint();
    else this.drawFrame(true);
  };
}
