// Free-drawn cables: annotation curves with their own shape, ends, width, head size and
// color. Never wiring — no sockets, no value, no part in `cableShapeStore`.
// Spec: docs/subsystem-invariants.md § Drawn cables.
import { createNotifier } from "./storeKit";
import { registerNodeForgetAll } from "./nodeStoreRegistry";
import type { CableShape } from "./cableShape";
import type { DrawnPoint, DrawnArrows } from "./drawnCablePath";
import { isDrawnArrows, hasAngleOverride } from "./drawnCablePath";

export interface DrawnCable {
  id: string;
  /** At least two, in draw order. */
  points: DrawnPoint[];
  shape: CableShape;
  arrows: DrawnArrows;
  /** Canvas units, so it scales with the zoom like a wired cable. */
  width: number;
  /** Multiple of ARROW_LEN / ARROW_HALF, independent of `width`. */
  headScale: number;
  /** A palette slot id, resolved to a hex at render. */
  color: string;
}

/** The persisted form: ids are regenerated on load. */
export type SavedDrawnCable = Omit<DrawnCable, "id">;

export const DRAWN_DEFAULT_SHAPE: CableShape = "spline";
export const DRAWN_DEFAULT_COLOR = "gray";
export const DRAWN_DEFAULT_ARROWS: DrawnArrows = "end";
export const DRAWN_DEFAULT_WIDTH = 2.4;
export const DRAWN_DEFAULT_HEAD_SCALE = 1;

export const DRAWN_WIDTHS: { value: number; label: string }[] = [
  { value: 1.2, label: "Hairline" },
  { value: 1.8, label: "Thin" },
  { value: 2.4, label: "Medium" },
  { value: 3.6, label: "Thick" },
  { value: 5.2, label: "Heavy" },
];

export const DRAWN_HEAD_SCALES: { value: number; label: string }[] = [
  { value: 0.7, label: "Small" },
  { value: 1, label: "Medium" },
  { value: 1.5, label: "Large" },
  { value: 2.2, label: "Huge" },
];

/** The dial step. 45° only (author ruling, see the spec); pinned by test. */
export const DRAWN_ANGLE_STEP = 45;

const WIDTH_MIN = 0.2;
const WIDTH_MAX = 40;
const HEAD_MIN = 0.1;
const HEAD_MAX = 10;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function num(v: unknown, fallback: number, lo: number, hi: number): number {
  return typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
}

/** The listed option nearest `v`, so a hand-edited value still selects something. */
export function nearestOption(options: readonly { value: number }[], v: number): number {
  let best = options[0].value;
  for (const o of options) if (Math.abs(o.value - v) < Math.abs(best - v)) best = o.value;
  return best;
}

const isCableShape = (v: unknown): v is CableShape =>
  v === "spline" || v === "straight" || v === "diagonal";

const isPoint = (v: unknown): v is DrawnPoint =>
  typeof v === "object" && v !== null &&
  Number.isFinite((v as DrawnPoint).x) && Number.isFinite((v as DrawnPoint).y);

const clonePoint = (p: DrawnPoint): DrawnPoint =>
  hasAngleOverride(p) ? { x: p.x, y: p.y, angle: p.angle } : { x: p.x, y: p.y };

function normalizeDeg(deg: number): number {
  const m = deg % 360;
  return m < 0 ? m + 360 : m;
}

// Registered by the surface (autosave + an undo entry), like process.ts's graphChanged
// hook, so this module never imports persistence or the history.
let _commit: () => void = () => {};
export function setDrawnCommit(fn: () => void) {
  _commit = fn;
}
/** Call after every settled edit to a drawn cable. */
export function commitDrawn() {
  _commit();
}

/** Finish the armed run and record it. False when there was nothing to draw. */
export function finishDrawing(): boolean {
  if (!drawModeStore.finish()) return false;
  _commit();
  return true;
}

let _cables: DrawnCable[] = [];
let _selectedId: string | null = null;
let _activePoint: number | null = null;
let _nextId = 1;
const { notify, subscribe, version } = createNotifier();

function find(id: string): DrawnCable | undefined {
  return _cables.find((c) => c.id === id);
}

export const drawnCableStore = {
  all: (): readonly DrawnCable[] => _cables,
  get: (id: string): DrawnCable | undefined => find(id),
  isEmpty: () => _cables.length === 0,
  selected: () => _selectedId,
  version,
  subscribe,

  select(id: string | null) {
    if (_selectedId === id) return;
    _selectedId = id && find(id) ? id : null;
    _activePoint = null;
    notify();
  },

  /** The point the panel's dial edits; null when none. */
  activePoint: () => _activePoint,

  setActivePoint(index: number | null) {
    const c = _selectedId ? find(_selectedId) : undefined;
    const next = c && index !== null && index >= 0 && index < c.points.length ? index : null;
    if (_activePoint === next) return;
    _activePoint = next;
    notify();
  },

  /** Null when fewer than two points. */
  add(points: readonly DrawnPoint[], init?: Partial<Omit<DrawnCable, "id" | "points">>): DrawnCable | null {
    if (points.length < 2) return null;
    const c: DrawnCable = {
      id: `drawn-${_nextId++}`,
      points: points.map(clonePoint),
      shape: init?.shape ?? DRAWN_DEFAULT_SHAPE,
      arrows: init?.arrows ?? DRAWN_DEFAULT_ARROWS,
      width: init?.width ?? DRAWN_DEFAULT_WIDTH,
      headScale: init?.headScale ?? DRAWN_DEFAULT_HEAD_SCALE,
      color: init?.color ?? DRAWN_DEFAULT_COLOR,
    };
    _cables = [..._cables, c];
    notify();
    return c;
  },

  remove(id: string) {
    const before = _cables.length;
    _cables = _cables.filter((c) => c.id !== id);
    if (_cables.length === before) return;
    if (_selectedId === id) { _selectedId = null; _activePoint = null; }
    notify();
  },

  setShape(id: string, shape: CableShape) {
    const c = find(id);
    if (!c || c.shape === shape) return;
    c.shape = shape;
    notify();
  },

  setArrows(id: string, arrows: DrawnArrows) {
    const c = find(id);
    if (!c || c.arrows === arrows) return;
    c.arrows = arrows;
    notify();
  },

  setWidth(id: string, width: number) {
    const c = find(id);
    const w = clamp(width, WIDTH_MIN, WIDTH_MAX);
    if (!c || c.width === w) return;
    c.width = w;
    notify();
  },

  setHeadScale(id: string, headScale: number) {
    const c = find(id);
    const h = clamp(headScale, HEAD_MIN, HEAD_MAX);
    if (!c || c.headScale === h) return;
    c.headScale = h;
    notify();
  },

  setColor(id: string, color: string) {
    const c = find(id);
    if (!c || c.color === color) return;
    c.color = color;
    notify();
  },

  movePoint(id: string, index: number, to: DrawnPoint) {
    const c = find(id);
    if (!c || index < 0 || index >= c.points.length) return;
    // Spread: a pinned `angle` must survive the drag.
    c.points[index] = { ...c.points[index], x: to.x, y: to.y };
    notify();
  },

  /** Pin this point's heading, or `null` to hand it back to the derived chord. */
  setPointAngle(id: string, index: number, angle: number | null) {
    const c = find(id);
    if (!c || index < 0 || index >= c.points.length) return;
    const p = c.points[index];
    if (angle === null) {
      if (p.angle === undefined) return;
      delete p.angle;
    } else {
      const a = normalizeDeg(angle);
      if (p.angle === a) return;
      p.angle = a;
    }
    notify();
  },

  translate(id: string, dx: number, dy: number) {
    const c = find(id);
    if (!c || (dx === 0 && dy === 0)) return;
    c.points = c.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
    notify();
  },

  /** Insert a new point BEFORE `index` (1 … length-1), splitting the span that ends there. */
  insertPoint(id: string, index: number, at: DrawnPoint) {
    const c = find(id);
    if (!c || index < 1 || index > c.points.length - 1) return;
    c.points = [...c.points.slice(0, index), { x: at.x, y: at.y }, ...c.points.slice(index)];
    if (_selectedId === id && _activePoint !== null && _activePoint >= index) _activePoint++;
    notify();
  },

  /** Split the span after `index` at its midpoint (the last point splits the span before
   *  it). Returns the new point's index, or null. */
  splitAt(id: string, index: number): number | null {
    const c = find(id);
    if (!c || index < 0 || index >= c.points.length) return null;
    const before = index === c.points.length - 1 ? index : index + 1;
    const a = c.points[before - 1];
    const b = c.points[before];
    drawnCableStore.insertPoint(id, before, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    return before;
  },

  /** Refused at two points. */
  removePoint(id: string, index: number) {
    const c = find(id);
    if (!c || c.points.length <= 2 || index < 0 || index >= c.points.length) return;
    c.points = c.points.filter((_, i) => i !== index);
    if (_selectedId === id && _activePoint !== null) {
      _activePoint = _activePoint === index ? null
        : _activePoint > index ? _activePoint - 1
        : _activePoint;
    }
    notify();
  },

  clear() {
    if (_cables.length === 0 && _selectedId === null) return;
    _cables = [];
    _selectedId = null;
    _activePoint = null;
    notify();
  },

  serialize(): SavedDrawnCable[] {
    return _cables.map((c) => ({
      points: c.points.map((p) => (
        hasAngleOverride(p)
          ? { x: Math.round(p.x), y: Math.round(p.y), angle: p.angle }
          : { x: Math.round(p.x), y: Math.round(p.y) }
      )),
      shape: c.shape,
      arrows: c.arrows,
      width: c.width,
      headScale: c.headScale,
      color: c.color,
    }));
  },

  /** Replace the set wholesale (graph load). Malformed entries are skipped. */
  load(saved: readonly unknown[]) {
    _cables = [];
    _selectedId = null;
    _activePoint = null;
    _nextId = 1;
    for (const raw of saved) {
      if (typeof raw !== "object" || raw === null) continue;
      const s = raw as Partial<SavedDrawnCable>;
      if (!Array.isArray(s.points)) continue;
      const points = s.points.filter(isPoint).map(clonePoint);
      if (points.length < 2) continue;
      _cables.push({
        id: `drawn-${_nextId++}`,
        points,
        shape: isCableShape(s.shape) ? s.shape : DRAWN_DEFAULT_SHAPE,
        arrows: isDrawnArrows(s.arrows) ? s.arrows : DRAWN_DEFAULT_ARROWS,
        width: num(s.width, DRAWN_DEFAULT_WIDTH, WIDTH_MIN, WIDTH_MAX),
        headScale: num(s.headScale, DRAWN_DEFAULT_HEAD_SCALE, HEAD_MIN, HEAD_MAX),
        color: typeof s.color === "string" && s.color ? s.color : DRAWN_DEFAULT_COLOR,
      });
    }
    notify();
  },
};

registerNodeForgetAll(() => drawnCableStore.clear());

// ── Draw mode (transient, never persisted) ───────────────────────────────────

let _armed = false;
let _pending: DrawnPoint[] = [];
let _cursor: DrawnPoint | null = null;
// Two notifiers: the cursor moves at pointer rate and only the preview may re-render for it.
const draw = createNotifier();
const drawCursor = createNotifier();
const both = () => { draw.notify(); drawCursor.notify(); };

export const drawModeStore = {
  armed: () => _armed,
  pending: (): readonly DrawnPoint[] => _pending,
  cursor: () => _cursor,
  version: draw.version,
  subscribe: draw.subscribe,
  cursorVersion: drawCursor.version,
  subscribeCursor: drawCursor.subscribe,

  arm() {
    if (_armed) return;
    _armed = true;
    _pending = [];
    _cursor = null;
    drawnCableStore.select(null);
    both();
  },

  /** Leave the tool, discarding anything half-drawn. */
  disarm() {
    if (!_armed && _pending.length === 0) return;
    _armed = false;
    _pending = [];
    _cursor = null;
    both();
  },

  toggle() {
    if (_armed) drawModeStore.disarm();
    else drawModeStore.arm();
  },

  /** A point within `minDist` of the previous one is a repeat tap and is dropped. */
  place(p: DrawnPoint, minDist = 0) {
    if (!_armed) return;
    const last = _pending[_pending.length - 1];
    if (last && minDist > 0 && Math.hypot(p.x - last.x, p.y - last.y) <= minDist) return;
    _pending = [..._pending, { x: p.x, y: p.y }];
    both();
  },

  undoPoint() {
    if (!_armed || _pending.length === 0) return;
    _pending = _pending.slice(0, -1);
    both();
  },

  moveCursor(p: DrawnPoint | null) {
    if (!_armed) return;
    if (p === null && _cursor === null) return;
    _cursor = p ? { x: p.x, y: p.y } : null;
    drawCursor.notify();
  },

  /** Commit the run as a cable, leave the tool and select the new cable so its panel
   *  opens. Null (and still armed) when there wasn't enough to draw. */
  finish(): DrawnCable | null {
    const c = drawnCableStore.add(_pending);
    if (!c) return null;
    _armed = false;
    _pending = [];
    _cursor = null;
    both();
    drawnCableStore.select(c.id);
    return c;
  },
};
