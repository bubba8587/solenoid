// [[B10]] reactFlowView (module-singleton store, storeKit)
import { createValueStore } from "./storeKit";
import { recordsToCube, frameFromRecords, type CubeValue, type FrameValue, type CubeCell, type FrameColType } from "./frame";
import { getAtPath, type CubePath, type CubeRecord, type CubeSource } from "./literalEditors";
import { isSolError, type SolError } from "./errorValue";

export interface CubeEditBinding {
  source(): CubeSource;
  save(source: CubeSource): void;
  /** The cube the source derives, typed and formula columns filled: the root level shows it. */
  cube(): CubeValue | SolError | null;
  /** The store can't hold a formula (a note's YAML), so the type button stops short of Formula. */
  noFormulaColumns?: boolean;
}

/** The root level shows the derived cube; a nested level its records as they are. */
export function editLevelCube(edit: CubeEditBinding, path: CubePath, rows: CubeRecord[]): CubeValue {
  if (path.length === 0) {
    const c = edit.cube();
    if (c && !isSolError(c)) return c;
  }
  return recordsToCube(rows);
}

export interface CellRef { r: number; c?: number }

export type DrillView = (
  | { kind: "cube"; label: string; cube: CubeValue; /** Records path when the popup is an editor. */ path?: CubePath }
  | { kind: "frame"; label: string; frame: FrameValue; path?: CubePath }
  | { kind: "grid"; label: string; cells: CubeCell[][]; path?: undefined }
  | { kind: "list"; label: string; items: unknown[]; path?: CubePath; /** The column's declared type, when the list came out of a typed column. */ type?: FrameColType }
) & { from?: CellRef; focus?: CellRef };

export interface CubePopupState {
  /** The last entry is the view shown. */
  stack: DrillView[];
  accent?: string;
  groupColor?: string;
  groupColorDark?: string;
  pinNodeId?: string;
  edit?: CubeEditBinding;
}

const core = createValueStore<CubePopupState>();

export const cubePopup = {
  ...core,
  open(view: DrillView, opts?: Omit<CubePopupState, "stack">) {
    core.open({ stack: [view], ...opts });
  },
  drill(view: DrillView, from?: CellRef) {
    const s = core.get();
    if (!s) return;
    core.open({ ...s, stack: [...s.stack, { ...view, from }] });
  },
  backTo(i: number) {
    const s = core.get();
    if (!s || i < 0 || i >= s.stack.length) return;
    const stack = s.stack.slice(0, i + 1);
    stack[i] = { ...stack[i], focus: s.stack[i + 1]?.from };
    core.open({ ...s, stack });
  },
  refresh() {
    const s = core.get();
    if (!s?.edit) return;
    const edit = s.edit;
    const records = edit.source().rows;
    const stack = s.stack.map((v): DrillView => {
      if (!v.path) return v;
      const sub = v.path.length ? getAtPath(records, v.path) : records;
      const rows = Array.isArray(sub) ? (sub as CubeRecord[]) : [];
      if (v.kind === "cube") return { ...v, cube: editLevelCube(edit, v.path, rows) };
      if (v.kind === "frame") return { ...v, frame: frameFromRecords(rows) };
      if (v.kind === "list") return { ...v, items: Array.isArray(sub) ? (sub as unknown[]) : [] };
      return v;
    });
    core.open({ ...s, stack });
  },
};
