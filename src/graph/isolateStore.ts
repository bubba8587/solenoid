// Isolate (Blender-style local view): a focus set of node ids; everything else
// recedes (dimmed + non-interactive, NOT removed — positions, groups, and push
// records survive untouched). A pure VIEW state — not persisted, not in undo.
//
// Module-level store (storeKit) so both React roots (main app + rete node root)
// can read it. `null` = not isolating (everything visible).

import { createNotifier } from "./storeKit";

let _focus: Set<string> | null = null;
const { notify, subscribe, version } = createNotifier();

export const isolateStore = {
  /** The focus set, or null when not isolating. */
  get: (): ReadonlySet<string> | null => _focus,
  isActive: (): boolean => _focus !== null,

  /** Is this node visible? True when not isolating, or when it's in the focus
   *  set. (Non-members are the ones that dim.) */
  isVisible: (id: string): boolean => _focus === null || _focus.has(id),

  /** Enter isolation with a focus set (empty/none clears it). */
  set(ids: Iterable<string> | null): void {
    const next = ids ? new Set(ids) : null;
    _focus = next && next.size > 0 ? next : null;
    notify();
  },

  exit(): void {
    if (_focus !== null) { _focus = null; notify(); }
  },

  subscribe,
  version,
};

// Which isolate endpoint terminal is selected ("entry" | "exit" | null). Routed
// through a store (not component state) so the terminals join the one selection
// system: the canvas's background/node/cable pointerdown handler clears it, and
// selecting a terminal clears node/cable/standoff — mutually exclusive, like a node.
let _selectedEndpoint: string | null = null;
const _epListeners = new Set<() => void>();
let _epVersion = 0;
export const isoEndpointSelect = {
  get: (): string | null => _selectedEndpoint,
  set(v: string | null): void {
    if (_selectedEndpoint === v) return;
    _selectedEndpoint = v;
    _epVersion++;
    for (const l of _epListeners) l();
  },
  version: (): number => _epVersion,
  subscribe(l: () => void): () => void { _epListeners.add(l); return () => { _epListeners.delete(l); }; },
};

// ─── Chain closure (pure, testable) ───────────────────────────────────────────
// Transitive closure over a connection list in BOTH directions from a seed set —
// "everything up- and downstream of this". One BFS; trivially cheap at our sizes.
export function chainClosure(
  edges: ReadonlyArray<{ source: string; target: string }>,
  seed: Iterable<string>,
): Set<string> {
  const out = new Set(seed);
  const queue = [...out];
  while (queue.length > 0) {
    const id = queue.pop()!;
    for (const e of edges) {
      if (e.source === id && !out.has(e.target)) { out.add(e.target); queue.push(e.target); }
      if (e.target === id && !out.has(e.source)) { out.add(e.source); queue.push(e.source); }
    }
  }
  return out;
}
