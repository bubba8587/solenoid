// The currently-open table popup (a barebones CSV editor), or null. Module store
// (not React context): it's opened from inside a node / group, which Rete renders
// in a separate React root, so the popup is mounted once in App and reads this
// store. Mirrors formulaPopup / connectionDialogStore.
import { createValueStore } from "./storeKit";
import type { SolError } from "./errorValue";
import type { FrameSourceColumn } from "./frame";
import type { ColumnUnit } from "./unitValue";

/** A grid cell — numeric, text, boolean (logical), null (missing), or a per-cell
 *  error (#CODE!). The popup's toGrid renders boolean as TRUE/FALSE. */
export type Cell = number | string | boolean | null | SolError;

/** A typed column the frame editor hands back on save (matches FrameColumn). */
export interface FramePopupColumn {
  name: string;
  type: "number" | "string" | "date" | "logical";
  values: (number | string | boolean | null)[];
}

export interface TablePopupState {
  /** Header label (e.g. the node's name). */
  title: string;
  /** The grid to show. */
  data: Cell[][];
  /** Cell content kind. "number" (default) right-aligns, coerces blanks to 0 and
   *  emits bare CSV; "string" left-aligns, preserves text and CSV-quotes cells
   *  with commas/quotes. Drives display only — editing is number-only. */
  cellType?: "number" | "string" | "date" | "logical";
  /** Column header names (Frame popups). When set, the grid's column header row
   *  shows these names instead of spreadsheet letters, and CSV export prepends a
   *  header line. */
  headers?: string[];
  /** When set (with onSave), the column-name header cells are editable inputs and
   *  the edited names are passed back as the second Save argument. Used by Frame
   *  Input; plain Table Input leaves it off (spreadsheet-letter headers). */
  editableHeaders?: boolean;
  /** Per-column type (Frame popups). Drives per-column cell formatting + editing
   *  (text vs number), and with onSaveFrame the saved column types. When absent,
   *  every column uses `cellType`. */
  columnTypes?: ("number" | "string" | "date" | "logical")[];
  /** The INPUTTED source text per cell (row-major), when the frame carries it
   *  (a CSV/URL import, a Frame Input). The Source view shows this verbatim — the
   *  text BEFORE inference (a date string, "1"/"true") — instead of the underlying
   *  value. `null` where a column has no source text (a computed column). */
  sourceCells?: (string | null)[][];
  /** Frame-shaped save (Frame Input). Receives typed columns built from the grid,
   *  the edited names, and the per-column types. Takes precedence over onSave. */
  onSaveFrame?: (columns: FramePopupColumn[]) => void;
  /** Literal-source mode (Frame Input). `data` holds the RAW text the user typed,
   *  NOT derived values, so editing never rewrites it. The Formatted/Source toggle
   *  shows the derived render (TRUE/FALSE, formatted dates) vs the raw text; Save
   *  hands back the raw source. Takes precedence over onSaveFrame/onSave. */
  literalSource?: boolean;
  onSaveSource?: (columns: FrameSourceColumn[]) => void;
  /** Lean literal-source mode (Table Input): `data` holds the RAW text cells
   *  (row-major, no headers/column chrome); the uniform `cellType` drives the
   *  Formatted preview. Save hands back the raw cells verbatim. Same precedence
   *  tier as onSaveSource. */
  onSaveRaw?: (cells: string[][]) => void;
  /** When provided, the editor is editable and Save calls this with the parsed
   *  grid (and, for editableHeaders, the edited column names). Omit for a
   *  read-only view (computed tables, all string lists). */
  onSave?: (next: (number | null)[][], headers?: string[]) => void;
  /** Resolved accent color (the host node's `--node-accent`) so the popup header
   *  matches the node it opened from, like the Formula popup. */
  accent?: string;
  /** Resolved group-membership color (the host node's `--group-color`), when the
   *  node is in a group. Drives the shared grouped border + corner triangle so the
   *  popup frames itself the same way a grouped node card does. */
  groupColor?: string;
  /** Darkened group color for light theme (the host's `--group-color-dark`). */
  groupColorDark?: string;
  /** The source is a 1D list (shown here as a single row). Copy joins its
   *  values with ", " (matching a node's list result box) instead of the
   *  row-per-line CSV a 2D table uses. */
  list?: boolean;
  /** Render a Format-Controller controls row between the header and the body
   *  (read-only frames/matrices). `"columns"` stacks a format-over-unit pair per
   *  column (frames/cubes); `"matrix"` shows one format+unit pair side by side
   *  (a homogeneous matrix). Display-only — the dropdowns re-render the on-screen
   *  grid (convert units, apply the number format) without touching the value or
   *  what Copy/CSV export. */
  formatControls?: "columns" | "matrix";
  /** Per-column dimensional unit (frames): seeds each column's unit dropdown and
   *  drives the base-SI → display-unit conversion. Aligned with `headers`; a
   *  column with no unit is `undefined`. */
  columnUnits?: (ColumnUnit | undefined)[];
  /** The frame is a UNIT-TAGGABLE source (Frame Input): the controls row shows a
   *  per-column UNIT dropdown (instead of the display-only format dropdown) whose
   *  choice is written back on Save — via the source column's `unit`, so it rides
   *  the value downstream. Derived frames leave this off (format-only, display). */
  unitTaggable?: boolean;
  /** A unit-taggable MATRIX source (Table Input): the matrix bar's unit dropdown
   *  writes its choice back through this (an FC unit id, or "none"), persisting the
   *  homogeneous matrix unit (D20) on the node so it rides the value downstream.
   *  Frames use the per-column `unit` on onSaveSource instead. */
  onSaveMatrixUnit?: (unitId: string) => void;
  /** Host node id, when opened from a node body — enables the header Pin action
   *  (pin this value to the HUD). Absent for HUD/group-readout chips, which have
   *  no single host node to pin. */
  pinNodeId?: string;
  /** The host's λ input keys (Frame Input's addable lambda sockets) — when
   *  non-empty, the editable header grows the per-column SOURCE select
   *  (Data | Formula | λ…), the column-source model
   *  (v2.0/19-computed-column-surface.md). */
  lambdaOptions?: string[];
  /** Per-column initial λ binding (aligned with columns; undefined = Data). */
  sourceLambdas?: (string | undefined)[];
  /** Per-column initial inline formula — the Formula source (aligned with
   *  columns; undefined = not a Formula column). */
  sourceExprs?: (string | undefined)[];
  /** Derived cell VALUES for COMPUTED columns (row-major; meaningful only at
   *  columns the popup's source state marks computed) — computed cells render
   *  read-only from the derived frame through the SAME per-column format+unit
   *  controls as literal cells; they have no raw text to edit. */
  computedCells?: Cell[][];
}

export const tablePopup = createValueStore<TablePopupState>();
