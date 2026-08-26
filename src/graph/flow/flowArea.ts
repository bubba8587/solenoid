// THE Surface implementation (see ../surface.ts). process.ts, persistence's
// rebuildGraph, fcReconcile, zoomAt, NavMenu's zoom pill, flyToNode, and the
// node components all speak the area-shaped Surface API; those verbs land here
// and become React Flow state.
import type { NodeEditor } from "rete";
import type { Schemes } from "../schemes";
import type { Surface } from "../surface";
import { clampZoom } from "../areaPresets";

export type FlowAreaCallbacks = {
  /** Re-render one node card (rete's `area.update("node", id)`). */
  bumpNode(id: string): void;
  /** Re-derive the edge list from the editor (connection render/update). */
  bumpConnections(): void;
  /** Reflect a programmatic node move into RF state. */
  moveNode(id: string, pos: { x: number; y: number }): void;
  /** Push the camera to the RF viewport (zoomAt, zoom pill, fly-to). */
  setViewport(v: { x: number; y: number; zoom: number }): void;
  /** The live RF pane element (clientWidth/Height for zoomAt framing). */
  getContainer(): HTMLElement | null;
};

export type FlowArea = Surface & {
  /** Keep nodeViews mirroring the editor's node set + model positions. */
  syncViews(): void;
  /** RF viewport → rete-shaped transform (called from onMove). */
  setTransform(t: { x: number; y: number; k: number }): void;
  /** Track the pointer in canvas coords (paste-at-cursor and friends). */
  setPointer(p: { x: number; y: number }): void;
  /** RF measured a card (onNodesChange `dimensions`) — the DOM-free size source. */
  setSize(id: string, size: { w: number; h: number }): void;
};

/** A node view whose element resolves to the LIVE React Flow node wrapper, so
 *  element-reading code (flash, containment, width measures) sees real DOM.
 *  `translate` matches rete's NodeView — the auto-arrange applier calls it
 *  per node. */
class FlowNodeView {
  position: { x: number; y: number };
  private dummy: HTMLElement | null = null;
  constructor(
    private id: string,
    pos: { x: number; y: number },
    private onTranslate: (id: string, pos: { x: number; y: number }) => Promise<void>,
  ) {
    this.position = pos;
  }
  async translate(x: number, y: number): Promise<void> {
    await this.onTranslate(this.id, { x, y });
  }
  get element(): HTMLElement {
    const live = document.querySelector<HTMLElement>(
      `.react-flow__node[data-id="${CSS.escape(this.id)}"]`,
    );
    if (live) return live;
    if (!this.dummy) this.dummy = document.createElement("div");
    return this.dummy;
  }
}

/** Connection views resolve to the live RF edge group (lasso cable hit-testing,
 *  selected-cable z work). */
class FlowConnView {
  constructor(private id: string) {}
  get element(): HTMLElement {
    return (
      document.querySelector<HTMLElement>(`.react-flow__edge[data-id="${CSS.escape(this.id)}"]`) ??
      document.createElement("div")
    );
  }
}

export function makeFlowArea(
  editor: NodeEditor<Schemes>,
  positions: Map<string, { x: number; y: number }>,
  cb: FlowAreaCallbacks,
): FlowArea {
  const nodeViews = new Map<string, FlowNodeView>();
  const connectionViews = new Map<string, FlowConnView>();
  const sizes = new Map<string, { w: number; h: number }>();
  const transform = { x: 0, y: 0, k: 1 };
  const pointer = { x: 0, y: 0 };
  const detachedHolder = document.createElement("div");
  const detachedContainer = document.createElement("div");
  // Rete-shaped `render` events for per-card re-renders — the one channel the
  // HTML-in-Canvas layer needs (it re-captures just the re-rendered card).
  const pipes = new Set<(ctx: unknown) => unknown>();

  const pushViewport = () => cb.setViewport({ x: transform.x, y: transform.y, zoom: transform.k });

  const translateNode = async (id: string, pos: { x: number; y: number }) => {
    positions.set(id, { x: pos.x, y: pos.y });
    const view = nodeViews.get(id);
    if (view) view.position = { x: pos.x, y: pos.y };
    cb.moveNode(id, pos);
  };

  const syncViews = () => {
    const live = new Set(editor.getNodes().map((n) => n.id));
    for (const id of [...nodeViews.keys()]) if (!live.has(id)) { nodeViews.delete(id); sizes.delete(id); }
    for (const id of live) {
      const pos = positions.get(id) ?? { x: 0, y: 0 };
      const view = nodeViews.get(id);
      if (view) view.position = pos;
      else nodeViews.set(id, new FlowNodeView(id, pos, translateNode));
    }
    const liveConns = new Set(editor.getConnections().map((c) => c.id));
    for (const id of [...connectionViews.keys()]) if (!liveConns.has(id)) connectionViews.delete(id);
    for (const id of liveConns) {
      if (!connectionViews.has(id)) connectionViews.set(id, new FlowConnView(id));
    }
  };
  syncViews();

  const fake = {
    nodeViews,
    connectionViews,
    get container(): HTMLElement {
      return cb.getContainer() ?? detachedContainer;
    },
    area: {
      transform,
      pointer,
      content: { holder: detachedHolder },
      // rete Area2D semantics: set the scale, then ADD (ox, oy) to the pan.
      async zoom(k: number, ox = 0, oy = 0) {
        transform.k = clampZoom(k);
        transform.x += ox;
        transform.y += oy;
        pushViewport();
      },
      async translate(x: number, y: number) {
        transform.x = x;
        transform.y = y;
        pushViewport();
      },
      setPointerFrom() {},
      setDragHandler() {},
      setZoomHandler() {},
    },
    async update(type: string, id: string) {
      if (type === "node") cb.bumpNode(id);
      else if (type === "connection") cb.bumpConnections();
      for (const p of pipes) p({ type: "render", data: { type, payload: { id } } });
    },
    async translate(id: string, pos: { x: number; y: number }) {
      if (!nodeViews.has(id)) nodeViews.set(id, new FlowNodeView(id, { ...pos }, translateNode));
      await translateNode(id, pos);
    },
    async resize() {},
    addPipe(fn: (ctx: unknown) => unknown) {
      pipes.add(fn);
    },
    removePipe(fn: (ctx: unknown) => unknown) {
      pipes.delete(fn);
    },
    use() {},
    async emit(ctx: unknown) {
      return ctx;
    },
    destroy() {},
    syncViews,
    setTransform(t: { x: number; y: number; k: number }) {
      transform.x = t.x;
      transform.y = t.y;
      transform.k = t.k;
    },
    setPointer(p: { x: number; y: number }) {
      pointer.x = p.x;
      pointer.y = p.y;
    },
    setSize(id: string, size: { w: number; h: number }) {
      sizes.set(id, size);
    },
    measured(id: string) {
      return sizes.get(id);
    },
  };
  return fake as unknown as FlowArea;
}
