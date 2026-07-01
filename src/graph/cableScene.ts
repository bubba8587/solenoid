import { createNotifier } from "./storeKit";

// Phase 1 cable scene — the shared, module-level list of cable VISIBLE strokes the
// canvas layer paints. The DOM `ConnectionComponent` stays the single source of
// truth (it owns rete's live socket positions, ribbon/pill/colour/selection
// logic); in `canvas` render-mode it PUBLISHES its computed stroke here and emits
// only its invisible hit path. `CableCanvas` subscribes and repaints. In `dom`
// mode nothing publishes and the scene stays empty, so the DOM path is untouched.
//
// Keeping the component as the producer means the canvas can never diverge from
// the DOM rendering's geometry/colour — it's literally the same numbers, just
// painted on a <canvas> instead of an <svg>. Only the NORMAL (non-ribbon, non-
// pseudo, non-reveal, flow-off) cable is moved to canvas; everything else stays
// DOM, so this is purely additive and gated.

export interface CableStroke {
  /** SVG path data (world coords) — the same string the <path> would have used. */
  d: string;
  /** Stroke colour. A hex literal, or a `var(--…)` the canvas resolves once. */
  color: string;
  /** Stroke width in WORLD units (scaled by zoom at paint, like the SVG path). */
  width: number;
  opacity: number;
  /** Dash pattern in world units (e.g. ghost cables); undefined = solid. */
  dash?: number[];
  /** Paint ABOVE the nodes instead of behind them — mirrors the DOM selected-cable
   *  z-index:100 jump so a selected cable isn't occluded by a node it passes under. */
  above?: boolean;
}

const _scene = new Map<string, CableStroke>();
const { notify, subscribe, version } = createNotifier();

// While the LOD swap hides the DOM nodes (display:none), their sockets measure as
// (0,0), so any ConnectionComponent that re-renders would publish a cable with one
// end at the origin. Freezing ignores all publishes/removes — the last-good world
// geometry is stable while zoomed out (you navigate, not edit), so the GPU keeps
// drawing correct cables. Unfrozen on LOD-in, when sockets measure correctly again.
let _frozen = false;

export const cableScene = {
  /** Freeze/thaw scene mutations (set by the LOD controller around the DOM-hide). */
  setFrozen(b: boolean) { _frozen = b; },
  isFrozen() { return _frozen; },
  /** Publish/replace a cable's visible stroke. No-op-dedups on identical content
   *  so an appearance-irrelevant re-render of the component doesn't repaint. */
  set(id: string, s: CableStroke) {
    if (_frozen) return;
    const prev = _scene.get(id);
    if (prev && strokesEqual(prev, s)) return;
    _scene.set(id, s);
    notify();
  },
  /** Drop a cable from the scene (unmount, or it reverted to DOM rendering). */
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
