// THE canvas-view seam: what the model-side code (layout, docking, keyboard,
// persistence, process.ts) may ask of the React Flow view. flow/flowArea.ts is the
// one implementation (main canvas, drill-in, static stages all build one).
// Positions here are ABSOLUTE canvas coordinates — the model's frame, never React
// Flow's parent-relative one (that conversion lives in flowModel).

export type AreaNodeView = {
  /** Absolute canvas position — a live read of the MODEL's position (write through
   *  `Area.moveNode`). */
  readonly position: { x: number; y: number };
  /** The LIVE React Flow node wrapper (containment tests, flashes, measures). */
  element: HTMLElement;
};

export type AreaConnView = {
  /** The live React Flow edge group. */
  element: HTMLElement;
};

export type Area = {
  nodeViews: Map<string, AreaNodeView>;
  connectionViews: Map<string, AreaConnView>;
  /** The React Flow pane (client size for framing math, the context-menu anchor). */
  readonly container: HTMLElement;
  /** The transformed content element every card and cable lives in. */
  readonly viewport: HTMLElement;
  /** The camera: pan (x, y) + scale k. Read here; write through `zoom` / `pan`. */
  readonly transform: { x: number; y: number; k: number };
  /** The last pointer position in canvas coordinates (paste-at-cursor and friends). */
  readonly pointer: { x: number; y: number };
  /** Set the scale, then ADD (ox, oy) to the pan — the anchored-zoom step. */
  zoom(k: number, ox?: number, oy?: number): Promise<void>;
  /** Set the pan outright. */
  pan(x: number, y: number): Promise<void>;
  /** Move a node in the model + React Flow state (absolute coordinates). */
  moveNode(id: string, pos: { x: number; y: number }): Promise<void>;
  /** Re-render one card (a node mutated outside React's knowledge). */
  rerenderNode(id: string): Promise<void>;
  /** Re-derive the edge list from the editor. */
  rerenderCables(): Promise<void>;
  /** Subscribe to per-card re-renders (the HTML-in-Canvas layer re-captures that card).
   *  Returns the unsubscribe. */
  onRender(fn: (id: string) => void): () => void;
  /** A mounted card's size WITHOUT a DOM read (React Flow's post-layout measure);
   *  undefined until measured. Prefer over offsetWidth/Height in layout math. */
  measured?(id: string): { w: number; h: number } | undefined;
};
