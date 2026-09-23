// [[C58]] tableInputRawText, [[C107]] obsidianPlugin
import { createValueStore } from "./storeKit";
import type { SolError } from "./errorValue";
import type { FrameSourceColumn } from "./frame";
import type { ColumnUnit } from "./unitValue";
import type { FormatAnnotation } from "./formatAnnotationStore";

/** `null` is a missing cell; a SolError is a per-cell error. */
export type Cell = number | string | boolean | null | SolError;

export interface SourceCommitRefresh {
  computedCells: Cell[][];
  columnTypes: ("number" | "string" | "date" | "logical")[];
}

export interface FramePopupColumn {
  name: string;
  type: "number" | "string" | "date" | "logical";
  values: (number | string | boolean | null)[];
}

export interface TablePopupState {
  title: string;
  data: Cell[][];
  /** Every column's type unless `columnTypes` overrides it. */
  cellType?: "number" | "string" | "date" | "logical";
  headers?: string[];
  editableHeaders?: boolean;
  columnTypes?: ("number" | "string" | "date" | "logical")[];
  /** `null` where a column has no source text (a computed column). */
  sourceCells?: (string | null)[][];
  onSaveSource?: (columns: FrameSourceColumn[]) => void;
  onCommitSource?: (columns: FrameSourceColumn[]) => Promise<SourceCommitRefresh | null>;
  onSaveRaw?: (cells: string[][]) => void;
  accent?: string;
  groupColor?: string;
  groupColorDark?: string;
  list?: boolean;
  fixedCols?: boolean;
  formatControls?: "columns" | "matrix";
  columnUnits?: (ColumnUnit | undefined)[];
  columnFormats?: (FormatAnnotation | undefined)[];
  unitTaggable?: boolean;
  onSaveMatrixUnit?: (unitId: string) => void;
  pinNodeId?: string;
  formLayout?: string;
  lambdaOptions?: string[];
  noFormulaColumns?: boolean;
  /** undefined is a Data column. */
  sourceExprs?: (string | undefined)[];
  computedCells?: Cell[][];
}

export const tablePopup = createValueStore<TablePopupState>();
