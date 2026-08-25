import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { NodeEditor, ClassicPreset } from "rete";
import { AreaPlugin, AreaExtensions, Drag } from "rete-area-plugin";
import { ConnectionPlugin } from "rete-connection-plugin";
import { ReactPlugin } from "rete-react-plugin";
import {
  solenoidClassicRenderSetup, makeSolenoidConnectionFlow, installSurfacePointer,
  syncSurfaceBackground, installSurfaceBackground, installSurfaceSemanticZoom,
  installNodeDragGuard,
} from "./areaPresets";
import { createTapCensus, installTapSelect } from "./tapSelect";
import { DataflowEngine } from "rete-engine";
import { HistoryPlugin, Presets as HistoryPresets } from "rete-history-plugin";
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
import { IS_COARSE, IS_MOBILE } from "./coarse";
import { isPinching } from "./pointerGesture";
import { installErrorGuards } from "./errorValue";
import "./seedTune"; // console seed-tune hook (window.__solenoidTuneSeed — scripts/tune-seeds.mjs)
import "./census"; // console per-card DOM census (window.__solenoidCardCensus — scripts/card-css-census.mjs)
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
import { solenoidMinimapPreset, createSolenoidMinimap } from "./components/Minimap";
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
import { gridSnapStore, snapCoord } from "./gridSnapStore";
import { HtmlCanvasLayer } from "./components/HtmlCanvasLayer";
import { zoomSettleMs } from "./zoomSettle";
import { documentStore, ensureFirstDocument } from "./documentStore";
import type { NodeCatalogEntry } from "./AddNodeMenu";

import "./canvas.css";

// A quick-wire menu carries its origin socket, so a pick both creates the node AND
// wires the dragged cable into it.
type QuickWireOrigin = { nodeId: string; key: string; side: "input" | "output" };
type MenuState =
  | { screenX: number; screenY: number; quickWire?: QuickWireOrigin; compatibleTypes?: Set<string> }
  | null;

export function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<NodeEditor<Schemes> | null>(null);
  const areaRef = useRef<AreaPlugin<Schemes, AreaExtra> | null>(null);
  const historyRef = useRef<HistoryPlugin<Schemes> | null>(null);
  const dblClickCleanupRef = useRef<(() => void) | null>(null);
  const screenMouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragOriginKeyRef = useRef<string | null>(null);
  // Tracked globally so a modifier pressed MID-drag takes effect with no fresh event.
  const shiftDragRef = useRef(false);
  const ctrlDragRef = useRef(false);
  // The OLDER of the last two picks is what a Ctrl-drag aligns to — it's deselected,
  // so it stays put while the grabbed node moves.
  const lastPickedRef = useRef<string | null>(null);
  const prevPickedRef = useRef<string | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  // The keyboard handler is installed once, so reading the state would freeze it.
  const menuRef = useRef<MenuState>(menu);
  menuRef.current = menu;
  // Close the menu on a document SWITCH (a stale pick would add an orphan node), but
  // only on an id change — documentStore also notifies on every debounced autosave.
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
  // Module store, not useState: the mobile bar opens the palette from outside this tree.
  const paletteOpen = useSyncExternalStore(paletteStore.subscribe, paletteStore.get);
  // Docking is DESKTOP ONLY — ignoring the stored value here is the behavioural half
  // of the setting's `disabledOnMobile`, which Settings grays to match.
  const paletteAlwaysOnSetting = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get("commandPaletteAlwaysOn"));
  const paletteAlwaysOn = paletteAlwaysOnSetting && !IS_MOBILE;

  const deleteSelected = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    await deleteSelection(editor, areaRef.current);
  }, []);

  useEffect(() => setDeleteSelected(deleteSelected), [deleteSelected]);
  const [socketCtx, setSocketCtx] = useState<SocketContextTarget | null>(null);
  const closeSocketCtx = useCallback(() => setSocketCtx(null), []);
  const [cableCtx, setCableCtx] = useState<CableContextTarget | null>(null);
  const closeCableCtx = useCallback(() => setCableCtx(null), []);
  const [nodeCtx, setNodeCtx] = useState<NodeContextTarget | null>(null);
  const closeNodeCtx = useCallback(() => setNodeCtx(null), []);
  const standoffRootRef = useRef<ReturnType<typeof createRoot> | null>(null);
  const isoEndpointsRootRef = useRef<ReturnType<typeof createRoot> | null>(null);
  // AutoCAD winding semantics: CW "touch" selects any overlap, CCW "enclose" requires
  // the node fully inside.
  const [lasso, setLasso] = useState<{ points: Pt[]; mode: "touch" | "enclose" } | null>(null);

  useEffect(() => installCanvasKeyboard({
    editorRef, areaRef, historyRef, containerRef, screenMouseRef,
    isAddMenuOpen: () => menuRef.current !== null,
    deleteSelected,
  }), [deleteSelected]);

  // The other far-zoom trigger: flipping the SETTING without moving the camera.
  useEffect(() => {
    return settingsStore.subscribe(() => {
      const area = areaRef.current;
      if (area) syncSemanticZoomFor(area.area.transform.k);
    });
  }, []);

  // Capture phase so a modifier is seen over a focused input; blur clears it so a key
  // released while unfocused can't stick.
  useEffect(() => {
    const set = (e: KeyboardEvent) => {
      // TRUSTED events only: the mobile undo/redo buttons dispatch a synthetic
      // Ctrl(+Shift)+Z with no keyup, which would stick these refs ON forever.
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

  // pointermove as WELL as mousemove: rete's Drag.move preventDefaults pointermove,
  // which suppresses the compatibility mousemove — a mousemove-only tracker freezes
  // at the drag's start point.
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

  useEffect(() => addMenuRequest.register((screenX, screenY) => setMenu({ screenX, screenY })), []);

  // elementsFromPoint, so hover works regardless of how Rete captures pointer events
  // on output sockets.
  useEffect(() => {
    let lastKey = ""; // "nodeId::socketKey" or "" when off-socket
    function onMove(e: PointerEvent) {
      if (cableDragStore.get()) return; // drag in progress — handled below
      // Skip the elementsFromPoint layout read during a gesture — hover is a rest-state
      // affordance.
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

  // SELECT mode drops rete's Drag so one finger lassoes, keeping the Zoom handler so
  // two still pinch. IS_COARSE, not IS_MOBILE — a TABLET reaches select mode too.
  useEffect(() => {
    if (!IS_COARSE) return;
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return installLassoSelection({ container, editorRef, areaRef, setLasso });
  }, []);


  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // StrictMode double-invokes this effect in dev — clear the previous run's DOM.
    container.innerHTML = "";

    let destroyed = false;
    let localArea: AreaPlugin<Schemes, AreaExtra> | null = null;
    let unsubFmt: (() => void) | null = null;

    async function init() {
      const editor = new NodeEditor<Schemes>();
      // Installed before any node is created, so every node is wrapped.
      installInputCoercion(editor);
      const area = new AreaPlugin<Schemes, AreaExtra>(container!);
      localArea = area;
      const connection = new ConnectionPlugin<Schemes, AreaExtra>();
      const reactPlugin = new ReactPlugin<Schemes, AreaExtra>({ createRoot });
      const engine = new DataflowEngine<Schemes>();
      const history = new HistoryPlugin<Schemes>();
      history.addPreset(HistoryPresets.classic.setup());
      // Backstop against unbounded growth; the real hygiene is clearHistory() on load.
      (history as unknown as { history: { limit?: number } }).history.limit = 200;
      setHistoryPlugin(history);
      // Non-graph edits push onto the ACTIVE graph's history, so an edit made inside a
      // drill-in isn't stranded on the main stack.
      setPushHistory((action) => { void getActiveHistory()?.add(action); });
      setClearHistory(() => history.clear());
      // Collapse-aware geometry + rAF-coalesced render; a doc switch can destroy the
      // area between schedule and fire, hence the guard.
      const minimap = createSolenoidMinimap(() => destroyed);
      const ensureArrange = makeEnsureArrange(area, () => destroyed);

      const nodeSelector = AreaExtensions.selector();
      const ctrlAccum = AreaExtensions.accumulateOnCtrl(); // tracks Ctrl/Meta held

      // Selection semantics the stock selectableNodes can't express:
      //  • Plain PRESS on a selected node keeps the whole selection (drag the lot).
      //  • Plain CLICK (no drag) on a selected node collapses to just it.
      //  • Ctrl-click toggles a node in or out.
      // The capture pipe below must run BEFORE selectableNodes' pipe, so `active()`
      // sees these when the stock handler decides whether to clear the rest.
      let pickedId: string | null = null;
      let pendingCollapseId: string | null = null;
      let pendingDeselectId: string | null = null;
      let moveCount = 0;
      const isSelected = (id: string | null) =>
        !!(id && (editor.getNode(id) as { selected?: boolean } | undefined)?.selected);

      const accumulateActive = () => ctrlAccum.active() || touchSelectStore.get();

      const accumulating = {
        // Keep the rest of the selection when accumulating or the node was selected.
        active: () => accumulateActive() || isSelected(pickedId),
      };

      // The touch tap census (installTapSelect owns the listeners + the tap-to-select
      // itself, below); this pipe only reads it for the sibling off-canvas / form-control
      // branches that stay Canvas chrome concerns.
      const census = createTapCensus();

      area.addPipe((ctx) => {
        if (!ctx || typeof ctx !== "object" || !("type" in ctx)) return ctx;
        const c = ctx as { type: string; data?: { id?: string; event?: PointerEvent } };
        // A right-click on a node bubbles to the area, where selectableNodes reads the
        // no-move down→up as a background click and clears the selection the context
        // menu is about to need.
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
            // Deferred to pointerup: swallowing on pointerdown would skip the pick and
            // the draggingGroupId bookkeeping while the DOM drag handler still ran, so
            // a Ctrl-DRAG detached a group from its members.
            pendingDeselectId = id;
          }
          if (id && !accumulateActive() && wasSelected) {
            // Collapse to this node on pointerup IF it turns out to be a click.
            pendingCollapseId = id;
          }
        } else if (c.type === "nodetranslate") {
          // Never move a node while pinching; `isPinching()` counts FINGERS, so a
          // stylus resting alongside one can't freeze a legitimate drag.
          if (isPinching()) return;
        } else if (c.type === "pointermove") {
          moveCount++;
        } else if (c.type === "pointerup") {
          // Swallow an OFF-CANVAS tap's pointerup: selectableNodes' twitch counter is
          // re-armed only by a CONTAINER pointerdown, so it would wipe the selection.
          if ((IS_MOBILE || census.tapTouch) && !census.tapOnCanvas) {
            return;
          }
          // A form-control tap on a SELECTED node must not deselect it, or every toggle
          // costs a re-tap.
          if (
            census.tapTouch &&
            census.tapControlNodeId &&
            !census.tapMoved &&
            !census.gestureMulti &&
            isSelected(census.tapControlNodeId)
          ) {
            census.tapControlNodeId = null;
            return;
          }
          census.tapControlNodeId = null;
          // Tap-to-select for a drag-transparent unselected node runs in the shared
          // installTapSelect pipe (added below, before selectableNodes), so it swallows
          // the background deselect the same way.
          if (pendingCollapseId && moveCount < 4) {
            const keep = pendingCollapseId;
            for (const n of editor.getNodes()) {
              if (n.id !== keep && (n as { selected?: boolean }).selected) {
                void nodeSelector.remove({ label: "node", id: n.id });
              }
            }
          }
          if (pendingDeselectId && moveCount < 4) {
            void nodeSelector.remove({ label: "node", id: pendingDeselectId });
          }
          pendingCollapseId = null;
          pendingDeselectId = null;
        }
        return ctx;
      });

      // Added BEFORE selectableNodes so its tap-to-select swallow beats the background
      // deselect — in select mode that ordering is what preserves an accumulating tap.
      const disposeTapSelect = installTapSelect({
        area, editor, container: container!, census,
        select: (id, accumulate) => void selectable.select(id, accumulate),
      });

      const selectable = AreaExtensions.selectableNodes(area, nodeSelector, { accumulating });
      AreaExtensions.simpleNodesOrder(area);

      // ── Standoff layer + solver: own React root at z -3, under every node ──
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

      // ── Isolate auto-endpoints: transformed plane at z 3, above every node ──
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

      const standoffBoxes = (): Map<string, StandoffBox> => {
        const m = new Map<string, StandoffBox>();
        for (const s of standoffStore.all()) {
          for (const end of [s.a, s.b]) {
            if (m.has(end.nodeId)) continue;
            // measuredBox is the shared size chokepoint, so the solver sees the same
            // boxes align/tidy/push do.
            const b = measuredBox(area, end.nodeId, editor);
            if (!b) continue;
            m.set(end.nodeId, { x: b.x, y: b.y, w: b.w, h: b.h });
          }
        }
        return m;
      };
      // `standoffSolving` keeps the apply from re-entering through nodetranslated.
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

      // Node drag-handler guard (shared with the drill-in via areaPresets). Canvas adds
      // the one surface-specific branch: an expanded group's body interior is NOT a drag
      // handle — only its header bar and a thin band along the outer edges grab the group,
      // so a press in the open body falls through to pan the canvas. (Member nodes are
      // separate area views, not DOM children, so they stay independently draggable.)
      // Collapsed groups are small node-like boxes, fully draggable. GroupNode stays a
      // Canvas import — areaPresets must not know the concrete node types.
      const GROUP_EDGE_BAND = 16;
      const patchDragGuard = installNodeDragGuard(area, editor, {
        groupBand: (id, e, view) => {
          const node = editor.getNode(id);
          if (!(node instanceof GroupNode) || node.collapsed) return undefined;
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
        },
      });
      editor.addPipe((ctx) => {
        if (ctx && typeof ctx === "object" && "type" in ctx &&
            (ctx as { type: string }).type === "nodecreated") {
          const id = (ctx as { data?: { id?: string } }).data?.id;
          // Installed here because every creation path funnels through addNode.
          if (id) {
            const node = editor.getNode(id);
            if (node) installErrorGuards(node);
          }
          // Next frame: the area has rendered the view by then.
          if (id) requestAnimationFrame(() => patchDragGuard(id));
        }
        return ctx;
      });

      // Cable selection and node selection are kept mutually exclusive.
      setUnselectAllNodes(() => { void nodeSelector.unselectAll(); });
      setSelectNode((id, accumulate) => { void selectable.select(id, accumulate); });

      // repositionDockedTo is hoisted (declared below); the arrange only calls it in a
      // deferred rAF.
      const arrangeFn = makeArrangeFn({
        editor, area, container: container!, ensureArrange,
        repositionDockedTo: (hostId) => repositionDockedTo(hostId),
        isDestroyed: () => destroyed,
      });
      setAutoArrange(arrangeFn);
      setCleanup(makeCleanupFn(editor, area, arrangeFn));

      // size 105 × ratio 1.4 → 147px wide, matching the socket legend.
      reactPlugin.addPreset(solenoidMinimapPreset(105));
      // The veto must reject a drop BEFORE makeConnection runs: dropping on a
      // single-connection input removes the existing cable first, so a later rejection
      // would have deleted a valid cable.
      reactPlugin.addPreset(solenoidClassicRenderSetup());
      connection.addPreset(() => makeSolenoidConnectionFlow(editor));

      // connectionpick / connectiondrop fire on the connection plugin's OWN scope —
      // Scope.use forwards down, so an area pipe never sees them.
      connection.addPipe((ctx) => {
        if (ctx.type === "connectionpick") {
          // A socket's pointerdown preventDefaults the focus change, so a focused field
          // never fires its blur — blur first, or the cable carries the STALE value.
          (document.activeElement as HTMLElement | null)?.blur?.();
          setCableDragging(true);
          // Touch: every socket becomes a live drop target regardless of selection.
          container!.classList.add("solenoid-canvas--cabling");
          const s = (ctx as { data?: { socket?: { nodeId: string; key: string } } }).data?.socket;
          if (s) {
            const key = dragSocketKey(s.nodeId, s.key);
            dragOriginKeyRef.current = key;
            socketHighlightStore.setDrag([key]);
          }
        }
        if (ctx.type === "connectiondrop") {
          // A drop on empty canvas opens the Add menu, and the pick splices the cable.
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
                // The FULL tree opens with incompatible leaves dimmed, so compute only
                // the compatible SET; don't open if it's empty.
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
      editor.use(engine);

      // Capped zoom + double-click-to-zoom suppression + capture-seated area.pointer:
      // the shared surface install, so the subgraph can't drift from it. (`container`
      // narrowing doesn't survive the async boundary — re-hoisted here.)
      const c = container!;
      const uninstallPointer = installSurfacePointer(area, c);

      // Any pointerdown off a cable clears the cable selection, but only on RELEASE and
      // only if the press didn't move — clearing on pointerdown made it impossible to
      // pan with a cable selected. Touch bubbles a cable's own pointerdown, so presses
      // on a hit path are ignored here too.
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
        uninstallPointer();
        c.removeEventListener("pointerdown", clearCableSelection);
        window.removeEventListener("pointerup", maybeClearCableSelection);
        container!.removeEventListener("pointerdown", onPanStart, true);
        window.removeEventListener("pointerup", onPanEnd);
        window.removeEventListener("pointercancel", onPanEnd);
        unsubLock();
        disposeTapSelect();
      };

      // History shortcuts are wired by hand: `HistoryExtensions.keyboard` matches KeyZ
      // regardless of Shift, so Ctrl+Shift+Z would undo instead of redo.
      setEditorRefs(editor, engine, area);
      setCtorRegistryProvider(ctorRegistry);
      editorRef.current = editor;
      areaRef.current = area;
      historyRef.current = history;

      editor.addPipe((ctx) => {
        // Only an EXACT duplicate (same source AND target socket) is rejected: its two
        // cables coincide, so the second is untraceable. Distinct sockets are fine.
        if (ctx.type === "connectioncreate") {
          const c = ctx.data as unknown as {
            source: string; sourceOutput: string; target: string; targetInput: string;
          };
          if (canvasLockStore.get()) return; // cancel
          // Self-loops, on any path the drag-time veto doesn't cover.
          if (c.source === c.target) return; // cancel
          const dup = editor.getConnections().some(
            (e) =>
              e.source === c.source && e.sourceOutput === c.sourceOutput &&
              e.target === c.target && e.targetInput === c.targetInput,
          );
          if (dup) return; // cancel the connection

          // The classic connection preset allows ANY socket pairing, so type
          // compatibility must be enforced here.
          const srcSocket = editor.getNode(c.source)?.outputs[c.sourceOutput]?.socket;
          const tgtSocket = editor.getNode(c.target)?.inputs[c.targetInput]?.socket;
          if (
            srcSocket instanceof SolenoidSocket &&
            tgtSocket instanceof SolenoidSocket &&
            !srcSocket.canConnectTo(tgtSocket)
          ) {
            return; // cancel — incompatible socket types
          }

          // FC → FC: only a BOTH-united conflict is rejected — a unitless downstream
          // inherits and locks to its upstream instead.
          const csrc = editor.getNode(c.source);
          const ctgt = editor.getNode(c.target);
          if (
            csrc instanceof FormatControllerNode && ctgt instanceof FormatControllerNode &&
            c.sourceOutput === "out" && c.targetInput === "in" &&
            csrc.unit !== "none" && ctgt.unit !== "none" && csrc.unit !== ctgt.unit
          ) {
            return; // cancel — conflicting units
          }

          // On a COLLAPSED extensible node the stacked sockets hide their values, so
          // reroute to a free input rather than clobber one the user can't see.
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
            // A LIVE node created inside a group's box joins it; suppressed during a
            // rebuild, where membership comes from the saved list. Deferred so the
            // node's final position + size are measured first.
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
          // Free the node's backend frame refs (Filter owns a second, for Dropped).
          dropFrameRef((n as { _ref?: unknown })._ref);
          dropFrameRef((n as { _refDropped?: unknown })._refDropped);
          // A docked report whose node is deleted otherwise leaves the canvas squeeze on
          // the root forever, with its only undock button unrenderable.
          const removedId = (n as { id: string }).id;
          if (reportStore.openNodeId() === removedId) reportStore.close();
          if (presentationStore.activeId() === removedId) presentationStore.stop();
          if (n instanceof FormatControllerNode) n.undock();
          // Release FCs docked to it: a stale hostNodeId makes adaptTypeFromConnections
          // resolve "any" from the missing host instead of the surviving cable.
          for (const rel of dockedNodeStore.getDockedTo((n as { id: string }).id)) {
            const docked = editor.getNode(rel.id);
            if (docked instanceof FormatControllerNode) docked.undock();
          }
          dropFromGroups(editor, (n as { id: string }).id);
          // Skipped while rebuilding — that scans stores per node (O(nodes × entries));
          // rebuildGraph calls forgetAllNodes() once instead.
          if (!isGraphRebuilding()) forgetNode((n as { id: string }).id);
          // O(nodes) each, and a rebuild runs the equivalents ONCE at the end — running
          // them per-removal dominates the cost of clearing a big graph.
          if (!isGraphRebuilding()) {
            rebuildGroupMembership(editor);
            syncGroupCollapse(editor, area);
            // Deleting an expanded group settles the pushes it caused; they slide back.
            if (n instanceof GroupNode) restoreSettledPushes(editor, area);
          }
        }
        if (ctx.type === "connectioncreated" || ctx.type === "connectionremoved") {
          // This whole settle is O(connections × nodes) per cable and a rebuild runs the
          // equivalents ONCE at the end, so it must be skipped while rebuilding.
          if (!isGraphRebuilding()) {
            // Shared with the Note-retype path, so type propagation is identical.
            reconcileFcTypes(editor, area);
            bumpConnectionVersion();
            rescanMismatches();
            // A cable only invalidates its TARGET's downstream closure; `topology`
            // refreshes the loop cache, the one global it touches.
            const cable = ctx.data as { source?: string; target?: string };
            if (cable.target && editor.getNode(cable.target)) {
              void processGraph(cable.target, undefined, { topology: true });
              // The source keeps its value but its socket chrome can change.
              if (cable.source && editor.getNode(cable.source)) void area.update("node", cable.source);
            } else {
              void processGraph(undefined, undefined, { topology: true });
            }
            syncGroupCollapse(editor, area);
          } else {
            // Flag it so withGraphRebuild runs ONE settle instead of N per-cable sweeps.
            markBulkTopoDirty();
          }
        }
        if (ctx.type === "connectionremoved") {
          socketHighlightStore.setCableHover([]);
          const removedId = (ctx.data as { id: string }).id;
          cableGhostStore.commit(removedId);
          cableSelectionStore.remove(removedId);
          // Cutting the cable that GLUES a docked FC to its host dissolves the dock;
          // skipped while rebuilding, which replays removals and must not strip dock
          // state it is about to restore.
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

      const holderEl = area.area.content.holder as HTMLElement;

      // Frame-rate probe for the render-only pan/zoom path: set `window.__solenoidPerf
      // = true` in devtools, then pan or zoom to get a per-gesture log.
      const fpsProbe = (() => {
        let raf = 0, last = 0, label = "", active = false;
        let samples: { dt: number; k: number }[] = [];
        const tick = (t: number) => {
          if (last) samples.push({ dt: t - last, k: area.area.transform.k });
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
            const s = [...samples].sort((a, b) => a.dt - b.dt);
            const mean = s.reduce((a, b) => a + b.dt, 0) / s.length;
            const dropped = s.filter((d) => d.dt > 16.7).length;
            const ks = samples.map((x) => x.k);
            const worst = s[s.length - 1];
            // eslint-disable-next-line no-console
            console.log(
              `[perf] ${label} gesture: ${s.length} frames  ` +
              `mean=${mean.toFixed(1)}ms (${(1000 / mean).toFixed(0)}fps)  ` +
              `worst=${worst.dt.toFixed(1)}ms @ k=${worst.k.toFixed(3)}  ` +
              `k=${Math.min(...ks).toFixed(3)}–${Math.max(...ks).toFixed(3)}  ` +
              `dropped(>16.7ms)=${dropped} (${Math.round((100 * dropped) / s.length)}%)`,
            );
          },
        };
      })();

      let zoomSettleTimer = 0;
      let zooming = false;
      // HtmlCanvasLayer's gesture timer must hold for the same window as zoomSettleMs().
      function onZoomActivity() {
        if (IS_COARSE) return; // mobile-class GPU
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
        }, zoomSettleMs());
      }

      // Called on host MOVE and host RESIZE, so a docked FC follows a socket that
      // shifted because a display box grew a row.
      function repositionDockedTo(hostId: string) {
        for (const rel of dockedNodeStore.getDockedTo(hostId)) {
          const dockedNode = editor.getNode(rel.id);
          if (!dockedNode) continue;
          // A SELECTED docked FC is moved by the drag itself; repositioning it here too
          // creates a translate feedback loop that hangs the app.
          if ((dockedNode as { selected?: boolean }).selected) continue;
          const { w, h } = dockedRenderedDims(area, rel.id, dockedNode.width, dockedNode.height);
          const pos = computeDockedCanvasPos(
            area, c, rel.hostNodeId, rel.socketKey, rel.side, w, h,
          );
          // area.translate, not a raw DOM transform: it updates the position the
          // connection renderer reads, so the FC's cables follow it.
          if (pos) void area.translate(rel.id, pos);
        }
      }
      setRepositionDocked(repositionDockedTo);

      // Move-together must react only to a REAL header drag — a programmatic translate
      // (creation, load, docking) would shove members far away.
      let draggingGroupId: string | null = null;

      // Member follow is O(members) of async translates and `nodetranslated` fires per
      // pointermove, far above the refresh rate — coalesce to one apply per frame.
      let pendingGroup: GroupNode | null = null;
      let pendingDX = 0, pendingDY = 0, memberMoveRaf = 0;
      const flushMemberMove = () => {
        if (memberMoveRaf) { cancelAnimationFrame(memberMoveRaf); memberMoveRaf = 0; }
        const g = pendingGroup, dx = pendingDX, dy = pendingDY;
        pendingGroup = null; pendingDX = 0; pendingDY = 0;
        // skipSelected: a selected member is already moved by rete's selector.
        if (g && (dx !== 0 || dy !== 0)) moveGroupMembers(editor, area, g, dx, dy, true);
      };
      const scheduleMemberMove = (group: GroupNode, dx: number, dy: number) => {
        pendingGroup = group; pendingDX += dx; pendingDY += dy;
        if (!memberMoveRaf) memberMoveRaf = requestAnimationFrame(() => { memberMoveRaf = 0; flushMemberMove(); });
      };

      // rAF-throttled: each solve reads the latest boxes, so one per frame converges to
      // the same towed positions, and the exact settle still runs on drop.
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
      // Each bump force-reflows every tied node, so coalesce these to one per frame.
      let standoffTickRaf = 0;
      const scheduleStandoffTickBump = () => {
        if (standoffTickRaf) return;
        standoffTickRaf = requestAnimationFrame(() => {
          standoffTickRaf = 0;
          standoffLayoutTick.bump();
        });
      };
      // Pick position, to tell a real drag from a click: rete emits `nodedragged` on
      // every pointerup after a pick, moved or not.
      let pickedPos: { x: number; y: number } | null = null;

      // Chain-pull keys off this, so programmatic translates (push, ELK, the settle
      // itself) never trigger a re-solve.
      let dragPickId: string | null = null;

      // Transient per-node GPU layers for a drag, bounded to the moving set — the
      // holder itself is too large to promote.
      let dragPromotedEls: HTMLElement[] = [];
      const promoteDragLayers = (pickedId: string) => {
        clearDragLayers();
        const ids = new Set<string>([pickedId]);
        for (const n of editor.getNodes()) {
          if ((n as { selected?: boolean }).selected) ids.add(n.id);
        }
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

      // Telemetry only — DOM mode stays full-quality while panning.
      const onPanStart = () => { fpsProbe.start("pan"); };
      const onPanEnd = () => { fpsProbe.stop(); };
      container!.addEventListener("pointerdown", onPanStart, true);
      window.addEventListener("pointerup", onPanEnd);
      window.addEventListener("pointercancel", onPanEnd);

      // Dot grid + far-zoom card simplification track the camera; shared so every
      // surface behaves identically.
      installSurfaceBackground(area, c);
      installSurfaceSemanticZoom(area);

      area.addPipe((ctx) => {
        if (ctx.type === "zoomed") {
          // Only REAL zoomed events refresh the settle timer, or a follow-on pan would
          // hold the holder promoted indefinitely.
          onZoomActivity();
        }
        // A re-render can change box sizes, so re-measure the standoff bars.
        if (ctx.type === "rendered") { standoffLayoutTick.bump(); }
        if (ctx.type === "nodepicked") {
          cableSelectionStore.set(null);
          standoffStore.select(null);
          dragPickId = ctx.data.id;
          promoteDragLayers(ctx.data.id);
          if (lastPickedRef.current !== ctx.data.id) {
            prevPickedRef.current = lastPickedRef.current;
            lastPickedRef.current = ctx.data.id;
          }
          const picked = editor.getNode(ctx.data.id);
          draggingGroupId = picked instanceof GroupNode ? ctx.data.id : null;
          const pp = area.nodeViews.get(ctx.data.id)?.position;
          pickedPos = pp ? { x: pp.x, y: pp.y } : null;
          // A docked node's Rete position is stale (docking mutates the DOM directly),
          // so sync it from the transform before the drag starts.
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
          // simpleNodesOrder just moved the picked node to the DOM end, so a picked host
          // now covers its docked FC — re-append the FC after it.
          for (const d of dockedNodeStore.getDockedTo(ctx.data.id)) {
            const v = area.nodeViews.get(d.id);
            if (v) void area.area.content.reorder(v.element, null);
          }
        }
        // Shift-axis lock: the PRE-event lets the intended position be rewritten before
        // it's applied; diagonals only past a distance, so a wobble can't snap to 45°.
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
        // Ctrl/Cmd = align to the PREVIOUSLY grabbed object, which stays put because it
        // is deselected; each axis snaps independently.
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
        // Synchronous, in the same pipe call as the host's translation, so both land in
        // one paint frame.
        if (ctx.type === "nodetranslated") {
          repositionDockedTo(ctx.data.id);
          const moved = editor.getNode(ctx.data.id);
          if (moved instanceof GroupNode && ctx.data.id === draggingGroupId) {
            const { position, previous } = ctx.data as { position: { x: number; y: number }; previous: { x: number; y: number } };
            scheduleMemberMove(moved, position.x - previous.x, position.y - previous.y);
          }
          // Chain-pull tows partners once a band goes taut; the whole dragged selection
          // is pinned, and it's gated on actually TOUCHING a tie because the settle
          // force-reflows every tied node's box.
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
          // Repaint that layer only when something it draws actually moved.
          if (standoffStore.participants().has(ctx.data.id) || isolateStore.isActive()) {
            scheduleStandoffTickBump();
          }
        }
        // Dropping a dragged FC:
        //  • onto a DIFFERENT socket → re-home (re-splice into that host),
        //  • back onto its own socket → re-glue (resume following),
        //  • into empty space → stay undocked, keeping cables and annotation.
        if (ctx.type === "nodedragged") {
          clearDragLayers();
          // Settle the coalesced member follow before the reconcile/autosave below.
          flushMemberMove();
          // The lead node is still selected, so area.translate carries the rest of the
          // selection by the same delta; groups and docked FCs are skipped.
          if (gridSnapStore.get() && ctx.data.id === dragPickId) {
            const dn = editor.getNode(ctx.data.id);
            const dv = area.nodeViews.get(ctx.data.id);
            if (dv && dn && !(dn instanceof FormatControllerNode)) {
              // A STANDOFF CLUSTER snaps as a rigid block to a DETERMINISTIC anchor: a
              // locked standoff fixes relative geometry, so snapping the clicked node
              // fights the angle and oscillates the cluster on every click.
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
                  // Skip SELECTED members — the selector already moved them.
                  if (dn instanceof GroupNode) moveGroupMembers(editor, area, dn, ddx, ddy, true);
                }
              }
            }
          }
          scheduleAutosave(); // persist the new position (drag end, once)
          // Cancel the pending rAF settle first, or it fires after the drop with a
          // stale pinned set.
          if (standoffSettleRaf) { cancelAnimationFrame(standoffSettleRaf); standoffSettleRaf = 0; pendingStandoffPinned = null; }
          if (ctx.data.id === dragPickId) {
            const pinned = new Set<string>([ctx.data.id]);
            for (const n of editor.getNodes()) {
              if ((n as { selected?: boolean }).selected) pinned.add(n.id);
            }
            settleStandoffNetwork(pinned);
          }
          dragPickId = null;
          draggingGroupId = null;
          reconcileGroupMembership(editor, area, ctx.data.id);
          rebuildGroupMembership(editor);
          syncGroupCollapse(editor, area);
          const dragged = editor.getNode(ctx.data.id);
          // A manual MOVE invalidates any expand-time push record; a plain click must
          // not, since restore-on-collapse still needs them.
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
              dragged.dockSelf(editor);
              const dims = dockedRenderedDims(area, dragged.id, dragged.width, dragged.height);
              const pos = computeDockedCanvasPos(
                area, c, dragged.hostNodeId, dragged.socketKey, dragged.side,
                dims.w, dims.h,
              );
              if (pos) void area.translate(dragged.id, pos);
            }
            // No nearby socket: stay undocked, but the dock IDENTITY must also be
            // forgotten — a stale hostNodeId persists into the save and re-docks on load.
            else dragged.releaseDock();
          }
        }
        return ctx;
      });

      function rescanMismatches() {
        for (const n of editor.getNodes()) {
          if (!(n instanceof FormatControllerNode)) continue;
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
            // lastIndexOf: a nodeId may itself contain "::".
            const sep         = other.lastIndexOf("::");
            const otherNodeId = other.slice(0, sep);
            const otherSockKey = other.slice(sep + 2);
            const otherAnn = formatAnnotationStore.get(otherNodeId, otherSockKey);
            if (otherAnn && !unitsCompatible(myAnn.unit, otherAnn.unit)) { hasMismatch = true; break; }
          }
          formatMismatchStore.setMismatch(n.id, hasMismatch);
        }
      }
      unsubFmt = formatAnnotationStore.subscribe(rescanMismatches);

      // The ONE settle for a bulk topology change, replacing the per-cable sweep the
      // caller gated off with begin/endGraphRebuild.
      setBulkSettle(async (renderOnly?: Set<string>) => {
        reconcileFcTypes(editor, area);
        bumpConnectionVersion();
        rescanMismatches();
        await processGraph(undefined, renderOnly);
        syncGroupCollapse(editor, area);
      });

      setGraphChanged(() => { scheduleAutosave(); });
      if (await documentStore.restore()) {
        syncSurfaceBackground(area, c);
        syncSemanticZoomFor(area.area.transform.k);
        return;
      }

      await ensureFirstDocument();
      syncSurfaceBackground(area, c);
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

  // Native, not React's onContextMenu: nodes render in a SEPARATE React root, where a
  // synthetic handler can't resolve `e.target` into the node DOM.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    return installCanvasContextMenu({
      el, editorRef, areaRef, setSocketCtx, setCableCtx, setNodeCtx,
      openAddMenu: (screenX, screenY) => setMenu({ screenX, screenY }),
    });
  }, []);

  // Isolate is VIEW-ONLY: positions are snapshot on enter and restored on exit, so
  // repositioning inside it isn't carried through — value/wiring edits are real.
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
        // translate is async; the debounced save catches the restored layout.
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
      // A pre-seeded composite carries a pending internal snapshot — build its live
      // subgraph before the first recompute.
      if (node instanceof CompositeNode) await node.hydrate(ctorRegistry());
      await editor.addNode(node);

      const { x: tx, y: ty, k } = area.area.transform;
      const container = containerRef.current!;
      const rect = container.getBoundingClientRect();
      const dropX = (menu.screenX - rect.left - tx) / k;
      const dropY = (menu.screenY - rect.top - ty) / k;
      // The drop point must meet the new node's WIRED socket, so a node created from an
      // INPUT drag shifts left by its width — unknown until the card renders, hence the
      // measure-else-nudge. (offsetWidth is already in canvas units: the scale is on
      // the holder, not the card.)
      const fromInput = menu.quickWire?.side === "input";
      const measuredW = fromInput ? area.nodeViews.get(node.id)?.element.offsetWidth ?? 0 : 0;
      await area.translate(node.id, { x: fromInput ? dropX - measuredW : dropX, y: dropY });
      if (fromInput && measuredW === 0) {
        requestAnimationFrame(() => {
          const w = area.nodeViews.get(node.id)?.element.offsetWidth ?? 0;
          if (w > 0) void area.translate(node.id, { x: dropX - w, y: dropY });
        });
      }

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

      // A fresh node has no connections, so the ADDITIVE path keeps every existing
      // cache alive instead of re-sourcing the graph.
      await processGraph(undefined, new Set([node.id]));
      setMenu(null);
    },
    [menu],
  );

  const handleInsertConduit = useCallback(async (target: CableContextTarget) => {
    const editor = editorRef.current;
    const area = areaRef.current;
    const container = containerRef.current;
    if (!editor || !area || !container) return;
    await insertConduitForCables(editor, area, container, target);
  }, []);
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

  const packsVersion = useSyncExternalStore(packsStore.subscribe, packsStore.version);
  const visibleCatalog = useMemo(
    () => buildCatalog(true),
    [packsVersion],
  );

  return (
    <div className="solenoid-canvas-wrapper">
      <div ref={containerRef} className="solenoid-canvas" />
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

type SolenoidConnection = import("./schemes").SolenoidConnection;

