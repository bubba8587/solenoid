import { useEffect, useState, type ReactNode } from "react";
import { cubePopup, type CubeEditBinding, type DrillView } from "../cubePopupStore";
import { recordsToCube, frameFromRecords, cubeRowCount, cubeDepth } from "../frame";
import {
  getAtPath, setAtPath, recordsShape, parseCellText, cellTextOf,
  type CubePath, type CubeRecord,
} from "../literalEditors";
import { stopDragStart } from "../coarse";

// The Cube Input's editing cells (cubePopup edit mode). Every nested cell DRILLS on the
// breadcrumb, one window: a list cell → an editable list level, a frame-shaped record list
// → an editable table level, a cube-shaped one → a cube level with the same rules. A
// scalar edits inline. Every commit patches the records at the cell's path and the popup
// re-derives its stack from them.

/** The view for the records list at `path` (a cube level). */
export function cubeViewAt(records: CubeRecord[], path: CubePath, label: string): DrillView {
  const sub = path.length ? getAtPath(records, path) : records;
  const rows = Array.isArray(sub) ? (sub as CubeRecord[]) : [];
  return { kind: "cube", cube: recordsToCube(rows), label, path };
}

/** The view for a frame-shaped record list at `path` (an editable table level). */
export function frameViewAt(records: CubeRecord[], path: CubePath, label: string): DrillView {
  const sub = getAtPath(records, path);
  const rows = Array.isArray(sub) ? (sub as CubeRecord[]) : [];
  return { kind: "frame", frame: frameFromRecords(rows), label, path };
}

/** The view for a list cell at `path` (an editable list level). */
export function listViewAt(records: CubeRecord[], path: CubePath, label: string): DrillView {
  const sub = getAtPath(records, path);
  return { kind: "list", items: Array.isArray(sub) ? (sub as unknown[]) : [], label, path };
}

function commitAt(edit: CubeEditBinding, path: CubePath, value: unknown) {
  edit.save(setAtPath(edit.records(), path, value));
  cubePopup.refresh();
}

function InlineCell({ value, onCommit }: { value: unknown; onCommit: (text: string) => void }) {
  const [draft, setDraft] = useState(cellTextOf(value));
  useEffect(() => { setDraft(cellTextOf(value)); }, [value]);
  return (
    <input
      className="table-popup__input table-popup__input--text"
      value={draft}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== cellTextOf(value)) onCommit(draft); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") { setDraft(cellTextOf(value)); e.currentTarget.blur(); e.stopPropagation(); }
      }}
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
    />
  );
}

const stop = (e: React.MouseEvent | React.PointerEvent) => e.stopPropagation();
const chipClass = (mod: "cube" | "frame" | "array") => `solenoid-array-chip solenoid-array-chip--${mod} solenoid-array-chip--sm`;

/** One editable cell of a record at [row, key] under `path` (cube and table levels). */
export function CubeEditCell({ edit, path, row, column }: {
  edit: CubeEditBinding;
  path: CubePath;
  row: number;
  column: string;
}): ReactNode {
  const records = edit.records();
  const cellPath: CubePath = [...path, row, column];
  const value = getAtPath(records, cellPath);
  const shape = recordsShape(value);
  if (shape === "list" || shape === "empty") {
    const list = (value ?? []) as unknown[];
    return (
      <button type="button" className={chipClass("array")} title={`${list.length}-item list. Drill in and edit.`}
        onPointerDown={stop} onMouseDown={stop} onClick={(e) => { stop(e); cubePopup.drill(listViewAt(records, cellPath, column)); }}>
        [List]
      </button>
    );
  }
  if (shape === "frame") {
    const rows = value as CubeRecord[];
    return (
      <button type="button" className={chipClass("frame")} title={`Frame ${rows.length}×${Object.keys(rows[0] ?? {}).length}. Drill in and edit.`}
        onPointerDown={stop} onMouseDown={stop} onClick={(e) => { stop(e); cubePopup.drill(frameViewAt(records, cellPath, column)); }}>
        [{rows.length}×{Object.keys(rows[0] ?? {}).length} Frame]
      </button>
    );
  }
  if (shape === "cube") {
    const rows = Array.isArray(value) ? (value as CubeRecord[]) : [value as CubeRecord];
    const c = recordsToCube(rows);
    const dims = `${cubeRowCount(c)}×${c.columns.length}×${cubeDepth(c)}`;
    return (
      <button type="button" className={chipClass("cube")} title={`Cube ${dims} (rows × cols × depth). Drill in and edit.`}
        onPointerDown={stop} onMouseDown={stop} onClick={(e) => { stop(e); cubePopup.drill(cubeViewAt(records, cellPath, column)); }}>
        [{dims} Cube]
      </button>
    );
  }
  return <InlineCell value={value} onCommit={(text) => commitAt(edit, cellPath, parseCellText(text))} />;
}

/** One editable item of a list level at index `row` under `path`. */
export function ListEditCell({ edit, path, row }: { edit: CubeEditBinding; path: CubePath; row: number }): ReactNode {
  const value = getAtPath(edit.records(), [...path, row]);
  return <InlineCell value={value} onCommit={(text) => commitAt(edit, [...path, row], parseCellText(text))} />;
}

/** The column keys of a record list, in first-seen order (the order the cube shows). */
function keysOf(list: unknown[]): string[] {
  const keys: string[] = [];
  for (const r of list) if (r && typeof r === "object" && !Array.isArray(r)) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  return keys;
}

/** An editable column header of a table / cube level: renaming the key on every row keeps
 *  its position. Enter/blur commits; Escape reverts. */
export function CubeEditHeader({ edit, path, column }: { edit: CubeEditBinding; path: CubePath; column: string }): ReactNode {
  const rename = (next: string) => {
    const key = next.trim();
    if (!key || key === column) return;
    const records = edit.records();
    const level = (path.length ? getAtPath(records, path) : records) as unknown[];
    if (!Array.isArray(level) || keysOf(level).includes(key)) return;
    const renamed = level.map((r) => {
      if (!r || typeof r !== "object" || Array.isArray(r)) return r;
      return Object.fromEntries(Object.entries(r as CubeRecord).map(([k, v]) => [k === column ? key : k, v]));
    });
    commitAt(edit, path, renamed);
  };
  return (
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
}

/** Footer controls for the current level: add / remove a row (a record, or a list item);
 *  a table or cube level also adds / removes a column (the last key on every row). New
 *  columns arrive as "Column N"; the header renames them. */
export function CubeEditRows({ edit, view, rows }: { edit: CubeEditBinding; view: DrillView; rows: number }): ReactNode {
  const path = view.path ?? [];
  const records = edit.records();
  const level = (path.length ? getAtPath(records, path) : records) as unknown[] | undefined;
  const list = Array.isArray(level) ? level : [];
  const isList = view.kind === "list";
  const keys = isList ? [] : keysOf(list);
  const add = () => commitAt(edit, path, [...list, isList ? null : {}]);
  const remove = () => { if (list.length) commitAt(edit, path, list.slice(0, -1)); };
  const addColumn = () => {
    let n = keys.length + 1;
    while (keys.includes(`Column ${n}`)) n++;
    const key = `Column ${n}`;
    const base = list.length ? (list as CubeRecord[]) : [{}];
    commitAt(edit, path, base.map((r) => (r && typeof r === "object" && !Array.isArray(r) ? (key in r ? r : { ...r, [key]: null }) : r)));
  };
  const removeColumn = () => {
    const last = keys[keys.length - 1];
    if (last === undefined) return;
    commitAt(edit, path, (list as CubeRecord[]).map((r) => {
      if (!r || typeof r !== "object" || Array.isArray(r)) return r;
      const { [last]: _dropped, ...rest } = r;
      return rest;
    }));
  };
  return (
    <>
      <button className="table-popup__btn" onClick={add} title={isList ? "Append an item" : "Append an empty record"}>+ Row</button>
      <button className="table-popup__btn" onClick={remove} disabled={rows === 0} title="Remove the last row">− Row</button>
      {!isList && (
        <>
          <button className="table-popup__btn" onClick={addColumn} title="Add a column to every row">+ Col</button>
          <button className="table-popup__btn" onClick={removeColumn} disabled={keys.length === 0} title="Remove the last column from every row">− Col</button>
        </>
      )}
    </>
  );
}
