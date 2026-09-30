// [[C58]] tableInputRawText, [[D41]] formatFlowsDownstream
import { neutralizeFormulaCell, csvField as csvText } from "../csvSafety";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { copyText } from "../clipboard";
import { tablePopup, getRecordCardsAction, type TablePopupState, type Cell as CellValue, type FramePopupColumn } from "../tablePopupStore";
import { appThemeStore } from "../appTheme";
import { formatScalar } from "./format";
import { parseCsvRows, joinCsvRows } from "../csv";
import { isSolError, ERROR_EXPLANATIONS } from "../errorValue";
import { formatDateSerial, parseDateToSerial, serialToJsDate, DEFAULT_DATE_FORMAT } from "../nodes/dateSerial";
import { coerceFrameCell, formatFrameCell, columnTypesAfterCsvEdit, makeHeaders, type FrameSourceColumn } from "../frame";
import { describeColumn, distinctColumnValues } from "../frameVerbs";
import { aggregate } from "../nodes/statsOps";
import { formatNumberWithAnnotation, isDateStyle, applyLogicalStyle, type FormatAnnotation, type FormatStyleId } from "../formatAnnotationStore";
import { isUnitCell } from "../unitValue";
import { decimalFromText } from "../valueKinds";
import { columnUnitLabel } from "../unitColumn";
import { frameFormatStore, MATRIX_FORMAT_KEY, columnFormatRow, type ColumnFormatRow } from "../frameFormatStore";
import { scheduleAutosave } from "../persistence";
import { processGraph } from "../process";
import { formatListCell } from "./valueDisplayFormat";
import { FormatStyleSelect, DateStyleSelect, UnitSelect, LogicalStyleSelect, TextCaseSelect, CustomPatternField } from "./fcControls";
import { CategoryChip } from "./CategoryChip";
import { categoryColorIndex } from "../categoryColor";
import { applyTextCase } from "../formatAnnotationStore";
import { PopupShell, popupCardVars } from "./PopupShell";
import { useFocusTrap } from "./useFocusTrap";
import "./confirmDialog.css";
import { settingsStore } from "../settingsStore";
import { gridKeyOf, nextCell } from "./gridKeyboard";
import { useColumnSort, sortedOrder, sortKeyOf, sortDirOf, SortButton } from "./columnSort";
import { ColumnFormatButton, ColumnExprField, HeaderHelpButton, COLTYPE_ORDER, COLTYPE_NAME } from "./columnHeadControls";
import { TypeIcon } from "./TypeIcon";
import { CellEditAffix } from "./CellEditAffix";
import { CsvEditor } from "./CsvEditor";
import { TableCards } from "./TableCards";
import { CellSuggest, type CellSuggestHandle } from "./CellSuggest";
import { parseRecordLayout, recordImageSrc, cellImageSrc } from "../recordLayout";
import { CellImage } from "./cubeCell";
import "./chartCards.css"; // .sol-record__img, for the Form's image cells
import { PopupOverflowMenu } from "./PopupOverflowMenu";
import { type FooterStat, type ColSummary, FOOTER_STAT_LABEL, STATS_BY_TYPE, footerStatFor, footerStatValue, formatFooterStat, statReadsAsCell } from "./tableFooterStats";
import { saveCsvFileDialog } from "../fileBridge";
import { APP_LOCALE } from "../locale";
import "./errorChip.css";
import "./TablePopup.css";
import { ChevronDownIcon } from "./Icons";
import { TableEditMenus, TableContextMenu, type EditAxis } from "./TableEditMenu";
import { insertAt, removeAt, shiftForInsert, shiftForRemove, remapKeys, insertGridCols, removeGridCols, pickIndex, type AxisSelection } from "../tableEdit";

type CellType = "number" | "string" | "date" | "logical";

function isTextType(t: CellType): boolean { return t === "string" || t === "logical"; }

// ── grid <-> data ────────────────────────────────────────────────────────────
function typeAt(j: number, cellType: CellType, columnTypes?: CellType[]): CellType {
  return columnTypes?.[j] ?? cellType;
}
function toGrid(data: CellValue[][], cellType: CellType, columnTypes?: CellType[]): string[][] {
  const cols = data.reduce((m, r) => Math.max(m, r.length), 0);
  return data.map((row) =>
    Array.from({ length: cols }, (_, j) => {
      const v = row[j];
      if (v === undefined || v === null || v === "") return "";
      // formatScalar throws on a non-number, so booleans, errors and unit cells go first.
      if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
      if (isSolError(v)) return v.code;
      if (isUnitCell(v)) return formatListCell(v, formatScalar);
      return isTextType(typeAt(j, cellType, columnTypes)) ? String(v) : formatScalar(v as number);
    }),
  );
}
function cell(c: string, cellType: CellType): string {
  if (cellType === "string") return c;
  return c.trim();
}
// Every column type is guarded: a mixed list typed by its first cell, or a unit cell's `-5 km`, is text in a numeric column.
function csvField(c: string, cellType: CellType, escapeFormulas = false): string {
  return csvText(cell(c, cellType), escapeFormulas);
}
function toCSV(grid: string[][], cellType: CellType, columnTypes?: CellType[], escapeFormulas = false): string {
  return joinCsvRows(grid.map((row) => row.map((c, j) => csvField(c, typeAt(j, cellType, columnTypes), escapeFormulas))));
}
function listToText(grid: string[][], cellType: CellType, escapeFormulas = false): string {
  return grid.flat().map((c) => (escapeFormulas ? neutralizeFormulaCell(cell(c, cellType)) : cell(c, cellType))).join(", ");
}
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
function parseCSV(text: string): string[][] {
  return parseCsvRows(text, { keepBlankLines: true }).map((row) => row.map((c) => c.trim()));
}

function dateCellToISO(raw: string): string {
  const t = raw.trim();
  if (t === "") return "";
  const n = decimalFromText(t);
  const serial = Number.isFinite(n) ? n : parseDateToSerial(t);
  return Number.isFinite(serial) && serial > 0 ? serialToJsDate(serial).toISOString().slice(0, 10) : "";
}

/** A list's items in the view's order: a vertical list sorts, a horizontal one keeps its order. */
export function listInViewOrder(line: string[], vertical: boolean, order: number[]): string[] {
  return vertical ? order.map((i) => line[i] ?? "") : line;
}

/** The cells a text edit suggests from: a list's items (its grid is one row), else column c. */
export function suggestionCells(grid: string[][], c: number, list: boolean): string[] {
  return list ? (grid[0] ?? []) : grid.map((r) => r[c]);
}

function colLabel(i: number): string {
  let s = "";
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

function typeDefaultAnn(st: TablePopupState, j: number): FormatAnnotation {
  const unit = st.columnUnits?.[st.formatControls === "matrix" ? 0 : j]?.display ?? "none";
  return { format: st.formatControls !== "matrix" && st.columnTypes?.[j] === "date" ? "date_dmy" : "auto", unit };
}

export function TablePopup() {
  const state = useSyncExternalStore(tablePopup.subscribe, tablePopup.get);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);

  const [grid, setGrid] = useState<string[][]>([]);
  const { sort, cycle: cycleSort, remap: remapSort, clear: clearSort, set: setSort } = useColumnSort(state);
  // Must stay aligned with the grid's columns.
  const [headerNames, setHeaderNames] = useState<string[]>([]);
  const [columnTypes, setColumnTypes] = useState<CellType[]>([]);
  // CSV keeps its own text buffer, so typing mid-edit isn't reshaped by cell coercion.
  const [view, setView] = useState<"grid" | "csv" | "form" | "cards">("grid");
  const [csvText, setCsvText] = useState("");
  const [csvError, setCsvError] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<"formatted" | "source">("formatted");
  // The draft is a ref, so Escape can reset it and blur synchronously without a stale closure.
  const [editCell, setEditCell] = useState<{ r: number; c: number } | null>(null);
  const distinctMemo = useRef<{ grid: unknown; c: number; values: string[] } | null>(null);
  const [formRow, setFormRow] = useState(0);

  const editDraft = useRef("");
  const [, bumpDraft] = useState(0);
  const gridRef = useRef<HTMLTableElement | null>(null);
  const [colStat, setColStat] = useState<Record<number, FooterStat>>({});
  const showSummary = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get("tablePopupSummary"));
  const frozen = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get("tablePopupFrozen"));
  const [listVertical, setListVertical] = useState(false);
  const [colFmt, setColFmt] = useState<FormatAnnotation[]>([]);
  const [colLocal, setColLocal] = useState<boolean[]>([]);
  const [colInherited, setColInherited] = useState<(FormatAnnotation | undefined)[]>([]);
  // undefined is a Data column; a string, even an empty one, is the column's formula.
  const [colExprs, setColExprs] = useState<(string | undefined)[]>([]);
  const committedExprs = useRef<(string | undefined)[]>([]);
  const suggestRef = useRef<CellSuggestHandle>(null);
  const headSuggestRef = useRef<CellSuggestHandle>(null);
  const [editHead, setEditHead] = useState<{ c: number; options: { name: string; types: CellType[] }[] } | null>(null);
  const [liveComputed, setLiveComputed] = useState<CellValue[][] | null>(null);
  const initedFor = useRef<TablePopupState | null>(null);
  const summaryCache = useRef<{ deps: unknown[]; value: ColSummary[] | null }>({ deps: [], value: null });
  const csvTypesFrom = useRef<number | null>(null);
  const cardsKey = useRef<{ deps: unknown[]; key: object }>({ deps: [], key: {} });
  // What Save would write, as of the last save or live commit; a close that differs asks first.
  const savedSnapshot = useRef("");
  // The column names the host outputs now, which key its column formats until the next save or live commit.
  const liveNames = useRef<(string | undefined)[]>([]);
  // Host names of deleted columns, whose formats go at the next save or live commit.
  const droppedNames = useRef<string[]>([]);
  const [sel, setSel] = useState<AxisSelection | null>(null);
  const [focusCell, setFocusCell] = useState<{ r: number; c: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; form?: boolean } | null>(null);
  const [askClose, setAskClose] = useState(false);

  useEffect(() => {
    if (!state) { initedFor.current = null; return; }
    if (initedFor.current === state) return;
    initedFor.current = state;
    const baseType = state.cellType ?? "number";
    const g = toGrid(state.data, baseType, state.columnTypes);
    setGrid(g);
    const ncols = g.reduce((m, r) => Math.max(m, r.length), 0);
    const names = Array.from({ length: ncols }, (_, j) => state.headers?.[j] ?? "");
    const types = Array.from({ length: ncols }, (_, j) => state.columnTypes?.[j] ?? baseType);
    const exprs = Array.from({ length: ncols }, (_, j) => state.sourceExprs?.[j]);
    setHeaderNames(names);
    liveNames.current = state.headers ? [...state.headers] : [];
    droppedNames.current = [];
    setSel(null);
    setFocusCell(null);
    setCtxMenu(null);
    setColumnTypes(types);
    setColExprs(exprs);
    committedExprs.current = exprs;
    savedSnapshot.current = editSnapshot(g, names, types, exprs);
    setAskClose(false);
    setLiveComputed(null);
    const fmtNodeId = state.pinNodeId;
    const localAt = (colName: string | undefined): FormatAnnotation | undefined =>
      fmtNodeId && colName ? frameFormatStore.get(fmtNodeId, colName) : undefined;
    const seedFormat = (saved: FormatAnnotation | undefined, dflt: FormatAnnotation): FormatAnnotation => {
      if (!saved) return dflt;
      const fmt = isDateStyle(saved.format) === isDateStyle(dflt.format) ? saved.format : dflt.format;
      return { ...saved, format: fmt, unit: dflt.unit };
    };
    if (state.formatControls === "matrix") {
      const local = localAt(MATRIX_FORMAT_KEY);
      setColFmt([seedFormat(local, typeDefaultAnn(state, 0))]);
      setColLocal([!!local]);
      setColInherited([undefined]);
    } else if (state.formatControls === "columns") {
      const locals = Array.from({ length: ncols }, (_, j) => localAt(state.headers?.[j]));
      const inherited = locals.map((l, j) => (l ? undefined : state.columnFormats?.[j]));
      setColFmt(Array.from({ length: ncols }, (_, j) =>
        seedFormat(locals[j] ?? inherited[j], typeDefaultAnn(state, j))));
      setColLocal(locals.map((l) => !!l));
      setColInherited(inherited);
    } else {
      setColFmt([]);
      setColLocal([]);
      setColInherited([]);
    }
    setView("grid");
    setDisplayMode("formatted");
    setEditCell(null);
    setFormRow(0);
  }, [state]);

  if (!state) return null;
  const cellType: CellType = state.cellType ?? "number";
  const editable = !!state.onSaveSource || !!state.onSaveRaw;
  const literalSource = !!state.onSaveSource || !!state.onSaveRaw;
  const formattedPreview = literalSource && displayMode === "formatted";
  const fxColumns = !!state.onSaveSource && !state.noFormulaColumns;
  const editableHeaders = editable && !!state.editableHeaders;
  const typesShown: CellType[] = view === "csv" && csvTypesFrom.current !== null
    ? columnTypesAfterCsvEdit(columnTypes, csvTypesFrom.current, grid)
    : columnTypes;
  const colTypeAt = (c: number): CellType => typesShown[c] ?? cellType;
  const rows = grid.length;
  const cols = grid.reduce((m, r) => Math.max(m, r.length), 0);

  const MAX_VISIBLE_ROWS = 1000;
  const rowsTruncated = rows > MAX_VISIBLE_ROWS;
  const computedVals = liveComputed ?? state.computedCells;
  const isComputedCol = (c: number) => colExprs[c] !== undefined;
  const hasComputed = !!computedVals && colExprs.some((e) => e !== undefined);
  const computedColSet = new Set(colExprs.flatMap((e, c) => (e !== undefined ? [c] : [])));
  const rawAt = (r: number, c: number): string => {
    if (!hasComputed || !isComputedCol(c)) return grid[r]?.[c] ?? "";
    const v = computedVals?.[r]?.[c];
    if (v == null) return "";
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    return isSolError(v) ? v.code : String(v);
  };
  const rawRow = (r: number): string[] =>
    hasComputed ? Array.from({ length: cols }, (_c, c) => rawAt(r, c)) : (grid[r] ?? []);

  const hasDateCols = state.columnTypes?.some(t => t === "date") || state.cellType === "date";
  const isFramePopup = !!state.columnTypes;
  // Every list popup has the Source switch, so a list reads the same wherever it opens.
  const showFmtToggle = literalSource || (!editable && (isFramePopup || hasDateCols || !!state.list));
  // `as`: "auto" follows the Source toggle at the type's default format (Copy, Export); "shown" is the grid's text with the FC picks (the CSV view); "source" is the raw text whatever the toggle says.
  const displayRowAt = (r: number, as: "auto" | "shown" | "source" = "auto"): string[] => {
    const row = rawRow(r);
    const mode = as === "auto" ? displayMode : as === "source" ? "source" : "formatted";
    if (as === "shown" && state.formatControls === "columns" && !state.list && (!editable || literalSource)) {
      const typed = controlledRowAt(r);
      return Array.from({ length: cols }, (_, c) => controlledCell(typed[c], c));
    }
    if (literalSource && mode === "formatted") {
      return row.map((raw, c) => {
        const type = colTypeAt(c);
        const f = formatFrameCell(type, coerceFrameCell(type, raw ?? ""));
        return f == null ? "" : String(f);
      });
    }
    if (!editable && (isFramePopup || hasDateCols || !!state.list)) {
      return row.map((cell, c) => {
        const type = colTypeAt(c);
        if (mode === "formatted") {
          if (type === "date") {
            const n = decimalFromText(cell);
            return Number.isFinite(n) ? formatDateSerial(n, DEFAULT_DATE_FORMAT) : cell;
          }
          return cell;
        }
        const src = state.sourceCells?.[r]?.[c];
        if (src != null) return src;
        const rawV = state.data[r]?.[c];
        if (typeof rawV === "number") return String(rawV);
        if (type === "logical") return cell === "TRUE" ? "1" : cell === "FALSE" ? "0" : cell;
        return cell;
      });
    }
    return row;
  };

  const showFmtControls = !!state.formatControls && view === "grid" && !state.list;
  const formatRenderActive = showFmtControls && (editable ? formattedPreview : displayMode === "formatted");
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
  // Must match the key FrameDisplay reads: the host's output column name, or MATRIX_FORMAT_KEY for a matrix.
  function colFmtKey(c: number): string | undefined {
    if (state?.formatControls === "matrix") return MATRIX_FORMAT_KEY;
    if (!editableHeaders) return state?.headers?.[c];
    return liveNames.current[c] ?? makeHeaders(headerNames, cols)[c];
  }
  function rekeyColFormats() {
    const nodeId = state?.pinNodeId;
    if (!nodeId || !editableHeaders || state?.formatControls !== "columns") return;
    const next = makeHeaders(headerNames, cols);
    frameFormatStore.rekey(nodeId, liveNames.current, next);
    for (const name of droppedNames.current) if (!next.includes(name)) frameFormatStore.delete(nodeId, name);
    droppedNames.current = [];
    liveNames.current = next;
  }
  function persistColFmt(c: number, patch: Partial<FormatAnnotation>) {
    const idx = state?.formatControls === "matrix" ? 0 : c;
    setColFmtAt(idx, patch);
    setColLocalAt(idx, true);
    const nodeId = state?.pinNodeId;
    const col = colFmtKey(c);
    if (!nodeId || !col) return;
    frameFormatStore.set(nodeId, col, { ...annFor(c), ...patch, unit: "none" });
    scheduleAutosave();
    void processGraph(nodeId);
  }
  function setColLocalAt(i: number, on: boolean) {
    setColLocal((l) => { const next = l.slice(); while (next.length <= i) next.push(false); next[i] = on; return next; });
  }
  function clearColFmt(c: number) {
    const idx = state?.formatControls === "matrix" ? 0 : c;
    const fallback = colInherited[idx] ?? typeDefaultAnn(state!, idx);
    setColFmt((f) => {
      const next = f.slice();
      while (next.length <= idx) next.push({ format: "auto", unit: "none" });
      next[idx] = { ...fallback, unit: next[idx].unit };
      return next;
    });
    setColLocalAt(idx, false);
    const nodeId = state?.pinNodeId;
    const col = colFmtKey(c);
    if (!nodeId || !col) return;
    frameFormatStore.delete(nodeId, col);
    scheduleAutosave();
    void processGraph(nodeId);
  }
  function fmtRow(c: number): ColumnFormatRow {
    const idx = state?.formatControls === "matrix" ? 0 : c;
    const type = state?.formatControls === "matrix" ? cellType : colTypeAt(c);
    return columnFormatRow(colLocal[idx] ? annFor(c) : undefined, colInherited[idx], type);
  }
  const fmtHint = (c: number) => {
    const { hint } = fmtRow(c);
    return hint ? <span className="table-popup__fmthint">{hint}</span> : null;
  };
  const fmtPattern = (c: number) => {
    const { pattern } = fmtRow(c);
    return pattern
      ? <CustomPatternField className="table-popup__fmtpattern" value={pattern.text} date={pattern.date} onCommit={(p) => persistColFmt(c, { customPattern: p })} />
      : null;
  };
  const colFmtControls = showFmtControls && state.formatControls === "columns";
  const fmtButton = (c: number) => {
    const type = colTypeAt(c);
    return (
      <ColumnFormatButton picked={!!colLocal[c]}>
        {type === "date" ? (
          <DateStyleSelect className="table-popup__fmtselect" inherit value={fmtRow(c).value} onChange={(f) => (f ? persistColFmt(c, { format: f }) : clearColFmt(c))} />
        ) : type === "logical" ? (
          <LogicalStyleSelect className="table-popup__fmtselect" inherit value={fmtRow(c).value} onChange={(s) => (s ? persistColFmt(c, { logicalStyle: s }) : clearColFmt(c))} />
        ) : type === "string" ? (
          <TextCaseSelect className="table-popup__fmtselect" inherit value={fmtRow(c).value} onChange={(tc) => tc === "chip" ? persistColFmt(c, { chip: true, textCase: "none" }) : tc ? persistColFmt(c, { textCase: tc, chip: false }) : clearColFmt(c)} />
        ) : (
          <FormatStyleSelect className="table-popup__fmtselect" inherit value={fmtRow(c).value} onChange={(f) => (f ? persistColFmt(c, { format: f }) : clearColFmt(c))} />
        )}
        {fmtPattern(c)}
        {fmtHint(c)}
        {type !== "number" ? null : state.unitTaggable ? (
          <UnitSelect
            className="table-popup__fmtselect"
            value={annFor(c).unit}
            onChange={(u) => {
              setColFmtAt(c, { unit: u });
              if (colExprs[c] !== undefined) void commitLive({ units: { [c]: u } });
            }}
          />
        ) : state.columnUnits?.[c] ? (
          <UnitSelect
            className="table-popup__fmtselect"
            value={state.columnUnits[c].display ?? "none"}
            onChange={() => {}}
            disabled
            title={`Unit: ${columnUnitLabel(state.columnUnits[c])} (inherited from the source)`}
          />
        ) : null}
      </ColumnFormatButton>
    );
  };
  function controlledCell(raw: CellValue, c: number): string {
    if (raw === null || raw === undefined || raw === "") return "";
    if (isSolError(raw)) return raw.code;
    const type = colTypeAt(c);
    const ann = annFor(c);
    if (type === "logical" || typeof raw === "boolean") {
      const b = typeof raw === "boolean" ? raw : coerceFrameCell("logical", String(raw));
      return typeof b === "boolean" ? applyLogicalStyle(b, ann.logicalStyle) : String(raw);
    }
    const v: CellValue = typeof raw === "string" && (type === "number" || type === "date")
      ? coerceFrameCell(type, raw)
      : raw;
    if (v === null) return "";
    if (typeof v === "number" && type === "date") {
      const fmt: FormatStyleId = isDateStyle(ann.format) ? ann.format : "date_dmy";
      return formatNumberWithAnnotation(v, { ...ann, format: fmt, unit: "none" });
    }
    if (typeof v === "number" && type === "number") {
      const fmt: FormatStyleId = isDateStyle(ann.format) ? "auto" : ann.format;
      return formatNumberWithAnnotation(v, { ...ann, format: fmt, unit: "none" });
    }
    if (type === "string") return applyTextCase(String(v), ann.textCase);
    return String(v);
  }

  const vertical = !!state.list && listVertical;
  const listLen = grid[0]?.length ?? 0;
  const listTruncated = vertical && listLen > MAX_VISIBLE_ROWS;
  // formatRenderActive implies not a list, so `vertical` is false here.
  const controlledRowAt = (r: number): CellValue[] => (editable ? rawRow(r) : (state.data[r] ?? []));
  const viewRowAt = (r: number): string[] => {
    if (vertical) return [displayRowAt(0)[r] ?? ""];
    if (formatRenderActive) { const row = controlledRowAt(r); return Array.from({ length: cols }, (_, c) => controlledCell(row[c], c)); }
    return displayRowAt(r);
  };
  const viewCols = vertical ? 1 : cols;
  const viewRows = vertical ? listLen : rows;

  // A plain computation, not a hook: it sits below the `if (!state)` guard.
  const isErrCode = (s: string): boolean => Object.prototype.hasOwnProperty.call(ERROR_EXPLANATIONS, s.trim());
  // Only the edited column suggests, and a keystroke re-renders, so scan that one column once per grid.
  const textColDistinct = new Map<number, string[]>();
  const ec = editCell?.c;
  if (ec !== undefined && ec >= 0 && ec < viewCols && (vertical ? cellType : colTypeAt(ec)) === "string") {
    const hit = distinctMemo.current;
    const values = hit && hit.grid === grid && hit.c === ec ? hit.values : distinctColumnValues(suggestionCells(grid, ec, !!state.list), isErrCode);
    distinctMemo.current = { grid, c: ec, values };
    textColDistinct.set(ec, values);
  }

  const sortOrder = sortedOrder(viewRows, sort, (r, c) =>
    sortKeyOf(vertical ? grid[0]?.[r] : rawAt(r, c)));
  const visibleOrder = sortOrder.length > MAX_VISIBLE_ROWS ? sortOrder.slice(0, MAX_VISIBLE_ROWS) : sortOrder;
  const viewRowCache = new Map<number, string[]>();
  const viewRow = (r: number): string[] => { let v = viewRowCache.get(r); if (!v) { v = viewRowAt(r); viewRowCache.set(r, v); } return v; };
  const sortable = !(state.list && !vertical);

  // An input has no intrinsic width, so measure: the mono advance is 27/42 em (the shipped .fnt metrics), plus 16px padding.
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
  function pickHeaderName(c: number, name: string) {
    setHeaderName(c, name);
    const types = editHead?.options.find((o) => o.name === name)?.types ?? [];
    if (types.length !== 1 || colExprs[c] !== undefined) return;
    const type = types[0];
    setColumnTypes((t) => {
      const next = t.slice();
      while (next.length <= c) next.push("number");
      next[c] = type;
      return next;
    });
  }
  function headerNameOptions(c: number): string[] {
    if (editHead?.c !== c) return [];
    const taken = new Set(headerNames.filter((_, j) => j !== c).map((h) => (h ?? "").trim().toLowerCase()));
    return editHead.options.map((o) => o.name).filter((n) => !taken.has(n.trim().toLowerCase()));
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
  function cycleColumnKind(c: number) {
    if (colExprs[c] !== undefined) {
      const exprs = [...colExprs]; exprs[c] = undefined;
      const types = [...columnTypes]; types[c] = "number";
      setColExprs(exprs);
      setColumnTypes(types);
      void commitLive({ exprs, types });
    } else if (fxColumns && colTypeAt(c) === COLTYPE_ORDER[COLTYPE_ORDER.length - 1]) {
      setColExprs((xs) => { const next = [...xs]; next[c] = ""; return next; });
    } else {
      toggleColumnType(c);
    }
  }
  // ── Rows and columns: insert and delete anywhere (table-popup § The grid) ──
  const pad = <T,>(arr: readonly T[], n: number, fill: T): T[] => (arr.length >= n ? [...arr] : [...arr, ...Array.from({ length: n - arr.length }, () => fill)]);
  const blankRow = () => Array.from({ length: Math.max(1, cols) }, () => "");
  function flushDraft() {
    if (!editCell) return;
    setCell(editCell.r, editCell.c, editDraft.current);
    setEditCell(null);
  }
  function insertRows(at: number, count: number) {
    flushDraft();
    setGrid((g) => insertAt(g, at, Array.from({ length: count }, blankRow)));
    if (computedVals) setLiveComputed(insertAt(computedVals, at, Array.from({ length: count }, () => [] as CellValue[])));
    setSel((sl) => (sl?.axis === "row" ? { axis: "row", indices: sl.indices.map((i) => shiftForInsert(i, at, count)), anchor: shiftForInsert(sl.anchor, at, count) } : sl));
    setFocusCell((f) => (f ? { r: shiftForInsert(f.r, at, count), c: f.c } : f));
    if (view === "form") setFormRow(at);
  }
  function deleteRows(indices: number[]) {
    const drop = new Set(indices);
    if (drop.size === 0 || drop.size >= rows) return;
    flushDraft();
    setGrid((g) => removeAt(g, drop));
    if (computedVals) setLiveComputed(removeAt(computedVals, drop));
    setSel(null);
    setFocusCell((f) => {
      if (!f) return f;
      const r = shiftForRemove(f.r, drop);
      return r === null ? null : { r, c: f.c };
    });
    if (view === "form") setFormRow(Math.max(0, Math.min(Math.min(...indices), rows - drop.size - 1)));
  }
  function insertCols(at: number, count: number) {
    flushDraft();
    const fill = <T,>(v: T): T[] => Array.from({ length: count }, () => v);
    setGrid((g) => (g.length === 0 ? [fill("")] : insertGridCols(g, at, count, "")));
    setHeaderNames((h) => insertAt(pad(h, cols, ""), at, fill("")));
    setColumnTypes((t) => insertAt(pad(t, cols, "number" as CellType), at, fill("number" as CellType)));
    setColExprs((x) => insertAt(pad(x, cols, undefined as string | undefined), at, fill(undefined as string | undefined)));
    committedExprs.current = insertAt(pad(committedExprs.current, cols, undefined), at, fill(undefined));
    if (state?.formatControls === "columns") {
      setColFmt((f) => insertAt(pad(f, cols, { format: "auto", unit: "none" } as FormatAnnotation), at, fill({ format: "auto", unit: "none" } as FormatAnnotation)));
      setColLocal((l) => insertAt(pad(l, cols, false), at, fill(false)));
      setColInherited((x) => insertAt(pad(x, cols, undefined as FormatAnnotation | undefined), at, fill(undefined as FormatAnnotation | undefined)));
    }
    setColStat((m) => remapKeys(m, (i) => shiftForInsert(i, at, count)));
    remapSort((col) => shiftForInsert(col, at, count));
    if (editableHeaders) liveNames.current = insertAt(pad(liveNames.current, cols, undefined), at, fill(undefined));
    if (computedVals) setLiveComputed(computedVals.map((row) => insertAt(pad(row ?? [], cols, null as CellValue), at, fill(null as CellValue))));
    setSel((sl) => (sl?.axis === "col" ? { axis: "col", indices: sl.indices.map((i) => shiftForInsert(i, at, count)), anchor: shiftForInsert(sl.anchor, at, count) } : sl));
    setFocusCell((f) => (f ? { r: f.r, c: shiftForInsert(f.c, at, count) } : f));
  }
  function deleteCols(indices: number[]) {
    const drop = new Set(indices);
    if (drop.size === 0 || drop.size >= cols) return;
    flushDraft();
    const move = (i: number) => shiftForRemove(i, drop);
    setGrid((g) => removeGridCols(g, drop));
    setHeaderNames((h) => removeAt(pad(h, cols, ""), drop));
    setColumnTypes((t) => removeAt(pad(t, cols, "number" as CellType), drop));
    setColExprs((x) => removeAt(pad(x, cols, undefined as string | undefined), drop));
    committedExprs.current = removeAt(pad(committedExprs.current, cols, undefined), drop);
    if (state?.formatControls === "columns") {
      setColFmt((f) => removeAt(f, drop));
      setColLocal((l) => removeAt(l, drop));
      setColInherited((x) => removeAt(x, drop));
    }
    setColStat((m) => remapKeys(m, move));
    remapSort(move);
    if (editableHeaders) {
      const live = pad(liveNames.current, cols, undefined);
      droppedNames.current.push(...live.filter((n, i): n is string => drop.has(i) && n !== undefined));
      liveNames.current = removeAt(live, drop);
    }
    if (computedVals) setLiveComputed(computedVals.map((row) => removeAt(row ?? [], drop)));
    setSel(null);
    setFocusCell((f) => {
      if (!f) return f;
      const c = move(f.c);
      return c === null ? null : { r: f.r, c };
    });
  }
  const inRange = (xs: readonly number[], n: number) => xs.filter((i) => i >= 0 && i < n);
  const rowTarget = inRange(sel?.axis === "row" ? sel.indices : focusCell ? [focusCell.r] : [], rows);
  const colTarget = inRange(sel?.axis === "col" ? sel.indices : focusCell ? [focusCell.c] : [], cols);
  // ── Form view ────────────────────────────────────────────────────────────
  const formCapable = !!state.onSaveSource;
  const fRow = Math.min(formRow, Math.max(0, rows - 1));
  const formLayout = state.formLayout ?? "";
  const formPlaced = formLayout.trim() !== "" ? parseRecordLayout(formLayout) : [];
  const formCols = formPlaced.length > 0 ? Math.max(...formPlaced.map((pl) => pl.col + pl.colSpan - 1)) : 1;
  const formColIndex = (name: string): number =>
    headerNames.findIndex((h) => (h ?? "").trim().toLowerCase() === name.trim().toLowerCase());
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
          return null;
        }
        const n = decimalFromText(s);
        if (Number.isFinite(n)) return n;
        if (type === "date") { const d = parseDateToSerial(s); return Number.isFinite(d) ? d : NaN; }
        return NaN;
      });
      return { name: (headerNames[c] ?? "").trim(), type, values };
    });
  }

  const summaryDeps = [state, grid, columnTypes, computedVals, colExprs, listVertical, editable, showSummary];
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
        const checked = type === "logical" ? values.filter((v) => v === true).length : null;
        const unchecked = type === "logical" ? values.filter((v) => v === false).length : null;
        return { profile, sum, checked, unchecked };
      });
    })() : null;
    summaryCache.current = { deps: summaryDeps, value };
  }
  const colSummaries = summaryCache.current.value;

  const cardsCapable = isFramePopup && !state.list;
  const cardsDeps = [state, grid, columnTypes, headerNames, computedVals, colExprs, displayMode, colFmt, colLocal];
  if (!sameDeps(cardsKey.current.deps, cardsDeps)) cardsKey.current = { deps: cardsDeps, key: {} };

  const headers = editableHeaders ? headerNames : state.headers;
  const hasHeaderLine = !state.list && !!(headers && headers.length);
  function buildText(inSortOrder: boolean, as: "auto" | "shown" | "source" = "auto"): string {
    const order = inSortOrder ? sortOrder : Array.from({ length: viewRows }, (_, i) => i);
    if (state!.list) {
      const line = displayRowAt(0, as);
      return listToText([listInViewOrder(line, vertical, order)], cellType, !editable);
    }
    const body = toCSV(order.map((r) => displayRowAt(r, as)), cellType, typesShown, !editable);
    return hasHeaderLine
      ? `${headers.map((h) => csvField(h, "string", !editable)).join(",")}\n${body}`
      : body;
  }

  const csvViewText = (mode: "formatted" | "source" = displayMode) =>
    buildText(!editable, mode === "source" ? "source" : "shown");
  function showCSV() {
    if (view === "csv") return;
    setCsvText(csvViewText());
    setCsvError(null);
    const blank = !!headers?.every((h) => !(h ?? "").trim()) && grid.every((r) => r.every((c) => !c.trim()));
    csvTypesFrom.current = editable && hasHeaderLine ? (blank ? 0 : cols) : null;
    setView("csv");
  }
  const settledColumnTypes = (): CellType[] => typesShown;
  function leaveCsv(next: "grid" | "form" | "cards") {
    if (view === "csv") setColumnTypes(settledColumnTypes());
    setView(next);
  }
  function onCsvChange(v: string) {
    setCsvText(v);
    if (!editable) return;
    const rows = parseCSV(v);
    if (computedColSet.size > 0 && rows.some((r) => r.length !== cols)) {
      setCsvError("Every row needs the same number of values. This edit can't be saved until they match.");
      return;
    }
    setCsvError(null);
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
    const gridForMd = state?.list ? [listInViewOrder(displayRowAt(0), vertical, sortOrder)] : sortOrder.map((r) => displayRowAt(r));
    void copyText(toMarkdown(gridForMd, cellType, columnTypes, headers, !!state?.list));
  }
  function exportCsv() {
    const base = (state?.title || "table").replace(/[^\w.-]+/g, "_") || "table";
    void saveCsvFileDialog(`${base}.csv`, buildText(true));
  }
  function buildSourceColumns(overrides?: {
    exprs?: (string | undefined)[];
    types?: CellType[];
    units?: Record<number, string>;
  }): FrameSourceColumn[] {
    const exprs = overrides?.exprs ?? colExprs;
    const types = overrides?.types ?? columnTypes;
    return Array.from({ length: cols }, (_, c) => {
      const u = state?.unitTaggable && (types[c] ?? "number") === "number"
        ? (overrides?.units?.[c] ?? annFor(c).unit)
        : undefined;
      const expr = exprs[c]?.trim() || undefined;
      return {
        name: (headerNames[c] ?? "").trim(),
        type: types[c] ?? "number",
        cells: expr ? [] : grid.map((row) => row[c] ?? ""),
        ...(u && u !== "none" ? { unit: u } : {}),
        ...(expr ? { expr } : {}),
      };
    });
  }
  async function commitLive(overrides?: Parameters<typeof buildSourceColumns>[0]) {
    if (!state?.onCommitSource) return;
    committedExprs.current = [...(overrides?.exprs ?? colExprs)];
    savedSnapshot.current = editSnapshot(grid, headerNames, overrides?.types ?? columnTypes, committedExprs.current);
    rekeyColFormats();
    const refresh = await state.onCommitSource(buildSourceColumns(overrides));
    if (!refresh) return;
    setLiveComputed(refresh.computedCells);
    setColumnTypes(refresh.columnTypes);
  }
  // The new node reads what the host outputs, so an editor's pending edits are saved first.
  const recordCards = getRecordCardsAction();
  function addCardsChart(hostId: string) {
    if (editable) { if (!save()) return; } else tablePopup.close();
    void recordCards?.add(hostId);
  }
  function hasUnsavedEdits(): boolean {
    if (!editable) return false;
    const midEdit = !!editCell && editDraft.current !== (grid[editCell.r]?.[editCell.c] ?? "");
    return midEdit || editSnapshot(grid, headerNames, settledColumnTypes(), colExprs) !== savedSnapshot.current;
  }
  // The overlay, the close button, Escape and Go to source all land here; the footer's Cancel discards outright.
  function requestClose() {
    if (hasUnsavedEdits()) setAskClose(true);
    else tablePopup.close();
  }
  const csvBlocksSave = view === "csv" && !!csvError;
  function save(): boolean {
    if (csvBlocksSave) { setAskClose(false); return false; }
    rekeyColFormats();
    if (state?.onSaveRaw) state.onSaveRaw(grid.map((row) => [...row]));
    else if (state?.onSaveSource) state.onSaveSource(buildSourceColumns({ types: settledColumnTypes() }));
    tablePopup.close();
    return true;
  }

  const grouped = !!state.groupColor;
  const cardStyle = popupCardVars(state);

  const editsRows = editable && (view === "grid" || view === "form");
  const rowAxis: EditAxis | undefined = editsRows ? {
    noun: view === "form" ? "Record" : "Row",
    sides: view === "form" ? ["before", "after"] : ["above", "below"],
    ends: view === "form" ? ["start", "end"] : ["top", "bottom"],
    target: view === "form" ? (rows > 0 ? [fRow] : []) : rowTarget,
    total: rows,
    insert: insertRows,
    remove: deleteRows,
  } : undefined;
  const colAxis: EditAxis | undefined = editable && view === "grid" && !state.fixedCols ? {
    noun: "Column",
    sides: ["left", "right"],
    ends: ["start", "end"],
    target: colTarget,
    total: cols,
    nameOf: editableHeaders ? (i) => headerNames[i] : state.headers ? (i) => state.headers?.[i] : undefined,
    labelOf: colLabel,
    insert: insertCols,
    remove: deleteCols,
  } : undefined;
  // A selection of rows offers only row actions, and of columns only column actions.
  const menuRow = sel?.axis === "col" ? undefined : rowAxis;
  const menuCol = sel?.axis === "row" ? undefined : colAxis;
  const selRows = new Set(sel?.axis === "row" ? sel.indices : []);
  const selCols = new Set(sel?.axis === "col" ? sel.indices : []);
  // The cell the menus act on stays outlined after focus moves to them; nothing unmarked is ever a target.
  const activeAt = (r: number, c: number) => editsRows && view === "grid" && focusCell?.r === r && focusCell.c === c;
  const pickRow = (e: React.MouseEvent, r: number) => {
    setSel((prev) => pickIndex(prev, "row", r, e.shiftKey, visibleOrder));
    setFocusCell(null);
    (document.activeElement as HTMLElement | null)?.blur?.();
  };
  const onControl = (e: React.SyntheticEvent) => !!(e.target as HTMLElement).closest("button, input, select, textarea, label");
  const allCols = Array.from({ length: cols }, (_, c) => c);
  // A name fills its header, so Shift-click on it extends the column selection; a plain click edits the name.
  const pickCol = (e: React.MouseEvent, c: number) => {
    const onName = e.shiftKey && !!(e.target as HTMLElement).closest(".table-popup__colhead-input");
    if (onControl(e) && !onName) return;
    const from = focusCell && focusCell.c >= 0 ? { axis: "col" as const, indices: [focusCell.c], anchor: focusCell.c } : null;
    setSel((prev) => pickIndex(prev ?? from, "col", c, e.shiftKey, allCols));
    setFocusCell(null);
    (document.activeElement as HTMLElement | null)?.blur?.();
  };
  const openMenuAt = (e: React.MouseEvent) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); };

  const focusGridCell = (target: { vi: number; c: number } | null) => {
    if (!target) return;
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-vi="${target.vi}"][data-c="${target.c}"]`);
    if (el) { el.focus(); if (el.matches("input")) el.select(); }
  };
  const chipCols = new Map<number, Map<string, number>>();
  if (!vertical) {
    for (let cc = 0; cc < viewCols; cc++) {
      if (colTypeAt(cc) === "string" && annFor(cc).chip) {
        const col: (string | null)[] = [];
        for (let r = 0; r < viewRows; r++) { const rv = rawAt(r, cc); col.push(rv == null || rv === "" ? null : String(rv)); }
        chipCols.set(cc, categoryColorIndex(col));
      }
    }
  }
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
      {cellImageSrc(content) ? <CellImage src={cellImageSrc(content)!} /> : chipCols.has(c) && content !== "" ? <CategoryChip value={content} index={chipCols.get(c)!.get(content) ?? 0} /> : content === "" ? " " : content}
    </div>
  );
  const onGridEscape = () => {
    if (editCell) {
      editDraft.current = grid[editCell.r]?.[editCell.c] ?? "";
      setEditCell(null);
      (document.activeElement as HTMLElement | null)?.blur?.();
    } else if (sel) {
      setSel(null);
    } else if (focusCell) {
      setFocusCell(null);
    } else if (askClose) {
      setAskClose(false);
    } else {
      requestClose();
    }
  };

  return (
    <PopupShell
      title={state.title}
      onClose={requestClose}
      onEscape={onGridEscape}
      cardClassName="table-popup"
      grouped={grouped}
      cardStyle={cardStyle}
      resizable={{ min: { w: 320, h: 220 } }}
      headerExtra={<span className="table-popup__dims">{state.list ? `${listLen} items` : `${rows}×${cols}`}{rowsTruncated || listTruncated ? ` · first ${MAX_VISIBLE_ROWS.toLocaleString(APP_LOCALE)}` : ""}</span>}
      pinNodeId={state.pinNodeId}
      headerActions={
        <PopupOverflowMenu
          items={[
            { label: state.list ? "Copy" : "Copy CSV", onClick: copy },
            { label: "Copy as Markdown", onClick: copyMarkdown },
            { label: "Export CSV…", onClick: exportCsv },
            ...(isFramePopup ? [{ label: showSummary ? "Hide summary footer" : "Show summary footer", onClick: () => settingsStore.set("tablePopupSummary", !showSummary) }] : []),
            ...(view === "grid" ? [{ label: frozen ? "Unfreeze header" : "Freeze header", onClick: () => settingsStore.set("tablePopupFrozen", !frozen) }] : []),
            ...(cardsCapable && state.pinNodeId && recordCards?.canAdd(state.pinNodeId) ? [{ label: "Add Record: Cards", onClick: () => addCardsChart(state.pinNodeId!) }] : []),
          ]}
        />
      }
    >
      {view === "grid" && showFmtControls && state.formatControls === "matrix" && (
        <div className="table-popup__matrix-fmt">
          {cellType === "logical" ? (
            <LogicalStyleSelect className="table-popup__fmtselect" inherit value={fmtRow(0).value} onChange={(s) => (s ? persistColFmt(0, { logicalStyle: s }) : clearColFmt(0))} />
          ) : cellType === "date" ? (
            <DateStyleSelect className="table-popup__fmtselect" inherit value={fmtRow(0).value} onChange={(f) => (f ? persistColFmt(0, { format: f }) : clearColFmt(0))} />
          ) : cellType === "string" ? (
            <TextCaseSelect className="table-popup__fmtselect" inherit value={fmtRow(0).value} onChange={(tc) => tc === "chip" ? persistColFmt(0, { chip: true, textCase: "none" }) : tc ? persistColFmt(0, { textCase: tc, chip: false }) : clearColFmt(0)} />
          ) : (
            <FormatStyleSelect className="table-popup__fmtselect" inherit value={fmtRow(0).value} onChange={(f) => (f ? persistColFmt(0, { format: f }) : clearColFmt(0))} />
          )}
          {fmtPattern(0)}
          {fmtHint(0)}
          {state.unitTaggable && cellType === "number" ? (
            <UnitSelect
              className="table-popup__fmtselect"
              value={annFor(0).unit}
              onChange={(u) => { setColFmtAt(0, { unit: u }); state.onSaveMatrixUnit?.(u); }}
            />
          ) : cellType === "number" && state.columnUnits?.[0] ? (
            <UnitSelect
              className="table-popup__fmtselect"
              value={state.columnUnits[0].display ?? "none"}
              onChange={() => {}}
              disabled
              title={`Unit: ${columnUnitLabel(state.columnUnits[0])} (inherited from the source)`}
            />
          ) : null}
        </div>
      )}
      {view === "grid" ? (
        <div className="table-popup__grid-scroll sol-popup__scroll">
          <table className={`table-popup__grid${frozen ? "" : " table-popup__grid--unfrozen"}`} ref={gridRef}>
            <thead>
              <tr>
                <th className="table-popup__corner">
                  {editableHeaders && !vertical && <HeaderHelpButton formulas={fxColumns} lambdas={(state.lambdaOptions ?? []).length > 0} />}
                </th>
                {Array.from({ length: viewCols }, (_, c) => (
                  <th
                    key={c}
                    title={vertical ? undefined : headers?.[c]}
                    className={`${headers && !vertical ? "table-popup__colhead table-popup__colhead--name" : "table-popup__colhead"}${sortable ? " table-popup__colhead--sortpad" : ""}${selCols.has(c) ? " table-popup__colhead--sel" : ""}${editsRows && focusCell?.r === -1 && focusCell.c === c ? " table-popup__colhead--active" : ""}`}
                    onClick={colAxis ? (e) => pickCol(e, c) : undefined}
                    onContextMenu={colAxis ? (e) => {
                      if (!selCols.has(c)) { setSel({ axis: "col", indices: [c], anchor: c }); setFocusCell(null); }
                      openMenuAt(e);
                    } : undefined}
                  >
                    {vertical ? colLabel(0) : editableHeaders ? (
                      <div className="table-popup__colhead-edit">
                        <button
                          type="button"
                          className={`table-popup__coltype${colExprs[c] !== undefined ? " table-popup__coltype--fx" : ""}`}
                          title={`Column type: ${colExprs[c] !== undefined ? "Formula" : COLTYPE_NAME[colTypeAt(c)]}. Cycle Number / Text / Date / Boolean${fxColumns ? " / Formula" : ""}.`}
                          onClick={(e) => { e.stopPropagation(); cycleColumnKind(c); }}
                        >
                          {colExprs[c] !== undefined ? "Fx" : <TypeIcon type={colTypeAt(c)} size={12} />}
                        </button>
                        {(() => {
                          const nameOptions = headerNameOptions(c);
                          return (
                            <span className={`table-popup__colhead-field${nameOptions.length ? " table-popup__colhead-field--affix" : ""}`}>
                              <input
                                className="table-popup__input table-popup__input--text table-popup__colhead-input"
                                value={headerNames[c] ?? ""}
                                placeholder={colLabel(c)}
                                spellCheck={false}
                                onFocus={() => {
                                  setSel(null);
                                  setFocusCell((f) => ({ r: f?.r ?? -1, c }));
                                  if (state.columnNameOptions) setEditHead({ c, options: state.columnNameOptions?.() ?? [] });
                                }}
                                onBlur={state.columnNameOptions ? () => setEditHead(null) : undefined}
                                onKeyDown={(e) => { if (!e.nativeEvent.isComposing) headSuggestRef.current?.onKey(e); }}
                                onMouseDown={(e) => { if (e.shiftKey && colAxis) e.preventDefault(); }}
                                onChange={(e) => setHeaderName(c, e.target.value)}
                              />
                              {nameOptions.length > 0 && (
                                <CellSuggest
                                  handle={headSuggestRef}
                                  options={nameOptions}
                                  draft={headerNames[c] ?? ""}
                                  onPick={(v) => pickHeaderName(c, v)}
                                  detail={(v) => {
                                    const types = editHead?.options.find((o) => o.name === v)?.types ?? [];
                                    if (types.length < 2) return null;
                                    return (
                                      <span className="table-popup__suggest-types" title={`Typed as ${types.map((t) => COLTYPE_NAME[t]).join(" and ")} in other frames`}>
                                        {types.map((t) => <span key={t} className="table-popup__typeglyph"><TypeIcon type={t} size={12} /></span>)}
                                      </span>
                                    );
                                  }}
                                  opener={{ title: "Column names", label: "Show column names used in other frames" }}
                                />
                              )}
                            </span>
                          );
                        })()}
                        {colFmtControls && fmtButton(c)}
                      </div>
                    ) : colFmtControls ? (
                      <div className="table-popup__colhead-edit">
                        <span className="table-popup__colhead-label">{colHeaderLabel(c)}</span>
                        {fmtButton(c)}
                      </div>
                    ) : (
                      colHeaderLabel(c)
                    )}
                    {editableHeaders && !vertical && colExprs[c] !== undefined && (
                      <ColumnExprField
                        value={colExprs[c] ?? ""}
                        lambdaOptions={state.lambdaOptions ?? []}
                        onDraft={(v) => setColExprs((prev) => { const next = [...prev]; next[c] = v; return next; })}
                        onCommit={(text) => {
                          if (text === committedExprs.current[c]) return;
                          const exprs = [...colExprs];
                          exprs[c] = text;
                          void commitLive({ exprs });
                        }}
                        onRevert={() => {
                          const prev = committedExprs.current[c];
                          setColExprs((xs) => { const next = [...xs]; next[c] = prev; return next; });
                        }}
                      />
                    )}
                    {sortable && (
                      <SortButton dir={sortDirOf(sort, c)} onCycle={() => cycleSort(c)} label={headers?.[c] || colLabel(c)} />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody
              onFocus={editsRows ? (e) => {
                const el = (e.target as HTMLElement).closest<HTMLElement>("[data-vi]");
                if (!el) return;
                const r = visibleOrder[Number(el.dataset.vi)];
                if (r === undefined) return;
                setFocusCell({ r, c: Number(el.dataset.c) });
                setSel(null);
              } : undefined}
              onContextMenu={editsRows ? (e) => {
                const el = (e.target as HTMLElement).closest<HTMLElement>("[data-vi]");
                if (!el) return;
                const r = visibleOrder[Number(el.dataset.vi)];
                const c = Number(el.dataset.c);
                if (r === undefined) return;
                if (!(selRows.has(r) || selCols.has(c))) { setSel(null); setFocusCell({ r, c }); }
                openMenuAt(e);
              } : undefined}
            >
              {visibleOrder.map((r, vi) => { const row = viewRow(r); return (
                <tr key={r}>
                  <th
                    className={`table-popup__rowhead${editsRows ? " table-popup__rowhead--pick" : ""}${selRows.has(r) ? " table-popup__rowhead--sel" : ""}`}
                    onClick={editsRows ? (e) => pickRow(e, r) : undefined}
                    onContextMenu={editsRows ? (e) => {
                      e.stopPropagation();
                      if (!selRows.has(r)) { setSel({ axis: "row", indices: [r], anchor: r }); setFocusCell(null); }
                      openMenuAt(e);
                    } : undefined}
                  >{r + 1}</th>
                  {Array.from({ length: viewCols }, (_, c) => {
                    // A vertical list's type is the list's, not column `c` (always 0 there).
                    const type = vertical ? cellType : colTypeAt(c);
                    const nan = !isTextType(type) && (row[c] ?? "") === "NaN";
                    const errCode = (row[c] ?? "").trim();
                    const isErrCell = errCode !== "" && Object.prototype.hasOwnProperty.call(ERROR_EXPLANATIONS, errCode);
                    const fmtEdit = formattedPreview && editable && !vertical;
                    const editingHere = !!editCell && editCell.r === r && editCell.c === c;
                    const computedHere = !vertical && colExprs[c] !== undefined;
                    const canEdit = !computedHere && editable && !(formattedPreview && !fmtEdit);
                    const chipHere = fmtEdit && chipCols.has(c) && (row[c] ?? "") !== "";
                    const chipShown = chipHere && !editingHere;
                    const affixType = canEdit && editingHere && !vertical && (type === "date" || type === "logical") ? type : null;
                    const suggestHere = canEdit && editingHere && type === "string" && (textColDistinct.get(c)?.length ?? 0) > 0;
                    if (computedHere) {
                      return (
                        <td
                          key={c}
                          className={`table-popup__cell table-popup__cell--computed${selRows.has(r) || selCols.has(c) ? " table-popup__cell--sel" : ""}${activeAt(r, c) ? " table-popup__cell--active" : ""}`}
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
                      className={`table-popup__cell${selRows.has(r) || selCols.has(c) ? " table-popup__cell--sel" : ""}${activeAt(r, c) ? " table-popup__cell--active" : ""}${nan ? " table-popup__cell--nan" : ""}${chipHere ? " table-popup__cell--chip" : ""}${affixType || suggestHere ? " table-popup__cell--affix" : ""}`}
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
                      <>
                      {chipShown && (
                        <span className="table-popup__chip-overlay" aria-hidden="true">
                          <CategoryChip value={row[c] ?? ""} index={chipCols.get(c)!.get(row[c] ?? "") ?? 0} />
                        </span>
                      )}
                      <input
                        className={`${isTextType(type) ? "table-popup__input table-popup__input--text" : "table-popup__input"}${isErrCell ? " sol-error-chip" : ""}`}
                        style={chipShown ? { color: "transparent" } : undefined}
                        value={editingHere ? editDraft.current : row[c] ?? ""}
                        readOnly={!editable || (formattedPreview && !fmtEdit)}
                        inputMode={isTextType(type) ? "text" : "decimal"}
                        spellCheck={false}
                        onFocus={canEdit ? () => { editDraft.current = grid[r]?.[c] ?? ""; setEditCell({ r, c }); } : undefined}
                        onChange={(e) => {
                          if (!canEdit) return;
                          editDraft.current = e.target.value;
                          if (editingHere) bumpDraft((x) => x + 1);
                          else setEditCell({ r, c });
                        }}
                        onBlur={canEdit ? () => { if (editingHere) { setCell(r, c, editDraft.current); setEditCell(null); } } : undefined}
                        data-vi={vi}
                        data-c={c}
                        onKeyDown={canEdit ? (e) => {
                          if (e.nativeEvent.isComposing) return;
                          if (suggestRef.current?.onKey(e)) return;
                          const k = gridKeyOf(e);
                          if (!k) return; // Escape belongs to the shell's capture-phase onEscape
                          const midEdit = editingHere && editDraft.current !== (grid[r]?.[c] ?? "");
                          if (midEdit && k !== "Enter" && k !== "ShiftEnter" && k !== "Tab" && k !== "ShiftTab") return;
                          const target = nextCell(k, { vi, c }, { rows: visibleOrder.length, cols: viewCols }, (_vi, cc) => isComputedCol(cc));
                          if (editingHere) { setCell(r, c, editDraft.current); setEditCell(null); }
                          if (!target) return;
                          e.preventDefault();
                          focusGridCell(target);
                        } : undefined}
                      />
                      {suggestHere && (
                        <CellSuggest
                          handle={suggestRef}
                          options={textColDistinct.get(c)!}
                          draft={editDraft.current}
                          onPick={(v) => { editDraft.current = v; setCell(r, c, v); bumpDraft((x) => x + 1); }}
                        />
                      )}
                      {affixType && (() => {
                        const draft = editDraft.current.trim().toLowerCase();
                        return (
                          <CellEditAffix
                            type={affixType}
                            iso={affixType === "date" ? dateCellToISO(editDraft.current) : undefined}
                            checked={draft === "true" || draft === "1" ? true : draft === "false" || draft === "0" ? false : null}
                            onPick={(raw) => { editDraft.current = raw; setCell(r, c, raw); bumpDraft((x) => x + 1); }}
                          />
                        );
                      })()}
                      </>
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
                    const type = colTypeAt(c);
                    const stat = footerStatFor(type, colStat[c]);
                    const choices = STATS_BY_TYPE[type];
                    return (
                      <td key={c} className="table-popup__statcell">
                        <span className="table-popup__statpick">
                          <span className="table-popup__statlabel">{FOOTER_STAT_LABEL[stat]}<ChevronDownIcon size={10} strokeWidth={2} /></span>
                          <select
                            className="table-popup__statselect"
                            value={stat}
                            aria-label="Summary statistic"
                            onChange={(e) => setColStat((m) => ({ ...m, [c]: e.target.value as FooterStat }))}
                          >
                            {choices.map((k) => <option key={k} value={k}>{FOOTER_STAT_LABEL[k]}</option>)}
                          </select>
                        </span>
                        <span className="table-popup__statvalue">{(() => {
                          const v = footerStatValue(stat, colSummaries[c]);
                          return formatRenderActive && v != null && statReadsAsCell(stat) ? controlledCell(v, c) : formatFooterStat(stat, v);
                        })()}</span>
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
            </div>
            {rows > 0 && (() => {
              const box = (c: number, name: string, key: number | string, at?: React.CSSProperties, hint?: string) => {
                const type = c === -1 ? "string" : colTypeAt(c);
                const computedHere = c !== -1 && colExprs[c] !== undefined;
                const label = c === -1 ? name : (headerNames[c] ?? "").trim() || colLabel(c);
                const editingHere = c !== -1 && !!editCell && editCell.r === fRow && editCell.c === c;
                const raw = c === -1 ? "" : grid[fRow]?.[c] ?? "";
                const shown = formattedPreview ? controlledCell(raw, c) : raw;
                const image = formattedPreview && !editingHere && shown !== "" ? recordImageSrc(shown) : null;
                const suggestHere = editingHere && !computedHere && type === "string" && (textColDistinct.get(c)?.length ?? 0) > 0;
                return (
                  <label className="table-popup__form-box" key={key} style={at}>
                    <span className="table-popup__form-box-label">
                      {computedHere && (
                        // An SVG circle: a small rounded CSS box snaps to an oval at a fractional position.
                        <svg className="table-popup__form-box-fx" width="6" height="6" viewBox="0 0 6 6" role="img" aria-label="Computed column">
                          <title>Computed column</title>
                          <circle cx="3" cy="3" r="3" fill="currentColor" />
                        </svg>
                      )}
                      {label}
                    </span>
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
                    ) : (
                      <span className={type === "date" || suggestHere ? "table-popup__form-box-date" : undefined} style={type === "date" || suggestHere ? undefined : { display: "contents" }}>
                      <input
                        className="table-popup__form-box-input"
                        value={editingHere ? editDraft.current : shown}
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
                          if (e.nativeEvent.isComposing) return;
                          if (suggestRef.current?.onKey(e)) return;
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                      />
                      {suggestHere && (
                        <CellSuggest
                          handle={suggestRef}
                          options={textColDistinct.get(c)!}
                          draft={editDraft.current}
                          onPick={(v) => { editDraft.current = v; setCell(fRow, c, v); bumpDraft((x) => x + 1); }}
                        />
                      )}
                      {type === "date" && (
                        <CellEditAffix
                          type="date"
                          iso={dateCellToISO(editingHere ? editDraft.current : raw)}
                          onPick={(picked) => {
                            if (editingHere) { editDraft.current = picked; bumpDraft((x) => x + 1); }
                            setCell(fRow, c, picked);
                          }}
                        />
                      )}
                      </span>
                    )}
                    {image && <CellImage className="sol-record__img" src={image} alt={label} />}
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
      ) : view === "cards" ? (
        <TableCards
          names={Array.from({ length: cols }, (_, c) => (headers?.[c] ?? "").trim() || colLabel(c))}
          types={Array.from({ length: cols }, (_, c) => colTypeAt(c))}
          computed={computedColSet}
          chipCols={new Set(Array.from({ length: cols }, (_, c) => c).filter((c) => colTypeAt(c) === "string" && !!annFor(c).chip))}
          rowCount={rows}
          order={sortOrder}
          rawAt={rawAt}
          shownRow={(r) => displayRowAt(r, displayMode === "source" ? "source" : "shown")}
          dataKey={cardsKey.current.key}
          sort={sort}
          onSort={setSort}
          onEdit={formCapable ? (r) => { setFormRow(r); setView("form"); } : undefined}
        />
      ) : (
        <CsvEditor
          value={csvText}
          onChange={onCsvChange}
          readOnly={!editable}
          markedCols={computedColSet}
          firstBodyRow={hasHeaderLine ? 1 : 0}
          error={csvError}
          onFocus={() => { if (editable && !csvError && formattedPreview) setCsvText(buildText(false, "source")); }}
          onBlur={() => { if (editable && !csvError && (formattedPreview || computedColSet.size > 0)) setCsvText(csvViewText()); }}
        />
      )}

      {ctxMenu && editsRows && <TableContextMenu at={ctxMenu} row={menuRow} col={menuCol} onClose={() => setCtxMenu(null)} />}
      <div className="table-popup__footer">
        <div className="table-popup__view" role="group" aria-label="View">
          <button
            type="button"
            aria-pressed={view === "grid"}
            onClick={() => leaveCsv("grid")}
          >Grid</button>
          {cardsCapable && (
            <button
              type="button"
              aria-pressed={view === "cards"}
              onClick={() => leaveCsv("cards")}
            >Cards</button>
          )}
          {formCapable && (
            <button
              type="button"
              aria-pressed={view === "form"}
              onClick={() => leaveCsv("form")}
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
              title="Show the list down a column. Display only; the value doesn't change."
            >Column</button>
          </div>
        )}
        {showFmtToggle && (
          <label
            className="table-popup__source-check"
            title={literalSource
              ? "Show and edit exactly what you typed, instead of formatted values like TRUE/FALSE and dates."
              : "Show the source text instead of the formatted value."}
          >
            <input
              type="checkbox"
              checked={displayMode === "source"}
              onChange={(e) => {
                const next = e.target.checked ? "source" : "formatted";
                setDisplayMode(next);
                if (view === "csv" && !csvError) setCsvText(csvViewText(next));
              }}
            />
            Source
          </label>
        )}
        {editsRows && <TableEditMenus row={menuRow} col={menuCol} />}
        <div className="table-popup__spacer" />
        {editable ? (
          <div className="table-popup__actions">
            <button className="table-popup__btn" onClick={() => tablePopup.close()}>Cancel</button>
            <button className="table-popup__btn table-popup__btn--primary" onClick={save} disabled={csvBlocksSave}>Save</button>
          </div>
        ) : (
          <button className="table-popup__btn table-popup__btn--primary" onClick={() => tablePopup.close()}>Done</button>
        )}
      </div>
      {askClose && <UnsavedChangesPrompt onSave={save} onDiscard={() => tablePopup.close()} onKeepEditing={() => setAskClose(false)} />}
    </PopupShell>
  );
}

/** Formula columns infer their type, so only a Data column's type counts as an edit. */
function editSnapshot(grid: string[][], names: string[], types: CellType[], exprs: (string | undefined)[]): string {
  return JSON.stringify([grid, names, types.map((t, j) => (exprs[j] !== undefined ? "fx" : t)), exprs]);
}

function UnsavedChangesPrompt({ onSave, onDiscard, onKeepEditing }: {
  onSave: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(true, ref);
  return (
    <div className="table-popup__unsaved" onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onKeepEditing(); }}>
      <div ref={ref} className="solenoid-confirm__dialog" role="alertdialog" aria-modal="true" aria-labelledby="table-popup-unsaved-msg">
        <div id="table-popup-unsaved-msg" className="solenoid-confirm__message">Save your changes?</div>
        <div className="solenoid-confirm__buttons">
          <button type="button" className="solenoid-confirm__btn table-popup__unsaved-discard" onClick={onDiscard}>Discard</button>
          <button type="button" className="solenoid-confirm__btn" onClick={onKeepEditing}>Keep Editing</button>
          <button type="button" className="solenoid-confirm__btn solenoid-confirm__btn--primary" onClick={onSave} autoFocus>Save</button>
        </div>
      </div>
    </div>
  );
}
