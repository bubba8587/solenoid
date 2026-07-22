import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { NodeEditor, ClassicPreset } from "rete";
import { AreaPlugin, AreaExtensions, Drag } from "rete-area-plugin";
import { ConnectionPlugin } from "rete-connection-plugin";
import { ReactPlugin } from "rete-react-plugin";
import { solenoidClassicRenderSetup, makeSolenoidConnectionFlow, CappedZoom } from "./areaPresets";
import { DataflowEngine } from "rete-engine";
import { HistoryPlugin, Presets as HistoryPresets } from "rete-history-plugin";
import { MinimapPlugin } from "rete-minimap-plugin";
import { createRoot } from "react-dom/client";

import type { Schemes, AreaExtra, SolenoidNode } from "./schemes";
import { SolenoidSocket } from "./sockets";
import { collapseStore } from "./collapseStore";
import {
  setEditorRefs, processGraph, bumpConnectionVersion, setCableDragging, cableDragStore,
  setUnselectAllNodes, setAutoArrange, setSelectNode, setRepositionDocked, setPushHistory, setClearHistory, setHistoryPlugin,
  setDeleteSelected, setCleanup,
  isGraphRebuilding, setBulkSettle, markBulkTopoDirty, setCtorRegistryProvider,
} from "./process";
import { getActiveHistory } from "./activeGraph";
import { ctorRegistry } from "./nodeCtorRegistry";
import { unpackComposite } from "./compositeLogic";
import { compositeEditorStore } from "./compositeEditorStore";
import { presentationStore } from "./presentationStore";
import { reportStore } from "./reportStore";
import { paletteStore } from "./paletteStore";
import { CommandPalette } from "./CommandPalette";
import { settingsStore } from "./settingsStore";
import { cableSelectionStore, cableGhostStore, socketHighlightStore, socketHoverCableStore, dragSocketKey } from "./cableState";
import { resolveSocketHighlights } from "./highlightUtils";
import { canvasLockStore } from "./canvasLock";
import { touchSelectStore } from "./touchSelectStore";
import { IS_MOBILE } from "./coarse";
import { installErrorGuards } from "./errorValue";
import "./seedTune"; // console seed-tune hook (window.__solenoidTuneSeed — scripts/tune-seeds.mjs)
import { type Pt } from "./lasso";
import { FormatControllerNode, GroupNode, CompositeNode } from "./rete-nodes";
import { reconcileFcTypes } from "./fcReconcile";
import { installCanvasKeyboard } from "./canvasKeyboard";
import { makeEnsureArrange, makeArrangeFn, makeCleanupFn } from "./tidyArrange";
import { installLassoSelection } from "./canvasLasso";
import { installCanvasContextMenu } from "./canvasContextMenu";
import { insertConduitForCables, linkStandoffBetween, deleteCables, deleteSelection, attachFormatController } from "./canvasActions";
import { computeDockedCanvasPos, dockedRenderedDims, findDockTarget, insertFcInline, removeFcInline } from "./fcDocking";
import {
  moveGroupMembers, reconcileGroupMembership,
  dropFromGroups, sendGroupToBack, absorbIntoContainingGroup,
} from "./groupLogic";
import { groupPushStore, restoreSettledPushes, translateEntityBy } from "./groupPush";
import {
  standoffStore, standoffClusters, standoffLayoutTick, setStandoffSettle,
  type Box as StandoffBox,
} from "./standoffs";
import { solveStandoffs } from "./standoffSolver";
import { measuredBox } from "./nodeSize";
import { rebuildGroupMembership } from "./groupMembership";
import { dropFrameRef } from "./frameBackend";
import { syncGroupCollapse } from "./groupCollapse";
import { formatAnnotationStore, formatMismatchStore, unitsCompatible } from "./formatAnnotationStore";
import { SocketLegend, ConfirmDialog, NoticeToasts, SocketContextMenu, CableContextMenu, NodeContextMenu, StandoffLayer } from "./components";
import { CableFlourish } from "./components/CableFlourish";
import { LoadOverlay } from "./components/LoadOverlay";
import { ComputeOverlay } from "./components/ComputeOverlay";
import { IsolatePill } from "./components/IsolatePill";
import { CableInspector } from "./components/CableInspector";
import { IsolateEndpoints } from "./components/IsolateEndpoints";
import { solenoidMinimapPreset, collapsedAwareNodesRect } from "./components/Minimap";
import type { SocketContextTarget, CableContextTarget, NodeContextTarget } from "./components";
import { isolateStore, isoEndpointSelect } from "./isolateStore";
import { isolateNodes, isolateChainOf, isolateWhereUsed } from "./isolate";
import { commentsPanelUi } from "./commentStore";
import { pinNodeValue } from "./pinStore";
import { buildCatalog } from "./catalogUtils";
import { packsStore } from "./packs";
import { dockedNodeStore } from "./dockedNodeStore";
import { forgetNode } from "./nodeStoreRegistry";
import { AddNodeMenu } from "./AddNodeMenu";
import { addMenuRequest } from "./addMenuStore";
import { flattenLeaves, filterByCompatibleSocket, firstCompatibleSocketKey } from "./catalogSearch";
import { syncSemanticZoomFor } from "./semanticZoomStore";
import { setGraphChanged } from "./process";
import { installInputCoercion } from "./coerceInputs";
import { scheduleAutosave } from "./persistence";
import { gridSnapStore, snapCoord, DOT_SPACING } from "./gridSnapStore";
import { overlayBus } from "./overlayTransform";
import { nodeGeomBus } from "./nodeScene";
import { RenderOverlay } from "./components/RenderOverlay";
import { CableCanvas } from "./components/CableCanvas";
import { NodeCanvas } from "./components/NodeCanvas";
import { HtmlCanvasLayer } from "./components/HtmlCanvasLayer";
import { useRenderMode, renderModeStore } from "./renderMode";
import { documentStore, ensureFirstDocument } from "./documentStore";
import type { NodeCatalogEntry } from "./AddNodeMenu";

import "./canvas.css";

// ─── Canvas-local constants ───────────────────────────────────────────────────

// Zoom feel + double-click suppression are shared with every canvas-substituting
// surface (the composite drill-in) via areaPresets.ts CappedZoom — so they can't drift.

// Mobile mode drives the touch interaction model (tap selects, drag moves only
// selected, unselected nodes are transparent to pan/pinch). Keyed on IS_MOBILE
// (not raw pointer coarseness) so "Request desktop site" gets desktop behavior.


// Quick-wire: a menu opened from a cable dropped on empty canvas carries the
// origin socket + a pre-filtered entry list (compatible nodes only), so picking
// one both creates it AND wires the dragged cable into it.
type QuickWireOrigin = { nodeId: string; key: string; side: "input" | "output" };
type MenuState =
  | { screenX: number; screenY: number; quickWire?: QuickWireOrigin; compatibleTypes?: Set<string> }
  | null;

export function Canvas() {
  const renderMode = useRenderMode();
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<NodeEditor<Schemes> | null>(null);
  const areaRef = useRef<AreaPlugin<Schemes, AreaExtra> | null>(null);
  const historyRef = useRef<HistoryPlugin<Schemes> | null>(null);
  const dblClickCleanupRef = useRef<(() => void) | null>(null);
  const screenMouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // Active pointer ids — when ≥2 the user is pinching, and no node should drag.
  const activePointersRef = useRef<Set<number>>(new Set());
  // Touch gesture bookkeeping: the node the first finger landed on (for
  // tap-to-select), whether the gesture moved, and whether it became multi-touch.
  const tapNodeIdRef = useRef<string | null>(null);
  // Set when a touch lands on a form control (checkbox/input/…) INSIDE a node, so
  // toggling e.g. a Boolean checkbox doesn't get treated as a background tap that
  // clears the node's selection (which forced a re-tap before each toggle).
  const tapControlNodeIdRef = useRef<string | null>(null);
  const tapMovedRef = useRef(false);
  const gestureMultiRef = useRef(false);
  // Whether the current gesture's first finger landed inside the canvas container
  // (a node or the empty background) vs OFF-canvas (a mobile-bar button, a panel).
  // rete's selectableNodes clears the selection on a window-level pointerup when its
  // twitch counter is still armed from an earlier canvas press — so an off-canvas
  // tap (e.g. the Delete button) would wrongly wipe the selection. We swallow the
  // area pipe's pointerup for off-canvas gestures to stop that.
  const tapOnCanvasRef = useRef(false);
  const dragOriginKeyRef = useRef<string | null>(null);
  // Live modifier state for axis-constrained dragging (Shift) and edge-align
  // (Ctrl/Cmd). Tracked globally so a key pressed mid-drag takes effect without a
  // fresh DOM event.
  const shiftDragRef = useRef(false);
  const ctrlDragRef = useRef(false);
  // Pick history: the last two DISTINCT node ids picked. The OLDER one is the
  // "previously selected object" a Ctrl-drag aligns to (it's deselected, so it
  // stays put while the grabbed node moves).
  const lastPickedRef = useRef<string | null>(null);
  const prevPickedRef = useRef<string | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  // Live mirror for the keyboard handler's bare-Enter guard (the handler is
  // installed once, so reading the state directly would freeze it at mount).
  const menuRef = useRef<MenuState>(menu);
  menuRef.current = menu;
  // The Add/quick-wire menu must not survive a document switch — node ids
  // regenerate on load, so a pick from a stale menu would add an orphan,
  // unwired node into the NEW document at stale coordinates (Ctrl+O fires even
  // while the menu's search field is focused). Close ONLY when the current doc
  // ID changes: documentStore also notifies on every debounced AUTOSAVE
  // (captureCurrent, 700ms after any edit), which must not yank a menu the
  // user just opened.
  useEffect(() => {
    let last = documentStore.currentId();
    return documentStore.subscribe(() => {
      const cur = documentStore.currentId();
      if (cur !== last) {
        last = cur;
        setMenu(null);
      }
    });
  }, []);
  // Module store, not useState: the mobile bottom bar opens the palette from
  // outside Canvas's tree, and the keydown handler reads it closure-free.
  const paletteOpen = useSyncExternalStore(paletteStore.subscribe, paletteStore.get);
  // Always-on (docked) command palette: rendered persistently regardless of the
  // open toggle, and non-modal (see CommandPalette `persistent`).
  const paletteAlwaysOn = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get("commandPaletteAlwaysOn"));

  // Remove the selected cables and/or nodes — mechanics in canvasActions.ts
  // (deleteSelection). Shared by the Delete/Backspace key path and the mobile
  // delete control.
  const deleteSelected = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    await deleteSelection(editor, areaRef.current);
  }, []);

  // Expose it to the mobile controls (no keyboard there).
  useEffect(() => setDeleteSelected(deleteSelected), [deleteSelected]);
  const [socketCtx, setSocketCtx] = useState<SocketContextTarget | null>(null);
  const closeSocketCtx = useCallback(() => setSocketCtx(null), []);
  const [cableCtx, setCableCtx] = useState<CableContextTarget | null>(null);
  const closeCableCtx = useCallback(() => setCableCtx(null), []);
  const [nodeCtx, setNodeCtx] = useState<NodeContextTarget | null>(null);
  const closeNodeCtx = useCallback(() => setNodeCtx(null), []);
  const standoffRootRef = useRef<ReturnType<typeof createRoot> | null>(null);
  const isoEndpointsRootRef = useRef<ReturnType<typeof createRoot> | null>(null);
  // Lasso-selection state. `mode` is "touch" (CW winding → AutoCAD
  // crossing selection: any overlap counts) or "enclose" (CCW winding
  // → AutoCAD window selection: must be fully inside).
  const [lasso, setLasso] = useState<{ points: Pt[]; mode: "touch" | "enclose" } | null>(null);

  // Canvas keyboard shortcuts — the full map + handlers live in canvasKeyboard.ts.
  useEffect(() => installCanvasKeyboard({
    editorRef, areaRef, historyRef, containerRef, screenMouseRef,
    isAddMenuOpen: () => menuRef.current !== null,
    deleteSelected,
  }), [deleteSelected]);

  // Semantic zoom: re-derive the far-zoom flag whenever the setting itself
  // toggles (a pan/zoom event re-derives it from the live scale — see
  // syncSemanticZoomFor at the "zoomed" pipe branch and init() above; this
  // covers the OTHER trigger, flipping the setting without moving the camera).
  useEffect(() => {
    return settingsStore.subscribe(() => {
      const area = areaRef.current;
      if (area) syncSemanticZoomFor(area.area.transform.k);
    });
  }, []);

  // Track the Shift key for axis-constrained dragging (read live in the
  // nodetranslate pipe). Capture phase so it sees the key even over a focused
  // input; reset on blur so a key released while unfocused doesn't stick.
  useEffect(() => {
    const set = (e: KeyboardEvent) => {
      // Only TRUSTED (real) key events drive the drag-modifier state. The mobile
      // undo/redo buttons dispatch a SYNTHETIC Ctrl(+Shift)+Z keydown (MobileControls
      // `fireUndo`) with no matching keyup — reading its modifiers here left the
      // axis-lock (Shift) / edge-align (Ctrl) refs stuck ON permanently after a Redo.
      if (!e.isTrusted) return;
      shiftDragRef.current = e.shiftKey;
      ctrlDragRef.current = e.ctrlKey || e.metaKey;
    };
    const clear = () => { shiftDragRef.current = false; ctrlDragRef.current = false; };
    window.addEventListener("keydown", set, true);
    window.addEventListener("keyup", set, true);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", set, true);
      window.removeEventListener("keyup", set, true);
      window.removeEventListener("blur", clear);
    };
  }, []);

  // Track screen mouse position for paste + quick-wire placement. We listen to
  // pointermove as well as mousemove because during a drag (a cable drag, a pan)
  // rete-area-plugin's Drag.move calls e.preventDefault() on pointermove, which
  // SUPPRESSES the compatibility mousemove events — so a mousemove-only tracker
  // freezes at the drag's start point, and quick-wire dropped the new node near the
  // ORIGIN socket instead of where the cable was released. pointermove keeps firing
  // through the drag (preventDefault stops default actions, not other listeners), so
  // the ref stays live and the node lands at the real drop location.
  useEffect(() => {
    const track = (e: MouseEvent | PointerEvent) => {
      screenMouseRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", track);
    window.addEventListener("pointermove", track);
    return () => {
      window.removeEventListener("mousemove", track);
      window.removeEventListener("pointermove", track);
    };
  }, []);

  // Let the menu bar's Insert command open the Add-node menu.
  useEffect(() => addMenuRequest.register((screenX, screenY) => setMenu({ screenX, screenY })), []);

  // Highlight sockets and their cables when the pointer rests on any socket
  // (not during a drag — that case is handled separately below).
  // Uses elementsFromPoint so it works regardless of how Rete captures pointer
  // events on output sockets.
  useEffect(() => {
    let lastKey = ""; // "nodeId::socketKey" or "" when off-socket
    function onMove(e: PointerEvent) {
      if (cableDragStore.get()) return; // drag in progress — handled below
      // Any held button means an active gesture (pan, node-drag, lasso). Hover
      // highlight is a rest-state affordance, so skip the per-move
      // elementsFromPoint hit-test (a synchronous layout read) during gestures.
      if (e.buttons) return;
      let foundNodeId = "";
      let foundSocketKey = "";
      for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
        if (el instanceof HTMLElement && el.dataset.socketKey && el.dataset.nodeId) {
          foundNodeId   = el.dataset.nodeId;
          foundSocketKey = el.dataset.socketKey;
          break;
        }
      }
      const newKey = foundNodeId ? `${foundNodeId}::${foundSocketKey}` : "";
      if (newKey === lastKey) return; // pointer still on same socket, skip
      lastKey = newKey;
      if (!foundNodeId) {
        socketHighlightStore.setSocketHover([]);
        socketHoverCableStore.clear();
        return;
      }
      const { socketKeys, cableIds } = resolveSocketHighlights(foundNodeId, foundSocketKey);
      socketHighlightStore.setSocketHover(socketKeys);
      socketHoverCableStore.set(cableIds);
    }
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  // Highlight the input socket under the cursor while a cable is being dragged.
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const origin = dragOriginKeyRef.current;
      if (!e.buttons || !origin) return;
      let found: string | null = null;
      for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
        if (el instanceof HTMLElement && el.dataset.socketSide === "input") {
          const nid = el.dataset.nodeId;
          const key = el.dataset.socketKey;
          if (nid && key) { found = dragSocketKey(nid, key); break; }
        }
      }
      socketHighlightStore.setDrag(found ? [origin, found] : [origin]);
    }
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  // Track the touch gesture so the area pipe can implement: pinch/pan freely,
  // a clean tap selects, drag moves only selected. Records active pointers (≥2
  // = pinch), whether the gesture moved, and which node the first finger landed
  // on (for tap-to-select, since unselected nodes are made drag-transparent).
  useEffect(() => {
    const set = activePointersRef.current;
    let startX = 0, startY = 0;
    // The node whose view contains the target, or null. `formControl` flags
    // taps on an editable widget — those edit the control, they don't select the
    // node, but we still want the owning node so a control tap on an already-
    // selected node can preserve (not clear) the selection.
    const nodeAndControl = (t: EventTarget | null): { id: string | null; formControl: boolean } => {
      if (!(t instanceof Element)) return { id: null, formControl: false };
      const formControl = !!t.closest("input, select, textarea, button, [contenteditable]");
      const area = areaRef.current;
      if (!area) return { id: null, formControl };
      for (const [id, v] of area.nodeViews) if (v.element.contains(t)) return { id, formControl };
      return { id: null, formControl };
    };
    const add = (e: PointerEvent) => {
      set.add(e.pointerId);
      if (set.size === 1) {
        gestureMultiRef.current = false;
        tapMovedRef.current = false;
        startX = e.clientX; startY = e.clientY;
        const { id, formControl } = IS_MOBILE ? nodeAndControl(e.target) : { id: null, formControl: false };
        tapNodeIdRef.current = formControl ? null : id;
        tapControlNodeIdRef.current = formControl ? id : null;
        // Did this gesture start on the canvas at all? (container = the rete area).
        const cont = containerRef.current;
        tapOnCanvasRef.current = !!(cont && e.target instanceof Node && cont.contains(e.target));
      } else if (set.size >= 2) {
        gestureMultiRef.current = true;
      }
    };
    const move = (e: PointerEvent) => {
      if (set.size === 0) return;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 8) tapMovedRef.current = true;
    };
    const drop = (e: PointerEvent) => {
      set.delete(e.pointerId);
      if (set.size === 0) {
        // rete's pointer listener tears down its window pointerup on the FIRST
        // finger's release, stranding any later pinch pointers in the zoom
        // handler's array — which breaks the next pinch until a clean one
        // resets it. Clear them once every finger is up.
        const zh = (areaRef.current?.area as unknown as
          { zoomHandler?: { pointers?: unknown[]; previous?: unknown } } | undefined)?.zoomHandler;
        if (zh && Array.isArray(zh.pointers)) { zh.pointers.length = 0; zh.previous = null; }
      }
    };
    window.addEventListener("pointerdown", add, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", drop, true);
    window.addEventListener("pointercancel", drop, true);
    return () => {
      window.removeEventListener("pointerdown", add, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", drop, true);
      window.removeEventListener("pointercancel", drop, true);
      set.clear();
    };
  }, []);

  // Mobile SELECT mode disables rete's area Drag (1-finger pan) so a single finger
  // draws the lasso instead of panning — while the Zoom handler stays live, so TWO
  // fingers still pinch/pan (the lasso no longer stopPropagations finger 1, so the
  // zoom handler sees both). Restore the Drag handler when select mode turns off.
  // Mobile-only: desktop's shift-lasso blocks the pan per-gesture (stopPropagation)
  // and must keep normal drag-to-pan otherwise.
  useEffect(() => {
    if (!IS_MOBILE) return;
    const applyDragMode = () => {
      const area = areaRef.current;
      if (!area) return;
      if (touchSelectStore.get()) area.area.setDragHandler(null);
      else area.area.setDragHandler(new Drag());
    };
    const unsub = touchSelectStore.subscribe(applyDragMode);
    applyDragMode(); // in case select mode is already on when this mounts
    return unsub; // the area itself is torn down on unmount, so no drag restore needed
  }, []);

  // Shift-drag lasso selection — mechanics in canvasLasso.ts; the matched
  // outline renders via the <svg> at the bottom of this component's JSX.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return installLassoSelection({ container, editorRef, areaRef, activePointersRef, setLasso });
  }, []);


  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // StrictMode double-invokes this effect in dev; clear any DOM left
    // behind by the previous run's AreaPlugin before mounting a new one.
    container.innerHTML = "";

    let destroyed = false;
    let localArea: AreaPlugin<Schemes, AreaExtra> | null = null;
    let unsubFmt: (() => void) | null = null;

    async function init() {
      const editor = new NodeEditor<Schemes>();
      // Normalize every node's inputs to its declared socket shapes (table is the
      // numeric supertype). Installed before any node is created so all are wrapped.
      installInputCoercion(editor);
      const area = new AreaPlugin<Schemes, AreaExtra>(container!);
      // Replace the stock zoom with our proportional + clamped one (caps zoom
      // speed across mouse wheel, trackpad pinch, and two-finger scroll alike).
      area.area.setZoomHandler(new CappedZoom(0.1));
      localArea = area;
      const connection = new ConnectionPlugin<Schemes, AreaExtra>();
      const reactPlugin = new ReactPlugin<Schemes, AreaExtra>({ createRoot });
      const engine = new DataflowEngine<Schemes>();
      const history = new HistoryPlugin<Schemes>();
      history.addPreset(HistoryPresets.classic.setup());
      // Cap the stack (the plugin ctor doesn't expose the inner History limit) —
      // a backstop against unbounded growth; the real hygiene is clearHistory()
      // on every document load (persistence.loadGraph, audit P0-5).
      (history as unknown as { history: { limit?: number } }).history.limit = 200;
      // Expose the plugin instance for the Session History node (see process.ts).
      setHistoryPlugin(history);
      // Let non-graph changes (e.g. a group resize, an extensible-row add, a label
      // edit) push their own undo entries — onto the ACTIVE graph's history, so an
      // edit made INSIDE a composite drill-in is undone by the drill-in's own
      // undo (Ctrl+Z / the mobile bar), not stranded on the main stack. Resolves to
      // the main history when not drilled in (getActiveHistory falls back to it).
      setPushHistory((action) => { void getActiveHistory()?.add(action); });
      setClearHistory(() => history.clear());
      // Visual minimap size is set in the React preset below; the
      // plugin itself only takes ratio + boundViewport + minDistance.
      const minimap = new MinimapPlugin<Schemes>({ ratio: 1.4 });
      // Make the minimap collapse-aware: hide members folded into a collapsed
      // group and size the group to its compact rendered box (see Minimap.tsx).
      (minimap as unknown as { getNodesRect: () => unknown }).getNodesRect = collapsedAwareNodesRect;
      // rAF-coalesce the plugin's render. It fires render() SYNCHRONOUSLY on every
      // translated/zoomed/nodetranslated event, which during a continuous drag
      // arrive in bursts not aligned to paint frames — each one re-reads layout
      // (getNodesRect touches offsetWidth/Height for collapsed groups) and re-
      // normalizes every node against a bounding box that shifts as the dragged
      // node moves, so the map jittered. Collapsing to at most one render per frame
      // gives a smooth, frame-aligned cadence (backlog: "smoothness over jump-to-
      // latest") and drops the redundant mid-frame layout reads.
      {
        const mm = minimap as unknown as { render: () => void };
        const rawRender = mm.render.bind(minimap);
        let rafPending = 0;
        mm.render = () => {
          if (rafPending) return;
          rafPending = requestAnimationFrame(() => {
            rafPending = 0;
            // A doc switch can destroy the area between schedule and fire.
            if (!destroyed) rawRender();
          });
        };
      }
      // Lazy ELK loader (heavy chunk, only Tidy needs it) — see tidyArrange.ts.
      const ensureArrange = makeEnsureArrange(area, () => destroyed);

      const nodeSelector = AreaExtensions.selector();
      const ctrlAccum = AreaExtensions.accumulateOnCtrl(); // tracks Ctrl/Meta held

      // Selection semantics we want (the stock selectableNodes can't express):
      //  • Plain press on an already-selected node keeps the whole selection, so
      //    you can drag the group with NO modifier (stock collapses to the one
      //    node on press, forcing you to hold Ctrl to drag a multi-selection).
      //  • A plain *click* (no drag) on a selected node collapses to just it.
      //  • Ctrl-click toggles a node IN or OUT of the selection.
      // The picked-node id + its pre-press selected state drive all three. The
      // capture pipe below runs before selectableNodes' pipe so `active()` sees
      // them when the stock handler decides whether to clear the rest.
      let pickedId: string | null = null;
      let pendingCollapseId: string | null = null;
      let pendingDeselectId: string | null = null;
      let moveCount = 0;
      const isSelected = (id: string | null) =>
        !!(id && (editor.getNode(id) as { selected?: boolean } | undefined)?.selected);

      // Accumulate when Ctrl/Meta is held (desktop) OR touch select mode is on
      // (mobile, where there is no Ctrl). Tapping a node then adds/removes it.
      const accumulateActive = () => ctrlAccum.active() || touchSelectStore.get();

      const accumulating = {
        // Don't clear the rest of the selection when accumulating OR the pressed
        // node was already selected (preserve it so a plain drag moves the lot).
        active: () => accumulateActive() || isSelected(pickedId),
      };

      area.addPipe((ctx) => {
        if (!ctx || typeof ctx !== "object" || !("type" in ctx)) return ctx;
        const c = ctx as { type: string; data?: { id?: string; event?: PointerEvent } };
        // Right-button presses never reach selectableNodes. A node's drag
        // handler only swallows LEFT-button pointerdowns, so a right-click on
        // a node bubbles to the area; selectableNodes counts the no-move
        // down→up pair as a background click and clears the WHOLE selection —
        // right before the contextmenu handler (Link with Standoff, cable
        // menus) needs to read it. This pipe runs before selectableNodes'.
        if ((c.type === "pointerdown" || c.type === "pointerup") && c.data?.event?.button === 2) {
          return;
        }
        if (c.type === "nodepicked") {
          const id = c.data?.id ?? null;
          const wasSelected = isSelected(id);
          pickedId = id;
          moveCount = 0;
          pendingCollapseId = null;
          pendingDeselectId = null;
          if (id && accumulateActive() && wasSelected) {
            // Ctrl-click / tap-in-select-mode an already-selected node toggles it
            // OUT — but only if this turns out to be a CLICK (handled on pointerup
            // below). We must NOT swallow on pointerdown: doing so skips the
            // selector's pick and our draggingGroupId bookkeeping, yet the node's
            // own DOM drag handler still fires — so a Ctrl-DRAG would move the body
            // with neither member-follow engaged, detaching a group from its
            // members (and glitching their cables). Falling through makes a
            // Ctrl-drag behave exactly like a plain drag; the click still toggles.
            pendingDeselectId = id;
          }
          if (id && !accumulateActive() && wasSelected) {
            // Keep the selection now (active() === true); collapse to this node
            // on pointerup IF it turns out to be a click, not a drag.
            pendingCollapseId = id;
          }
        } else if (c.type === "nodetranslate") {
          // Never move a node while pinching (≥2 fingers) — the gesture is a
          // zoom, even if a finger is resting on a (selected) node.
          if (activePointersRef.current.size >= 2) return;
        } else if (c.type === "pointermove") {
          moveCount++;
        } else if (c.type === "pointerup") {
          // OFF-CANVAS tap → swallow. rete's selectableNodes clears the whole
          // selection on a window-level pointerup while its `twitch` counter is
          // still < 4 (a "tap"), but that counter is only re-armed by a CONTAINER
          // pointerdown. So an off-canvas tap (a mobile-bar button, a panel) fires a
          // window pointerup with twitch still armed from an earlier canvas press
          // and wipes the selection — this is why tapping Delete deselected instead
          // of deleting, and why deactivating select mode dropped the selection.
          // The gesture that started off-canvas has no business touching the canvas
          // selection, so swallow its pointerup before selectableNodes sees it.
          if (IS_MOBILE && !tapOnCanvasRef.current) {
            return;
          }
          // Tapping a form control (e.g. a Boolean checkbox) of an already-
          // SELECTED node must not clear its selection — otherwise every toggle
          // deselects and you have to re-tap the node to toggle again. Swallow the
          // up so selectableNodes' background-tap clear can't run.
          if (
            IS_MOBILE &&
            tapControlNodeIdRef.current &&
            !tapMovedRef.current &&
            !gestureMultiRef.current &&
            isSelected(tapControlNodeIdRef.current)
          ) {
            tapControlNodeIdRef.current = null;
            return;
          }
          tapControlNodeIdRef.current = null;
          // Touch tap-to-select: an unselected node was tapped. It's made
          // drag-transparent (guard below) so rete didn't pick it, and
          // selectableNodes is about to treat this as a background tap and clear
          // the selection — select the node instead and swallow the event so
          // that clear doesn't run.
          if (
            IS_MOBILE &&
            !canvasLockStore.get() &&
            tapNodeIdRef.current &&
            !tapMovedRef.current &&
            !gestureMultiRef.current &&
            !isSelected(tapNodeIdRef.current)
          ) {
            const id = tapNodeIdRef.current;
            tapNodeIdRef.current = null;
            void selectable.select(id, touchSelectStore.get());
            return; // stop the background-tap deselect
          }
          if (pendingCollapseId && moveCount < 4) {
            const keep = pendingCollapseId;
            for (const n of editor.getNodes()) {
              if (n.id !== keep && (n as { selected?: boolean }).selected) {
                void nodeSelector.remove({ label: "node", id: n.id });
              }
            }
          }
          // Deferred Ctrl/tap toggle-out: only when this was a click, not a drag.
          if (pendingDeselectId && moveCount < 4) {
            void nodeSelector.remove({ label: "node", id: pendingDeselectId });
          }
          pendingCollapseId = null;
          pendingDeselectId = null;
        }
        return ctx;
      });

      const selectable = AreaExtensions.selectableNodes(area, nodeSelector, { accumulating });
      AreaExtensions.simpleNodesOrder(area);

      // ── Standoff layer + solver ────────────────────────────────────────────
      // The bars render in their own React root inside the area's transformed
      // plane, BELOW everything (z -3 — under expanded groups at -2, conduits at
      // -1, and all nodes).
      {
        const holder = document.createElement("div");
        holder.style.position = "absolute";
        holder.style.left = "0";
        holder.style.top = "0";
        holder.style.zIndex = "-3";
        area.area.content.holder.appendChild(holder);
        const root = createRoot(holder);
        root.render(<StandoffLayer />);
        standoffRootRef.current = root;
      }

      // ── Isolate auto-endpoints ───────────────────────────────────────────────
      // Boundary terminals for the Isolate overlay, in the transformed plane and
      // ABOVE the nodes (z 3) so the terminals + their cables read on top.
      {
        const holder = document.createElement("div");
        holder.style.position = "absolute";
        holder.style.left = "0";
        holder.style.top = "0";
        holder.style.zIndex = "3";
        area.area.content.holder.appendChild(holder);
        const root = createRoot(holder);
        root.render(<IsolateEndpoints />);
        isoEndpointsRootRef.current = root;
      }

      // Live boxes for every entity a standoff references.
      const standoffBoxes = (): Map<string, StandoffBox> => {
        const m = new Map<string, StandoffBox>();
        for (const s of standoffStore.all()) {
          for (const end of [s.a, s.b]) {
            if (m.has(end.nodeId)) continue;
            // measuredBox: shared size chokepoint (live → mirror → collapse-aware
            // fallback), so the solver sees the same boxes align/tidy/push do.
            const b = measuredBox(area, end.nodeId, editor);
            if (!b) continue;
            m.set(end.nodeId, { x: b.x, y: b.y, w: b.w, h: b.h });
          }
        }
        return m;
      };
      // Solve the network and apply corrections (groups carry members, hosts
      // carry docked FCs). `standoffSolving` keeps the apply from re-entering
      // itself through the nodetranslated pipe.
      let standoffSolving = false;
      const settleStandoffNetwork = (pinned: Set<string> = new Set(), opts?: { forceLock?: boolean }) => {
        if (standoffSolving || standoffStore.isEmpty()) return;
        const disp = solveStandoffs(standoffBoxes(), standoffStore.all(), pinned, opts);
        if (disp.size === 0) return;
        standoffSolving = true;
        try {
          for (const [id, d] of disp) translateEntityBy(editor, area, id, d.dx, d.dy);
        } finally {
          standoffSolving = false;
        }
      };
      setStandoffSettle(settleStandoffNetwork);

      // Node drag-handler guard. Two jobs:
      //  • Lock canvas → never drag (view-only; the press falls through to pan).
      //  • Touch → only a SELECTED node grabs a drag, so an unselected node is
      //    pan/pinch-transparent (a press pans, a finger over it can't break a
      //    pinch); desktop keeps rete's default (left-button) drag.
      // rete's node-drag does stopPropagation only AFTER this guard, so a false
      // guard lets the press bubble to the area = pan.
      // Screen-px band along a group's outer border that still grabs the group;
      // the interior between header and this band is pan-through.
      const GROUP_EDGE_BAND = 16;
      const patchDragGuard = (id: string) => {
        const view = area.nodeViews.get(id) as unknown as
          { dragHandler?: { guards?: { down?: (e: PointerEvent) => boolean } }; element?: HTMLElement } | undefined;
        const guards = view?.dragHandler?.guards;
        if (!guards) return;
        guards.down = (e: PointerEvent) => {
          if (canvasLockStore.get()) return false;
          if (IS_MOBILE && !isSelected(id)) return false;
          if (e.pointerType === "mouse" && e.button !== 0) return false;
          // An expanded group's body interior is NOT a drag handle — only its
          // header bar and a thin band along the outer edges grab the group, so
          // a press in the open body falls through to pan the canvas. (Member
          // nodes are separate area views, not DOM children, so they stay
          // independently draggable / clickable.) Collapsed groups are small,
          // node-like boxes — fully draggable like any node.
          const node = editor.getNode(id);
          if (node instanceof GroupNode && !node.collapsed) {
            const t = e.target as Element | null;
            if (t?.closest(".solenoid-group__header")) return true;
            const rect = view?.element?.getBoundingClientRect();
            if (!rect) return false;
            return (
              e.clientX - rect.left <= GROUP_EDGE_BAND ||
              rect.right - e.clientX <= GROUP_EDGE_BAND ||
              e.clientY - rect.top <= GROUP_EDGE_BAND ||
              rect.bottom - e.clientY <= GROUP_EDGE_BAND
            );
          }
          return true;
        };
      };
      editor.addPipe((ctx) => {
        if (ctx && typeof ctx === "object" && "type" in ctx &&
            (ctx as { type: string }).type === "nodecreated") {
          const id = (ctx as { data?: { id?: string } }).data?.id;
          // Error-value guards wrap the node's data() exactly once: error
          // inputs propagate to outputs without running the node, and a
          // throwing data() degrades to a local #ERROR! instead of killing
          // the recompute pass. Installed here because every creation path
          // (add menu, paste, load, seed) funnels through addNode.
          if (id) {
            const node = editor.getNode(id);
            if (node) installErrorGuards(node);
          }
          // Next frame: the area has created & rendered the view by then, well
          // before any user pointerdown that would read the guard.
          if (id) requestAnimationFrame(() => patchDragGuard(id));
        }
        return ctx;
      });

      // Expose unselect-all-nodes so cable selection can clear node
      // selection (kept mutually exclusive).
      setUnselectAllNodes(() => { void nodeSelector.unselectAll(); });
      // Expose selectNode so the lasso can apply its matched ids.
      setSelectNode((id, accumulate) => { void selectable.select(id, accumulate); });

      // Tidy + Cleanup live in tidyArrange.ts; wired to the nav-menu / T & C
      // shortcuts via process.ts. repositionDockedTo is hoisted (function
      // declaration below) — the arrange only calls it in a deferred rAF.
      const arrangeFn = makeArrangeFn({
        editor, area, container: container!, ensureArrange,
        repositionDockedTo: (hostId) => repositionDockedTo(hostId),
        isDestroyed: () => destroyed,
      });
      setAutoArrange(arrangeFn);
      setCleanup(makeCleanupFn(editor, area, arrangeFn));

      // size 105 × ratio 1.4 → 147px wide, matching the socket legend.
      reactPlugin.addPreset(solenoidMinimapPreset(105));
      // Render components + connection veto are shared with every canvas-
      // substituting surface (the composite drill-in, future ones) via
      // areaPresets.ts, so they can't drift. The veto rejects a drop BEFORE
      // makeConnection runs (dropping on a single-connection input removes the
      // existing cable first, so rejecting only afterwards would delete a valid
      // cable), plus self-loops and all wiring while the canvas is locked.
      reactPlugin.addPreset(solenoidClassicRenderSetup());
      connection.addPreset(() => makeSolenoidConnectionFlow(editor));

      // connectionpick / connectiondrop fire on the connection plugin's
      // own scope — Scope.use forwards events DOWN, so an area pipe
      // never sees them. Toggle the cable-drag flag here and track the
      // origin socket for highlight purposes.
      connection.addPipe((ctx) => {
        if (ctx.type === "connectionpick") {
          // Commit any in-progress text edit before the cable is made: a socket's
          // pointerdown starts the drag and preventDefaults the focus change, so a
          // focused field (e.g. the multi-line Text node — which commits on blur,
          // since Enter now inserts a newline) never fired its blur. Wiring it while
          // uncommitted delivered the STALE value (an empty Mermaid source → a blank
          // diagram, no error). Blur first so the graph reads the value you see.
          (document.activeElement as HTMLElement | null)?.blur?.();
          setCableDragging(true);
          // Touch: a cable drag is underway, so every socket becomes a live drop
          // target (see socket.css) regardless of node selection.
          container!.classList.add("solenoid-canvas--cabling");
          const s = (ctx as { data?: { socket?: { nodeId: string; key: string } } }).data?.socket;
          if (s) {
            const key = dragSocketKey(s.nodeId, s.key);
            dragOriginKeyRef.current = key;
            socketHighlightStore.setDrag([key]);
          }
        }
        if (ctx.type === "connectiondrop") {
          // Quick-wire: a drop that lands on empty canvas (no target socket, no
          // connection made) opens the Add menu filtered to nodes compatible with
          // the dragged origin — picking one both creates it and splices the cable.
          if (settingsStore.get("quickWire")) {
            const d = (
              ctx as {
                data?: {
                  initial?: { nodeId: string; key: string; side: "input" | "output" };
                  socket?: unknown;
                  created?: boolean;
                };
              }
            ).data;
            if (d?.initial && d.socket == null && !d.created) {
              const { nodeId, key, side } = d.initial;
              const originNode = editor.getNode(nodeId);
              const originSocket =
                side === "output" ? originNode?.outputs[key]?.socket : originNode?.inputs[key]?.socket;
              if (originSocket instanceof SolenoidSocket) {
                // Quick-wire opens the FULL Add menu (same tree/categories as a
                // normal add) but grays out leaves that can't wire to the dragged
                // socket. Compute just the compatible-type SET here; the menu dims
                // the rest. Only open if at least one node can actually receive it.
                const leaves = flattenLeaves(buildCatalog(true));
                const compatible = filterByCompatibleSocket(leaves, originSocket, side);
                if (compatible.length) {
                  setMenu({
                    screenX: screenMouseRef.current.x,
                    screenY: screenMouseRef.current.y,
                    quickWire: { nodeId, key, side },
                    compatibleTypes: new Set(compatible.map((lc) => lc.leaf.type)),
                  });
                }
              }
            }
          }
          setCableDragging(false);
          container!.classList.remove("solenoid-canvas--cabling");
          dragOriginKeyRef.current = null;
          socketHighlightStore.setDrag([]);
        }
        return ctx;
      });

      editor.use(area);
      area.use(reactPlugin);
      area.use(connection);
      area.use(history);
      area.use(minimap);
      // ELK's AutoArrangePlugin is registered lazily on first Tidy (see ensureArrange).
      editor.use(engine);

      // Disable double-click-to-zoom. rete-area-plugin's Zoom class
      // attaches its dblclick handler to this same container in bubble
      // phase; a capture-phase swallow here stops the bubble before
      // Zoom sees it.
      // TS narrowing on `container` (from the outer useEffect's
      // `if (!container) return`) doesn't survive the async function
      // boundary, so we re-hoist a non-null reference here.
      const c = container!;
      const swallowDblClick = (e: Event) => { e.stopImmediatePropagation(); };
      c.addEventListener("dblclick", swallowDblClick, true);

      // Any pointerdown that ISN'T on a cable should clear the cable
      // selection — backgrounds and nodes both. Cables stop their own
      // pointerdown from propagating on desktop, but on touch it bubbles
      // (stopDragStart is desktop-only), so also ignore presses landing on a
      // cable's hit path — a tap in select mode must accumulate, not clear.
      // A background press defers the cable-selection clear to RELEASE, and only
      // clears if the press was a click (didn't move far) — clearing on
      // pointerdown made it impossible to pan while keeping a cable selected
      // (the press immediately dropped the selection). Mirrors how node
      // selection survives a pan (it only clears on a click / lasso). Standoff
      // and isolate-endpoint selections still clear on pointerdown (unchanged).
      let cablePressStart: { x: number; y: number } | null = null;
      const PRESS_MOVE_TOL = 6; // px — beyond this the press is a pan, not a click
      const clearCableSelection = (e: PointerEvent) => {
        const t = e.target as Element | null;
        if (!t?.closest?.(".solenoid-standoff-hit")) standoffStore.select(null);
        // Isolate endpoint terminals deselect on any press that isn't on one.
        if (!t?.closest?.(".solenoid-iso-ep")) isoEndpointSelect.set(null);
        // A press on a cable's hit path manages its own selection — never clear.
        cablePressStart = t?.closest?.("path.solenoid-cable-hit") ? null : { x: e.clientX, y: e.clientY };
      };
      const maybeClearCableSelection = (e: PointerEvent) => {
        if (!cablePressStart) return;
        const moved = Math.hypot(e.clientX - cablePressStart.x, e.clientY - cablePressStart.y);
        cablePressStart = null;
        if (moved <= PRESS_MOVE_TOL) cableSelectionStore.set(null);
      };
      c.addEventListener("pointerdown", clearCableSelection);
      window.addEventListener("pointerup", maybeClearCableSelection);

      // "Lock canvas" (nav-menu toggle) is view-only, not frozen: it blocks
      // edits but keeps pan and zoom. A class on the container makes nodes,
      // the conduit, and cable hit-paths pointer-events:none (so a press/wheel over
      // them falls through to the area = pan/zoom), while the background area
      // listeners are untouched. See .solenoid-canvas--locked in canvas.css.
      const applyLock = () => c.classList.toggle("solenoid-canvas--locked", canvasLockStore.get());
      applyLock();
      const unsubLock = canvasLockStore.subscribe(applyLock);

      dblClickCleanupRef.current = () => {
        c.removeEventListener("dblclick", swallowDblClick, true);
        c.removeEventListener("pointerdown", clearCableSelection);
        window.removeEventListener("pointerup", maybeClearCableSelection);
        container!.removeEventListener("pointerdown", onPanStart, true);
        window.removeEventListener("pointerup", onPanEnd);
        window.removeEventListener("pointercancel", onPanEnd);
        unsubLock();
      };

      // We wire history keyboard shortcuts ourselves (see the keydown
      // useEffect above) so Ctrl+Shift+Z maps to Redo instead of Undo;
      // `HistoryExtensions.keyboard` matches KeyZ regardless of Shift.
      setEditorRefs(editor, engine, area);
      setCtorRegistryProvider(ctorRegistry);
      editorRef.current = editor;
      areaRef.current = area;
      historyRef.current = history;

      editor.addPipe((ctx) => {
        // Reject a cable that exactly duplicates an existing one — same
        // source socket AND same target socket. Only then do both
        // endpoints coincide, drawing the two cables on top of each
        // other so the second is untraceable. Different target sockets
        // (A vs B, v0 vs v1) have distinct endpoints and stay traceable
        // by location, so those are allowed.
        if (ctx.type === "connectioncreate") {
          const c = ctx.data as unknown as {
            source: string; sourceOutput: string; target: string; targetInput: string;
          };
          // View-only when locked: never create a connection.
          if (canvasLockStore.get()) return; // cancel
          // Reject self-loops universally — a node's output may never feed its
          // own input (catches any path the drag-time veto doesn't).
          if (c.source === c.target) return; // cancel
          const dup = editor.getConnections().some(
            (e) =>
              e.source === c.source && e.sourceOutput === c.sourceOutput &&
              e.target === c.target && e.targetInput === c.targetInput,
          );
          if (dup) return; // cancel the connection

          // Enforce socket-type compatibility (directional). The classic
          // connection preset allows ANY socket pairing, so without this a list
          // output could land in a number slot — the array then flows into a
          // node expecting a scalar and breaks it. canConnectTo also blocks
          // narrowing a 2-D table/frame output into a 1-D/0-D input.
          const srcSocket = editor.getNode(c.source)?.outputs[c.sourceOutput]?.socket;
          const tgtSocket = editor.getNode(c.target)?.inputs[c.targetInput]?.socket;
          if (
            srcSocket instanceof SolenoidSocket &&
            tgtSocket instanceof SolenoidSocket &&
            !srcSocket.canConnectTo(tgtSocket)
          ) {
            return; // cancel — incompatible socket types
          }

          // FC → FC: reject only when BOTH carry units and they conflict — the
          // downstream can't be re-united. (A unitless upstream imposes nothing;
          // a unitless downstream inherits + locks to the upstream's unit.)
          const csrc = editor.getNode(c.source);
          const ctgt = editor.getNode(c.target);
          if (
            csrc instanceof FormatControllerNode && ctgt instanceof FormatControllerNode &&
            c.sourceOutput === "out" && c.targetInput === "in" &&
            csrc.unit !== "none" && ctgt.unit !== "none" && csrc.unit !== ctgt.unit
          ) {
            return; // cancel — conflicting units
          }

          // Collapsed extensible node (e.g. List shown as a pill): the
          // dropped cable hit one of the stacked sockets, which may hold a
          // typed value the user can't see while collapsed. Don't clobber
          // it — reroute the cable to a free input (no literal, no cable),
          // adding a new input if none are free. Uncollapsed, overwriting
          // is fine (the user can see which input they're targeting).
          const tgt = editor.getNode(c.target) as unknown as {
            literals?: Record<string, number>;
            inputs: Record<string, unknown>;
            addValueInput?: () => string;
          } | undefined;
          if (tgt && typeof tgt.addValueInput === "function" && collapseStore.get(c.target)) {
            const conns = editor.getConnections();
            const occupied = (key: string) =>
              tgt.literals?.[key] != null ||
              conns.some((e) => e.target === c.target && e.targetInput === key);
            if (occupied(c.targetInput)) {
              let free = Object.keys(tgt.inputs).find((k) => !occupied(k));
              if (!free) free = tgt.addValueInput();
              c.targetInput = free;
              void area.update("node", c.target);
            }
          }
        }
        if (ctx.type === "nodecreated") {
          const n = ctx.data as object;
          if (n instanceof FormatControllerNode && !isGraphRebuilding()) n.dockSelf(editor);
          if (n instanceof GroupNode) { sendGroupToBack(area, (n as GroupNode).id); rebuildGroupMembership(editor); }
          else if (!isGraphRebuilding()) {
            // A node created (LIVE) fully inside a group's box joins it — Add menu,
            // paste, docked FCs. Suppressed during a load/seed rebuild, where every
            // node fires `nodecreated` and membership comes from the saved list;
            // otherwise a reload would swallow any node merely overlapping a group.
            // Deferred so the new node's final position + size are measured first.
            const newId = (n as { id: string }).id;
            requestAnimationFrame(() => requestAnimationFrame(() => {
              if (absorbIntoContainingGroup(editor, area, newId)) {
                rebuildGroupMembership(editor);
                syncGroupCollapse(editor, area);
                scheduleAutosave();
              }
            }));
          }
        }
        if (ctx.type === "noderemoved") {
          const n = ctx.data as object;
          // A verb node holds a backend frame ref; free it so the handle store
          // doesn't keep the deleted node's frame (independent frames → safe).
          // Filter also owns a second ref for its Dropped output.
          dropFrameRef((n as { _ref?: unknown })._ref);
          dropFrameRef((n as { _refDropped?: unknown })._refDropped);
          // Deleting the node behind an open report/presentation must tear the
          // overlay state down with it — a DOCKED report otherwise leaves
          // `html.sol-report-docked` (the canvas squeeze) on the root forever,
          // with the only undock button inside the now-unrenderable panel. Also
          // runs per-node during a wholesale rebuild, so a document switch
          // clears both stores too.
          const removedId = (n as { id: string }).id;
          if (reportStore.openNodeId() === removedId) reportStore.close();
          if (presentationStore.activeId() === removedId) presentationStore.stop();
          if (n instanceof FormatControllerNode) n.undock();
          // Release any FCs docked to the removed node: their host is gone, so
          // leave them as free WIRED FCs. Otherwise they keep a stale hostNodeId
          // and adaptTypeFromConnections resolves type from the missing host
          // (→ "any") instead of the cable that survives a splice (e.g. delete a
          // Display between TODAY and its docked FC — the FC must re-adopt date
          // from the restored TODAY→FC cable, not stay stuck on the default).
          for (const rel of dockedNodeStore.getDockedTo((n as { id: string }).id)) {
            const docked = editor.getNode(rel.id);
            if (docked instanceof FormatControllerNode) docked.undock();
          }
          // Drop a deleted node from any group that contained it.
          dropFromGroups(editor, (n as { id: string }).id);
          standoffStore.removeForNode((n as { id: string }).id);
          // Forget the node's id-keyed UI state (collapse, size, cable values,
          // exit angles) so it doesn't linger until the next reload. Every
          // node-keyed store self-registers — see nodeStoreRegistry. Skipped
          // during a wholesale rebuild: it scans some stores per node (O(nodes ×
          // entries) over a big clear); rebuildGraph calls forgetAllNodes() once.
          if (!isGraphRebuilding()) forgetNode((n as { id: string }).id);
          // The group-membership rebuild + collapse re-sync + push restore are
          // O(nodes) each; during a wholesale rebuild (load / seed / switching
          // documents) `rebuildGraph` removes every node one at a time and then
          // does all three ONCE at the end, so running them per-removal is the
          // dominant cost of clearing a big graph (e.g. deleting the open
          // Personal Finance doc). Skip them while rebuilding.
          if (!isGraphRebuilding()) {
            rebuildGroupMembership(editor);
            syncGroupCollapse(editor, area);
            // Deleting an expanded group releases its neighbourhood: any push it
            // contributed to is now "settled" and slides back (unless moved since).
            if (n instanceof GroupNode) restoreSettledPushes(editor, area);
          }
        }
        if (ctx.type === "connectioncreated" || ctx.type === "connectionremoved") {
          // ALL of this per-connection settling — Convert arrow sync, the FC
          // adapt/refresh sweep, the version bump, mismatch rescan, processGraph
          // and collapse re-sync — is O(connections × nodes) when run once per
          // cable. During a wholesale rebuild (load / seed / switching or
          // deleting a document) `rebuildGraph` adds/removes every cable one at a
          // time and then does the equivalents ONCE at the end (syncUnitArrows,
          // dockSelf + refreshAnnotation, rebuildGroupMembership, processGraph
          // whose cableValueStore.bump re-renders cables, syncGroupCollapse), so
          // doing it per-cable here is the dominant cost of loading/clearing a
          // big graph. Skip the whole sweep while rebuilding.
          if (!isGraphRebuilding()) {
            // Re-adapt every FC's socket type to its (possibly changed) upstream and
            // re-project annotations (also refreshes Convert unit arrows). Shared
            // with the Note-retype path so type propagation is identical everywhere.
            reconcileFcTypes(editor, area);
            bumpConnectionVersion();
            rescanMismatches();
            // TARGETED recompute (audit finding 40): one cable only invalidates
            // its TARGET's downstream closure — the bare processGraph() here
            // reset every engine cache and re-rendered every node (each
            // unrelated Polars chain re-collected) for wiring one scalar. The
            // `topology` flag refreshes the loop cache, the one global a cable
            // change touches. A vanished target (cables removed as part of a
            // node delete) falls back to the full pass.
            const cable = ctx.data as { source?: string; target?: string };
            if (cable.target && editor.getNode(cable.target)) {
              void processGraph(cable.target, undefined, { topology: true });
              // The source keeps its value, but its socket/annotation chrome can
              // change with the cable — re-render just that card.
              if (cable.source && editor.getNode(cable.source)) void area.update("node", cable.source);
            } else {
              void processGraph(undefined, undefined, { topology: true });
            }
            // Topology changed → recompute which members/cables a collapsed group hides.
            syncGroupCollapse(editor, area);
          } else {
            // A gated bulk op (paste, undo/redo of a multi-cable action) changed
            // topology — flag it so withGraphRebuild runs ONE settle at the end
            // instead of this per-cable sweep firing N times (O(cables × nodes)).
            markBulkTopoDirty();
          }
        }
        // (FC→FC unit sync/lock is handled in refreshAnnotation, which the
        // connectioncreated/removed branch above runs for every FC — a
        // forwarding FC mirrors and locks its upstream's unit there.)
        if (ctx.type === "connectionremoved") {
          socketHighlightStore.setCableHover([]);
          const removedId = (ctx.data as { id: string }).id;
          // Side-store cleanup so we don't leak ghost / selection
          // entries for connections that no longer exist.
          cableGhostStore.commit(removedId);
          cableSelectionStore.remove(removedId);
          // Cutting the cable that GLUES a docked FC to its host dissolves the dock
          // (undock: stop following, clear the annotation, forget the host) — it
          // otherwise kept trailing the host and re-docked on every load. Skipped
          // while rebuilding: a bulk load/undo replays cable removals wholesale and
          // must not strip dock state the rebuild is about to restore. (The rehome
          // flow's removeFcInline also lands here — harmless: dockSelf re-docks it
          // one await later.)
          if (!isGraphRebuilding()) {
            const cc = ctx.data as { source: string; target: string };
            for (const end of [cc.source, cc.target]) {
              const fc = editor.getNode(end);
              if (!(fc instanceof FormatControllerNode) || !fc.hostNodeId) continue;
              if ((end === cc.source ? cc.target : cc.source) === fc.hostNodeId) {
                fc.undock();
                void area.update("node", fc.id);
              }
            }
          }
        }
        return ctx;
      });

      // NOTE: we deliberately do NOT promote the holder to a GPU layer for PAN.
      // Promoting it made collapsed pan smooth but the holder surface is larger
      // than the mobile GPU max texture, so the layer tiles and re-rasterizes as
      // a translate reveals new tiles — which flickered the visible heavy content
      // (recharts/cards) when a group was expanded. Pan relies on culling instead
      // (few elements painted → cheap un-layered repaint). Zoom is the exception:
      // it gets a transient layer for the pinch only (see onZoomActivity below),
      // because a bounded scale stays within already-rastered tiles.

      // Zoom is choppier than pan: scaling re-rasterizes vector content every
      // frame. On DESKTOP we give the holder a `will-change: transform` GPU layer
      // for the duration of the pinch, so the scale runs as a cheap GPU scale of
      // the cached bitmap (smooth, slightly soft) instead of a per-frame vector
      // re-raster, then drop it on settle to re-rasterize crisp.
      //
      // NOT on mobile: the holder (whole graph) is larger than the mobile GPU max
      // texture, so promoting it tiles and re-rasterizes erratically during the
      // pinch — visible flicker/redraws of the heavy content. (This was tolerable
      // while culling kept only a few nodes mounted; with culling removed the
      // layer must rasterize everything, so the tiling flicker returns.) Mobile
      // zoom stays un-layered: a touch choppier, but stable. Pan never promotes
      // either (a translate continuously reveals un-rastered tiles).
      const holderEl = area.area.content.holder as HTMLElement;

      // Frame-rate probe for pan/zoom (the render-only path — no processGraph
      // runs, so the in-app `__solenoidPerf` compute/render log says nothing about
      // it). Off by default; turn on from devtools with `window.__solenoidPerf =
      // true`, then pan or zoom — on gesture end it logs frames, mean frame time /
      // fps, the worst frame, and the dropped-frame count (>16.7ms = below 60fps).
      // A single rAF sampler shared by pan + zoom; concurrent triggers coalesce.
      const fpsProbe = (() => {
        let raf = 0, last = 0, label = "", active = false;
        let samples: number[] = [];
        const tick = (t: number) => {
          if (last) samples.push(t - last);
          last = t;
          raf = requestAnimationFrame(tick);
        };
        return {
          start(l: string) {
            if (!(globalThis as { __solenoidPerf?: boolean }).__solenoidPerf || active) return;
            active = true; label = l; last = 0; samples = [];
            raf = requestAnimationFrame(tick);
          },
          stop() {
            if (!active) return;
            active = false;
            cancelAnimationFrame(raf);
            if (samples.length < 2) return;
            const s = [...samples].sort((a, b) => a - b);
            const mean = s.reduce((a, b) => a + b, 0) / s.length;
            const dropped = s.filter((d) => d > 16.7).length;
            // eslint-disable-next-line no-console
            console.log(
              `[perf] ${label} gesture: ${s.length} frames  ` +
              `mean=${mean.toFixed(1)}ms (${(1000 / mean).toFixed(0)}fps)  ` +
              `worst=${s[s.length - 1].toFixed(1)}ms  ` +
              `dropped(>16.7ms)=${dropped} (${Math.round((100 * dropped) / s.length)}%)`,
            );
          },
        };
      })();

      let zoomSettleTimer = 0;
      let zooming = false;
      // Settle window before the zoom layer drops. Wheel zoom is NOTCHY — deliberate
      // notch-by-notch ticks often arrive slower than a pan-tuned ~160ms timer, and
      // every promote↔demote flip re-creates the compositor layer + re-rasters the
      // whole holder at the new scale; the frame where the fresh layer's tiles aren't
      // rastered yet is the reported "cables flash during zoom" (thin strokes blink
      // hardest). Hold the layer through notch pauses and pay ONE demote/re-raster at
      // the true settle. Same constant + reasoning as HtmlCanvasLayer's
      // ZOOM_SETTLE_MS — the GPU renderer had the identical thrash on its gesture
      // timer (dev-notes 2026-07-20d).
      const ZOOM_SETTLE_MS = 420;
      function onZoomActivity() {
        if (IS_MOBILE) return;
        // Promote the holder for the pinch so the scale is a cheap GPU bitmap-scale.
        // Note: do NOT also drop raster quality here — desktop zoom is PROMOTED, so
        // the content is rasterized once and scaled, not re-rastered per frame; the
        // quality drops save nothing and toggling them forces extra re-rasters + a
        // box-shadow transition that made desktop zoom WORSE. Quality drops live on
        // the un-promoted paths only (--panning: pan + mobile pinch).
        if (!zooming) {
          zooming = true;
          holderEl.style.willChange = "transform";
        }
        fpsProbe.start("zoom");
        if (zoomSettleTimer) clearTimeout(zoomSettleTimer);
        zoomSettleTimer = window.setTimeout(() => {
          zooming = false;
          zoomSettleTimer = 0;
          holderEl.style.willChange = "";
          fpsProbe.stop();
        }, ZOOM_SETTLE_MS);
      }

      // Keep the dot-grid background in sync with area zoom/pan.
      function syncBackground() {
        const { x, y, k } = area.area.transform;
        const size = DOT_SPACING * k;
        container!.style.backgroundSize = `${size}px ${size}px`;
        container!.style.backgroundPosition = `${x}px ${y}px`;
        // Feed the parked WGSL render overlay only when it's actually mounted (canvas
        // mode) — DOM + html modes don't use overlayBus, so this stays a no-op there.
        if (renderModeStore.get() === "canvas") overlayBus.setTransform(x, y, k);
        // Fade the dots out as the grid shrinks (zoomed out) so it doesn't read
        // as a dense, distracting texture: full from k≈0.55 up, gone by k≈0.18.
        const fade = Math.max(0, Math.min(1, (k - 0.18) / (0.55 - 0.18)));
        container!.style.setProperty("--dot-pct", `${Math.round(fade * 100)}%`);
      }

      // Reposition every node docked to `hostId` against its current socket
      // position. Called when the host moves (nodetranslated) and when it
      // resizes (NodeCard ResizeObserver → repositionDockedNodes), so a docked
      // FC follows a socket that shifts because a list display box grew a row.
      function repositionDockedTo(hostId: string) {
        for (const rel of dockedNodeStore.getDockedTo(hostId)) {
          const dockedNode = editor.getNode(rel.id);
          if (!dockedNode) continue;
          // A SELECTED docked FC is moved by the selection drag itself. Repositioning
          // it here too creates a translate feedback loop with the multi-drag
          // follow (host moves FC → FC translate → selector moves host → …) that
          // hangs the app. Leave it to the drag; it re-snaps to its host on drop.
          if ((dockedNode as { selected?: boolean }).selected) continue;
          const { w, h } = dockedRenderedDims(area, rel.id, dockedNode.width, dockedNode.height);
          const pos = computeDockedCanvasPos(
            area, c, rel.hostNodeId, rel.socketKey, rel.side, w, h,
          );
          // Use area.translate (not a raw DOM transform): it updates Rete's
          // tracked node position, which the connection renderer reads — so an
          // inline FC's cables follow it instead of anchoring at the origin.
          // Trade-off: a one-frame lag behind a fast host drag (acceptable).
          if (pos) void area.translate(rel.id, pos);
        }
      }
      setRepositionDocked(repositionDockedTo);

      // Which group (if any) the user is actively dragging. Move-together must
      // only react to a real header drag — not the programmatic translates from
      // group creation, load, or docking (those would shove members far away).
      let draggingGroupId: string | null = null;

      // Carrying a group's members along is O(members) — each is an async
      // area.translate that re-routes its cables. `nodetranslated` fires once per
      // `pointermove`, and a high-polling mouse emits those far faster than the
      // display refreshes, so the member loop would run hundreds of times/sec and
      // make a big group drag choppy (a single node, with no followers, stays
      // smooth). Coalesce the deltas and apply them to members at most once per
      // animation frame, decoupling the cost from pointer-event rate.
      let pendingGroup: GroupNode | null = null;
      let pendingDX = 0, pendingDY = 0, memberMoveRaf = 0;
      const flushMemberMove = () => {
        if (memberMoveRaf) { cancelAnimationFrame(memberMoveRaf); memberMoveRaf = 0; }
        const g = pendingGroup, dx = pendingDX, dy = pendingDY;
        pendingGroup = null; pendingDX = 0; pendingDY = 0;
        // skipSelected: a member that's also in the selection is already moved by
        // rete's selector during the drag — moving it again here would double it.
        if (g && (dx !== 0 || dy !== 0)) moveGroupMembers(editor, area, g, dx, dy, true);
      };
      const scheduleMemberMove = (group: GroupNode, dx: number, dy: number) => {
        pendingGroup = group; pendingDX += dx; pendingDY += dy;
        if (!memberMoveRaf) memberMoveRaf = requestAnimationFrame(() => { memberMoveRaf = 0; flushMemberMove(); });
      };

      // Live standoff settle, rAF-throttled. The solver is a full solve from
      // current positions and worst-case O(network²); it used to run on EVERY
      // `nodetranslated` (per pointermove, faster than the refresh rate). Since
      // each run reads the latest boxes, collapsing many pointer events into one
      // solve per frame converges to the same towed positions — you can't see
      // faster than a frame anyway — and the exact final settle still runs on
      // drop (`nodedragged`). Only active when standoffs exist.
      let standoffSettleRaf = 0;
      let pendingStandoffPinned: Set<string> | null = null;
      const scheduleStandoffSettle = (pinned: Set<string>) => {
        pendingStandoffPinned = pinned;
        if (standoffSettleRaf) return;
        standoffSettleRaf = requestAnimationFrame(() => {
          standoffSettleRaf = 0;
          const p = pendingStandoffPinned; pendingStandoffPinned = null;
          if (p) settleStandoffNetwork(p);
        });
      };
      // The bar/endpoint repaint tick, rAF-coalesced for the same reason: each
      // bump makes StandoffLayer re-measure every tied node (2 forced reflows
      // per bar) and IsolateEndpoints re-query its terminals. Per-pointermove
      // bumps run faster than the refresh rate for zero visual gain.
      let standoffTickRaf = 0;
      const scheduleStandoffTickBump = () => {
        if (standoffTickRaf) return;
        standoffTickRaf = requestAnimationFrame(() => {
          standoffTickRaf = 0;
          standoffLayoutTick.bump();
        });
      };
      // Position at pick time, to tell a real drag from a plain click on
      // `nodedragged` (rete emits it on every pointerup after a pick, moved
      // or not).
      let pickedPos: { x: number; y: number } | null = null;

      // The pointer-driven node of the current drag (cleared on drop). Live
      // standoff chain-pull keys off it so programmatic translates — push,
      // restore, ELK, the settle itself — never trigger a re-solve.
      let dragPickId: string | null = null;

      // Node elements given a transient GPU layer for the duration of a drag, so
      // moving a heavy node (chart / big table) is a cheap compositor translate
      // instead of a per-frame repaint. Bounded to the moving set (picked +
      // selected), NOT the whole holder — so it sidesteps the holder-size /
      // GPU-max-texture wall that forbids holder promotion (see the pan note
      // above). Promoted on `nodepicked`, cleared on `nodedragged`.
      let dragPromotedEls: HTMLElement[] = [];
      const promoteDragLayers = (pickedId: string) => {
        clearDragLayers();
        const ids = new Set<string>([pickedId]);
        for (const n of editor.getNodes()) {
          if ((n as { selected?: boolean }).selected) ids.add(n.id);
        }
        // A runaway selection isn't worth N layers — fall back to repaint.
        if (ids.size > 32) return;
        for (const id of ids) {
          const el = area.nodeViews.get(id)?.element;
          if (el) { el.style.willChange = "transform"; dragPromotedEls.push(el); }
        }
      };
      function clearDragLayers() {
        for (const el of dragPromotedEls) el.style.willChange = "";
        dragPromotedEls = [];
      }

      // Pan telemetry only. The former gesture-time quality/paint cuts (the
      // `--panning` class) were removed 2026-07-04 — DOM mode stays full-quality
      // while panning; the HTML-in-canvas renderer is the performance path. fpsProbe
      // still brackets the gesture for the perf overlay.
      const onPanStart = () => { fpsProbe.start("pan"); };
      const onPanEnd = () => { fpsProbe.stop(); };
      container!.addEventListener("pointerdown", onPanStart, true);
      window.addEventListener("pointerup", onPanEnd);
      window.addEventListener("pointercancel", onPanEnd);

      area.addPipe((ctx) => {
        if (ctx.type === "translated" || ctx.type === "zoomed") {
          syncBackground();
          if (ctx.type === "zoomed") syncSemanticZoomFor(area.area.transform.k);
          // A pinch gets a transient GPU layer on the holder for the gesture
          // (see onZoomActivity); a plain pan needs nothing. Only REAL zoomed
          // events refresh the settle timer — with the longer ZOOM_SETTLE_MS, a
          // translated-refresh would keep the holder promoted through a follow-on
          // pan indefinitely (the tile-reveal flicker the promotion NOTE above
          // exists to avoid); a pinch's interleaved translates are covered because
          // its zoomed events keep arriving within the window.
          if (ctx.type === "zoomed") onZoomActivity();
        }
        // Node re-renders can change box sizes (collapse toggles, growing list
        // displays) — keep the standoff bars measured against fresh boxes.
        if (ctx.type === "rendered") { standoffLayoutTick.bump(); }
        // Node geometry changed → tell the WebGPU node-card layer to re-read rects.
        // Deliberately NOT on "rendered": the card layer reads offsetWidth (a forced
        // layout), and reacting to "rendered" makes that reflow re-trigger rete's
        // ResizeObserver → another "rendered" → an infinite loop. Move/add/remove are
        // discrete gestures with no such feedback; pan/zoom isn't a geometry change.
        if (ctx.type === "nodetranslated" || ctx.type === "nodecreated" || ctx.type === "noderemoved") {
          nodeGeomBus.notify();
        }
        if (ctx.type === "nodepicked") {
          cableSelectionStore.set(null);
          standoffStore.select(null);
          dragPickId = ctx.data.id;
          promoteDragLayers(ctx.data.id);
          // Pick history for Ctrl-align: remember the node grabbed before this one.
          if (lastPickedRef.current !== ctx.data.id) {
            prevPickedRef.current = lastPickedRef.current;
            lastPickedRef.current = ctx.data.id;
          }
          const picked = editor.getNode(ctx.data.id);
          draggingGroupId = picked instanceof GroupNode ? ctx.data.id : null;
          const pp = area.nodeViews.get(ctx.data.id)?.position;
          pickedPos = pp ? { x: pp.x, y: pp.y } : null;
          // If the picked node is docked, sync Rete's internal position
          // from the current DOM transform before undocking so the drag
          // starts from the correct canvas position (not the stale position
          // Rete stored before we started doing direct DOM mutations).
          const rel = dockedNodeStore.get(ctx.data.id);
          if (rel) {
            const view = area.nodeViews.get(ctx.data.id);
            if (view) {
              const m = view.element.style.transform.match(
                /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/,
              );
              if (m) void area.translate(ctx.data.id, { x: parseFloat(m[1]), y: parseFloat(m[2]) });
            }
            dockedNodeStore.undock(ctx.data.id);
          }
          // Keep a docked FC painting above its host. simpleNodesOrder (runs in
          // an earlier pipe) just moved the picked node to the DOM end, so if the
          // host was picked it now covers its FC. Re-append the FC(s) after it.
          // (Picking the FC itself already lands it on top.)
          for (const d of dockedNodeStore.getDockedTo(ctx.data.id)) {
            const v = area.nodeViews.get(d.id);
            if (v) void area.area.content.reorder(v.element, null);
          }
        }
        // Shift = constrain the drag to an axis. The pre-event lets us rewrite
        // the intended position before it's applied (node-view reads data.position
        // after this pipe). We project the offset-from-origin onto the nearest of
        // horizontal / vertical (and the two diagonals, but only past a medium
        // distance so an initial wobble doesn't snap to 45°).
        if (ctx.type === "nodetranslate" && ctx.data.id === dragPickId && pickedPos && shiftDragRef.current) {
          const o = pickedPos;
          const p = ctx.data.position;
          const dx = p.x - o.x, dy = p.y - o.y;
          const DIAG_MIN = 48; // px from origin before diagonals are offered
          const lines: ReadonlyArray<readonly [number, number]> =
            Math.hypot(dx, dy) >= DIAG_MIN
              ? [[1, 0], [0, 1], [Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2]]
              : [[1, 0], [0, 1]];
          let bx = 1, by = 0, best = -Infinity;
          for (const [ax, ay] of lines) {
            const pr = Math.abs(dx * ax + dy * ay);
            if (pr > best) { best = pr; bx = ax; by = ay; }
          }
          const proj = dx * bx + dy * by;
          ctx.data.position = { x: o.x + proj * bx, y: o.y + proj * by };
        }
        // Ctrl/Cmd = align the dragged node's edges to the previously grabbed
        // object (which is deselected, so it stays put). Snap each axis
        // independently to the nearest matching edge within a small threshold.
        if (
          ctx.type === "nodetranslate" && ctx.data.id === dragPickId &&
          ctrlDragRef.current && !shiftDragRef.current && prevPickedRef.current
        ) {
          const bId = prevPickedRef.current;
          const aNode = editor.getNode(ctx.data.id) as unknown as { width: number; height: number } | undefined;
          const bNode = editor.getNode(bId) as unknown as { width: number; height: number; selected?: boolean } | undefined;
          const bv = area.nodeViews.get(bId);
          if (aNode && bNode && bv && bId !== ctx.data.id && !bNode.selected) {
            const ALIGN = 8; // world-px snap threshold
            const snapAxis = (cur: number, aSize: number, bStart: number, bSize: number): number => {
              const offs = [0, aSize];                         // A: left/right (or top/bottom) edges only
              const lines = [bStart, bStart + bSize];          // B: left/right (or top/bottom) edges only
              let bestPos = cur, bestD = ALIGN;
              for (const off of offs) for (const ln of lines) {
                const cand = ln - off;
                const d = Math.abs(cur - cand);
                if (d < bestD) { bestD = d; bestPos = cand; }
              }
              return bestPos;
            };
            ctx.data.position = {
              x: snapAxis(ctx.data.position.x, aNode.width, bv.position.x, bNode.width),
              y: snapAxis(ctx.data.position.y, aNode.height, bv.position.y, bNode.height),
            };
          }
        }
        // Synchronously reposition any nodes docked to the translated node.
        // Direct DOM mutation in the same pipe call as the host's translation
        // keeps both nodes in the same paint frame with no async lag.
        if (ctx.type === "nodetranslated") {
          repositionDockedTo(ctx.data.id);
          // Dragging a group's header carries its members along by the same
          // delta — but only during an actual user drag (see draggingGroupId).
          const moved = editor.getNode(ctx.data.id);
          if (moved instanceof GroupNode && ctx.data.id === draggingGroupId) {
            const { position, previous } = ctx.data as { position: { x: number; y: number }; previous: { x: number; y: number } };
            scheduleMemberMove(moved, position.x - previous.x, position.y - previous.y);
          }
          // Live standoff chain-pull: dragging a linked item tows its partners
          // once a band goes taut (and shoves them at the minimum). Pin the
          // whole dragged selection so the solver only moves the others.
          // Gated on the dragged selection actually TOUCHING a tie: ties are
          // sparse (each Note to its group), and running the settle — which
          // force-reflows every tied node's box — on every pointermove made
          // plain node drags jank once the PF seed grew to 11 ties.
          if (ctx.data.id === dragPickId && !standoffSolving && !standoffStore.isEmpty()) {
            const parts = standoffStore.participants();
            const pinned = new Set<string>([ctx.data.id]);
            let touchesTie = parts.has(ctx.data.id);
            for (const n of editor.getNodes()) {
              if ((n as { selected?: boolean }).selected) {
                pinned.add(n.id);
                if (parts.has(n.id)) touchesTie = true;
              }
            }
            if (touchesTie) scheduleStandoffSettle(pinned);
          }
          // Repaint the bar/endpoint layer only when something it draws moved:
          // a standoff end, or any node while isolate shows its terminals.
          if (standoffStore.participants().has(ctx.data.id) || isolateStore.isActive()) {
            scheduleStandoffTickBump();
          }
        }
        // Dragging an FC (nodepicked already dropped it from the follow set):
        //  • onto a DIFFERENT socket → re-home (re-splice into that host),
        //  • essentially back onto its own socket → re-glue (resume following),
        //  • out into empty space → stay undocked where dropped, keeping its
        //    cables and annotation. Drag-away undocks but never breaks wiring.
        if (ctx.type === "nodedragged") {
          // Drop the transient drag layers (re-rasterizes each node crisp in place).
          clearDragLayers();
          // Apply any rAF-coalesced member follow immediately so the drop's exact
          // positions are settled before membership reconcile / autosave below.
          flushMemberMove();
          // Snap-to-grid (on release): round the dragged node to the nearest grid
          // point (dots + half sub-grid). The lead node is still selected, so
          // area.translate group-moves the rest of the selection by the same
          // delta — relative layout is preserved. Skip groups (their members
          // wouldn't follow) and docked FCs (they reposition to their socket).
          if (gridSnapStore.get() && ctx.data.id === dragPickId) {
            const dn = editor.getNode(ctx.data.id);
            const dv = area.nodeViews.get(ctx.data.id);
            if (dv && dn && !(dn instanceof FormatControllerNode)) {
              // If the dropped node is in a STANDOFF CLUSTER, snap the whole
              // cluster as a rigid block to a DETERMINISTIC anchor (its top-left
              // member), not the dropped node. A locked standoff fixes the
              // members' relative geometry, so snapping one node to grid fights the
              // angle — and snapping whichever node was clicked oscillates the
              // cluster on every click (the bug). A uniform translation preserves
              // the angle (the post-drop settle becomes a no-op) AND is idempotent:
              // the anchor lands on grid once, then every re-click is a no-op.
              const cluster = standoffStore.isEmpty()
                ? undefined
                : standoffClusters(standoffStore.all()).find((c) => c.includes(ctx.data.id));
              if (cluster) {
                const posOf = (id: string) => area.nodeViews.get(id)?.position ?? { x: 0, y: 0 };
                const anchorId = [...cluster].sort((a, b) => {
                  const pa = posOf(a), pb = posOf(b);
                  return pa.y - pb.y || pa.x - pb.x || (a < b ? -1 : 1);
                })[0];
                const ap = posOf(anchorId);
                const ddx = snapCoord(ap.x) - ap.x, ddy = snapCoord(ap.y) - ap.y;
                if (ddx !== 0 || ddy !== 0) {
                  // Move every cluster member, plus the members of any group in it.
                  const toMove = new Set(cluster);
                  for (const id of cluster) {
                    const n = editor.getNode(id);
                    if (n instanceof GroupNode) for (const m of n.members) toMove.add(m);
                  }
                  for (const id of toMove) {
                    const v = area.nodeViews.get(id);
                    if (v) void area.translate(id, { x: v.position.x + ddx, y: v.position.y + ddy });
                  }
                }
              } else {
                const sx = snapCoord(dv.position.x);
                const sy = snapCoord(dv.position.y);
                const ddx = sx - dv.position.x, ddy = sy - dv.position.y;
                if (ddx !== 0 || ddy !== 0) {
                  void area.translate(ctx.data.id, { x: sx, y: sy });
                  // A group carries its members by the same delta. The snap's
                  // area.translate on the still-picked lead already moved any SELECTED
                  // members via the selector, so skip them (avoid the double-move).
                  if (dn instanceof GroupNode) moveGroupMembers(editor, area, dn, ddx, ddy, true);
                }
              }
            }
          }
          scheduleAutosave(); // persist the new position (drag end, once)
          // Final standoff settle for the drop (throttled mid-drag solves can
          // leave a residual violation). Cancel any pending rAF settle first so
          // it can't fire after the drop with a stale pinned set.
          if (standoffSettleRaf) { cancelAnimationFrame(standoffSettleRaf); standoffSettleRaf = 0; pendingStandoffPinned = null; }
          if (ctx.data.id === dragPickId) {
            const pinned = new Set<string>([ctx.data.id]);
            for (const n of editor.getNodes()) {
              if ((n as { selected?: boolean }).selected) pinned.add(n.id);
            }
            settleStandoffNetwork(pinned);
          }
          dragPickId = null;
          // Hybrid group membership: a node dragged into/out of a group's box
          // joins/leaves it. (No-op for groups themselves.)
          draggingGroupId = null;
          reconcileGroupMembership(editor, area, ctx.data.id);
          rebuildGroupMembership(editor);
          syncGroupCollapse(editor, area);
          const dragged = editor.getNode(ctx.data.id);
          // A manual move of a group OR a loose node breaks the spatial
          // assumptions behind any expand-time push it caused or received — stop
          // auto-restoring it. (Loose nodes are now push targets too.) Only a
          // drag that actually MOVED the node counts: rete fires `nodedragged`
          // on every pointerup after a pick, so a plain click (select a group
          // before collapsing it, select a Conduit to inspect its lanes) must
          // NOT wipe the push records — that left pushed nodes stranded because
          // the restore-on-collapse found nothing to restore.
          const endPos = area.nodeViews.get(ctx.data.id)?.position;
          const draggedFar = !pickedPos || !endPos ||
            Math.abs(endPos.x - pickedPos.x) > 1 || Math.abs(endPos.y - pickedPos.y) > 1;
          if (draggedFar) groupPushStore.invalidateGroup(ctx.data.id);
          pickedPos = null;
          if (dragged instanceof FormatControllerNode) {
            const target = findDockTarget(area, editor, dragged);
            const reHome = !!target && (
              target.hostNodeId !== dragged.hostNodeId ||
              target.socketKey  !== dragged.socketKey  ||
              target.side       !== dragged.side
            );
            if (reHome && target) {
              void (async () => {
                await removeFcInline(editor, dragged);          // un-splice from old host
                dragged.hostNodeId = target.hostNodeId;
                dragged.socketKey  = target.socketKey;
                dragged.side       = target.side;
                dragged.dockSelf(editor);                       // register dock + new annotation + type
                const dims = dockedRenderedDims(area, dragged.id, dragged.width, dragged.height);
                const pos = computeDockedCanvasPos(
                  area, c, dragged.hostNodeId, dragged.socketKey, dragged.side,
                  dims.w, dims.h,
                );
                if (pos) await area.translate(dragged.id, pos);
                await insertFcInline(editor, dragged);          // splice into the new host
                await processGraph();
              })();
            } else if (target) {
              // Dropped (near) its own socket → re-glue and snap flush.
              dragged.dockSelf(editor);
              const dims = dockedRenderedDims(area, dragged.id, dragged.width, dragged.height);
              const pos = computeDockedCanvasPos(
                area, c, dragged.hostNodeId, dragged.socketKey, dragged.side,
                dims.w, dims.h,
              );
              if (pos) void area.translate(dragged.id, pos);
            }
            // else (no nearby socket): leave it undocked where dropped — it keeps
            // its inline cables and its annotation; it just no longer follows.
            // MUST also forget the dock identity: dragstart only cleared the STORE
            // entry, and a stale hostNodeId persists into the save, where the
            // load-time dockSelf() would re-dock it to the old host.
            else dragged.releaseDock();
          }
        }
        return ctx;
      });

      // Mismatch rescan helper — called on cable events AND annotation changes.
      function rescanMismatches() {
        for (const n of editor.getNodes()) {
          if (!(n instanceof FormatControllerNode)) continue;
          // The FC annotates its upstream socket (the node feeding FC.in).
          const mine = n.annotatedSocket();
          if (!mine) { formatMismatchStore.setMismatch(n.id, false); continue; }
          const myAnn = formatAnnotationStore.get(mine.nodeId, mine.socketKey);
          if (!myAnn || myAnn.unit === "none") { formatMismatchStore.setMismatch(n.id, false); continue; }
          let hasMismatch = false;
          for (const conn of editor.getConnections()) {
            const srcKey = `${conn.source}::${conn.sourceOutput}`;
            const tgtKey = `${conn.target}::${conn.targetInput}`;
            const myKey  = `${mine.nodeId}::${mine.socketKey}`;
            const other  = srcKey === myKey ? tgtKey : tgtKey === myKey ? srcKey : null;
            if (!other) continue;
            // Use lastIndexOf to correctly split nodeId::socketKey
            // even if nodeId itself contains "::".
            const sep         = other.lastIndexOf("::");
            const otherNodeId = other.slice(0, sep);
            const otherSockKey = other.slice(sep + 2);
            const otherAnn = formatAnnotationStore.get(otherNodeId, otherSockKey);
            if (otherAnn && !unitsCompatible(myAnn.unit, otherAnn.unit)) { hasMismatch = true; break; }
          }
          formatMismatchStore.setMismatch(n.id, hasMismatch);
        }
      }
      // Also rescan whenever a Format Controller changes its annotation.
      unsubFmt = formatAnnotationStore.subscribe(rescanMismatches);

      // Single settle for a BULK topology change (paste, etc.). The caller gates
      // its add loop with begin/endGraphRebuild so the per-cable `connectioncreated`
      // sweep above is skipped; this runs the equivalent ONCE. Same steps the
      // per-cable branch runs — registered so copyPaste can reuse it without
      // duplicating the FC/mismatch/collapse closures. (See process.ts bulkSettle.)
      setBulkSettle(async (renderOnly?: Set<string>) => {
        reconcileFcTypes(editor, area);
        bumpConnectionVersion();
        rescanMismatches();
        await processGraph(undefined, renderOnly);
        syncGroupCollapse(editor, area);
      });

      // Persist the live graph into the current document after edits, and restore
      // the documents library on startup so work survives a reload. New / Open /
      // templates all go through documentStore directly (see DocumentTitle).
      setGraphChanged(() => { scheduleAutosave(); });
      if (await documentStore.restore()) {
        syncBackground();
        syncSemanticZoomFor(area.area.transform.k);
        return;
      }

      // Fresh user: no library and nothing to migrate — seed the first document.
      await ensureFirstDocument();
      syncBackground();
      syncSemanticZoomFor(area.area.transform.k);
    }

    init();

    return () => {
      destroyed = true;
      unsubFmt?.();
      dblClickCleanupRef.current?.();
      dblClickCleanupRef.current = null;
      standoffRootRef.current?.unmount();
      standoffRootRef.current = null;
      isoEndpointsRootRef.current?.unmount();
      isoEndpointsRootRef.current = null;
      localArea?.destroy();
      container.innerHTML = "";
      editorRef.current = null;
      areaRef.current = null;
      historyRef.current = null;
    };
  }, []);

  // Right-click handling. Attached natively (not via React's onContextMenu)
  // because nodes render in a SEPARATE React root (see CLAUDE.md) — a synthetic
  // handler on the wrapper doesn't reliably resolve `e.target` into the node
  // DOM, so socket/node hits fell through and the Add menu opened everywhere.
  // Routing (socket / cable / node / blank) lives in canvasContextMenu.ts.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    return installCanvasContextMenu({
      el, editorRef, areaRef, setSocketCtx, setCableCtx, setNodeCtx,
      openAddMenu: (screenX, screenY) => setMenu({ screenX, screenY }),
    });
  }, []);

  // Isolate overlay: non-focus nodes recede (dim + non-interactive); the focus
  // set is re-centered on enter; node positions are SNAPSHOT on enter and
  // RESTORED on exit, so repositioning inside isolate isn't carried through
  // (value / connection / delete edits are real and DO persist). New nodes are
  // blocked while isolating (see handleMenuSelect / paste). View-only otherwise.
  useEffect(() => {
    let wasActive = false;
    const snapshot = new Map<string, { x: number; y: number }>();
    const apply = () => {
      const area = areaRef.current;
      const editor = editorRef.current;
      if (!area || !editor) return;
      const active = isolateStore.isActive();
      for (const [id, view] of area.nodeViews) {
        view.element.classList.toggle("solenoid-isolate-dim", active && !isolateStore.isVisible(id));
      }
      if (active && !wasActive) {
        // Enter: snapshot focus positions and fly to the focus set.
        snapshot.clear();
        const focusNodes = [];
        for (const [id, view] of area.nodeViews) {
          if (!isolateStore.isVisible(id)) continue;
          snapshot.set(id, { ...view.position });
          const n = editor.getNode(id);
          if (n) focusNodes.push(n);
        }
        if (focusNodes.length) void AreaExtensions.zoomAt(area, focusNodes);
      } else if (!active && wasActive) {
        // Exit: undo any repositioning done inside isolate, then persist the
        // restored layout (translate is async; the debounced save catches it).
        for (const [id, pos] of snapshot) {
          if (area.nodeViews.has(id)) void area.translate(id, pos);
        }
        snapshot.clear();
        scheduleAutosave();
      }
      wasActive = active;
    };
    apply();
    return isolateStore.subscribe(apply);
  }, []);

  const handleMenuSelect = useCallback(
    async (entry: NodeCatalogEntry) => {
      const area = areaRef.current;
      const editor = editorRef.current;
      if (!area || !editor || !menu) return;
      if (isolateStore.isActive()) return; // no new nodes while isolating

      const node = entry.create() as SolenoidNode;
      // A pre-seeded composite (the Query preset) carries a pending internal
      // snapshot — build its live subgraph before the first recompute, the same
      // hydrate persistence.ts runs on load. No-op for the empty Composite.
      if (node instanceof CompositeNode) await node.hydrate(ctorRegistry());
      await editor.addNode(node);

      const { x: tx, y: ty, k } = area.area.transform;
      const container = containerRef.current!;
      const rect = container.getBoundingClientRect();
      const dropX = (menu.screenX - rect.left - tx) / k;
      const dropY = (menu.screenY - rect.top - ty) / k;
      // Where the cable was dropped is the point that should meet the new node's
      // wired socket. Dragging from an OUTPUT creates a DOWNSTREAM node whose INPUT
      // (left edge) meets the drop → top-left at the drop. Dragging from an INPUT
      // creates an UPSTREAM node whose OUTPUT (right edge) meets the drop → shift it
      // left by its width. Width isn't known until the card renders; measure the
      // element if it's already laid out (no jump), else place naive and nudge on
      // the next frame. (offsetWidth is natural CSS px — the canvas scale is on the
      // holder, not the card — so it's already in the canvas units dropX uses.)
      const fromInput = menu.quickWire?.side === "input";
      const measuredW = fromInput ? area.nodeViews.get(node.id)?.element.offsetWidth ?? 0 : 0;
      await area.translate(node.id, { x: fromInput ? dropX - measuredW : dropX, y: dropY });
      if (fromInput && measuredW === 0) {
        requestAnimationFrame(() => {
          const w = area.nodeViews.get(node.id)?.element.offsetWidth ?? 0;
          if (w > 0) void area.translate(node.id, { x: dropX - w, y: dropY });
        });
      }

      // Quick-wire: splice the dragged cable into the first compatible socket on
      // the new node (the menu was already filtered to guarantee one exists).
      if (menu.quickWire) {
        const { nodeId: originId, key: originKey, side } = menu.quickWire;
        const originNode = editor.getNode(originId);
        const originSocket =
          side === "output" ? originNode?.outputs[originKey]?.socket : originNode?.inputs[originKey]?.socket;
        const newKey =
          originSocket instanceof SolenoidSocket
            ? firstCompatibleSocketKey(node, originSocket, side)
            : null;
        if (newKey) {
          try {
            const conn =
              side === "output"
                ? new ClassicPreset.Connection(originNode!, originKey, node, newKey)
                : new ClassicPreset.Connection(node, newKey, originNode!, originKey);
            await editor.addConnection(conn as SolenoidConnection);
          } catch { /* incompatible after all — leave the node unwired */ }
        }
      }

      // A freshly-added node has no connections, so it can't affect any existing
      // node. Use the ADDITIVE path (no engine reset → existing caches survive →
      // nothing re-sources/re-materializes) and render only the new node. A full
      // processGraph here re-ran the whole graph — on a big-frame graph that meant
      // re-uploading every source frame to Rust just to drop one node on the canvas.
      await processGraph(undefined, new Set([node.id]));
      setMenu(null);
    },
    [menu],
  );

  // Splice Conduit(s) into the selected cables — see canvasActions.ts.
  const handleInsertConduit = useCallback(async (target: CableContextTarget) => {
    const editor = editorRef.current;
    const area = areaRef.current;
    const container = containerRef.current;
    if (!editor || !area || !container) return;
    await insertConduitForCables(editor, area, container, target);
  }, []);
  // Shared with the value popups' Pin button (resolves the node's primary output,
  // or the empty key for a group whose chip shows its readouts). See pinStore.
  const handlePin = useCallback((nodeId: string) => pinNodeValue(nodeId), []);

  const handleLinkStandoff = useCallback((t: { aId: string; bId: string }) => {
    const editor = editorRef.current;
    const area = areaRef.current;
    if (!editor || !area) return;
    linkStandoffBetween(editor, area, t);
  }, []);

  const handleCableDelete = useCallback(async (target: CableContextTarget) => {
    const editor = editorRef.current;
    if (!editor) return;
    await deleteCables(editor, target);
  }, []);

  const handleAttachFormat = useCallback(async (target: SocketContextTarget) => {
    const area      = areaRef.current;
    const editor    = editorRef.current;
    const container = containerRef.current;
    if (!area || !editor || !container) return;
    await attachFormatController(editor, area, container, target);
  }, []);

  // Add-menu catalog = core tree with any active packs' nodes inserted in place.
  const packsVersion = useSyncExternalStore(packsStore.subscribe, packsStore.version);
  const visibleCatalog = useMemo(
    () => buildCatalog(true),
    [packsVersion],
  );

  return (
    <div className="solenoid-canvas-wrapper">
      <div ref={containerRef} className="solenoid-canvas" />
      {/* Parked WGSL canvas layers — mount ONLY in the (shelved) "canvas" mode, so DOM
          and html modes carry zero canvas overhead. */}
      {renderMode === "canvas" && (
        <>
          <CableCanvas />
          <NodeCanvas />
          <RenderOverlay />
        </>
      )}
      <HtmlCanvasLayer />
      {menu && (
        <AddNodeMenu
          screenX={menu.screenX}
          screenY={menu.screenY}
          entries={visibleCatalog}
          compatibleTypes={menu.compatibleTypes}
          onSelect={handleMenuSelect}
          onClose={closeMenu}
        />
      )}
      {(paletteOpen || paletteAlwaysOn) && <CommandPalette persistent={paletteAlwaysOn} onClose={() => paletteStore.close()} />}
      {socketCtx && (
        <SocketContextMenu
          target={socketCtx}
          onAttachFormat={handleAttachFormat}
          onClose={closeSocketCtx}
        />
      )}
      {cableCtx && (
        <CableContextMenu
          target={cableCtx}
          onInsertConduit={(t) => void handleInsertConduit(t)}
          onDelete={(t) => void handleCableDelete(t)}
          onClose={closeCableCtx}
        />
      )}
      {nodeCtx && (
        <NodeContextMenu
          target={nodeCtx}
          onIsolate={(ids) => isolateNodes(ids)}
          onIsolateChain={(ids) => isolateChainOf(ids)}
          onWhereUsed={(id) => isolateWhereUsed(id)}
          onPin={handlePin}
          onLinkStandoff={handleLinkStandoff}
          onAddComment={(id) => commentsPanelUi.openFor(id)}
          onEditComposite={(id) => {
            const n = editorRef.current?.getNode(id);
            if (n instanceof CompositeNode) compositeEditorStore.open(n);
          }}
          onUnpackComposite={(id) => {
            const editor = editorRef.current;
            const area = areaRef.current;
            if (editor && area) void unpackComposite(editor, area, id);
          }}
          onClose={closeNodeCtx}
        />
      )}
      <SocketLegend />
      <CableFlourish />
      <IsolatePill />
      <CableInspector />
      <ConfirmDialog />
      <NoticeToasts />
      <LoadOverlay />
      <ComputeOverlay />
      {lasso && (
        <svg
          className="solenoid-lasso"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            zIndex: 50,
          }}
        >
          <polygon
            points={lasso.points.map((p) => `${p.x},${p.y}`).join(" ")}
            fill={
              lasso.mode === "enclose"
                ? "rgba(86, 180, 233, 0.10)"
                : "rgba(255, 220, 0, 0.10)"
            }
            stroke={
              lasso.mode === "enclose"
                ? "rgba(86, 180, 233, 0.9)"
                : "rgba(255, 220, 0, 0.95)"
            }
            strokeWidth={1.4}
            strokeDasharray={lasso.mode === "touch" ? "5 4" : undefined}
          />
        </svg>
      )}
    </div>
  );
}

// Local alias for use in the Connection constructor cast.
type SolenoidConnection = import("./schemes").SolenoidConnection;

