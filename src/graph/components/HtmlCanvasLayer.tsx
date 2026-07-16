import { useEffect, useRef, useState } from "react";
import { useRenderMode } from "../renderMode";
import { HtmlCanvasRenderer, type EngineNodeSpec } from "../htmlCanvasRenderer";
import { getEditor, getArea, connectionVersionStore } from "../process";
import { nodeDomWeight } from "../nodes/kind";
import { snapshotGraph } from "../pixi/pixiGraphSnapshot";
import { cableShapeStore } from "../cableShape";
import { semanticZoomStore } from "../semanticZoomStore";
import { collapseStore } from "../collapseStore";
import { groupCollapseStore } from "../groupCollapse";
import { nodeSizeStore } from "../nodeSizeStore";
import { groupMembershipStore } from "../groupMembership";
import { appThemeStore } from "../appTheme";
import { formatAnnotationStore } from "../formatAnnotationStore";
import { lassoActiveStore } from "../lasso";
import "./htmlCanvasLayer.css";

// The canvas only earns its keep on a BIG graph — below this much DOM the native DOM
// pans/zooms fine, and the capture/swap cost (and any momentary stale-clone flash) isn't
// worth it. So even with render mode "html" ON, stay fully inert until the graph crosses
// this. The gate is a KIND-WEIGHTED node count (nodeDomWeight), not a raw one: a chart /
// mermaid / inlined-SVG / frame-grid card is far more DOM than a scalar, so it counts for
// more (~10 charts ≈ this threshold). A plain scalar graph still needs ~100 nodes to trip,
// so the number's feel is unchanged for the common case. Tunable live via
// `window.__hcMinNodes` (now a weighted-unit threshold) for testing. (2026-06-30; weighted 2026-07-15)
const RENDERER_MIN_NODES = 100;

// Sum every node's DOM weight — the value the engage gate compares against the threshold.
const graphDomWeight = (): number => {
  const ed = getEditor();
  if (!ed) return 0;
  let w = 0;
  for (const n of ed.getNodes()) w += nodeDomWeight(n);
  return w;
};

/**
 * HTML-in-Canvas renderer, mounted when render mode is "html".
 *
 * Architecture — the canvas is the fast PAN/ZOOM layer, not a replacement for the DOM:
 *  • IDLE: the canvas draws nothing (transparent) and the real rete DOM shows through, so
 *    EVERY interaction is native — node + group drag, collapse, context menus, field
 *    editing, lasso, resize handles, sockets. Nothing is reimplemented.
 *  • PAN/ZOOM (a gesture — the area transform changes): the DOM holder is hidden with
 *    `visibility:hidden` (one element, so no per-node ResizeObserver storm; the compositor
 *    skips painting it → cheap transform) and the canvas draws the captured graph, mirroring
 *    the transform. On settle (~140ms) the DOM comes back and the canvas clears.
 *
 * The canvas is kept current with the live model so the swap is seamless: a debounced
 * re-capture on value/topology change, and a position/cable/selection sync at each gesture
 * start (catching DOM drags/edits since the last gesture). `visibility:hidden` keeps layout,
 * so the DOM stays measurable for those reads; the snapshot's own visibility check means we
 * must un-hide synchronously around it (no paint mid-tick → no flash).
 */
export function HtmlCanvasLayer() {
  const mode = useRenderMode();
  const hostRef = useRef<HTMLDivElement>(null);
  // Live kind-weighted DOM total, recounted below so `active` re-evaluates as the graph grows/
  // shrinks across the threshold. Seeded synchronously so toggling render mode on over an
  // ALREADY-loaded big graph engages on the next render (not only after a recount or an add/remove).
  const [domWeight, setDomWeight] = useState(graphDomWeight);
  const minNodes = (window as unknown as { __hcMinNodes?: number }).__hcMinNodes ?? RENDERER_MIN_NODES;
  const active = mode === "html" && domWeight >= minNodes;

  // Readiness gate. This layer is a CHILD of Canvas, so on a fresh page load its effects
  // run BEFORE Canvas's async rete init populates the process.ts singletons — getEditor()/
  // getArea() are still null. The setup effect bails when they're missing, and with deps
  // [active] it never re-runs, so the canvas stays inert even though render mode persisted
  // as "html" (the Setting reads ON but nothing draws until you toggle it off→on, which
  // re-runs the effect after init). Poll until both exist, flip `ready`, and the setup
  // effect (which depends on it) runs once the editor is live. (2026-06-30)
  const [ready, setReady] = useState(() => !!getEditor() && !!getArea());
  useEffect(() => {
    if (!active || ready) return;
    if (getEditor() && getArea()) { setReady(true); return; }
    const t = window.setInterval(() => {
      if (getEditor() && getArea()) { setReady(true); clearInterval(t); }
    }, 120);
    return () => clearInterval(t);
  }, [active, ready]);

  // Maintain the weighted DOM total off node add/remove EVENTS — it only changes then (and on
  // load), so a timer would burn cycles re-reading a value that rarely moves. recount sums
  // nodeDomWeight over every node on BIND and on each nodecreated/noderemoved, so an already-
  // loaded graph gates the instant we bind and a streaming load (addNode per node) keeps it
  // current. (A node's WEIGHT can also change without an add/remove — e.g. a Cast retypes a
  // socket from scalar to frame — but that's rare and self-corrects on the next add/remove or
  // reload; not worth a per-render resum.) The editor/area are created once and reused across
  // document switches (load clears+refills the SAME editor), so the pipe stays valid. Runs
  // whenever mode is "html" (NOT gated on `active`): below the threshold `active` is false yet
  // we still need to notice it being crossed.
  useEffect(() => {
    if (mode !== "html") return;
    let live = true;
    let bound = false;
    const recount = () => setDomWeight(graphDomWeight());
    const bind = (): boolean => {
      if (bound) return true;
      const area = getArea();
      if (!area || !getEditor()) return false;
      bound = true;
      recount();
      // area.addPipe can't be removed — `live` neutralises it on cleanup; `bound` keeps it to one.
      area.addPipe((ctx) => {
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
    const holder = area.area.content.holder as HTMLElement;

    const engine = new HtmlCanvasRenderer(host);
    let built = false;
    // id → the inner element's offset within its node-view wrapper. Cached at build so the
    // gesture-start position sync reads only `view.position` (no layout-forcing offsetLeft).
    const offsets = new Map<string, { dx: number; dy: number }>();

    // "DOM-only" nodes are NOT drawn on the canvas — they (and their cables) stay rendered by
    // the real DOM, kept visible through the canvas during a gesture (see showDomOnly). This is
    // the escape hatch for elements the snapshot can't faithfully reproduce: a Conduit floats +
    // rotates its body and bundles its cables into ribbons, none of which the flat node/cable
    // capture handles — so conduits render as DOM. Extend the predicate to opt more in.
    const isDomOnly = (inner: HTMLElement) => inner.classList.contains("solenoid-conduit");
    const domOnlyIds = new Set<string>();
    let domOnlyEls: HTMLElement[] = [];
    const showDomOnly = () => { for (const el of domOnlyEls) el.style.visibility = "visible"; };
    const hideDomOnly = () => { for (const el of domOnlyEls) el.style.visibility = ""; };
    // id → its last-built spec, so a selection change can re-capture JUST the toggled nodes
    // (engine.updateNodes) instead of rebuilding the whole graph — cheap enough to stay live
    // even mid-lasso. el is the live inner element, so re-cloning it picks up its current class.
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

    // Collect the DOM elements kept visible during a gesture: each DOM-only node-view, EVERY
    // cable the canvas isn't drawing, and the standoff layer. `canvasCableIds` is the set the
    // engine renders; any other connection (a conduit cable filtered out as DOM-only, or one the
    // snapshot couldn't resolve — e.g. a cable into a COLLAPSED GROUP, whose hidden member socket
    // isn't in the lookup, so it'd otherwise just vanish) keeps its real DOM element. The standoff
    // bars are a single SVG the canvas doesn't reproduce, kept as DOM too.
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

    // Re-clone + re-capture the whole graph from the DOM. The holder may be visibility:hidden
    // (a gesture in flight) — un-hide synchronously to read it, re-hide before yielding (no
    // paint mid-tick, so no flash). visibility:hidden would also make the snapshot skip every
    // node (it treats hidden as absent), which is the other reason to un-hide here.
    const doBuild = (): boolean => {
      const hidden = holder.style.visibility === "hidden";
      if (hidden) holder.style.visibility = "";
      const specs = collectSpecs();
      const snap = snapshotGraph();
      // Cables the canvas will draw: resolvable by the snapshot AND not touching a DOM-only
      // node. Everything else (conduit cables, plus cables the snapshot couldn't resolve — e.g.
      // into a collapsed group) stays DOM. Compute the id set so collectDomOnlyEls keeps those.
      const canvasCables = snap ? snap.cables.filter((c) => !domOnlyIds.has(c.source) && !domOnlyIds.has(c.target)) : [];
      const canvasCableIds = new Set(canvasCables.map((c) => c.id));
      domOnlyEls = collectDomOnlyEls(canvasCableIds);
      if (hidden) holder.style.visibility = "hidden";
      if (gesturing) showDomOnly(); // a rebuild mid-gesture must re-show the (possibly new) set
      if (!specs.length) return false;
      engine.setNodes(specs);
      if (snap) engine.setCables(canvasCables, cableShapeStore.get());
      return true;
    };

    // ── Gesture swap ──────────────────────────────────────────────────────────────
    let gesturing = false;
    let gestureTimer = 0;
    const readSelection = () => {
      const sel = new Set<string>();
      for (const node of editor.getNodes()) if ((node as { selected?: boolean }).selected) sel.add(node.id);
      engine.setSelected(sel);
    };
    const enterGesture = () => {
      if (!gesturing) {
        gesturing = true;
        readSelection();
        holder.style.visibility = "hidden"; // keeps layout + the in-flight drag alive (unlike display:none)
        holder.classList.add("solenoid-html-frozen"); // freeze DOM-only cable flow to match the static canvas
        // Promote the holder to its own compositor layer for the gesture: the DOM-only
        // subset (conduits + their cables) is the only painted content, and WITHOUT a
        // cached layer some transform updates repaint it per frame — the conduit then
        // visibly trails the canvas-drawn graph during a pan. Composited, the per-frame
        // transform is GPU-only. Gesture-scoped so the idle DOM pays no layer memory.
        holder.style.willChange = "transform";
        showDomOnly(); // but keep DOM-only nodes (conduits) + their cables visible through the canvas
        engine.setActive(true);
      }
      clearTimeout(gestureTimer);
      gestureTimer = window.setTimeout(exitGesture, 140);
    };
    const exitGesture = () => {
      gesturing = false;
      holder.style.visibility = "";
      holder.classList.remove("solenoid-html-frozen"); // resume cable flow
      holder.style.willChange = "";
      hideDomOnly(); // drop the per-element override; the holder is fully visible again
      engine.setActive(false);
    };

    // Initial build — start in the gesture state (DOM hidden, canvas drawing) so there's no
    // DOM+canvas double-image while capturing; drop to idle (DOM shown) once built.
    holder.style.visibility = "hidden";
    engine.setActive(true);
    gesturing = true;
    const tryBuild = () => {
      if (built) return;
      if (doBuild()) { built = true; enterGesture(); } // schedules the drop to idle
    };
    tryBuild();
    const retry = window.setInterval(() => { tryBuild(); if (built) clearInterval(retry); }, 120);

    // Keep the canvas content fresh (so a gesture never shows a stale capture): debounced
    // re-capture. The capture is a CLONE taken at build time, so anything that changes a node's
    // DOM after build — not just values/topology — leaves the snapshot stale until a rebuild.
    //
    // PRINCIPLE — a node card / group / note re-renders in rete's SEPARATE React root, so the
    // canvas can't observe it. Every such re-render reaches us by one of two channels, and BOTH
    // must end at scheduleRebuild:
    //   1. area.update("node", id)  → the area "render"/node pipe below. Use this from a node's
    //      OWN local-state change (color pick, inline edit) that has no module store — see
    //      NoteNode.pick / GroupNode.pickColor. Value-box re-renders, dropdown changes, group
    //      resize and SELECTION-class flips already flow through here.
    //   2. a module store the card subscribes to via useSyncExternalStore → subscribe it here.
    //      The full set the captured roots (NodeCard / GroupNode / NoteNode / nodeKit value box /
    //      DisplayNode) react to:
    //        • connectionVersionStore — topology (rewire). (Values arrive per-id
    //          through the render pipe — see the scheduleRebuild note below.)
    //        • collapseStore — chevron collapse/expand re-renders the body.
    //        • nodeSizeStore — single-node manual resize.
    //        • groupMembershipStore — group recolor + member "inside a group" dots (and the dot
    //          refreshing when a node moves in/out of a group). The group BOX is also covered by
    //          its picker's area.update; this catches the MEMBERS that go stale otherwise.
    //        • appThemeStore — light/dark + accent + the active PALETTE (palette edits funnel
    //          through appThemeStore, see appTheme.ts), which retints every card/group/note.
    //        • formatAnnotationStore — unit + number-format annotations change the DISPLAYED
    //          value text on value boxes / Displays / Notes without any value recompute.
    //        • cableShapeStore — not a node change; re-routes the captured cables on shape swap.
    //      Deliberately NOT subscribed: socketHighlightStore (per-hover churn; a transient ring
    //      not worth a full re-capture) and the FC-only formatMismatchStore / packsStore (rare,
    //      sub-glyph). If a NEW store starts driving a card's painted appearance, add it here.
    // Re-derive ONE node's spec from the live DOM (geometry may have changed since
    // the last build). Returns null when the node is unknown/new — the caller
    // falls back to a full build.
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
    // Accumulated ids whose card re-rendered since the last (re)build; null =
    // something of unknown scope changed → full rebuild. A full setNodes releases
    // every ImageBitmap, re-clones every DOM card and rebuilds every mip pyramid —
    // editing one value on a 300-node graph paid all of that per commit (audit
    // finding 43). The area render pipe carries the changed node's id, so value
    // edits take the targeted engine.updateNodes path; topology/theme/collapse
    // (below) stay full rebuilds.
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
    // Rebuild-trigger telemetry: `window.__hcTriggers` counts every full-rebuild cause and
    // targeted update since the layer mounted. A full rebuild re-clones + re-captures EVERY
    // card, so a store that fires rapidly (per recompute pass, per frame) is a renderer hang —
    // this makes the culprit readable from the console instead of guessed.
    const triggers: Record<string, number> = {};
    (window as unknown as { __hcTriggers?: Record<string, number> }).__hcTriggers = triggers;
    // Live renderer stats (console): fps, drawMs, visible/total, built (mip pyramids),
    // `slow` = visible nodes re-rasterized per frame (the pan-jank suspect), `failed` =
    // permanently unbuildable pyramids, domOnly = elements kept as live DOM through a
    // gesture (conduits + their cables + unresolvable cables + the standoff svg).
    (window as unknown as { __hcStats?: () => unknown }).__hcStats =
      () => ({ ...engine.getStats(), domOnly: domOnlyEls.length });
    // One-shot verbose pipeline probe (real error text per stage) — see probe().
    (window as unknown as { __hcProbe?: () => void }).__hcProbe = () => engine.probe();
    const count = (cause: string) => { triggers[cause] = (triggers[cause] ?? 0) + 1; };
    const fullRebuild = (cause: string) => () => { count(cause); scheduleRebuild(); };
    // NOT subscribed: cableValueStore — every value change that repaints a card
    // already arrives through the render pipe WITH its node id (processGraph
    // calls area.update per affected node); the store bump carried no ids and
    // forced the full-rebuild path every pass (finding 43).
    const unsubConn = connectionVersionStore.subscribe(fullRebuild("connection"));
    const unsubCollapse = collapseStore.subscribe(fullRebuild("collapse"));
    // GROUP collapse/expand hides/shows members via inline visibility on their
    // node views — a state only collectSpecs' visibility check sees, and the
    // collapse fires area.update for the GROUP id alone, so the targeted path
    // never drops the members. Without this, collapsed-group members kept their
    // cached bitmaps and were drawn on every pan (regression once targeted
    // re-capture landed — the old full-rebuild-on-anything behavior had masked it).
    const unsubGroupCollapse = groupCollapseStore.subscribe(fullRebuild("groupCollapse"));
    const unsubSize = nodeSizeStore.subscribe(fullRebuild("nodeSize"));
    const unsubMembership = groupMembershipStore.subscribe(fullRebuild("membership")); // recolor member dots on group color/membership change
    const unsubTheme = appThemeStore.subscribe(fullRebuild("theme")); // retint on theme / accent / palette change
    const unsubFmt = formatAnnotationStore.subscribe(fullRebuild("formatAnnotation")); // re-capture reformatted value text
    const unsubShape = cableShapeStore.subscribe(fullRebuild("cableShape")); // re-route on cable-shape change
    // Semantic zoom flips a root CSS class the captured bitmaps don't know
    // about — without a re-capture, zooming out past the threshold on a big
    // graph (exactly where this renderer is active) kept drawing the stale
    // full-detail cards for the whole gesture instead of the simplified view.
    const unsubSemantic = semanticZoomStore.subscribe(fullRebuild("semanticZoom"));
    // area.addPipe has no unsubscribe, so guard with a flag the cleanup flips instead.
    let pipeLive = true;
    area.addPipe((ctx) => {
      if (pipeLive && ctx && typeof ctx === "object" && "type" in ctx) {
        const c = ctx as { type: string; data?: { type?: string; payload?: { id?: string } } };
        if (c.type === "render" && c.data?.type === "node") { count("render-pipe"); scheduleRebuild(c.data.payload?.id); }
      }
      return ctx;
    });

    // Each frame, mirror the area transform AND sync node positions. ANY motion — a pan/zoom
    // (transform changes) OR a node/group drag (positions change, e.g. rete's area.translate)
    // — is a gesture: swap to the canvas, which carries the motion smoothly, then hand back to
    // the DOM on settle. Cables follow the moved sockets live. Discrete interactions (click,
    // edit, collapse, context menu) don't move anything, so they stay on the DOM.
    let lastK = NaN, lastX = NaN, lastY = NaN;
    let lastSel = new Set<string>();
    let lastQuality = NaN;
    let raf = requestAnimationFrame(function sync() {
      const t = area.area.transform;
      engine.setTransform(t.k, t.x, t.y);
      // Console quality knobs (no UI). `__hcLive = true` → faithful per-frame re-raster (crisp at
      // any zoom, costs a re-raster per visible node). `__hcQuality = n` → LOD bias for the cached
      // path: target texture px ÷ on-screen px; 1 = 1:1, >1 picks sharper mip levels (capped by
      // the 1× capture), <1 = cheaper/softer. `__hcOverlay = true` → half-opacity over the DOM.
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
        lastK = t.k; lastX = t.x; lastY = t.y;
        const movedIds = new Set<string>();
        // Read selection from the LIVE DOM class (not node.selected), so the re-capture below
        // fires the frame the `--selected` ring actually lands — keying off the model would race
        // React's class write and clone the node a frame too early (no ring).
        const curSel = new Set<string>();
        for (const node of editor.getNodes()) {
          const off = offsets.get(node.id);
          const view = area.nodeViews.get(node.id);
          if (off && view && engine.setNodePosition(node.id, view.position.x + off.dx, view.position.y + off.dy)) movedIds.add(node.id);
          const spec = specById.get(node.id);
          if (spec && spec.el.className.includes("--selected")) curSel.add(node.id);
        }
        if (movedIds.size) { engine.relayoutCables(movedIds); moved = true; }
        // Selection delta → re-capture ONLY the toggled nodes (engine.updateNodes), so the real
        // accent ring updates live — cheap enough to stay smooth even as a lasso sweeps over many
        // nodes (a full rebuild per change would defeat the point of activating the canvas).
        let selChanged = curSel.size !== lastSel.size;
        if (!selChanged) for (const id of curSel) if (!lastSel.has(id)) { selChanged = true; break; }
        if (selChanged) {
          const changed: EngineNodeSpec[] = [];
          for (const id of curSel) if (!lastSel.has(id)) { const s = specById.get(id); if (s) changed.push(s); }
          for (const id of lastSel) if (!curSel.has(id)) { const s = specById.get(id); if (s) changed.push(s); }
          if (changed.length) engine.updateNodes(changed);
          lastSel = curSel;
        }
        const lassoing = lassoActiveStore.get();
        if (overlay) { engine.setActive(true); holder.style.visibility = ""; } // both shown, overlaid
        // Keep the canvas up for the WHOLE interaction, not just while pixels move: enter on
        // motion or a lasso, and — once gesturing — hold it while the pointer stays down. That
        // last clause stops a SLOW pan (speed momentarily 0 between frames) from settling back to
        // the DOM and flickering until the real pointerUp.
        else if (moved || lassoing || (gesturing && pointerDown)) enterGesture();
      }
      raf = requestAnimationFrame(sync);
    });

    // Track pointer-held state so a stalled-but-ongoing gesture (slow pan, paused drag) doesn't
    // settle early. Capture phase so we see it regardless of where the press lands.
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
      holder.style.visibility = ""; // restore the DOM
      holder.classList.remove("solenoid-html-frozen");
      hideDomOnly(); // clear the per-element visibility overrides
      engine.dispose();
    };
  }, [active, ready]);

  if (!active) return null;
  return <div ref={hostRef} className="solenoid-html-layer" />;
}
