import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { copyText } from "../clipboard";
import { tablePopup, type TablePopupState, type Cell as CellValue, type FramePopupColumn } from "../tablePopupStore";
import { appThemeStore } from "../appTheme";
import { formatScalar } from "./format";
import { parseCsvRows } from "../csv";
import { isSolError } from "../errorValue";
import { formatDateSerial, parseDateToSerial, DEFAULT_DATE_FORMAT } from "../nodes/date";
import { coerceFrameCell, formatFrameCell, type FrameSourceColumn } from "../frame";
import { formatNumberWithAnnotation, isDateStyle, applyLogicalStyle, type FormatAnnotation, type FormatStyleId } from "../formatAnnotationStore";
import { isUnitCell } from "../unitValue";
import { columnUnitLabel } from "../unitColumn";
import { frameFormatStore } from "../frameFormatStore";
import { formatListCell } from "./valueDisplayFormat";
import { FormatStyleSelect, DateStyleSelect, UnitSelect, LogicalStyleSelect } from "./fcControls";
import { PopupShell } from "./PopupShell";
import { PopupOverflowMenu } from "./PopupOverflowMenu";
import { saveCsvFileDialog } from "../fileBridge";
import { APP_LOCALE } from "../locale";
import "./TablePopup.css";

type CellType = "number" | "string" | "date" | "logical"; // "date" edits as its serial (number-ish); "logical" as TRUE/FALSE

// The column-type switcher cycles through these in order; glyph + name label the button.
const COLTYPE_ORDER: CellType[] = ["number", "string", "date", "logical"];
const COLTYPE_GLYPH: Record<CellType, string> = { number: "#", string: "T", date: "D", logical: "B" };
const COLTYPE_NAME: Record<CellType, string> = { number: "Number", string: "Text", date: "Date", logical: "Boolean" };
// Text-entry columns (free text + logical TRUE/FALSE); number + date edit as numeric serials.
function isTextType(t: CellType): boolean { return t === "string" || t === "logical"; }

// ── grid <-> data ────────────────────────────────────────────────────────────
// The editor holds cells as strings (so a half-typed "-" or "" is allowed mid-
// edit). `columnTypes` (Frame popups) overrides `cellType` per column, so a frame
// can mix number and text columns; without it every column uses cellType.
function typeAt(j: number, cellType: CellType, columnTypes?: CellType[]): CellType {
  return columnTypes?.[j] ?? cellType;
}
function toGrid(data: CellValue[][], cellType: CellType, columnTypes?: CellType[]): string[][] {
  const cols = data.reduce((m, r) => Math.max(m, r.length), 0);
  return data.map((row) =>
    Array.from({ length: cols }, (_, j) => {
      const v = row[j];
      if (v === undefined || v === null || v === "") return "";
      // A list/matrix may now carry logicals and per-cell errors; render those
      // directly rather than feed a non-number to formatScalar (false.toFixed() /
      // err.toFixed() throws → blacked-out app).
      if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
      if (isSolError(v)) return v.code;
      // A dimensioned cell (a list carrying UnitCells — from a pin / cable
      // inspector, which pass the raw value) renders "magnitude unit" in-cell,
      // resolving its display unit ("5 km", "5 m/s"). formatScalar would NaN it.
      if (isUnitCell(v)) return formatListCell(v, formatScalar);
      // Text + logical pass through as-is (a logical cell already arrives as
      // "TRUE"/"FALSE" text); number + date serials format numerically.
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
// A blank cell stays blank (it's a missing/null value, NOT 0 — the CSV must match
// the null-preserving save path; coercing to "0" here was the pre-null behavior).
// Text keeps its value verbatim (incl. spaces); numeric/date/logical are trimmed.
function cell(c: string, cellType: CellType): string {
  if (cellType === "string") return c;
  return c.trim();
}
// CSV-quote a text cell only when it would otherwise be ambiguous (comma, quote,
// or newline) — doubling embedded quotes, per RFC 4180. Numbers never need it.
// With `escapeFormulas` (read-only popups — the export path), a text cell whose
// first char is a formula trigger (= + - @, tab, CR) gets a leading apostrophe
// so pasting into Excel/Sheets can't execute it (CSV/formula injection, audit
// finding 39) — genuine numbers ("-5") are left alone. Editable grids skip it:
// their CSV view must round-trip the user's own text exactly.
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
// A 1D list is a single row here; copy it as one ", "-separated line so it matches
// the node's list result box exactly (toCSV would use a bare "," without spaces).
function listToText(grid: string[][], cellType: CellType): string {
  return grid.flat().map((c) => cell(c, cellType)).join(", ");
}
// GitHub-flavoured markdown table for "Copy as Markdown". A list becomes a
// one-column table (each value a row); a table/frame uses its headers (or Col N)
// and every row. Pipes/newlines in a cell are escaped so the table stays intact.
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
// Parse the CSV-view text back into a raw string grid (cells split on commas).
// Blank lines are KEPT as blank rows wherever they sit — leading, interior,
// trailing — the editors never coerce the Source (author 2026-07-16); a blank
// row is a row of missing cells, and dropping it here deleted it on save. Only
// the final newline TERMINATOR's phantom row drops (parseCsvRows handles it).
// Cells stay strings — fromGrid coerces on save.
function parseCSV(text: string): string[][] {
  return parseCsvRows(text, { keepBlankLines: true }).map((row) => row.map((c) => c.trim()));
}

// Spreadsheet column labels: A, B, … Z, AA, AB, …
function colLabel(i: number): string {
  let s = "";
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

/**
 * A barebones, themed spreadsheet-style grid editor shown as a modal. Reusable:
 * any caller opens it via tablePopup.open({ title, data, … }). With `onSave` it's
 * an editable numeric matrix (Table Input → number[][]). With `onSaveFrame` +
 * `editableHeaders` it's a Frame editor: editable column names, a per-column
 * number/text toggle, and Save hands back typed columns. Without either it's a
 * read-only viewer. Mounted once in App.
 */
export function TablePopup() {
  const state = useSyncExternalStore(tablePopup.subscribe, tablePopup.get);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);

  const [grid, setGrid] = useState<string[][]>([]);
  // Editable column names + per-column types (frame editor). Kept aligned with the
  // grid's columns; unused when the popup isn't in frame mode.
  const [headerNames, setHeaderNames] = useState<string[]>([]);
  const [columnTypes, setColumnTypes] = useState<CellType[]>([]);
  // Grid vs CSV view. CSV keeps its own text buffer so mid-typing isn't reshaped
  // by cell-coercion; when editable it parses back into the canonical grid.
  const [view, setView] = useState<"grid" | "csv">("grid");
  const [csvText, setCsvText] = useState("");
  // Display mode for the Formatted/Source toggle. SOURCE = the raw text (a Frame
  // Input's literal cells, or a date column's raw serials); FORMATTED = the derived
  // render (TRUE/FALSE, formatted dates, units). For a literal-source editor BOTH
  // modes edit the same raw truth (author 2026-07-16): Source edits it verbatim;
  // Formatted shows the derived render, swaps to the raw text while a cell is
  // focused, and re-renders formatted on blur. A read-only date view just toggles
  // serial vs date string.
  const [displayMode, setDisplayMode] = useState<"formatted" | "source">("formatted");
  // The cell being edited IN FORMATTED MODE + its draft. The draft lives in a ref
  // (state only marks the cell + forces renders) so Escape can reset it and blur
  // synchronously without committing a stale closure's text.
  const [editCell, setEditCell] = useState<{ r: number; c: number } | null>(null);
  const editDraft = useRef("");
  const [, bumpDraft] = useState(0);
  // DISPLAY-ONLY list orientation: a 1-D list is stored as one ROW (its value is the
  // flat, comma-separated list, unchanged). This just renders it down a COLUMN — one
  // value per line, nicer to read for a long list — without touching the value: copy /
  // CSV / Markdown all still flatten to the same list. Sticky within a session (not
  // reset on reseed), default horizontal.
  const [listVertical, setListVertical] = useState(false);
  // Per-column display format + unit (the FC controls row, read-only frames /
  // matrices). Index by column; a "matrix" popup uses index 0 for the whole grid.
  // Display-only: re-renders the on-screen grid, never the value or Copy/CSV.
  const [colFmt, setColFmt] = useState<FormatAnnotation[]>([]);
  const initedFor = useRef<TablePopupState | null>(null);

  // (Re)seed whenever a different popup opens.
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
    // Seed the FC controls row: a date column defaults to the date style, a number
    // column to Auto; the unit dropdown seeds from the column's locked unit. A
    // PERSISTED per-column format (frameFormatStore, keyed by node+column name) wins
    // over the default, so a saved format reopens as it was set.
    const fmtNodeId = state.pinNodeId;
    const seedFormat = (colName: string | undefined, dflt: FormatAnnotation): FormatAnnotation => {
      const saved = fmtNodeId && colName ? frameFormatStore.get(fmtNodeId, colName) : undefined;
      if (!saved) return dflt;
      // A saved format that's cross-type (a date style stuck on a now-number column,
      // or vice versa, after a type switch) resets to the type default so the dropdown
      // isn't stuck on a mismatched value; other fields carry over.
      const fmt = isDateStyle(saved.format) === isDateStyle(dflt.format) ? saved.format : dflt.format;
      return { ...saved, format: fmt, unit: dflt.unit };
    };
    if (state.formatControls === "matrix") {
      // A matrix has no column names — one whole-sheet format under a fixed key.
      // Seed the unit from the matrix's homogeneous tag (D20) so a taggable source
      // opens on its current unit.
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
    // Everything opens FORMATTED (Source toggle off) — you see the derived render
    // (formatted numbers/dates, applied units) first; both modes edit (a focused
    // formatted cell shows its raw text). The format dropdown stays visible in both
    // modes; Source just stops it from RENDERING (you're looking at raw text).
    setDisplayMode("formatted");
    setEditCell(null);
  }, [state]);

  if (!state) return null;
  const cellType: CellType = state.cellType ?? "number";
  // Editable when a numeric matrix save (Table Input) or a frame save is wired.
  const editable = (!!state.onSave && cellType === "number") || !!state.onSaveFrame || !!state.onSaveSource || !!state.onSaveRaw;
  // Literal-source editor (Frame Input / Table Input): the grid holds RAW text, never coerced.
  const literalSource = !!state.onSaveSource || !!state.onSaveRaw;
  // Formatted view of a literal source: derived render, but still EDITABLE — a
  // focused cell swaps to its raw text; blur commits and re-renders formatted.
  const formattedPreview = literalSource && displayMode === "formatted";
  const editableHeaders = editable && !!state.editableHeaders;
  const colTypeAt = (c: number): CellType => columnTypes[c] ?? cellType;
  const rows = grid.length;
  const cols = grid.reduce((m, r) => Math.max(m, r.length), 0);

  // Cap RENDERED rows: a popup over a 250k-row frame would put ~2M cells in the DOM
  // and kill the renderer. `grid` stays the full edit/save truth (edits to the shown
  // rows still land by index, rows beyond are preserved); only the visible grid is
  // sliced, with a notice below. (The chip count already shows the true total.)
  const MAX_VISIBLE_ROWS = 1000;
  const rowsTruncated = rows > MAX_VISIBLE_ROWS;
  const shownGrid = rowsTruncated ? grid.slice(0, MAX_VISIBLE_ROWS) : grid;

  const hasDateCols = state.columnTypes?.some(t => t === "date") || state.cellType === "date";
  // A frame popup carries per-column types; a plain Table/list does not.
  const isFramePopup = !!state.columnTypes;
  // Show the Formatted/Source toggle on EVERY frame popup (and the literal-source
  // editor) — author wants it always present, not column-dependent. (Plain
  // number/text lists with no date column keep no toggle: there's nothing to swap.)
  const showFmtToggle = literalSource || (!editable && (isFramePopup || hasDateCols));
  // Display-only grid. `grid` (raw text) is ALWAYS the edit/save truth; this only
  // changes what's SHOWN. Literal source + Formatted → derive each cell. Read-only
  // frame → Formatted formats dates (booleans already TRUE/FALSE); Source shows the
  // INPUTTED text (state.sourceCells) when the frame carries it, else the underlying
  // raw form (a date serial, a logical's 1/0).
  const displayGrid = formattedPreview
    ? shownGrid.map((row) => row.map((raw, c) => {
        const type = colTypeAt(c);
        const f = formatFrameCell(type, coerceFrameCell(type, raw ?? ""));
        return f == null ? "" : String(f);
      }))
    : (!editable && (isFramePopup || hasDateCols))
      ? shownGrid.map((row, r) => row.map((cell, c) => {
          const type = colTypeAt(c);
          if (displayMode === "formatted") {
            if (type === "date") {
              const n = Number(cell);
              return Number.isFinite(n) ? formatDateSerial(n, DEFAULT_DATE_FORMAT) : cell;
            }
            return cell;
          }
          // Source: the inputted text verbatim if we have it; else the underlying form.
          const src = state.sourceCells?.[r]?.[c];
          if (src != null) return src;
          if (type === "logical") return cell === "TRUE" ? "1" : cell === "FALSE" ? "0" : cell;
          return cell;
        }))
      : shownGrid;

  // ── FC controls row (read-only frames / matrices) ──────────────────────────
  // A format+unit controls row between the header and the body re-renders the
  // ON-SCREEN grid only — it converts a column's base-SI values into the chosen
  // unit and applies the number format. `displayGrid` / Copy / CSV stay the raw
  // value (display-only, like the list Row/Column toggle).
  // The format+unit controls row shows on any frame/matrix popup — read-only
  // derived (format, display-only) and editable sources alike (Frame Input, Table
  // Input; a taggable source also gets the unit dropdown).
  const showFmtControls = !!state.formatControls && view === "grid" && !state.list;
  // In-cell convert+format render: read-only grids directly, and an editable source
  // only in its FORMATTED preview (its Source view stays raw text you edit). Never
  // in-cell for the unit — that stays a tag / dropdown.
  const formatRenderActive = showFmtControls && (!editable || formattedPreview);
  function annFor(c: number): FormatAnnotation {
    const idx = state?.formatControls === "matrix" ? 0 : c;
    return colFmt[idx] ?? { format: "auto", unit: "none" };
  }
  // A read-only DERIVED frame has no unit dropdown, so its cells are converted into
  // the column unit silently — surface that unit in the header so the numbers aren't
  // ambiguous ("Distance (km)"). Taggable sources show it in the dropdown instead.
  function colHeaderLabel(c: number): string {
    // The unit now shows in the format row below the header (an editable picker on a
    // taggable source, a locked one on a derived column — the FC's flow language), so
    // the header is just the column name.
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
  // The store key for a column's persisted format: the DERIVED column name (matches
  // what FrameDisplay reads), or "*" for a whole-matrix format.
  function colFmtKey(c: number): string | undefined {
    return state?.formatControls === "matrix" ? "*" : state?.headers?.[c];
  }
  // A format change persists immediately (like the FC), keyed by node + column, so
  // it survives close/reopen and save. Falls back to local-only when there's no host
  // node. The UNIT dropdown does NOT go here — a column's unit is its value's, saved
  // on the source column.
  function persistColFmt(c: number, patch: Partial<FormatAnnotation>) {
    const idx = state?.formatControls === "matrix" ? 0 : c;
    setColFmtAt(idx, patch);
    const nodeId = state?.pinNodeId;
    const col = colFmtKey(c);
    if (nodeId && col) frameFormatStore.set(nodeId, col, { ...annFor(c), ...patch, unit: "none" });
  }
  // Render one cell through its column's format + unit (base-SI → display unit when
  // commensurable; the unit symbol lives in the dropdown/header, not the cell). The
  // input is a read-only frame's typed value (a number) OR an editable source's raw
  // text (coerced first), so this works for both surfaces.
  function controlledCell(raw: CellValue, c: number): string {
    if (raw === null || raw === undefined || raw === "") return "";
    if (isSolError(raw)) return raw.code;
    const type = colTypeAt(c);
    const ann = annFor(c);
    // Logical column: the cell may be a real boolean, or "TRUE"/"FALSE"/"1"/"0" text
    // (a frame grid pre-stringifies; a raw source keeps the typed text). Coerce, then
    // render via the chosen show-as style (TRUE/FALSE · 1/0 · Yes/No · ✓/✗).
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
      // A frame column stores the AS-TYPED magnitude (5 for a km column) — the value
      // is already in its display unit, so just apply the number format (no unit
      // conversion; the unit is shown in the header / dropdown, not the cell). A stale
      // DATE format left over from a type switch (number→date→number) must not turn a
      // number into a date — ignore it.
      const fmt: FormatStyleId = isDateStyle(ann.format) ? "auto" : ann.format;
      return formatNumberWithAnnotation(v, { ...ann, format: fmt, unit: "none" });
    }
    return String(v);
  }

  // A vertical LIST is a pure render transpose of the display grid (the single row
  // becomes N one-cell rows). `grid`/`displayGrid` stay the 1×N truth, so copy / CSV /
  // save are untouched; only the rendered <table> changes. Read-only (lists aren't
  // editable in the popup), so no edit-index remap is needed.
  const vertical = !!state.list && listVertical;
  const listLen = displayGrid[0]?.length ?? 0;
  const listTruncated = vertical && listLen > MAX_VISIBLE_ROWS; // cap rows like a tall table
  // The on-screen grid: FC-controlled render when active, else the display grid that
  // also feeds Copy/CSV. Read-only frames render from the typed values (state.data);
  // an editable source's Formatted preview renders from its EDITED raw text (grid).
  // (formatRenderActive ⇒ not a list, so vertical is false here.)
  const controlledSrc: CellValue[][] = editable ? shownGrid : state.data;
  const onScreenGrid: string[][] = formatRenderActive
    ? controlledSrc.slice(0, MAX_VISIBLE_ROWS).map((row) =>
        Array.from({ length: cols }, (_, c) => controlledCell(row[c], c)))
    : displayGrid;
  const viewGrid = vertical
    ? (displayGrid[0] ?? []).slice(0, MAX_VISIBLE_ROWS).map((v) => [v])
    : onScreenGrid;
  const viewCols = vertical ? 1 : cols;

  // Per-column min width from CONTENT. The cells are <input>s, which contribute
  // NO intrinsic width — columns never widen on their own, so a forced-scientific
  // value ("1.6331e+16", 10ch) clipped in the 72px default column. The grid is
  // mono (Atkinson Hyperlegible Mono, advance 27/42 em → 13px × 0.6429 ≈ 8.36px
  // per char — measured from the shipped .fnt metrics), so the exact width is
  // maxLen × advance + the input's 16px padding. Only columns needing MORE than
  // the CSS 72px floor get an inline min-width; a 200px cap keeps a pathological
  // cell from stretching the grid (mono columns only — text columns are sans).
  // Plain computation, NOT a hook: this sits below the `if (!state) return null`
  // guard, so a hook here changes the hook count when the popup opens (the exact
  // React violation that black-screened the app). The visible grid is capped at
  // MAX_VISIBLE_ROWS, so a per-render scan is cheap.
  const MONO_CH_PX = 13 * (27 / 42);
  const colMinWidths: Array<number | undefined> = [];
  for (let c = 0; c < viewCols; c++) {
    const colType = vertical ? cellType : typeAt(c, cellType, state.columnTypes);
    if (isTextType(colType)) { colMinWidths.push(undefined); continue; }
    let m = 0;
    for (const row of viewGrid) m = Math.max(m, (row[c] ?? "").length);
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
      next[c] = COLTYPE_ORDER[(i + 1) % COLTYPE_ORDER.length]; // # → T → D → B → #
      return next;
    });
  }
  function addRow() {
    setGrid((g) => [...g, Array.from({ length: Math.max(1, cols) }, () => "")]);
  }
  function addCol() {
    setGrid((g) => (g.length === 0 ? [[""]] : g.map((row) => [...row, ""])));
    setHeaderNames((h) => [...h, ""]);
    setColumnTypes((t) => [...t, "number"]);
  }
  function removeRow() {
    setGrid((g) => (g.length > 1 ? g.slice(0, -1) : g));
  }
  function removeCol() {
    if (cols <= 1) return;
    setGrid((g) => g.map((row) => row.slice(0, -1)));
    setHeaderNames((h) => h.slice(0, -1));
    setColumnTypes((t) => t.slice(0, -1));
  }

  // Typed columns from the current grid (frame save). Blank → null; a numeric
  // column coerces each cell (invalid → NaN); a text column keeps it verbatim.
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
        // number AND date store a numeric value (date = serial); the grid's edit
        // truth for a date is its serial, so parse numerically, falling back to the
        // date parser for an ISO string a user typed.
        const n = Number(s);
        if (Number.isFinite(n)) return n;
        if (type === "date") { const d = parseDateToSerial(s); return Number.isFinite(d) ? d : NaN; }
        return NaN;
      });
      return { name: (headerNames[c] ?? "").trim(), type, values };
    });
  }

  // The canonical text form of the current grid (a list is one ", " line; a table
  // is row-per-line CSV; a frame prepends a header line). Used for copy and the CSV view.
  // In formatted date mode, copy/CSV reflects the displayed strings, not raw serials.
  const headers = editableHeaders ? headerNames : state.headers;
  // Read-only popups neutralize formula-injection prefixes on export (finding 39);
  // editable ones must round-trip the typed text exactly.
  const bodyCSV = toCSV(displayGrid, cellType, columnTypes, !editable);
  // A frame's CSV view prepends a header line (below); a plain table/list doesn't.
  const hasHeaderLine = !state.list && !!(headers && headers.length);
  const asText = state.list
    ? listToText(displayGrid, cellType)
    : hasHeaderLine
      ? `${headers!.map((h) => csvField(h, "string", !editable)).join(",")}\n${bodyCSV}`
      : bodyCSV;

  function showCSV() {
    setCsvText(asText);
    setView("csv");
  }
  function onCsvChange(v: string) {
    setCsvText(v);
    if (!editable || formattedPreview) return;
    const rows = parseCSV(v);
    // Symmetric with `asText`: when the CSV view carries a header line, parse it
    // back OUT into headerNames instead of dumping it into the data grid — else the
    // header gets duplicated into row 0 of the data (the round-trip bug).
    if (hasHeaderLine) {
      setHeaderNames(rows[0] ?? []);
      setGrid(rows.slice(1));
    } else {
      setGrid(rows);
    }
  }

  function copy() {
    const text = view === "csv" ? csvText : asText;
    void copyText(text);
  }
  function copyMarkdown() {
    void copyText(toMarkdown(displayGrid, cellType, columnTypes, headers, !!state?.list));
  }
  function exportCsv() {
    const base = (state?.title || "table").replace(/[^\w.-]+/g, "_") || "table";
    void saveCsvFileDialog(`${base}.csv`, asText);
  }
  // Raw source columns from the current grid — cells kept verbatim (the literal
  // source; coercion to typed values happens downstream in deriveFrame).
  function buildSourceColumns(): FrameSourceColumn[] {
    return Array.from({ length: cols }, (_, c) => {
      // A unit-taggable source persists the per-column unit choice (number columns
      // only) so it rides the value downstream via deriveFrame.
      const u = state?.unitTaggable && (columnTypes[c] ?? "number") === "number" ? annFor(c).unit : undefined;
      return {
        name: (headerNames[c] ?? "").trim(),
        type: columnTypes[c] ?? "number",
        cells: grid.map((row) => row[c] ?? ""),
        ...(u && u !== "none" ? { unit: u } : {}),
      };
    });
  }
  function save() {
    if (state?.onSaveRaw) state.onSaveRaw(grid.map((row) => [...row]));
    else if (state?.onSaveSource) state.onSaveSource(buildSourceColumns());
    else if (state?.onSaveFrame) state.onSaveFrame(buildFrameColumns());
    else state?.onSave?.(fromGrid(grid), editableHeaders ? headerNames : state.headers);
    tablePopup.close();
  }

  const grouped = !!state.groupColor;
  const cardStyle: CSSProperties = {};
  const cardVars = cardStyle as Record<string, string>;
  if (state.accent) cardVars["--node-accent"] = state.accent;
  if (state.groupColor) cardVars["--group-color"] = state.groupColor;
  if (state.groupColorDark) cardVars["--group-color-dark"] = state.groupColorDark;

  return (
    <PopupShell
      title={state.title}
      onClose={() => tablePopup.close()}
      cardClassName="table-popup"
      grouped={grouped}
      cardStyle={cardStyle}
      headerExtra={<span className="table-popup__dims">{vertical ? `${listLen}×1` : `${rows}×${cols}`}{rowsTruncated || listTruncated ? ` · first ${MAX_VISIBLE_ROWS.toLocaleString(APP_LOCALE)}` : ""}</span>}
      pinNodeId={state.pinNodeId}
      headerActions={
        <PopupOverflowMenu
          items={[
            { label: state.list ? "Copy" : "Copy CSV", onClick: copy },
            { label: "Copy as Markdown", onClick: copyMarkdown },
            { label: "Export CSV…", onClick: exportCsv },
          ]}
        />
      }
    >
      {view === "grid" && showFmtControls && state.formatControls === "matrix" && (
        // A matrix is homogeneous — one format (+ unit, when taggable) pair for the
        // whole sheet, so it sits ABOVE the grid (between the popup header and the
        // table), not inside it as a column row.
        <div className="table-popup__matrix-fmt">
          {cellType === "logical" ? (
            <LogicalStyleSelect className="table-popup__fmtselect" value={annFor(0).logicalStyle} onChange={(s) => persistColFmt(0, { logicalStyle: s })} />
          ) : cellType === "date" ? (
            <DateStyleSelect className="table-popup__fmtselect" value={annFor(0).format} onChange={(f) => persistColFmt(0, { format: f })} />
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
            // Derived matrix: the unit is INHERITED from the source, so it's LOCKED
            // here — a disabled picker showing the unit the value already carries.
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
        <div className="table-popup__grid-scroll">
          <table className="table-popup__grid">
            <thead>
              <tr>
                <th className="table-popup__corner" />
                {Array.from({ length: viewCols }, (_, c) => (
                  <th
                    key={c}
                    className={headers && !vertical ? "table-popup__colhead table-popup__colhead--name" : "table-popup__colhead"}
                    title={vertical ? undefined : headers?.[c]}
                  >
                    {vertical ? "" : editableHeaders ? (
                      <div className="table-popup__colhead-edit">
                        <button
                          type="button"
                          className="table-popup__coltype"
                          title={`Column type: ${COLTYPE_NAME[colTypeAt(c)]}. Click to cycle Number / Text / Date / Boolean.`}
                          onClick={() => toggleColumnType(c)}
                        >
                          {COLTYPE_GLYPH[colTypeAt(c)]}
                        </button>
                        <input
                          className="table-popup__input table-popup__input--text table-popup__colhead-input"
                          value={headerNames[c] ?? ""}
                          placeholder={colLabel(c)}
                          spellCheck={false}
                          onChange={(e) => setHeaderName(c, e.target.value)}
                        />
                      </div>
                    ) : (
                      colHeaderLabel(c)
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
                    // FORMAT dropdown on every column (display-only, renders in-cell);
                    // a UNIT dropdown stacked below on a taggable source (Frame Input),
                    // persisted on Save. Date columns get a date-style select, no unit.
                    return (
                      <td key={c} className="table-popup__fmtcell">
                        {type === "date" ? (
                          <DateStyleSelect className="table-popup__fmtselect" value={annFor(c).format} onChange={(f) => persistColFmt(c, { format: f })} />
                        ) : type === "logical" ? (
                          <LogicalStyleSelect className="table-popup__fmtselect" value={annFor(c).logicalStyle} onChange={(s) => persistColFmt(c, { logicalStyle: s })} />
                        ) : type === "number" ? (
                          <div className="table-popup__fmtstack">
                            <FormatStyleSelect className="table-popup__fmtselect" value={annFor(c).format} onChange={(f) => persistColFmt(c, { format: f })} />
                            {state.unitTaggable ? (
                              <UnitSelect className="table-popup__fmtselect" value={annFor(c).unit} onChange={(u) => setColFmtAt(c, { unit: u })} />
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
              {viewGrid.map((row, r) => (
                <tr key={r}>
                  <th className="table-popup__rowhead">{r + 1}</th>
                  {Array.from({ length: viewCols }, (_, c) => {
                    // A vertical list has one data column but its type is the list's,
                    // not column `c` (which is always 0 there).
                    const type = vertical ? cellType : colTypeAt(c);
                    // In a NUMERIC column the shown string "NaN" can only be a real
                    // NaN (dirty data) — a text column is excluded, and the editable
                    // raw view shows the source token ("oops"), never "NaN".
                    const nan = !isTextType(type) && (row[c] ?? "") === "NaN";
                    // Formatted mode edits through a focus draft: the cell shows the
                    // derived render at rest, swaps to the RAW text on focus (the edit
                    // truth, like Excel's formula-bar-in-cell), and commits on blur —
                    // where it re-renders formatted (units, dates, number formats).
                    const fmtEdit = formattedPreview && editable && !vertical;
                    const editingHere = !!editCell && editCell.r === r && editCell.c === c;
                    return (
                    <td
                      key={c}
                      className={`table-popup__cell${nan ? " table-popup__cell--nan" : ""}`}
                      style={colMinWidths[c] !== undefined ? { minWidth: colMinWidths[c] } : undefined}
                      title={nan ? "Not a number: an undefined value in the data" : undefined}
                    >
                      <input
                        className={isTextType(type) ? "table-popup__input table-popup__input--text" : "table-popup__input"}
                        value={editingHere ? editDraft.current : row[c] ?? ""}
                        readOnly={!editable || (formattedPreview && !fmtEdit)}
                        inputMode={isTextType(type) ? "text" : "decimal"}
                        spellCheck={false}
                        onFocus={fmtEdit ? () => { editDraft.current = grid[r]?.[c] ?? ""; setEditCell({ r, c }); } : undefined}
                        onChange={(e) => {
                          if (fmtEdit) { editDraft.current = e.target.value; bumpDraft((x) => x + 1); }
                          else setCell(r, c, e.target.value);
                        }}
                        onBlur={fmtEdit ? () => { if (editingHere) { setCell(r, c, editDraft.current); setEditCell(null); } } : undefined}
                        onKeyDown={fmtEdit ? (e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          else if (e.key === "Escape") { editDraft.current = grid[r]?.[c] ?? ""; e.currentTarget.blur(); }
                        } : undefined}
                      />
                    </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <textarea
          className="table-popup__csv"
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
              title="Show the list down a column — one value per line (display only; the value is unchanged)"
            >Column</button>
          </div>
        )}
        {showFmtToggle && (
          <label
            className="table-popup__source-check"
            title={literalSource
              ? "Checked: show & edit exactly what you typed. Unchecked: the derived render, e.g. TRUE/FALSE and formatted dates."
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
