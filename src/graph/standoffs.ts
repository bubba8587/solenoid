// The standoff model + its module-level store (no React context). Direction is
// encoded by `a.anchor`: the axis points from a toward b, so
// `min ≤ dot(Pb − Pa, axis) ≤ max` with positive min/max.

import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";
export type StandoffAnchor = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

export interface StandoffEnd {
  nodeId: string;
  anchor: StandoffAnchor;
}

export interface Standoff {
  id: string;
  a: StandoffEnd;
  b: StandoffEnd;
  min: number;
  max: number;
  /** When true the solver also pulls the perpendicular offset to 0, so the two
   *  ends align exactly along the (45°-quantized) axis — a rigid 45° lock.
   *  Default/absent keeps the classic axis-band-only behavior (the bar slants). */
  locked?: boolean;
}

/** Hard floor for a standoff's min distance — nodes never sit closer than this
 *  along the axis, so a standoff always leaves a readable gap. */
export const STANDOFF_MIN = 30;

const D = Math.SQRT1_2; // diagonal unit component

export const ANCHOR_DIR: Record<StandoffAnchor, { x: number; y: number }> = {
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
  ne: { x: D, y: -D },
  nw: { x: -D, y: -D },
  se: { x: D, y: D },
  sw: { x: -D, y: D },
};

export const OPPOSITE_ANCHOR: Record<StandoffAnchor, StandoffAnchor> = {
  n: "s", s: "n", e: "w", w: "e", ne: "sw", sw: "ne", nw: "se", se: "nw",
};

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The attachment point an anchor names on a box (side midpoint or corner). */
export function anchorPoint(box: Box, anchor: StandoffAnchor): { x: number; y: number } {
  const xs = anchor.includes("w") ? box.x : anchor.includes("e") ? box.x + box.w : box.x + box.w / 2;
  const ys = anchor.includes("n") ? box.y : anchor.includes("s") ? box.y + box.h : box.y + box.h / 2;
  return { x: xs, y: ys };
}

/** Nearest of the 8 anchors to a direction vector (used at creation). */
export function anchorFromVector(dx: number, dy: number): StandoffAnchor {
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI; // -180..180, 0 = east, y-down
  const sector = Math.round(deg / 45) * 45;
  switch (((sector % 360) + 360) % 360) {
    case 0: return "e";
    case 45: return "se";
    case 90: return "s";
    case 135: return "sw";
    case 180: return "w";
    case 225: return "nw";
    case 270: return "n";
    default: return "ne"; // 315
  }
}

/** Connected components of the standoff graph: each returned array is a set of
 *  node ids joined (directly or transitively) by standoffs — a "cluster" that
 *  layout ops can treat as one rigid block. Singletons (nodes with no standoff)
 *  are omitted; only clusters of 2+ are returned. Computed from current state. */
export function standoffClusters(standoffs: readonly Standoff[] = _standoffs): string[][] {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
  };
  for (const s of standoffs) { link(s.a.nodeId, s.b.nodeId); link(s.b.nodeId, s.a.nodeId); }
  const seen = new Set<string>();
  const clusters: string[][] = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const stack = [start];
    const comp: string[] = [];
    seen.add(start);
    while (stack.length) {
      const n = stack.pop()!;
      comp.push(n);
      for (const m of adj.get(n) ?? []) if (!seen.has(m)) { seen.add(m); stack.push(m); }
    }
    if (comp.length >= 2) clusters.push(comp);
  }
  return clusters;
}

type Listener = () => void;

let _standoffs: Standoff[] = [];
let _selectedId: string | null = null;
let _version = 0;
const _listeners = new Set<Listener>();
let _nextId = 1;
let _participants: Set<string> | null = null;
let _participantsVersion = -1;

function notify() {
  _version++;
  for (const l of _listeners) l();
}

export const standoffStore = {
  all: (): readonly Standoff[] => _standoffs,
  get: (id: string) => _standoffs.find((s) => s.id === id),
  version: () => _version,
  selected: () => _selectedId,
  isEmpty: () => _standoffs.length === 0,
  /** Every node id that appears as a standoff end, cached by store version.
   *  Ties are SPARSE (each Note to its group), so drag-time work gates on this:
   *  a node outside the set can't tow anything and its move draws no bar. */
  participants(): ReadonlySet<string> {
    if (_participants === null || _participantsVersion !== _version) {
      _participants = new Set<string>();
      for (const s of _standoffs) { _participants.add(s.a.nodeId); _participants.add(s.b.nodeId); }
      _participantsVersion = _version;
    }
    return _participants;
  },

  add(a: StandoffEnd, b: StandoffEnd, min: number, max: number, locked = false): Standoff {
    const lo = Math.max(STANDOFF_MIN, Math.min(min, max));
    const s: Standoff = { id: `standoff-${_nextId++}`, a, b, min: lo, max: Math.max(lo, max), locked };
    _standoffs = [..._standoffs, s];
    notify();
    return s;
  },
  remove(id: string) {
    const before = _standoffs.length;
    _standoffs = _standoffs.filter((s) => s.id !== id);
    if (_selectedId === id) _selectedId = null;
    if (_standoffs.length !== before) notify();
  },
  /** Drop every standoff touching a (deleted) node. */
  removeForNode(nodeId: string) {
    const before = _standoffs.length;
    _standoffs = _standoffs.filter((s) => s.a.nodeId !== nodeId && s.b.nodeId !== nodeId);
    if (_selectedId && !_standoffs.some((s) => s.id === _selectedId)) _selectedId = null;
    if (_standoffs.length !== before) notify();
  },
  /** True if a standoff already links this pair (either direction). */
  hasPair(aId: string, bId: string) {
    return _standoffs.some(
      (s) =>
        (s.a.nodeId === aId && s.b.nodeId === bId) ||
        (s.a.nodeId === bId && s.b.nodeId === aId),
    );
  },
  setBand(id: string, min: number, max: number) {
    const s = _standoffs.find((x) => x.id === id);
    if (!s) return;
    s.min = Math.max(STANDOFF_MIN, Math.min(min, max));
    s.max = Math.max(s.min, max);
    notify();
  },
  /** Toggle the rigid 45° lock (perpendicular pulled to 0 by the solver). */
  setLocked(id: string, locked: boolean) {
    const s = _standoffs.find((x) => x.id === id);
    if (!s || !!s.locked === locked) return;
    s.locked = locked;
    notify();
  },
  /** Rotate the standoff's axis to one of the 8 (45°) directions: `anchor` is the
   *  side/corner of a the bar leaves from; b takes the opposite so the bar spans
   *  the pair. Driven by the toolbar angle dial. */
  setAxis(id: string, anchor: StandoffAnchor) {
    const s = _standoffs.find((x) => x.id === id);
    if (!s || s.a.anchor === anchor) return;
    s.a = { ...s.a, anchor };
    s.b = { ...s.b, anchor: OPPOSITE_ANCHOR[anchor] };
    notify();
  },
  select(id: string | null) {
    if (_selectedId === id) return;
    _selectedId = id;
    notify();
  },
  clear() {
    if (_standoffs.length === 0 && !_selectedId) return;
    _standoffs = [];
    _selectedId = null;
    notify();
  },
  subscribe(l: Listener) {
    _listeners.add(l);
    return () => { _listeners.delete(l); };
  },
};

// Bumped by Canvas whenever node positions/sizes may have changed, so the
// standoff layer re-measures and redraws.

let _tick = 0;
const _tickListeners = new Set<Listener>();

export const standoffLayoutTick = {
  version: () => _tick,
  bump() {
    _tick++;
    for (const l of _tickListeners) l();
  },
  subscribe(l: Listener) {
    _tickListeners.add(l);
    return () => { _tickListeners.delete(l); };
  },
};

// Canvas owns the editor/area and registers the actual settle routine (solve +
// apply translates); other modules request a settle through this indirection.

export type SettleOpts = { forceLock?: boolean };
let _settle: (pinned?: Set<string>, opts?: SettleOpts) => void = () => {};
export function setStandoffSettle(fn: (pinned?: Set<string>, opts?: SettleOpts) => void) {
  _settle = fn;
}
export function settleStandoffs(pinned?: Set<string>, opts?: SettleOpts) {
  _settle(pinned, opts);
}

// Registered like every node-keyed store (nodeStoreRegistry): a deleted node's
// standoffs go with it, and a wholesale rebuild clears in one pass.
registerNodeForget((nodeId) => standoffStore.removeForNode(nodeId));
registerNodeForgetAll(() => standoffStore.clear());
