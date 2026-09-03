import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { copyText } from "../clipboard";
import { tablePopup, type TablePopupState, type Cell as CellValue, type FramePopupColumn } from "../tablePopupStore";
import { appThemeStore } from "../appTheme";
import { formatScalar } from "./format";
import { parseCsvRows } from "../csv";
import { isSolError, ERROR_EXPLANATIONS } from "../errorValue";
import { formatDateSerial, parseDateToSerial, serialToJsDate, DEFAULT_DATE_FORMAT } from "../nodes/date";
import { coerceFrameCell, formatFrameCell, type FrameSourceColumn } from "../frame";
import { describeColumn, type ColumnProfile } from "../frameVerbs";
import { aggregate } from "../nodes/statsOps";
import { formatNumberWithAnnotation, isDateStyle, applyLogicalStyle, type FormatAnnotation, type FormatStyleId } from "../formatAnnotationStore";
import { isUnitCell } from "../unitValue";
import { columnUnitLabel } from "../unitColumn";
import { frameFormatStore } from "../frameFormatStore";
import { formatListCell } from "./valueDisplayFormat";
import { FormatStyleSelect, DateStyleSelect, UnitSelect, LogicalStyleSelect, TextCaseSelect } from "./fcControls";
import { applyTextCase } from "../formatAnnotationStore";
import { PopupShell, popupCardVars } from "./PopupShell";
import { settingsStore } from "../settingsStore";
import { gridKeyOf, nextCell } from "./gridKeyboard";
import { useColumnSort, sortedOrder, sortKeyOf, sortDirOf, SortIndicator, stopSortTrigger } from "./columnSort";
import { parseRecordLayout, recordImageSrc } from "../nodes/visual";
import { RecordGrid } from "./chartCards";
import type { RecordField } from "../chartValue";
import { PopupOverflowMenu } from "./PopupOverflowMenu";
import { saveCsvFileDialog } from "../fileBridge";
import { APP_LOCALE } from "../locale";
import "./errorChip.css";
import "./TablePopup.css";

type CellType = "number" | "string" | "date" | "logical"; // "date" edits as its serial (number-ish); "logical" as TRUE/FALSE

const COLTYPE_ORDER: CellType[] = ["number", "string", "date", "logical"];
const COLTYPE_GLYPH: Record<CellType, string> = { number: "#", string: "T", date: "D", logical: "B" };
const COLTYPE_NAME: Record<CellType, string> = { number: "Number", string: "Text", date: "Date", logical: "Boolean" };
// Text-entry columns (free text + logical TRUE/FALSE); number + date edit as numeric serials.
function isTextType(t: CellType): boolean { return t === "string" || t === "logical"; }

// ── grid <-> data ────────────────────────────────────────────────────────────
// Cells are held as strings so a half-typed "-" or "" is legal mid-edit;
// `columnTypes` overrides `cellType` per column so a frame can mix types.
function typeAt(j: number, cellType: CellType, columnTypes?: CellType[]): CellType {
  return columnTypes?.[j] ?? cellType;
}
function toGrid(data: CellValue[][], cellType: CellType, columnTypes?: CellType[]): string[][] {
  const cols = data.reduce((m, r) => Math.max(m, r.length), 0);
  return data.map((row) =>
    Array.from({ length: cols }, (_, j) => {
      const v = row[j];
      if (v === undefined || v === null || v === "") return "";
      // Logicals and per-cell errors render directly — formatScalar throws on a non-number.
      if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
      if (isSolError(v)) return v.code;
      // A UnitCell renders "magnitude unit" in its display unit; formatScalar would NaN it.
      if (isUnitCell(v)) return formatListCell(v, formatScalar);
      return isTextType(typeAt(j, cellType, columnTypes)) ? String(v) : formatScalar(v as number);
    }),
  );
}
function fromGrid(grid: string[][]): (number | null)[][] {
  return grid.map((row) =>
    row.map((cell) => {
      const t = cell.trim();
      if (t === "") return null; // a blank cell is MISSING (null), not 0 — don't fabricate a false 0
      const n = Number(t);
      return Number.isFinite(n) ? n : null;
    }),
  );
}
// Text keeps its value verbatim (incl. spaces); numeric/date/logical are trimmed.
function cell(c: string, cellType: CellType): string {
  if (cellType === "string") return c;
  return c.trim();
}
// Quoting follows RFC 4180. `escapeFormulas` (read-only export paths only) prefixes
// a formula-trigger text cell with an apostrophe so a paste into Excel can't execute
// it; editable grids skip it because their CSV view must round-trip typed text exactly.
function csvField(c: string, cellType: CellType, escapeFormulas = false): string {
  let out = cell(c, cellType);
  if (escapeFormulas && cellType === "string" && /^[=+\-@\t\r]/.test(out) && Number.isNaN(Number(out))) {
    out = `'${out}`;
  }
  if (cellType === "string" && /[",\n]/.test(out)) return `"${out.replace(/"/g, '""')}"`;
  return out;
}
function toCSV(grid: string[][], cellType: CellType, columnTypes?: CellType[], escapeFormulas = false): string {
  return grid.map((row) => row.map((c, j) => csvField(c, typeAt(j, cellType, columnTypes), escapeFormulas)).join(",")).join("\n");
}
// A 1-D list copies as one ", "-separated line, matching the node's list result box.
function listToText(grid: string[][], cellType: CellType): string {
  return grid.flat().map((c) => cell(c, cellType)).join(", ");
}
// Pipes/newlines in a cell must be escaped or the markdown table breaks apart.
function mdCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
function toMarkdown(grid: string[][], cellType: CellType, columnTypes: CellType[] | undefined, headers: string[] | undefined, isList: boolean): string {
  const rows = isList ? grid.flat().map((c) => [c]) : grid;
  const nCols = isList ? 1 : (rows.reduce((m, r) => Math.max(m, r.length), headers?.length ?? 0) || 1);
  const head = Array.from({ length: nCols }, (_, c) => mdCell(headers?.[c] ?? (isList ? "Value" : `Col ${c + 1}`)));
  const sep = head.map(() => "---");
  const body = rows.map((r) => Array.from({ length: nCols }, (_, c) => mdCell(cell(r[c] ?? "", isList ? cellType : typeAt(c, cellType, columnTypes)))));
  return [head, sep, ...body].map((r) => `| ${r.join(" | ")} |`).join("\n");
}
// Blank lines are KEPT as blank rows wherever they sit (a blank row is a row of
// missing cells); only the final newline terminator's phantom row drops.
function parseCSV(text: string): string[][] {
  return parseCsvRows(text, { keepBlankLines: true }).map((row) => row.map((c) => c.trim()));
}

// The form's date picker seeds from the raw cell — a serial or parseable date
// text — and writes back ISO text (parseable source, readable in Source/CSV).
function dateCellToISO(raw: string): string {
  const t = raw.trim();
  if (t === "") return "";
  const n = Number(t);
  const serial = Number.isFinite(n) ? n : parseDateToSerial(t);
  return Number.isFinite(serial) && serial > 0 ? serialToJsDate(serial).toISOString().slice(0, 10) : "";
}

// Spreadsheet column labels: A, B, … Z, AA, AB, …
function colLabel(i: number): string {
  let s = "";
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

/**
 * Mode is set by which save callback the opener passes: `onSave` → numeric matrix,
 * `onSaveFrame`/`onSaveSource`/`onSaveRaw` → frame editor, none → read-only viewer.
 */
type ColSummary = { profile: ColumnProfile; sum: number | null };
type FooterStat = "sum" | "avg" | "min" | "max" | "median" | "count" | "distinct" | "blank" | "error";
const NUMERIC_STATS: ReadonlyArray<FooterStat> = ["sum", "avg", "min", "max", "median"];
const FOOTER_STAT_LABEL: Record<FooterStat, string> = {
  sum: "Sum", avg: "Average", min: "Min", max: "Max", median: "Median",
  count: "Count", distinct: "Distinct", blank: "Empty", error: "Errors",
};
function footerStatValue(stat: FooterStat, s: ColSummary): number | null {
  const p = s.profile;
  switch (stat) {
    case "sum": return s.sum;
    case "avg": return p.mean;
    case "min": return p.min;
    case "max": return p.max;
    case "median": return p.median;
    case "count": return p.count;
    case "distinct": return p.distinct;
    case "blank": return p.blank;
    case "error": return p.error;
  }
}

export function TablePopup() {
  const state = useSyncExternalStore(tablePopup.subscribe, tablePopup.get);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);

  const [grid, setGrid] = useState<string[][]>([]);
  // Visual-only row sort, keyed on the popup state so a different value starts unsorted.
  const { sort, cycle: cycleSort, remap: remapSort, clear: clearSort } = useColumnSort(state);
  // Frame editor only; must stay aligned with the grid's columns.
  const [headerNames, setHeaderNames] = useState<string[]>([]);
  const [columnTypes, setColumnTypes] = useState<CellType[]>([]);
  // CSV keeps its own text buffer so mid-typing isn't reshaped by cell coercion.
  const [view, setView] = useState<"grid" | "csv" | "form">("grid");
  const [csvText, setCsvText] = useState("");
  // SOURCE = raw text, FORMATTED = derived render; on a literal-source editor BOTH
  // modes edit the same raw truth (Formatted swaps to raw text while focused).
  const [displayMode, setDisplayMode] = useState<"formatted" | "source">("formatted");
  // EVERY editable cell edits through this draft — committing per keystroke would
  // re-sort the row out from under the caret. The draft lives in a ref so Escape can
  // reset it and blur synchronously without committing a stale closure's text.
  const [editCell, setEditCell] = useState<{ r: number; c: number } | null>(null);
  // Form view's record cursor (a SOURCE row index, sort-independent).
  const [formRow, setFormRow] = useState(0);

  const editDraft = useRef("");
  const [, bumpDraft] = useState(0);
  // The grid table, so the keyboard mover can find a target cell by its data-vi/data-c.
  const gridRef = useRef<HTMLTableElement | null>(null);
  // One stat per column in the summary footer; unset = Sum for a number column, else Count.
  const [colStat, setColStat] = useState<Record<number, FooterStat>>({});
  const showSummary = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get("tablePopupSummary"));
  // DISPLAY-ONLY list orientation — the value stays the flat row; copy/CSV/Markdown
  // must keep flattening to the same list.
  const [listVertical, setListVertical] = useState(false);
  // Indexed by column; a "matrix" popup uses index 0 for the whole grid. Display-only —
  // never the value or Copy/CSV.
  const [colFmt, setColFmt] = useState<FormatAnnotation[]>([]);
  // undefined = Data, else the host's λ input key defining the column.
  const [colLambdas, setColLambdas] = useState<(string | undefined)[]>([]);
  // undefined = not a Formula column; a string (possibly empty, mid-authoring) = the
  // row-wise expr. The draft is local per keystroke; blur/Enter commits, Escape reverts.
  const [colExprs, setColExprs] = useState<(string | undefined)[]>([]);
  const committedExprs = useRef<(string | undefined)[]>([]);
  const exprEscaped = useRef(false);
  // Overrides the snapshot the popup opened with, so a live commit shows its result
  // without a Save/close round trip.
  const [liveComputed, setLiveComputed] = useState<CellValue[][] | null>(null);
  const initedFor = useRef<TablePopupState | null>(null);
  const summaryCache = useRef<{ deps: unknown[]; value: ColSummary[] | null }>({ deps: [], value: null });

  useEffect(() => {
    if (!state) { initedFor.current = null; return; }
    if (initedFor.current === state) return;
    initedFor.current = state;
    const baseType = state.cellType ?? "number";
    const g = toGrid(state.data, baseType, state.columnTypes);
    setGrid(g);
    const ncols = g.reduce((m, r) => Math.max(m, r.length), 0);
    setHeaderNames(Array.from({ length: ncols }, (_, j) => state.headers?.[j] ?? ""));
    setColumnTypes(Array.from({ length: ncols }, (_, j) => state.columnTypes?.[j] ?? baseType));
    setColLambdas(Array.from({ length: ncols }, (_, j) => state.sourceLambdas?.[j]));
    setColExprs(Array.from({ length: ncols }, (_, j) => state.sourceExprs?.[j]));
    committedExprs.current = Array.from({ length: ncols }, (_, j) => state.sourceExprs?.[j]);
    setLiveComputed(null);
    // A persisted per-column format (keyed by node+column) wins over the type default.
    const fmtNodeId = state.pinNodeId;
    const seedFormat = (colName: string | undefined, dflt: FormatAnnotation): FormatAnnotation => {
      const saved = fmtNodeId && colName ? frameFormatStore.get(fmtNodeId, colName) : undefined;
      if (!saved) return dflt;
      // A saved format left cross-type by a column type switch resets to the type default.
      const fmt = isDateStyle(saved.format) === isDateStyle(dflt.format) ? saved.format : dflt.format;
      return { ...saved, format: fmt, unit: dflt.unit };
    };
    if (state.formatControls === "matrix") {
      // A matrix has no column names — one whole-sheet format under a fixed key.
      setColFmt([seedFormat("*", { format: "auto", unit: state.columnUnits?.[0]?.display ?? "none" })]);
    } else if (state.formatControls === "columns") {
      setColFmt(Array.from({ length: ncols }, (_, j) =>
        seedFormat(state.headers?.[j], {
          format: state.columnTypes?.[j] === "date" ? "date_dmy" : "auto",
          unit: state.columnUnits?.[j]?.display ?? "none",
        })));
    } else {
      setColFmt([]);
    }
    setView("grid");
    setDisplayMode("formatted");
    setEditCell(null);
    setFormRow(0);
  }, [state]);

  if (!state) return null;
  const cellType: CellType = state.cellType ?? "number";
  const editable = (!!state.onSave && cellType === "number") || !!state.onSaveFrame || !!state.onSaveSource || !!state.onSaveRaw;
  // Literal-source editor: the grid holds RAW text, never coerced (tableInputRawText).
  const literalSource = !!state.onSaveSource || !!state.onSaveRaw;
  const formattedPreview = literalSource && displayMode === "formatted";
  const editableHeaders = editable && !!state.editableHeaders;
  const colTypeAt = (c: number): CellType => columnTypes[c] ?? cellType;
  const rows = grid.length;
  const cols = grid.reduce((m, r) => Math.max(m, r.length), 0);

  // Cap RENDERED rows (a 250k-row frame would put ~2M cells in the DOM); `grid` stays
  // the full edit/save truth, only the visible slice shrinks.
  const MAX_VISIBLE_ROWS = 1000;
  const rowsTruncated = rows > MAX_VISIBLE_ROWS;
  // Computed columns have no raw text — substitute their derived values into the shown
  // window so the views, copy paths and the sort see real cells, not blanks.
  const computedVals = liveComputed ?? state.computedCells;
  const isComputedCol = (c: number) => !!colLambdas[c] || colExprs[c] !== undefined;
  const hasComputed = !!computedVals && (colLambdas.some(Boolean) || colExprs.some((e) => e !== undefined));
  const rawAt = (r: number, c: number): string => {
    if (!hasComputed || !isComputedCol(c)) return grid[r]?.[c] ?? "";
    const v = computedVals?.[r]?.[c];
    if (v == null) return "";
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    return isSolError(v) ? v.code : String(v);
  };
  // The grid is addressed ROW BY ROW from here on, over the FULL dataset: the sort ranks
  // every row, Copy/CSV/Export emit every row, and only the RENDER takes the first
  // MAX_VISIBLE_ROWS of the sorted order (the DOM budget). Nothing pre-slices.
  const rawRow = (r: number): string[] =>
    hasComputed ? Array.from({ length: cols }, (_c, c) => rawAt(r, c)) : (grid[r] ?? []);

  const hasDateCols = state.columnTypes?.some(t => t === "date") || state.cellType === "date";
  // A frame popup carries per-column types; a plain Table/list does not.
  const isFramePopup = !!state.columnTypes;
  const showFmtToggle = literalSource || (!editable && (isFramePopup || hasDateCols));
  // Display-only: `grid` (raw text) is ALWAYS the edit/save truth.
  const displayRowAt = (r: number): string[] => {
    const row = rawRow(r);
    if (formattedPreview) {
      return row.map((raw, c) => {
        const type = colTypeAt(c);
        const f = formatFrameCell(type, coerceFrameCell(type, raw ?? ""));
        return f == null ? "" : String(f);
      });
    }
    if (!editable && (isFramePopup || hasDateCols)) {
      return row.map((cell, c) => {
        const type = colTypeAt(c);
        if (displayMode === "formatted") {
          if (type === "date") {
            // toGrid renders a blank as "", and `Number("")` is 0 — a REAL serial
            // (30-Dec-1899), so an unguarded parse prints a date for a missing cell.
            if (cell.trim() === "") return cell;
            const n = Number(cell);
            return Number.isFinite(n) ? formatDateSerial(n, DEFAULT_DATE_FORMAT) : cell;
          }
          return cell;
        }
        // Source: the inputted text verbatim if we have it, else the underlying form.
        const src = state.sourceCells?.[r]?.[c];
        if (src != null) return src;
        if (type === "logical") return cell === "TRUE" ? "1" : cell === "FALSE" ? "0" : cell;
        return cell;
      });
    }
    return row;
  };

  // The format+unit row re-renders the ON-SCREEN grid only — Copy/CSV stay raw.
  const showFmtControls = !!state.formatControls && view === "grid" && !state.list;
  // Never in-cell for the unit — that stays a tag / dropdown.
  const formatRenderActive = showFmtControls && (!editable || formattedPreview);
  function annFor(c: number): FormatAnnotation {
    const idx = state?.formatControls === "matrix" ? 0 : c;
    return colFmt[idx] ?? { format: "auto", unit: "none" };
  }
  function colHeaderLabel(c: number): string {
    return headers?.[c] ?? colLabel(c);
  }
  function setColFmtAt(i: number, patch: Partial<FormatAnnotation>) {
    setColFmt((f) => {
      const next = f.slice();
      while (next.length <= i) next.push({ format: "auto", unit: "none" });
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }
  // The DERIVED column name (matching what FrameDisplay reads), or "*" for a matrix.
  function colFmtKey(c: number): string | undefined {
    return state?.formatControls === "matrix" ? "*" : state?.headers?.[c];
  }
  // The UNIT does NOT persist here — a column's unit belongs to its value, saved on
  // the source column.
  function persistColFmt(c: number, patch: Partial<FormatAnnotation>) {
    const idx = state?.formatControls === "matrix" ? 0 : c;
    setColFmtAt(idx, patch);
    const nodeId = state?.pinNodeId;
    const col = colFmtKey(c);
    if (nodeId && col) frameFormatStore.set(nodeId, col, { ...annFor(c), ...patch, unit: "none" });
  }
  // Takes either a read-only frame's typed value or an editable source's raw text.
  function controlledCell(raw: CellValue, c: number): string {
    if (raw === null || raw === undefined || raw === "") return "";
    if (isSolError(raw)) return raw.code;
    const type = colTypeAt(c);
    const ann = annFor(c);
    // A logical cell may be a real boolean or "TRUE"/"FALSE"/"1"/"0" text.
    if (type === "logical" || typeof raw === "boolean") {
      const b = typeof raw === "boolean" ? raw : coerceFrameCell("logical", String(raw));
      return typeof b === "boolean" ? applyLogicalStyle(b, ann.logicalStyle) : String(raw);
    }
    // Editable source: the cell is raw text — coerce to its typed value first.
    const v: CellValue = typeof raw === "string" && (type === "number" || type === "date")
      ? (coerceFrameCell(type, raw) as CellValue)
      : raw;
    if (v === null) return "";
    if (typeof v === "number" && type === "date") {
      const fmt: FormatStyleId = isDateStyle(ann.format) ? ann.format : "date_dmy";
      return formatNumberWithAnnotation(v, { ...ann, format: fmt, unit: "none" });
    }
    if (typeof v === "number" && type === "number") {
      // The stored magnitude is already in its display unit, so never convert here; a
      // stale DATE format from a type switch must not turn a number into a date.
      const fmt: FormatStyleId = isDateStyle(ann.format) ? "auto" : ann.format;
      return formatNumberWithAnnotation(v, { ...ann, format: fmt, unit: "none" });
    }
    // Text column: the only display transform is letter case (non-destructive).
    if (type === "string") return applyTextCase(String(v), ann.textCase);
    return String(v);
  }

  // A pure render transpose — `grid` stays the 1×N truth, and lists are read-only here
  // so no edit-index remap is needed.
  const vertical = !!state.list && listVertical;
  const listLen = grid[0]?.length ?? 0;
  const listTruncated = vertical && listLen > MAX_VISIBLE_ROWS; // cap rows like a tall table
  // formatRenderActive ⇒ not a list, so `vertical` is false here.
  const controlledRowAt = (r: number): CellValue[] => (editable ? rawRow(r) : (state.data[r] ?? []));
  // The on-screen text of one SOURCE row (or, for a vertical list, of list element r).
  const viewRowAt = (r: number): string[] => {
    if (vertical) return [displayRowAt(0)[r] ?? ""];
    if (formatRenderActive) { const row = controlledRowAt(r); return Array.from({ length: cols }, (_, c) => controlledCell(row[c], c)); }
    return displayRowAt(r);
  };
  const viewCols = vertical ? 1 : cols;
  const viewRows = vertical ? listLen : rows;

  // `sortOrder` holds SOURCE row indices over the WHOLE dataset, so every index it hands
  // on stays the source row and `grid` is never touched; the render shows the first
  // MAX_VISIBLE_ROWS of it, so a sort on a 50k-row frame shows the true top of the order.
  // The key must come from the RAW grid, never the on-screen text — a date renders
  // "20-Mar-2026" but sorts by its serial.
  const sortOrder = sortedOrder(viewRows, sort, (r, c) =>
    sortKeyOf(vertical ? grid[0]?.[r] : rawAt(r, c)));
  const visibleOrder = sortOrder.length > MAX_VISIBLE_ROWS ? sortOrder.slice(0, MAX_VISIBLE_ROWS) : sortOrder;
  // The visible rows' on-screen text, built once per render (the only rows that render).
  const viewRowCache = new Map<number, string[]>();
  const viewRow = (r: number): string[] => { let v = viewRowCache.get(r); if (!v) { v = viewRowAt(r); viewRowCache.set(r, v); } return v; };
  // A row-oriented list is one row of N columns — sorting a column would sort one cell.
  const sortable = !(state.list && !vertical);

  // <input> cells have no intrinsic width, so measure: maxLen × the mono advance
  // (27/42 em per the shipped .fnt metrics) + 16px padding. Must stay a plain
  // computation, NOT a hook — it sits below the `if (!state) return null` guard.
  const MONO_CH_PX = 13 * (27 / 42);
  const colMinWidths: Array<number | undefined> = [];
  for (let c = 0; c < viewCols; c++) {
    const colType = vertical ? cellType : typeAt(c, cellType, state.columnTypes);
    if (isTextType(colType)) { colMinWidths.push(undefined); continue; }
    let m = 0;
    for (const r of visibleOrder) m = Math.max(m, (viewRow(r)[c] ?? "").length);
    const px = Math.ceil(m * MONO_CH_PX) + 16;
    colMinWidths.push(px > 72 ? Math.min(px, 200) : undefined);
  }

  function setCell(r: number, c: number, v: string) {
    setGrid((g) => g.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? v : cell)) : row)));
  }
  function setHeaderName(c: number, v: string) {
    setHeaderNames((h) => {
      const next = h.slice();
      while (next.length <= c) next.push("");
      next[c] = v;
      return next;
    });
  }
  function toggleColumnType(c: number) {
    setColumnTypes((t) => {
      const next = t.slice();
      while (next.length <= c) next.push("number");
      const i = COLTYPE_ORDER.indexOf(next[c]);
      next[c] = COLTYPE_ORDER[(i + 1) % COLTYPE_ORDER.length];
      return next;
    });
  }
  function addRow() {
    setGrid((g) => [...g, Array.from({ length: Math.max(1, cols) }, () => "")]);
  }
  function addCol() {
    // Appends at the END, so existing column indices (and sort keys) need no remap.
    setGrid((g) => (g.length === 0 ? [[""]] : g.map((row) => [...row, ""])));
    setHeaderNames((h) => [...h, ""]);
    setColumnTypes((t) => [...t, "number"]);
  }
  function removeRow() {
    setGrid((g) => (g.length > 1 ? g.slice(0, -1) : g));
  }
  function removeCol() {
    if (cols <= 1) return;
    // Drop the removed column's sort key, else it re-attaches to whichever column
    // inherits the index.
    const removed = cols - 1;
    remapSort((col) => (col === removed ? null : col > removed ? col - 1 : col));
    setGrid((g) => g.map((row) => row.slice(0, -1)));
    setHeaderNames((h) => h.slice(0, -1));
    setColumnTypes((t) => t.slice(0, -1));
  }
  // ── Form view (frame-source editor): one record as stacked labeled fields ──
  // Rides the same raw-text grid truth and edit-draft path as the grid cells;
  // the cursor is a SOURCE row, so it reaches rows past the grid's render cap.
  const formCapable = !!state.onSaveSource;
  const fRow = Math.min(formRow, Math.max(0, rows - 1));
  // Same semantics as the Record node: matched names take the column, an unknown
  // name keeps an (inert) box, columns not in the layout are simply not shown.
  // The layout is authored on the HOST CARD (the Record pattern) — never here.
  const formLayout = state.formLayout ?? "";
  const formPlaced = formLayout.trim() !== "" ? parseRecordLayout(formLayout) : [];
  const formCols = formPlaced.length > 0 ? Math.max(...formPlaced.map((pl) => pl.col + pl.colSpan - 1)) : 1;
  const formColIndex = (name: string): number =>
    headerNames.findIndex((h) => (h ?? "").trim().toLowerCase() === name.trim().toLowerCase());
  function addRecord() {
    const at = rows;
    setGrid((g) => (g.length === 0 ? [Array.from({ length: Math.max(1, cols) }, () => "")] : [...g, Array.from({ length: Math.max(1, cols) }, () => "")]));
    setFormRow(at);
  }
  function removeRecord() {
    if (rows <= 1) return;
    // Row order is untouched, so column sort keys stay valid (order re-derives).
    setGrid((g) => g.filter((_, i) => i !== fRow));
    setFormRow(Math.max(0, Math.min(fRow, rows - 2)));
  }

  // Blank → null; a numeric column coerces each cell (invalid → NaN); text is verbatim.
  function buildFrameColumns(): FramePopupColumn[] {
    return Array.from({ length: cols }, (_, c) => {
      const type = columnTypes[c] ?? "number";
      const values = grid.map((row): number | string | boolean | null => {
        const raw = row[c] ?? "";
        if (type === "string") return raw === "" ? null : raw;
        const s = raw.trim();
        if (s === "") return null;
        if (type === "logical") {
          const t = s.toLowerCase();
          if (t === "true" || t === "1") return true;
          if (t === "false" || t === "0") return false;
          return null; // an unparseable logical cell reads as missing
        }
        // number AND date store a numeric value (date = serial), so parse numerically
        // and fall back to the date parser for a typed ISO string.
        const n = Number(s);
        if (Number.isFinite(n)) return n;
        if (type === "date") { const d = parseDateToSerial(s); return Number.isFinite(d) ? d : NaN; }
        return NaN;
      });
      return { name: (headerNames[c] ?? "").trim(), type, values };
    });
  }

  // Per-column summary + profile for the footer (frame popups only), over the WHOLE
  // dataset: read-only reads state.data, editable reparses buildFrameColumns, a computed
  // column reads its derived cells (B6). Skipped entirely for a plain list/table popup.
  // Cached on the identities it reads: a keystroke (bumpDraft) or a sort click re-renders
  // without rescanning the grid.
  const summaryDeps = [state, grid, columnTypes, computedVals, colLambdas, colExprs, listVertical, editable, showSummary];
  const sameDeps = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  if (!sameDeps(summaryCache.current.deps, summaryDeps)) {
    const value: ColSummary[] | null = showSummary && isFramePopup && !vertical ? (() => {
      const frameCols = editable ? buildFrameColumns() : null;
      const valuesFor = (c: number): unknown[] => {
        if (hasComputed && isComputedCol(c)) return (computedVals ?? []).map((row) => row?.[c] ?? null);
        if (frameCols) return frameCols[c]?.values ?? [];
        return state.data.map((row) => row?.[c] ?? null);
      };
      return Array.from({ length: cols }, (_c, c) => {
        const type = colTypeAt(c);
        const values = valuesFor(c);
        const profile = describeColumn(values, type);
        let sum: number | null = null;
        if (type === "number") {
          const r = aggregate("sum", values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)));
          sum = typeof r === "number" ? r : null;
        }
        return { profile, sum };
      });
    })() : null;
    summaryCache.current = { deps: summaryDeps, value };
  }
  const colSummaries = summaryCache.current.value;
  const fmtStat = (n: number | null): string => (n == null ? "—" : formatScalar(n));

  const headers = editableHeaders ? headerNames : state.headers;
  // A frame's CSV view prepends a header line (below); a plain table/list doesn't.
  const hasHeaderLine = !state.list && !!(headers && headers.length);
  // The WHOLE dataset as text — never the rendered slice. `inSortOrder` follows the
  // visual sort (the read paths: Copy, Export, a read-only CSV view); the EDITABLE CSV
  // view stays in source order because its text parses straight back into `grid`.
  // Read-only popups neutralize formula-injection prefixes on export; editable ones
  // must round-trip the typed text exactly.
  function buildText(inSortOrder: boolean): string {
    const order = inSortOrder ? sortOrder : Array.from({ length: viewRows }, (_, i) => i);
    if (state!.list) {
      const line = displayRowAt(0);
      return listToText([vertical ? order.map((i) => line[i] ?? "") : line], cellType);
    }
    const body = toCSV(order.map((r) => displayRowAt(r)), cellType, columnTypes, !editable);
    return hasHeaderLine
      ? `${headers!.map((h) => csvField(h, "string", !editable)).join(",")}\n${body}`
      : body;
  }

  function showCSV() {
    setCsvText(buildText(!editable));
    setView("csv");
  }
  function onCsvChange(v: string) {
    setCsvText(v);
    if (!editable || formattedPreview) return;
    const rows = parseCSV(v);
    // Symmetric with `asText`: a header line must be parsed back OUT into headerNames,
    // else it duplicates into row 0. A column-count change invalidates every sort key.
    const body = hasHeaderLine ? rows.slice(1) : rows;
    if (body.reduce((m, r) => Math.max(m, r.length), 0) !== cols) clearSort();
    if (hasHeaderLine) {
      setHeaderNames(rows[0] ?? []);
      setGrid(rows.slice(1));
    } else {
      setGrid(rows);
    }
  }

  function copy() {
    const text = view === "csv" ? csvText : buildText(true);
    void copyText(text);
  }
  function copyMarkdown() {
    const gridForMd = state?.list ? [displayRowAt(0)] : sortOrder.map((r) => displayRowAt(r));
    void copyText(toMarkdown(gridForMd, cellType, columnTypes, headers, !!state?.list));
  }
  function exportCsv() {
    const base = (state?.title || "table").replace(/[^\w.-]+/g, "_") || "table";
    void saveCsvFileDialog(`${base}.csv`, buildText(true));
  }
  // Cells stay verbatim — coercion to typed values happens downstream in deriveFrame.
  function buildSourceColumns(overrides?: {
    lambdas?: (string | undefined)[];
    exprs?: (string | undefined)[];
    units?: Record<number, string>;
  }): FrameSourceColumn[] {
    const lambdas = overrides?.lambdas ?? colLambdas;
    const exprs = overrides?.exprs ?? colExprs;
    return Array.from({ length: cols }, (_, c) => {
      // The per-column unit choice rides the value downstream via deriveFrame.
      const u = state?.unitTaggable && (columnTypes[c] ?? "number") === "number"
        ? (overrides?.units?.[c] ?? annFor(c).unit)
        : undefined;
      const lambda = lambdas[c];
      const expr = lambda ? undefined : exprs[c]?.trim() || undefined;
      return {
        name: (headerNames[c] ?? "").trim(),
        type: columnTypes[c] ?? "number",
        // A computed column has no raw text — its cells derive from the λ/formula.
        cells: lambda || expr ? [] : grid.map((row) => row[c] ?? ""),
        ...(u && u !== "none" ? { unit: u } : {}),
        ...(lambda ? { lambda } : {}),
        ...(expr ? { expr } : {}),
      };
    });
  }
  // Writes the source through to the node now and refreshes derived cells + types;
  // the later Save is then a no-op re-commit.
  async function commitLive(overrides?: Parameters<typeof buildSourceColumns>[0]) {
    if (!state?.onCommitSource) return;
    committedExprs.current = [...(overrides?.exprs ?? colExprs)];
    const refresh = await state.onCommitSource(buildSourceColumns(overrides));
    if (!refresh) return;
    setLiveComputed(refresh.computedCells);
    setColumnTypes(refresh.columnTypes);
  }
  function save() {
    if (state?.onSaveRaw) state.onSaveRaw(grid.map((row) => [...row]));
    else if (state?.onSaveSource) state.onSaveSource(buildSourceColumns());
    else if (state?.onSaveFrame) state.onSaveFrame(buildFrameColumns());
    else state?.onSave?.(fromGrid(grid), editableHeaders ? headerNames : state.headers);
    tablePopup.close();
  }

  const grouped = !!state.groupColor;
  const cardStyle = popupCardVars(state);

  // Move focus to the grid cell at a VISUAL position (index into visibleOrder) + column,
  // located by its data-attrs so no per-cell refs are needed.
  const focusGridCell = (target: { vi: number; c: number } | null) => {
    if (!target) return;
    // Read-only cells are a focusable <div> (tabIndex -1), not an <input> — match either.
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-vi="${target.vi}"][data-c="${target.c}"]`);
    if (el) { el.focus(); if (el instanceof HTMLInputElement) el.select(); }
  };
  // A read-only grid cell renders as plain TEXT, not an <input readOnly> — the <input> is
  // ~2.5× the per-cell DOM cost (the popup-virtualize Finding, dev-notes) and read-only
  // popups paid it for nothing. Stays keyboard-navigable: tabIndex -1 + data-vi/data-c so
  // focusGridCell lands here, and the same column-skipping arrow mover an editable cell uses.
  const readOnlyCell = (content: string, className: string, vi: number, c: number) => (
    <div
      className={`${className} table-popup__input--ro`}
      data-vi={vi}
      data-c={c}
      tabIndex={-1}
      onKeyDown={(e) => {
        const k = gridKeyOf(e);
        if (!k) return;
        const target = nextCell(k, { vi, c }, { rows: visibleOrder.length, cols: viewCols }, (_vi, cc) => isComputedCol(cc));
        if (!target) return;
        e.preventDefault();
        focusGridCell(target);
      }}
    >
      {content === "" ? " " : content}
    </div>
  );
  // Escape mid-edit reverts the cell being edited and keeps the popup open (the shell's
  // capture listener fires before the cell's own keydown); Escape with nothing mid-edit
  // closes. Deletes the need for a per-cell Escape branch.
  const onGridEscape = () => {
    if (editCell) {
      editDraft.current = grid[editCell.r]?.[editCell.c] ?? "";
      setEditCell(null);
      (document.activeElement as HTMLElement | null)?.blur?.();
    } else {
      tablePopup.close();
    }
  };

  return (
    <PopupShell
      title={state.title}
      onClose={() => tablePopup.close()}
      onEscape={onGridEscape}
      cardClassName="table-popup"
      grouped={grouped}
      cardStyle={cardStyle}
      resizable={{ min: { w: 320, h: 220 } }}
      headerExtra={<span className="table-popup__dims">{vertical ? `${listLen}×1` : `${rows}×${cols}`}{rowsTruncated || listTruncated ? ` · first ${MAX_VISIBLE_ROWS.toLocaleString(APP_LOCALE)}` : ""}</span>}
      pinNodeId={state.pinNodeId}
      headerActions={
        <PopupOverflowMenu
          items={[
            { label: state.list ? "Copy" : "Copy CSV", onClick: copy },
            { label: "Copy as Markdown", onClick: copyMarkdown },
            { label: "Export CSV…", onClick: exportCsv },
            ...(isFramePopup ? [{ label: showSummary ? "Hide summary footer" : "Show summary footer", onClick: () => settingsStore.set("tablePopupSummary", !showSummary) }] : []),
          ]}
        />
      }
    >
      {view === "grid" && showFmtControls && state.formatControls === "matrix" && (
        // A matrix is homogeneous — one format pair for the whole sheet, so it sits
        // ABOVE the grid rather than inside it as a column row.
        <div className="table-popup__matrix-fmt">
          {cellType === "logical" ? (
            <LogicalStyleSelect className="table-popup__fmtselect" value={annFor(0).logicalStyle} onChange={(s) => persistColFmt(0, { logicalStyle: s })} />
          ) : cellType === "date" ? (
            <DateStyleSelect className="table-popup__fmtselect" value={annFor(0).format} onChange={(f) => persistColFmt(0, { format: f })} />
          ) : cellType === "string" ? (
            <TextCaseSelect className="table-popup__fmtselect" value={annFor(0).textCase} onChange={(tc) => persistColFmt(0, { textCase: tc })} />
          ) : (
            <FormatStyleSelect className="table-popup__fmtselect" value={annFor(0).format} onChange={(f) => persistColFmt(0, { format: f })} />
          )}
          {state.unitTaggable && cellType === "number" ? (
            <UnitSelect
              className="table-popup__fmtselect"
              value={annFor(0).unit}
              onChange={(u) => { setColFmtAt(0, { unit: u }); state.onSaveMatrixUnit?.(u); }}
            />
          ) : cellType === "number" && state.columnUnits?.[0] ? (
            // Derived matrix: the unit is inherited from the source, so it's LOCKED here.
            <UnitSelect
              className="table-popup__fmtselect"
              value={state.columnUnits[0]!.display ?? "none"}
              onChange={() => {}}
              disabled
              title={`Unit: ${columnUnitLabel(state.columnUnits[0]!)} (inherited from the source)`}
            />
          ) : null}
        </div>
      )}
      {view === "grid" ? (
        <div className="table-popup__grid-scroll sol-popup__scroll">
          <table className="table-popup__grid" ref={gridRef}>
            <thead>
              <tr>
                <th className="table-popup__corner" />
                {Array.from({ length: viewCols }, (_, c) => (
                  <th
                    key={c}
                    // A text-selection drag starting in the name input dispatches its
                    // click on the th (the common-ancestor rule), skipping stopSortTrigger
                    // — so also ignore any click originating in a control.
                    title={vertical ? undefined : headers?.[c]}
                    onClick={sortable ? (e) => {
                      if ((e.target as Element).closest("input,button,select")) return;
                      cycleSort(c);
                    } : undefined}
                    className={`${headers && !vertical ? "table-popup__colhead table-popup__colhead--name" : "table-popup__colhead"}${sortable ? " table-popup__colhead--sortable" : ""}${sortable && editableHeaders ? " table-popup__colhead--sortpad" : ""}`}
                  >
                    {vertical ? colLabel(0) : editableHeaders ? (
                      <div className="table-popup__colhead-edit">
                        {/* A computed column's type is inferred from its cells. */}
                        {!colLambdas[c] && colExprs[c] === undefined && (
                          <button
                            type="button"
                            className="table-popup__coltype"
                            title={`Column type: ${COLTYPE_NAME[colTypeAt(c)]}. Cycle Number / Text / Date / Boolean.`}
                            onClick={(e) => { e.stopPropagation(); toggleColumnType(c); }}
                          >
                            {COLTYPE_GLYPH[colTypeAt(c)]}
                          </button>
                        )}
                        <input
                          className="table-popup__input table-popup__input--text table-popup__colhead-input"
                          value={headerNames[c] ?? ""}
                          placeholder={colLabel(c)}
                          spellCheck={false}
                          {...stopSortTrigger}
                          onChange={(e) => setHeaderName(c, e.target.value)}
                        />
                      </div>
                    ) : (
                      colHeaderLabel(c)
                    )}
                    {editableHeaders && !vertical && !!state.onSaveSource && (
                      // Column source: Data, an inline Formula, or a wired λ input.
                      <>
                        <select
                          className="table-popup__srcselect"
                          value={colLambdas[c] ?? (colExprs[c] !== undefined ? "=" : "")}
                          {...stopSortTrigger}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const v = e.target.value;
                            const nextLambdas = [...colLambdas]; nextLambdas[c] = v && v !== "=" ? v : undefined;
                            const nextExprs = [...colExprs]; nextExprs[c] = v === "=" ? (nextExprs[c] ?? "") : undefined;
                            setColLambdas(nextLambdas);
                            setColExprs(nextExprs);
                            // A complete pick applies now; Formula waits for its expr to blur.
                            if (v !== "=") void commitLive({ lambdas: nextLambdas, exprs: nextExprs });
                          }}
                        >
                          <option value="">Data</option>
                          <option value="=">Formula</option>
                          {(state.lambdaOptions ?? []).map((k) => (
                            <option key={k} value={k}>{`λ${k.replace(/^fn/, "")}`}</option>
                          ))}
                        </select>
                        {colExprs[c] !== undefined && !colLambdas[c] && (
                          // One formula per column: @name reads this row, a bare name
                          // the whole column (tableRefSemantics).
                          <div className="table-popup__exprrow">
                            <span className="table-popup__exprprefix">=</span>
                            <input
                              className="table-popup__input table-popup__input--text table-popup__exprinput"
                              value={colExprs[c] ?? ""}
                              placeholder="@price * @qty"
                              spellCheck={false}
                              {...stopSortTrigger}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                const v = e.target.value;
                                setColExprs((prev) => { const next = [...prev]; next[c] = v; return next; });
                              }}
                              onBlur={() => {
                                if (exprEscaped.current) { exprEscaped.current = false; return; }
                                if (colExprs[c] !== committedExprs.current[c]) void commitLive();
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.currentTarget.blur();
                                else if (e.key === "Escape") {
                                  // The flag stops the following blur from committing
                                  // the stale closure text.
                                  const prev = committedExprs.current[c];
                                  setColExprs((xs) => { const next = [...xs]; next[c] = prev; return next; });
                                  exprEscaped.current = true;
                                  e.currentTarget.blur();
                                }
                              }}
                            />
                          </div>
                        )}
                      </>
                    )}
                    {sortable && (
                      <SortIndicator
                        dir={sortDirOf(sort, c)}
                        // The name field fills its header, leaving no dependable margin
                        // to tap on a phone, so the chevron is itself the control there.
                        onCycle={editableHeaders ? () => cycleSort(c) : undefined}
                        label={headers?.[c] || colLabel(c)}
                      />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            {showFmtControls && state.formatControls === "columns" && (
              <tbody className="table-popup__fmtbody">
                <tr>
                  <th className="table-popup__corner" />
                  {Array.from({ length: viewCols }, (_, c) => {
                    const type = colTypeAt(c);
                    return (
                      <td key={c} className="table-popup__fmtcell">
                        {type === "date" ? (
                          <DateStyleSelect className="table-popup__fmtselect" value={annFor(c).format} onChange={(f) => persistColFmt(c, { format: f })} />
                        ) : type === "logical" ? (
                          <LogicalStyleSelect className="table-popup__fmtselect" value={annFor(c).logicalStyle} onChange={(s) => persistColFmt(c, { logicalStyle: s })} />
                        ) : type === "string" ? (
                          <TextCaseSelect className="table-popup__fmtselect" value={annFor(c).textCase} onChange={(tc) => persistColFmt(c, { textCase: tc })} />
                        ) : type === "number" ? (
                          <div className="table-popup__fmtstack">
                            <FormatStyleSelect className="table-popup__fmtselect" value={annFor(c).format} onChange={(f) => persistColFmt(c, { format: f })} />
                            {state.unitTaggable ? (
                              <UnitSelect
                                className="table-popup__fmtselect"
                                value={annFor(c).unit}
                                onChange={(u) => {
                                  setColFmtAt(c, { unit: u });
                                  // A computed column's unit rides the derived value, so
                                  // commit now; a Data column keeps Save timing.
                                  if (colLambdas[c] || colExprs[c] !== undefined) void commitLive({ units: { [c]: u } });
                                }}
                              />
                            ) : state.columnUnits?.[c] ? (
                              // Derived column: unit inherited from the source, LOCKED (disabled picker).
                              <UnitSelect
                                className="table-popup__fmtselect"
                                value={state.columnUnits[c]!.display ?? "none"}
                                onChange={() => {}}
                                disabled
                                title={`Unit: ${columnUnitLabel(state.columnUnits[c]!)} (inherited from the source)`}
                              />
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            )}
            <tbody>
              {/* Rows render in SORT order but carry their SOURCE index `r`, so the row
                  number and every edit below address the real row. */}
              {visibleOrder.map((r, vi) => { const row = viewRow(r); return (
                <tr key={r}>
                  <th className="table-popup__rowhead">{r + 1}</th>
                  {Array.from({ length: viewCols }, (_, c) => {
                    // A vertical list's type is the list's, not column `c` (always 0 there).
                    const type = vertical ? cellType : colTypeAt(c);
                    // In a NUMERIC column a shown "NaN" can only be a real NaN (dirty data).
                    const nan = !isTextType(type) && (row[c] ?? "") === "NaN";
                    // A tagged error renders as its #CODE!. Membership in ERROR_EXPLANATIONS
                    // (a total Record<SolErrorCode, string>) is the test, so a NEW code is
                    // covered the day it is declared — a hand-kept list or a `#\w+!` regex
                    // would not be (per noManualList).
                    const errCode = (row[c] ?? "").trim();
                    const isErrCell = errCode !== "" && Object.prototype.hasOwnProperty.call(ERROR_EXPLANATIONS, errCode);
                    // Formatted mode swaps the derived render for the RAW text on focus
                    // (the edit truth) and re-renders formatted on the commit.
                    const fmtEdit = formattedPreview && editable && !vertical;
                    const editingHere = !!editCell && editCell.r === r && editCell.c === c;
                    // A computed column is read-only — no raw text behind its cells.
                    const computedHere = !vertical && (!!colLambdas[c] || colExprs[c] !== undefined);
                    const canEdit = !computedHere && editable && !(formattedPreview && !fmtEdit); // = !readOnly below
                    if (computedHere) {
                      // Derived values render through the same controlledCell path as
                      // literal ones, so the format row applies here too.
                      return (
                        <td
                          key={c}
                          className="table-popup__cell table-popup__cell--computed"
                          style={colMinWidths[c] !== undefined ? { minWidth: colMinWidths[c] } : undefined}
                        >
                          {readOnlyCell(
                            controlledCell((liveComputed ?? state.computedCells)?.[r]?.[c] ?? null, c),
                            `table-popup__input table-popup__input--computed${isTextType(type) ? " table-popup__input--text" : ""}`,
                            vi, c,
                          )}
                        </td>
                      );
                    }
                    return (
                    <td
                      key={c}
                      className={`table-popup__cell${nan ? " table-popup__cell--nan" : ""}`}
                      style={colMinWidths[c] !== undefined ? { minWidth: colMinWidths[c] } : undefined}
                      title={nan ? "Not a number: an undefined value in the data"
                        : isErrCell ? ERROR_EXPLANATIONS[errCode as keyof typeof ERROR_EXPLANATIONS]
                        : undefined}
                    >
                      {!canEdit ? readOnlyCell(
                        row[c] ?? "",
                        `${isTextType(type) ? "table-popup__input table-popup__input--text" : "table-popup__input"}${isErrCell ? " sol-error-chip" : ""}`,
                        vi, c,
                      ) : (
                      <input
                        className={`${isTextType(type) ? "table-popup__input table-popup__input--text" : "table-popup__input"}${isErrCell ? " sol-error-chip" : ""}`}
                        value={editingHere ? editDraft.current : row[c] ?? ""}
                        readOnly={!editable || (formattedPreview && !fmtEdit)}
                        inputMode={isTextType(type) ? "text" : "decimal"}
                        spellCheck={false}
                        onFocus={canEdit ? () => { editDraft.current = grid[r]?.[c] ?? ""; setEditCell({ r, c }); } : undefined}
                        onChange={(e) => {
                          if (!canEdit) return;
                          editDraft.current = e.target.value;
                          // Re-seat if focus didn't seed editCell — an edit can't land
                          // on an unmarked cell.
                          if (editingHere) bumpDraft((x) => x + 1);
                          else setEditCell({ r, c });
                        }}
                        onBlur={canEdit ? () => { if (editingHere) { setCell(r, c, editDraft.current); setEditCell(null); } } : undefined}
                        data-vi={vi}
                        data-c={c}
                        onKeyDown={canEdit ? (e) => {
                          const k = gridKeyOf(e);
                          if (!k) return; // Escape is handled by the shell's onEscape (capture)
                          // Mid-edit, arrows/Home/End move the CARET (Excel edit-mode); Enter/Tab
                          // always commit-then-move.
                          const midEdit = editingHere && editDraft.current !== (grid[r]?.[c] ?? "");
                          if (midEdit && k !== "Enter" && k !== "ShiftEnter" && k !== "Tab" && k !== "ShiftTab") return;
                          const target = nextCell(k, { vi, c }, { rows: visibleOrder.length, cols: viewCols }, (_vi, cc) => isComputedCol(cc));
                          // Commit-then-move, explicit so blur is a no-op. The target is the VISUAL
                          // position from before the commit — a commit can re-rank the row (sort); accepted.
                          if (editingHere) { setCell(r, c, editDraft.current); setEditCell(null); }
                          if (!target) return; // Tab/Shift+Tab off the end → the browser's default Tab
                          e.preventDefault();
                          focusGridCell(target);
                        } : undefined}
                      />
                      )}
                    </td>
                    );
                  })}
                </tr>
              ); })}
            </tbody>
            {colSummaries && (
              <tfoot className="table-popup__sumfoot">
                <tr>
                  <th className="table-popup__corner" />
                  {Array.from({ length: viewCols }, (_, c) => {
                    const numeric = colTypeAt(c) === "number";
                    const stat: FooterStat = colStat[c] ?? (numeric ? "sum" : "count");
                    const choices = (Object.keys(FOOTER_STAT_LABEL) as FooterStat[]).filter((k) => numeric || !NUMERIC_STATS.includes(k));
                    return (
                      <td key={c} className="table-popup__statcell">
                        {/* The visible picker is the stat's word (sized to itself); the real
                            select sits over it invisibly, so it never widens the column. */}
                        <span className="table-popup__statpick">
                          <span className="table-popup__statlabel">{FOOTER_STAT_LABEL[stat]} ▾</span>
                          <select
                            className="table-popup__statselect"
                            value={stat}
                            aria-label="Summary statistic"
                            onChange={(e) => setColStat((m) => ({ ...m, [c]: e.target.value as FooterStat }))}
                          >
                            {choices.map((k) => <option key={k} value={k}>{FOOTER_STAT_LABEL[k]}</option>)}
                          </select>
                        </span>
                        <span className="table-popup__statvalue">{fmtStat(footerStatValue(stat, colSummaries[c]))}</span>
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      ) : view === "form" ? (
        <div className="table-popup__form-scroll sol-popup__scroll">
          <div className="table-popup__form">
            <div className="table-popup__form-nav">
              <button type="button" className="table-popup__btn" onClick={() => setFormRow(Math.max(0, fRow - 1))} disabled={fRow <= 0} title="Previous record">
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M6.5 1l-4 4 4 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <span className="table-popup__form-count">{rows === 0 ? "0 / 0" : `${fRow + 1} / ${rows}`}</span>
              <button type="button" className="table-popup__btn" onClick={() => setFormRow(Math.min(rows - 1, fRow + 1))} disabled={fRow >= rows - 1} title="Next record">
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <div className="table-popup__spacer" />
              <button type="button" className="table-popup__btn" onClick={addRecord} title="Add a record">+ Record</button>
              <button type="button" className="table-popup__btn" onClick={removeRecord} disabled={rows <= 1} title="Delete this record">− Record</button>
            </div>
            {rows > 0 && (() => {
              // Source OFF renders the row through the SAME RecordGrid the Record chart
              // type uses — one look for the figure and the form, images included. Source
              // ON is the editable version below.
              if (formattedPreview) {
                const shownAt = (c: number): string | null => {
                  if (c === -1) return null;
                  if (isComputedCol(c)) {
                    const s = controlledCell((liveComputed ?? state.computedCells)?.[fRow]?.[c] ?? null, c);
                    return s === "" ? null : s;
                  }
                  const raw = grid[fRow]?.[c] ?? "";
                  if (raw.trim() === "") return null;
                  const f = formatFrameCell(colTypeAt(c), coerceFrameCell(colTypeAt(c), raw));
                  return f == null ? null : String(f);
                };
                const toField = (c: number, name: string, at: { row: number; col: number; rowSpan: number; colSpan: number }, hint?: string): RecordField => {
                  const label = c === -1 ? name : (headerNames[c] ?? "").trim() || colLabel(c);
                  const shown = shownAt(c);
                  const image = shown != null ? recordImageSrc(shown) : null;
                  const f: RecordField = { label, value: shown, ...(image ? { image } : {}), ...at };
                  if (shown == null && hint) f.hint = hint;
                  return f;
                };
                const fields = formPlaced.length > 0
                  ? formPlaced.map((pl) => toField(formColIndex(pl.name), pl.name, { row: pl.row, col: pl.col, rowSpan: pl.rowSpan, colSpan: pl.colSpan }, pl.hint))
                  : Array.from({ length: cols }, (_, c) => toField(c, "", { row: c + 1, col: 1, rowSpan: 1, colSpan: 1 }));
                return <RecordGrid fields={fields} cols={formPlaced.length > 0 ? formCols : 1} />;
              }
              // Record-look boxes: touching, square, label-in-box; the input is
              // the box's value line (the figure look, made editable).
              const box = (c: number, name: string, key: number | string, at?: React.CSSProperties, hint?: string) => {
                const type = c === -1 ? "string" : colTypeAt(c);
                const computedHere = c !== -1 && (!!colLambdas[c] || colExprs[c] !== undefined);
                const label = c === -1 ? name : (headerNames[c] ?? "").trim() || colLabel(c);
                const editingHere = c !== -1 && !!editCell && editCell.r === fRow && editCell.c === c;
                return (
                  <label className="table-popup__form-box" key={key} style={at}>
                    <span className="table-popup__form-box-label">{label}</span>
                    {c === -1 ? (
                      <input className="table-popup__form-box-input" value="" placeholder={hint} readOnly tabIndex={-1} />
                    ) : computedHere ? (
                      <input
                        className="table-popup__form-box-input"
                        value={controlledCell((liveComputed ?? state.computedCells)?.[fRow]?.[c] ?? null, c)}
                        readOnly
                        tabIndex={-1}
                        spellCheck={false}
                      />
                    ) : type === "logical" ? (
                      // A discrete pick applies immediately; a blank cell shows as
                      // the indeterminate state (blank ≠ FALSE) until first toggle.
                      (() => {
                        const raw = (grid[fRow]?.[c] ?? "").trim().toLowerCase();
                        const val = raw === "true" || raw === "1" ? true : raw === "false" || raw === "0" ? false : null;
                        return (
                          <input
                            type="checkbox"
                            className="table-popup__form-box-check"
                            checked={val === true}
                            ref={(el) => { if (el) el.indeterminate = val === null; }}
                            onChange={(e) => setCell(fRow, c, e.target.checked ? "TRUE" : "FALSE")}
                          />
                        );
                      })()
                    ) : type === "date" ? (
                      // The native picker (the Date Input node's control); clearing
                      // writes a blank cell (missing), never a fabricated date.
                      <input
                        type="date"
                        className="table-popup__form-box-input"
                        value={dateCellToISO(grid[fRow]?.[c] ?? "")}
                        onChange={(e) => setCell(fRow, c, e.target.value)}
                      />
                    ) : (
                      <input
                        className="table-popup__form-box-input"
                        value={editingHere ? editDraft.current : grid[fRow]?.[c] ?? ""}
                        placeholder={hint}
                        inputMode={isTextType(type) ? "text" : "decimal"}
                        spellCheck={false}
                        onFocus={() => { editDraft.current = grid[fRow]?.[c] ?? ""; setEditCell({ r: fRow, c }); }}
                        onChange={(e) => {
                          editDraft.current = e.target.value;
                          if (editingHere) bumpDraft((x) => x + 1);
                          else setEditCell({ r: fRow, c });
                        }}
                        onBlur={() => { if (editingHere) { setCell(fRow, c, editDraft.current); setEditCell(null); } }}
                        onKeyDown={(e) => {
                          // Escape is handled by the shell's onEscape (editCell is set here too).
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                      />
                    )}
                  </label>
                );
              };
              return (
                <div className="table-popup__form-grid" style={{ gridTemplateColumns: `repeat(${formPlaced.length > 0 ? formCols : 1}, minmax(0, 1fr))` }}>
                  {formPlaced.length > 0
                    ? formPlaced.map((pl, i) =>
                        box(formColIndex(pl.name), pl.name, i, { gridRow: `${pl.row} / span ${pl.rowSpan}`, gridColumn: `${pl.col} / span ${pl.colSpan}` }, pl.hint))
                    : Array.from({ length: cols }, (_, c) => box(c, "", c))}
                </div>
              );
            })()}
          </div>
        </div>
      ) : (
        <textarea
          className="table-popup__csv sol-popup__scroll"
          value={csvText}
          readOnly={!editable || formattedPreview}
          spellCheck={false}
          wrap="off"
          onChange={(e) => onCsvChange(e.target.value)}
        />
      )}

      <div className="table-popup__footer">
        <div className="table-popup__view" role="group" aria-label="View">
          <button
            type="button"
            aria-pressed={view === "grid"}
            onClick={() => setView("grid")}
          >Grid</button>
          {formCapable && (
            <button
              type="button"
              aria-pressed={view === "form"}
              onClick={() => setView("form")}
            >Form</button>
          )}
          <button
            type="button"
            aria-pressed={view === "csv"}
            onClick={showCSV}
          >CSV</button>
        </div>
        {state.list && view === "grid" && (
          <div className="table-popup__view" role="group" aria-label="List layout">
            <button
              type="button"
              aria-pressed={!listVertical}
              onClick={() => setListVertical(false)}
              title="Show the list across a row"
            >Row</button>
            <button
              type="button"
              aria-pressed={listVertical}
              onClick={() => setListVertical(true)}
              title="Show the list down a column — one value per line (display only, the value is unchanged)"
            >Column</button>
          </div>
        )}
        {showFmtToggle && (
          <label
            className="table-popup__source-check"
            title={literalSource
              ? "Checked: show and edit exactly what you typed. Unchecked: the derived render, such as TRUE/FALSE and formatted dates."
              : "Show the inputted source text instead of the formatted value"}
          >
            <input
              type="checkbox"
              checked={displayMode === "source"}
              onChange={(e) => setDisplayMode(e.target.checked ? "source" : "formatted")}
            />
            Source
          </label>
        )}
        {editable && view === "grid" && (
          <div className="table-popup__dim-controls">
            <button className="table-popup__btn" onClick={addRow} title="Add row">+ Row</button>
            <button className="table-popup__btn" onClick={removeRow} title="Remove last row" disabled={rows <= 1}>− Row</button>
            <button className="table-popup__btn" onClick={addCol} title="Add column">+ Col</button>
            <button className="table-popup__btn" onClick={removeCol} title="Remove last column" disabled={cols <= 1}>− Col</button>
          </div>
        )}
        <div className="table-popup__spacer" />
        {editable ? (
          <>
            <button className="table-popup__btn" onClick={() => tablePopup.close()}>Cancel</button>
            <button className="table-popup__btn table-popup__btn--primary" onClick={save}>Save</button>
          </>
        ) : (
          <button className="table-popup__btn table-popup__btn--primary" onClick={() => tablePopup.close()}>Done</button>
        )}
      </div>
    </PopupShell>
  );
}
