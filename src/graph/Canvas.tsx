import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { NodeEditor, ClassicPreset } from "rete";
import { AreaPlugin, AreaExtensions, Drag } from "rete-area-plugin";
import { ConnectionPlugin } from "rete-connection-plugin";
import { ReactPlugin } from "rete-react-plugin";
import { solenoidClassicRenderSetup, makeSolenoidConnectionFlow, CappedZoom } from "./areaPresets";
import { DataflowEngine } from "rete-engine";
import { HistoryPlugin, Presets as HistoryPresets } from "rete-history-plugin";
import { MinimapPlugin } from "rete-minimap-plugin";
import type { AutoArrangePlugin } from "rete-auto-arrange-plugin";
import { createRoot } from "react-dom/client";

import type { Schemes, AreaExtra, SolenoidNode } from "./schemes";
import { SolenoidSocket } from "./sockets";
import { requestConfirm } from "./confirmStore";
import { collapseStore } from "./collapseStore";
import {
  setEditorRefs, processGraph, bumpConnectionVersion, setCableDragging, cableDragStore, bumpConduitAngle,
  setUnselectAllNodes, setAutoArrange, setSelectNode, setRepositionDocked, setPushHistory, setClearHistory, setHistoryPlugin,
  setDeleteSelected, setCleanup, repositionDockedNodes,
  unselectAllNodes as unselectAllNodesFromProcess,
  selectNode as selectNodeFromProcess,
  cleanup as cleanupGraph, autoArrange as tidyGraph, requestRecalc,
  isGraphRebuilding, setBulkSettle, withGraphRebuild, markBulkTopoDirty,
  beginGraphRebuild, endGraphRebuild, bulkSettle, setCtorRegistryProvider,
} from "./process";
import { copySelected, pasteClipboard } from "./copyPaste";
import { getActiveHistory } from "./activeGraph";
import { ctorRegistry } from "./nodeCtorRegistry";
import { createCompositeFromSelection, unpackComposite } from "./compositeLogic";
import { compositeEditorStore } from "./compositeEditorStore";
import { presentationStore } from "./presentationStore";
import { reportStore } from "./reportStore";
import { paletteStore } from "./paletteStore";
import { frStore } from "./frStore";
import { shortcutsStore } from "./shortcutsStore";
import { CommandPalette } from "./CommandPalette";
import { settingsPanel, settingsStore } from "./settingsStore";
import { cableSelectionStore, cableGhostStore, socketHighlightStore, socketHoverCableStore, dragSocketKey } from "./cableState";
import { ribbonForConnection } from "./ribbonCable";
import { resolveSocketHighlights } from "./highlightUtils";
import { canvasLockStore } from "./canvasLock";
import { touchSelectStore } from "./touchSelectStore";
import { IS_MOBILE } from "./coarse";
import { installErrorGuards } from "./errorValue";
import { pointInPolygon, polygonIntersectsBBox, signedArea, lassoActiveStore, type Pt } from "./lasso";
import {
  ConduitNode, AngleDialNode,
  FormatControllerNode, GroupNode, CompositeNode,
  CONDUIT_MAX_LANES, conduitInKey, conduitOutKey, conduitGhostSpecs,
} from "./rete-nodes";
import { reconcileFcTypes } from "./fcReconcile";
import { CONDUIT_PIVOT } from "./ribbonCable";
import { toggleAllChrome, toggleChrome } from "./chromeToggle";
import {
  createGroupFromSelection, moveGroupMembers, reconcileGroupMembership,
  dropFromGroups, sendGroupToBack, absorbIntoContainingGroup, autofitGroupBox,
  autofitGroupWithHistory, GROUP_PAD, GROUP_HEADER,
} from "./groupLogic";
import { groupPushStore, setGroupsCollapsed, restoreSettledPushes, translateEntityBy, pushForGrownGroups } from "./groupPush";
import { PUSH_GAP } from "./groupPushCore";
import {
  standoffStore, standoffClusters, standoffLayoutTick, setStandoffSettle, settleStandoffs,
  anchorPoint, anchorFromVector, OPPOSITE_ANCHOR, ANCHOR_DIR,
  type Box as StandoffBox,
} from "./standoffs";
import { solveStandoffs } from "./standoffSolver";
import { rebuildGroupMembership } from "./groupMembership";
import { dropFrameRef } from "./frameBackend";
import { syncGroupCollapse, settleCollapse, groupCollapseStore, COLLAPSE_LAYOUT, pillY } from "./groupCollapse";
import { fitAll } from "./NavMenu";
import { formatAnnotationStore, formatMismatchStore, unitsCompatible } from "./formatAnnotationStore";
import { SocketLegend, ConfirmDialog, NoticeToasts, SocketContextMenu, CableContextMenu, NodeContextMenu, StandoffLayer } from "./components";
import { CableFlourish } from "./components/CableFlourish";
import { LoadOverlay } from "./components/LoadOverlay";
import { ComputeOverlay } from "./components/ComputeOverlay";
import { computeOverlayStore } from "./computeOverlayStore";
import { IsolatePill } from "./components/IsolatePill";
import { CableInspector } from "./components/CableInspector";
import { IsolateEndpoints } from "./components/IsolateEndpoints";
import { solenoidMinimapPreset, collapsedAwareNodesRect } from "./components/Minimap";
import type { SocketContextTarget, CableContextTarget, NodeContextTarget } from "./components";
import { isolateStore, isoEndpointSelect } from "./isolateStore";
import { isolateNodes, isolateChainOf, isolateSelection, isolateWhereUsed } from "./isolate";
import { commentsPanelUi } from "./commentStore";
import { pinNodeValue } from "./pinStore";
import { buildCatalog } from "./catalogUtils";
import { packsStore } from "./packs";
import { dockedNodeStore } from "./dockedNodeStore";
import { forgetNode } from "./nodeStoreRegistry";
import { AddNodeMenu } from "./AddNodeMenu";
import { addMenuRequest } from "./addMenuStore";
import { flattenLeaves, filterByCompatibleSocket, firstCompatibleSocketKey } from "./catalogSearch";
import { semanticZoomStore } from "./semanticZoomStore";
import { expandMoveSet } from "./selectionOps";
import { setGraphChanged } from "./process";
import { installInputCoercion } from "./coerceInputs";
import { scheduleAutosave } from "./persistence";
import { saveToDisk, openFromDisk } from "./fileSession";
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

// Tidy (auto-arrange) asks for confirmation before rearranging more
// than this many nodes — it's a large, hard-to-undo visual change.
const TIDY_CONFIRM_THRESHOLD = 12;

// Zoom feel + double-click suppression are shared with every canvas-substituting
// surface (the composite drill-in) via areaPresets.ts CappedZoom — so they can't drift.

// Mobile mode drives the touch interaction model (tap selects, drag moves only
// selected, unselected nodes are transparent to pan/pinch). Keyed on IS_MOBILE
// (not raw pointer coarseness) so "Request desktop site" gets desktop behavior.

function getSocketScreenCenter(
  area: AreaPlugin<Schemes, AreaExtra>,
  nodeId: string,
  socketKey: string,
  side: "input" | "output",
): { x: number; y: number } | null {
  const view = area.nodeViews.get(nodeId);
  if (!view) return null;
  const el = view.element.querySelector(
    `[data-socket-key="${socketKey}"][data-socket-side="${side}"]`,
  ) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function screenToCanvas(
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
  sx: number,
  sy: number,
): { x: number; y: number } {
  const { x: tx, y: ty, k } = area.area.transform;
  const r = container.getBoundingClientRect();
  return { x: (sx - r.left - tx) / k, y: (sy - r.top - ty) / k };
}

function computeDockedCanvasPos(
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
  hostNodeId: string,
  socketKey: string,
  side: "input" | "output",
  dockedWidth: number,
  dockedHeight: number,
): { x: number; y: number } | null {
  const sc = getSocketScreenCenter(area, hostNodeId, socketKey, side);
  if (!sc) return null;
  const { x: cx, y: cy } = screenToCanvas(area, container, sc.x, sc.y);
  // Align the Transformer's connecting socket flush with the host socket.
  // Host INPUT  → Transformer output (right edge) should meet it → Transformer goes LEFT.
  // Host OUTPUT → Transformer input  (left edge) should meet it → Transformer goes RIGHT.
  return {
    x: side === "input" ? cx - dockedWidth : cx,
    y: cy - dockedHeight / 2,
  };
}

// The docked node's real rendered size in canvas units (its DOM element's
// unscaled offset box), falling back to the node's stored estimate before it
// has painted. The dock math centers the FC on the host socket using its
// height, so a stale estimate (e.g. the initial 64 vs a taller Decimal chip)
// drops it a few — or ~15 — px low. Measuring the element avoids that.
function dockedRenderedDims(
  area: AreaPlugin<Schemes, AreaExtra>,
  nodeId: string,
  fallbackW: number,
  fallbackH: number,
): { w: number; h: number } {
  const el = area.nodeViews.get(nodeId)?.element;
  return { w: el?.offsetWidth || fallbackW, h: el?.offsetHeight || fallbackH };
}

// How close the FC's edge socket must be to a host socket to snap-dock — in
// CANVAS units (screen distance ÷ zoom). Comparing raw SCREEN px let a
// zoomed-out canvas snap an FC to hosts a huge canvas distance away (e.g. a
// far-off Note's tall stack of frontmatter sockets — the random-repro
// "FC mis-docks to a Note" bug, v1.1 bug lane). At zoom 1 the behavior is
// exactly the old 34px.
const DOCK_SNAP_CANVAS_PX = 34;

// On drop, find the host socket the FC should dock to: the nearest one whose
// pairing edge (host output ↔ FC input, host input ↔ FC output) is within snap
// range of the FC's matching socket. Returns null if nothing is close enough.
function findDockTarget(
  area: AreaPlugin<Schemes, AreaExtra>,
  editor: NodeEditor<Schemes>,
  fc: FormatControllerNode,
): { hostNodeId: string; socketKey: string; side: "input" | "output" } | null {
  const fcIn  = getSocketScreenCenter(area, fc.id, "in",  "input");
  const fcOut = getSocketScreenCenter(area, fc.id, "out", "output");
  if (!fcIn && !fcOut) return null;
  const zoom = area.area.transform.k || 1;

  let best: { hostNodeId: string; socketKey: string; side: "input" | "output"; dist: number } | null = null;
  for (const host of editor.getNodes()) {
    if (host.id === fc.id || host instanceof FormatControllerNode) continue;
    const sides: Array<"input" | "output"> = ["input", "output"];
    for (const side of sides) {
      const ports = side === "input" ? host.inputs : host.outputs;
      for (const socketKey of Object.keys(ports)) {
        // Pair host output with the FC's input edge, host input with its output edge.
        const fcPt = side === "output" ? fcIn : fcOut;
        if (!fcPt) continue;
        const hostPt = getSocketScreenCenter(area, host.id, socketKey, side);
        if (!hostPt) continue;
        const dist = Math.hypot(hostPt.x - fcPt.x, hostPt.y - fcPt.y) / zoom;
        if (dist <= DOCK_SNAP_CANVAS_PX && (!best || dist < best.dist)) {
          best = { hostNodeId: host.id, socketKey, side, dist };
        }
      }
    }
  }
  return best ? { hostNodeId: best.hostNodeId, socketKey: best.socketKey, side: best.side } : null;
}


// ─── Format Controller inline insertion ───────────────────────────────────────
// An FC docked to a host OUTPUT is inserted into the data path: the host's
// existing consumers are rerouted to pull from the FC, and the host output is
// fed into the FC. The FC passes the original value through unchanged (display-
// only formatting), so downstream values are identical — but the host's display
// formats, and cables now originate from the FC's output.

async function insertFcInline(editor: NodeEditor<Schemes>, fc: FormatControllerNode): Promise<void> {
  if (!fc.hostNodeId) return;
  const host = editor.getNode(fc.hostNodeId);
  if (!host) return;

  if (fc.side === "output") {
    // Docked on a host OUTPUT: reroute the output's consumers to the FC out,
    // and feed the host output into the FC. (origin-socket case)
    const downstream = editor.getConnections().filter(
      (c) => c.source === fc.hostNodeId && c.sourceOutput === fc.socketKey && c.target !== fc.id,
    );
    for (const c of downstream) {
      const tgt = editor.getNode(c.target);
      if (!tgt) continue;
      const targetInput = c.targetInput;
      await editor.removeConnection(c.id);
      try {
        await editor.addConnection(new ClassicPreset.Connection(fc, "out", tgt, targetInput) as SolenoidConnection);
      } catch { /* incompatible — leave disconnected */ }
    }
    if (!editor.getConnections().some((c) => c.target === fc.id && c.targetInput === "in")) {
      try {
        await editor.addConnection(new ClassicPreset.Connection(host, fc.socketKey, fc, "in") as SolenoidConnection);
      } catch { /* incompatible — skip */ }
    }
  } else {
    // Docked on a host INPUT (destination): reroute whatever feeds that input
    // through the FC — source → FC.in, FC.out → host.input. Only splice when a
    // cable actually feeds the input (a literal/unwired input has nothing to
    // route; the FC then just annotates the host's display).
    const incoming = editor.getConnections().filter(
      (c) => c.target === fc.hostNodeId && c.targetInput === fc.socketKey && c.source !== fc.id,
    );
    if (incoming.length === 0) return;
    for (const c of incoming) {
      const src = editor.getNode(c.source);
      if (!src) continue;
      const sourceOutput = c.sourceOutput;
      await editor.removeConnection(c.id);
      try {
        await editor.addConnection(new ClassicPreset.Connection(src, sourceOutput, fc, "in") as SolenoidConnection);
      } catch { /* incompatible — leave disconnected */ }
    }
    if (!editor.getConnections().some((c) => c.source === fc.id && c.sourceOutput === "out" && c.target === fc.hostNodeId)) {
      try {
        await editor.addConnection(new ClassicPreset.Connection(fc, "out", host, fc.socketKey) as SolenoidConnection);
      } catch { /* incompatible — skip */ }
    }
  }
}

// Reverse of insertFcInline (on re-home / un-splice): reconnect the original
// path around the FC. Call BEFORE undock() / before changing fc.hostNodeId
// (it reads fc.hostNodeId / fc.socketKey / fc.side).
async function removeFcInline(editor: NodeEditor<Schemes>, fc: FormatControllerNode): Promise<void> {
  const host = fc.hostNodeId ? editor.getNode(fc.hostNodeId) : undefined;
  const hostKey = fc.socketKey;

  if (fc.side === "output") {
    // FC.out consumers → back to host output; drop host → FC.in.
    for (const c of editor.getConnections().filter((c) => c.source === fc.id && c.sourceOutput === "out")) {
      const tgt = editor.getNode(c.target);
      const targetInput = c.targetInput;
      await editor.removeConnection(c.id);
      if (host && tgt) {
        try { await editor.addConnection(new ClassicPreset.Connection(host, hostKey, tgt, targetInput) as SolenoidConnection); } catch { /* ignore */ }
      }
    }
    for (const c of editor.getConnections()) {
      if (c.target === fc.id && c.targetInput === "in") { try { await editor.removeConnection(c.id); } catch { /* ignore */ } }
    }
  } else {
    // FC.in source → back to host input; drop FC.out → host input.
    for (const c of editor.getConnections().filter((c) => c.target === fc.id && c.targetInput === "in")) {
      const src = editor.getNode(c.source);
      const sourceOutput = c.sourceOutput;
      await editor.removeConnection(c.id);
      if (host && src) {
        try { await editor.addConnection(new ClassicPreset.Connection(src, sourceOutput, host, hostKey) as SolenoidConnection); } catch { /* ignore */ }
      }
    }
    for (const c of editor.getConnections()) {
      if (c.source === fc.id && c.sourceOutput === "out") { try { await editor.removeConnection(c.id); } catch { /* ignore */ } }
    }
  }
}

// Semantic zoom: below this CSS scale a node body's detail (labels, literal
// fields, values) is too small to read, so we hide it and keep the card frame +
// title + socket dots as clean overview landmarks (scope-features #40). Gated on
// the RAW CSS scale, NOT the mip level: the old code used
// computeIdealMipLevel(scale·dpr) ≥ 4, which (a) only fired below ~6% zoom on a
// dpr-1 display and ~3% on a dpr-2 laptop — so far out the body is already
// sub-pixel and hiding it does nothing visible ("semantic zoom doesn't do
// anything") — and (b) folded in dpr, so it triggered at a DIFFERENT apparent zoom
// per display. Apparent size is what legibility depends on, and dpr is a texture-
// resolution concern that belongs to the mip renderer, not here. 0.3 ≈ a card
// drawn at ~30% (a ~200px card → ~60px): body text unreadable, card still a clear
// block — conservative (far-overview only) but actually reachable and visible.
const SEMANTIC_ZOOM_SCALE = 0.3;
function syncSemanticZoomFor(scale: number): void {
  semanticZoomStore.set(settingsStore.get("semanticZoom") && scale <= SEMANTIC_ZOOM_SCALE);
}


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

  // Remove the selected cables and/or the selected nodes (a lasso can select
  // both at once). Shared by the Delete/Backspace key path and the mobile
  // delete control. Node deletion splices a ghost cable when a node has
  // exactly one in + one out.
  const deleteSelected = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;

    // A selected standoff is its own deletion target (exclusive selection).
    const standoffSel = standoffStore.selected();
    if (standoffSel) {
      standoffStore.remove(standoffSel);
      scheduleAutosave();
      return;
    }

    const selectedCableIds = cableSelectionStore.ids();
    const selected = editor.getNodes().filter((n) => n.selected);
    // Gate the WHOLE removal (selected cables + nodes): each removeConnection fires
    // `connectionremoved` (FC reconcile + mismatch rescan + a FULL processGraph +
    // collapse re-sync) and each removeNode fires `noderemoved` (rebuildGroupMembership
    // + syncGroupCollapse + restoreSettledPushes + forgetNode) — run per item that's
    // O((nodes+cables) × nodes), i.e. a bulk delete hangs the tab. Suppress the
    // per-event sweeps and do the equivalents ONCE below. (dropFromGroups +
    // standoffStore cleanup still run per noderemoved — they're cheap, outside the gate.)
    const deletedIds: string[] = [];
    let deletedGroup = false;
    beginGraphRebuild();
    try {
      if (selectedCableIds.length > 0) {
        cableSelectionStore.clear();
        // A Ribbon (bundled Conduit cable) is one entity: any selected lane
        // takes every lane with it.
        const doomed = new Set<string>();
        for (const id of selectedCableIds) {
          const conn = editor.getConnections().find((c) => c.id === id);
          if (!conn) continue;
          const ribbon = ribbonForConnection(editor, conn);
          if (ribbon) for (const m of ribbon.members) doomed.add(m.id);
          else doomed.add(id);
        }
        for (const id of doomed) {
          cableGhostStore.commit(id);
          try { await editor.removeConnection(id); } catch { /* already gone */ }
        }
      }

      for (const node of selected) {
        deletedIds.push(node.id);
        if (node instanceof GroupNode) deletedGroup = true;
        const incoming = editor.getConnections().filter((c) => c.target === node.id);
        const outgoing = editor.getConnections().filter((c) => c.source === node.id);

        // Conduit: splice PER LANE. The generic 1-in/1-out splice below can't see a
        // multi-lane bundle, so without this a deleted Conduit drops every cable
        // with no ghost. `conduitGhostSpecs` pairs in_i→out_i and yields the
        // unambiguous per-lane rewires (skipping missing ends, self-loops, dups);
        // we drop the Conduit + its cables, then add a ghost per spec. (Also covers
        // a 1-lane Conduit, so it goes through here, not the generic path below.)
        if (node instanceof ConduitNode) {
          const specs = conduitGhostSpecs(incoming, outgoing, editor.getConnections());
          for (const conn of [...incoming, ...outgoing]) await editor.removeConnection(conn.id);
          await editor.removeNode(node.id);
          for (const s of specs) {
            const src = editor.getNode(s.source);
            const dst = editor.getNode(s.target);
            if (!src || !dst) continue;
            const ghost = new ClassicPreset.Connection(src, s.sourceOutput, dst, s.targetInput) as SolenoidConnection;
            await editor.addConnection(ghost);
            cableGhostStore.mark(ghost.id);
          }
          continue;
        }

        // Splice case: 1 in + 1 out → leave a ghost cable from the upstream
        // source to the downstream target. Click the ghost to adopt it.
        const canSplice =
          incoming.length === 1 &&
          outgoing.length === 1 &&
          incoming[0].source !== outgoing[0].target &&
          !editor.getConnections().some(
            (c) =>
              c.source === incoming[0].source &&
              c.sourceOutput === incoming[0].sourceOutput &&
              c.target === outgoing[0].target &&
              c.targetInput === outgoing[0].targetInput,
          );

        if (canSplice) {
          const src = editor.getNode(incoming[0].source);
          const dst = editor.getNode(outgoing[0].target);
          if (src && dst) {
            await editor.removeConnection(incoming[0].id);
            await editor.removeConnection(outgoing[0].id);
            await editor.removeNode(node.id);
            const ghost = new ClassicPreset.Connection(
              src,
              incoming[0].sourceOutput,
              dst,
              outgoing[0].targetInput,
            ) as SolenoidConnection;
            await editor.addConnection(ghost);
            cableGhostStore.mark(ghost.id);
            continue;
          }
        }

        for (const conn of [...incoming, ...outgoing]) {
          await editor.removeConnection(conn.id);
        }
        await editor.removeNode(node.id);
      }
    } finally {
      endGraphRebuild();
    }

    // The per-event settles were suppressed above — run the equivalents ONCE, in the
    // same order noderemoved/connectionremoved would: forget store state, rebuild
    // membership, the FC/mismatch/recompute/collapse pass (bulkSettle), then restore
    // any pushes a deleted expanded group was holding open.
    if (deletedIds.length || selectedCableIds.length) {
      for (const id of deletedIds) forgetNode(id);
      if (deletedIds.length) rebuildGroupMembership(editor);
      await bulkSettle();
      if (deletedGroup && areaRef.current) restoreSettledPushes(editor, areaRef.current);
    } else {
      await processGraph();
    }
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

  // Canvas keyboard shortcuts. Skipped when focus is in an editable form
  // element so typing in a label / number field doesn't fire them. Graph
  // actions are single letters (hands stay on the graph); OS conventions keep
  // their Ctrl form.
  //   A add node · I isolate · G group · T tidy · E expand/collapse groups
  //   F autofit groups · C cleanup · Del delete · Esc exit isolate
  //   Ctrl+Z/Y undo/redo · Ctrl+C/V copy/paste · Ctrl+A select all
  //   Ctrl+S save · Ctrl+O open · Ctrl+/ reference · Ctrl+, settings
  useEffect(() => {
    // Expand/collapse + autofit resolve the same target set: selected groups +
    // the group of any selected member, or all groups when nothing is selected.
    // Factored out so the key handler stays readable.
    function resolveGroupTargets(): GroupNode[] {
      const editor = editorRef.current;
      if (!editor) return [];
      const groups = editor.getNodes().filter((n): n is GroupNode => n instanceof GroupNode);
      if (groups.length === 0) return [];
      const selected = editor.getNodes().filter((n) => (n as { selected?: boolean }).selected);
      if (selected.length === 0) return groups;
      const set = new Set<GroupNode>();
      for (const n of selected) {
        if (n instanceof GroupNode) set.add(n);
        else { const g = groups.find((gr) => gr.members.includes(n.id)); if (g) set.add(g); }
      }
      return [...set];
    }
    function expandCollapseGroups() {
      const editor = editorRef.current;
      const area = areaRef.current;
      if (!editor || !area) return;
      const targets = resolveGroupTargets();
      if (targets.length === 0) return;
      const collapse = targets.some((g) => !g.collapsed); // any expanded → collapse all
      // Persist the collapse state (saved via each Group's init.collapsed) — else
      // an expand/collapse was lost on reload.
      void setGroupsCollapsed(editor, area, targets, collapse).then(() => scheduleAutosave());
    }
    function autofitGroups() {
      const editor = editorRef.current;
      const area = areaRef.current;
      if (!editor || !area) return;
      const targets = resolveGroupTargets();
      void (async () => { for (const g of targets) await autofitGroupWithHistory(editor, area, g); })();
    }
    // `[` / `]` rotate whatever rotatable thing is selected by one step in
    // direction `dir` (-1 = CCW, +1 = CW). Covers a selected Standoff (its own
    // exclusive selection — rotates the axis 45°), and selected Conduits (45°
    // quantum) / Angle Dial nodes (each node's own `step`). Returns the count
    // rotated so the caller only swallows the key when something happened.
    function rotateSelection(dir: number): number {
      // Standoff selection is standoff-local and mutually exclusive with nodes,
      // so handle it first and on its own. Mirror the inspector dial's onAngle:
      // current axis angle ± 45° → vector → nearest compass anchor.
      const standoffSel = standoffStore.selected();
      if (standoffSel) {
        const s = standoffStore.get(standoffSel);
        if (!s) return 0;
        const d = ANCHOR_DIR[s.a.anchor];
        const cur = (Math.atan2(d.y, d.x) * 180) / Math.PI;
        const rad = ((cur + dir * 45) * Math.PI) / 180;
        standoffStore.setAxis(s.id, anchorFromVector(Math.cos(rad), Math.sin(rad)));
        settleStandoffs();
        scheduleAutosave();
        return 1;
      }
      const editor = editorRef.current;
      if (!editor) return 0;
      let conduits = 0, dials = 0;
      for (const n of editor.getNodes()) {
        if ((n as { selected?: boolean }).selected !== true) continue;
        if (n instanceof ConduitNode) { n.rotateBy(dir); conduits++; }
        else if (n instanceof AngleDialNode) {
          const next = Math.round(n.value + dir * n.step);
          n.value = ((next % 360) + 360) % 360;
          dials++;
        }
      }
      if (conduits) bumpConduitAngle();   // re-renders conduits across React roots
      if (dials) { void processGraph(); scheduleAutosave(); } // recompute + re-render dials, propagate downstream
      return conduits + dials;
    }
    // Move the selected node(s) by (dx, dy) — the arrow-key nudge. Each affected
    // node moves exactly once: the selection plus the members of any selected
    // group (so a group carries its contents like a drag). area.translate is
    // auto-recorded by the history plugin, so the nudge is undoable; merged with
    // a drag's own translate actions. Docked FCs follow their host; standoffs
    // re-settle. Caller checks the selection synchronously to decide preventDefault.
    async function nudgeSelection(dx: number, dy: number) {
      const editor = editorRef.current;
      const area = areaRef.current;
      if (!editor || !area) return;
      // Build the full move set: a selected GROUP carries its members, and
      // touching any node in a STANDOFF cluster carries the whole cluster, so a
      // standoffed pair moves rigidly (moving only one end and re-settling pulls
      // it half-way back — the bug: a standoffed note/group nudged half as far as
      // a free one). See expandMoveSet.
      const selectedIds = editor.getNodes()
        .filter((n) => (n as { selected?: boolean }).selected === true)
        .map((n) => n.id);
      const toMove = expandMoveSet(editor, selectedIds);
      for (const id of toMove) {
        const v = area.nodeViews.get(id);
        if (!v) continue;
        await area.translate(id, { x: v.position.x + dx, y: v.position.y + dy });
        repositionDockedNodes(id); // a docked FC rides along with its host
      }
      // Whole clusters moved uniformly, so this is a no-op for them; it just
      // tidies any incidental band state.
      if (!standoffStore.isEmpty()) settleStandoffs();
      scheduleAutosave();
    }

    async function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const editable = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!target?.isContentEditable;

      // A heavy recompute is running: the compute overlay blocks pointer input, so
      // block the canvas keyboard shortcuts too (add/group/tidy/undo…) — a queued key
      // must not mutate the graph mid-pass. This listener only drives canvas
      // shortcuts; a focused field's own handlers are untouched.
      if (computeOverlayStore.visible()) return;

      // The Composite drill-in editor is open: the overlay owns the keyboard
      // (its own Delete/Escape handling); canvas shortcuts must not reach the
      // OUTER graph underneath it.
      if (compositeEditorStore.isOpen() && e.key !== "F9") return;

      // Presenter mode: the overlay owns the keyboard (advance/back/Esc on its
      // own window listener). Without this gate the arrow keys ALSO nudge the
      // still-selected Presentation node 24px per slide on the hidden canvas,
      // and every bare-letter/Ctrl shortcut mutates the graph mid-show.
      if (presentationStore.isActive() && e.key !== "F9") return;

      // F9 — Calculate now (Excel). Recomputes + rerolls volatiles in ANY mode; in
      // manual mode it's the only thing that recomputes. Global, even while typing —
      // and even while PRESENTING or DRILLED INTO a composite (the gates above
      // exempt it): both overlays hide/cover the StatusBar chip + MenuBar item, so
      // in manual/sketch mode F9 is the ONLY remaining recompute path there. Only
      // the compute-overlay gate outranks it (never queue a recompute mid-pass).
      if (e.key === "F9") { e.preventDefault(); void requestRecalc(); return; }

      // Single-key canvas shortcuts (no modifier; ignored while typing). Esc
      // exits isolate. The bare letters drive the graph-domain actions so the
      // Ctrl+Shift chords aren't needed; modifier combos fall through below.
      if (!editable && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Command palette: bare Enter, guarded by the exact same `editable`
        // check every other single-key shortcut uses, so committing a text
        // field with Enter never opens it. Also stays out from under any
        // other modal already open (each of those either focuses an input,
        // which `editable` already covers, or — like Settings' switches — is
        // a non-input control that `editable` wouldn't catch on its own).
        if (
          e.key === "Enter" && !paletteStore.get() && !menu &&
          !frStore.get() && !settingsPanel.get() && !shortcutsStore.get()
        ) {
          paletteStore.open(); e.preventDefault(); return;
        }
        if (e.key === "Escape" && isolateStore.isActive()) {
          isolateStore.exit(); e.preventDefault(); return;
        }
        // Arrow keys nudge the selected node(s): one grid cell (24px), Shift =
        // four cells (96px). Handled before the !shiftKey split so Shift just
        // scales the step. Decide preventDefault synchronously (the move is async).
        if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
          const editor = editorRef.current;
          const hasSel = !!editor && editor.getNodes().some((n) => (n as { selected?: boolean }).selected === true);
          if (hasSel) {
            const step = e.shiftKey ? DOT_SPACING * 4 : DOT_SPACING;
            const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
            const dy = e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0;
            void nudgeSelection(dx, dy);
            e.preventDefault(); return;
          }
          return; // nothing selected → no nudge, and no other shortcut on an arrow
        }
        if (!e.shiftKey) {
          const editor = editorRef.current;
          const area = areaRef.current;
          // Rotate the selected rotatable thing (Conduit / Angle Dial node /
          // Standoff). Match the produced CHARACTER, not e.code: `[` / `]` sit on
          // different physical keys across keyboard layouts, and the reference
          // shows the character. `[` = CCW, `]` = CW.
          // Tab toggles all collapsible chrome (navigator + pin / alert HUDs) as
          // one group — collapse all if any is open, else expand all. BUT Tab is
          // also the browser's focus-traversal key, so only hijack it when focus
          // is on the canvas BACKGROUND (body) — never when it sits on a control
          // (a node's button / chevron / field, a panel item), where Tab must
          // move between that element's own focusable siblings. `editable` above
          // already let inputs through; this also covers focusable NON-inputs
          // inside a node, which otherwise randomly tabbed out and toggled chrome
          // mid-edit.
          if (e.key === "Tab") {
            const onBackground =
              target == null || target === document.body || target === document.documentElement;
            if (onBackground && toggleAllChrome() > 0) { e.preventDefault(); return; }
            return; // on a control → let native focus traversal happen
          }
          if (e.key === "[" || e.key === "]") {
            if (rotateSelection(e.key === "]" ? 1 : -1) > 0) { e.preventDefault(); return; }
            // nothing rotatable selected → leave the key alone (falls through;
            // the e.code switch below has no bracket case, so it's a no-op).
          }
          switch (e.code) {
            case "KeyI": // Isolate the selection / exit if already isolating
              if (isolateStore.isActive()) isolateStore.exit(); else isolateSelection();
              e.preventDefault(); return;
            case "KeyA": // Add node at the cursor
              addMenuRequest.open(screenMouseRef.current.x, screenMouseRef.current.y);
              e.preventDefault(); return;
            case "KeyG": // Group the selection (no-op if nothing is selected)
              if (editor && area && editor.getNodes().some((n) => (n as { selected?: boolean }).selected)) {
                void createGroupFromSelection(editor, area).then(() => processGraph());
              }
              e.preventDefault(); return;
            case "KeyT": // Tidy / auto-arrange the selection, or all
              void tidyGraph(); e.preventDefault(); return;
            case "KeyC": // Cleanup: tidy groups → collapse → tidy top level → fit
              void cleanupGraph(); e.preventDefault(); return;
            case "KeyE": // Expand / collapse groups
              expandCollapseGroups(); e.preventDefault(); return;
            case "KeyF": // Autofit group box to members
              autofitGroups(); e.preventDefault(); return;
            case "KeyN": // Toggle the Navigator (outline) panel
              toggleChrome("navigator"); e.preventDefault(); return;
            case "BracketLeft":  // Rotate the selected rotatable thing one step CCW
            case "BracketRight": // …or CW (Conduit / Angle Dial node / Standoff)
              if (rotateSelection(e.code === "BracketRight" ? 1 : -1) > 0) {
                e.preventDefault(); return;
              }
              break; // nothing rotatable selected → leave the key alone
          }
        }
      }

      // Ctrl/Cmd shortcuts
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+/ opens function reference, Ctrl+, opens settings (both allowed
        // even when an input is focused). e.key (not e.code) for the slash: it's
        // a punctuation mark that moves around on non-US layouts, unlike the
        // letter-mnemonic shortcuts below which are meant to stay at the same
        // physical position regardless of layout.
        if (e.key === "/") { frStore.toggle(); e.preventDefault(); return; }
        if (e.code === "Comma") { settingsPanel.toggle(); e.preventDefault(); return; }
        // Save / Save As / Open work even while a node field is focused (and must
        // preventDefault to block the browser's own save/open dialogs).
        if (e.code === "KeyS") { void saveToDisk({ forceDialog: e.shiftKey }); e.preventDefault(); return; }
        if (e.code === "KeyO") { void openFromDisk(); e.preventDefault(); return; }
        // Ctrl+Shift+L: genuine reload of the current document (replays the
        // cinematic). A deliberate combo so it can't fire by accident; avoids the
        // browser's own reload keys (Ctrl+R / Ctrl+Shift+R / F5).
        if (e.code === "KeyL" && e.shiftKey) { void documentStore.reloadCurrent(); e.preventDefault(); return; }
        if (editable) return;
        // Ctrl+Shift+G: collapse the selected nodes into a Composite — the
        // computing-subgraph counterpart to bare-G's Group (which just frames
        // a selection). Mirrors createGroupFromSelection's own hotkey guard.
        if (e.code === "KeyG" && e.shiftKey) {
          const editor = editorRef.current;
          const area = areaRef.current;
          if (editor && area && editor.getNodes().some((n) => (n as { selected?: boolean }).selected)) {
            void createCompositeFromSelection(editor, area);
          }
          e.preventDefault(); return;
        }
        // Select all: capture Ctrl/Cmd+A so the browser doesn't select page
        // text — select every node instead (deleting/moving them takes their
        // cables along).
        if (e.code === "KeyA") {
          const editor = editorRef.current;
          if (editor) {
            unselectAllNodesFromProcess();
            cableSelectionStore.set(null);
            editor.getNodes().forEach((n, i) => selectNodeFromProcess(n.id, i > 0));
          }
          e.preventDefault(); return;
        }
        // Copy/paste
        if (e.code === "KeyC") {
          copySelected(); e.preventDefault(); return;
        }
        if (e.code === "KeyV") {
          if (isolateStore.isActive()) { e.preventDefault(); return; } // no new nodes while isolating
          const area = areaRef.current;
          const container = containerRef.current;
          if (area && container) {
            const { x: tx, y: ty, k } = area.area.transform;
            const rect = container.getBoundingClientRect();
            const canvasX = (screenMouseRef.current.x - rect.left - tx) / k;
            const canvasY = (screenMouseRef.current.y - rect.top - ty) / k;
            void pasteClipboard(canvasX, canvasY);
          }
          e.preventDefault(); return;
        }
        // History
        const history = historyRef.current;
        if (!history) return;
        // Gate undo/redo: a single action can restore/remove MANY cables (undoing a
        // bulk delete or a paste), and each would otherwise fire the per-cable settle
        // → O(cables × nodes). withGraphRebuild suppresses that and settles once, but
        // only if topology actually changed (undoing a node move pays nothing).
        if (e.code === "KeyZ" && !e.shiftKey) { void withGraphRebuild(() => history.undo()); e.preventDefault(); return; }
        if (e.code === "KeyZ" &&  e.shiftKey) { void withGraphRebuild(() => history.redo()); e.preventDefault(); return; }
        if (e.code === "KeyY")                { void withGraphRebuild(() => history.redo()); e.preventDefault(); return; }
        return;
      }

      // Delete: selected cable first, then selected nodes.
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (editable) return;
      await deleteSelected();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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

  // Shift-drag lasso selection. AutoCAD-style: CW winding (positive
  // signed area in screen coords) = touch / crossing — any overlap with
  // a node selects it. CCW winding = window / enclose — only nodes
  // fully inside the lasso are selected.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const points: Pt[] = [];
    let active = false;

    // Node screen-corners, cached once at lasso start. A lasso owns the pointer,
    // so the canvas can't pan/zoom and nodes can't move during it — their rects
    // are stable. Reading them once kills the O(N) getBoundingClientRect (a
    // forced reflow) that otherwise ran every coalesced frame.
    let nodeCorners: Array<{ id: string; corners: Pt[] }> = [];
    // Signature of the last applied node match, so an unchanged set (lasso grew
    // but crossed no new node) skips the unselect-all + reselect churn.
    let lastNodeSig = "";
    function cacheNodeRects() {
      const area = areaRef.current;
      nodeCorners = [];
      if (!area) return;
      const cr = container!.getBoundingClientRect();
      for (const [id, view] of area.nodeViews) {
        const br = view.element.getBoundingClientRect();
        nodeCorners.push({ id, corners: [
          { x: br.left  - cr.left, y: br.top    - cr.top },
          { x: br.right - cr.left, y: br.top    - cr.top },
          { x: br.right - cr.left, y: br.bottom - cr.top },
          { x: br.left  - cr.left, y: br.bottom - cr.top },
        ] });
      }
    }

    // applyLasso is heavy — it bbox-tests every node AND (on release) samples
    // every cable's SVG path (getTotalLength/getPointAtLength). `pointermove`
    // fires at the mouse's poll rate (well above the refresh rate on a gaming
    // mouse), so running it per move saturates the main thread. Coalesce to at
    // most one apply per animation frame; the visual lasso outline still updates
    // per move. Live frames select nodes only — the precise cable hit-test is
    // deferred to release (drop), off the hot path.
    let lassoRaf = 0;
    let latestMode: "touch" | "enclose" = "touch";
    const scheduleApply = (mode: "touch" | "enclose") => {
      latestMode = mode;
      if (lassoRaf) return;
      lassoRaf = requestAnimationFrame(() => {
        lassoRaf = 0;
        if (active && points.length >= 3) applyLasso(points, latestMode, false);
      });
    };

    function relPoint(e: PointerEvent): Pt {
      const r = container!.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function modeOf(pts: Pt[]) {
      return signedArea(pts) > 0 ? "touch" : "enclose";
    }

    function onDown(e: PointerEvent) {
      // Shift-drag (desktop) or touch select mode (mobile) starts a lasso; a
      // plain primary-button drag otherwise falls through to the area pan.
      const selectMode = touchSelectStore.get();
      if ((!e.shiftKey && !selectMode) || e.button !== 0) return;
      // Multi-touch is a pinch / two-finger pan, NEVER a lasso. If a second finger
      // lands (this pointer OR a lasso already in flight), abort the lasso and let
      // this pointer reach the area WITHOUT stopPropagation, so rete can pan/zoom.
      // (activePointersRef already counts this pointer — the window-capture tracker
      // runs before this container-capture handler.) Checked before the node-target
      // test so a second finger landing on a node still releases the lasso.
      if (active || activePointersRef.current.size >= 2) {
        cancelLasso();
        return;
      }
      // Don't start a lasso when the click landed on a node or a socket inside
      // one (so click-drag-on-socket cable creation isn't stolen, and tapping a
      // note/group in touch-select mode selects it rather than lassoing). Test
      // area.nodeViews containment — the authoritative node-root check per
      // CLAUDE.md. A CSS class list (`.solenoid-node, …`) silently misses
      // whichever roots it forgot: this one omitted `.solenoid-note` and
      // `.solenoid-group`, so a touch on either wrongly began a lasso.
      const target = e.target as Element | null;
      const area = areaRef.current;
      if (target && area) {
        for (const [, v] of area.nodeViews) if (v.element.contains(target)) return;
      }
      e.preventDefault();
      // Desktop shift-lasso: stop the press reaching rete's area drag, or it pans
      // while you lasso. Mobile select mode does NOT stopPropagation — rete's Drag
      // (pan) handler is disabled for the duration instead (see the select-mode
      // effect), and the ZOOM handler must still SEE this pointer so a second finger
      // makes a 2-finger pinch/pan (stopPropagation here hid finger 1 from it, which
      // is why zoom never worked in select mode).
      if (!selectMode) e.stopPropagation();
      active = true;
      points.length = 0;
      points.push(relPoint(e));
      lastNodeSig = "";
      cacheNodeRects();
      setLasso({ points: [...points], mode: "touch" });
      lassoActiveStore.set(true); // let the canvas renderer take over for the lasso
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }
    function onMove(e: PointerEvent) {
      if (!active) return;
      // A finger joined mid-drag (pinch/pan) — bail even if this pointer's own
      // moves keep firing (the resting first finger's wouldn't).
      if (activePointersRef.current.size >= 2) { cancelLasso(); return; }
      const p = relPoint(e);
      const last = points[points.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < 3) return;
      points.push(p);
      const mode: "touch" | "enclose" = modeOf(points);
      setLasso({ points: [...points], mode });
      // Live selection — coalesced to one apply per frame (see scheduleApply) so
      // nodes light up / dim as the lasso grows without per-move thrash.
      if (points.length >= 3) scheduleApply(mode);
    }
    function onUp() {
      if (!active) return;
      active = false;
      lassoActiveStore.set(false); // hand back to the DOM (after the canvas settle)
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      // Flush a final apply so the release selection is exact (a coalesced frame
      // may still be pending, or the last move may not have applied yet).
      if (lassoRaf) { cancelAnimationFrame(lassoRaf); lassoRaf = 0; }
      if (points.length >= 3) applyLasso(points, latestMode, true);
      setLasso(null);
    }
    // Abort an in-flight lasso WITHOUT applying it — used when a gesture turns out
    // to be a pinch / two-finger pan. Leaves the current selection untouched (a
    // clean 2-finger gesture lands both fingers before the first builds a polygon).
    function cancelLasso() {
      if (!active) return;
      active = false;
      lassoActiveStore.set(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (lassoRaf) { cancelAnimationFrame(lassoRaf); lassoRaf = 0; }
      setLasso(null);
    }

    function applyLasso(pts: Pt[], mode: "touch" | "enclose", includeCables: boolean) {
      const editor = editorRef.current;
      const area = areaRef.current;
      if (!editor || !area) return;
      const matched: string[] = [];
      for (const { id, corners } of nodeCorners) {
        let hit = false;
        if (mode === "enclose") {
          hit = corners.every((c) => pointInPolygon(c, pts));
        } else {
          hit = corners.some((c) => pointInPolygon(c, pts))
             || pointInPolygon(pts[0], corners)        // lasso wholly inside node
             || polygonIntersectsBBox(pts, corners);
        }
        if (hit) matched.push(id);
      }
      // Skip the re-apply when the match set is unchanged from the last frame —
      // unselect-all + reselect re-renders every selected node, so this avoids
      // per-frame churn while the lasso grows over empty space.
      const sig = mode + "|" + matched.join(",");
      if (sig !== lastNodeSig) {
        lastNodeSig = sig;
        unselectAllNodesFromProcess();
        for (let i = 0; i < matched.length; i++) {
          // First node replaces; rest accumulate.
          selectNodeFromProcess(matched[i], i > 0);
        }
      }

      // Precise cable hit-testing is deferred to release (drop) — it samples
      // every cable's SVG path, far too heavy for the per-frame hot path.
      if (!includeCables) return;

      // Cables: sample each cable's rendered hit paths (canvas coords → screen
      // via the area transform) and test the samples against the polygon.
      // Touch mode: any sample inside selects; enclose: every sample must be
      // inside. A Ribbon is one entity — its members are judged as a unit and
      // selected together.
      const { x: tx, y: ty, k } = area.area.transform;
      const unitHit = (unit: string[]): boolean => {
        let any = false;
        let all = true;
        let samples = 0;
        for (const id of unit) {
          const el = area.connectionViews.get(id)?.element;
          if (!el) continue;
          for (const path of el.querySelectorAll<SVGPathElement>("path.solenoid-cable-hit")) {
            let len = 0;
            try { len = path.getTotalLength(); } catch { continue; }
            if (!Number.isFinite(len) || len <= 0) continue;
            // ~every 12 screen px, capped so a very long cable stays cheap.
            const step = Math.max(12 / k, len / 64);
            for (let d = 0; ; d += step) {
              const at = Math.min(d, len);
              const p = path.getPointAtLength(at);
              samples++;
              if (pointInPolygon({ x: p.x * k + tx, y: p.y * k + ty }, pts)) any = true;
              else all = false;
              // Early out once the verdict can't change.
              if (mode === "touch" && any) return true;
              if (mode === "enclose" && !all) return false;
              if (at >= len) break;
            }
          }
        }
        return samples > 0 && (mode === "enclose" ? all : any);
      };
      const matchedCables: string[] = [];
      const seen = new Set<string>();
      for (const conn of editor.getConnections()) {
        if (seen.has(conn.id) || cableGhostStore.isGhost(conn.id)) continue;
        const ribbon = ribbonForConnection(editor, conn);
        const unit = ribbon ? ribbon.members.map((m) => m.id) : [conn.id];
        for (const id of unit) seen.add(id);
        if (unitHit(unit)) matchedCables.push(...unit);
      }
      cableSelectionStore.replaceAll(matchedCables);
    }

    container.addEventListener("pointerdown", onDown, true);
    return () => {
      container.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (lassoRaf) cancelAnimationFrame(lassoRaf);
    };
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
      // ELK (rete-auto-arrange-plugin + its elkjs dependency) is a heavy chunk that
      // only Tidy needs, so it's LAZY: imported and wired on the first arrange, not
      // at Canvas init (recharts/KaTeX are lazy the same way). `ensureArrange`
      // dynamically imports the plugin, builds it once, registers it on the area, and
      // memoizes; every later Tidy reuses the same instance. Until then ELK stays out
      // of the main bundle.
      let arrange: AutoArrangePlugin<Schemes> | null = null;
      let arrangeLoading: Promise<AutoArrangePlugin<Schemes> | null> | null = null;
      const ensureArrange = (): Promise<AutoArrangePlugin<Schemes> | null> => {
        if (arrange) return Promise.resolve(arrange);
        if (arrangeLoading) return arrangeLoading;
        arrangeLoading = (async () => {
          const { AutoArrangePlugin } = await import("rete-auto-arrange-plugin");
          // A doc switch / unmount can destroy the area during the dynamic import.
          if (destroyed) return null;
          const plugin = new AutoArrangePlugin<Schemes>();
          // Port positions drive ELK's vertical node alignment (it lines up connected
          // ports). The stock `classic` preset puts OUTPUT ports at the node TOP and
          // INPUT ports at the BOTTOM, which staircases every chain upward — wrong for
          // our nodes. We place ports SYMMETRICALLY (same offset for in/out) so two
          // connected nodes line up, and read the Tidy-alignment setting per layout:
          //   "center" → ports at the node's vertical centre → node CENTRES align;
          //   "top"    → ports near the node's top → node TOP edges align.
          plugin.addPreset(() => ({
            port(data: { side: "input" | "output"; index: number; ports: number; width: number; height: number }) {
              const spacing = 16;
              const y = settingsStore.get("tidyAlign") === "top"
                ? 20 + data.index * spacing
                : data.height / 2 + (data.index - (data.ports - 1) / 2) * spacing;
              return { x: 0, y, width: 15, height: 15, side: data.side === "output" ? "EAST" : "WEST" } as const;
            },
          }));
          area.use(plugin);
          arrange = plugin;
          return plugin;
        })();
        return arrangeLoading;
      };

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
            const view = area.nodeViews.get(end.nodeId);
            const node = editor.getNode(end.nodeId);
            if (!view || !node) continue;
            m.set(end.nodeId, {
              x: view.position.x,
              y: view.position.y,
              w: view.element.offsetWidth || (node as { width?: number }).width || 100,
              h: view.element.offsetHeight || (node as { height?: number }).height || 50,
            });
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

      // Expose auto-arrange so the nav-menu "tidy" button can trigger
      // an ELK layout pass. The Conduit declares all its lanes up-front,
      // which would make ELK treat it as a tall multi-port node and
      // shove it far away from its neighbours. We hand ELK a Proxy
      // that exposes only the *in-use* ports, so the Conduit lays out
      // as the small node it visually is. The Proxy preserves `id`,
      // so the applier still translates the real node.
      const arrangeFn = async (opts?: { groupId?: string; skipConfirm?: boolean; skipPush?: boolean }) => {
        // Scope: selected nodes if any are selected, otherwise the whole
        // graph. Tidy is a big, hard-to-undo visual change, so past a
        // threshold we confirm before rearranging.
        const all = editor.getNodes();
        const selected = all.filter((n) => (n as { selected?: boolean }).selected);

        // Group-aware Tidy. Build member→group for every group.
        const allGroups = all.filter((n): n is GroupNode => n instanceof GroupNode);
        const memberOf = new Map<string, GroupNode>();
        for (const g of allGroups) for (const m of g.members) memberOf.set(m, g);

        // A group's own Tidy button (opts.groupId): lay out exactly that group's
        // members within its box, regardless of the current selection. Same flow
        // as Case A below, just forced and unconditional.
        const forcedGroup = opts?.groupId
          ? allGroups.find((g) => g.id === opts.groupId) ?? null
          : null;

        const targets = forcedGroup
          ? forcedGroup.members.map((id) => editor.getNode(id)).filter((n): n is Schemes["Node"] => !!n)
          : (selected.length > 0 ? selected : all);
        if (targets.length === 0) return;

        // Case A — selection is entirely members of one group: lay them out
        // WITHIN the box (and autogrow it). It runs through the same flow below
        // (so docked-FC footprint reservation + edge bridging still apply); only
        // the re-anchor target and the post-layout box-grow differ.
        let withinGroup: GroupNode | null = forcedGroup;
        let tidyNodes: Schemes["Node"][] = targets;
        if (!forcedGroup && selected.length > 0 && selected.every((n) => memberOf.has(n.id))) {
          const grp = memberOf.get(selected[0].id)!;
          if (selected.every((n) => memberOf.get(n.id) === grp)) {
            withinGroup = grp;
            tidyNodes = grp.members.map((id) => editor.getNode(id)).filter((n): n is Schemes["Node"] => !!n);
          }
        }

        if (!withinGroup) {
          // Count what Tidy actually arranges: layout UNITS, not raw nodes. A
          // global tidy positions each group as one rigid unit (its members move
          // with it rather than being laid out individually) and skips docked
          // FCs — so a collapsed group with many hidden members still counts as
          // one. This mirrors layoutTargets' predicate below, keeping the dialog
          // honest about the scope of the change.
          const arrangedCount = targets.filter(
            (n) => !(n instanceof FormatControllerNode && !!dockedNodeStore.get(n.id)) && !memberOf.has(n.id),
          ).length;
          if (!opts?.skipConfirm && arrangedCount > TIDY_CONFIRM_THRESHOLD) {
            const scope = selected.length > 0 ? `${arrangedCount} selected` : `all ${arrangedCount}`;
            const ok = await requestConfirm({
              message: `Tidy will rearrange ${scope} nodes. Continue?`,
              confirmLabel: "Tidy",
            });
            if (!ok) return;
          }
        }

        // Clear the selection for the duration of the layout. A selected
        // node's translate triggers the selector's group-follow (it moves
        // every other selected node by the same delta to keep the group
        // together — the multi-drag mechanism), which compounds across the
        // applier's per-node placement and corrupts the result. Drop the
        // selection, lay out, then restore it.
        const selectedIds = selected.map((n) => n.id);
        if (selectedIds.length > 0) unselectAllNodesFromProcess();

        const conns = editor.getConnections();
        // Docked FCs are positional adornments on their hosts, not standalone
        // graph nodes. Exclude them from the layout and bridge their inline
        // edges (host → FC → consumer becomes host → consumer for ELK), so the
        // real graph lays out; the FCs are snapped back onto their hosts after.
        const dockedFcIds = new Set(
          tidyNodes
            .filter((n) => n instanceof FormatControllerNode && !!dockedNodeStore.get(n.id))
            .map((n) => n.id),
        );
        // Exclude docked FCs (positional adornments). For a global tidy also
        // exclude groups + their members (they tidy together via Case A, not
        // loose in the layout); for a within-group tidy, lay out exactly that
        // group's members.
        // Global tidy: keep GROUPS in the layout (positioned as rigid units),
        // exclude their members (they move with the group afterward). Within-group
        // tidy: keep exactly that group's members.
        const memberIds = new Set(memberOf.keys());
        const layoutTargets = tidyNodes.filter(
          (n) => !dockedFcIds.has(n.id) && (withinGroup ? true : !memberIds.has(n.id)),
        );

        // ── Standoff clusters lay out as ONE rigid block ──────────────────
        // ELK has no idea two standoffed nodes must stay together, so it
        // scatters them and the post-pass settle then yanks one onto the other
        // (overlaps). Collapse each fully-loose cluster into a leader: ELK sees
        // one bbox-sized node, and the members are re-placed at their stored
        // offsets afterward. All maps stay empty when there are no qualifying
        // clusters, so a graph without standoffs lays out exactly as before.
        const looseTargetIds = new Set(layoutTargets.map((n) => n.id));
        const clusterLeaderOf = new Map<string, string>();    // member -> leader
        const clusterMembersOf = new Map<string, string[]>(); // leader -> members
        const clusterMemberOffset = new Map<string, { dx: number; dy: number }>();
        const clusterLeaderSize = new Map<string, { w: number; h: number }>();
        // The leader's REAL size, restored after ELK (the applier resizes proxy
        // nodes to their reported size — here the whole-cluster bbox — so without
        // this the leader node grows to the block's footprint, like realHostSize).
        const clusterLeaderRealSize = new Map<string, { w: number; h: number }>();
        const clusterFollowers = new Set<string>();
        if (!standoffStore.isEmpty()) {
          const boxOf = (id: string) => {
            const v = area.nodeViews.get(id);
            if (!v) return null;
            const node = editor.getNode(id) as { width?: number; height?: number } | undefined;
            return {
              x: v.position.x, y: v.position.y,
              w: v.element?.offsetWidth || node?.width || 100,
              h: v.element?.offsetHeight || node?.height || 50,
            };
          };
          for (const cluster of standoffClusters(standoffStore.all())) {
            // Every member must be a loose layout target. A group qualifies — it
            // lays out as one rectangle, so a (group, note) pair is one block.
            // Anything excluded from the loose layout falls back to the settle.
            if (!cluster.every((id) => looseTargetIds.has(id))) continue;
            const boxes = cluster
              .map((id) => [id, boxOf(id)] as const)
              .filter((e): e is [string, NonNullable<ReturnType<typeof boxOf>>] => !!e[1]);
            if (boxes.length < 2) continue;
            const ox = Math.min(...boxes.map(([, b]) => b.x));
            const oy = Math.min(...boxes.map(([, b]) => b.y));
            const ex = Math.max(...boxes.map(([, b]) => b.x + b.w));
            const ey = Math.max(...boxes.map(([, b]) => b.y + b.h));
            // Leader = top-left-most member, preferring a non-group (a plain node
            // is a simpler ELK stand-in than a group, which carries its own
            // member-edge remapping).
            const leader = boxes.slice().sort((a, b) => {
              const ga = editor.getNode(a[0]) instanceof GroupNode ? 1 : 0;
              const gb = editor.getNode(b[0]) instanceof GroupNode ? 1 : 0;
              return ga !== gb ? ga - gb : (a[1].x + a[1].y) - (b[1].x + b[1].y);
            })[0][0];
            const leaderBox = boxes.find(([id]) => id === leader)![1];
            clusterLeaderRealSize.set(leader, { w: leaderBox.w, h: leaderBox.h });
            clusterMembersOf.set(leader, boxes.map(([id]) => id));
            clusterLeaderSize.set(leader, { w: ex - ox, h: ey - oy });
            for (const [id, b] of boxes) {
              clusterLeaderOf.set(id, leader);
              clusterMemberOffset.set(id, { dx: b.x - ox, dy: b.y - oy });
              if (id !== leader) clusterFollowers.add(id);
            }
          }
        }
        // Map a node to its ELK stand-in: a cluster follower/leader → its leader.
        const elkId = (id: string) => clusterLeaderOf.get(id) ?? id;

        const bridges: Schemes["Connection"][] = [];
        for (const fcId of dockedFcIds) {
          const ins  = conns.filter((c) => c.target === fcId && c.targetInput === "in");
          const outs = conns.filter((c) => c.source === fcId && c.sourceOutput === "out");
          for (const i of ins) for (const o of outs) {
            bridges.push({
              id: `tidy-bridge-${i.id}-${o.id}`,
              source: i.source, sourceOutput: i.sourceOutput,
              target: o.target, targetInput: o.targetInput,
            } as unknown as Schemes["Connection"]);
          }
        }
        // A group lays out as one node; remap any cable touching a member to the
        // group, so ELK positions the group by its real connections. The group
        // endpoint uses an EMPTY socket key → the plugin makes it a node-level
        // edge (no port to match). (Skipped for a within-group tidy.)
        if (!withinGroup) {
          for (const c of conns) {
            const sg = memberOf.get(c.source);
            const tg = memberOf.get(c.target);
            if (!sg && !tg) continue;
            const sId = sg ? sg.id : c.source;
            const tId = tg ? tg.id : c.target;
            if (sId === tId) continue; // internal to one group
            bridges.push({
              id: `tidy-gbridge-${c.id}`,
              source: sId, sourceOutput: sg ? "" : c.sourceOutput,
              target: tId, targetInput: tg ? "" : c.targetInput,
            } as unknown as Schemes["Connection"]);
          }
        }
        // When arranging a subset, only feed ELK the edges whose BOTH
        // endpoints are in the subset. An edge pointing at an excluded
        // node makes ELK throw → the layout silently fails and nothing
        // moves. (For the whole-graph case this keeps every edge.)
        // ELK sees one node per cluster (the leader); followers are excluded and
        // their edges remap to the leader as node-level edges (empty port key),
        // exactly like the group remap above. Identity when there are no clusters.
        const elkVisible = new Set(
          layoutTargets.filter((n) => !clusterFollowers.has(n.id)).map((n) => n.id),
        );
        const subsetConns = [...conns, ...bridges].flatMap((c) => {
          const s = elkId(c.source);
          const t = elkId(c.target);
          if (s === t || !elkVisible.has(s) || !elkVisible.has(t)) return [];
          return [{
            ...c,
            source: s, sourceOutput: s !== c.source ? "" : c.sourceOutput,
            target: t, targetInput: t !== c.target ? "" : c.targetInput,
          } as unknown as Schemes["Connection"]];
        });
        // Reserve each host's docked-FC area so ELK doesn't pack a neighbor into
        // it. ELK nodes are rectangles, so we feed it the bounding box of the
        // host + its output-docked FC: the host stays at the box's top-left and
        // the FC extends right (and down, from where its socket actually sits).
        const hostFootprint = new Map<string, { w: number; h: number }>();
        const realHostSize = new Map<string, { w: number; h: number }>();
        for (const fcId of dockedFcIds) {
          const fc = editor.getNode(fcId);
          if (!(fc instanceof FormatControllerNode) || fc.side !== "output") continue;
          const host = editor.getNode(fc.hostNodeId);
          const hostView = area.nodeViews.get(fc.hostNodeId);
          if (!host || !hostView) continue;
          const sc = getSocketScreenCenter(area, fc.hostNodeId, fc.socketKey, "output");
          const socketLocalY = sc
            ? screenToCanvas(area, container!, sc.x, sc.y).y - hostView.position.y
            : host.height / 2;
          const prev = hostFootprint.get(fc.hostNodeId) ?? { w: host.width, h: host.height };
          hostFootprint.set(fc.hostNodeId, {
            w: prev.w + fc.width + 8,
            h: Math.max(prev.h, socketLocalY + fc.height / 2),
          });
          if (!realHostSize.has(fc.hostNodeId)) realHostSize.set(fc.hostNodeId, { w: host.width, h: host.height });
        }

        const proxyNodes = layoutTargets.filter((n) => !clusterFollowers.has(n.id)).map((n) => {
          // A non-group standoff-cluster leader lays out as a single rectangle
          // sized to the whole cluster's bounding box, so ELK reserves room for
          // the block (its own ports stay, carrying real + remapped edges).
          const clusterSize = clusterLeaderSize.get(n.id);
          if (clusterSize && !(n instanceof GroupNode)) {
            return new Proxy(n, {
              get(target, prop) {
                if (prop === "width") return clusterSize.w;
                if (prop === "height") return clusterSize.h;
                return Reflect.get(target, prop);
              },
            });
          }
          // A group lays out as a single rectangle (its rendered box, or the
          // cluster bbox when it's a cluster leader) with no ports — edges to it
          // are node-level (see the gbridge above).
          if (n instanceof GroupNode) {
            const el = area.nodeViews.get(n.id)?.element;
            const gw = clusterSize?.w ?? (el?.offsetWidth || n.width);
            const gh = clusterSize?.h ?? (el?.offsetHeight || n.height);
            return new Proxy(n, {
              get(target, prop) {
                if (prop === "width") return gw;
                if (prop === "height") return gh;
                if (prop === "inputs")  return {};
                if (prop === "outputs") return {};
                return Reflect.get(target, prop);
              },
            });
          }
          const fp = hostFootprint.get(n.id);
          // The Conduit declares all its lanes up front, which would make ELK
          // treat it as a tall multi-port node. Expose only the in-use ports
          // (or one, when nothing is wired) so it lays out small.
          const isBundler = n instanceof ConduitNode;
          if (!fp && !isBundler) return n;
          let filteredInputs:  Record<string, unknown> | undefined;
          let filteredOutputs: Record<string, unknown> | undefined;
          if (isBundler) {
            const usedInputs = new Set<string>();
            const usedOutputs = new Set<string>();
            for (const c of conns) {
              if (c.target === n.id && typeof c.targetInput === "string") usedInputs.add(c.targetInput);
              if (c.source === n.id && typeof c.sourceOutput === "string") usedOutputs.add(c.sourceOutput);
            }
            // If nothing is wired yet, expose a single in / out so ELK still has
            // something to anchor to.
            if (usedInputs.size  === 0) usedInputs.add(Object.keys(n.inputs)[0]);
            if (usedOutputs.size === 0) usedOutputs.add(Object.keys(n.outputs)[0]);
            filteredInputs = {}; filteredOutputs = {};
            for (const k of usedInputs)  filteredInputs[k]  = (n.inputs  as Record<string, unknown>)[k];
            for (const k of usedOutputs) filteredOutputs[k] = (n.outputs as Record<string, unknown>)[k];
          }
          return new Proxy(n, {
            get(target, prop) {
              if (fp && prop === "width")  return fp.w;
              if (fp && prop === "height") return fp.h;
              if (filteredInputs  && prop === "inputs")  return filteredInputs;
              if (filteredOutputs && prop === "outputs") return filteredOutputs;
              return Reflect.get(target, prop);
            },
          });
        });
        // Anchor target. ELK lays out from origin (0,0); we shift the result back.
        // HORIZONTALLY we keep the LEFT edge (graphs flow left→right from where they
        // started). VERTICALLY we keep the CENTER, NOT the top: ELK routinely
        // flattens a tall / vertically-stacked cluster into a compact row, and
        // top-aligning that row drops the whole thing to the top of the old
        // footprint — the "tidy floats nodes up" bug. For a within-group tidy the
        // references are the box interior's left and vertical center. Both are
        // deterministic, so a tidy→autofit cycle in Cleanup stays a fixed point
        // (after autofit the interior wraps the members, so the centre is unchanged).
        let origMinX = Infinity;   // left edge to preserve
        let targetCy = 0;          // vertical centre to preserve
        if (withinGroup) {
          const gv = area.nodeViews.get(withinGroup.id);
          if (gv) {
            origMinX = gv.position.x + GROUP_PAD;
            const top = gv.position.y + GROUP_HEADER + GROUP_PAD;
            const bottom = gv.position.y + withinGroup.height - GROUP_PAD;
            targetCy = (top + bottom) / 2;
          }
        } else {
          let oldTop = Infinity, oldBottom = -Infinity;
          for (const n of layoutTargets) {
            const v = area.nodeViews.get(n.id);
            if (!v) continue;
            origMinX = Math.min(origMinX, v.position.x);
            oldTop = Math.min(oldTop, v.position.y);
            oldBottom = Math.max(oldBottom, v.position.y + (v.element?.offsetHeight || n.height));
          }
          targetCy = (oldTop + oldBottom) / 2;
        }

        // Remember each laid-out group's pre-move position so we can carry its
        // members along by the same delta afterward (members aren't in the layout).
        const groupOrigPos = new Map<string, { x: number; y: number }>();
        for (const n of layoutTargets) {
          if (n instanceof GroupNode) {
            const v = area.nodeViews.get(n.id);
            if (v) groupOrigPos.set(n.id, { x: v.position.x, y: v.position.y });
          }
        }

        // First Tidy pays the one-time ELK import here; later ones resolve instantly.
        // Null only if the area was destroyed mid-import — nothing left to lay out.
        const arrangePlugin = await ensureArrange();
        if (!arrangePlugin) return;
        await arrangePlugin.layout({
          nodes: proxyNodes as Schemes["Node"][],
          connections: subsetConns,
          // ELK spacing (the preset's `spacing` is only port placement). Widen
          // the gaps Tidy leaves so nodes — and their docked-FC footprints — get
          // breathing room: between layers (columns) and within a layer (rows).
          options: {
            "elk.layered.spacing.nodeNodeBetweenLayers": "55",
            "elk.spacing.nodeNode": "38",
          },
        });

        // Place each standoff cluster's members relative to where ELK put the
        // leader — which now occupies the cluster's bounding box top-left — so the
        // block keeps its internal layout. Done before the anchor calc so the
        // members' fresh positions feed it (followers weren't in the ELK pass).
        for (const [leader, members] of clusterMembersOf) {
          const lv = area.nodeViews.get(leader);
          if (!lv) continue;
          const baseX = lv.position.x;
          const baseY = lv.position.y;
          for (const mid of members) {
            const off = clusterMemberOffset.get(mid)!;
            await area.translate(mid, { x: baseX + off.dx, y: baseY + off.dy });
          }
        }

        // Shift the laid-out nodes: left edge → anchor left, vertical centre →
        // anchor centre.
        let newMinX = Infinity, newTop = Infinity, newBottom = -Infinity;
        for (const n of layoutTargets) {
          const v = area.nodeViews.get(n.id);
          if (!v) continue;
          newMinX = Math.min(newMinX, v.position.x);
          newTop = Math.min(newTop, v.position.y);
          newBottom = Math.max(newBottom, v.position.y + (v.element?.offsetHeight || n.height));
        }
        const dx = origMinX - newMinX;
        let dy = targetCy - (newTop + newBottom) / 2;
        // Within a group, never let centring lift members above the box header.
        if (withinGroup) {
          const gv = area.nodeViews.get(withinGroup.id);
          if (gv) {
            const interiorTop = gv.position.y + GROUP_HEADER + GROUP_PAD;
            if (newTop + dy < interiorTop) dy = interiorTop - newTop;
          }
        }
        if (Number.isFinite(dx) && Number.isFinite(dy) && (dx !== 0 || dy !== 0)) {
          for (const n of layoutTargets) {
            const v = area.nodeViews.get(n.id);
            if (!v) continue;
            await area.translate(n.id, { x: v.position.x + dx, y: v.position.y + dy });
          }
        }

        // Carry each group's members rigidly by the group's net move (members
        // were held out of the layout, so they keep their relative positions).
        for (const [gid, orig] of groupOrigPos) {
          const gv = area.nodeViews.get(gid);
          const grp = editor.getNode(gid);
          if (!gv || !(grp instanceof GroupNode)) continue;
          const gdx = gv.position.x - orig.x;
          const gdy = gv.position.y - orig.y;
          if (gdx === 0 && gdy === 0) continue;
          for (const mid of grp.members) {
            const mv = area.nodeViews.get(mid);
            if (!mv) continue;
            await area.translate(mid, { x: mv.position.x + gdx, y: mv.position.y + gdy });
          }
        }

        // Restore the real size of any host we enlarged for the layout — the
        // applier resized it to the reserved footprint; the FC occupies the rest.
        for (const [id, sz] of realHostSize) {
          await area.resize(id, sz.w, sz.h);
        }
        // Same for standoff-cluster leaders, which were sized to the cluster bbox
        // for the ELK pass — restore each to its real node size.
        for (const [id, sz] of clusterLeaderRealSize) {
          await area.resize(id, sz.w, sz.h);
        }

        // Drop the inline `height` the applier stamped on every arranged card.
        // area.resize (used above + by the applier to feed ELK's reserve-footprint
        // trick) writes a FIXED inline height on the card; post-layout that pin just
        // equals the node's content height — redundant, and it FREEZES the card so
        // the body can't shrink on collapse or grow when a row / taller value lands
        // (the reason clearPinnedHeight exists for formula edits, and why collapse
        // looked broken on tidied nodes). Clearing it returns every node to
        // content-driven height; positions are already applied via translate, and
        // width is harmless (fixed per node / React-managed for resizables). Groups
        // are skipped — their box is sized from React width/height props, not this.
        for (const n of layoutTargets) {
          if (n instanceof GroupNode) continue;
          const card = area.nodeViews.get(n.id)?.element.querySelector<HTMLElement>("*:not(span):not([fragment])");
          card?.style.removeProperty("height");
        }

        // Within-group tidy: autogrow the box around the freshly-laid-out
        // members, then refresh membership/collapse. Don't reframe the viewport.
        if (withinGroup) {
          let maxX = -Infinity, maxY = -Infinity;
          for (const n of layoutTargets) {
            const v = area.nodeViews.get(n.id);
            if (!v) continue;
            maxX = Math.max(maxX, v.position.x + v.element.offsetWidth);
            maxY = Math.max(maxY, v.position.y + v.element.offsetHeight);
          }
          const gv = area.nodeViews.get(withinGroup.id);
          const preW = withinGroup.width, preH = withinGroup.height;
          if (gv && Number.isFinite(maxX)) {
            withinGroup.width = Math.max(withinGroup.width, (maxX - gv.position.x) + GROUP_PAD);
            withinGroup.height = Math.max(withinGroup.height, (maxY - gv.position.y) + GROUP_PAD);
            await area.update("node", withinGroup.id);
          }
          rebuildGroupMembership(editor);
          syncGroupCollapse(editor, area);
          // A within-group Tidy can autogrow the box; if it did, push the
          // neighbouring nodes/groups off the grown edges (recording it so a
          // later collapse restores them) — the same engine as the expand push.
          // Cleanup skips this: it manages its own collapse/restore + re-tidy.
          if (!opts?.skipPush && (withinGroup.width > preW + 0.5 || withinGroup.height > preH + 0.5)) {
            pushForGrownGroups(editor, area, [withinGroup], new Map([[withinGroup.id, { w: preW, h: preH }]]));
          }
        }

        // Persist the new layout. Tidy moves every node via area.translate, but
        // nothing else schedules a save — so a whole-canvas or selection tidy was
        // lost on reload (only the within-group branch used to call this). The
        // 700ms autosave debounce reads positions at flush time, so the deferred
        // standoff/FC settle below is still captured.
        scheduleAutosave();

        // Restore the selection we cleared above.
        selectedIds.forEach((id, i) => selectNodeFromProcess(id, i > 0));

        // A SELECTION tidy frames just the arranged nodes, right away.
        if (!withinGroup && selectedIds.length > 0) await AreaExtensions.zoomAt(area, targets);

        // ELK lays out docked FCs as ordinary chain nodes; snap each back onto
        // its host once the hosts have settled. Deferred a frame so the sockets
        // render at the new host positions before we measure them.
        requestAnimationFrame(async () => {
          if (destroyed) return;
          const hosts = new Set<string>();
          for (const n of editor.getNodes()) {
            if (n instanceof FormatControllerNode && n.hostNodeId) hosts.add(n.hostNodeId);
          }
          for (const h of hosts) repositionDockedTo(h);
          // Standoffs re-settle around wherever ELK put things (the layered
          // layout doesn't know about them; the network does the last word).
          // forceLock so a standoff-connected cluster is pulled back together as
          // a rigid block, not just band-satisfied.
          settleStandoffs(undefined, { forceLock: true });
          // A WHOLE-CANVAS tidy fits AFTER the FCs settle, using the same chrome-
          // and collapse-aware fit as the navmenu / Cleanup — a raw zoomAt would
          // center in the full container and land content under the docked panels.
          if (!withinGroup && selectedIds.length === 0) {
            await new Promise<void>((r) => requestAnimationFrame(() => r()));
            if (!destroyed) await fitAll();
          }
        });
      };

      setAutoArrange(arrangeFn);

      // One-shot "Cleanup" (Ctrl+Shift+L): clear selection → tidy each group's
      // members + shrink its box to fit → collapse all groups → tidy the top
      // level → fit the view. Members are laid out inside their boxes first,
      // then the collapsed groups + loose nodes are arranged as units, so
      // nothing is tidied twice. Confirms past the same threshold as Tidy (it's
      // a bigger, harder-to-undo change), counting layout UNITS the same way.
      setCleanup(async () => {
        const allNodes = editor.getNodes();
        const groupsForCount = allNodes.filter((n): n is GroupNode => n instanceof GroupNode);
        const memberIds = new Set<string>();
        for (const g of groupsForCount) for (const m of g.members) memberIds.add(m);
        const unitCount = allNodes.filter(
          (n) => !(n instanceof FormatControllerNode && !!dockedNodeStore.get(n.id)) && !memberIds.has(n.id),
        ).length;
        if (unitCount > TIDY_CONFIRM_THRESHOLD) {
          const ok = await requestConfirm({
            message: `Cleanup will tidy, collapse, and re-fit all ${unitCount} items. Continue?`,
            confirmLabel: "Cleanup",
          });
          if (!ok) return;
        }

        unselectAllNodesFromProcess();
        cableSelectionStore.set(null);

        const groupsNow = () =>
          editor.getNodes().filter((n): n is GroupNode => n instanceof GroupNode);

        const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

        // 1. Tidy every group's members first. The within-group tidy snaps docked
        //    FCs back onto their hosts in a DEFERRED rAF, so a docked FC (a group
        //    member) is momentarily at its ELK chain position out to the right.
        const groups = groupsNow();
        for (const g of groups) await arrangeFn({ groupId: g.id, skipPush: true });
        // Let those deferred FC snap-backs (and their async translates) land
        // before measuring, or autofit would wrap the stale far-right FC spots
        // and pad the box on the right (the bug that didn't repro on a manual,
        // already-settled grip double-click). Two frames: one for the rAF to
        // fire, one for the translate guard to apply.
        await nextFrame(); await nextFrame();
        // Now shrink/grow each box to wrap its settled members.
        for (const g of groups) await autofitGroupBox(editor, area, g);

        // 2. Collapse every still-expanded group.
        const toCollapse = groupsNow().filter((g) => !g.collapsed);
        if (toCollapse.length) {
          for (const g of toCollapse) g.collapsed = true;
          syncGroupCollapse(editor, area);
          for (const g of toCollapse) {
            await area.update("node", g.id);
            settleCollapse(editor, area, g.id, g.members, false);
          }
        }

        // 3. Tidy the top level (groups as rigid collapsed units), no confirm.
        await arrangeFn({ skipConfirm: true });

        // 4. Fit — reuse the navmenu's chrome-aware fitAll (drops hidden
        // members, sizes collapsed groups to their compact box, frames into the
        // free rectangle between the docked panels). A raw zoomAt here centered
        // content in the full container, so it landed under the panels and
        // scaled off. Wait a frame first so step-3's translates + the collapse
        // settle before fitAll measures.
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        await fitAll();

        scheduleAutosave();
      });

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
        }, 160);
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
          // (see onZoomActivity); a plain pan needs nothing.
          if (ctx.type === "zoomed" || zooming) onZoomActivity();
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
          if (ctx.data.id === dragPickId && !standoffSolving && !standoffStore.isEmpty()) {
            const pinned = new Set<string>([ctx.data.id]);
            for (const n of editor.getNodes()) {
              if ((n as { selected?: boolean }).selected) pinned.add(n.id);
            }
            scheduleStandoffSettle(pinned);
          }
          standoffLayoutTick.bump();
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
  // A native listener on the canvas element sees the true DOM target.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Right-click / long-press inside an actively-edited text field (e.g. a Note's
      // body while editing) should get the BROWSER's native copy/paste menu, not
      // Solenoid's node menu. Bail before preventDefault so the native menu shows.
      const editable = target.closest("textarea, input, [contenteditable='true']");
      if (editable && editable === document.activeElement) return;
      e.preventDefault();
      // Socket → socket context menu (attach Format Controller, etc.).
      // The socket dot is only ~12px, and a click can land on the SVG child,
      // rete's wrapper, or the node body just off the dot. So: try an exact
      // hit first, then fall back to the nearest socket within a small radius
      // of the cursor. This makes the whole visible dot (and a little around
      // it) open the socket menu instead of falling through to Add.
      let socketEl = target.closest("[data-socket-key][data-socket-side][data-node-id]") as HTMLElement | null;
      if (!socketEl) {
        const SOCKET_HIT_PX = 11;
        let bestD = SOCKET_HIT_PX;
        el.querySelectorAll<HTMLElement>("[data-socket-key][data-socket-side][data-node-id]").forEach((s) => {
          const r = s.getBoundingClientRect();
          const d = Math.hypot(r.left + r.width / 2 - e.clientX, r.top + r.height / 2 - e.clientY);
          if (d <= bestD) { bestD = d; socketEl = s; }
        });
      }
      if (socketEl) {
        setSocketCtx({
          nodeId:    socketEl.dataset.nodeId    ?? "",
          socketKey: socketEl.dataset.socketKey ?? "",
          side:      (socketEl.dataset.socketSide ?? "output") as "input" | "output",
          screenX: e.clientX, screenY: e.clientY,
        });
        return;
      }
      // Cable hit path → cable context menu (insert Conduit, delete). The menu
      // acts on the whole multi-selection when the clicked cable is part of it,
      // otherwise on just the clicked cable (which gets selected for feedback).
      // Ribbons expand to their member lanes either way.
      const cablePath = target.closest("path.solenoid-cable-hit") as SVGPathElement | null;
      const clickedConnId = cablePath?.dataset.connId;
      if (clickedConnId) {
        const editor = editorRef.current;
        if (!editor || cableGhostStore.isGhost(clickedConnId)) return; // ghosts: no menu
        const conns = editor.getConnections();
        const expand = (id: string): string[] => {
          const conn = conns.find((c) => c.id === id);
          if (!conn || cableGhostStore.isGhost(id)) return [];
          const ribbon = ribbonForConnection(editor, conn);
          return ribbon ? ribbon.members.map((m) => m.id) : [id];
        };
        const clickedIds = expand(clickedConnId);
        if (clickedIds.length === 0) return;
        const selectedIds = new Set(cableSelectionStore.ids().flatMap(expand));
        let connIds: string[];
        if (clickedIds.some((id) => selectedIds.has(id))) {
          for (const id of clickedIds) selectedIds.add(id);
          connIds = [...selectedIds];
        } else {
          const clicked = conns.find((c) => c.id === clickedConnId)!;
          const ribbon = ribbonForConnection(editor, clicked);
          cableSelectionStore.set(ribbon ? ribbon.repId : clickedConnId);
          unselectAllNodesFromProcess();
          connIds = clickedIds;
        }
        setCableCtx({ connIds, screenX: e.clientX, screenY: e.clientY });
        return;
      }
      // On an item body (any node — regular, Note, or Group, but not a socket):
      // open the node menu (Isolate / Isolate chain, plus the Standoff link when
      // exactly two linkable items are selected and one of them was clicked).
      // Detect via the authoritative nodeViews map rather than a CSS class — node
      // roots vary (.solenoid-node, .solenoid-note, .solenoid-group) and rete adds
      // no shared wrapper class, so any class-based gate misses some node type.
      {
        const editor = editorRef.current;
        const area = areaRef.current;
        // Which node element (if any) was clicked?
        let clickedId: string | null = null;
        if (editor && area) {
          for (const [id, view] of area.nodeViews) {
            if (view.element.contains(target)) { clickedId = id; break; }
          }
        }
        if (editor && area && clickedId) {

        // Isolate acts on the selection if the clicked node is part of it,
        // otherwise on just the clicked node (no selection surgery on right-click).
        const selectedIds = editor.getNodes()
          .filter((n) => (n as { selected?: boolean }).selected)
          .map((n) => n.id);
        const seedIds = selectedIds.includes(clickedId) ? selectedIds : [clickedId];

        // Pinnable: a group (shows its readouts), or a real value node (has an
        // output), but not a bundler / FC.
        const clickedNode = editor.getNode(clickedId);
        const canPin = !!clickedNode && (
          clickedNode instanceof GroupNode || (
            Object.keys((clickedNode as unknown as { outputs?: Record<string, unknown> }).outputs ?? {}).length > 0
            && !(clickedNode instanceof ConduitNode)
            && !(clickedNode instanceof FormatControllerNode)
          )
        );

        // Standoff link offer: exactly two linkable items selected, one clicked.
        const grouped = new Set<string>();
        for (const n of editor.getNodes()) {
          if (n instanceof GroupNode) for (const m of n.members) grouped.add(m);
        }
        const linkable = (n: SolenoidNode) =>
          !(n instanceof ConduitNode) &&
          !(n instanceof FormatControllerNode) &&
          !grouped.has(n.id) &&
          !dockedNodeStore.get(n.id);
        const linkableSel = editor.getNodes().filter(
          (n) => (n as { selected?: boolean }).selected && linkable(n),
        );
        let standoff: { aId: string; bId: string } | undefined;
        if (
          linkableSel.length === 2 &&
          linkableSel.some((n) => n.id === clickedId) &&
          !standoffStore.hasPair(linkableSel[0].id, linkableSel[1].id)
        ) {
          standoff = { aId: linkableSel[0].id, bId: linkableSel[1].id };
        }

        const isComposite = clickedNode instanceof CompositeNode;
        setNodeCtx({ nodeId: clickedId, seedIds, screenX: e.clientX, screenY: e.clientY, canPin, isComposite, standoff });
        return;
        }
      }
      // Blank canvas → Add-node menu (suppressed while isolating — no new nodes).
      if (isolateStore.isActive()) return;
      setMenu({ screenX: e.clientX, screenY: e.clientY });
    };
    el.addEventListener("contextmenu", handler);
    return () => el.removeEventListener("contextmenu", handler);
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

  // Splice a Conduit into every cable of the selection: source → in_i and
  // out_i → target, lane-ordered top-to-bottom by each cable's midpoint. One
  // Conduit takes up to CONDUIT_MAX_LANES cables; a bigger selection gets
  // chunked into several. Each Conduit lands at its cables' midpoint centroid,
  // rotated (45°-snapped) to the mean flow direction.
  const handleInsertConduit = useCallback(async (target: CableContextTarget) => {
    const editor = editorRef.current;
    const area = areaRef.current;
    const container = containerRef.current;
    if (!editor || !area || !container) return;

    // Where the cable's endpoint actually is, in canvas coords. A socket on a
    // collapsed group's hidden member still MEASURES at its expanded position
    // (members hide via visibility, so their rects stay live) — but its cable
    // is drawn to the group-edge pill, so use the pill point, exactly like
    // ConnectionComponent does. Then the live socket rect; then the node
    // position as a last resort.
    const socketCanvasPoint = (nodeId: string, key: string, side: "input" | "output") => {
      const pill = side === "output"
        ? groupCollapseStore.outPillFor(nodeId, key)
        : groupCollapseStore.inPillFor(nodeId, key);
      if (pill) {
        const g = area.nodeViews.get(pill.groupId)?.position;
        if (g) {
          return {
            x: pill.side === "left" ? g.x : g.x + COLLAPSE_LAYOUT.width,
            y: g.y + pillY(pill.index),
          };
        }
      }
      const sc = getSocketScreenCenter(area, nodeId, key, side);
      if (sc && (sc.x !== 0 || sc.y !== 0)) return screenToCanvas(area, container, sc.x, sc.y);
      const np = area.nodeViews.get(nodeId)?.position;
      if (!np) return null;
      const node = editor.getNode(nodeId);
      return {
        x: np.x + (side === "output" ? node?.width ?? 100 : 0),
        y: np.y + (node?.height ?? 60) / 2,
      };
    };

    // One LANE per unique source socket, not per cable: a value fanning out to
    // several targets (B→B1, B→B2) rides the Conduit once — B→in_i, and the
    // fan-out moves to the Conduit's output (out_i→B1, out_i→B2).
    type Lane = { conns: SolenoidConnection[]; mid: Pt; dir: Pt };
    const laneBySource = new Map<string, { conns: SolenoidConnection[]; mids: Pt[]; dirs: Pt[] }>();
    for (const id of target.connIds) {
      const conn = editor.getConnections().find((c) => c.id === id);
      if (!conn) continue;
      const s = socketCanvasPoint(conn.source, conn.sourceOutput, "output");
      const t = socketCanvasPoint(conn.target, conn.targetInput, "input");
      if (!s || !t) continue;
      const key = `${conn.source}::${conn.sourceOutput}`;
      const lane = laneBySource.get(key) ?? { conns: [], mids: [], dirs: [] };
      lane.conns.push(conn);
      lane.mids.push({ x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 });
      lane.dirs.push({ x: t.x - s.x, y: t.y - s.y });
      laneBySource.set(key, lane);
    }
    const lanes: Lane[] = [...laneBySource.values()].map((l) => ({
      conns: l.conns,
      mid: {
        x: l.mids.reduce((s2, p) => s2 + p.x, 0) / l.mids.length,
        y: l.mids.reduce((s2, p) => s2 + p.y, 0) / l.mids.length,
      },
      dir: {
        x: l.dirs.reduce((s2, p) => s2 + p.x, 0) / l.dirs.length,
        y: l.dirs.reduce((s2, p) => s2 + p.y, 0) / l.dirs.length,
      },
    }));
    if (lanes.length === 0) return;
    // Lane 0 is the Conduit's top row — order lanes by visual position so the
    // spliced cables don't cross.
    lanes.sort((a, b) => a.mid.y - b.mid.y || a.mid.x - b.mid.x);

    cableSelectionStore.clear();
    unselectAllNodesFromProcess();
    const created: string[] = [];
    for (let base = 0; base < lanes.length; base += CONDUIT_MAX_LANES) {
      const chunk = lanes.slice(base, base + CONDUIT_MAX_LANES);
      const cx = chunk.reduce((s2, it) => s2 + it.mid.x, 0) / chunk.length;
      let cy = chunk.reduce((s2, it) => s2 + it.mid.y, 0) / chunk.length;
      const dx = chunk.reduce((s2, it) => s2 + it.dir.x, 0);
      const dy = chunk.reduce((s2, it) => s2 + it.dir.y, 0);
      const angle = Math.round(((Math.atan2(dy, dx) * 180) / Math.PI) / 45) * 45;
      // Don't bury the new Conduit under an existing node: it renders at
      // z-index -1 (behind nodes), so a centroid that lands on a node body
      // would leave it invisible and unclickable. Nudge it below any covering
      // node. EXPANDED groups are background boxes (fine to sit inside);
      // COLLAPSED groups render an opaque summary card, so they're obstacles.
      // Members hidden inside a collapsed group hide via visibility (their
      // boxes still measure) — they're not really there, skip them.
      for (let pass = 0; pass < 4; pass++) {
        let bumped = false;
        for (const n of editor.getNodes()) {
          if (n instanceof GroupNode && !n.collapsed) continue;
          if (groupCollapseStore.isNodeHidden(n.id)) continue;
          const view = area.nodeViews.get(n.id);
          if (!view) continue;
          const w = view.element.offsetWidth || n.width || 0;
          const h = view.element.offsetHeight || n.height || 0;
          if (w === 0 || h === 0) continue;
          const p = view.position;
          if (
            cx + CONDUIT_PIVOT > p.x && cx - CONDUIT_PIVOT < p.x + w &&
            cy + CONDUIT_PIVOT > p.y && cy - CONDUIT_PIVOT < p.y + h
          ) {
            cy = p.y + h + CONDUIT_PIVOT + 16;
            bumped = true;
          }
        }
        if (!bumped) break;
      }
      const conduit = new ConduitNode({ angle }) as unknown as SolenoidNode;
      await editor.addNode(conduit);
      await area.translate(conduit.id, { x: cx - CONDUIT_PIVOT, y: cy - CONDUIT_PIVOT });
      for (let i = 0; i < chunk.length; i++) {
        const lane = chunk[i];
        const src = editor.getNode(lane.conns[0].source);
        if (!src) continue;
        for (const conn of lane.conns) {
          try { await editor.removeConnection(conn.id); } catch { /* already gone */ }
        }
        try {
          await editor.addConnection(
            new ClassicPreset.Connection(src, lane.conns[0].sourceOutput, conduit, conduitInKey(i)) as SolenoidConnection,
          );
        } catch { /* incompatible — leave disconnected */ }
        for (const conn of lane.conns) {
          const tgt = editor.getNode(conn.target);
          if (!tgt) continue;
          try {
            await editor.addConnection(
              new ClassicPreset.Connection(conduit, conduitOutKey(i), tgt, conn.targetInput) as SolenoidConnection,
            );
          } catch { /* incompatible — leave disconnected */ }
        }
      }
      created.push(conduit.id);
    }
    // Select the new Conduit(s) — feedback, and the expanded block shows its lanes.
    created.forEach((id, i) => selectNodeFromProcess(id, i > 0));
    await processGraph();
  }, []);

  // Create a Standoff between the two selected items: anchors face each other
  // along the dominant direction (one of 8 — sides for cardinal, corners for
  // diagonal), the band defaults to [gap, current distance] — "never closer
  // than a gap, never farther than where I placed it".
  // Shared with the value popups' Pin button (resolves the node's primary output,
  // or the empty key for a group whose chip shows its readouts). See pinStore.
  const handlePin = useCallback((nodeId: string) => pinNodeValue(nodeId), []);

  const handleLinkStandoff = useCallback((t: { aId: string; bId: string }) => {
    const editor = editorRef.current;
    const area = areaRef.current;
    if (!editor || !area) return;
    const boxOf = (id: string): StandoffBox | null => {
      const view = area.nodeViews.get(id);
      const node = editor.getNode(id) as { width?: number; height?: number } | undefined;
      if (!view || !node) return null;
      return {
        x: view.position.x,
        y: view.position.y,
        w: view.element.offsetWidth || node.width || 100,
        h: view.element.offsetHeight || node.height || 50,
      };
    };
    const ba = boxOf(t.aId);
    const bb = boxOf(t.bId);
    if (!ba || !bb) return;
    const anchor = anchorFromVector(
      bb.x + bb.w / 2 - (ba.x + ba.w / 2),
      bb.y + bb.h / 2 - (ba.y + ba.h / 2),
    );
    const opposite = OPPOSITE_ANCHOR[anchor];
    const pa = anchorPoint(ba, anchor);
    const pb = anchorPoint(bb, opposite);
    const axis = ANCHOR_DIR[anchor];
    const dist = Math.max(0, (pb.x - pa.x) * axis.x + (pb.y - pa.y) * axis.y);
    const min = Math.min(PUSH_GAP, dist);
    const s = standoffStore.add(
      { nodeId: t.aId, anchor },
      { nodeId: t.bId, anchor: opposite },
      min,
      Math.max(dist, min),
      true, // new standoffs lock to 45° by default; the toolbar can unlock
    );
    standoffStore.select(s.id);
    unselectAllNodesFromProcess();
    cableSelectionStore.set(null);
    settleStandoffs(); // apply the rigid 45° alignment right away
    scheduleAutosave();
  }, []);

  const handleCableDelete = useCallback(async (target: CableContextTarget) => {
    const editor = editorRef.current;
    if (!editor) return;
    cableSelectionStore.clear();
    for (const id of target.connIds) {
      cableGhostStore.commit(id);
      try { await editor.removeConnection(id); } catch { /* already gone */ }
    }
    await processGraph();
  }, []);

  const handleAttachFormat = useCallback(async (target: SocketContextTarget) => {
    const area      = areaRef.current;
    const editor    = editorRef.current;
    const container = containerRef.current;
    if (!area || !editor || !container) return;

    const fc = new FormatControllerNode({
      hostNodeId: target.nodeId,
      socketKey:  target.socketKey,
      side:       target.side,
    });
    await editor.addNode(fc as SolenoidNode);
    // dockSelf() was called by the nodecreated pipe — now position it.
    const rel = dockedNodeStore.get(fc.id);
    if (rel) {
      const pos = computeDockedCanvasPos(area, container, rel.hostNodeId, rel.socketKey, rel.side, fc.width, fc.height);
      if (pos) await area.translate(fc.id, pos);
    }
    // Insert it into the data path so the original value flows through it.
    await insertFcInline(editor, fc);
    await processGraph();
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

