import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { htmlCanvasSpikeStore } from "../htmlCanvasSpikeStore";
import { Camera, pinchStep, panSweep, type Bounds } from "../pixi/pixiCamera";
import { cablePolyline } from "../pixi/pixiCableGeom";
import { snapshotGraph, type SnapCable } from "../pixi/pixiGraphSnapshot";
import { cableShapeStore } from "../cableShape";
import { getArea, getEditor } from "../process";
import { supportsHtmlInCanvas } from "../htmlCanvasSupport";
import "./rendererSpike.css";

/**
 * HTML-in-Canvas spike — the NATIVE alternative to hand-reproducing nodes on the
 * GPU. We hand the browser the REAL node DOM and let it draw into a `<canvas>` via
 * the WICG HTML-in-Canvas API (https://github.com/WICG/html-in-canvas) — no
 * element-by-element fidelity work, pixel-perfect, crisp at any zoom.
 *
 * Two draw paths (toggle in the HUD), the perf experiment:
 *  • LIVE  — `drawElementImage(liveNode)` each frame. Re-rasterizes at the camera
 *    transform → always crisp, but every paint re-snapshots all canvas children
 *    (the main-thread cost that makes heavy graphs struggle).
 *  • CACHED — `captureElementImage(node)` ONCE per node → an ElementImage, then
 *    `drawElementImage(image)` every frame in a plain rAF loop (no paint-event
 *    re-snapshot). Fast; softens when zoomed in past capture resolution.
 * Both VIEWPORT-CULL (draw only on-screen nodes). FPS + a 3s orbit benchmark
 * mirror the Pixi spike so the two are directly comparable.
 *
 * Requires Chrome with chrome://flags/#canvas-draw-element (Canary 149+).
 */

interface PyramidLevel { scale: number; bmp: ImageBitmap }
interface DrawNode { refEl: HTMLElement; refImg: ElementImageLike | null; pyramid: PyramidLevel[]; x: number; y: number; w: number; h: number; isGroup: boolean }

// Reference capture resolution (CSS `zoom` on the single clone). ≥1 so fixed-size UA
// widgets (scrollbars, focus rings, min-size borders) keep correct proportions — the
// old per-level capture at <1 zoom bloated them. 1.5 keeps the top level crisp to ~150%.
const REF: number = 1.5;
// Each card is rasterized ONCE at REF, then HALVED repeatedly (clean 2:1 each step) into
// a mip pyramid down to ~MIP_MIN_PX. Per frame we pick the smallest level whose texture
// still ≥ the slider's target size — so the aggressiveness slider is just a level
// selector (LOD bias), instant, no rebuild. `scale` is texture px ÷ natural card px.
const MIP_MIN_PX = 6;
// Aggressiveness slider range: target texture size as a fraction of the on-screen
// (device-px) card size. 1 ≈ 1:1 (crisp); <1 = smaller/cheaper/softer. Swept by feel.
const QUALITY_MIN = 0.15, QUALITY_MAX = 1.5, QUALITY_DEFAULT = 1.0;
// Exact zoom presets (the band centres) — snap here for repeatable per-band testing.
const ZOOM_PRESETS = [1.0, 0.65, 0.41, 0.25, 0.17] as const;
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
type Mode = "cached" | "live";

export function HtmlCanvasSpike() {
  const open = useSyncExternalStore(htmlCanvasSpikeStore.subscribe, htmlCanvasSpikeStore.get);
  const hostRef = useRef<HTMLDivElement>(null);
  const [supported] = useState(supportsHtmlInCanvas);
  const [stats, setStats] = useState<{ nodes: number; cables: number }>({ nodes: 0, cables: 0 });
  const [fps, setFps] = useState<number>(0);
  const [drawMs, setDrawMs] = useState<number>(0);
  const [visible, setVisible] = useState<number>(0);
  const [mipZoom, setMipZoom] = useState<number>(0);
  const [mipsBuilt, setMipsBuilt] = useState<number>(0);
  const [zoom, setZoom] = useState<number>(1);
  const [bench, setBench] = useState<{ avg: number; min: number } | null>(null);
  const [mode, setMode] = useState<Mode>("cached");
  const [canCapture, setCanCapture] = useState(true);
  const modeRef = useRef<Mode>("cached");
  modeRef.current = mode;
  const [quality, setQuality] = useState(QUALITY_DEFAULT);
  const qRef = useRef(QUALITY_DEFAULT);
  qRef.current = quality;
  const benchRef = useRef<() => void>(() => {});
  const markDirtyRef = useRef<() => void>(() => {});
  const zoomToRef = useRef<(t: number) => void>(() => {});

  // Quality changes take effect without rebuilding the canvas — just redraw.
  useEffect(() => { markDirtyRef.current(); }, [quality]);

  useEffect(() => {
    if (!open || !supported) return;
    const host = hostRef.current;
    if (!host) return;

    const canvas = document.createElement("canvas") as LayoutCanvas;
    canvas.className = "html-canvas-spike__canvas";
    canvas.setAttribute("layoutsubtree", "");
    canvas.layoutSubtree = true;
    host.appendChild(canvas);
    const ctx = canvas.getContext("2d") as Ctx2D;
    const captureOK = typeof canvas.captureElementImage === "function";
    setCanCapture(captureOK);
    if (!captureOK) modeRef.current = "live";

    const editor = getEditor();
    const area = getArea();
    const cam = new Camera();

    // Clone every node-view into the canvas (paint-contained, invisible). Groups,
    // notes, conduits, cards are uniform — the browser paints each as the DOM shows.
    const drawNodes: DrawNode[] = [];
    if (editor && area) {
      for (const node of editor.getNodes()) {
        const view = area.nodeViews.get(node.id);
        const src = view?.element;
        if (!view || !src) continue;
        if (getComputedStyle(src).visibility === "hidden") continue;
        const inner = src.querySelector<HTMLElement>(".solenoid-node, .solenoid-group, .solenoid-note, .solenoid-conduit") ?? src;
        const w = inner.offsetWidth, h = inner.offsetHeight;
        if (w <= 0 || h <= 0) continue;
        const isGroup = inner.classList.contains("solenoid-group");
        // ONE paint-contained clone at the reference resolution. Captured once; every
        // mip level is pixel-downscaled from that snapshot. Also the source for live mode.
        const refEl = inner.cloneNode(true) as HTMLElement;
        refEl.style.transform = "none";
        refEl.style.position = "absolute";
        refEl.style.left = "0"; refEl.style.top = "0"; refEl.style.margin = "0";
        refEl.style.width = `${w}px`; refEl.style.height = `${h}px`;
        refEl.style.boxSizing = "border-box";
        refEl.style.pointerEvents = "none";
        if (REF !== 1) refEl.style.setProperty("zoom", String(REF));
        canvas.appendChild(refEl);
        const dx = (inner.offsetLeft || 0), dy = (inner.offsetTop || 0);
        drawNodes.push({ refEl, refImg: null, pyramid: [], x: view.position.x + dx, y: view.position.y + dy, w, h, isGroup });
      }
    }

    const snap = snapshotGraph();
    const cables: SnapCable[] = snap?.cables ?? [];
    if (snap) cam.setFromAreaTransform(snap.transform);
    setStats({ nodes: drawNodes.length, cables: cables.length });

    const groups = drawNodes.filter((n) => n.isGroup);
    const cards = drawNodes.filter((n) => !n.isGroup);
    const shape = cableShapeStore.get();

    // Cable geometry is STATIC in world space (sockets don't move during pan/zoom),
    // so run the router + path-string parse ONCE here, not per frame. Each frame then
    // only transforms + strokes the cached polyline of cables that pass the bbox cull.
    interface CableGeom { pts: { x: number; y: number }[]; minX: number; minY: number; maxX: number; maxY: number }
    const cableGeoms: CableGeom[] = [];
    for (const cb of cables) {
      const pts = cablePolyline(shape, { sx: cb.sx, sy: cb.sy, ex: cb.ex, ey: cb.ey, sourceAngleDeg: cb.sourceAngleDeg, targetAngleDeg: cb.targetAngleDeg });
      if (pts.length < 2) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pts) {
        if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
      }
      cableGeoms.push({ pts, minX, minY, maxX, maxY });
    }

    // World bounds of the graph — the benchmark pan-sweeps the viewport across this.
    let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity;
    for (const n of drawNodes) {
      if (n.x < gMinX) gMinX = n.x; if (n.y < gMinY) gMinY = n.y;
      if (n.x + n.w > gMaxX) gMaxX = n.x + n.w; if (n.y + n.h > gMaxY) gMaxY = n.y + n.h;
    }
    const graphBounds: Bounds = drawNodes.length
      ? { minX: gMinX, minY: gMinY, maxX: gMaxX, maxY: gMaxY }
      : { minX: 0, minY: 0, maxX: host.clientWidth, maxY: host.clientHeight };

    let dpr = Math.max(1, window.devicePixelRatio || 1);
    const sizeCanvas = () => {
      dpr = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.round(host.clientWidth * dpr);
      canvas.height = Math.round(host.clientHeight * dpr);
    };
    sizeCanvas();

    // Viewport rect in WORLD coords (+ a margin) for frustum culling. Compute it
    // ONCE per frame (toWorld ×2), then test each node/cable against the plain rect.
    const viewportWorld = (): Bounds => {
      const m = 40;
      const tl = cam.toWorld(-m, -m);
      const br = cam.toWorld(host.clientWidth + m, host.clientHeight + m);
      return { minX: tl.wx, minY: tl.wy, maxX: br.wx, maxY: br.wy };
    };
    const inView = (n: DrawNode, vp: Bounds): boolean =>
      n.x + n.w >= vp.minX && n.x <= vp.maxX && n.y + n.h >= vp.minY && n.y <= vp.maxY;

    // Rasterize each card ONCE (reference snapshot) — must run inside/after a paint.
    // A scratch canvas is the fallback raster surface for the mip downscale below.
    const scratch = document.createElement("canvas") as LayoutCanvas;
    scratch.setAttribute("layoutsubtree", "");
    const sctx = scratch.getContext("2d") as Ctx2D | null;
    let captured = false;
    const captureRefs = () => {
      if (!captureOK || captured) return;
      for (const n of drawNodes) {
        try { n.refImg = canvas.captureElementImage!(n.refEl); } catch { n.refImg = null; }
      }
      captured = drawNodes.some((n) => n.refImg);
    };

    // Build the mip chain for every card from its reference snapshot — true mipmapping:
    // createImageBitmap GPU-downscales the captured pixels (so UA widgets keep their
    // proportions, no fractional-zoom bloat). Primary path treats the snapshot as an
    // image source directly; if that's unsupported, rasterize it onto a scratch canvas
    // and read that back. If BOTH fail, the per-frame refImg draw still covers the card
    // (artifact-free, just without the cheap small textures) — degrades, never breaks.
    let builtCount = 0, building = false;
    const buildMips = async () => {
      if (building) return; building = true;
      for (const n of drawNodes) {
        if (!n.refImg || n.pyramid.length) continue;
        // L0 = the reference snapshot as a bitmap. Primary path uses the snapshot as an
        // image source directly; scratch-canvas rasterize is the fallback.
        let top: ImageBitmap | null = null;
        try { top = await createImageBitmap(n.refImg as unknown as ImageBitmapSource); } catch { top = null; }
        if (!top && sctx && typeof sctx.drawElementImage === "function") {
          try {
            const refW = Math.max(1, Math.round(n.w * REF)), refH = Math.max(1, Math.round(n.h * REF));
            scratch.width = refW; scratch.height = refH;
            sctx.clearRect(0, 0, refW, refH);
            sctx.drawElementImage(n.refImg, 0, 0, refW, refH);
            top = await createImageBitmap(scratch, 0, 0, refW, refH);
          } catch { top = null; }
        }
        if (!top) { markDirtyRef.current(); continue; }
        // Halve down the pyramid (clean 2:1 each step — best downscale quality) until the
        // next level would fall below MIP_MIN_PX in either dimension.
        const levels: PyramidLevel[] = [{ scale: REF, bmp: top }];
        let cur = top, curScale = REF;
        while (Math.min(n.w, n.h) * curScale > MIP_MIN_PX * 2 && levels.length < 12) {
          const nw = Math.max(1, Math.round(n.w * curScale / 2)), nh = Math.max(1, Math.round(n.h * curScale / 2));
          let next: ImageBitmap;
          try { next = await createImageBitmap(cur, { resizeWidth: nw, resizeHeight: nh, resizeQuality: "high" }); }
          catch { break; }
          curScale /= 2;
          levels.push({ scale: curScale, bmp: next });
          cur = next;
        }
        n.pyramid = levels;
        builtCount++;
        markDirtyRef.current();
      }
      building = false;
    };

    // Cables draw in SCREEN space with a constant 2px width (they never thicken on
    // zoom). Cull by cached bbox, then batch every survivor into ONE Path2D so the
    // whole cable layer is a single stroke() — no per-cable beginPath/stroke churn.
    const drawCables = (vp: Bounds) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(160, 170, 190, 0.7)";
      ctx.lineJoin = "round";
      const path = new Path2D();
      for (const g of cableGeoms) {
        if (g.maxX < vp.minX || g.minX > vp.maxX || g.maxY < vp.minY || g.minY > vp.maxY) continue;
        const s0 = cam.toScreen(g.pts[0].x, g.pts[0].y);
        path.moveTo(s0.sx, s0.sy);
        for (let i = 1; i < g.pts.length; i++) {
          const s = cam.toScreen(g.pts[i].x, g.pts[i].y);
          path.lineTo(s.sx, s.sy);
        }
      }
      ctx.stroke(path);
    };

    let lastDrawTs = 0, fpsEMA = 0, nVisible = 0, lastFrameMs = 0;
    let curMipZoom = 0; // capture level used last frame (0 = live), shown in the HUD
    // useCached: draw the cached ElementImages (fast); else draw live elements
    // (crisp). Explicit dest w×h keeps a device-res ElementImage from drawing 2× too
    // big and pins the live element to its CSS size; the CTM applies dpr+zoom.
    const drawFrame = (useCached: boolean) => {
      if (!ctx.drawElementImage) return;
      const t0 = performance.now();
      if (typeof ctx.reset === "function") ctx.reset(); else ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const camCTM = () => ctx.setTransform(dpr * cam.scale, 0, 0, dpr * cam.scale, dpr * cam.tx, dpr * cam.ty);
      // Pick the pyramid level ONCE per frame (scale + slider are global). Target texture
      // scale = quality × on-screen device-px size; choose the smallest level whose scale
      // still ≥ that (level i has scale REF/2^i, so i = floor(log2(REF/target))).
      const target = qRef.current * cam.scale * dpr;
      const idealI = Math.max(0, Math.floor(Math.log2(REF / Math.max(target, 1e-4))));
      curMipZoom = useCached ? REF / Math.pow(2, idealI) : 0;
      // Draw one card: prefer the pyramid bitmap (drawImage — cheap small texture); fall
      // back to the reference snapshot until the pyramid builds; live mode re-rasterizes.
      const drawOne = (n: DrawNode): boolean => {
        if (useCached) {
          if (n.pyramid.length) { ctx.drawImage(n.pyramid[Math.min(idealI, n.pyramid.length - 1)].bmp, n.x, n.y, n.w, n.h); return true; }
          if (n.refImg) { try { ctx.drawElementImage!(n.refImg, n.x, n.y, n.w, n.h); return true; } catch { return false; } }
          return false;
        }
        try { ctx.drawElementImage!(n.refEl, n.x, n.y, n.w, n.h); return true; } catch { return false; }
      };
      const vp = viewportWorld();
      let drawn = 0;
      camCTM();
      for (const g of groups) { if (inView(g, vp) && drawOne(g)) drawn++; }
      drawCables(vp);
      camCTM();
      for (const n of cards) { if (inView(n, vp) && drawOne(n)) drawn++; }
      nVisible = drawn;
      const t1 = performance.now();
      const dt = lastDrawTs ? t1 - lastDrawTs : 16;
      lastDrawTs = t1;
      const inst = 1000 / Math.max(1, dt);
      fpsEMA = fpsEMA ? fpsEMA * 0.8 + inst * 0.2 : inst;
      lastFrameMs = t1 - t0;
    };

    // Paint event: capture (once), then a LIVE crisp draw. Used for the initial
    // frame and for the live mode (driven by requestPaint).
    const onPaint = () => {
      if (!captured) { captureRefs(); if (captured) void buildMips(); }
      drawFrame(false);
    };
    canvas.onpaint = onPaint;
    canvas.addEventListener("paint", onPaint as EventListener);

    // ── Drive ─────────────────────────────────────────────────────────────────
    let dirty = true;
    // Benchmark: a fixed-zoom PAN sweep across the graph (panSweep figure-8), sampling
    // REAL rAF-to-rAF frame intervals — NOT draw-call time, which badly under-counts
    // HTML-in-Canvas cost (drawElementImage re-rasterizes during browser paint/composite,
    // after our JS returns). Pan is what feels janky; holding zoom fixed isolates it.
    let bench: { frame: number; total: number; deltas: number[]; lastTs: number; base: { scale: number; tx: number; ty: number } } | null = null;
    const markDirty = () => { dirty = true; };
    markDirtyRef.current = markDirty;

    // Snap to an EXACT zoom, centred on the graph — so a band (e.g. 41%) frames the
    // same content every load and is repeatably testable (free-wheel zoom can't).
    zoomToRef.current = (target: number) => {
      cam.scale = target;
      const cx = (graphBounds.minX + graphBounds.maxX) / 2;
      const cy = (graphBounds.minY + graphBounds.maxY) / 2;
      cam.tx = host.clientWidth / 2 - cx * target;
      cam.ty = host.clientHeight / 2 - cy * target;
      markDirty();
    };

    const finishBench = () => {
      if (!bench) return;
      const deltas = bench.deltas.filter((d) => d > 0);
      const base = bench.base;
      bench = null;
      cam.scale = base.scale; cam.tx = base.tx; cam.ty = base.ty; dirty = true;
      if (deltas.length) {
        const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
        const worst = Math.max(...deltas);
        setBench({ avg: Math.round(1000 / Math.max(1, avg)), min: Math.round(1000 / Math.max(1, worst)) });
      }
    };
    benchRef.current = () => {
      setBench(null);
      bench = { frame: 0, total: 180, deltas: [], lastTs: performance.now(), base: { scale: cam.scale, tx: cam.tx, ty: cam.ty } };
    };

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (bench) {
        const now = performance.now();
        if (bench.frame > 0) bench.deltas.push(now - bench.lastTs); // drop warm-up
        bench.lastTs = now;
        const { tx, ty } = panSweep(graphBounds, host.clientWidth, host.clientHeight, bench.base.scale, bench.frame / bench.total);
        cam.scale = bench.base.scale; cam.tx = tx; cam.ty = ty;
        dirty = true;
      }
      if (!dirty) return;
      dirty = false;
      if (modeRef.current === "cached" && captured) drawFrame(true);
      else if (canvas.requestPaint) canvas.requestPaint(); // → onpaint → live draw
      else drawFrame(false);
      if (bench) { bench.frame++; if (bench.frame > bench.total) finishBench(); }
    };

    // Kick the first paint so clones lay out + capture; then run.
    if (canvas.requestPaint) canvas.requestPaint();
    let kicks = 0;
    const kick = window.setInterval(() => {
      if (!captured && captureOK) { if (canvas.requestPaint) canvas.requestPaint(); else { captureRefs(); if (captured) void buildMips(); } }
      markDirty();
      if (++kicks > 20) clearInterval(kick);
    }, 60);
    raf = requestAnimationFrame(tick);

    const fpsTimer = window.setInterval(() => { setFps(Math.round(fpsEMA)); setDrawMs(Math.round(lastFrameMs * 10) / 10); setVisible(nVisible); setMipZoom(curMipZoom); setZoom(cam.scale); setMipsBuilt(builtCount); }, 350);

    // ── Interaction ─────────────────────────────────────────────────────────────
    const pointers = new Map<number, { x: number; y: number }>();
    let dragNode: DrawNode | null = null;
    let panning = false;
    let last = { x: 0, y: 0 };
    let pinchPrev: { dist: number; mid: { x: number; y: number } } | null = null;

    const nodeAt = (sx: number, sy: number): DrawNode | null => {
      const { wx, wy } = cam.toWorld(sx, sy);
      for (let i = cards.length - 1; i >= 0; i--) {
        const n = cards[i];
        if (wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h) return n;
      }
      return null;
    };
    const onDown = (e: PointerEvent) => {
      e.preventDefault(); // stop the browser starting a text selection across the clones
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) { panning = false; dragNode = null; const [a, b] = [...pointers.values()]; pinchPrev = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; return; }
      const r = canvas.getBoundingClientRect();
      dragNode = nodeAt(e.clientX - r.left, e.clientY - r.top);
      panning = !dragNode;
      last = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && pinchPrev) {
        const [a, b] = [...pointers.values()];
        const step = pinchStep(a, b, pinchPrev.dist, pinchPrev.mid);
        const r = canvas.getBoundingClientRect();
        cam.panBy(step.panX, step.panY);
        cam.zoomBy(step.factor, step.mid.x - r.left, step.mid.y - r.top);
        pinchPrev = { dist: step.dist, mid: step.mid };
        markDirty();
        return;
      }
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      if (dragNode) { dragNode.x += dx / cam.scale; dragNode.y += dy / cam.scale; markDirty(); }
      else if (panning) { cam.panBy(dx, dy); markDirty(); }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchPrev = null;
      if (pointers.size === 0) { panning = false; dragNode = null; }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      cam.zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
      markDirty();
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    const onResize = () => { sizeCanvas(); markDirty(); };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(kick); clearInterval(fpsTimer);
      canvas.onpaint = null;
      canvas.removeEventListener("paint", onPaint as EventListener);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", onResize);
      for (const n of drawNodes) { n.refImg?.close?.(); for (const p of n.pyramid) p.bmp?.close?.(); }
      host.replaceChildren();
    };
  }, [open, supported]);

  if (!open) return null;

  const fpsClass = fps >= 55 ? "ok" : fps >= 30 ? "warn" : "bad";
  return (
    <div className="renderer-spike">
      <div className="renderer-spike__host html-canvas-spike__host" ref={hostRef} />
      <div className="renderer-spike__hud">
        <div className="renderer-spike__row renderer-spike__title">
          <b>HTML-in-Canvas spike</b>
          <button className="renderer-spike__close" onClick={() => htmlCanvasSpikeStore.close()} title="Close (Esc)">✕</button>
        </div>
        {supported ? (
          <>
            <div className="renderer-spike__seg">
              <button className={mode === "cached" ? "active" : ""} onClick={() => setMode("cached")} disabled={!canCapture} title="captureElementImage once, redraw cached (fast)">Cached</button>
              <button className={mode === "live" ? "active" : ""} onClick={() => setMode("live")} title="drawElementImage(live) every frame (crisp)">Live</button>
            </div>
            <div className="renderer-spike__seg renderer-spike__seg--sub">
              <span className="renderer-spike__seg-label">aggro</span>
              <input
                type="range"
                min={QUALITY_MIN}
                max={QUALITY_MAX}
                step={0.05}
                value={quality}
                onChange={(e) => setQuality(parseFloat(e.target.value))}
                onPointerDown={(e) => e.stopPropagation()}
                title="Mip aggressiveness — target texture size ÷ on-screen size. Left = aggressive (smaller texture, cheaper, softer); right = crisp."
                style={{ flex: 1, minWidth: 0 }}
              />
              <b style={{ minWidth: 30, textAlign: "right" }}>{quality.toFixed(2)}</b>
            </div>
            <div className="renderer-spike__row"><span>fps</span><b className={fpsClass}>{fps}</b></div>
            <div className="renderer-spike__row"><span>draw</span><b>{drawMs} ms</b></div>
            <div className="renderer-spike__row"><span>visible</span><b>{visible} / {stats.nodes}</b></div>
            <div className="renderer-spike__row"><span>zoom</span><b>{zoom < 0.1 ? (zoom * 100).toFixed(1) : Math.round(zoom * 100)}%</b></div>
            <div className="renderer-spike__row"><span>mip</span><b>{mode !== "cached" ? "live" : mipZoom ? `${mipZoom}×` : "—"}</b></div>
            <div className="renderer-spike__row"><span>mip built</span><b>{mipsBuilt}/{stats.nodes}</b></div>
            <div className="renderer-spike__row"><span>cables</span><b>{stats.cables}</b></div>
            <div className="renderer-spike__seg renderer-spike__seg--sub">
              <span className="renderer-spike__seg-label">zoom</span>
              {ZOOM_PRESETS.map((z) => (
                <button key={z} onClick={() => zoomToRef.current(z)} title={`Snap to exactly ${Math.round(z * 100)}%, centred on the graph`}>{Math.round(z * 100)}</button>
              ))}
            </div>
            <div className="renderer-spike__seg">
              <button onClick={() => benchRef.current()} title="Pan-sweep the graph for ~3s and report real frame-time fps">Benchmark</button>
            </div>
            {bench && (
              <div className="renderer-spike__row renderer-spike__bench">
                <span>avg <b className={bench.avg >= 55 ? "ok" : bench.avg >= 30 ? "warn" : "bad"}>{bench.avg}</b></span>
                <span>worst <b className={bench.min >= 50 ? "ok" : bench.min >= 24 ? "warn" : "bad"}>{bench.min}</b> fps</span>
              </div>
            )}
            {!canCapture && <div className="renderer-spike__row" style={{ fontSize: 11, opacity: 0.7 }}>captureElementImage unavailable — Live only.</div>}
          </>
        ) : (
          <div className="renderer-spike__row" style={{ maxWidth: 260, lineHeight: 1.5 }}>
            <b>HTML-in-Canvas not available.</b><br />
            Enable <code>chrome://flags/#canvas-draw-element</code> in Chrome Canary 149+ and reload. (No Firefox/Safari yet.)
          </div>
        )}
      </div>
    </div>
  );
}
