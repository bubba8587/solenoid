// The currently-open table popup. Must stay a module store: it is opened from inside
// a node (rete's separate React root) but mounted once in App.
import { createValueStore } from "./storeKit";
import type { SolError } from "./errorValue";
import type { FrameSourceColumn } from "./frame";
import type { ColumnUnit } from "./unitValue";

/** A grid cell; `null` is MISSING and a SolError is a per-cell error. */
export type Cell = number | string | boolean | null | SolError;

/** What `onCommitSource` hands back so the open popup refreshes computed columns. */
export interface SourceCommitRefresh {
  computedCells: Cell[][];
  columnTypes: ("number" | "string" | "date" | "logical")[];
}

/** A typed column the frame editor hands back on save (matches FrameColumn). */
export interface FramePopupColumn {
  name: string;
  type: "number" | "string" | "date" | "logical";
  values: (number | string | boolean | null)[];
}

export interface TablePopupState {
  title: string;
  data: Cell[][];
  /** Display kind only — editing is number-only. "number" right-aligns, coerces
   *  blanks to 0 and emits bare CSV; "string" preserves text and CSV-quotes. */
  cellType?: "number" | "string" | "date" | "logical";
  /** Column names; when set they replace the spreadsheet letters and CSV gains a
   *  header line. */
  headers?: string[];
  /** With onSave, header cells become editable and the names come back as Save's
   *  second argument. */
  editableHeaders?: boolean;
  /** Per-column formatting/editing type; absent means every column uses `cellType`. */
  columnTypes?: ("number" | "string" | "date" | "logical")[];
  /** The inputted text per cell, BEFORE inference, shown verbatim by the Source
   *  view; `null` where a column has no source text (a computed column). */
  sourceCells?: (string | null)[][];
  /** Frame-shaped save; takes precedence over onSave. */
  onSaveFrame?: (columns: FramePopupColumn[]) => void;
  /** Literal-source mode: `data` holds the RAW typed text, never derived values, so
   *  editing can't rewrite it. Takes precedence over onSaveFrame/onSave. */
  literalSource?: boolean;
  onSaveSource?: (columns: FrameSourceColumn[]) => void;
  /** LIVE write-through: commit + recompute now and return fresh derived cells, so
   *  the open popup updates without a Save/close round trip. */
  onCommitSource?: (columns: FrameSourceColumn[]) => Promise<SourceCommitRefresh | null>;
  /** Lean literal-source mode: raw text cells, no header chrome; Save returns them
   *  verbatim. Same precedence tier as onSaveSource. */
  onSaveRaw?: (cells: string[][]) => void;
  /** Presence makes the editor editable; omit for a read-only view. */
  onSave?: (next: (number | null)[][], headers?: string[]) => void;
  /** Resolved host `--node-accent`, so the popup header matches its node. */
  accent?: string;
  /** Resolved host `--group-color`, so the popup frames itself like a grouped card. */
  groupColor?: string;
  /** Darkened group color for light theme (the host's `--group-color-dark`). */
  groupColorDark?: string;
  /** A 1-D list shown as one row; Copy joins with ", " instead of CSV lines. */
  list?: boolean;
  /** An FC controls row: `"columns"` per column, `"matrix"` one pair. Display-only —
   *  it never touches the value or what Copy/CSV export. */
  formatControls?: "columns" | "matrix";
  /** Per-column unit driving the base-SI → display conversion; aligned with `headers`. */
  columnUnits?: (ColumnUnit | undefined)[];
  /** A unit-TAGGABLE source: the unit choice is written back on Save and rides the
   *  value downstream. Derived frames leave this off (display-only formats). */
  unitTaggable?: boolean;
  /** Persists the homogeneous matrix unit (D20) on the node; frames use the
   *  per-column `unit` on onSaveSource instead. */
  onSaveMatrixUnit?: (unitId: string) => void;
  /** Host node id — enables the header Pin action; absent for chips with no host. */
  pinNodeId?: string;
  /** The host's λ input keys — non-empty grows the per-column SOURCE select (D24/D25). */
  lambdaOptions?: string[];
  /** Per-column initial λ binding (aligned with columns; undefined = Data). */
  sourceLambdas?: (string | undefined)[];
  /** Per-column initial inline formula (undefined = not a Formula column). */
  sourceExprs?: (string | undefined)[];
  /** Derived VALUES for computed columns — read-only, since they have no raw text. */
  computedCells?: Cell[][];
}

export const tablePopup = createValueStore<TablePopupState>();
