// THE Area implementation (see ../area.ts): the model-side verbs land here and
// become React Flow state through late-bound callbacks the surface supplies.
import type { NodeEditor } from "rete";
import type { Schemes } from "../schemes";
import type { Area } from "../area";
import { clampZoom } from "../areaPresets";

export type FlowAreaCallbacks = {
  /** Re-render one node card. */
  bumpNode(id: string): void;
  /** Re-derive the edge list from the editor. */
  bumpConnections(): void;
  /** Reflect a programmatic node move into RF state. */
  moveNode(id: string, pos: { x: number; y: number }): void;
  /** Push the camera to the RF viewport (zoomAt, zoom pill, fly-to). */
  setViewport(v: { x: number; y: number; zoom: number }): void;
  /** The live RF pane element (clientWidth/Height for zoomAt framing). */
  getContainer(): HTMLElement | null;
};

/** The surface-side half: what FlowSurface writes back as React Flow reports. */
export type FlowArea = Area & {
  /** Keep nodeViews mirroring the editor's node set + model positions. */
  syncViews(): void;
  /** RF viewport → the camera (called from onMove). */
  setTransform(t: { x: number; y: number; k: number }): void;
  /** Track the pointer in canvas coords. */
  setPointer(p: { x: number; y: number }): void;
  /** RF measured a card (onNodesChange `dimensions`) — the DOM-free size source. */
  setSize(id: string, size: { w: number; h: number }): void;
};

/** A node view whose element resolves to the LIVE React Flow node wrapper, so
 *  element-reading code (flash, containment, width measures) sees real DOM. */
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
  const detached = document.createElement("div");
  const renderListeners = new Set<(id: string) => void>();

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

  const area: FlowArea = {
    nodeViews,
    connectionViews,
    get container(): HTMLElement {
      return cb.getContainer() ?? detached;
    },
    get viewport(): HTMLElement {
      return cb.getContainer()?.querySelector<HTMLElement>(".react-flow__viewport") ?? detached;
    },
    transform,
    pointer,
    async zoom(k, ox = 0, oy = 0) {
      transform.k = clampZoom(k);
      transform.x += ox;
      transform.y += oy;
      pushViewport();
    },
    async pan(x, y) {
      transform.x = x;
      transform.y = y;
      pushViewport();
    },
    async moveNode(id, pos) {
      if (!nodeViews.has(id)) nodeViews.set(id, new FlowNodeView(id, { ...pos }, translateNode));
      await translateNode(id, pos);
    },
    async rerenderNode(id) {
      cb.bumpNode(id);
      for (const l of renderListeners) l(id);
    },
    async rerenderCables() {
      cb.bumpConnections();
    },
    onRender(fn) {
      renderListeners.add(fn);
      return () => { renderListeners.delete(fn); };
    },
    measured(id) {
      return sizes.get(id);
    },
    syncViews,
    setTransform(t) {
      transform.x = t.x;
      transform.y = t.y;
      transform.k = t.k;
    },
    setPointer(p) {
      pointer.x = p.x;
      pointer.y = p.y;
    },
    setSize(id, size) {
      sizes.set(id, size);
    },
  };
  return area;
}
