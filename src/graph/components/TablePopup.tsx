import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { copyText } from "../clipboard";
import { tablePopup, type TablePopupState, type Cell as CellValue, type FramePopupColumn } from "../tablePopupStore";
import { appThemeStore } from "../appTheme";
import { formatScalar } from "./format";
import { parseCsvRows } from "../csv";
import { isSolError } from "../errorValue";
import { formatDateSerial, parseDateToSerial, DEFAULT_DATE_FORMAT } from "../nodes/date";
import { coerceFrameCell, formatFrameCell, type FrameSourceColumn } from "../frame";
import "./popupChrome.css";
import { CloseIcon } from "./CloseIcon";
import { PopupPinButton, PopupGoToButton } from "./PopupPinButton";
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
// Parse the CSV-view text back into a raw string grid (one row per non-blank line,
// cells split on commas). Cells stay strings — fromGrid coerces on save.
function parseCSV(text: string): string[][] {
  return parseCsvRows(text).map((row) => row.map((c) => c.trim()));
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
  // render (TRUE/FALSE, formatted dates). For a literal-source editor, Source is the
  // editable truth and Formatted is a read-only preview; for a read-only date view it
  // just toggles serial vs date string.
  const [displayMode, setDisplayMode] = useState<"formatted" | "source">("formatted");
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
    setView("grid");
    // A literal-source editor opens in SOURCE so you can edit raw text immediately;
    // a read-only view opens FORMATTED (nice dates).
    setDisplayMode(state.onSaveSource || state.onSaveRaw ? "source" : "formatted");
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); tablePopup.close(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [state]);

  if (!state) return null;
  const cellType: CellType = state.cellType ?? "number";
  // Editable when a numeric matrix save (Table Input) or a frame save is wired.
  const editable = (!!state.onSave && cellType === "number") || !!state.onSaveFrame || !!state.onSaveSource || !!state.onSaveRaw;
  // Literal-source editor (Frame Input / Table Input): the grid holds RAW text, never coerced.
  const literalSource = !!state.onSaveSource || !!state.onSaveRaw;
  // Formatted PREVIEW (derived render, read-only) — only meaningful for a literal source.
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
    return Array.from({ length: cols }, (_, c) => ({
      name: (headerNames[c] ?? "").trim(),
      type: columnTypes[c] ?? "number",
      cells: grid.map((row) => row[c] ?? ""),
    }));
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
    <div className="sol-popup-overlay" onPointerDown={() => tablePopup.close()}>
      <div
        className={`sol-popup table-popup${grouped ? " sol-popup--grouped" : ""}`}
        style={cardStyle}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="sol-popup__header">
          <div className="sol-popup__title">{state.title}</div>
          <span className="table-popup__dims">{rows}×{cols}{rowsTruncated ? ` · first ${MAX_VISIBLE_ROWS.toLocaleString(APP_LOCALE)}` : ""}</span>
          {state.pinNodeId && <PopupGoToButton nodeId={state.pinNodeId} onClose={() => tablePopup.close()} />}
          {state.pinNodeId && <PopupPinButton nodeId={state.pinNodeId} />}
          <PopupOverflowMenu
            items={[
              { label: state.list ? "Copy" : "Copy CSV", onClick: copy },
              { label: "Copy as Markdown", onClick: copyMarkdown },
              { label: "Export CSV…", onClick: exportCsv },
            ]}
          />
          <button className="sol-popup__close" onClick={() => tablePopup.close()} aria-label="Close"><CloseIcon size={16} /></button>
        </div>

        {view === "grid" ? (
          <div className="table-popup__grid-scroll">
            <table className="table-popup__grid">
              <thead>
                <tr>
                  <th className="table-popup__corner" />
                  {Array.from({ length: cols }, (_, c) => (
                    <th
                      key={c}
                      className={headers ? "table-popup__colhead table-popup__colhead--name" : "table-popup__colhead"}
                      title={headers?.[c]}
                    >
                      {editableHeaders ? (
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
                        headers?.[c] ?? colLabel(c)
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayGrid.map((row, r) => (
                  <tr key={r}>
                    <th className="table-popup__rowhead">{r + 1}</th>
                    {Array.from({ length: cols }, (_, c) => {
                      // In a NUMERIC column the shown string "NaN" can only be a real
                      // NaN (dirty data) — a text column is excluded, and the editable
                      // raw view shows the source token ("oops"), never "NaN".
                      const nan = !isTextType(colTypeAt(c)) && (row[c] ?? "") === "NaN";
                      return (
                      <td key={c} className={`table-popup__cell${nan ? " table-popup__cell--nan" : ""}`} title={nan ? "Not a number: an undefined value in the data" : undefined}>
                        <input
                          className={isTextType(colTypeAt(c)) ? "table-popup__input table-popup__input--text" : "table-popup__input"}
                          value={row[c] ?? ""}
                          readOnly={!editable || formattedPreview}
                          inputMode={isTextType(colTypeAt(c)) ? "text" : "decimal"}
                          spellCheck={false}
                          onChange={(e) => setCell(r, c, e.target.value)}
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
          {editable && view === "grid" && !formattedPreview && (
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
      </div>
    </div>
  );
}
