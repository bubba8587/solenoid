// [[B10]] reactFlowView, [[C43]] oneFlowSurface, [[C87]] groupsAreSubflows

export type View = {
  hasNode(id: string): boolean;
  /** A live read of the model's `node.position`; write through `moveNode`. */
  position(id: string): { x: number; y: number } | undefined;
  /** Resolved on every call, so cache it inside per-frame loops; null while unmounted. */
  nodeElement(id: string): HTMLElement | null;
  connectionElement(id: string): HTMLElement | null;
  readonly container: HTMLElement;
  readonly viewport: HTMLElement;
  readonly transform: { x: number; y: number; k: number };
  readonly pointer: { x: number; y: number };
  /** Sets the scale, then adds (ox, oy) to the pan: the anchored-zoom step. */
  zoom(k: number, ox?: number, oy?: number): Promise<void>;
  pan(x: number, y: number): Promise<void>;
  moveNode(id: string, pos: { x: number; y: number }): Promise<void>;
  rerenderNode(id: string): Promise<void>;
  rerenderCables(): Promise<void>;
  onRender(fn: (id: string) => void): () => void;
  /** React Flow's post-layout measure, with no DOM read; undefined until measured. */
  measured?(id: string): { w: number; h: number } | undefined;
};
