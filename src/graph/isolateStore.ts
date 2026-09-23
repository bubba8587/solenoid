// [[B10]] reactFlowView (module-singleton store, storeKit), [[C40]] storesRegisterForget, [[C52]] visibleSelection

import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";

let _focus: Set<string> | null = null;
let _mode: string | null = null;
const { notify, subscribe, version } = createNotifier();

export const isolateStore = {
  get: (): ReadonlySet<string> | null => _focus,
  isActive: (): boolean => _focus !== null,

  mode: (): string | null => _mode,

  isVisible: (id: string): boolean => _focus === null || _focus.has(id),

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

registerNodeForget((id) => {
  if (_focus?.has(id)) {
    _focus.delete(id);
    if (_focus.size === 0) { _focus = null; _mode = null; }
    notify();
  }
});
registerNodeForgetAll(() => isolateStore.exit());

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
