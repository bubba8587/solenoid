// [[B10]] reactFlowView (module-singleton store, storeKit)
import { createValueStore } from "./storeKit";
import { recordsToCube, frameFromRecords, type CubeValue, type FrameValue, type CubeCell } from "./frame";
import { getAtPath, type CubePath, type CubeRecord } from "./literalEditors";

export interface CubeEditBinding {
  records(): CubeRecord[];
  save(records: CubeRecord[]): void;
}

export interface CellRef { r: number; c?: number }

export type DrillView = (
  | { kind: "cube"; label: string; cube: CubeValue; /** Records path when the popup is an editor. */ path?: CubePath }
  | { kind: "frame"; label: string; frame: FrameValue; path?: CubePath }
  | { kind: "grid"; label: string; cells: CubeCell[][]; path?: undefined }
  | { kind: "list"; label: string; items: unknown[]; path?: CubePath }
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
