// React Flow port — a TRANSITIONAL area-shaped adapter (dissolves at C9).
// process.ts, persistence's rebuildGraph, fcReconcile, AreaExtensions.zoomAt,
// NavMenu's zoom pill, flyToNode, and ~69 node components all speak rete's area
// API; on the flow surface those verbs land here and become React Flow state.
import { BaseAreaPlugin } from "rete-area-plugin";
import type { AreaPlugin } from "rete-area-plugin";
import type { NodeEditor } from "rete";
import type { Schemes, AreaExtra } from "../schemes";
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

export type FlowArea = AreaPlugin<Schemes, AreaExtra> & {
  /** Keep nodeViews mirroring the editor's node set + model positions. */
  syncViews(): void;
  /** RF viewport → rete-shaped transform (called from onMove). */
  setTransform(t: { x: number; y: number; k: number }): void;
  /** Track the pointer in canvas coords (paste-at-cursor and friends). */
  setPointer(p: { x: number; y: number }): void;
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

export function makeFlowArea(
  editor: NodeEditor<Schemes>,
  positions: Map<string, { x: number; y: number }>,
  cb: FlowAreaCallbacks,
): FlowArea {
  const nodeViews = new Map<string, FlowNodeView>();
  const transform = { x: 0, y: 0, k: 1 };
  const pointer = { x: 0, y: 0 };
  const detachedHolder = document.createElement("div");
  const detachedContainer = document.createElement("div");

  const pushViewport = () => cb.setViewport({ x: transform.x, y: transform.y, zoom: transform.k });

  const translateNode = async (id: string, pos: { x: number; y: number }) => {
    positions.set(id, { x: pos.x, y: pos.y });
    const view = nodeViews.get(id);
    if (view) view.position = { x: pos.x, y: pos.y };
    cb.moveNode(id, pos);
  };

  const syncViews = () => {
    const live = new Set(editor.getNodes().map((n) => n.id));
    for (const id of [...nodeViews.keys()]) if (!live.has(id)) nodeViews.delete(id);
    for (const id of live) {
      const pos = positions.get(id) ?? { x: 0, y: 0 };
      const view = nodeViews.get(id);
      if (view) view.position = pos;
      else nodeViews.set(id, new FlowNodeView(id, pos, translateNode));
    }
  };
  syncViews();

  const fake = {
    nodeViews,
    connectionViews: new Map(),
    get container(): HTMLElement {
      return cb.getContainer() ?? detachedContainer;
    },
    // zoomAt resolves the editor through the plugin scope chain.
    parentScope() {
      return editor;
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
    },
    async translate(id: string, pos: { x: number; y: number }) {
      if (!nodeViews.has(id)) nodeViews.set(id, new FlowNodeView(id, { ...pos }, translateNode));
      await translateNode(id, pos);
    },
    async resize() {},
    addPipe() {},
    removePipe() {},
    // A used plugin (rete-auto-arrange) resolves the area/editor through the
    // scope chain — wire its parent so parentScope() walks land here.
    use(scope: unknown) {
      (scope as { setParent?: (p: unknown) => void }).setParent?.(fake);
    },
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
  };
  // `parentScope(BaseAreaPlugin)` walks use instanceof checks; adopting the
  // base prototype satisfies them while the fake's OWN properties keep
  // shadowing every method it implements. Un-shadowed base methods would touch
  // missing internals — acceptable: any such call is a bug to surface, not
  // silently no-op.
  Object.setPrototypeOf(fake, BaseAreaPlugin.prototype);
  return fake as unknown as FlowArea;
}
