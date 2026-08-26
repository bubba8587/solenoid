// THE editing-surface type — what every consumer of the old rete
// AreaPlugin<Schemes, AreaExtra> actually uses, stated structurally.
// flow/flowArea.ts is the one implementation (main canvas, drill-in, static
// stages all build one); the rete plugin type died with the rete surface.

export type SurfaceNodeView = {
  position: { x: number; y: number };
  /** The LIVE React Flow node wrapper (containment tests, flashes, measures). */
  element: HTMLElement;
  /** rete NodeView-shaped — layout appliers call it per node. */
  translate(x: number, y: number): Promise<void>;
};

export type SurfaceConnView = {
  element: HTMLElement;
};

export type Surface = {
  nodeViews: Map<string, SurfaceNodeView>;
  connectionViews: Map<string, SurfaceConnView>;
  readonly container: HTMLElement;
  area: {
    transform: { x: number; y: number; k: number };
    pointer: { x: number; y: number };
    content: { holder: HTMLElement };
    /** rete Area2D semantics: set the scale, then ADD (ox, oy) to the pan. */
    zoom(k: number, ox?: number, oy?: number): Promise<void>;
    translate(x: number, y: number): Promise<void>;
    setPointerFrom(e: PointerEvent): void;
    setDragHandler(h: unknown): void;
    setZoomHandler(h: unknown): void;
  };
  /** Re-render one node card / re-derive the edge list. */
  update(type: "node" | "connection", id: string): Promise<void>;
  /** Move a node in the model + RF state. */
  translate(id: string, pos: { x: number; y: number }): Promise<void>;
  resize(...args: unknown[]): Promise<void>;
  addPipe(...args: unknown[]): void;
  removePipe(...args: unknown[]): void;
  use(...args: unknown[]): void;
  emit(ctx: unknown): Promise<unknown>;
  destroy(): void;
};
