// [[C58]] tableInputRawText, [[C107]] obsidianPlugin
import type { PivotConfig } from "./pivotConfig";
import type { AggOp } from "./frameOps";
import type { ComponentType } from "react";
import { createValueStore } from "./storeKit";
import type { SolError } from "./errorValue";
import type { FrameSourceColumn } from "./frame";
import type { ColumnUnit } from "./unitValue";
import type { FormatAnnotation } from "./formatAnnotationStore";
import type { FrameValue } from "./frame";
import type { PivotLayout, PivotTotals, PivotViewOptions } from "./pivotLayout";
import type { DescribeTile } from "./describeProfile";

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
  /** A read-only frame whose host can retype a column (Local File): its headers carry the type button, and a press
   *  hands the column and the next type to the host, which recomputes and reopens the popup. */
  onRetypeColumn?: (col: number, type: "number" | "string" | "date" | "logical") => void;
  /** The source's date order, read where the popup turns a Date column's text into dates (a Frame Input's). */
  dateOrder?: string;
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
  /** Cells take edits, but no row is added or removed, and the CSV view only reads (Edit Frame). */
  fixedRows?: boolean;
  formatControls?: "columns" | "matrix";
  columnUnits?: (ColumnUnit | undefined)[];
  columnFormats?: (FormatAnnotation | undefined)[];
  unitTaggable?: boolean;
  onSaveMatrixUnit?: (unitId: string) => void;
  pinNodeId?: string;
  /** Opened before its data arrived: the popup shows its loading skeleton until `open` is called again with the data. */
  loading?: boolean;
  formLayout?: string;
  /** The Cards view's authored layout ([[D111]] cardLayouts), in the Form layout's grammar. */
  cardLayout?: string;
  lambdaOptions?: string[];
  noFormulaColumns?: boolean;
  /** Names a column header may take, each with the types it has elsewhere; a pick sets the type only when there is one. Read when a header is focused. */
  columnNameOptions?: () => { name: string; types: ("number" | "string" | "date" | "logical")[] }[];
  /** undefined is a Data column. */
  sourceExprs?: (string | undefined)[];
  computedCells?: Cell[][];
  /** How PIVOTBY laid the frame out; present only on a pivot's own output, and it opens the Pivot view. */
  pivot?: PivotLayout;
  /** Describe's per-column tiles; present only on a Describe's own output, and it opens the Dashboard view. */
  describe?: DescribeTile[];
}

export const tablePopup = createValueStore<TablePopupState>();

/** Adds a Record node in the Cards view wired to a popup's host. Installed by the app; the Obsidian plugin has no graph to add to, so it never is. */
interface RecordCardsAction {
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
  /** The card's function for a value field with none of its own. */
  agg: AggOp;
  /** An input column's type, by name. */
  typeOf(field: string): string;
  /** The card's field settings as they stand. */
  config(): PivotConfig;
  /** Writes the settings, recomputes the Pivot and gives its new output. */
  setConfig(next: PivotConfig): Promise<FrameValue | null>;
  /** Every value a field takes, sorted and up to 10,000, and how many there are, for Keep Only and the field's list. */
  keysOf(field: string): Promise<{ keys: string[]; total: number }>;
}
/** Finds the Pivot node behind a host. Installed by the app; the Obsidian plugin has no graph, so its pivot views keep their options for the session. */
interface PivotHostAction { find(hostId: string): PivotHost | null }
let pivotHostAction: PivotHostAction | null = null;
export function setPivotHostAction(action: PivotHostAction | null): void { pivotHostAction = action; }
export function getPivotHostAction(): PivotHostAction | null { return pivotHostAction; }

/** Draws the Dashboard view. Installed by the app; the Obsidian plugin installs none, since a note's frame never carries Describe's tiles, and so never bundles the chart renderers ([[C127]] pivotView). */
type DashboardView = ComponentType<{ tiles: readonly DescribeTile[]; query: string }>;
let dashboardView: DashboardView | null = null;
export function setDashboardView(view: DashboardView | null): void { dashboardView = view; }
export function getDashboardView(): DashboardView | null { return dashboardView; }
