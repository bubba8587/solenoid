// [[C43]] oneFlowSurface, [[C40]] storesRegisterForget
// Cable state that lives OUTSIDE rete's editor: cable selection, socket highlight, and
// the two ghost-cable stores (tree/specs/canvas/react-flow-surface-contract.md § ghost cables).

import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";

type Listener = () => void;

let _selectedConnIds = new Set<string>();
let _selVersion = 0;
const _selListeners = new Set<Listener>();

function notifySelection() {
  _selVersion++;
  for (const l of _selListeners) l();
}

const sameIds = (next: Iterable<string>) => {
  const ns = next instanceof Set ? next : new Set(next);
  if (ns.size !== _selectedConnIds.size) return false;
  for (const id of ns) if (!_selectedConnIds.has(id)) return false;
  return true;
};

export const cableSelectionStore = {
  has: (id: string) => _selectedConnIds.has(id),
  ids: () => [..._selectedConnIds],
  count: () => _selectedConnIds.size,
  // Version snapshot for useSyncExternalStore (stable primitive getter).
  version: () => _selVersion,
  set: (id: string | null) => {
    cableSelectionStore.replaceAll(id ? [id] : []);
  },
  replaceAll: (ids: Iterable<string>) => {
    if (sameIds(ids)) return;
    _selectedConnIds = new Set(ids);
    notifySelection();
  },
  toggle: (id: string) => {
    if (!_selectedConnIds.delete(id)) _selectedConnIds.add(id);
    notifySelection();
  },
  remove: (id: string) => {
    if (!_selectedConnIds.delete(id)) return;
    notifySelection();
  },
  clear: () => {
    if (_selectedConnIds.size === 0) return;
    _selectedConnIds.clear();
    notifySelection();
  },
  subscribe: (l: Listener) => {
    _selListeners.add(l);
    return () => { _selListeners.delete(l); };
  },
};

// Three independent highlight slots (drag, cable hover, socket hover); a socket is lit
// if any slot holds it. Sharing one slot lets the socket's mouseleave clear the cable's
// mouseenter as the pointer slides off a socket onto its cable.

export function dragSocketKey(nodeId: string, key: string) {
  return `${nodeId}::${key}`;
}

const _hlSlots = {
  drag:        new Set<string>(),
  cableHover:  new Set<string>(),
  socketHover: new Set<string>(),
};
let _hlVersion = 0;
const _hlListeners = new Set<Listener>();

function notifyHighlights() {
  _hlVersion++;
  for (const l of _hlListeners) l();
}

// Skip the notify on unchanged keys: setDrag fires on EVERY pointermove and each notify
// re-renders every mounted socket/pill/group summary, janking drags on a big graph.
function sameKeys(cur: Set<string>, keys: string[]): boolean {
  if (cur.size !== keys.length) return false;
  for (const k of keys) if (!cur.has(k)) return false;
  return true;
}

export const socketHighlightStore = {
  version: () => _hlVersion,
  isHighlighted: (key: string) =>
    _hlSlots.drag.has(key) || _hlSlots.cableHover.has(key) || _hlSlots.socketHover.has(key),
  setDrag: (keys: string[]) => {
    if (sameKeys(_hlSlots.drag, keys)) return;
    _hlSlots.drag = new Set(keys);
    notifyHighlights();
  },
  setCableHover: (keys: string[]) => {
    if (sameKeys(_hlSlots.cableHover, keys)) return;
    _hlSlots.cableHover = new Set(keys);
    notifyHighlights();
  },
  setSocketHover: (keys: string[]) => {
    if (sameKeys(_hlSlots.socketHover, keys)) return;
    _hlSlots.socketHover = new Set(keys);
    notifyHighlights();
  },
  subscribe: (l: Listener) => {
    _hlListeners.add(l);
    return () => { _hlListeners.delete(l); };
  },
};

// Cable IDs highlighted because a SOCKET is hovered — only NodeSocket writes/clears it.

const _shPropIds = new Set<string>();
let _shPropVersion = 0;
const _shPropListeners = new Set<Listener>();
function notifyShProp() { _shPropVersion++; for (const l of _shPropListeners) l(); }

export const socketHoverCableStore = {
  version:   () => _shPropVersion,
  isHovered: (id: string) => _shPropIds.has(id),
  set: (ids: string[]) => {
    _shPropIds.clear();
    for (const id of ids) _shPropIds.add(id);
    notifyShProp();
  },
  clear: () => {
    if (_shPropIds.size === 0) return;
    _shPropIds.clear();
    notifyShProp();
  },
  subscribe: (l: Listener) => {
    _shPropListeners.add(l);
    return () => { _shPropListeners.delete(l); };
  },
};

// A side set keyed by id, not a `.ghost` property on the connection object — rete
// copies / serialises that object opaquely.

const _ghostIds = new Set<string>();
const _ghostListeners = new Set<Listener>();

function notifyGhost() { for (const l of _ghostListeners) l(); }

export const cableGhostStore = {
  isGhost: (id: string) => _ghostIds.has(id),
  mark: (id: string) => {
    if (_ghostIds.has(id)) return;
    _ghostIds.add(id);
    notifyGhost();
  },
  commit: (id: string) => {
    if (!_ghostIds.delete(id)) return;
    notifyGhost();
  },
  // `.size` flips when membership changes so any subscriber re-renders.
  version: () => _ghostIds.size,
  subscribe: (l: Listener) => {
    _ghostListeners.add(l);
    return () => { _ghostListeners.delete(l); };
  },
};

// Pending-reconnect ghosts (Option B in the spec): a NON-connection ghost keyed by
// source·output·target·input, re-materialised by `cablePendingReconnect.ts`. Persist NOTHING.
export interface PendingReconnect {
  /** Stable id from the four endpoint fields, so a re-mark of the same drop is idempotent. */
  id: string;
  source: string; sourceOutput: string;
  target: string; targetInput: string;
  /** The target socket's label at drop time — the fallback match when the key changed. */
  label: string;
}
const _pending = new Map<string, PendingReconnect>();
const _pendingListeners = new Set<Listener>();
function notifyPending() { for (const l of _pendingListeners) l(); }
const pendingKey = (s: string, so: string, t: string, ti: string) => `${s}\u0000${so}\u0000${t}\u0000${ti}`;

export const cablePendingStore = {
  all: (): PendingReconnect[] => [..._pending.values()],
  forSource: (nodeId: string): PendingReconnect[] => [..._pending.values()].filter((p) => p.source === nodeId),
  mark: (e: Omit<PendingReconnect, "id">): string => {
    const id = pendingKey(e.source, e.sourceOutput, e.target, e.targetInput);
    if (_pending.has(id)) return id;
    _pending.set(id, { id, ...e });
    notifyPending();
    return id;
  },
  drop: (id: string): void => { if (_pending.delete(id)) notifyPending(); },
  /** Both directions: a removed node's ghosts as a source AND as a target both die. */
  dropForNode: (nodeId: string): void => {
    let changed = false;
    for (const [id, p] of _pending) if (p.source === nodeId || p.target === nodeId) { _pending.delete(id); changed = true; }
    if (changed) notifyPending();
  },
  clear: (): void => { if (_pending.size) { _pending.clear(); notifyPending(); } },
  // Membership-size version: every mark/drop changes it, so subscribers re-render.
  version: (): number => _pending.size,
  subscribe: (l: Listener): (() => void) => {
    _pendingListeners.add(l);
    return () => { _pendingListeners.delete(l); };
  },
};

registerNodeForget((nodeId) => cablePendingStore.dropForNode(nodeId));
registerNodeForgetAll(() => cablePendingStore.clear());
