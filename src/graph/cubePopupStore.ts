// The currently-open nested-data viewer, or null. A cube is recursive (a cell may
// hold a nested cube, frame, list, or matrix), so the popup keeps a DRILL STACK:
// opening shows [root]; clicking ANY nested-container cell pushes a deeper view;
// the breadcrumb pops back. One popup, one breadcrumb, for every nesting kind --
// nothing ever opens a second overlapping window. Nesting is never hidden: the
// header shows a cube's cached depth, and the path shows how deep you've drilled.
// Module store (like tablePopupStore) so it's readable from the separate Rete root.
import { createValueStore } from "./storeKit";
import type { CubeValue, FrameValue, CubeCell } from "./frame";

/** One level in the drill stack. A cube/frame view carries the value; a `grid`
 *  view holds a list (one row) or matrix (rows) of arbitrary cells. `label` is the
 *  breadcrumb crumb for this level (the node name at the root, a column name deeper). */
export type DrillView =
  | { kind: "cube"; label: string; cube: CubeValue }
  | { kind: "frame"; label: string; frame: FrameValue }
  | { kind: "grid"; label: string; cells: CubeCell[][] };

export interface CubePopupState {
  /** [root, ...drilled]; the LAST entry is the view currently shown. */
  stack: DrillView[];
  accent?: string;
  groupColor?: string;
  groupColorDark?: string;
  /** Host node id for the header Pin action (root only). */
  pinNodeId?: string;
}

const core = createValueStore<CubePopupState>();

export const cubePopup = {
  ...core,
  open(view: DrillView, opts?: Omit<CubePopupState, "stack">) {
    core.open({ stack: [view], ...opts });
  },
  /** Drill into a nested cell (push a level). */
  drill(view: DrillView) {
    const s = core.get();
    if (!s) return;
    core.open({ ...s, stack: [...s.stack, view] });
  },
  /** Jump back to breadcrumb level `i` (0 = root). */
  backTo(i: number) {
    const s = core.get();
    if (!s || i < 0 || i >= s.stack.length) return;
    core.open({ ...s, stack: s.stack.slice(0, i + 1) });
  },
};
