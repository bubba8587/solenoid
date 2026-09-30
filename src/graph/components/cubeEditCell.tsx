// [[C28]] literalsIffEditable, [[C95]] commitOnEnter, [[D90]] cubeTypesAtDepth, [[E16]] cubeCellKinds
import { useEffect, useState, type ReactNode } from "react";
import { cubePopup, type CubeEditBinding, type DrillView, type CellRef } from "../cubePopupStore";
import { recordsToCube, frameCellFromRecords, cubeRowCount, cubeDepth, typedCubeCell, coerceListItem, type CubeCell } from "../frame";
import {
  getAtPath, setAtPath, parseCellText, cellTextOf, recordKeys, cellKindOf, convertCellKind, newColumnKey,
  type CellKind, type CubePath, type CubeRecord, type CubeSource, type CubeSourceColumn,
} from "../literalEditors";
import { typesAt, isFrameAt, withFrame, withNestedType, renameNestedColumn, dropNestedColumn, dropNestedUnder, shiftNestedRows, type NestedTables } from "../cubeTypes";
import { insertAt, removeAt, insertGridCols, removeGridCols } from "../tableEdit";
import type { EditAxis } from "./TableEditMenu";
import { stopDragStart } from "../coarse";
import { elemChipClass } from "../valuePopup";
import { isSolError } from "../errorValue";
import { cubeCellToken, CubeCellChip } from "./cubeCell";
import { CellKindMenu } from "./CellKindMenu";
import { ColumnExprField, COLTYPE_ORDER, COLTYPE_NAME } from "./columnHeadControls";
import { TypeIcon } from "./TypeIcon";


const rowsAt = (records: CubeRecord[], path: CubePath): CubeRecord[] => {
  const sub = path.length ? getAtPath(records, path) : records;
  return Array.isArray(sub) ? (sub as CubeRecord[]) : [];
};

/** A nested table as a cube, its columns read by the types declared for that one table. */
export function cubeViewAt(records: CubeRecord[], path: CubePath, label: string, nested: NestedTables = {}): DrillView {
  return { kind: "cube", cube: recordsToCube(rowsAt(records, path), typesAt(nested, path), nested, path), label, path };
}

/** A nested Frame, its columns read by its own picks. */
export function frameViewAt(records: CubeRecord[], path: CubePath, label: string, nested: NestedTables = {}): DrillView {
  return { kind: "frame", frame: frameCellFromRecords(rowsAt(records, path), typesAt(nested, path)), label, path };
}

export function listViewAt(records: CubeRecord[], path: CubePath, label: string): DrillView {
  const sub = getAtPath(records, path);
  return { kind: "list", items: Array.isArray(sub) ? (sub as unknown[]) : [], label, path };
}

export function gridViewAt(records: CubeRecord[], path: CubePath, label: string): DrillView {
  const sub = getAtPath(records, path);
  const cells = Array.isArray(sub) ? sub.map((row) => (Array.isArray(row) ? (row as CubeCell[]) : [])) : [];
  return { kind: "grid", cells, label, path };
}

function commitAt(edit: CubeEditBinding, path: CubePath, value: unknown, nested?: (n: NestedTables) => NestedTables) {
  const src = edit.source();
  const next: CubeSource = { ...src, rows: setAtPath(src.rows, path, value) };
  commitSource(edit, nested ? withNested(next, nested) : next);
}

function commitSource(edit: CubeEditBinding, next: CubeSource) {
  edit.save(next);
  cubePopup.refresh();
}

function withNested(src: CubeSource, fn: (n: NestedTables) => NestedTables): CubeSource {
  const nested = fn(src.nested ?? {});
  const { nested: _old, ...rest } = src;
  return Object.keys(nested).length ? { ...rest, nested } : rest;
}

/** Formula columns live on the root level only; the root's column list is its order too. */
const rootColumns = (edit: CubeEditBinding, path: CubePath): CubeSourceColumn[] | null =>
  path.length === 0 ? edit.source().columns : null;

function InlineCell({ value, shown, onCommit }: { value: unknown; shown?: string; onCommit: (text: string) => void }) {
  const [draft, setDraft] = useState(cellTextOf(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { setDraft(cellTextOf(value)); }, [value]);
  return (
    <input
      className="table-popup__input table-popup__input--text"
      value={focused || shown === undefined ? draft : shown}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); if (draft !== cellTextOf(value)) onCommit(draft); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") { setDraft(cellTextOf(value)); e.currentTarget.blur(); e.stopPropagation(); }
      }}
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
    />
  );
}

type ColType = NonNullable<CubeSourceColumn["type"]>;

/** A column's declared type in the table at `tablePath`: the top level's column list, or that one nested table's own picks ([[D90]] cubeTypesAtDepth). */
function columnTypeIn(edit: CubeEditBinding, tablePath: CubePath, column: string): ColType | undefined {
  const src = edit.source();
  if (tablePath.length === 0) {
    const col = src.columns.find((c) => c.name === column);
    return col && col.expr === undefined ? col.type : undefined;
  }
  return typesAt(src.nested ?? {}, tablePath)[column];
}

/** The type declared for a cell: its own column's on a Frame or Cube level; on a list or table level, the column the list or table sits in. */
export function declaredTypeAt(edit: CubeEditBinding, path: CubePath, column?: string): ColType | undefined {
  if (column !== undefined) return columnTypeIn(edit, path, column);
  let k = path.length - 1;
  while (k >= 0 && typeof path[k] !== "string") k--;
  return k < 1 ? undefined : columnTypeIn(edit, path.slice(0, k - 1), path[k] as string);
}

/** What a typed cell reads as, printed: a record's cell as a Frame cell reads, a list or table item as List Input reads it. */
function shownAs(type: ColType, value: unknown, item: boolean): string {
  const v = value == null ? null : item ? coerceListItem(type, value) : typedCubeCell(type, value as CubeCell);
  return cubeCellToken(v as CubeCell, type);
}

const stop = (e: React.MouseEvent | React.PointerEvent) => e.stopPropagation();
const chipClass = (mod: "cube" | "frame" | "array") => `solenoid-array-chip solenoid-array-chip--${mod} solenoid-array-chip--sm`;

/** A list, table, Frame or Cube held in a cell, as the chip that drills into it. */
function NestedChip({ edit, cellPath, value, kind, crumb, from, type }: {
  edit: CubeEditBinding; cellPath: CubePath; value: unknown; kind: CellKind; crumb: string; from: CellRef; type?: ColType;
}): ReactNode {
  const src = edit.source();
  const records = src.rows;
  const drill = (view: DrillView) => (e: React.MouseEvent) => { stop(e); cubePopup.drill(view, from); };
  if (kind === "list") {
    const list = (value ?? []) as unknown[];
    const famClass = elemChipClass(list as Parameters<typeof elemChipClass>[0], false, type);
    return (
      <button type="button" className={chipClass("array") + famClass} title={`${list.length}-item list ${cubeCellToken(list as CubeCell)}. Drill in and edit.`}
        onPointerDown={stop} onMouseDown={stop} onClick={drill(listViewAt(records, cellPath, crumb))}>
        [{list.length}× List]
      </button>
    );
  }
  if (kind === "table") {
    const rows = value as unknown[][];
    const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const famClass = elemChipClass(rows as Parameters<typeof elemChipClass>[0], true, type);
    return (
      <button type="button" className={chipClass("array") + famClass} title={`${rows.length}×${cols} table. Drill in and edit.`}
        onPointerDown={stop} onMouseDown={stop} onClick={drill(gridViewAt(records, cellPath, crumb))}>
        [{rows.length}×{cols} Table]
      </button>
    );
  }
  const rows = Array.isArray(value) ? (value as CubeRecord[]) : [value as CubeRecord];
  // A lone record is a one-row table; it is saved as one before the drill, since the drill's edits address rows by index.
  const drillRecords = (view: (recs: CubeRecord[]) => DrillView) => (e: React.MouseEvent) => {
    stop(e);
    if (!Array.isArray(value)) commitAt(edit, cellPath, rows);
    cubePopup.drill(view(edit.source().rows), from);
  };
  if (kind === "frame") {
    const cols = recordKeys(rows).length;
    return (
      <button type="button" className={chipClass("frame")} title={`Frame ${rows.length}×${cols}. Drill in and edit.`}
        onPointerDown={stop} onMouseDown={stop} onClick={drillRecords((recs) => frameViewAt(recs, cellPath, crumb, src.nested))}>
        [{rows.length}×{cols} Frame]
      </button>
    );
  }
  const c = recordsToCube(rows);
  const dims = `${cubeRowCount(c)}×${c.columns.length}×${cubeDepth(c)}`;
  return (
    <button type="button" className={chipClass("cube")} title={`Cube ${dims} (rows × cols × depth). Drill in and edit.`}
      onPointerDown={stop} onMouseDown={stop} onClick={drillRecords((recs) => cubeViewAt(recs, cellPath, crumb, src.nested))}>
      [{dims} Cube]
    </button>
  );
}

/** What a kind switch does to the declarations inside the cell: a Frame and a Cube trade places keeping the table's own picks (a Frame drops what its now-blank cells held); anything else starts clean. */
function redeclare(n: NestedTables, cellPath: CubePath, from: CellKind, to: CellKind): NestedTables {
  const records = (k: CellKind) => k === "frame" || k === "cube";
  const kept = records(from) && records(to);
  const cleared = dropNestedUnder(n, cellPath, kept);
  return to === "frame" ? withFrame(cleared, cellPath, true) : kept ? withFrame(cleared, cellPath, false) : cleared;
}

/** One editing cell: a value types in place, anything else is a chip to drill into, and the edge menu switches between them ([[E16]] cubeCellKinds). */
function EditCell({ edit, cellPath, crumb, from, type, item, source, kinds = true }: {
  edit: CubeEditBinding; cellPath: CubePath; crumb: string; from: CellRef; type?: ColType; item: boolean; source: boolean;
  /** A table's or a Frame's cell stays a value: no menu. */
  kinds?: boolean;
}): ReactNode {
  const src = edit.source();
  const value = getAtPath(src.rows, cellPath);
  const kind = cellKindOf(value, isFrameAt(src.nested ?? {}, cellPath));
  const shownType = source ? undefined : type;
  const inline = kind === "value" || !kinds;
  return (
    <span className="cube-edit__cell">
      {inline
        ? <InlineCell value={value} shown={shownType && value != null ? shownAs(shownType, value, item) : undefined} onCommit={(text) => commitAt(edit, cellPath, parseCellText(text))} />
        : <NestedChip edit={edit} cellPath={cellPath} value={value} kind={kind} crumb={crumb} from={from} type={type} />}
      {kinds && <CellKindMenu kind={kind} onPick={(next) => commitAt(edit, cellPath, convertCellKind(value, kind, next), (n) => redeclare(n, cellPath, kind, next))} />}
    </span>
  );
}

export function CubeEditCell({ edit, path, row, column, source = false }: {
  edit: CubeEditBinding;
  path: CubePath;
  row: number;
  column: string;
  /** Show what was typed instead of the typed reading. */
  source?: boolean;
}): ReactNode {
  const fx = rootColumns(edit, path)?.find((c) => c.name === column)?.expr !== undefined;
  if (fx) {
    const cube = edit.cube();
    const col = cube && !isSolError(cube) ? cube.columns.find((c) => c.name === column) : undefined;
    return <CubeCellChip cell={col?.cells[row] ?? null} crumb={column} size="sm" type={col?.type} at={{ r: row }} />;
  }
  const inFrame = path.length > 0 && isFrameAt(edit.source().nested ?? {}, path);
  return <EditCell edit={edit} cellPath={[...path, row, column]} crumb={column} from={{ r: row }} type={declaredTypeAt(edit, path, column)} item={false} source={source} kinds={!inFrame} />;
}

export function ListEditCell({ edit, path, row, source = false }: { edit: CubeEditBinding; path: CubePath; row: number; source?: boolean }): ReactNode {
  return <EditCell edit={edit} cellPath={[...path, row]} crumb="item" from={{ item: row }} type={declaredTypeAt(edit, path)} item source={source} />;
}

export function GridEditCell({ edit, path, row, col, source = false }: { edit: CubeEditBinding; path: CubePath; row: number; col: number; source?: boolean }): ReactNode {
  return <EditCell edit={edit} cellPath={[...path, row, col]} crumb="item" from={{ r: row, c: col }} type={declaredTypeAt(edit, path)} item source={source} kinds={false} />;
}

type ColumnKind = CubeSourceColumn["type"] | "fx";
const KIND_ORDER: ColumnKind[] = [undefined, ...COLTYPE_ORDER, "fx"];
const kindOf = (c: CubeSourceColumn): ColumnKind => (c.expr !== undefined ? "fx" : c.type);
const KIND_GLYPH = (k: ColumnKind): ReactNode => (k === "fx" ? "Fx" : k ? <TypeIcon type={k} size={12} /> : "–");
const KIND_NAME = (k: ColumnKind): string => (k === "fx" ? "Formula" : k ? COLTYPE_NAME[k] : "None");

function setColumn(edit: CubeEditBinding, name: string, patch: (c: CubeSourceColumn) => CubeSourceColumn) {
  const src = edit.source();
  commitSource(edit, { ...src, columns: src.columns.map((c) => (c.name === name ? patch(c) : c)) });
}

function CubeExprField({ edit, column, expr }: { edit: CubeEditBinding; column: string; expr: string }) {
  const [draft, setDraft] = useState(expr);
  useEffect(() => { setDraft(expr); }, [expr]);
  return (
    <ColumnExprField
      value={draft}
      lambdaOptions={[]}
      onDraft={setDraft}
      onCommit={(text) => { if (text !== expr) setColumn(edit, column, (c) => ({ ...c, expr: text })); }}
      onRevert={() => setDraft(expr)}
    />
  );
}

export function CubeEditHeader({ edit, path, column }: { edit: CubeEditBinding; path: CubePath; column: string }): ReactNode {
  const cols = rootColumns(edit, path);
  /** False when the name is refused (blank, or another column's), so the field goes back to the column's name. */
  const rename = (next: string): boolean => {
    const key = next.trim();
    if (!key || key === column) return false;
    const src = edit.source();
    const level = (path.length ? getAtPath(src.rows, path) : src.rows) as unknown[];
    if (!Array.isArray(level) || recordKeys(level).includes(key) || (cols && cols.some((c) => c.name === key))) return false;
    const renamed = level.map((r) => {
      if (!r || typeof r !== "object" || Array.isArray(r)) return r;
      return Object.fromEntries(Object.entries(r as CubeRecord).map(([k, v]) => [k === column ? key : k, v]));
    });
    const moved = (n: NestedTables) => renameNestedColumn(n, path, column, key);
    if (path.length === 0) {
      commitSource(edit, withNested({ ...src, columns: src.columns.map((c) => (c.name === column ? { ...c, name: key } : c)), rows: renamed as CubeRecord[] }, moved));
      return true;
    }
    commitAt(edit, path, renamed, moved);
    return true;
  };
  const nameInput = (
    <input
      className="table-popup__input table-popup__input--text table-popup__colhead-input"
      defaultValue={column}
      key={column}
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
      onBlur={(e) => { if (!rename(e.currentTarget.value)) e.currentTarget.value = column; }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") { e.currentTarget.value = column; e.currentTarget.blur(); e.stopPropagation(); }
      }}
    />
  );
  const col = cols?.find((c) => c.name === column);
  if (cols && !col) return nameInput;
  const kind: ColumnKind = col ? kindOf(col) : columnTypeIn(edit, path, column);
  const formulas = !!col && !edit.noFormulaColumns;
  const cycle = () => {
    const order = formulas ? KIND_ORDER : KIND_ORDER.filter((k) => k !== "fx");
    const next = order[(order.indexOf(kind) + 1) % order.length];
    if (col) setColumn(edit, column, () => (next === "fx" ? { name: column, expr: "" } : next ? { name: column, type: next } : { name: column }));
    else commitSource(edit, withNested(edit.source(), (n) => withNestedType(n, path, column, next === "fx" ? undefined : next)));
  };
  return (
    <>
      <div className="table-popup__colhead-edit">
        <button
          type="button"
          className={`table-popup__coltype${kind === "fx" ? " table-popup__coltype--fx" : ""}`}
          title={`Column type: ${KIND_NAME(kind)}. Cycle None / Number / Text / Date / Boolean${formulas ? " / Formula" : ""}.`}
          onClick={(e) => { e.stopPropagation(); cycle(); }}
        >
          {KIND_GLYPH(kind)}
        </button>
        {nameInput}
      </div>
      {kind === "fx" && col && <CubeExprField edit={edit} column={column} expr={col.expr ?? ""} />}
    </>
  );
}

/** The Insert and Delete menus' axes for the level on screen (table-popup § Editing a Cube Input), at the given targets. */
export function cubeEditAxes(edit: CubeEditBinding, view: DrillView, target: { rows: number[]; cols: number[] }): { row?: EditAxis; col?: EditAxis } {
  const path = view.path ?? [];
  const src = edit.source();
  const level = (path.length ? getAtPath(src.rows, path) : src.rows) as unknown[] | undefined;
  const list = Array.isArray(level) ? level : [];
  const isList = view.kind === "list";
  const isGrid = view.kind === "grid";
  const cols = rootColumns(edit, path);
  const gridWidth = isGrid ? list.reduce<number>((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0) : 0;
  const keys = isList || isGrid ? [] : cols ? cols.map((c) => c.name) : recordKeys(list);
  const colCount = isGrid ? gridWidth : keys.length;
  const clamp = (xs: number[], n: number) => { const ok = xs.filter((i) => i >= 0 && i < n); return ok.length ? ok : n > 0 ? [n - 1] : []; };

  const blank = () => (isList ? null : isGrid ? Array.from({ length: Math.max(1, gridWidth) }, () => null) : {});
  const row: EditAxis = {
    noun: isList ? "Item" : "Row",
    sides: isList ? ["before", "after"] : ["above", "below"],
    target: clamp(target.rows, list.length),
    total: list.length,
    canEmpty: true,
    insert: (at, count) => commitAt(edit, path, insertAt(list, at, Array.from({ length: count }, blank)), (n) => shiftNestedRows(n, path, at, count)),
    remove: (indices) => {
      const drop = new Set(indices);
      commitAt(edit, path, removeAt(list, drop), (n) => {
        let out = n;
        for (const d of [...drop].sort((a, b) => b - a)) out = shiftNestedRows(dropNestedUnder(out, [...path, d]), path, d + 1, -1);
        return out;
      });
    },
  };
  if (isList) return { row };

  const col: EditAxis = {
    noun: "Column",
    sides: ["left", "right"],
    target: clamp(target.cols, colCount),
    total: colCount,
    canEmpty: true,
    nameOf: isGrid ? undefined : (i) => keys[i],
    insert: (at, count) => {
      if (isGrid) {
        commitAt(edit, path, insertGridCols(list.length ? (list as unknown[][]) : [[]], at, count, null));
        return;
      }
      const added: string[] = [];
      for (let n = keys.length + 1; added.length < count; n++) {
        const key = newColumnKey(n);
        if (!keys.includes(key)) added.push(key);
      }
      const order = insertAt(keys, at, added);
      const base = list.length ? (list as CubeRecord[]) : [{}];
      const rows = base.map((r) => {
        if (!r || typeof r !== "object" || Array.isArray(r)) return r;
        const out: CubeRecord = {};
        for (const k of order) out[k] = k in r ? r[k] : null;
        for (const k of Object.keys(r)) if (!(k in out)) out[k] = r[k];
        return out;
      });
      if (cols) commitSource(edit, { ...src, columns: insertAt(src.columns, at, added.map((name) => ({ name }))), rows });
      else commitAt(edit, path, rows);
    },
    remove: (indices) => {
      if (isGrid) {
        commitAt(edit, path, removeGridCols(list as unknown[][], new Set(indices)));
        return;
      }
      const names = new Set(indices.map((i) => keys[i]).filter((k): k is string => k !== undefined));
      const rows = (list as CubeRecord[]).map((r) => {
        if (!r || typeof r !== "object" || Array.isArray(r)) return r;
        return Object.fromEntries(Object.entries(r).filter(([k]) => !names.has(k)));
      });
      const dropped = (n: NestedTables) => [...names].reduce((acc, name) => dropNestedColumn(acc, path, name), n);
      if (cols) commitSource(edit, withNested({ ...src, columns: src.columns.filter((c) => !names.has(c.name)), rows }, dropped));
      else commitAt(edit, path, rows, dropped);
    },
  };
  return { row, col };
}
