// The currently-open nested-data viewer, or null. Cubes are recursive, so it keeps a
// DRILL STACK — one popup and one breadcrumb for every nesting kind, never two windows.
import { createValueStore } from "./storeKit";
import { recordsToCube, frameFromRecords, type CubeValue, type FrameValue, type CubeCell } from "./frame";
import { getAtPath, type CubePath, type CubeRecord } from "./literalEditors";

/** A Cube Input's editing seam: the popup reads the records and writes them back whole. */
export interface CubeEditBinding {
  records(): CubeRecord[];
  save(records: CubeRecord[]): void;
}

/** One drill-stack level; `label` is its breadcrumb crumb (node name at the root,
 *  column name deeper). A `grid` view holds a list (one row) or matrix of cells. */
export type DrillView =
  | { kind: "cube"; label: string; cube: CubeValue; /** Records path when the popup is an editor. */ path?: CubePath }
  | { kind: "frame"; label: string; frame: FrameValue; path?: CubePath }
  | { kind: "grid"; label: string; cells: CubeCell[][]; path?: undefined }
  /** An editable list level (a Cube Input's list cell), one item per row. */
  | { kind: "list"; label: string; items: unknown[]; path: CubePath };

export interface CubePopupState {
  /** [root, ...drilled]; the LAST entry is the view currently shown. */
  stack: DrillView[];
  accent?: string;
  groupColor?: string;
  groupColorDark?: string;
  /** Host node id for the header Pin action (root only). */
  pinNodeId?: string;
  /** Present → the popup EDITS a Cube Input's records (cubeEditCell.tsx). */
  edit?: CubeEditBinding;
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
  /** After an edit saved: rebuild every cube level from the records along its path. */
  refresh() {
    const s = core.get();
    if (!s?.edit) return;
    const records = s.edit.records();
    const stack = s.stack.map((v): DrillView => {
      if (!v.path) return v;
      const sub = v.path.length ? getAtPath(records, v.path) : records;
      const rows = Array.isArray(sub) ? (sub as CubeRecord[]) : [];
      if (v.kind === "cube") return { ...v, cube: recordsToCube(rows) };
      if (v.kind === "frame") return { ...v, frame: frameFromRecords(rows) };
      if (v.kind === "list") return { ...v, items: Array.isArray(sub) ? (sub as unknown[]) : [] };
      return v;
    });
    core.open({ ...s, stack });
  },
};
