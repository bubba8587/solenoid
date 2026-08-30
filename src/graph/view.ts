// THE canvas-view seam: what the model-side code (layout, docking, keyboard,
// persistence, process.ts) may ask of the React Flow view. flow/flowView.ts is the
// one implementation (main canvas, drill-in, static stages all build one).
// Positions here are ABSOLUTE canvas coordinates — the model's frame, never React
// Flow's parent-relative one (that conversion lives in flowModel).

export type View = {
  /** Whether this view's editor holds the node — the "belongs to this surface" test. */
  hasNode(id: string): boolean;
  /** A node's absolute canvas position (a live read of the MODEL's `node.position`;
   *  write through `moveNode`). Undefined for an id this view's editor doesn't hold. */
  position(id: string): { x: number; y: number } | undefined;
  /** The LIVE React Flow node wrapper (containment tests, flashes, measures) —
   *  null while unmounted. Resolved per call; cache locally inside per-frame loops. */
  nodeElement(id: string): HTMLElement | null;
  /** The live React Flow edge group (lasso cable hit-testing, selected-cable z). */
  connectionElement(id: string): HTMLElement | null;
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
