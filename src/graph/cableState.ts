// Two pieces of shared state about cables that live OUTSIDE rete's
// editor: the currently "selected" connections (highlight + delete via
// keyboard), and the set of connection IDs currently rendered as
// "ghosts" (a dashed cable left behind after splicing a 1-in/1-out
// node out of a chain — click to materialise as a real cable).
//
// We hold them in module-level stores instead of React context because
// ConnectionComponent and the keyboard handler in Canvas don't share a
// React tree (rete renders connections in its own React root).

type Listener = () => void;

// ─── selection ──────────────────────────────────────────────────────
// Multi-select: a set of connection ids. Plain click replaces the
// selection (`set`), Ctrl/Cmd-click toggles membership (`toggle`),
// the lasso replaces it wholesale (`replaceAll`).

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
  // Replace the selection with one cable (or clear with null).
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

// ─── socket highlight ────────────────────────────────────────────────
// Three independent slots so the three sources of highlight — cable
// drag, cable hover, and socket hover — never overwrite each other.
// A socket is lit if it appears in any slot.
//
//  drag        set by Canvas during cable draw
//  cableHover  set by ConnectionComponent on mouseenter/mouseleave
//  socketHover set by NodeSocket on mouseenter/mouseleave
//
// Keeping them separate is critical: when the mouse slides off an
// output socket onto its cable, the socket's mouseleave fires before
// the cable's mouseenter. If they share a slot, the cable's mouseenter
// would see its work cleared by the socket's mouseleave.

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

// Skip the notify when the incoming keys equal the slot's current set — the drag
// handler calls setDrag on EVERY pointermove, and each notify re-renders every
// mounted NodeSocket, CollapsedInputPill and GroupNode summary (hidden collapsed
// members included), which made cable drags jank on a big graph.
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

// ─── socket-hover cable propagation ─────────────────────────────────
// Cable IDs highlighted because a SOCKET is being hovered.
// Only NodeSocket writes/clears this.

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

// ─── ghost cables ───────────────────────────────────────────────────

// We could put a `.ghost` property on the connection object itself,
// but rete copies / serialises that object opaquely. Keeping a side
// set keyed by id sidesteps that concern, and the ghost set is
// trivially serialisable on its own.

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
  // Version snapshot — useSyncExternalStore wants a stable
  // primitive-returning getter. `.size` flips when membership
  // changes so any component that subscribes re-renders.
  version: () => _ghostIds.size,
  subscribe: (l: Listener) => {
    _ghostListeners.add(l);
    return () => { _ghostListeners.delete(l); };
  },
};
