import { useEffect, useRef, useState } from "react";
import { useRenderMode } from "../renderMode";
import { zoomSettleMs } from "../zoomSettle";
import { IS_COARSE } from "../coarse";
import { HtmlCanvasRenderer, type EngineNodeSpec } from "../htmlCanvasRenderer";
import { getEditor, getArea, connectionVersionStore } from "../process";
import { nodeDomWeight } from "../nodes/kind";
import { snapshotGraph } from "../hicGraphSnapshot";
import { cableShapeStore } from "../cableShape";
import { semanticZoomStore } from "../semanticZoomStore";
import { collapseStore } from "../collapseStore";
import { groupCollapseStore } from "../groupCollapse";
import { nodeSizeStore } from "../nodeSizeStore";
import { groupMembershipStore } from "../groupMembership";
import { appThemeStore } from "../appTheme";
import { formatAnnotationStore } from "../formatAnnotationStore";
import { lassoActiveStore } from "../lasso";
import { holderSyncTransform, holderTransform } from "../domSync";
import "./htmlCanvasLayer.css";

// Below this the native DOM pans fine and the capture/swap cost isn't worth it, so the layer
// stays inert. The unit is KIND-WEIGHTED DOM (nodeDomWeight), not a raw node count.
const RENDERER_MIN_NODES = 100;

const graphDomWeight = (): number => {
  const ed = getEditor();
  if (!ed) return 0;
  let w = 0;
  for (const n of ed.getNodes()) w += nodeDomWeight(n);
  return w;
};

/** The fast PAN/ZOOM layer, not a DOM replacement: idle draws nothing so every interaction
 *  stays native; a gesture hides the holder with `visibility:hidden` (which keeps layout, so
 *  the DOM stays measurable) and the canvas draws the captured graph. */
export function HtmlCanvasLayer() {
  const mode = useRenderMode();
  const hostRef = useRef<HTMLDivElement>(null);
  // Seeded synchronously so toggling render mode on over an already-loaded big graph engages
  // on the next render, not only after the first add/remove.
  const [domWeight, setDomWeight] = useState(graphDomWeight);
  const minNodes = (window as unknown as { __hcMinNodes?: number }).__hcMinNodes ?? RENDERER_MIN_NODES;
  const active = mode === "html" && domWeight >= minNodes;

  // On a fresh load this effect can run before canvas init fills the process.ts
  // singletons; poll for them or the setup effect bails and never re-runs.
  const [ready, setReady] = useState(() => !!getEditor() && !!getArea());
  useEffect(() => {
    if (!active || ready) return;
    if (getEditor() && getArea()) { setReady(true); return; }
    const t = window.setInterval(() => {
      if (getEditor() && getArea()) { setReady(true); clearInterval(t); }
    }, 120);
    return () => clearInterval(t);
  }, [active, ready]);

  // Recount on BIND and on node add/remove, and run whenever mode is "html" (NOT gated on
  // `active`) — below the threshold `active` is false yet the crossing must still be noticed.
  // Add/remove events flow through the EDITOR pipe (the flow area only relays `render`).
  useEffect(() => {
    if (mode !== "html") return;
    let live = true;
    let bound = false;
    const recount = () => setDomWeight(graphDomWeight());
    const bind = (): boolean => {
      if (bound) return true;
      const editor = getEditor();
      if (!editor || !getArea()) return false;
      bound = true;
      recount();
      // editor.addPipe can't be removed — `live` neutralises it on cleanup; `bound` keeps it to one.
      editor.addPipe((ctx) => {
        if (live && ctx && typeof ctx === "object" && "type" in ctx) {
          const t = (ctx as { type: string }).type;
          if (t === "nodecreated" || t === "noderemoved") recount();
        }
        return ctx;
      });
      return true;
    };
    const iv = bind() ? 0 : window.setInterval(() => { if (bind()) clearInterval(iv); }, 120);
    return () => { live = false; if (iv) clearInterval(iv); };
  }, [mode]);

  useEffect(() => {
    if (!active || !ready) return;
    const host = hostRef.current;
    const editor = getEditor();
    const area = getArea();
    if (!host || !editor || !area) return;
    // The transformed content element: React Flow's viewport (the flow area's
    // `content.holder` is a detached placeholder). Hiding it hides nodes+edges;
    // DOM-only elements punch through with inline `visibility: visible`.
    const holder = (area.container.querySelector<HTMLElement>(".react-flow__viewport") ??
      (area.area.content.holder as HTMLElement));
    // RF stamps inline `visibility: visible` on every measured node wrapper, so the viewport's
    // own visibility never reaches the cards; the class carries a rule that beats the inline
    // style (htmlCanvasLayer.css). DOM-only elements opt out of it via `solenoid-hic-domonly`.
    const setHolderHidden = (h: boolean) => {
      holder.style.visibility = h ? "hidden" : "";
      holder.classList.toggle("solenoid-html-hidden", h);
    };
    const holderHidden = () => holder.classList.contains("solenoid-html-hidden");

    const engine = new HtmlCanvasRenderer(host);
    // Read at PAINT time, since a paint can land a frame after the rAF that scheduled it.
    engine.setTransformSource(() => area.area.transform);
    let built = false;
    // id → the inner element's offset within its node-view wrapper. Cached at build so the
    // gesture-start position sync reads only `view.position` (no layout-forcing offsetLeft).
    const offsets = new Map<string, { dx: number; dy: number }>();

    // "DOM-only" nodes stay rendered by the real DOM through a gesture — the escape hatch for
    // elements the flat node/cable capture can't reproduce (a Conduit rotates and bundles).
    const isDomOnly = (inner: HTMLElement) => inner.classList.contains("solenoid-conduit");
    const domOnlyIds = new Set<string>();
    let domOnlyEls: HTMLElement[] = [];
    // Override-aware, because group collapse stamps inline visibility on the SAME elements:
    // never override an element something else hid, and only clear a "visible" WE stamped.
    const showDomOnly = () => { for (const el of domOnlyEls) if (el.style.visibility !== "hidden") { el.style.visibility = "visible"; el.classList.add("solenoid-hic-domonly"); } };
    const hideDomOnly = (els: HTMLElement[] = domOnlyEls) => { for (const el of els) { if (el.style.visibility === "visible") el.style.visibility = ""; el.classList.remove("solenoid-hic-domonly"); } };
    // Per-ELEMENT promotion on coarse pointers, where the holder-wide promotion is disabled.
    // Size-capped: a graph-spanning element must never get a giant layer.
    const PROMOTE_MAX = 1024; // CSS px — under mobile texture limits even at dpr 3
    let promoted: HTMLElement[] = [];
    const demoteDomOnly = () => { for (const el of promoted) el.style.willChange = ""; promoted = []; };
    const promoteDomOnly = () => {
      demoteDomOnly();
      if (!IS_COARSE) return;
      for (const el of domOnlyEls) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.width <= PROMOTE_MAX && r.height <= PROMOTE_MAX) {
          el.style.willChange = "transform";
          promoted.push(el);
        }
      }
    };
    // id → last-built spec, so a selection change re-captures JUST the toggled nodes; `el` is
    // the live inner element, so re-cloning picks up its current class.
    const specById = new Map<string, EngineNodeSpec>();

    const collectSpecs = (): EngineNodeSpec[] => {
      offsets.clear();
      domOnlyIds.clear();
      specById.clear();
      const specs: EngineNodeSpec[] = [];
      for (const node of editor.getNodes()) {
        const view = area.nodeViews.get(node.id);
        const src = view?.element;
        if (!view || !src) continue;
        if (getComputedStyle(src).visibility === "hidden") continue; // collapsed-group member
        const inner = src.querySelector<HTMLElement>(".solenoid-node, .solenoid-group, .solenoid-note, .solenoid-conduit") ?? src;
        if (isDomOnly(inner)) { domOnlyIds.add(node.id); continue; } // stays DOM; skip the canvas
        const w = inner.offsetWidth, h = inner.offsetHeight;
        if (w <= 0 || h <= 0) continue;
        const dx = inner.offsetLeft || 0, dy = inner.offsetTop || 0;
        offsets.set(node.id, { dx, dy });
        const spec: EngineNodeSpec = { id: node.id, el: inner, x: view.position.x + dx, y: view.position.y + dy, w, h, isGroup: inner.classList.contains("solenoid-group") };
        specById.set(node.id, spec);
        specs.push(spec);
      }
      return specs;
    };

    // Everything the canvas isn't drawing keeps its real DOM element — DOM-only node views, any
    // cable outside `canvasCableIds` (conduit or snapshot-unresolvable), and the standoff svg.
    const collectDomOnlyEls = (canvasCableIds: Set<string>): HTMLElement[] => {
      const els: HTMLElement[] = [];
      for (const id of domOnlyIds) { const el = area.nodeViews.get(id)?.element; if (el) els.push(el); }
      for (const conn of editor.getConnections()) {
        if (canvasCableIds.has(conn.id)) continue; // the canvas draws this one
        const el = area.connectionViews.get(conn.id)?.element;
        if (el) els.push(el);
      }
      const standoffSvg = holder.querySelector<HTMLElement>(".solenoid-standoff-svg");
      if (standoffSvg) els.push(standoffSvg);
      return els;
    };

    // The holder may be visibility:hidden mid-gesture, which the snapshot reads as absent, so
    // un-hide synchronously and re-hide before yielding — no paint mid-tick, no flash.
    const doBuild = (): boolean => {
      const hidden = holderHidden();
      if (hidden) setHolderHidden(false);
      const specs = collectSpecs();
      const snap = snapshotGraph();
      // Drawable = snapshot-resolvable AND not touching a DOM-only node; the id set lets
      // collectDomOnlyEls keep the rest.
      const canvasCables = snap ? snap.cables.filter((c) => !domOnlyIds.has(c.source) && !domOnlyIds.has(c.target)) : [];
      const canvasCableIds = new Set(canvasCables.map((c) => c.id));
      // Clear the OLD set's overrides first, or an element dropped from it keeps its inline
      // "visible" forever.
      const prevEls = domOnlyEls;
      domOnlyEls = collectDomOnlyEls(canvasCableIds);
      if (hidden) setHolderHidden(true);
      hideDomOnly(prevEls);
      if (gesturing) { showDomOnly(); promoteDomOnly(); } // a rebuild mid-gesture must re-show (and re-promote) the possibly-new set
      if (!specs.length) return false;
      engine.setNodes(specs);
      if (snap) engine.setCables(canvasCables, cableShapeStore.get());
      return true;
    };

    // ── Gesture swap ──────────────────────────────────────────────────────────────
    let gesturing = false;
    let gestureTimer = 0;
    // True while WE last wrote the holder's transform (steering DOM-only content onto
    // the canvas's presented frame) — so exit/cleanup knows to hand the transform back.
    let holderSynced = false;
    // Once a gesture has zoomed it exits on the longer `zoomSettleMs()` instead of the pan
    // settle, since zoom has no held-pointer signal and re-entering per wheel notch repaints
    // the visible DOM at the new raster scale each time.
    let gestureZoomed = false;
    const PAN_SETTLE_MS = 140;
    const readSelection = () => {
      const sel = new Set<string>();
      for (const node of editor.getNodes()) if ((node as { selected?: boolean }).selected) sel.add(node.id);
      engine.setSelected(sel);
    };
    const enterGesture = () => {
      if (!gesturing) {
        gesturing = true;
        readSelection();
        setHolderHidden(true); // visibility keeps layout + the in-flight drag alive (unlike display:none)
        holder.classList.add("solenoid-html-frozen"); // freeze DOM-only cable flow to match the static canvas
        // Gesture-scoped compositor layer so DOM-only content doesn't repaint per frame — but
        // NEVER on coarse pointers, where a layer this size fails mobile tile allocation.
        if (!IS_COARSE) holder.style.willChange = "transform";
        showDomOnly(); // but keep DOM-only nodes (conduits) + their cables visible through the canvas
        promoteDomOnly(); // coarse-only per-element layers, so those elements pan composited
        engine.setActive(true);
      }
      clearTimeout(gestureTimer);
      gestureTimer = window.setTimeout(exitGesture, gestureZoomed ? zoomSettleMs() : PAN_SETTLE_MS);
    };
    const exitGesture = () => {
      gesturing = false;
      gestureZoomed = false;
      setHolderHidden(false);
      holder.classList.remove("solenoid-html-frozen"); // resume cable flow
      holder.style.willChange = "";
      hideDomOnly(); // drop the per-element override; the holder is fully visible again
      demoteDomOnly();
      // Re-serialize the live camera if the frame sync steered it; RF's next viewport
      // commit overwrites with its own equivalent.
      if (holderSynced) { holder.style.transform = holderTransform(area.area.transform); holderSynced = false; }
      engine.setActive(false);
    };

    // Start in the gesture state so there's no DOM+canvas double-image while capturing.
    setHolderHidden(true);
    engine.setActive(true);
    gesturing = true;
    const tryBuild = () => {
      if (built) return;
      if (doBuild()) { built = true; enterGesture(); } // schedules the drop to idle
    };
    tryBuild();
    const retry = window.setInterval(() => { tryBuild(); if (built) clearInterval(retry); }, 120);

    // Every card re-render must reach scheduleRebuild by one of two channels:
    // area.update("node", id) via the render pipe below (flowArea relays it), or a
    // module store subscribed here. The
    // subscribed set, one per painted-appearance driver:
    //   • connectionVersionStore — topology; • collapseStore — chevron collapse;
    //   • nodeSizeStore — manual resize; • groupMembershipStore — group recolor + member dots;
    //   • appThemeStore — theme/accent/palette retint; • formatAnnotationStore — displayed
    //     value text without recompute; • cableShapeStore — re-route on shape swap.
    // Deliberately NOT subscribed: socketHighlightStore (per-hover churn), formatMismatchStore
    // and packsStore (rare, sub-glyph). A new painted-appearance store belongs here.
    // Returns null when the node is unknown/new — the caller falls back to a full build.
    const refreshSpec = (id: string): EngineNodeSpec | null => {
      if (!specById.has(id)) return null;
      const view = area.nodeViews.get(id);
      const src = view?.element;
      if (!view || !src) return null;
      const inner = src.querySelector<HTMLElement>(".solenoid-node, .solenoid-group, .solenoid-note, .solenoid-conduit") ?? src;
      const w = inner.offsetWidth, h = inner.offsetHeight;
      if (w <= 0 || h <= 0) return null;
      const dx = inner.offsetLeft || 0, dy = inner.offsetTop || 0;
      offsets.set(id, { dx, dy });
      const spec: EngineNodeSpec = { id, el: inner, x: view.position.x + dx, y: view.position.y + dy, w, h, isGroup: inner.classList.contains("solenoid-group") };
      specById.set(id, spec);
      return spec;
    };

    let rebuildTimer = 0;
    // Ids whose card re-rendered since the last build; null = unknown scope → full rebuild,
    // which re-clones every card and rebuilds every mip pyramid.
    let dirtyIds: Set<string> | null = new Set();
    const scheduleRebuild = (id?: string) => {
      // Mid-lasso the only thing changing is selection; re-capturing on every node it touches
      // would thrash the very work the canvas is here to avoid. Hold all rebuilds until release.
      if (!built || lassoActiveStore.get()) return;
      if (id === undefined) dirtyIds = null;
      else if (dirtyIds) dirtyIds.add(id);
      clearTimeout(rebuildTimer);
      rebuildTimer = window.setTimeout(() => {
        const ids = dirtyIds;
        dirtyIds = new Set();
        if (ids) {
          const specs: EngineNodeSpec[] = [];
          let fallback = false;
          for (const i of ids) {
            if (domOnlyIds.has(i)) continue; // DOM-rendered (conduit) — canvas doesn't draw it
            const s = refreshSpec(i);
            if (s) specs.push(s);
            else { fallback = true; break; } // a new/vanished node → scope unknown
          }
          if (!fallback) {
            if (specs.length) {
              engine.updateNodes(specs);
              // A grown value box moves the card's edges — cables re-anchor.
              engine.relayoutCables(new Set(specs.map((s) => s.id)));
            }
            return;
          }
        }
        doBuild();
      }, 150);
    };
    // `window.__hcTriggers` counts rebuild causes, so a store firing per pass (a renderer hang)
    // is readable from the console instead of guessed.
    const triggers: Record<string, number> = {};
    (window as unknown as { __hcTriggers?: Record<string, number> }).__hcTriggers = triggers;
    // Console stats: `slow` = visible nodes re-rasterized per frame, `failed` = permanently
    // unbuildable pyramids, `domOnly` = elements kept as live DOM through a gesture.
    (window as unknown as { __hcStats?: () => unknown }).__hcStats =
      () => ({ ...engine.getStats(), domOnly: domOnlyEls.length });
    (window as unknown as { __hcProbe?: () => void }).__hcProbe = () => engine.probe();
    const count = (cause: string) => { triggers[cause] = (triggers[cause] ?? 0) + 1; };
    const fullRebuild = (cause: string) => () => { count(cause); scheduleRebuild(); };
    // NOT cableValueStore: value changes already arrive per-id through the render pipe, and
    // the store bump carries no ids, so it would force a full rebuild every pass.
    const unsubConn = connectionVersionStore.subscribe(fullRebuild("connection"));
    const unsubCollapse = collapseStore.subscribe(fullRebuild("collapse"));
    // Group collapse fires area.update for the GROUP id alone, so without this its members
    // keep their cached bitmaps and stay drawn.
    const unsubGroupCollapse = groupCollapseStore.subscribe(fullRebuild("groupCollapse"));
    const unsubSize = nodeSizeStore.subscribe(fullRebuild("nodeSize"));
    const unsubMembership = groupMembershipStore.subscribe(fullRebuild("membership")); // recolor member dots on group color/membership change
    const unsubTheme = appThemeStore.subscribe(fullRebuild("theme")); // retint on theme / accent / palette change
    const unsubFmt = formatAnnotationStore.subscribe(fullRebuild("formatAnnotation")); // re-capture reformatted value text
    const unsubShape = cableShapeStore.subscribe(fullRebuild("cableShape")); // re-route on cable-shape change
    // Semantic zoom flips a root CSS class the captured bitmaps don't know about.
    const unsubSemantic = semanticZoomStore.subscribe(fullRebuild("semanticZoom"));
    // area.addPipe has no unsubscribe, so guard with a flag the cleanup flips instead.
    let pipeLive = true;
    area.addPipe((ctx: unknown) => {
      if (pipeLive && ctx && typeof ctx === "object" && "type" in ctx) {
        const c = ctx as { type: string; data?: { type?: string; payload?: { id?: string } } };
        if (c.type === "render" && c.data?.type === "node") { count("render-pipe"); scheduleRebuild(c.data.payload?.id); }
      }
      return ctx;
    });

    // ANY motion — transform change or node drag — is a gesture; discrete interactions move
    // nothing and so stay on the DOM.
    let lastK = NaN, lastX = NaN, lastY = NaN;
    let lastSel = new Set<string>();
    let lastQuality = NaN;
    let raf = requestAnimationFrame(function sync() {
      const t = area.area.transform;
      engine.setTransform(t.k, t.x, t.y);
      // Console knobs: `__hcLive` = per-frame re-raster, `__hcQuality` = LOD bias (texture px ÷
      // on-screen px), `__hcOverlay` = half-opacity over the DOM.
      const w = window as unknown as { __hcOverlay?: boolean; __hcLive?: boolean; __hcQuality?: number };
      const overlay = !!w.__hcOverlay;
      engine.setDebug(overlay);
      engine.setLive(!!w.__hcLive);
      if (typeof w.__hcQuality === "number" && w.__hcQuality !== lastQuality) {
        lastQuality = w.__hcQuality;
        engine.setQuality(w.__hcQuality);
      }
      if (built) {
        let moved = t.k !== lastK || t.x !== lastX || t.y !== lastY;
        // NaN-guarded so the first frame doesn't count as a zoom.
        if (Number.isFinite(lastK) && t.k !== lastK) gestureZoomed = true;
        lastK = t.k; lastX = t.x; lastY = t.y;
        const movedIds = new Set<string>();
        // Read from the LIVE DOM class, not node.selected: keying off the model races React's
        // class write and clones the node a frame before the ring lands.
        const curSel = new Set<string>();
        for (const node of editor.getNodes()) {
          const off = offsets.get(node.id);
          const view = area.nodeViews.get(node.id);
          if (off && view && engine.setNodePosition(node.id, view.position.x + off.dx, view.position.y + off.dy)) movedIds.add(node.id);
          const spec = specById.get(node.id);
          if (spec && spec.el.className.includes("--selected")) curSel.add(node.id);
        }
        if (movedIds.size) { engine.relayoutCables(movedIds); moved = true; }
        // Re-capture ONLY the toggled nodes, so a lasso sweep stays cheap.
        let selChanged = curSel.size !== lastSel.size;
        if (!selChanged) for (const id of curSel) if (!lastSel.has(id)) { selChanged = true; break; }
        if (selChanged) {
          const changed: EngineNodeSpec[] = [];
          for (const id of curSel) if (!lastSel.has(id)) { const s = specById.get(id); if (s) changed.push(s); }
          for (const id of lastSel) if (!curSel.has(id)) { const s = specById.get(id); if (s) changed.push(s); }
          if (changed.length) engine.updateNodes(changed);
          lastSel = curSel;
        }
        // Steer the viewport onto the camera the canvas actually PRESENTED so DOM-only content
        // rides the same frame; re-serialize the live camera the moment they agree, so
        // the surface's next write is a no-op diff rather than a fight.
        if (gesturing && !overlay) {
          const sync = holderSyncTransform(t, engine.getPresented());
          if (sync !== null) { holder.style.transform = sync; holderSynced = true; }
          else if (holderSynced) { holder.style.transform = holderTransform(t); holderSynced = false; }
        } else if (holderSynced) {
          holder.style.transform = holderTransform(t);
          holderSynced = false;
        }
        if (overlay) { engine.setActive(true); setHolderHidden(false); } // both shown, overlaid
        // Hold the gesture while the pointer stays down, or a slow pan (speed momentarily 0)
        // settles back to the DOM and flickers. A LASSO deliberately never enters: it moves no
        // transform, so the swap only shows a stale mip-scaled snapshot.
        else if (moved || (gesturing && pointerDown)) enterGesture();
      }
      raf = requestAnimationFrame(sync);
    });

    // Capture phase, so a stalled-but-ongoing gesture is seen wherever the press lands.
    let pointerDown = false;
    const onPointerDown = () => { pointerDown = true; };
    const onPointerUp = () => { pointerDown = false; };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);

    const onResize = () => engine.resize();
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(retry);
      clearTimeout(rebuildTimer);
      clearTimeout(gestureTimer);
      unsubConn();
      unsubCollapse();
      unsubGroupCollapse();
      unsubSize();
      unsubMembership();
      unsubTheme();
      unsubFmt();
      unsubShape();
      unsubSemantic();
      pipeLive = false; // area.addPipe can't be removed; the flag makes it a no-op
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      window.removeEventListener("resize", onResize);
      setHolderHidden(false); // restore the DOM
      holder.classList.remove("solenoid-html-frozen");
      hideDomOnly(); // clear the per-element visibility overrides
      demoteDomOnly();
      if (holderSynced) holder.style.transform = holderTransform(area.area.transform); // hand the transform back
      engine.dispose();
    };
  }, [active, ready]);

  if (!active) return null;
  return <div ref={hostRef} className="solenoid-html-layer" />;
}
