// [[C42]] htmlInCanvasRenderer
import { memo, useEffect, useRef, useState } from "react";
import { useStoreApi } from "@xyflow/react";
import { useRenderMode } from "../renderMode";
import { zoomSettleMs } from "../zoomSettle";
import { HtmlCanvasRenderer, type EngineNodeSpec } from "../htmlCanvasRenderer";
import { connectionVersionStore } from "../graphSignals";
import type { GraphEditor } from "../graphEditor";
import type { Schemes } from "../schemes";
import type { View } from "../view";
import { nodeDomWeight } from "../nodes/kind";
import { snapshotVectors } from "../hicVectors";
import { semanticZoomStore } from "../semanticZoomStore";
import { collapseStore } from "../collapseStore";
import { groupCollapseStore } from "../groupCollapse";
import { nodeSizeStore } from "../nodeSizeStore";
import { groupMembershipStore } from "../groupMembership";
import { appThemeStore } from "../appTheme";
import { formatAnnotationStore } from "../formatAnnotationStore";
import { lassoActiveStore } from "../lasso";
import "./htmlCanvasLayer.css";

const RENDERER_MIN_NODES = 100;
/** Held at every zoom: going back to the DOM repaints every card on screen, which on a phone cost more than the canvas saved. */
const HOLD_ZOOM = Infinity;
const WALK_SETTLE = 4;
/** A tie in z draws in the DOM's order: RF's edges, then its cards, then the viewport portal's overlays. */
const ORDER_EDGES = 0, ORDER_PORTAL = 2;

const zOf = (el: Element): number => parseInt(getComputedStyle(el).zIndex, 10) || 0;

const graphDomWeight = (ed: GraphEditor<Schemes>): number => {
  let w = 0;
  for (const n of ed.getNodes()) w += nodeDomWeight(n);
  return w;
};

export const HtmlCanvasLayer = memo(function HtmlCanvasLayer({ editor, view }: { editor: GraphEditor<Schemes>; view: View }) {
  const rf = useStoreApi();
  const mode = useRenderMode();
  const hostRef = useRef<HTMLDivElement>(null);
  const [domWeight, setDomWeight] = useState(() => graphDomWeight(editor));
  const minNodes = (window as unknown as { __hcMinNodes?: number }).__hcMinNodes ?? RENDERER_MIN_NODES;
  const active = mode === "html" && domWeight >= minNodes;

  useEffect(() => {
    if (mode !== "html") return;
    const recount = () => setDomWeight(graphDomWeight(editor));
    recount();
    const pipe = editor.addPipe((ctx) => {
      if (ctx && typeof ctx === "object" && "type" in ctx) {
        const t = (ctx as { type: string }).type;
        if (t === "nodecreated" || t === "noderemoved") recount();
      }
      return ctx;
    });
    return () => editor.removePipe(pipe);
  }, [mode, editor]);

  useEffect(() => {
    if (!active) return;
    const host = hostRef.current;
    if (!host) return;
    // Looked up each time: until RF's container exists, `view.viewport` is a detached placeholder.
    const holder = () => view.viewport;
    // Hidden and muted at each layer's root (htmlCanvasLayer.css), never on the holder: the vector snapshot reads the content's own visibility and opacity below the roots.
    const setHolderHidden = (h: boolean) => holder().classList.toggle("solenoid-html-hidden", h);
    const setHolderMuted = (m: boolean) => holder().classList.toggle("solenoid-html-muted", m);
    const holdZoom = () => (window as unknown as { __hcHoldZoom?: number }).__hcHoldZoom ?? HOLD_ZOOM;

    const engine = new HtmlCanvasRenderer(host);
    engine.setTransformSource(() => view.transform);
    let built = false;
    // Cards move and selection rings toggle only through a new RF `nodes` array; the walk runs a few frames past one, since React writes the ring class after it.
    let walkFrames = WALK_SETTLE;
    const unsubNodes = rf.subscribe((st, prev) => { if (st.nodes !== prev.nodes) walkFrames = WALK_SETTLE; });
    // Cached at build so the gesture-start position sync never forces layout with offsetLeft.
    const offsets = new Map<string, { dx: number; dy: number }>();

    const specById = new Map<string, EngineNodeSpec>();

    const collectSpecs = (): EngineNodeSpec[] => {
      offsets.clear();
      specById.clear();
      const specs: EngineNodeSpec[] = [];
      for (const node of editor.getNodes()) {
        const pos = view.position(node.id);
        const src = view.nodeElement(node.id);
        if (!pos || !src) continue;
        if (getComputedStyle(src).visibility === "hidden") continue;
        const inner = src.querySelector<HTMLElement>(".solenoid-node, .solenoid-group, .solenoid-note, .solenoid-conduit") ?? src;
        const w = inner.offsetWidth, h = inner.offsetHeight;
        if (w <= 0 || h <= 0) continue;
        const dx = inner.offsetLeft || 0, dy = inner.offsetTop || 0;
        offsets.set(node.id, { dx, dy });
        const spec: EngineNodeSpec = { id: node.id, el: inner, x: pos.x + dx, y: pos.y + dy, w, h, isGroup: inner.classList.contains("solenoid-group"), z: zOf(src) };
        specById.set(node.id, spec);
        specs.push(spec);
      }
      // Cards the viewport portal draws (the isolate endpoints) are captured like RF's; they sit in world coordinates already.
      const toWorld = screenToWorld();
      let i = 0;
      for (const el of portalOf()?.querySelectorAll<HTMLElement>(".solenoid-node") ?? []) {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const p = toWorld.transformPoint(new DOMPoint(r.left, r.top));
        const layer = el.closest(".react-flow__viewport-portal > *");
        specs.push({ id: `portal:${i++}`, el, x: p.x, y: p.y, w: el.offsetWidth, h: el.offsetHeight, isGroup: false, z: layer ? zOf(layer) : 0 });
      }
      return specs;
    };

    // ── Vector layers: every SVG the viewport draws outside the cards, copied onto the canvas ─────────────────────
    const edgesOf = () => holder().querySelector<HTMLElement>(".react-flow__edges");
    const portalOf = () => holder().querySelector<HTMLElement>(".react-flow__viewport-portal");
    /** Screen px to world: the inverse of the holder's own placement and transform, read together with the shapes' screen CTMs. */
    const screenToWorld = (): DOMMatrix => {
      const origin = (holder().parentElement ?? holder()).getBoundingClientRect();
      const tf = getComputedStyle(holder()).transform;
      const m = new DOMMatrix().translate(origin.left, origin.top).multiply(new DOMMatrix(tf === "none" ? undefined : tf));
      return m.inverse();
    };
    const isVectorRoot = (el: Element): boolean => !el.classList.contains("sol-canvas-backing");
    /** The layer an element belongs to: a direct child of RF's edges container or of the portal. */
    const rootOf = (node: Node | null): { root: Element; order: number } | null => {
      const h = holder(), edges = edgesOf(), portal = portalOf();
      for (let e: Node | null = node; e && e !== h; e = e.parentNode) {
        const parent = e.parentNode;
        if (e instanceof Element && parent === edges) return { root: e, order: ORDER_EDGES };
        if (e instanceof Element && parent === portal) return isVectorRoot(e) ? { root: e, order: ORDER_PORTAL } : null;
      }
      return null;
    };
    let vectorCount = 0;
    const snapshotRoot = (root: Element, order: number, toWorld: DOMMatrix) => {
      const shapes = root.isConnected ? snapshotVectors(root, toWorld) : [];
      engine.setVectorLayer(root, zOf(root), order, shapes);
    };
    const snapshotAllVectors = () => {
      engine.clearVectorLayers();
      const toWorld = screenToWorld();
      for (const root of edgesOf()?.children ?? []) snapshotRoot(root, ORDER_EDGES, toWorld);
      for (const root of portalOf()?.children ?? []) if (isVectorRoot(root)) snapshotRoot(root, ORDER_PORTAL, toWorld);
      vectorCount = (edgesOf()?.children.length ?? 0) + (portalOf()?.children.length ?? 0);
    };
    // Any change to a layer's DOM (a cable rerouted by a move, a selection, a new standoff) re-snapshots that layer on the next frame.
    const dirtyRoots = new Map<Element, number>();
    let portalCardsChanged = false;
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.removedNodes) if (n instanceof Element && (n.parentNode === null)) { engine.setVectorLayer(n, 0, 0, []); dirtyRoots.delete(n); }
        const hit = rootOf(r.target);
        if (hit) {
          dirtyRoots.set(hit.root, hit.order);
          if (hit.order === ORDER_PORTAL && hit.root.querySelector(".solenoid-node")) portalCardsChanged = true;
        }
        for (const n of r.addedNodes) { const h = rootOf(n); if (h) dirtyRoots.set(h.root, h.order); }
      }
    });
    const observe = () => {
      observer.disconnect();
      for (const el of [edgesOf(), portalOf()]) if (el) observer.observe(el, { subtree: true, childList: true, attributes: true });
    };
    const flushVectors = () => {
      if (!dirtyRoots.size) return;
      const toWorld = screenToWorld();
      for (const [root, order] of dirtyRoots) snapshotRoot(root, order, toWorld);
      dirtyRoots.clear();
      if (portalCardsChanged) { portalCardsChanged = false; scheduleRebuild(); }
    };


    // A collapsed group's members read as hidden by computed visibility, so the build un-hides the holder and re-hides it before yielding (no paint in between).
    const doBuild = (): boolean => {
      if (!holder().isConnected) return false;
      const hidden = holder().classList.contains("solenoid-html-hidden");
      if (hidden) setHolderHidden(false);
      const specs = collectSpecs();
      if (hidden) setHolderHidden(true);
      snapshotAllVectors();
      observe();
      if (!specs.length) return false;
      engine.setNodes(specs);
      return true;
    };

    let gesturing = false;
    let gestureTimer = 0;
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
        if (held) exitHeld();
        readSelection();
        setHolderHidden(true);
        engine.setActive(true);
      }
      clearTimeout(gestureTimer);
      gestureTimer = window.setTimeout(exitGesture, gestureZoomed ? zoomSettleMs() : PAN_SETTLE_MS);
    };
    let held = false;
    let liveEls: HTMLElement[] = [];
    const clearLive = () => {
      for (const el of liveEls) el.classList.remove("solenoid-hic-live");
      liveEls = [];
      engine.setDomLive(new Set());
    };
    const syncLive = () => {
      const next: HTMLElement[] = [];
      const ids = new Set<string>();
      const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(".react-flow__node") ?? null;
      for (const node of editor.getNodes()) {
        const el = view.nodeElement(node.id);
        if (!el) continue;
        if (el.classList.contains("selected") || el === focused) { next.push(el); ids.add(node.id); }
      }
      let same = next.length === liveEls.length;
      if (same) for (let i = 0; i < next.length; i++) if (next[i] !== liveEls[i]) { same = false; break; }
      if (same) return;
      for (const el of liveEls) el.classList.remove("solenoid-hic-live");
      for (const el of next) el.classList.add("solenoid-hic-live");
      liveEls = next;
      engine.setDomLive(ids);
    };
    const enterHeld = () => {
      held = true;
      setHolderHidden(false);
      setHolderMuted(true);
      syncLive();
    };
    const exitHeld = () => {
      held = false;
      setHolderMuted(false);
      clearLive();
    };
    const exitGesture = () => {
      gesturing = false;
      gestureZoomed = false;
      if (view.transform.k < holdZoom()) {
        enterHeld();
        return;
      }
      setHolderHidden(false);
      engine.setActive(false);
    };

    setHolderHidden(true);
    engine.setActive(true);
    gesturing = true;
    const tryBuild = () => {
      if (built) return;
      if (doBuild()) { built = true; walkFrames = WALK_SETTLE; enterGesture(); }
    };
    tryBuild();
    const retry = window.setInterval(() => { tryBuild(); if (built) clearInterval(retry); }, 120);

    const refreshSpec = (id: string): EngineNodeSpec | null => {
      if (!specById.has(id)) return null;
      const pos = view.position(id);
      const src = view.nodeElement(id);
      if (!pos || !src) return null;
      const inner = src.querySelector<HTMLElement>(".solenoid-node, .solenoid-group, .solenoid-note, .solenoid-conduit") ?? src;
      const w = inner.offsetWidth, h = inner.offsetHeight;
      if (w <= 0 || h <= 0) return null;
      const dx = inner.offsetLeft || 0, dy = inner.offsetTop || 0;
      offsets.set(id, { dx, dy });
      const spec: EngineNodeSpec = { id, el: inner, x: pos.x + dx, y: pos.y + dy, w, h, isGroup: inner.classList.contains("solenoid-group"), z: zOf(src) };
      specById.set(id, spec);
      return spec;
    };

    let rebuildTimer = 0;
    let dirtyIds: Set<string> | null = new Set();
    let heldForLasso = false;
    const scheduleRebuild = (id?: string) => {
      if (!built) return;
      if (id === undefined) dirtyIds = null;
      else if (dirtyIds) dirtyIds.add(id);
      if (lassoActiveStore.get()) { heldForLasso = true; return; }
      arm();
    };
    const arm = () => {
      clearTimeout(rebuildTimer);
      rebuildTimer = window.setTimeout(() => {
        walkFrames = WALK_SETTLE;
        const ids = dirtyIds;
        dirtyIds = new Set();
        if (ids) {
          const specs: EngineNodeSpec[] = [];
          let fallback = false;
          for (const i of ids) {
            const s = refreshSpec(i);
            if (s) specs.push(s);
            else { fallback = true; break; }
          }
          if (!fallback) {
            if (specs.length) engine.updateNodes(specs);
            return;
          }
        }
        doBuild();
      }, 150);
    };
    const triggers: Record<string, number> = {};
    (window as unknown as { __hcTriggers?: Record<string, number> }).__hcTriggers = triggers;
    (window as unknown as { __hcStats?: () => unknown }).__hcStats =
      () => ({ ...engine.getStats(), vectorLayers: vectorCount });
    (window as unknown as { __hcProbe?: () => void }).__hcProbe = () => engine.probe();
    const count = (cause: string) => { triggers[cause] = (triggers[cause] ?? 0) + 1; };
    const fullRebuild = (cause: string) => () => { count(cause); scheduleRebuild(); };
    // Not cableValueStore: its bump carries no ids, so it would force a full rebuild every pass; values arrive per id through the render pipe.
    // A rebuild held for a lasso runs on release, with every id collected meanwhile.
    const unsubLasso = lassoActiveStore.subscribe(() => {
      if (lassoActiveStore.get() || !heldForLasso) return;
      heldForLasso = false;
      arm();
    });
    const unsubConn = connectionVersionStore.subscribe(fullRebuild("connection"));
    const unsubCollapse = collapseStore.subscribe(fullRebuild("collapse"));
    // Group collapse re-renders only the group id, so without this its members keep their cached bitmaps.
    const unsubGroupCollapse = groupCollapseStore.subscribe(fullRebuild("groupCollapse"));
    const unsubSize = nodeSizeStore.subscribe(fullRebuild("nodeSize"));
    const unsubMembership = groupMembershipStore.subscribe(fullRebuild("membership"));
    const unsubTheme = appThemeStore.subscribe(fullRebuild("theme"));
    const unsubFmt = formatAnnotationStore.subscribe(fullRebuild("formatAnnotation"));
    // Semantic zoom flips a root CSS class the captured bitmaps don't know about.
    const unsubSemantic = semanticZoomStore.subscribe(fullRebuild("semanticZoom"));
    const unsubRender = view.onRender((id) => { count("render-pipe"); scheduleRebuild(id); });

    let lastK = NaN, lastX = NaN, lastY = NaN;
    let lastSel = new Set<string>();
    let lastQuality = NaN;
    let raf = requestAnimationFrame(function sync() {
      const t = view.transform;
      engine.setTransform(t.k, t.x, t.y);
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
        if (Number.isFinite(lastK) && t.k !== lastK) gestureZoomed = true;
        lastK = t.k; lastX = t.x; lastY = t.y;
        if (walkFrames > 0) {
          walkFrames--;
          const movedIds = new Set<string>();
          // The live DOM class, not node.selected: the model runs ahead of React's class write and would clone before the ring lands.
          const curSel = new Set<string>();
          for (const node of editor.getNodes()) {
            const off = offsets.get(node.id);
            const pos = view.position(node.id);
            if (off && pos && engine.setNodePosition(node.id, pos.x + off.dx, pos.y + off.dy)) movedIds.add(node.id);
            const spec = specById.get(node.id);
            if (spec && spec.el.className.includes("--selected")) curSel.add(node.id);
          }
          if (movedIds.size) { moved = true; walkFrames = WALK_SETTLE; }
          let selChanged = curSel.size !== lastSel.size;
          if (!selChanged) for (const id of curSel) if (!lastSel.has(id)) { selChanged = true; break; }
          if (selChanged) {
            const changed: EngineNodeSpec[] = [];
            for (const id of curSel) if (!lastSel.has(id)) { const s = specById.get(id); if (s) changed.push(s); }
            for (const id of lastSel) if (!curSel.has(id)) { const s = specById.get(id); if (s) changed.push(s); }
            if (changed.length) engine.updateNodes(changed);
            lastSel = curSel;
          }
        }
        flushVectors();
        if (held && !moved) syncLive();
        if (overlay) { engine.setActive(true); setHolderHidden(false); }
        // Hold while the pointer is down, or a slow pan (speed momentarily 0) settles to the DOM and flickers.
        else if (moved || (gesturing && pointerDown)) enterGesture();
      }
      raf = requestAnimationFrame(sync);
    });

    // Capture phase, so a stalled gesture is seen wherever the press lands.
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
      unsubNodes();
      clearInterval(retry);
      clearTimeout(rebuildTimer);
      clearTimeout(gestureTimer);
      unsubLasso();
      unsubConn();
      unsubCollapse();
      unsubGroupCollapse();
      unsubSize();
      unsubMembership();
      unsubTheme();
      unsubFmt();
      unsubSemantic();
      unsubRender();
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      window.removeEventListener("resize", onResize);
      setHolderHidden(false);
      setHolderMuted(false);
      clearLive();
      observer.disconnect();
      engine.dispose();
    };
  }, [active, editor, view, rf]);

  if (!active) return null;
  return <div ref={hostRef} className="solenoid-html-layer" />;
});
