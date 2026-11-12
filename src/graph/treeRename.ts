// [[A1]] visualGraphCalculator, [[save-format#A save loses nothing quietly]]
// A request for the file tree to start renaming a document in place (Save keeping an example). No-op while the tree
// isn't mounted.

let handler: ((id: string) => void) | null = null;

export function requestTreeRename(id: string): void {
  handler?.(id);
}

/** The tree registers its rename; the returned function unregisters it. */
export function onTreeRename(h: (id: string) => void): () => void {
  handler = h;
  return () => { if (handler === h) handler = null; };
}
