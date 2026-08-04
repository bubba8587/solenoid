// A focus set of node ids; non-members recede but are NOT removed. Pure VIEW state —
// not persisted, not in undo. `null` = not isolating.

import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";

let _focus: Set<string> | null = null;
// Which gesture produced the focus set; the IsolatePill labels the mode.
let _mode: string | null = null;
const { notify, subscribe, version } = createNotifier();

export const isolateStore = {
  /** The focus set, or null when not isolating. */
  get: (): ReadonlySet<string> | null => _focus,
  isActive: (): boolean => _focus !== null,

  /** The pill's mode label ("Where used"), or null for plain isolate. */
  mode: (): string | null => _mode,

  /** True when not isolating, or when the node is in the focus set. */
  isVisible: (id: string): boolean => _focus === null || _focus.has(id),

  /** Enter isolation with a focus set (empty/none clears it). */
  set(ids: Iterable<string> | null, mode?: string): void {
    const next = ids ? new Set(ids) : null;
    _focus = next && next.size > 0 ? next : null;
    _mode = _focus ? (mode ?? null) : null;
    notify();
  },

  exit(): void {
    if (_focus !== null) { _focus = null; _mode = null; notify(); }
  },

  subscribe,
  version,
};

// A load must EXIT isolate: the focus set holds the OLD graph's ids, so every
// regenerated id would be a non-member and the whole new graph would dim.
registerNodeForget((id) => {
  if (_focus?.has(id)) {
    _focus.delete(id);
    if (_focus.size === 0) { _focus = null; _mode = null; }
    notify();
  }
});
registerNodeForgetAll(() => isolateStore.exit());

// A store, not component state, so the terminals join the ONE selection system and
// stay mutually exclusive with node/cable/standoff selection.
let _selectedEndpoint: string | null = null;
const epNotifier = createNotifier();
export const isoEndpointSelect = {
  get: (): string | null => _selectedEndpoint,
  set(v: string | null): void {
    if (_selectedEndpoint === v) return;
    _selectedEndpoint = v;
    epNotifier.notify();
  },
  version: epNotifier.version,
  subscribe: epNotifier.subscribe,
};

// Transitive closure over the edges in BOTH directions from the seed set.
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
