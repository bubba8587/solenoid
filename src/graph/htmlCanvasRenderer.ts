// [[C42]] htmlInCanvasRenderer, [[B10]] reactFlowView

import { Camera } from "./hicCamera";
import { cablePolyline } from "./hicCableGeom";
import type { SnapCable } from "./hicGraphSnapshot";
import type { CableShape } from "./cableShape";
import { packAtlas, type AtlasPlacement } from "./rasterAtlas";
import { camFromDrawMatrix, plausibleNativeCam, type CamXform } from "./domSync";
import { IS_COARSE } from "./coarse";

// An imperative engine, so HMR must invalidate or a stale instance stays alive.
if (import.meta.hot) import.meta.hot.accept(() => import.meta.hot?.invalidate());

// ── WICG HTML-in-Canvas typing (not in lib.dom yet) ──────────────────────────────
interface ElementImageLike { width: number; height: number; close?: () => void }
type Ctx2D = CanvasRenderingContext2D & {
  drawElementImage?: (el: Element | ElementImageLike, dx: number, dy: number, dw?: number, dh?: number) => DOMMatrix | undefined;
  getElementTransform?: (el: Element | ElementImageLike, drawTransform: DOMMatrix) => DOMMatrix;
  reset?: () => void;
};
type LayoutCanvas = HTMLCanvasElement & {
  layoutSubtree?: boolean;
  requestPaint?: () => void;
  onpaint?: ((e: Event) => void) | null;
  captureElementImage?: (el: Element) => ElementImageLike;
  getElementTransform?: (el: Element, drawTransform: DOMMatrix) => DOMMatrix;
};

const REF: number = 1;
const MIP_MIN_PX = 6;
const DEFAULT_QUALITY = 1.0;

export function computeIdealMipLevel(scale: number, quality: number = DEFAULT_QUALITY, dpr: number = 1): number {
  const target = quality * scale * dpr;
  return Math.max(0, Math.floor(Math.log2(REF / Math.max(target, 1e-4))));
}
const PAD = 10;

export interface EngineNodeSpec {
  id: string;
  el: HTMLElement;
  x: number; y: number;
  w: number; h: number;
  isGroup: boolean;
}

interface PyramidLevel { scale: number; bmp: ImageBitmap }
interface EngineNode {
  id: string;
  refEl: HTMLElement;
  srcEl: HTMLElement;
  refImg: ElementImageLike | null;
  pyramid: PyramidLevel[];
  mipFailed?: boolean;
  needsPaintRaster?: boolean;
  rasterAttempts?: number;
  x: number; y: number; w: number; h: number;
  isGroup: boolean;
}
interface CableGeom { pts: { x: number; y: number }[]; minX: number; minY: number; maxX: number; maxY: number }
interface CableSpec {
  sourceId: string; srcOffX: number; srcOffY: number; srcAbsX: number; srcAbsY: number; sourceAngleDeg: number | null; sourceFlipped: boolean;
  targetId: string; tgtOffX: number; tgtOffY: number; tgtAbsX: number; tgtAbsY: number; targetAngleDeg: number | null; targetFlipped: boolean;
  color: string;
}

export interface RendererStats {
  fps: number; drawMs: number; visible: number; total: number; built: number; mip: number;
  slow: number;
  failed: number;
}

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
  private cableGeoms: (CableGeom | null)[] = [];
  private cableShape: CableShape = "diagonal";
  private quality = DEFAULT_QUALITY;
  private dpr = 1;
  private bsx = 1;
  private bsy = 1;

  private dirty = true;
  private raf = 0;
  private captured = false;
  private building = false;
  private builtCount = 0;
  private disposed = false;
  private transformSource: (() => { k: number; x: number; y: number }) | null = null;
  private presented: CamXform | null = null;

  private lastDrawTs = 0;
  private fpsEMA = 0;
  private nVisible = 0;
  private lastFrameMs = 0;
  private curMip = 0;
  private slowDraws = 0;

  private selected = new Set<string>();
  private domLive = new Set<string>();
  private selectBox: { x: number; y: number; w: number; h: number } | null = null;
  private active = false;
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
    // addEventListener only: also assigning canvas.onpaint registers a second listener on some builds.
    this.canvas.addEventListener("paint", this.onPaint as EventListener);
    this.raf = requestAnimationFrame(this.tick);
    if (this.canvas.requestPaint) this.canvas.requestPaint();
  }

  setTransformSource(fn: () => { k: number; x: number; y: number }): void {
    this.transformSource = fn;
  }

  getPresented(): CamXform | null {
    return this.presented;
  }

  setTransform(scale: number, tx: number, ty: number): void {
    if (this.cam.scale === scale && this.cam.tx === tx && this.cam.ty === ty) return;
    this.cam.scale = scale; this.cam.tx = tx; this.cam.ty = ty;
    this.dirty = true;
  }

  setQuality(q: number): void { this.quality = q; this.dirty = true; }

  /** The element stays visible even when idle, because capture needs it rendered. */
  setActive(v: boolean): void {
    if (this.active === v) return;
    this.active = v;
    this.dirty = true;
  }

  setDebug(on: boolean): void {
    this.canvas.style.opacity = on ? "0.5" : "";
  }

  setLive(on: boolean): void { if (this.live !== on) { this.live = on; this.dirty = true; } }

  setDomLive(ids: Set<string>): void {
    if (ids.size === this.domLive.size && [...ids].every((id) => this.domLive.has(id))) return;
    this.domLive = new Set(ids);
    this.dirty = true;
  }

  setSelected(ids: Set<string>): void {
    if (ids.size === this.selected.size && [...ids].every((id) => this.selected.has(id))) return;
    this.selected = new Set(ids);
    this.dirty = true;
  }

  /** In screen px; null clears it. */
  setSelectBox(box: { x: number; y: number; w: number; h: number } | null): void {
    this.selectBox = box;
    this.dirty = true;
  }

  nodesInWorldRect(r: { minX: number; minY: number; maxX: number; maxY: number }): string[] {
    const out: string[] = [];
    for (const n of this.nodes) {
      if (n.x + n.w >= r.minX && n.x <= r.maxX && n.y + n.h >= r.minY && n.y <= r.maxY) out.push(n.id);
    }
    return out;
  }

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

  updateNodes(specs: EngineNodeSpec[]): void {
    let changed = false;
    for (const s of specs) {
      const n = this.nodeById.get(s.id);
      if (!n) continue;
      n.x = s.x; n.y = s.y; n.w = s.w; n.h = s.h;
      n.refImg?.close?.(); n.refImg = null;
      for (const p of n.pyramid) p.bmp?.close?.();
      n.pyramid = [];
      n.mipFailed = false;
      n.needsPaintRaster = false;
      n.rasterAttempts = 0;
      n.refEl.remove();
      n.refEl = this.cloneFor(s.el, s.w, s.h);
      n.srcEl = s.el;
      changed = true;
    }
    if (!changed) return;
    this.captured = false;
    this.builtCount = Math.max(0, this.nodes.filter((n) => n.pyramid.length).length);
    this.dirty = true;
    if (this.canvas.requestPaint) this.canvas.requestPaint();
  }

  private cloneFor(el: HTMLElement, w: number, h: number): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.position = "absolute";
    wrap.style.left = "0"; wrap.style.top = "0"; wrap.style.margin = "0";
    wrap.style.boxSizing = "content-box";
    wrap.style.padding = `${PAD}px`;
    wrap.style.width = `${w}px`; wrap.style.height = `${h}px`;
    wrap.style.overflow = "visible";
    wrap.style.pointerEvents = "none";
    if (REF !== 1) wrap.style.setProperty("zoom", String(REF));
    const rel = document.createElement("div");
    rel.style.position = "relative";
    rel.style.margin = "0"; rel.style.padding = "0"; rel.style.border = "0";
    rel.style.boxSizing = "content-box";
    rel.style.width = `${w}px`;
    rel.style.pointerEvents = "none";
    const card = el.cloneNode(true) as HTMLElement;
    card.style.transform = "none";
    // Never set position here: the clone's own CSS class governs it, as on the original.
    card.style.margin = "0";
    card.style.pointerEvents = "none";
    HtmlCanvasRenderer.syncFormState(el, card);
    HtmlCanvasRenderer.syncCanvasState(el, card);
    HtmlCanvasRenderer.uniquifyIds(card);
    rel.appendChild(card);
    wrap.appendChild(rel);
    this.canvas.appendChild(wrap);
    return wrap;
  }

  private static syncFormState(orig: HTMLElement, clone: HTMLElement): void {
    const sel = "input, select, textarea";
    const src = orig.querySelectorAll<HTMLElement>(sel);
    const dst = clone.querySelectorAll<HTMLElement>(sel);
    if (src.length !== dst.length) return;
    for (let i = 0; i < src.length; i++) {
      const s = src[i], d = dst[i];
      if (s instanceof HTMLSelectElement && d instanceof HTMLSelectElement) {
        // Mirror the selected attributes too, because the clone may be captured before it is in the document.
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

  private static syncCanvasState(orig: HTMLElement, clone: HTMLElement): void {
    const src = orig.querySelectorAll<HTMLCanvasElement>("canvas");
    const dst = clone.querySelectorAll<HTMLCanvasElement>("canvas");
    if (src.length !== dst.length) return;
    for (let i = 0; i < src.length; i++) {
      const s = src[i], d = dst[i];
      if (!s.width || !s.height) continue;
      d.width = s.width; d.height = s.height;
      try { d.getContext("2d")?.drawImage(s, 0, 0); } catch { /* tainted/GPU-lost canvas — leave blank */ }
    }
  }

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
          if (nv === `#${old}`) nv = `#${neu}`;
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

  /** Geometry only, with no re-capture; the caller batches relayoutCables() per frame. */
  setNodePosition(id: string, x: number, y: number): boolean {
    const n = this.nodeById.get(id);
    if (n && (n.x !== x || n.y !== y)) { n.x = x; n.y = y; this.dirty = true; return true; }
    return false;
  }

  setCables(cables: SnapCable[], shape: CableShape): void {
    this.cableShape = shape;
    this.cables = cables.map((cb) => {
      const s = this.nodeById.get(cb.source), t = this.nodeById.get(cb.target);
      return {
        sourceId: cb.source, srcOffX: s ? cb.sx - s.x : 0, srcOffY: s ? cb.sy - s.y : 0, srcAbsX: cb.sx, srcAbsY: cb.sy, sourceAngleDeg: cb.sourceAngleDeg, sourceFlipped: cb.sourceFlipped,
        targetId: cb.target, tgtOffX: t ? cb.ex - t.x : 0, tgtOffY: t ? cb.ey - t.y : 0, tgtAbsX: cb.ex, tgtAbsY: cb.ey, targetAngleDeg: cb.targetAngleDeg, targetFlipped: cb.targetFlipped,
        color: HtmlCanvasRenderer.hexColor(cb.color),
      };
    });
    this.cableGeoms = new Array(this.cables.length).fill(null);
    this.relayoutCables();
  }

  /** `moved` limits routing to cables touching those ids; omit it to route all. */
  relayoutCables(moved?: Set<string>): void {
    for (let i = 0; i < this.cables.length; i++) {
      const c = this.cables[i];
      if (moved && !moved.has(c.sourceId) && !moved.has(c.targetId)) continue;
      const s = this.nodeById.get(c.sourceId), t = this.nodeById.get(c.targetId);
      const sx = s ? s.x + c.srcOffX : c.srcAbsX, sy = s ? s.y + c.srcOffY : c.srcAbsY;
      const ex = t ? t.x + c.tgtOffX : c.tgtAbsX, ey = t ? t.y + c.tgtOffY : c.tgtAbsY;
      const pts = cablePolyline(this.cableShape, { sx, sy, ex, ey, sourceAngleDeg: c.sourceAngleDeg, targetAngleDeg: c.targetAngleDeg, sourceFlipped: c.sourceFlipped, targetFlipped: c.targetFlipped });
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
    // The exact backing-store ratio, not dpr: a dpr-built transform drifts from the DOM with world coordinate × zoom.
    this.bsx = this.canvas.width / cw;
    this.bsy = this.canvas.height / ch;
    this.dirty = true;
  }

  requestRender(): void { this.dirty = true; }

  getStats(): RendererStats {
    return {
      fps: Math.round(this.fpsEMA), drawMs: Math.round(this.lastFrameMs * 10) / 10,
      visible: this.nVisible, total: this.nodes.length, built: this.builtCount, mip: this.curMip,
      slow: this.slowDraws, failed: this.nodes.filter((n) => n.mipFailed).length,
    };
  }

  probe(): void {
    // eslint-disable-next-line no-console
    const log = (...a: unknown[]) => console.info("[hc-probe]", ...a);
    const n = this.nodes[0];
    if (!n) { log("no nodes"); return; }
    log("captureElementImage:", typeof this.canvas.captureElementImage,
        "| drawElementImage(main):", typeof this.ctx.drawElementImage,
        "| drawElementImage(scratch):", typeof this.sctx?.drawElementImage,
        "| node:", n.id, `${n.w}×${n.h}`, "refImg:", !!n.refImg);
    const get = this.nativeGetElementTransform();
    log("getElementTransform:", get ? (typeof this.ctx.getElementTransform === "function" ? "on ctx" : "on canvas") : "unavailable");
    if (get && typeof DOMMatrix === "function") {
      try {
        const m = get(n.refEl, new DOMMatrix());
        log("getElementTransform(identity) →", m ? `a=${m.a} d=${m.d} e=${m.e} f=${m.f}` : String(m));
      } catch (e) { log("getElementTransform THREW:", String(e)); }
    }
    let img: ElementImageLike | null = null;
    if (typeof this.canvas.captureElementImage === "function") {
      try {
        img = this.canvas.captureElementImage(n.refEl);
        log("capture OK:", img && { w: img.width, h: img.height, ctor: (img as object).constructor?.name });
      } catch (e) { log("capture THREW:", String(e)); }
    }
    const src = img ?? n.refImg;
    void (async () => {
      if (src) {
        try { const b = await createImageBitmap(src as unknown as ImageBitmapSource); log("createImageBitmap(capture) OK:", b.width, b.height); b.close(); }
        catch (e) { log("createImageBitmap(capture) THREW:", String(e)); }
      } else log("no captured image to test createImageBitmap on");
      if (this.sctx && typeof this.sctx.drawElementImage === "function") {
        this.scratch.width = 64; this.scratch.height = 64;
        if (src) {
          try { this.sctx.drawElementImage(src, 0, 0, 64, 64); log("scratch.draw(capture) OK"); }
          catch (e) { log("scratch.draw(capture) THREW:", String(e)); }
        }
        try { this.sctx.drawElementImage(n.refEl, 0, 0, 64, 64); log("scratch.draw(element) OK"); }
        catch (e) { log("scratch.draw(element) THREW:", String(e)); }
        try { const b = await createImageBitmap(this.scratch); log("createImageBitmap(scratch) OK:", b.width, b.height); b.close(); }
        catch (e) { log("createImageBitmap(scratch) THREW:", String(e)); }
      }
      try {
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.drawElementImage!(n.refEl, 0, 0, 64, 64);
        const b = await createImageBitmap(this.canvas, 0, 0, 64, 64);
        const pc = document.createElement("canvas"); pc.width = 64; pc.height = 64;
        const pctx = pc.getContext("2d")!;
        pctx.drawImage(b, 0, 0);
        const px = pctx.getImageData(0, 0, 64, 64).data;
        let ink = 0;
        for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) ink++;
        log("main-canvas raster snapshot:", `${b.width}×${b.height}`, "nonTransparentPx:", ink, ink ? "(EAGER raster — snapshot fallback viable)" : "(BLANK — raster is deferred to paint)");
        b.close();
      } catch (e) { log("main-canvas raster snapshot THREW:", String(e)); }
      this.dirty = true;
    })();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
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

  private static loggedPaths = new Set<string>();
  private static logPathOnce(msg: string): void {
    if (HtmlCanvasRenderer.loggedPaths.has(msg)) return;
    HtmlCanvasRenderer.loggedPaths.add(msg);
    // eslint-disable-next-line no-console
    console.info("[hc]", msg);
  }

  private captureRefs = (): void => {
    if (this.captured) return;
    if (typeof this.canvas.captureElementImage !== "function") {
      // Mark captured anyway, or the tick loop spins requestPaint every frame.
      this.captured = true;
      if (this.nodes.length) HtmlCanvasRenderer.logPathOnce("captureElementImage unavailable — building mips from live clones via the scratch canvas");
      return;
    }
    let diagLogged = false;
    for (const n of this.nodes) {
      if (n.refImg) continue;
      try { n.refImg = this.canvas.captureElementImage!(n.refEl); } catch { n.refImg = null; }
      if (n.refImg && !diagLogged && (window as unknown as { __hcDiag?: boolean }).__hcDiag) {
        diagLogged = true;
        const clone = (n.refEl.firstElementChild?.firstElementChild ?? n.refEl.firstElementChild) as HTMLElement | null;
        // eslint-disable-next-line no-console
        console.log("[hc-diag]", {
          id: n.id, w: n.w, h: n.h, PAD, dpr: this.dpr,
          imgW: n.refImg.width, imgH: n.refImg.height,
          cloneOffsetW: clone?.offsetWidth, cloneOffsetH: clone?.offsetHeight,
        });
        const origCard = n.srcEl;
        const oEls = origCard.querySelectorAll<HTMLElement>("*");
        const cEls = clone ? clone.querySelectorAll<HTMLElement>("*") : null;
        if (!cEls || oEls.length !== cEls.length) {
          // eslint-disable-next-line no-console
          console.log(`[hc-pos] STRUCTURE MISMATCH — orig has ${oEls.length} descendants, clone has ${cEls?.length ?? 0}. The clone tree differs from the original (already our bug).`);
        } else {
          const k = this.cam.scale || 1;
          const HTML_NS = "http://www.w3.org/1999/xhtml";
          const name = (e: Element) => `${e.tagName.toLowerCase()}.${(e.getAttribute("class") || "").split(" ").filter(Boolean).join(".")}`;
          const oCard = origCard.getBoundingClientRect(), cCard = clone!.getBoundingClientRect();
          const rows: { el: string; d_top: number; d_left: number; d_w: number; d_h: number; d_off: number; ctx: string }[] = [];
          let maxTop = 0, maxLeft = 0, maxW = 0, maxH = 0, htmlN = 0;
          for (let i = 0; i < oEls.length; i++) {
            if (oEls[i].namespaceURI !== HTML_NS) continue;
            htmlN++;
            const o = oEls[i], c = cEls[i];
            const ob = o.getBoundingClientRect(), cb = c.getBoundingClientRect();
            const oT = (ob.top - oCard.top) / k, oL = (ob.left - oCard.left) / k, oW = ob.width / k, oH = ob.height / k;
            const cT = (cb.top - cCard.top) / REF, cL = (cb.left - cCard.left) / REF, cW = cb.width / REF, cH = cb.height / REF;
            const dTop = +(cT - oT).toFixed(2), dLeft = +(cL - oL).toFixed(2), dW = +(cW - oW).toFixed(2), dH = +(cH - oH).toFixed(2);
            const dOff = +((c.offsetTop - o.offsetTop) - dTop).toFixed(2);
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
    const anyCaptured = this.nodes.length === 0 || this.nodes.some((n) => n.refImg);
    if (!anyCaptured && this.nodes.length) {
      // Settle anyway, or the tick loop spins requestPaint every frame.
      HtmlCanvasRenderer.logPathOnce("captureElementImage threw for every node — falling back to scratch-canvas rasterization");
      this.captured = true;
      return;
    }
    this.captured = anyCaptured;
  };

  private buildMips = async (): Promise<void> => {
    if (this.building) return; this.building = true;
    // Loop until nothing is unbuilt: an updateNodes arriving mid-await returns early on the `building` guard.
    do {
    for (const n of this.nodes) {
      if (this.disposed) break;
      if (n.pyramid.length || n.mipFailed) continue;
      const pw = n.w + 2 * PAD, ph = n.h + 2 * PAD;
      let top: ImageBitmap | null = null;
      if (n.refImg) {
        try { top = await createImageBitmap(n.refImg as unknown as ImageBitmapSource); }
        catch (e) { top = null; HtmlCanvasRenderer.logPathOnce(`createImageBitmap(refImg) rejected (${String(e)}) — trying the scratch-canvas raster`); }
      }
      if (!top && this.sctx && typeof this.sctx.drawElementImage === "function") {
        try {
          const refW = Math.max(1, Math.round(pw * REF)), refH = Math.max(1, Math.round(ph * REF));
          this.scratch.width = refW; this.scratch.height = refH;
          this.sctx.clearRect(0, 0, refW, refH);
          this.sctx.drawElementImage(n.refImg ?? n.refEl, 0, 0, refW, refH);
          top = await createImageBitmap(this.scratch, 0, 0, refW, refH);
        } catch (e) { top = null; HtmlCanvasRenderer.logPathOnce(`scratch raster rejected (${String(e)})`); }
      }
      if (!top) {
        n.needsPaintRaster = true;
        HtmlCanvasRenderer.logPathOnce("bitmap paths unavailable — building mips via paint-event raster + region snapshot");
        continue;
      }
      n.pyramid = await this.downscaleChain(top, pw, ph, REF);
      this.builtCount++;
      this.dirty = true;
    }
    } while (!this.disposed && this.nodes.some((n) => !n.pyramid.length && !n.mipFailed && !n.needsPaintRaster));
    this.building = false;
    if (!this.disposed && this.nodes.some((n) => n.needsPaintRaster) && this.canvas.requestPaint) this.canvas.requestPaint();
  };

  /** `topScale` is the top bitmap's texture px per natural px. */
  private async downscaleChain(top: ImageBitmap, pw: number, ph: number, topScale: number): Promise<PyramidLevel[]> {
    const levels: PyramidLevel[] = [{ scale: topScale, bmp: top }];
    let cur = top, curScale = topScale;
    while (Math.min(pw, ph) * curScale > MIP_MIN_PX * 2 && levels.length < 12) {
      const nw = Math.max(1, Math.round(pw * curScale / 2)), nh = Math.max(1, Math.round(ph * curScale / 2));
      let next: ImageBitmap;
      try { next = await createImageBitmap(cur, { resizeWidth: nw, resizeHeight: nh, resizeQuality: "high" }); }
      catch { break; }
      curScale /= 2;
      levels.push({ scale: curScale, bmp: next });
      cur = next;
    }
    return levels;
  }

  // ── Paint-event raster (the spec-clean bitmap source) ────────────────────────
  // Runs inside the paint event and before drawFrame, which clears the atlas pixels in the same paint task.
  private static readonly RASTER_BATCH = IS_COARSE ? 24 : 48;
  private static readonly RASTER_MAX_ATTEMPTS = 5;
  private rasterValidated: boolean | null = null;
  private rasterPendingInPaint(): void {
    if (typeof this.ctx.drawElementImage !== "function" || this.rasterValidated === false) return;
    const { ctx, canvas } = this;
    const pending: EngineNode[] = [];
    for (const n of this.nodes) {
      if (pending.length >= HtmlCanvasRenderer.RASTER_BATCH) break;
      if (!n.needsPaintRaster || n.pyramid.length || n.mipFailed) continue;
      pending.push(n);
    }
    if (pending.length) {
      const items = pending.map((n) => ({
        id: n.id,
        w: Math.max(1, Math.round((n.w + 2 * PAD) * REF)),
        h: Math.max(1, Math.round((n.h + 2 * PAD) * REF)),
      }));
      const layout = packAtlas(items, canvas.width, canvas.height);
      const byId = new Map(pending.map((n) => [n.id, n]));
      const drawnJobs: Array<{ n: EngineNode; p: AtlasPlacement }> = [];
      if (layout.placements.length) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, layout.usedW, layout.usedH);
        for (const p of layout.placements) {
          const n = byId.get(p.id);
          if (!n) continue;
          try {
            ctx.drawElementImage!(n.refEl, p.x, p.y, p.w, p.h);
            n.needsPaintRaster = false; // In flight, so later paints skip it until the snapshot resolves; a failure re-arms it.
            drawnJobs.push({ n, p });
          } catch (e) {
            this.noteRasterFailure(n, e);
          }
        }
      }
      if (drawnJobs.length) {
        // createImageBitmap(canvas) copies at invocation, so this paint's clear cannot race it.
        void this.finishAtlasRaster(createImageBitmap(canvas, 0, 0, Math.max(1, layout.usedW), Math.max(1, layout.usedH)), drawnJobs);
      }
    }
    if (this.nodes.some((n) => n.needsPaintRaster && !n.mipFailed) && this.canvas.requestPaint) this.canvas.requestPaint();
  }

  private noteRasterFailure(n: EngineNode, e: unknown): void {
    n.rasterAttempts = (n.rasterAttempts ?? 0) + 1;
    if (n.rasterAttempts >= HtmlCanvasRenderer.RASTER_MAX_ATTEMPTS) {
      n.mipFailed = true;
      n.needsPaintRaster = false;
      HtmlCanvasRenderer.logPathOnce(`paint raster failed (${String(e)}) — affected nodes stay on the per-frame draw (slow) path`);
    } else {
      n.needsPaintRaster = true;
      if (this.canvas.requestPaint) this.canvas.requestPaint();
    }
  }

  private async finishAtlasRaster(atlasP: Promise<ImageBitmap>, jobs: Array<{ n: EngineNode; p: AtlasPlacement }>): Promise<void> {
    let atlas: ImageBitmap | null = null;
    try { atlas = await atlasP; } catch (e) { for (const { n } of jobs) this.noteRasterFailure(n, e); return; }
    try {
      if (this.disposed) return;
      if (this.rasterValidated === null) {
        try {
          const pc = document.createElement("canvas");
          pc.width = Math.min(64, atlas.width); pc.height = Math.min(64, atlas.height);
          const pctx = pc.getContext("2d")!;
          pctx.drawImage(atlas, 0, 0);
          const px = pctx.getImageData(0, 0, pc.width, pc.height).data;
          let ink = 0;
          for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) ink++;
          this.rasterValidated = ink > 0;
        } catch { this.rasterValidated = true; }
        if (!this.rasterValidated) {
          HtmlCanvasRenderer.logPathOnce("paint-raster read-back is BLANK (deferred raster) — route disabled, nodes stay on the per-frame draw path");
          for (const nn of this.nodes) if (nn.needsPaintRaster) { nn.needsPaintRaster = false; nn.mipFailed = true; }
          return;
        }
      }
      for (const { n, p } of jobs) {
        if (this.disposed) return;
        if (n.pyramid.length) continue;
        const pw = n.w + 2 * PAD, ph = n.h + 2 * PAD;
        let top: ImageBitmap;
        try { top = await createImageBitmap(atlas, p.x, p.y, p.w, p.h); }
        catch (e) { this.noteRasterFailure(n, e); continue; }
        n.pyramid = await this.downscaleChain(top, pw, ph, REF * p.scale);
        n.needsPaintRaster = false;
        this.builtCount++;
        this.dirty = true;
      }
    } finally {
      atlas?.close();
    }
  }

  private drawCables(vp: { minX: number; minY: number; maxX: number; maxY: number }): void {
    const { ctx, cam, bsx, bsy } = this;
    ctx.setTransform(bsx, 0, 0, bsy, 0, 0);
    ctx.lineWidth = 1.8 * cam.scale;
    ctx.lineJoin = "round";
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
    // Must match cableOpacity's non-hover default, or the gesture swap visibly pops.
    ctx.globalAlpha = 0.72;
    for (const [color, path] of byColor) { ctx.strokeStyle = color; ctx.stroke(path); }
    ctx.globalAlpha = 1;
  }

  private drawSelection(): void {
    if (!this.selectBox) return;
    const { ctx, bsx, bsy } = this;
    ctx.setTransform(bsx, 0, 0, bsy, 0, 0);
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

  // useCached draws the pyramid bitmaps; false draws the live elements while they build.
  private drawFrame(useCached: boolean): void {
    const { ctx, cam, dpr, canvas, host } = this;
    if (!ctx.drawElementImage) return;
    const t0 = performance.now();
    this.slowDraws = 0;
    if (typeof ctx.reset === "function") ctx.reset(); else ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.active) { this.presented = null; this.lastFrameMs = performance.now() - t0; return; }
    const { bsx, bsy } = this;
    const camCTM = () => ctx.setTransform(bsx * cam.scale, 0, 0, bsy * cam.scale, bsx * cam.tx, bsy * cam.ty);

    const idealI = computeIdealMipLevel(cam.scale, this.quality, dpr);
    this.curMip = useCached ? REF / Math.pow(2, idealI) : 0;

    const m = 40;
    const tl = cam.toWorld(-m, -m);
    const br = cam.toWorld(host.clientWidth + m, host.clientHeight + m);
    const vp = { minX: tl.wx, minY: tl.wy, maxX: br.wx, maxY: br.wy };
    const inView = (n: EngineNode): boolean => n.x + n.w >= vp.minX && n.x <= vp.maxX && n.y + n.h >= vp.minY && n.y <= vp.maxY;

    let syncM: DOMMatrix | undefined;
    let syncAnchor: { x: number; y: number } | null = null;

    const drawOne = (n: EngineNode): boolean => {
      const dx = n.x - PAD, dy = n.y - PAD, dw = n.w + 2 * PAD, dh = n.h + 2 * PAD;
      const keepSync = (m: DOMMatrix | undefined) => { if (m && !syncM) { syncM = m; syncAnchor = { x: dx, y: dy }; } };
      if (useCached) {
        if (n.pyramid.length) { ctx.drawImage(n.pyramid[Math.min(idealI, n.pyramid.length - 1)].bmp, dx, dy, dw, dh); return true; }
        if (n.refImg) { try { keepSync(ctx.drawElementImage!(n.refImg, dx, dy, dw, dh)); this.slowDraws++; return true; } catch { return false; } }
        try { keepSync(ctx.drawElementImage!(n.refEl, dx, dy, dw, dh)); this.slowDraws++; return true; } catch { return false; }
      }
      try { keepSync(ctx.drawElementImage!(n.refEl, dx, dy, dw, dh)); return true; } catch { return false; }
    };

    let drawn = 0;
    camCTM();
    const skip = this.domLive;
    for (const n of this.nodes) { if (n.isGroup && !skip.has(n.id) && inView(n) && drawOne(n)) drawn++; }
    this.drawCables(vp);
    camCTM();
    for (const n of this.nodes) { if (!n.isGroup && !skip.has(n.id) && inView(n) && drawOne(n)) drawn++; }
    this.nVisible = drawn;
    this.drawSelection();

    // ── Presented camera, for the DOM-only sync (domSync.ts) ─────────────────────
    const book: CamXform = { k: cam.scale, x: cam.tx, y: cam.ty };
    if (!syncM && drawn > 0 && typeof DOMMatrix === "function") {
      const get = this.nativeGetElementTransform();
      if (get) {
        const first = this.nodes.find((n) => inView(n));
        if (first) {
          const fx = first.x - PAD, fy = first.y - PAD;
          try {
            const dm = new DOMMatrix([cam.scale, 0, 0, cam.scale, cam.scale * fx + cam.tx, cam.scale * fy + cam.ty]);
            const m = get(first.refEl, dm);
            if (m) { syncM = m; syncAnchor = { x: fx, y: fy }; }
          } catch { /* experimental surface — the bookkeeping camera covers it */ }
        }
      }
    }
    let presented = book;
    if (syncM && syncAnchor) {
      const nat = camFromDrawMatrix(syncM, syncAnchor.x, syncAnchor.y);
      if (nat && plausibleNativeCam(nat, book)) presented = nat;
    }
    this.presented = presented;

    const t1 = performance.now();
    const dt = this.lastDrawTs ? t1 - this.lastDrawTs : 16;
    this.lastDrawTs = t1;
    const inst = 1000 / Math.max(1, dt);
    this.fpsEMA = this.fpsEMA ? this.fpsEMA * 0.8 + inst * 0.2 : inst;
    this.lastFrameMs = t1 - t0;
  }

  private nativeGetElementTransform(): ((el: Element, m: DOMMatrix) => DOMMatrix | undefined) | null {
    const c = this.ctx.getElementTransform;
    if (typeof c === "function") return c.bind(this.ctx);
    const k = this.canvas.getElementTransform;
    if (typeof k === "function") return k.bind(this.canvas);
    return null;
  }

  private hasUnbuiltVisible(): boolean {
    const { cam, host } = this;
    const m = 40;
    const tl = cam.toWorld(-m, -m);
    const br = cam.toWorld(host.clientWidth + m, host.clientHeight + m);
    for (const n of this.nodes) {
      if (n.pyramid.length) continue;
      if (n.x + n.w >= tl.wx && n.x <= br.wx && n.y + n.h >= tl.wy && n.y <= br.wy) return true;
    }
    return false;
  }

  private onPaint = (): void => {
    if (!this.captured) { this.captureRefs(); if (this.captured) void this.buildMips(); }
    // Runs first: the drawFrame below clears its scratch pixels in the same paint task.
    this.rasterPendingInPaint();
    const t = this.transformSource?.();
    if (t) this.setTransform(t.k, t.x, t.y);
    this.dirty = false; // this paint is the frame, so the next tick must not redraw it
    this.drawFrame(this.captured && !this.live);
  };

  private tick = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    if (!this.captured) {
      if (this.canvas.requestPaint) this.canvas.requestPaint(); else this.drawFrame(false);
      return;
    }
    if (!this.dirty) return;
    this.dirty = false;
    const needsElementDraw = this.active && (this.live || this.hasUnbuiltVisible());
    if (needsElementDraw && this.canvas.requestPaint) this.canvas.requestPaint();
    else this.drawFrame(true);
  };
}
