// [[C28]] literalsIffEditable, [[C95]] commitOnEnter, [[D90]] cubeTypesAtDepth, [[E16]] cubeCellKinds
import { useEffect, useState, type ReactNode } from "react";
import { cubePopup, type CubeEditBinding, type DrillView } from "../cubePopupStore";
import { recordsToCube, frameFromRecords, cubeRowCount, cubeDepth, typedCubeCell, coerceListItem, type CubeCell } from "../frame";
import {
  getAtPath, setAtPath, recordsShape, parseCellText, cellTextOf, recordKeys, sourceSchema, withSourceSchema, schemaPathOf,
  cellKindOf, convertCellKind,
  type CubePath, type CubeRecord, type CubeSource, type CubeSourceColumn,
} from "../literalEditors";
import { schemaAt, pickType, withPickType, renamePick, dropPick, type CubeSchema } from "../cubeSchema";
import { stopDragStart } from "../coarse";
import { elemChipClass } from "../valuePopup";
import { isSolError } from "../errorValue";
import { cubeCellToken, CubeCellChip } from "./cubeCell";
import { CellKindMenu } from "./CellKindMenu";
import { ColumnExprField, COLTYPE_ORDER, COLTYPE_GLYPH, COLTYPE_NAME } from "./columnHeadControls";


/** A nested level's records as a cube, its columns read by that level's declared types. */
export function cubeViewAt(records: CubeRecord[], path: CubePath, label: string, schema: CubeSchema = {}): DrillView {
  const sub = path.length ? getAtPath(records, path) : records;
  const rows = Array.isArray(sub) ? (sub as CubeRecord[]) : [];
  return { kind: "cube", cube: recordsToCube(rows, schema), label, path };
}

export function frameViewAt(records: CubeRecord[], path: CubePath, label: string): DrillView {
  const sub = getAtPath(records, path);
  const rows = Array.isArray(sub) ? (sub as CubeRecord[]) : [];
  return { kind: "frame", frame: frameFromRecords(rows), label, path };
}

export function listViewAt(records: CubeRecord[], path: CubePath, label: string): DrillView {
  const sub = getAtPath(records, path);
  return { kind: "list", items: Array.isArray(sub) ? (sub as unknown[]) : [], label, path };
}

function commitAt(edit: CubeEditBinding, path: CubePath, value: unknown) {
  const src = edit.source();
  commitSource(edit, { ...src, rows: setAtPath(src.rows, path, value) });
}

function commitSource(edit: CubeEditBinding, next: CubeSource) {
  edit.save(next);
  cubePopup.refresh();
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

/** The type declared for a cell at `path`: its own column's on a table level, the column a list sits in on a list level ([[D90]] cubeTypesAtDepth). */
export function declaredTypeAt(edit: CubeEditBinding, path: CubePath, column?: string): ColType | undefined {
  const names = column === undefined ? schemaPathOf(path) : [...schemaPathOf(path), column];
  const last = names.pop();
  return last === undefined ? undefined : pickType(schemaAt(sourceSchema(edit.source()), names)[last]);
}

/** The declared types of the table at `path`. */
export const levelSchemaAt = (edit: CubeEditBinding, path: CubePath): CubeSchema => schemaAt(sourceSchema(edit.source()), schemaPathOf(path));

/** What a typed cell reads as, printed: a table cell as a Frame cell reads, a list item as List Input reads it. */
function shownAs(type: ColType, value: unknown, listItem: boolean): string {
  const v = value == null ? null : listItem ? coerceListItem(type, value) : typedCubeCell(type, value as CubeCell);
  return cubeCellToken(v as CubeCell, type);
}

const stop = (e: React.MouseEvent | React.PointerEvent) => e.stopPropagation();
const chipClass = (mod: "cube" | "frame" | "array") => `solenoid-array-chip solenoid-array-chip--${mod} solenoid-array-chip--sm`;

/** A list or table held in a cell, as the chip that drills into it. */
function NestedChip({ edit, cellPath, value, crumb, from, type }: {
  edit: CubeEditBinding; cellPath: CubePath; value: unknown; crumb: string; from: { r: number; c?: number }; type?: ColType;
}): ReactNode {
  const records = edit.source().rows;
  const shape = recordsShape(value);
  if (shape === "list" || shape === "empty") {
    const list = (value ?? []) as unknown[];
    const famClass = elemChipClass(list as Parameters<typeof elemChipClass>[0], false, type);
    return (
      <button type="button" className={chipClass("array") + famClass} title={`${list.length}-item list ${cubeCellToken(list as CubeCell)}. Drill in and edit.`}
        onPointerDown={stop} onMouseDown={stop} onClick={(e) => { stop(e); cubePopup.drill(listViewAt(records, cellPath, crumb), from); }}>
        [{list.length}× List]
      </button>
    );
  }
  if (shape === "frame") {
    const rows = value as CubeRecord[];
    return (
      <button type="button" className={chipClass("frame")} title={`Frame ${rows.length}×${Object.keys(rows[0] ?? {}).length}. Drill in and edit.`}
        onPointerDown={stop} onMouseDown={stop} onClick={(e) => { stop(e); cubePopup.drill(frameViewAt(records, cellPath, crumb), from); }}>
        [{rows.length}×{Object.keys(rows[0] ?? {}).length} Frame]
      </button>
    );
  }
  const rows = Array.isArray(value) ? (value as CubeRecord[]) : [value as CubeRecord];
  const c = recordsToCube(rows);
  const dims = `${cubeRowCount(c)}×${c.columns.length}×${cubeDepth(c)}`;
  return (
    <button type="button" className={chipClass("cube")} title={`Cube ${dims} (rows × cols × depth). Drill in and edit.`}
      onPointerDown={stop} onMouseDown={stop} onClick={(e) => { stop(e); cubePopup.drill(cubeViewAt(records, cellPath, crumb, levelSchemaAt(edit, cellPath)), from); }}>
      [{dims} Cube]
    </button>
  );
}

/** One editing cell: a value types in place, a list or table is a chip to drill into, and the edge menu switches between them ([[E16]] cubeCellKinds). */
function EditCell({ edit, cellPath, crumb, from, type, listItem, source }: {
  edit: CubeEditBinding; cellPath: CubePath; crumb: string; from: { r: number; c?: number }; type?: ColType; listItem: boolean; source: boolean;
}): ReactNode {
  const value = getAtPath(edit.source().rows, cellPath);
  const kind = cellKindOf(value);
  const shownType = source ? undefined : type;
  return (
    <span className="cube-edit__cell">
      {kind === "value"
        ? <InlineCell value={value} shown={shownType && value != null ? shownAs(shownType, value, listItem) : undefined} onCommit={(text) => commitAt(edit, cellPath, parseCellText(text))} />
        : <NestedChip edit={edit} cellPath={cellPath} value={value} crumb={crumb} from={from} type={type} />}
      <CellKindMenu kind={kind} onPick={(next) => commitAt(edit, cellPath, convertCellKind(value, next))} />
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
  return <EditCell edit={edit} cellPath={[...path, row, column]} crumb={column} from={{ r: row }} type={declaredTypeAt(edit, path, column)} listItem={false} source={source} />;
}

export function ListEditCell({ edit, path, row, source = false }: { edit: CubeEditBinding; path: CubePath; row: number; source?: boolean }): ReactNode {
  return <EditCell edit={edit} cellPath={[...path, row]} crumb="item" from={{ r: row }} type={declaredTypeAt(edit, path)} listItem source={source} />;
}

type ColumnKind = CubeSourceColumn["type"] | "fx";
const KIND_ORDER: ColumnKind[] = [undefined, ...COLTYPE_ORDER, "fx"];
const kindOf = (c: CubeSourceColumn): ColumnKind => (c.expr !== undefined ? "fx" : c.type);
const KIND_GLYPH = (k: ColumnKind): string => (k === "fx" ? "Fx" : k ? COLTYPE_GLYPH[k] : "–");
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
  const schemaPath = schemaPathOf(path);
  const rename = (next: string) => {
    const key = next.trim();
    if (!key || key === column) return;
    const src = edit.source();
    const level = (path.length ? getAtPath(src.rows, path) : src.rows) as unknown[];
    if (!Array.isArray(level) || recordKeys(level).includes(key) || (cols && cols.some((c) => c.name === key))) return;
    const renamed = level.map((r) => {
      if (!r || typeof r !== "object" || Array.isArray(r)) return r;
      return Object.fromEntries(Object.entries(r as CubeRecord).map(([k, v]) => [k === column ? key : k, v]));
    });
    if (path.length === 0) {
      commitSource(edit, { columns: src.columns.map((c) => (c.name === column ? { ...c, name: key } : c)), rows: renamed as CubeRecord[] });
      return;
    }
    commitSource(edit, withSourceSchema({ ...src, rows: setAtPath(src.rows, path, renamed) }, (s) => renamePick(s, schemaPath, column, key)));
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
      onBlur={(e) => rename(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") { e.currentTarget.value = column; e.currentTarget.blur(); e.stopPropagation(); }
      }}
    />
  );
  const col = cols?.find((c) => c.name === column);
  if (cols && !col) return nameInput;
  const kind: ColumnKind = col ? kindOf(col) : pickType(levelSchemaAt(edit, path)[column]);
  const formulas = !!col && !edit.noFormulaColumns;
  const cycle = () => {
    const order = formulas ? KIND_ORDER : KIND_ORDER.filter((k) => k !== "fx");
    const next = order[(order.indexOf(kind) + 1) % order.length];
    if (col) setColumn(edit, column, (c) => (next === "fx" ? { name: column, expr: "" } : { name: column, ...(next ? { type: next } : {}), ...(c.columns ? { columns: c.columns } : {}) }));
    else commitSource(edit, withSourceSchema(edit.source(), (s) => withPickType(s, schemaPath, column, next === "fx" ? undefined : next)));
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

export function CubeEditRows({ edit, view }: { edit: CubeEditBinding; view: DrillView }): ReactNode {
  const path = view.path ?? [];
  const src = edit.source();
  const level = (path.length ? getAtPath(src.rows, path) : src.rows) as unknown[] | undefined;
  const list = Array.isArray(level) ? level : [];
  const isList = view.kind === "list";
  const cols = rootColumns(edit, path);
  const keys = isList ? [] : cols ? cols.map((c) => c.name) : recordKeys(list);
  const add = () => commitAt(edit, path, [...list, isList ? null : {}]);
  const remove = () => { if (list.length) commitAt(edit, path, list.slice(0, -1)); };
  const addColumn = () => {
    let n = keys.length + 1;
    while (keys.includes(`Column ${n}`)) n++;
    const key = `Column ${n}`;
    const base = list.length ? (list as CubeRecord[]) : [{}];
    const rows = base.map((r) => (r && typeof r === "object" && !Array.isArray(r) ? (key in r ? r : { ...r, [key]: null }) : r));
    if (cols) commitSource(edit, { columns: [...src.columns, { name: key }], rows });
    else commitAt(edit, path, rows);
  };
  const removeColumn = () => {
    const last = keys[keys.length - 1];
    if (last === undefined) return;
    const rows = (list as CubeRecord[]).map((r) => {
      if (!r || typeof r !== "object" || Array.isArray(r)) return r;
      const { [last]: _dropped, ...rest } = r;
      return rest;
    });
    if (cols) commitSource(edit, { columns: src.columns.filter((c) => c.name !== last), rows });
    else commitSource(edit, withSourceSchema({ ...src, rows: setAtPath(src.rows, path, rows) }, (s) => dropPick(s, schemaPathOf(path), last)));
  };
  return (
    <>
      <button className="table-popup__btn" onClick={add} title={isList ? "Append an item" : "Append an empty record"}>{isList ? "Add Item" : "Add Row"}</button>
      <button className="table-popup__btn" onClick={remove} disabled={list.length === 0} title={isList ? "Remove the last item" : "Remove the last row"}>{isList ? "− Item" : "− Row"}</button>
      {!isList && (
        <>
          <button className="table-popup__btn" onClick={addColumn} title="Add a column to every row">Add Column</button>
          <button className="table-popup__btn" onClick={removeColumn} disabled={keys.length === 0} title="Remove the last column from every row">− Col</button>
        </>
      )}
    </>
  );
}
