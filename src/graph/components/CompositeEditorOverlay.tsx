import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { ClassicPreset } from "rete";
import { AreaPlugin, AreaExtensions } from "rete-area-plugin";
import { ConnectionPlugin, ClassicFlow, getSourceTarget } from "rete-connection-plugin";
import { ReactPlugin, Presets as ReactPresets } from "rete-react-plugin";
import type { Schemes, AreaExtra, SolenoidNode } from "../schemes";
import { CompositeNode, CompositeInputNode, CompositeOutputNode } from "../rete-nodes";
import { compositeEditorStore, compositePassStore } from "../compositeEditorStore";
import { getEditor, getArea, processGraph, isGraphRebuilding } from "../process";
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
// `internalEditor`) into a real rete area inside a full-screen overlay — the
// authoring surface pack-architecture.md promises ("open to the author").
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
        void processGraph(composite.id);
        scheduleAutosave();
      }
    }
    return ctx;
  });

  const mount: DrillMount = { container, area, selector };
  holder.__drillMount = mount;
  return mount;
}

/** Screen coords → the drill area's graph coords. */
function toAreaCoords(area: AreaPlugin<Schemes, AreaExtra>, container: HTMLElement, screenX: number, screenY: number) {
  const { x: tx, y: ty, k } = area.area.transform;
  const rect = container.getBoundingClientRect();
  return { x: (screenX - rect.left - tx) / k, y: (screenY - rect.top - ty) / k };
}

function CompositeEditorInner({ compositeId }: { compositeId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<DrillMount | null>(null);
  const [menu, setMenu] = useState<{ screenX: number; screenY: number } | null>(null);
  const [ready, setReady] = useState(false);

  const outerEditor = getEditor();
  const composite = outerEditor?.getNode(compositeId);
  const isComposite = composite instanceof CompositeNode;

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
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        void deleteSelection();
      }
      if (e.key === "Escape") {
        if (menu) setMenu(null);
        else void handleClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (!isComposite) return null;
  const comp = composite as CompositeNode;

  /** Positions back onto the node, ports reconciled, outer card refreshed. */
  async function handleClose() {
    const mount = mountRef.current;
    const outer = getEditor();
    const outerArea = getArea();
    if (mount) {
      const positions: Record<string, { x: number; y: number }> = {};
      for (const [id, view] of mount.area.nodeViews) {
        positions[id] = { x: view.position.x, y: view.position.y };
      }
      comp.internalPositions = positions;
    }
    // A deleted marker takes its port (and the port's outer cables) with it.
    if (outer) {
      for (const p of [...comp.inputPorts]) {
        if (comp.internalEditor.getNode(p.internalNodeId)) continue;
        for (const c of outer.getConnections().filter((c) => c.target === comp.id && c.targetInput === p.id)) {
          await outer.removeConnection(c.id);
        }
        comp.removeInputPort(p.id);
      }
      for (const p of [...comp.outputPorts]) {
        if (comp.internalEditor.getNode(p.internalNodeId)) continue;
        for (const c of outer.getConnections().filter((c) => c.source === comp.id && c.sourceOutput === p.id)) {
          await outer.removeConnection(c.id);
        }
        comp.removeOutputPort(p.id);
      }
    }
    compositeEditorStore.close();
    if (outerArea) await outerArea.update("node", comp.id);
    void processGraph(comp.id);
    scheduleAutosave();
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
    const outerArea = getArea();
    if (outerArea) await outerArea.update("node", comp.id);
    void processGraph(comp.id);
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

  async function handleMenuSelect(entry: NodeCatalogEntry) {
    const mount = mountRef.current;
    if (!mount || !menu) return;
    const node = entry.create() as SolenoidNode;
    await comp.internalEditor.addNode(node); // the pipe installs error guards
    const pos = toAreaCoords(mount.area, mount.container, menu.screenX, menu.screenY);
    await mount.area.translate(node.id, pos);
    setMenu(null);
    void processGraph(comp.id);
    scheduleAutosave();
  }

  return (
    <div className="solenoid-composite-editor__backdrop">
      <div className="solenoid-composite-editor__panel">
        <div className="solenoid-composite-editor__header">
          <span className="solenoid-composite-editor__title" title={comp.label || "Composite"}>
            {comp.label?.trim() || "Composite"}
          </span>
          <div className="solenoid-composite-editor__actions">
            <button type="button" className="solenoid-composite-editor__btn" onClick={() => void addPort("input")}>
              + Input
            </button>
            <button type="button" className="solenoid-composite-editor__btn" onClick={() => void addPort("output")}>
              + Output
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
  const openId = compositeEditorStore.openId();
  if (!openId) return null;
  return <CompositeEditorInner key={openId} compositeId={openId} />;
}
