// The currently-open nested-data viewer, or null. Cubes are recursive, so it keeps a
// DRILL STACK — one popup and one breadcrumb for every nesting kind, never two windows.
import { createValueStore } from "./storeKit";
import type { CubeValue, FrameValue, CubeCell } from "./frame";

/** One drill-stack level; `label` is its breadcrumb crumb (node name at the root,
 *  column name deeper). A `grid` view holds a list (one row) or matrix of cells. */
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
