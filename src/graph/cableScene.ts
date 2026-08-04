import { createNotifier } from "./storeKit";

// The DOM `ConnectionComponent` stays the single source of truth: in `canvas` mode
// it PUBLISHES its computed stroke here, so the canvas can't diverge from the DOM.
// Only the NORMAL (non-ribbon, non-pseudo, non-reveal, flow-off) cable is painted.

export interface CableStroke {
  /** SVG path data in WORLD coords. */
  d: string;
  /** A hex literal, or a `var(--…)` the canvas resolves once. */
  color: string;
  /** WORLD units — scaled by zoom at paint, like the SVG path. */
  width: number;
  opacity: number;
  /** World units; undefined = solid. */
  dash?: number[];
  /** Mirrors the DOM selected-cable z-index jump, so a selected cable isn't
   *  occluded by a node it passes under. */
  above?: boolean;
}

const _scene = new Map<string, CableStroke>();
const { notify, subscribe, version } = createNotifier();

// While the LOD swap hides the DOM nodes their sockets measure (0,0), so a
// re-rendering ConnectionComponent would publish a cable ending at the origin —
// freezing holds the last-good world geometry until sockets measure again.
let _frozen = false;

export const cableScene = {
  /** Freeze/thaw scene mutations (set by the LOD controller around the DOM-hide). */
  setFrozen(b: boolean) { _frozen = b; },
  isFrozen() { return _frozen; },
  /** Dedups on identical content, so an appearance-irrelevant re-render can't repaint. */
  set(id: string, s: CableStroke) {
    if (_frozen) return;
    const prev = _scene.get(id);
    if (prev && strokesEqual(prev, s)) return;
    _scene.set(id, s);
    notify();
  },
  remove(id: string) {
    if (_frozen) return;
    if (_scene.delete(id)) notify();
  },
  /** Live view for the painter. Do not mutate. */
  entries(): IterableIterator<[string, CableStroke]> {
    return _scene.entries();
  },
  size(): number { return _scene.size; },
  subscribe,
  version,
};

function strokesEqual(a: CableStroke, b: CableStroke): boolean {
  if (a.d !== b.d || a.color !== b.color || a.width !== b.width || a.opacity !== b.opacity || !!a.above !== !!b.above) return false;
  const ad = a.dash, bd = b.dash;
  if (ad === bd) return true;
  if (!ad || !bd || ad.length !== bd.length) return false;
  for (let i = 0; i < ad.length; i++) if (ad[i] !== bd[i]) return false;
  return true;
}
