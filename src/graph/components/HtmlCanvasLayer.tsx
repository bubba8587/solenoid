// [[C42]] htmlInCanvasRenderer
import { useEffect, useRef, useState } from "react";
import { useRenderMode } from "../renderMode";
import { zoomSettleMs } from "../zoomSettle";
import { IS_COARSE } from "../coarse";
import { HtmlCanvasRenderer, type EngineNodeSpec } from "../htmlCanvasRenderer";
import { connectionVersionStore } from "../graphSignals";
import type { NodeEditor } from "rete";
import type { Schemes } from "../schemes";
import type { View } from "../view";
import { nodeDomWeight } from "../nodes/kind";
import { snapshotCables } from "../hicGraphSnapshot";
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

const RENDERER_MIN_NODES = 100;
const HOLD_ZOOM = 0.4;

const graphDomWeight = (ed: NodeEditor<Schemes>): number => {
  let w = 0;
  for (const n of ed.getNodes()) w += nodeDomWeight(n);
  return w;
};

export function HtmlCanvasLayer({ editor, view }: { editor: NodeEditor<Schemes>; view: View }) {
  const mode = useRenderMode();
  const hostRef = useRef<HTMLDivElement>(null);
  const [domWeight, setDomWeight] = useState(() => graphDomWeight(editor));
  const minNodes = (window as unknown as { __hcMinNodes?: number }).__hcMinNodes ?? RENDERER_MIN_NODES;
  const active = mode === "html" && domWeight >= minNodes;

  useEffect(() => {
    if (mode !== "html") return;
    let live = true;
    const recount = () => setDomWeight(graphDomWeight(editor));
    recount();
    // editor.addPipe can't be removed, so `live` neutralizes it on cleanup.
    editor.addPipe((ctx) => {
      if (live && ctx && typeof ctx === "object" && "type" in ctx) {
        const t = (ctx as { type: string }).type;
        if (t === "nodecreated" || t === "noderemoved") recount();
      }
      return ctx;
    });
    return () => { live = false; };
  }, [mode, editor]);

  useEffect(() => {
    if (!active) return;
    const host = hostRef.current;
    if (!host) return;
    const holder = view.viewport;
    // RF stamps inline `visibility: visible` on every node wrapper, so the class carries a rule that beats it (htmlCanvasLayer.css).
    const setHolderHidden = (h: boolean) => {
      holder.style.visibility = h ? "hidden" : "";
      holder.classList.toggle("solenoid-html-hidden", h);
    };
    const holderHidden = () => holder.classList.contains("solenoid-html-hidden");
    const setHolderMuted = (m: boolean) => holder.classList.toggle("solenoid-html-muted", m);
    const holdZoom = () => (window as unknown as { __hcHoldZoom?: number }).__hcHoldZoom ?? HOLD_ZOOM;

    const engine = new HtmlCanvasRenderer(host);
    engine.setTransformSource(() => view.transform);
    let built = false;
    // Cached at build so the gesture-start position sync never forces layout with offsetLeft.
    const offsets = new Map<string, { dx: number; dy: number }>();

    const isDomOnly = (inner: HTMLElement) => inner.classList.contains("solenoid-conduit");
    const domOnlyIds = new Set<string>();
    let domOnlyEls: HTMLElement[] = [];
    // Group collapse stamps inline visibility on the same elements: never override one something else hid, and clear only a "visible" we stamped.
    const showDomOnly = () => { for (const el of domOnlyEls) if (el.style.visibility !== "hidden") { el.style.visibility = "visible"; el.classList.add("solenoid-hic-domonly"); } };
    const hideDomOnly = (els: HTMLElement[] = domOnlyEls) => { for (const el of els) { if (el.style.visibility === "visible") el.style.visibility = ""; el.classList.remove("solenoid-hic-domonly"); } };
    const PROMOTE_MAX = 1024;
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
    const specById = new Map<string, EngineNodeSpec>();

    const collectSpecs = (): EngineNodeSpec[] => {
      offsets.clear();
      domOnlyIds.clear();
      specById.clear();
      const specs: EngineNodeSpec[] = [];
      for (const node of editor.getNodes()) {
        const pos = view.position(node.id);
        const src = view.nodeElement(node.id);
        if (!pos || !src) continue;
        if (getComputedStyle(src).visibility === "hidden") continue;
        const inner = src.querySelector<HTMLElement>(".solenoid-node, .solenoid-group, .solenoid-note, .solenoid-conduit") ?? src;
        if (isDomOnly(inner)) { domOnlyIds.add(node.id); continue; }
        const w = inner.offsetWidth, h = inner.offsetHeight;
        if (w <= 0 || h <= 0) continue;
        const dx = inner.offsetLeft || 0, dy = inner.offsetTop || 0;
        offsets.set(node.id, { dx, dy });
        const spec: EngineNodeSpec = { id: node.id, el: inner, x: pos.x + dx, y: pos.y + dy, w, h, isGroup: inner.classList.contains("solenoid-group") };
        specById.set(node.id, spec);
        specs.push(spec);
      }
      return specs;
    };

    const collectDomOnlyEls = (canvasCableIds: Set<string>): HTMLElement[] => {
      const els: HTMLElement[] = [];
      for (const id of domOnlyIds) { const el = view.nodeElement(id); if (el) els.push(el); }
      for (const conn of editor.getConnections()) {
        if (canvasCableIds.has(conn.id)) continue;
        const el = view.connectionElement(conn.id);
        if (el) els.push(el);
      }
      const standoffSvg = holder.querySelector<HTMLElement>(".solenoid-standoff-svg");
      if (standoffSvg) els.push(standoffSvg);
      return els;
    };

    // The snapshot reads a hidden holder as absent, so un-hide synchronously and re-hide before yielding (no paint in between).
    const doBuild = (): boolean => {
      const hidden = holderHidden();
      if (hidden) setHolderHidden(false);
      const specs = collectSpecs();
      const snap = snapshotCables(editor, view);
      const canvasCables = snap ? snap.filter((c) => !domOnlyIds.has(c.source) && !domOnlyIds.has(c.target)) : [];
      const canvasCableIds = new Set(canvasCables.map((c) => c.id));
      // Clear the old set's overrides first, or an element dropped from it keeps its inline "visible" forever.
      const prevEls = domOnlyEls;
      domOnlyEls = collectDomOnlyEls(canvasCableIds);
      if (hidden) setHolderHidden(true);
      hideDomOnly(prevEls);
      if (gesturing || held) showDomOnly();
      if (gesturing) promoteDomOnly();
      if (!specs.length) return false;
      engine.setNodes(specs);
      if (snap) engine.setCables(canvasCables, cableShapeStore.get());
      return true;
    };

    let gesturing = false;
    let gestureTimer = 0;
    let holderSynced = false;
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
        holder.classList.add("solenoid-html-frozen");
        if (!IS_COARSE) holder.style.willChange = "transform";
        showDomOnly();
        promoteDomOnly();
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
        if (domOnlyIds.has(node.id)) continue;
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
      holder.style.willChange = "";
      demoteDomOnly();
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
      if (holderSynced) { holder.style.transform = holderTransform(view.transform); holderSynced = false; }
      if (view.transform.k < holdZoom()) {
        enterHeld();
        return;
      }
      setHolderHidden(false);
      holder.classList.remove("solenoid-html-frozen");
      holder.style.willChange = "";
      hideDomOnly();
      demoteDomOnly();
      engine.setActive(false);
    };

    setHolderHidden(true);
    engine.setActive(true);
    gesturing = true;
    const tryBuild = () => {
      if (built) return;
      if (doBuild()) { built = true; enterGesture(); }
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
      const spec: EngineNodeSpec = { id, el: inner, x: pos.x + dx, y: pos.y + dy, w, h, isGroup: inner.classList.contains("solenoid-group") };
      specById.set(id, spec);
      return spec;
    };

    let rebuildTimer = 0;
    let dirtyIds: Set<string> | null = new Set();
    const scheduleRebuild = (id?: string) => {
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
            if (domOnlyIds.has(i)) continue;
            const s = refreshSpec(i);
            if (s) specs.push(s);
            else { fallback = true; break; }
          }
          if (!fallback) {
            if (specs.length) {
              engine.updateNodes(specs);
              engine.relayoutCables(new Set(specs.map((s) => s.id)));
            }
            return;
          }
        }
        doBuild();
      }, 150);
    };
    const triggers: Record<string, number> = {};
    (window as unknown as { __hcTriggers?: Record<string, number> }).__hcTriggers = triggers;
    (window as unknown as { __hcStats?: () => unknown }).__hcStats =
      () => ({ ...engine.getStats(), domOnly: domOnlyEls.length });
    (window as unknown as { __hcProbe?: () => void }).__hcProbe = () => engine.probe();
    const count = (cause: string) => { triggers[cause] = (triggers[cause] ?? 0) + 1; };
    const fullRebuild = (cause: string) => () => { count(cause); scheduleRebuild(); };
    // Not cableValueStore: its bump carries no ids, so it would force a full rebuild every pass; values arrive per id through the render pipe.
    const unsubConn = connectionVersionStore.subscribe(fullRebuild("connection"));
    const unsubCollapse = collapseStore.subscribe(fullRebuild("collapse"));
    // Group collapse re-renders only the group id, so without this its members keep their cached bitmaps.
    const unsubGroupCollapse = groupCollapseStore.subscribe(fullRebuild("groupCollapse"));
    const unsubSize = nodeSizeStore.subscribe(fullRebuild("nodeSize"));
    const unsubMembership = groupMembershipStore.subscribe(fullRebuild("membership"));
    const unsubTheme = appThemeStore.subscribe(fullRebuild("theme"));
    const unsubFmt = formatAnnotationStore.subscribe(fullRebuild("formatAnnotation"));
    const unsubShape = cableShapeStore.subscribe(fullRebuild("cableShape"));
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
        if (movedIds.size) { engine.relayoutCables(movedIds); moved = true; }
        let selChanged = curSel.size !== lastSel.size;
        if (!selChanged) for (const id of curSel) if (!lastSel.has(id)) { selChanged = true; break; }
        if (selChanged) {
          const changed: EngineNodeSpec[] = [];
          for (const id of curSel) if (!lastSel.has(id)) { const s = specById.get(id); if (s) changed.push(s); }
          for (const id of lastSel) if (!curSel.has(id)) { const s = specById.get(id); if (s) changed.push(s); }
          if (changed.length) engine.updateNodes(changed);
          lastSel = curSel;
        }
        if (gesturing && !overlay) {
          const sync = holderSyncTransform(t, engine.getPresented());
          if (sync !== null) { holder.style.transform = sync; holderSynced = true; }
          else if (holderSynced) { holder.style.transform = holderTransform(t); holderSynced = false; }
        } else if (holderSynced) {
          holder.style.transform = holderTransform(t);
          holderSynced = false;
        }
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
      unsubRender();
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      window.removeEventListener("resize", onResize);
      setHolderHidden(false);
      setHolderMuted(false);
      clearLive();
      holder.classList.remove("solenoid-html-frozen");
      hideDomOnly();
      demoteDomOnly();
      if (holderSynced) holder.style.transform = holderTransform(view.transform);
      engine.dispose();
    };
  }, [active, editor, view]);

  if (!active) return null;
  return <div ref={hostRef} className="solenoid-html-layer" />;
}
