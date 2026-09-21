// [[B10]] reactFlowView (module-singleton store, storeKit)
// The open nested-data viewer, or null: ONE popup with a drill stack, never two windows.
import { createValueStore } from "./storeKit";
import { recordsToCube, frameFromRecords, type CubeValue, type FrameValue, type CubeCell } from "./frame";
import { getAtPath, type CubePath, type CubeRecord } from "./literalEditors";

/** A Cube Input's editing seam: the popup reads the records and writes them back whole. */
export interface CubeEditBinding {
  records(): CubeRecord[];
  save(records: CubeRecord[]): void;
}

/** A cell in a level's grid, by SOURCE row (and column when known). */
export interface CellRef { r: number; c?: number }

/** One drill-stack level; `label` is its breadcrumb crumb (node name at the root,
 *  column name deeper). A `grid` view holds a list (one row) or matrix of cells.
 *  `from` is the parent cell this level was drilled out of; `focus` is the cell a
 *  level should scroll back to after a return from below it. */
export type DrillView = (
  | { kind: "cube"; label: string; cube: CubeValue; /** Records path when the popup is an editor. */ path?: CubePath }
  | { kind: "frame"; label: string; frame: FrameValue; path?: CubePath }
  /** A 2-D array level. */
  | { kind: "grid"; label: string; cells: CubeCell[][]; path?: undefined }
  /** A list level: one row by default (a list is a CSV row), or one item per row by the
   *  popup's layout switch. `path` is present when it edits a Cube Input's list cell. */
  | { kind: "list"; label: string; items: unknown[]; path?: CubePath }
) & { from?: CellRef; focus?: CellRef };

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
  /** Push a level; `from` is the parent cell it was opened from, so a return lands there. */
  drill(view: DrillView, from?: CellRef) {
    const s = core.get();
    if (!s) return;
    core.open({ ...s, stack: [...s.stack, { ...view, from }] });
  },
  /** Jump back to breadcrumb level `i` (0 = root), focusing the cell the next level came from. */
  backTo(i: number) {
    const s = core.get();
    if (!s || i < 0 || i >= s.stack.length) return;
    const stack = s.stack.slice(0, i + 1);
    stack[i] = { ...stack[i], focus: s.stack[i + 1]?.from };
    core.open({ ...s, stack });
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
