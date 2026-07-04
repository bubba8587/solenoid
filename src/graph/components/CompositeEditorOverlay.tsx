import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { ClassicPreset } from "rete";
import { AreaPlugin, AreaExtensions } from "rete-area-plugin";
import { ConnectionPlugin, ClassicFlow, getSourceTarget } from "rete-connection-plugin";
import { ReactPlugin, Presets as ReactPresets } from "rete-react-plugin";
import { HistoryPlugin, Presets as HistoryPresets } from "rete-history-plugin";
import type { Schemes, AreaExtra, SolenoidNode } from "../schemes";
import { CompositeNode, CompositeInputNode, CompositeOutputNode } from "../rete-nodes";
import { compositeEditorStore, compositePassStore } from "../compositeEditorStore";
import { getEditor, getArea, processGraph, isGraphRebuilding, withGraphRebuild } from "../process";
import { scheduleAutosave } from "../persistence";
import { installErrorGuards } from "../errorValue";
import { ctorRegistry } from "../nodeCtorRegistry";
import { SolenoidSocket } from "../sockets";
import { NODE_COMPONENTS } from "../nodeRegistry";
import { getGuardedSocketPosition } from "../guardedSocketPosition";
import { cableSelectionStore } from "../cableState";
import { buildCatalog } from "../catalogUtils";
import { AddNodeMenu, type NodeCatalogEntry } from "../AddNodeMenu";
import { SocketComponent } from "./SocketComponent";
import { ConnectionComponent } from "./ConnectionComponent";
import { CloseIcon } from "./CloseIcon";
import "./compositeEditor.css";

// ─── The Composite drill-in editor ──────────────────────────────────────────────
// Mounts a composite's PRIVATE internal graph (nodes/composite.ts
// `internalEditor`) into a real rete area, LAYERED FULL-BLEED over the main
// canvas (not a floating window) — so drilling in reads as "the app is now
// showing this subgraph". A top-left breadcrumb (Canvas ▸ A ▸ B, compositeEditor-
// Store's stack) is the "you're in a subgraph" affordance and the quick drill-up:
// a composite card INSIDE the editor drills one level deeper (multi-layer), and
// any crumb jumps straight back up. Edits at any depth retarget the MAIN-editor
// ancestor (stack[0]) to recompute, and a level reconciles its ports against its
// PARENT graph (the crumb above) on leave. The authoring surface
// pack-architecture.md promises ("open to the author").
// The rete plugin stack (area / connection / react render) is created ONCE per
// composite and cached on the node instance: rete's Scope.use() can't be
// undone, so re-running it on every open would stack duplicate pipes. The
// container <div> stays alive between opens and is simply re-parented into
// the overlay.
//
// Edit semantics:
//  - move / rewire / literal edits / delete — live, recompute via the OUTER
//    pass retargeted at the owning card (see process.ts findCompositeOwner).
//  - "+ Input/Output" adds a boundary marker + its port (the promotion
//    mechanism); deleting a marker drops its port. Both reconcile the outer
//    card's sockets immediately (outer cables into a dropped port go first).
//  - positions persist in composite.internalPositions (bbox-relative), synced
//    back on every close.

type DrillMount = {
  container: HTMLDivElement;
  area: AreaPlugin<Schemes, AreaExtra>;
  selector: ReturnType<typeof AreaExtensions.selector>;
  history: HistoryPlugin<Schemes>;
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
  // Undo/redo inside the drill-in — same classic preset + 200-cap as Canvas
  // (the plugin ctor doesn't expose the inner History limit). Lives as long as
  // the mount (per composite), so the stack survives close/reopen.
  const history = new HistoryPlugin<Schemes>();
  history.addPreset(HistoryPresets.classic.setup());
  (history as unknown as { history: { limit?: number } }).history.limit = 200;

  const selector = AreaExtensions.selector();
  const accumulating = AreaExtensions.accumulateOnCtrl();
  AreaExtensions.selectableNodes(area, selector, { accumulating });
  AreaExtensions.simpleNodesOrder(area);

  reactPlugin.addPreset(
    ReactPresets.classic.setup({
      // Same identity offset as Canvas: our sockets sit centered on the node
      // border, not outside it.
      socketPositionWatcher: getGuardedSocketPosition({ offset: (p) => p }),
      customize: {
        node({ payload }) {
          const hit = NODE_COMPONENTS.find(([Ctor]) => payload instanceof Ctor);
          return hit ? hit[1] : null;
        },
        socket() {
          return SocketComponent;
        },
        connection() {
          return ConnectionComponent;
        },
      },
    }),
  );

  // Same compatibility veto as the outer canvas (see Canvas.tsx): reject
  // BEFORE makeConnection so an incompatible drop can't evict a valid cable.
  connection.addPreset(
    () =>
      new ClassicFlow({
        canMakeConnection(initial, socket) {
          const st = getSourceTarget(initial, socket);
          if (!st) return false;
          const [source, target] = st;
          if (source.nodeId === target.nodeId) return false;
          const srcSocket = editor.getNode(source.nodeId)?.outputs[source.key]?.socket;
          const tgtSocket = editor.getNode(target.nodeId)?.inputs[target.key]?.socket;
          if (srcSocket instanceof SolenoidSocket && tgtSocket instanceof SolenoidSocket) {
            return srcSocket.canConnectTo(tgtSocket);
          }
          return true;
        },
      }),
  );

  editor.use(area);
  area.use(reactPlugin);
  area.use(connection);
  area.use(history);

  // The internal graph existed BEFORE the area was attached (nodes are
  // relocated/hydrated at collapse/load time), so the plugin's nodecreated/
  // connectioncreated listeners never saw them — backfill their views once.
  for (const n of editor.getNodes()) area.addNodeView(n);
  for (const c of editor.getConnections()) area.addConnectionView(c);

  // Structural edits made in the drill-in recompute the OWNING card and
  // autosave — the same settle a Canvas cable edit gets, minus the outer-only
  // concerns (FC reconcile etc. don't apply inside the `any` boundary).
  // Suppressed during bulk rebuilds (hydrate/unpack drive their own settle).
  editor.addPipe((ctx) => {
    if (ctx && typeof ctx === "object" && "type" in ctx) {
      const t = (ctx as { type: string }).type;
      if (t === "nodecreated") {
        const node = (ctx as unknown as { data: ClassicPreset.Node }).data;
        installErrorGuards(node);
      }
      if (
        !isGraphRebuilding() &&
        (t === "connectioncreated" || t === "connectionremoved" || t === "noderemoved")
      ) {
        // Retarget the MAIN-editor ancestor (breadcrumb root) so a nested edit
        // still ripples out to the canvas; falls back to this composite's own id.
        void processGraph(compositeEditorStore.stack()[0]?.id ?? composite.id);
        scheduleAutosave();
      }
    }
    return ctx;
  });

  const mount: DrillMount = { container, area, selector, history };
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
  const [menu, setMenu] = useState<{ screenX: number; screenY: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);

  const compositeId = composite.id;
  const isComposite = true;
  // The PARENT graph this level lives in: the main editor at level 0, else the
  // composite one breadcrumb up (a nested composite lives in its parent's
  // internal editor, not the main one). Used for port reconcile on leave.
  const parentEditor = (() => {
    const st = compositeEditorStore.stack();
    const i = st.indexOf(composite);
    return i > 0 ? st[i - 1].internalEditor : getEditor();
  })();
  // Recompute always retargets the MAIN-editor ancestor (breadcrumb root), so an
  // edit any levels deep still ripples out to the canvas.
  const recomputeTarget = () => compositeEditorStore.stack()[0]?.id ?? compositeId;

  // Mount the (cached) rete stack into the overlay and lay the nodes out.
  useEffect(() => {
    if (!isComposite) { compositeEditorStore.close(); return; }
    const comp = composite as CompositeNode;
    let cancelled = false;
    void (async () => {
      await comp.hydrate(ctorRegistry());
      const mount = await getDrillMount(comp);
      if (cancelled) return;
      mountRef.current = mount;
      hostRef.current?.appendChild(mount.container);
      // Restore the saved layout, stagger anything unplaced (a pre-positions
      // save), then fit.
      let fallback = 0;
      for (const n of comp.internalEditor.getNodes()) {
        const pos = comp.internalPositions[n.id] ?? { x: (fallback % 4) * 260, y: Math.floor(fallback / 4) * 160 };
        fallback++;
        await mount.area.translate(n.id, pos);
      }
      const nodes = comp.internalEditor.getNodes();
      if (nodes.length > 0) await AreaExtensions.zoomAt(mount.area, nodes);
      setReady(true);
    })();
    return () => {
      cancelled = true;
      const mount = mountRef.current;
      if (mount && hostRef.current?.contains(mount.container)) {
        hostRef.current.removeChild(mount.container);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compositeId]);

  // Every completed graph pass refreshed the internal nodes' cached values —
  // re-render their views (each is its own React root; concurrent updates).
  useEffect(() => {
    if (!isComposite) return;
    const comp = composite as CompositeNode;
    return compositePassStore.subscribe(() => {
      const mount = mountRef.current;
      if (!mount) return;
      for (const n of comp.internalEditor.getNodes()) void mount.area.update("node", n.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compositeId]);

  // Enable the header Delete button only when something inside the drill-in
  // is selected — polled the same cheap way MobileControls does (there is no
  // dedicated selection store), and only while the overlay is open (this
  // component unmounts on close). Cable ids are filtered to the INTERNAL
  // editor: cableSelectionStore is app-global, and an outer cable selected
  // before the overlay opened must not arm the button.
  useEffect(() => {
    if (!isComposite) return;
    const editor = (composite as CompositeNode).internalEditor;
    const tick = () => {
      const nodeSelected = editor.getNodes().some((n) => (n as { selected?: boolean }).selected === true);
      const cableSelected = cableSelectionStore.ids().some((id) => !!editor.getConnection(id));
      setHasSelection(nodeSelected || cableSelected);
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compositeId]);

  // Window-level (focus lands on <body> after canvas clicks — a div listener
  // would go deaf). Canvas's own window keydown stands down while the overlay
  // is open (see its compositeEditorStore guard), so there's no double-handling.
  // Declared BEFORE the isComposite bail so hook order is stable; the handlers
  // it calls are hoisted function declarations and never run for a non-composite
  // (that render tears the overlay down via the mount effect's close()).
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
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        void deleteSelection();
      }
      if (e.key === "Escape") {
        // Esc pops ONE breadcrumb level (drill up); at the root it closes.
        if (menu) setMenu(null);
        else void drillTo(compositeEditorStore.stack().length - 2);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const comp = composite;

  /** Save positions + reconcile this level's ports against its PARENT graph (a
   *  deleted marker drops its port and the parent cables into it). Shared by
   *  full close and breadcrumb drill-up — leaving a level at any depth reconciles
   *  it. Does NOT touch the breadcrumb; the caller decides where to go next. */
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
      for (const p of [...comp.inputPorts]) {
        if (comp.internalEditor.getNode(p.internalNodeId)) continue;
        for (const c of parentEditor.getConnections().filter((c) => c.target === comp.id && c.targetInput === p.id)) {
          await parentEditor.removeConnection(c.id);
        }
        comp.removeInputPort(p.id);
      }
      for (const p of [...comp.outputPorts]) {
        if (comp.internalEditor.getNode(p.internalNodeId)) continue;
        for (const c of parentEditor.getConnections().filter((c) => c.source === comp.id && c.sourceOutput === p.id)) {
          await parentEditor.removeConnection(c.id);
        }
        comp.removeOutputPort(p.id);
      }
    }
  }

  /** Refresh the card + recompute + save, after a leave. Only the MAIN-canvas
   *  card can be area-updated here (a nested composite's card lives in a parent
   *  mount that re-renders on remount); recompute always retargets the root. */
  async function settleAfterLeave() {
    if (parentEditor === getEditor()) {
      const outerArea = getArea();
      if (outerArea) await outerArea.update("node", comp.id);
    }
    void processGraph(recomputeTarget());
    scheduleAutosave();
  }

  /** Positions back onto the node, ports reconciled, editor closed. */
  async function handleClose() {
    await leaveLevel();
    compositeEditorStore.close();
    await settleAfterLeave();
  }

  /** Breadcrumb click: reconcile the current level, then jump to level `i`
   *  (drill up). At i < 0 this closes. */
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
    installErrorGuards(marker);
    await comp.internalEditor.addNode(marker as SolenoidNode);
    // Drop it at the viewport's left (input) / right (output) edge, vertically centered.
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

  /** Delete the current drill-in selection (cables first, then non-marker
   *  nodes with their cables). Markers are deleted via their port — keeping
   *  a wired boundary from vanishing out from under the outer card mid-edit. */
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

  /** Undo/redo the drill-in's history. withGraphRebuild gates the editor
   *  pipe's per-event recompute while the plugin replays (one action can
   *  restore many cables — same reasoning as Canvas's Ctrl+Z), then ONE
   *  retargeted pass settles the owning card. */
  async function historyStep(redo: boolean) {
    const history = mountRef.current?.history;
    if (!history) return;
    await withGraphRebuild(async () => {
      await (redo ? history.redo() : history.undo());
    });
    void processGraph(recomputeTarget());
    scheduleAutosave();
  }

  async function handleMenuSelect(entry: NodeCatalogEntry) {
    const mount = mountRef.current;
    if (!mount || !menu) return;
    const node = entry.create() as SolenoidNode;
    await comp.internalEditor.addNode(node); // the pipe installs error guards
    const pos = toAreaCoords(mount.area, mount.container, menu.screenX, menu.screenY);
    await mount.area.translate(node.id, pos);
    setMenu(null);
    void processGraph(recomputeTarget());
    scheduleAutosave();
  }

  return (
    <div className="solenoid-composite-editor__backdrop">
      <div className="solenoid-composite-editor__panel">
        <div className="solenoid-composite-editor__header">
          {/* Breadcrumb — top-left "you're in a subgraph" affordance + quick
              drill-up (Cube-popup drilldown pattern). Each crumb is clickable to
              jump straight to that level; "Canvas" returns to the main graph. */}
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
          <div className="solenoid-composite-editor__actions">
            <button type="button" className="solenoid-composite-editor__btn" onClick={() => void addPort("input")}>
              + Input
            </button>
            <button type="button" className="solenoid-composite-editor__btn" onClick={() => void addPort("output")}>
              + Output
            </button>
            <button
              type="button"
              className="solenoid-composite-editor__btn"
              // Centered near the top — the search field's on-screen keyboard
              // can't cover the menu there (same reasoning as MobileControls'
              // openAddMenu), and it's a sensible spot on desktop too.
              onClick={() => setMenu({ screenX: window.innerWidth / 2, screenY: 120 })}
            >
              + Node
            </button>
            <button
              type="button"
              className="solenoid-composite-editor__btn solenoid-composite-editor__btn--icon"
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
              onClick={() => void historyStep(false)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 10 H15 a4.5 4.5 0 0 1 0 9 H9" />
                <path d="M6 10 L10 6 M6 10 L10 14" />
              </svg>
            </button>
            <button
              type="button"
              className="solenoid-composite-editor__btn solenoid-composite-editor__btn--icon"
              title="Redo (Ctrl+Y)"
              aria-label="Redo"
              onClick={() => void historyStep(true)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 10 H9 a4.5 4.5 0 0 0 0 9 H15" />
                <path d="M18 10 L14 6 M18 10 L14 14" />
              </svg>
            </button>
            <button
              type="button"
              className="solenoid-composite-editor__btn solenoid-composite-editor__btn--icon"
              title="Delete selection (Del)"
              aria-label="Delete selection"
              disabled={!hasSelection}
              onClick={() => void deleteSelection()}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
            </button>
            <button
              type="button"
              className="solenoid-composite-editor__btn solenoid-composite-editor__btn--icon"
              title="Close (Esc)"
              onClick={() => void handleClose()}
            >
              <CloseIcon />
            </button>
          </div>
        </div>
        <div
          ref={hostRef}
          className="solenoid-composite-editor__host"
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenu({ screenX: e.clientX, screenY: e.clientY });
          }}
        >
          {!ready && <div className="solenoid-composite-editor__loading" />}
        </div>
      </div>
      {menu && (
        <AddNodeMenu
          screenX={menu.screenX}
          screenY={menu.screenY}
          entries={buildCatalog(true)}
          onSelect={(entry) => void handleMenuSelect(entry)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

export function CompositeEditorOverlay() {
  useSyncExternalStore(compositeEditorStore.subscribe, compositeEditorStore.version);
  const current = compositeEditorStore.current();
  if (!current) return null;
  // Keyed by the current level's id: drilling in / up changes `current`, so the
  // inner remounts onto the new composite's own editor + area mount.
  return <CompositeEditorInner key={current.id} composite={current} />;
}
