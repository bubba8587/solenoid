// [[C77]] compositeIsSubgraph, [[C33]] saveBindsMain
import type { View } from "../view";
import { makeFlowView, type FlowView } from "./flowView";
import { idleHandlers, type SurfaceHandlers } from "./FlowSurface";
import type { CompositeNode } from "../rete-nodes";
import type { SolenoidNode } from "../schemes";
import { compositeEditorStore } from "../compositeEditorStore";
import { processGraph } from "../process";
import { scheduleAutosave } from "../persistence";
import { settleNodeRemoved } from "../canvasActions";
import { settleCableChange } from "../cableSettle";
import type { EditScope } from "../activeGraph";

const HISTORY_DEPTH = 50;
const HISTORY_COALESCE_MS = 400;

export type DrillStack = {
  editor: CompositeNode["internalEditor"];
  engine: CompositeNode["internalEngine"];
  view: FlowView;
  handlers: SurfaceHandlers;
  rebuilding: boolean;
  /** Closed, the level's pipes stand down: the composite settles its own cables, and a closed-level removal is a relocation. */
  open: boolean;
  isRebuilding: () => boolean;
  history: { stack: string[]; index: number; timer: ReturnType<typeof setTimeout> | null };
  afterCableChange: () => void;
  /** Bulk edits gate on `rebuilding`; the topology pipe's sync then recomputes. */
  scope: EditScope;
};

type DrillHolder = { __flowDrill?: DrillStack };

export function getDrillStack(comp: CompositeNode): DrillStack {
  const holder = comp as unknown as DrillHolder;
  if (holder.__flowDrill) return holder.__flowDrill;
  const handlers = idleHandlers();
  const view = makeFlowView(comp.internalEditor, {
    bumpNode: (id) => handlers.bumpNode(id),
    bumpConnections: () => handlers.bumpConnections(),
    moveNode: (id, pos) => handlers.moveNode(id, pos),
    setViewport: (v) => handlers.setViewport(v),
    getContainer: () => handlers.getContainer(),
  });
  const s: DrillStack = {
    editor: comp.internalEditor,
    engine: comp.internalEngine,
    view,
    handlers,
    rebuilding: true,
    open: false,
    isRebuilding: () => s.rebuilding || !s.open,
    history: { stack: [], index: -1, timer: null },
    // The topology pipe below recomputes from the breadcrumb root once per burst.
    afterCableChange: () => {},
    scope: {
      begin: () => { s.rebuilding = true; },
      end: () => { s.rebuilding = false; },
      settle: async () => settleCableChange(comp.internalEditor, view as unknown as View),
    },
  };
  let queued = false;
  const trySync = () => {
    if (!s.open) {
      queued = false;
      return;
    }
    if (s.rebuilding) {
      setTimeout(trySync, 0);
      return;
    }
    queued = false;
    handlers.syncTopology();
    void processGraph(compositeEditorStore.stack()[0]?.id ?? comp.id);
    scheduleAutosave();
    scheduleRecord(comp, s);
  };
  comp.internalEditor.addPipe((ctx) => {
    const t = (ctx as { type?: string }).type;
    if (t === "noderemoved") {
      settleNodeRemoved(comp.internalEditor, view as unknown as View, (ctx as unknown as { data: SolenoidNode }).data, s.isRebuilding());
    }
    if (
      t === "nodecreated" || t === "noderemoved" ||
      t === "connectioncreated" || t === "connectionremoved"
    ) {
      if (!queued) {
        queued = true;
        queueMicrotask(trySync);
      }
    }
    return ctx;
  });
  holder.__flowDrill = s;
  return s;
}

export function syncPositionsToComp(comp: CompositeNode, s: DrillStack) {
  const out: Record<string, { x: number; y: number }> = {};
  for (const n of s.editor.getNodes()) {
    const pos = n.position;
    if (pos) out[n.id] = { x: pos.x, y: pos.y };
  }
  comp.internalPositions = out;
}

export function recordNow(comp: CompositeNode, s: DrillStack) {
  if (s.rebuilding) return;
  if (s.history.timer) {
    clearTimeout(s.history.timer);
    s.history.timer = null;
  }
  syncPositionsToComp(comp, s);
  const json = JSON.stringify(comp.snapshotInternal());
  const h = s.history;
  if (json === h.stack[h.index]) return;
  h.stack = h.stack.slice(0, h.index + 1);
  h.stack.push(json);
  if (h.stack.length > HISTORY_DEPTH) h.stack.shift();
  h.index = h.stack.length - 1;
}

export function scheduleRecord(comp: CompositeNode, s: DrillStack) {
  if (s.rebuilding) return;
  if (s.history.timer) clearTimeout(s.history.timer);
  s.history.timer = setTimeout(() => {
    s.history.timer = null;
    recordNow(comp, s);
  }, HISTORY_COALESCE_MS);
}
