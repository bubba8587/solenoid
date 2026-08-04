// Node-anchored comment threads, shaped like pinStore (module store + an additive optional
// SavedGraph field). No identity/permissions infra — a local author-name string is all of it.

import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";

export interface Comment {
  id: string;
  nodeId: string;
  author: string;
  text: string;
  resolved: boolean;
  time: number;
}

/** The subset persisted in SavedGraph (see persistence.ts SavedComment). */
export type SavedCommentData = Omit<Comment, "time"> & { time?: number };

let _comments: Comment[] = [];
let _seq = 0;
const { notify, subscribe, version } = createNotifier();

export const commentStore = {
  list: (): readonly Comment[] => _comments,
  forNode: (nodeId: string): Comment[] => _comments.filter((c) => c.nodeId === nodeId),
  hasAny: (nodeId: string): boolean => _comments.some((c) => c.nodeId === nodeId),
  hasUnresolved: (nodeId: string): boolean => _comments.some((c) => c.nodeId === nodeId && !c.resolved),

  add(nodeId: string, author: string, text: string): Comment {
    const c: Comment = { id: `cm${++_seq}`, nodeId, author: author.trim() || "Anonymous", text, resolved: false, time: Date.now() };
    _comments = [..._comments, c];
    notify();
    return c;
  },

  update(id: string, patch: Partial<Pick<Comment, "text" | "resolved" | "author">>): void {
    _comments = _comments.map((c) => (c.id === id ? { ...c, ...patch } : c));
    notify();
  },

  remove(id: string): void {
    const next = _comments.filter((c) => c.id !== id);
    if (next.length !== _comments.length) { _comments = next; notify(); }
  },

  removeForNode(nodeId: string): void {
    const next = _comments.filter((c) => c.nodeId !== nodeId);
    if (next.length !== _comments.length) { _comments = next; notify(); }
  },

  clear(): void {
    if (_comments.length > 0) { _comments = []; notify(); }
  },

  /** Serialize for SavedGraph. */
  serialize: (): SavedCommentData[] => _comments.map((c) => ({ ...c })),

  /** Replace the set (loadGraph, after id-remapping — the caller rewrites nodeId). */
  load(list: SavedCommentData[]): void {
    _comments = list.map((c) => ({ ...c, time: c.time ?? Date.now() }));
    _seq = _comments.reduce((m, c) => {
      const n = parseInt(c.id.replace(/\D/g, ""), 10);
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, _seq);
    notify();
  },

  subscribe,
  version,
};

registerNodeForget((nodeId) => commentStore.removeForNode(nodeId));
registerNodeForgetAll(() => commentStore.clear());

// Local to this machine, not per-document.
const AUTHOR_KEY = "solenoid.commentAuthor";
let _author = "";
try { _author = localStorage.getItem(AUTHOR_KEY) ?? ""; } catch { /* private mode */ }
const authorNotifier = createNotifier();
export const commentAuthorStore = {
  get: (): string => _author,
  set(name: string): void {
    _author = name;
    try { localStorage.setItem(AUTHOR_KEY, name); } catch { /* private mode / quota */ }
    authorNotifier.notify();
  },
  subscribe: authorNotifier.subscribe,
  version: authorNotifier.version,
};

// Lifted like problemsPanelUi, so a right-click "Add comment" can force the panel open.
let _panelOpen = false;
let _focusNodeId: string | null = null;
const panelNotifier = createNotifier();
export const commentsPanelUi = {
  isOpen: (): boolean => _panelOpen,
  setOpen(open: boolean): void {
    if (_panelOpen === open) return;
    _panelOpen = open;
    panelNotifier.notify();
  },
  /** Open the panel scrolled/focused to one node's thread (right-click → Add comment). */
  openFor(nodeId: string): void {
    _focusNodeId = nodeId;
    _panelOpen = true;
    panelNotifier.notify();
  },
  consumeFocusNode(): string | null {
    const id = _focusNodeId;
    _focusNodeId = null;
    return id;
  },
  version: panelNotifier.version,
  subscribe: panelNotifier.subscribe,
};
