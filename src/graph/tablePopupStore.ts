// [[C58]] tableInputRawText, [[C107]] obsidianPlugin
import { createValueStore } from "./storeKit";
import type { SolError } from "./errorValue";
import type { FrameSourceColumn } from "./frame";
import type { ColumnUnit } from "./unitValue";
import type { FormatAnnotation } from "./formatAnnotationStore";
import type { FrameValue } from "./frame";
import type { PivotLayout, PivotTotals, PivotViewOptions } from "./pivotLayout";

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
  /** Names a column header may take, each with the types it has elsewhere; a pick sets the type only when there is one. Read when a header is focused. */
  columnNameOptions?: () => { name: string; types: ("number" | "string" | "date" | "logical")[] }[];
  /** undefined is a Data column. */
  sourceExprs?: (string | undefined)[];
  computedCells?: Cell[][];
  /** How PIVOTBY laid the frame out; present only on a pivot's own output, and it opens the Pivot view. */
  pivot?: PivotLayout;
}

export const tablePopup = createValueStore<TablePopupState>();

/** Adds a Record node in the Cards view wired to a popup's host. Installed by the app; the Obsidian plugin has no graph to add to, so it never is. */
export interface RecordCardsAction {
  canAdd(hostId: string): boolean;
  add(hostId: string): Promise<unknown>;
}
let recordCardsAction: RecordCardsAction | null = null;
export function setRecordCardsAction(action: RecordCardsAction | null): void { recordCardsAction = action; }
export function getRecordCardsAction(): RecordCardsAction | null { return recordCardsAction; }

/** The Pivot node behind a popup's frame: its saved view, its totals and its field editor. */
export interface PivotHost {
  view: PivotViewOptions;
  setView(view: PivotViewOptions): void;
  totals: PivotTotals;
  /** Recomputes the Pivot and gives its new output. */
  setTotals(totals: PivotTotals): Promise<FrameValue | null>;
  /** Opens Configure Fields; `onClosed` gets the output as it then stands. */
  editFields(onClosed: (output: FrameValue | null) => void, accent?: string): void;
}
/** Finds the Pivot node behind a host. Installed by the app; the Obsidian plugin has no graph, so its pivot views keep their options for the session. */
export interface PivotHostAction { find(hostId: string): PivotHost | null }
let pivotHostAction: PivotHostAction | null = null;
export function setPivotHostAction(action: PivotHostAction | null): void { pivotHostAction = action; }
export function getPivotHostAction(): PivotHostAction | null { return pivotHostAction; }
