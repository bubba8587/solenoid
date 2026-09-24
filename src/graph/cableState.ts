// [[C43]] oneFlowSurface, [[B10]] reactFlowView

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

// Three highlight slots, because one shared slot lets a socket's mouseleave clear the cable's mouseenter as the pointer slides onto the cable.

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

// Skip the notify on unchanged keys: setDrag fires on every pointermove, and each notify re-renders every mounted socket.
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

// A side set keyed by id, because rete copies and serializes the connection object opaquely.

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
  version: () => _ghostIds.size,
  subscribe: (l: Listener) => {
    _ghostListeners.add(l);
    return () => { _ghostListeners.delete(l); };
  },
};

export interface PendingReconnect {
  id: string;
  source: string; sourceOutput: string;
  target: string; targetInput: string;
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
  dropForNode: (nodeId: string): void => {
    let changed = false;
    for (const [id, p] of _pending) if (p.source === nodeId || p.target === nodeId) { _pending.delete(id); changed = true; }
    if (changed) notifyPending();
  },
  clear: (): void => { if (_pending.size) { _pending.clear(); notifyPending(); } },
  version: (): number => _pending.size,
  subscribe: (l: Listener): (() => void) => {
    _pendingListeners.add(l);
    return () => { _pendingListeners.delete(l); };
  },
};

registerNodeForget((nodeId) => cablePendingStore.dropForNode(nodeId));
registerNodeForgetAll(() => cablePendingStore.clear());
