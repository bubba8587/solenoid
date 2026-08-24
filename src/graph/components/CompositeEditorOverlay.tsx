import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ClassicPreset } from "rete";
import { AreaPlugin, AreaExtensions } from "rete-area-plugin";
import { ConnectionPlugin } from "rete-connection-plugin";
import { ReactPlugin } from "rete-react-plugin";
import { HistoryPlugin, Presets as HistoryPresets } from "rete-history-plugin";
import type { AutoArrangePlugin } from "rete-auto-arrange-plugin";
import { solenoidMinimapPreset, createSolenoidMinimap } from "./Minimap";
import {
  solenoidClassicRenderSetup, makeSolenoidConnectionFlow, installSurfacePointer,
  installSurfaceBackground, installSurfaceSemanticZoom, installPinchTranslateVeto,
  installNodeDragGuard,
} from "../areaPresets";
import { createTapCensus, installTapSelect } from "../tapSelect";
import { settingsStore } from "../settingsStore";
import type { Schemes, AreaExtra, SolenoidNode } from "../schemes";
import { CompositeNode, CompositeInputNode, CompositeOutputNode } from "../rete-nodes";
import { compositeEditorStore, compositePassStore } from "../compositeEditorStore";
import { getEditor, getArea, processGraph, isGraphRebuilding, withGraphRebuild, setCableDragging } from "../process";
import { setActiveGraph } from "../activeGraph";
import { syncSemanticZoomFor } from "../semanticZoomStore";
import { copySelected, pasteClipboard } from "../copyPaste";
import { scheduleAutosave } from "../persistence";
import { installErrorGuards } from "../errorValue";
import { ctorRegistry } from "../nodeCtorRegistry";
import { cableSelectionStore, socketHighlightStore, dragSocketKey } from "../cableState";
import { canvasLockStore } from "../canvasLock";
import { isolateStore } from "../isolateStore";
import { isolateSelection } from "../isolate";
import { pushNotice } from "../noticeStore";
import { buildCatalog } from "../catalogUtils";
import { AddNodeMenu, type NodeCatalogEntry } from "../AddNodeMenu";
import { CompositeRunControls, RUN_MODE_OPTIONS } from "./CompositeNode";
import { IS_MOBILE } from "../coarse";
import "./compositeEditor.css";
import "./SocketContextMenu.css";

// Edits at any depth retarget the MAIN-editor ancestor (stack[0]) to recompute, and a level
// reconciles its ports against its PARENT graph (the crumb above) on leave.

type DrillMount = {
  container: HTMLDivElement;
  area: AreaPlugin<Schemes, AreaExtra>;
  selector: ReturnType<typeof AreaExtensions.selector>;
  selectable: ReturnType<typeof AreaExtensions.selectableNodes>;
  history: HistoryPlugin<Schemes>;
  // The ELK plugin is heavy, so it is dynamically imported on first Tidy and cached here.
  arrange: AutoArrangePlugin<Schemes> | null;
};

type MountHolder = { __drillMount?: DrillMount };

async function getDrillMount(composite: CompositeNode): Promise<DrillMount> {
  const holder = composite as unknown as MountHolder;
  if (holder.__drillMount) return holder.__drillMount;

  const container = document.createElement("div");
  container.className = "solenoid-canvas solenoid-composite-editor__canvas";

  const editor = composite.internalEditor;
  const area = new AreaPlugin<Schemes, AreaExtra>(container);
  const connection = new ConnectionPlugin<Schemes, AreaExtra>();
  const reactPlugin = new ReactPlugin<Schemes, AreaExtra>({ createRoot });
  const history = new HistoryPlugin<Schemes>();
  history.addPreset(HistoryPresets.classic.setup());
  (history as unknown as { history: { limit?: number } }).history.limit = 200;

  const selector = AreaExtensions.selector();
  const accumulating = AreaExtensions.accumulateOnCtrl();
  // Shared with the main canvas: without the drag guard a finger press on a node grabs it
  // (a pan over cards is dead), and without tap-to-select the drag-transparent unselected
  // card is then untouchable. Added BEFORE selectableNodes so the tap-to-select swallow
  // beats the background deselect. No groupBand — a subgraph holds no expanded groups.
  const patchDragGuard = installNodeDragGuard(area, editor, {});
  const tapCensus = createTapCensus();
  installTapSelect({
    area, editor, container, census: tapCensus,
    select: (id, accumulate) => void selectable.select(id, accumulate),
  });
  const selectable = AreaExtensions.selectableNodes(area, selector, { accumulating });
  AreaExtensions.simpleNodesOrder(area);

  // Shared with the main canvas (areaPresets.ts) so the drill-in can't drift from it.
  reactPlugin.addPreset(solenoidClassicRenderSetup());
  connection.addPreset(() => makeSolenoidConnectionFlow(editor));

  // connectionpick / connectiondrop fire on THIS plugin's own scope (Scope.use forwards events
  // down only), so cableDragStore never flips inside a drill-in without mirroring Canvas's pipe.
  connection.addPipe((ctx) => {
    if (ctx.type === "connectionpick") {
      (document.activeElement as HTMLElement | null)?.blur?.();
      setCableDragging(true);
      container.classList.add("solenoid-canvas--cabling");
      const s = (ctx as { data?: { socket?: { nodeId: string; key: string } } }).data?.socket;
      if (s) socketHighlightStore.setDrag([dragSocketKey(s.nodeId, s.key)]);
    }
    if (ctx.type === "connectiondrop") {
      setCableDragging(false);
      container.classList.remove("solenoid-canvas--cabling");
      socketHighlightStore.setDrag([]);
    }
    return ctx;
  });

  // Its geometry reads the ACTIVE graph, so this map reflects the subgraph; CSS hides the
  // main one while drilled in (both are .solenoid-minimap). The rAF coalescing inside the
  // factory is what keeps a pan off the synchronous per-pointermove render path.
  const minimap = createSolenoidMinimap();
  reactPlugin.addPreset(solenoidMinimapPreset(105));

  editor.use(area);
  area.use(reactPlugin);
  area.use(connection);
  area.use(history);
  area.use(minimap);
  // The container is cached with the mount, so the listener lives as long as it.
  installSurfacePointer(area, container);
  // Camera-tracked dot grid and the pinch veto: both are canvas behavior, not main-canvas
  // behavior, so the subgraph installs the same ones rather than a look-alike.
  installSurfaceBackground(area, container);
  installSurfaceSemanticZoom(area);
  installPinchTranslateVeto(area);

  // Outer-only concerns (FC reconcile) don't apply inside the `any` boundary; suppressed
  // during bulk rebuilds, which drive their own settle.
  editor.addPipe((ctx) => {
    if (ctx && typeof ctx === "object" && "type" in ctx) {
      const t = (ctx as { type: string }).type;
      if (t === "nodecreated") {
        const node = (ctx as unknown as { data: ClassicPreset.Node }).data;
        installErrorGuards(node);
        // Next frame: the area has rendered the view by then (same as the main canvas).
        requestAnimationFrame(() => patchDragGuard(node.id));
      }
      if (
        !isGraphRebuilding() &&
        (t === "connectioncreated" || t === "connectionremoved" || t === "noderemoved")
      ) {
        // Retarget the breadcrumb root so a nested edit still ripples out to the canvas.
        void processGraph(compositeEditorStore.stack()[0]?.id ?? composite.id);
        scheduleAutosave();
      }
    }
    return ctx;
  });

  const mount: DrillMount = { container, area, selector, selectable, history, arrange: null };
  holder.__drillMount = mount;
  return mount;
}

/** Screen coords → the drill area's graph coords. */
function toAreaCoords(area: AreaPlugin<Schemes, AreaExtra>, container: HTMLElement, screenX: number, screenY: number) {
  const { x: tx, y: ty, k } = area.area.transform;
  const rect = container.getBoundingClientRect();
  return { x: (screenX - rect.left - tx) / k, y: (screenY - rect.top - ty) / k };
}

function CompositeEditorInner({ composite }: { composite: CompositeNode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<DrillMount | null>(null);
  const cursorRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [menu, setMenu] = useState<{ screenX: number; screenY: number } | null>(null);
  const [nodeMenu, setNodeMenu] = useState<
    { nodeId: string; screenX: number; screenY: number; isComposite: boolean } | null
  >(null);
  const [ready, setReady] = useState(false);
  // Starts COLLAPSED on mobile, where an open 240px panel would blanket the small canvas.
  const [controlsOpen, setControlsOpen] = useState(!IS_MOBILE);
  // The drill-in area has no drag-pipe guards, so mirror the lock class onto the host and let
  // the `.solenoid-canvas--locked` descendant rules make the nodes view-only.
  const locked = useSyncExternalStore(canvasLockStore.subscribe, canvasLockStore.get);
  // Re-render on every pass, so renaming an internal marker updates the port-label-driven
  // dropdowns on blur.
  useSyncExternalStore(compositePassStore.subscribe, compositePassStore.version);

  const compositeId = composite.id;
  const isComposite = true;
  // The main editor at level 0, else the composite one breadcrumb up — a nested composite
  // lives in its parent's internal editor, not the main one.
  const parentEditor = (() => {
    const st = compositeEditorStore.stack();
    const i = st.indexOf(composite);
    return i > 0 ? st[i - 1].internalEditor : getEditor();
  })();
  // Always the breadcrumb root, so an edit any levels deep still ripples out to the canvas.
  const recomputeTarget = () => compositeEditorStore.stack()[0]?.id ?? compositeId;

  useEffect(() => {
    if (!isComposite) { compositeEditorStore.close(); return; }
    const comp = composite as CompositeNode;
    let canceled = false;
    void (async () => {
      await comp.hydrate(ctorRegistry());
      const mount = await getDrillMount(comp);
      if (canceled) return;
      mountRef.current = mount;
      hostRef.current?.appendChild(mount.container);
      // Gate the inner history's `active` flag around the backfill or its area.translate calls
      // record as undoable; a blanket clear() would wipe a prior session's stack, since the
      // plugin is cached per-composite across close/reopen.
      const innerHistory = (mount.history as unknown as { history: { active: boolean } }).history;
      innerHistory.active = true;
      try {
        for (const n of comp.internalEditor.getNodes()) {
          if (!mount.area.nodeViews.has(n.id)) await mount.area.addNodeView(n);
        }
        for (const c of comp.internalEditor.getConnections()) {
          if (!mount.area.connectionViews.has(c.id)) await mount.area.addConnectionView(c);
        }
        if (canceled) return;
        let fallback = 0;
        for (const n of comp.internalEditor.getNodes()) {
          const pos = comp.internalPositions[n.id] ?? { x: (fallback % 4) * 260, y: Math.floor(fallback / 4) * 160 };
          fallback++;
          await mount.area.translate(n.id, pos);
        }
        const nodes = comp.internalEditor.getNodes();
        if (nodes.length > 0) await AreaExtensions.zoomAt(mount.area, nodes);
        // The far-zoom class is global and the main camera set it last; re-derive it from
        // THIS camera, or a subgraph opens simplified (or not) on the wrong scale.
        syncSemanticZoomFor(mount.area.area.transform.k);
      } finally {
        innerHistory.active = false;
      }
      // Make THIS level the active graph so the app chrome acts on the subgraph;
      // getEditor()/getArea() stay main-only for autosave safety.
      setActiveGraph({ editor: comp.internalEditor, area: mount.area, history: mount.history });
      setReady(true);
    })();
    return () => {
      canceled = true;
      // Isolate is keyed on THIS level's node ids, so drop it or another level is left dimmed
      // against ids it doesn't own.
      isolateStore.exit();
      setActiveGraph(null); // back to the main graph (a deeper level re-registers)
      // Hand the far-zoom class back to the camera that becomes visible again.
      const mainArea = getArea();
      if (mainArea) syncSemanticZoomFor(mainArea.area.transform.k);
      const mount = mountRef.current;
      if (mount) {
        // Removing the views unmounts each React ROOT; merely detaching the container keeps
        // the fibers (and their intervals) alive.
        for (const n of comp.internalEditor.getNodes()) mount.area.removeNodeView(n.id);
        for (const c of comp.internalEditor.getConnections()) mount.area.removeConnectionView(c.id);
        if (hostRef.current?.contains(mount.container)) {
          hostRef.current.removeChild(mount.container);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compositeId]);

  // Each internal view is its own React root, so a completed pass must re-render them —
  // but ONLY a pass this composite actually ran in. The store ticks after every
  // processGraph, and an edit anywhere else in the document leaves the engine cache for
  // this node intact, so `data()` never fires and nothing inside can have moved.
  useEffect(() => {
    if (!isComposite) return;
    const comp = composite as CompositeNode;
    let lastRunSeq = -1;
    return compositePassStore.subscribe(() => {
      const mount = mountRef.current;
      if (!mount) return;
      if (comp.runSeq === lastRunSeq) return;
      lastRunSeq = comp.runSeq;
      for (const n of comp.internalEditor.getNodes()) void mount.area.update("node", n.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compositeId]);

  // Window-level, since focus lands on <body> after canvas clicks; declared BEFORE the
  // isComposite bail so hook order stays stable.
  useEffect(() => {
    if (!isComposite) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const editable = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!target?.isContentEditable;
      if (editable) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.code === "KeyZ" && !e.shiftKey) { e.preventDefault(); void historyStep(false); }
        if ((e.code === "KeyZ" && e.shiftKey) || e.code === "KeyY") { e.preventDefault(); void historyStep(true); }
        if (e.code === "KeyA") {
          e.preventDefault();
          const mount = mountRef.current;
          if (mount) {
            mount.selector.unselectAll();
            cableSelectionStore.set(null);
            for (const n of comp.internalEditor.getNodes()) void mount.selectable.select(n.id, true);
          }
        }
        if (e.code === "KeyC" && !e.shiftKey) { e.preventDefault(); copySelected(); }
        if (e.code === "KeyV" && !e.shiftKey) {
          e.preventDefault();
          const mount = mountRef.current;
          if (mount) {
            const pos = toAreaCoords(mount.area, mount.container, cursorRef.current.x, cursorRef.current.y);
            void pasteClipboard(pos.x, pos.y);
          }
        }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        void deleteSelection();
      }
      if (e.code === "KeyA") {
        e.preventDefault();
        setMenu({ screenX: cursorRef.current.x, screenY: cursorRef.current.y });
      }
      if (e.code === "KeyT") {
        e.preventDefault();
        void tidyDrill();
      }
      // Isolate resolves through the ACTIVE editor, and the dim view reads the global
      // isolateStore the drill-in cards already observe.
      if (e.code === "KeyI") {
        e.preventDefault();
        if (isolateStore.isActive()) isolateStore.exit(); else isolateSelection();
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        void nudgeSelection(e.key, e.shiftKey);
      }
      if (e.key === "Escape") {
        // Esc precedence: close the Add menu → exit isolate → pop ONE breadcrumb level.
        if (menu) setMenu(null);
        else if (isolateStore.isActive()) isolateStore.exit();
        else void drillTo(compositeEditorStore.stack().length - 2);
      }
    }
    const onMouseMove = (e: MouseEvent) => { cursorRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousemove", onMouseMove);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousemove", onMouseMove);
    };
  });

  const comp = composite;

  /** Save positions + reconcile this level's ports against its PARENT graph; leaving a level
   *  at any depth runs this. Does NOT touch the breadcrumb — the caller decides where to go. */
  async function leaveLevel() {
    const mount = mountRef.current;
    if (mount) {
      const positions: Record<string, { x: number; y: number }> = {};
      for (const [id, view] of mount.area.nodeViews) {
        positions[id] = { x: view.position.x, y: view.position.y };
      }
      comp.internalPositions = positions;
    }
    if (parentEditor) {
      // Dropping the port takes any OUTER cables with it — by design, but severed outer wiring
      // must never be silent, so tally it for the notice below.
      let droppedCables = 0;
      let droppedPorts = 0;
      for (const p of [...comp.inputPorts]) {
        if (comp.internalEditor.getNode(p.internalNodeId)) continue;
        const cables = parentEditor.getConnections().filter((c) => c.target === comp.id && c.targetInput === p.id);
        for (const c of cables) await parentEditor.removeConnection(c.id);
        if (cables.length > 0) { droppedCables += cables.length; droppedPorts++; }
        comp.removeInputPort(p.id);
      }
      for (const p of [...comp.outputPorts]) {
        if (comp.internalEditor.getNode(p.internalNodeId)) continue;
        const cables = parentEditor.getConnections().filter((c) => c.source === comp.id && c.sourceOutput === p.id);
        for (const c of cables) await parentEditor.removeConnection(c.id);
        if (cables.length > 0) { droppedCables += cables.length; droppedPorts++; }
        comp.removeOutputPort(p.id);
      }
      if (droppedCables > 0) {
        const name = comp.label?.trim() || "Composite";
        pushNotice(
          `Removed ${droppedCables} cable${droppedCables === 1 ? "" : "s"} connected to ${name}; ${droppedPorts === 1 ? "a port was" : `${droppedPorts} ports were`} deleted inside.`,
          "warn",
        );
      }
    }
    // Renaming a boundary marker renames its exposed port on the outer card.
    comp.syncPortLabels();
  }

  /** Refresh the card + recompute + save after a leave. Only the MAIN-canvas card can be
   *  area-updated here; a nested composite's card re-renders on remount. */
  async function settleAfterLeave() {
    if (parentEditor === getEditor()) {
      const outerArea = getArea();
      if (outerArea) await outerArea.update("node", comp.id);
    }
    void processGraph(recomputeTarget());
    scheduleAutosave();
  }

  /** Breadcrumb click: reconcile the current level, then jump to level `i`; i < 0 closes. */
  async function drillTo(i: number) {
    await leaveLevel();
    compositeEditorStore.backTo(i);
    await settleAfterLeave();
  }

  /** The promotion gesture: a fresh boundary marker + its exposed port. */
  async function addPort(kind: "input" | "output") {
    const mount = mountRef.current;
    if (!mount) return;
    const n = kind === "input" ? comp.inputPorts.length + 1 : comp.outputPorts.length + 1;
    const label = kind === "input" ? `Input ${n}` : `Output ${n}`;
    const marker = kind === "input" ? new CompositeInputNode({ label }) : new CompositeOutputNode({ label });
    // Must run AFTER addNode — the guard sits outside coercion (see CompositeNode.hydrate).
    await comp.internalEditor.addNode(marker as SolenoidNode);
    installErrorGuards(marker);
    const rect = mount.container.getBoundingClientRect();
    const pos = toAreaCoords(
      mount.area, mount.container,
      kind === "input" ? rect.left + 80 : rect.right - 260,
      rect.top + rect.height / 2,
    );
    await mount.area.translate(marker.id, pos);
    if (kind === "input") {
      comp.addInputPort({ label, internalNodeId: marker.id, exposure: "exposed", tier: "basic" });
    } else {
      comp.addOutputPort({ label, internalNodeId: marker.id, tier: "basic" });
    }
    if (parentEditor === getEditor()) {
      const outerArea = getArea();
      if (outerArea) await outerArea.update("node", comp.id);
    }
    void processGraph(recomputeTarget());
    scheduleAutosave();
  }

  /** Delete the drill-in selection, cables first. Markers are excluded — they go via their
   *  port, so a wired boundary can't vanish from under the outer card mid-edit. */
  async function deleteSelection() {
    const mount = mountRef.current;
    if (!mount) return;
    const editor = comp.internalEditor;
    for (const id of cableSelectionStore.ids()) {
      if (editor.getConnection(id)) await editor.removeConnection(id);
    }
    cableSelectionStore.clear();
    const selected = editor.getNodes().filter(
      (n) => (n as { selected?: boolean }).selected === true &&
        !(n instanceof CompositeInputNode) && !(n instanceof CompositeOutputNode),
    );
    for (const node of selected) {
      for (const c of editor.getConnections().filter((c) => c.source === node.id || c.target === node.id)) {
        await editor.removeConnection(c.id);
      }
      await editor.removeNode(node.id);
    }
  }

  /** Undo/redo the drill-in's history; withGraphRebuild gates the per-event recompute while
   *  the plugin replays, then ONE retargeted pass settles the owning card. */
  async function historyStep(redo: boolean) {
    const history = mountRef.current?.history;
    if (!history) return;
    await withGraphRebuild(async () => {
      await (redo ? history.redo() : history.undo());
    });
    void processGraph(recomputeTarget());
    scheduleAutosave();
  }

  /** Nudge the selected internal nodes; positions persist via internalPositions on leave. */
  async function nudgeSelection(key: string, big: boolean) {
    const mount = mountRef.current;
    if (!mount) return;
    const step = big ? 40 : 8;
    const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
    const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
    for (const n of comp.internalEditor.getNodes()) {
      if (!(n as { selected?: boolean }).selected) continue;
      const pos = mount.area.nodeViews.get(n.id)?.position ?? { x: 0, y: 0 };
      await mount.area.translate(n.id, { x: pos.x + dx, y: pos.y + dy });
    }
  }

  /** Duplicate one internal node by transiently isolating it on the `.selected` flag
   *  copySelected reads, then restoring the real selection so the user's ring is untouched. */
  async function duplicateNode(nodeId: string) {
    const mount = mountRef.current;
    if (!mount) return;
    const editor = comp.internalEditor;
    if (!editor.getNode(nodeId)) return;
    const snap = editor.getNodes().map(
      (n) => [n, (n as { selected?: boolean }).selected] as const,
    );
    for (const [n] of snap) (n as { selected?: boolean }).selected = n.id === nodeId;
    copySelected();
    for (const [n, sel] of snap) (n as { selected?: boolean }).selected = sel;
    const base = mount.area.nodeViews.get(nodeId)?.position ?? { x: 0, y: 0 };
    await pasteClipboard(base.x, base.y); // adds PASTE_OFFSET + recomputes the owner
    scheduleAutosave();
  }

  /** Delete one internal node; boundary markers keep to the add/remove-port gesture. */
  async function deleteNode(nodeId: string) {
    const editor = comp.internalEditor;
    const node = editor.getNode(nodeId);
    if (!node || node instanceof CompositeInputNode || node instanceof CompositeOutputNode) return;
    for (const c of editor.getConnections().filter((c) => c.source === nodeId || c.target === nodeId)) {
      await editor.removeConnection(c.id);
    }
    await editor.removeNode(nodeId);
    void processGraph(recomputeTarget());
    scheduleAutosave();
  }

  /** Tidy (T) with the main canvas's symmetric ELK port preset, but a BASIC layout:
   *  composites rarely hold groups or standoffs, so the cluster/size-pin machinery is skipped. */
  async function tidyDrill() {
    const mount = mountRef.current;
    if (!mount) return;
    if (!mount.arrange) {
      const { AutoArrangePlugin } = await import("rete-auto-arrange-plugin");
      const plugin = new AutoArrangePlugin<Schemes>();
      plugin.addPreset(() => ({
        port(data: { side: "input" | "output"; index: number; ports: number; width: number; height: number }) {
          const spacing = 16;
          const y = settingsStore.get("tidyAlign") === "top"
            ? 20 + data.index * spacing
            : data.height / 2 + (data.index - (data.ports - 1) / 2) * spacing;
          return { x: 0, y, width: 15, height: 15, side: data.side === "output" ? "EAST" : "WEST" } as const;
        },
      }));
      mount.area.use(plugin);
      mount.arrange = plugin;
    }
    await mount.arrange.layout();
    const nodes = comp.internalEditor.getNodes();
    if (nodes.length > 0) await AreaExtensions.zoomAt(mount.area, nodes);
    void processGraph(recomputeTarget());
    scheduleAutosave();
  }

  async function handleMenuSelect(entry: NodeCatalogEntry) {
    const mount = mountRef.current;
    if (!mount || !menu) return;
    const node = entry.create() as SolenoidNode;
    // A pre-seeded composite added INSIDE a drill-in still needs its own internal snapshot.
    if (node instanceof CompositeNode) await node.hydrate(ctorRegistry());
    await comp.internalEditor.addNode(node); // the pipe installs error guards
    const pos = toAreaCoords(mount.area, mount.container, menu.screenX, menu.screenY);
    await mount.area.translate(node.id, pos);
    setMenu(null);
    void processGraph(recomputeTarget());
    scheduleAutosave();
  }

  return (
    <div className="solenoid-composite-editor__backdrop">
        <div
          ref={hostRef}
          className={`solenoid-composite-editor__host${locked ? " solenoid-canvas--locked" : ""}`}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            // Detect via nodeViews containment — rete adds no shared wrapper class.
            const mount = mountRef.current;
            const target = e.target as Node;
            let hitId: string | null = null;
            if (mount) {
              for (const [id, view] of mount.area.nodeViews) {
                if (view.element.contains(target)) { hitId = id; break; }
              }
            }
            const hit = hitId ? comp.internalEditor.getNode(hitId) : null;
            if (hit && !(hit instanceof CompositeInputNode) && !(hit instanceof CompositeOutputNode)) {
              setMenu(null);
              setNodeMenu({
                nodeId: hit.id,
                screenX: e.clientX,
                screenY: e.clientY,
                isComposite: hit instanceof CompositeNode,
              });
            } else {
              setNodeMenu(null);
              setMenu({ screenX: e.clientX, screenY: e.clientY });
            }
          }}
        >
          {!ready && <div className="solenoid-composite-editor__loading" />}
        </div>
        {/* Subgraph strip — the "you're in a subgraph" affordance (breadcrumb +
            drill-up) and the port-promotion actions. Floats below the real app
            header, which stays visible — the drill-in doesn't cover the
            chrome; the whole app frame (toolbar, minimap, status bar) is the
            drill-in's chrome, pointed at the active graph. */}
        <div className="solenoid-composite-editor__strip" onPointerDown={(e) => e.stopPropagation()}>
          <div className="solenoid-composite-editor__crumbs">
            <button
              type="button"
              className="solenoid-composite-editor__crumb solenoid-composite-editor__crumb--root"
              title="Back to the canvas"
              onClick={() => void drillTo(-1)}
            >
              Canvas
            </button>
            {compositeEditorStore.stack().map((c, i, arr) => (
              <span key={c.id} className="solenoid-composite-editor__crumb-wrap">
                <span className="solenoid-composite-editor__crumb-sep">▸</span>
                {i === arr.length - 1 ? (
                  <span className="solenoid-composite-editor__crumb solenoid-composite-editor__crumb--current" title="Editing this subgraph">
                    {c.label?.trim() || "Composite"}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="solenoid-composite-editor__crumb"
                    title={`Drill up to ${c.label?.trim() || "Composite"}`}
                    onClick={() => void drillTo(i)}
                  >
                    {c.label?.trim() || "Composite"}
                  </button>
                )}
              </span>
            ))}
          </div>
          <div className="solenoid-composite-editor__strip-actions">
            <button type="button" className="solenoid-composite-editor__btn" onClick={() => void addPort("input")}>
              + Input
            </button>
            <button type="button" className="solenoid-composite-editor__btn" onClick={() => void addPort("output")}>
              + Output
            </button>
          </div>
        </div>
        {/* Run-mode / Solve / mode-config panel — the same controls as the outer card,
            so you configure and solve from INSIDE the subgraph. Floated top-right,
            opposite the breadcrumb strip. Only when the composite has a boundary. */}
        {(comp.inputPorts.length > 0 || comp.outputPorts.length > 0) && (
          <div
            className={`solenoid-composite-editor__controls${controlsOpen ? "" : " solenoid-composite-editor__controls--collapsed"}`}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {/* Collapse toggle — the bar shows the current run mode so a collapsed
                panel still reads at a glance (esp. mobile, where it starts folded). */}
            <button
              type="button"
              className="solenoid-composite-editor__controls-head"
              onClick={() => setControlsOpen((v) => !v)}
              title={controlsOpen ? "Hide run controls" : "Show run controls"}
              aria-expanded={controlsOpen}
            >
              <span className="solenoid-composite-editor__controls-title">
                {RUN_MODE_OPTIONS.find((o) => o.value === comp.runMode)?.label ?? "Run"}
              </span>
              <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"
                   style={{ display: "block", flexShrink: 0, transform: controlsOpen ? "rotate(180deg)" : undefined }}>
                <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {controlsOpen && (
              <div className="solenoid-composite-editor__controls-body">
                <CompositeRunControls node={comp} insideOnly />
              </div>
            )}
          </div>
        )}
      {menu && (
        <AddNodeMenu
          screenX={menu.screenX}
          screenY={menu.screenY}
          entries={buildCatalog(true)}
          onSelect={(entry) => void handleMenuSelect(entry)}
          onClose={() => setMenu(null)}
        />
      )}
      {nodeMenu && (
        <DrillNodeMenu
          menu={nodeMenu}
          onEdit={() => { const n = comp.internalEditor.getNode(nodeMenu.nodeId); if (n instanceof CompositeNode) compositeEditorStore.drillInto(n); }}
          onDuplicate={() => void duplicateNode(nodeMenu.nodeId)}
          onDelete={() => void deleteNode(nodeMenu.nodeId)}
          onClose={() => setNodeMenu(null)}
        />
      )}
    </div>
  );
}

// The main canvas's node menu is isolate/pin/standoff — main-graph concepts that don't apply
// in a subgraph — so the drill-in gets its own set.
function DrillNodeMenu({
  menu, onEdit, onDuplicate, onDelete, onClose,
}: {
  menu: { nodeId: string; screenX: number; screenY: number; isComposite: boolean };
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDown(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [onClose]);
  const item = (icon: ReactNode, label: string, run: () => void) => (
    <button
      className="solenoid-socket-ctx__item"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => { run(); onClose(); }}
    >
      <span className="solenoid-socket-ctx__icon">{icon}</span>
      {label}
    </button>
  );
  return (
    <div ref={ref} className="solenoid-socket-ctx" style={{ left: menu.screenX + 6, top: menu.screenY - 4 }}>
      {menu.isComposite && item(
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
          <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" />
        </svg>, "Edit contents", onEdit)}
      {item(
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
          <rect x="8" y="8" width="12" height="12" rx="2" /><path d="M4 16V6a2 2 0 0 1 2-2h10" />
        </svg>, "Duplicate", onDuplicate)}
      {item(
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
          <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6" /><path d="M10 11v6M14 11v6" />
        </svg>, "Delete", onDelete)}
    </div>
  );
}

export function CompositeEditorOverlay() {
  useSyncExternalStore(compositeEditorStore.subscribe, compositeEditorStore.version);
  const current = compositeEditorStore.current();
  // Lives on the always-mounted outer, since drilling deeper remounts the inner; the app
  // chrome reads it to fold itself around the drill-in.
  const open = !!current;
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("sol-drilled-in", open);
    return () => root.classList.remove("sol-drilled-in");
  }, [open]);
  if (!current) return null;
  // Keyed by level id, so drilling remounts the inner onto that composite's own editor.
  return <CompositeEditorInner key={current.id} composite={current} />;
}
