// Folds a script's return value onto the value model. Nothing leaves the Script node
// that is not already a Solenoid value, and the value TYPES ITSELF: numbers, text and
// booleans are their own families, a `Date` (or `Solenoid.date(serial)`) is a date,
// a non-number is #DOMAIN!, an unsupported object is #TYPE!; at the top, a shape that
// is neither a value, a list, rows of values, nor `{name: value}` row objects is
// #SHAPE!. The inferred family drives the result socket (script.ts reconciles it,
// alongside rank).
//
// Containers are SINGLE-TYPED, uniformly: a list or table mixing families is
// #AMBIGUOUS!, never a mixed anylist/anytable — mixed-by-nature data is a FRAME, and
// row objects build one (each column typed, per-column homogeneity enforced the same
// way; unitGranularity's "a frame ROW is legitimately mixed" is the frame's job).
// Rows whose cells themselves nest rows or lists build a CUBE, the one container
// whose cells are loose by type (`CubeCell`). The input side mirrors all of it:
// `scriptArgToJs` hands the script frames and cubes as the same rows-of-objects.
import { solError, isSolError, type SolError } from "../errorValue";
import { jsDateToSerial } from "./dateSerial";
import { isCx } from "../cxValue";
import { isSolDateTag } from "./scriptRun";
import type { ResultType } from "./shared";
import type { ProducedFamily } from "./expression";
import { isFrameValue, isCubeValue, frameRowCount, cubeFromColumns, type FrameValue, type FrameColumn, type FrameCell, type FrameColType, type CubeValue, type CubeCell } from "../frame";
import { readFrame, isFrameRef, type FrameInput } from "../frameBackend";
import { isUnitCell } from "../unitValue";
import { displayMagnitudeOf } from "../unitBridge";
import { isLambdaValue } from "../lambdaValue";
import { isChartValue } from "../chartValue";
import { isDocumentValue } from "../documentValue";

function describe(v: unknown): string {
  if (typeof v === "object" && v !== null && "__unclonable" in v) {
    const k = (v as { __unclonable: string }).__unclonable;
    return k === "function" ? "a function" : k === "symbol" ? "a symbol" : `a ${k}`;
  }
  if (Array.isArray(v)) return "a list";
  return typeof v === "object" ? "an object" : `a ${typeof v}`;
}

// The element family a cell carries; blanks and errors carry none.
type CellFamily = "number" | "text" | "date" | "logical" | "complex";
type Vote = CellFamily | "mixed" | null;

function combine(a: Vote, b: Vote): Vote {
  if (a === null) return b;
  if (b === null) return a;
  return a === b ? a : "mixed";
}

/** The socket family a settled vote maps to: logical and complex values are
 *  first-class but have no result socket of their own, so they ride the wildcard. */
function toSocketFamily(v: Vote): ResultType | null {
  if (v === null || v === "mixed") return null;
  if (v === "number" || v === "text" || v === "date") return v;
  return "auto";
}

function coerceCell(c: unknown): { value: unknown; family: CellFamily | null } {
  if (c === null || c === undefined) return { value: null, family: null };
  if (isSolError(c)) return { value: c, family: null };
  if (isSolDateTag(c)) {
    const n = c.__solDate;
    if (typeof n !== "number" || !Number.isFinite(n)) {
      return { value: solError("#TYPE!", "Solenoid.date takes a date serial number or a Date"), family: null };
    }
    return { value: n, family: "date" };
  }
  if (typeof c === "bigint") {
    if (c > BigInt(Number.MAX_SAFE_INTEGER) || c < -BigInt(Number.MAX_SAFE_INTEGER)) {
      return { value: solError("#OVERFLOW!", "The result is too large to represent exactly"), family: null };
    }
    return { value: Number(c), family: "number" };
  }
  if (c instanceof Date) {
    if (Number.isNaN(c.getTime())) return { value: solError("#DOMAIN!", "The result is an invalid date"), family: null };
    return { value: jsDateToSerial(c), family: "date" };
  }
  if (typeof c === "number") {
    if (Number.isNaN(c)) return { value: solError("#DOMAIN!", "The result is not a number"), family: null };
    return { value: c, family: "number" };
  }
  if (typeof c === "boolean") return { value: c, family: "logical" };
  if (typeof c === "string") return { value: c, family: "text" };
  if (isCx(c)) return { value: c, family: "complex" };
  return { value: solError("#TYPE!", `Returned ${describe(c)}; return numbers, text, booleans, dates, lists of them, or {name: value} rows`), family: null };
}

/** A `{name: value}` row destined for a frame — a plain object that is not any of
 *  the value kinds a cell can be. */
function isRowObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    && !(v instanceof Date) && !isSolError(v) && !isSolDateTag(v) && !isCx(v)
    && !("__unclonable" in v);
}

// ─── Input side: a wired value → the plain JS the script reads ────────────────

/** Rows of `{name: value}` from a frame — the exact mirror of the output form, so
 *  what one script emits another can read. Date columns stay serials, unit-locked
 *  columns stay as-typed magnitudes (both are how the cells are stored). */
function frameToRows(f: FrameValue): Record<string, unknown>[] {
  const n = frameRowCount(f);
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const r: Record<string, unknown> = {};
    for (const c of f.columns) r[c.name] = c.values[i] ?? null;
    rows.push(r);
  }
  return rows;
}

function cubeCellToJs(cell: CubeCell): unknown {
  if (cell == null) return null;
  if (isCubeValue(cell)) return cubeToRows(cell);
  if (isFrameValue(cell)) return frameToRows(cell);
  if (isUnitCell(cell)) return displayMagnitudeOf(cell);
  if (Array.isArray(cell)) return cell.map(cubeCellToJs);
  return cell;
}

/** A cube as rows whose cells may hold nested rows or lists — again the mirror of
 *  the output form. Nested frames are assumed eager (cubes are built materialized). */
function cubeToRows(c: CubeValue): Record<string, unknown>[] {
  const n = c.columns.reduce((m, col) => Math.max(m, col.cells.length), 0);
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const r: Record<string, unknown> = {};
    for (const col of c.columns) r[col.name] = cubeCellToJs(col.cells[i] ?? null);
    rows.push(r);
  }
  return rows;
}

/** A wired input value → what the script's parameter receives: frames (lazy handles
 *  and head-N previews re-collected in FULL — never a silent truncation) and cubes
 *  become rows of `{name: value}`; lambdas, charts and documents have no script form
 *  and error before the script runs. Everything else passes through untouched. */
export async function scriptArgToJs(v: unknown): Promise<unknown> {
  if (isLambdaValue(v) || isChartValue(v) || isDocumentValue(v)) {
    const kind = isLambdaValue(v) ? "a lambda" : isChartValue(v) ? "a chart" : "a document";
    return solError("#TYPE!", `A script reads data values; ${kind} has no script form`);
  }
  if (isFrameRef(v) || isFrameValue(v)) {
    // A head-N preview carries its lazy handle as `__ref` (structurally typed to
    // avoid a frame ↔ frameBackend cycle) — collect the FULL frame through it.
    const full = await readFrame(isFrameValue(v) && v.__ref ? (v.__ref as unknown as FrameInput) : (v as FrameInput));
    if (full == null || isSolError(full)) return full;
    return frameToRows(full);
  }
  if (isCubeValue(v)) return cubeToRows(v);
  return v;
}

const COL_TYPE: Record<Exclude<CellFamily, "complex">, FrameColType> = {
  number: "number", text: "string", date: "date", logical: "logical",
};

/** Column names across the rows, in order of first appearance. */
function rowKeys(rows: Record<string, unknown>[]): string[] {
  const names: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!names.includes(k)) names.push(k);
  return names;
}

/** Rows of `{name: value}` → a frame: columns are the keys in order of first
 *  appearance, each column typed by its cells and single-typed like any container. */
function buildFrame(rows: Record<string, unknown>[], names: string[]): { value: unknown; family: ProducedFamily | null } {
  const columns: FrameColumn[] = [];
  for (const name of names) {
    let vote: Vote = null;
    const cells: FrameCell[] = [];
    for (const r of rows) {
      const c = coerceCell(r[name]);
      if (!isSolError(c.value)) vote = combine(vote, c.family);
      if (c.family === "complex") {
        return { value: solError("#TYPE!", `Column "${name}" holds complex numbers; a frame column is numbers, text, dates, or booleans`), family: null };
      }
      cells.push(c.value as FrameCell);
    }
    if (vote === "mixed") {
      return { value: solError("#AMBIGUOUS!", `Column "${name}" mixes value types; a frame column is one type`), family: null };
    }
    const type: FrameColType = vote === null || vote === "complex" ? "string" : COL_TYPE[vote];
    columns.push({ name, type, values: cells });
  }
  const frame: FrameValue = { __frame: true, columns };
  return { value: frame, family: "frame" };
}

/** A nested cell of a cube column: rows recurse, a list coerces per cell (each cell
 *  single-kinded on its own; a cube column carries no homogeneity guarantee — that is
 *  the cube's looseness by type, `CubeCell`). Returns a SolError to abort the build. */
function cubeCellFromJs(v: unknown): CubeCell | SolError {
  if (Array.isArray(v)) {
    if (v.length > 0 && v.every(isRowObject)) {
      const nested = buildRows(v);
      return isSolError(nested.value) ? (nested.value as SolError) : (nested.value as CubeCell);
    }
    const cells: CubeCell[] = [];
    for (const c of v) {
      const cell = cubeCellFromJs(c);
      cells.push(cell as CubeCell);
    }
    return cells;
  }
  if (isRowObject(v)) {
    const nested = buildRows([v]);
    return isSolError(nested.value) ? (nested.value as SolError) : (nested.value as CubeCell);
  }
  return coerceCell(v).value as CubeCell;
}

/** Rows of `{name: value}` where some cells nest rows or lists → a CUBE. */
function buildCube(rows: Record<string, unknown>[], names: string[]): { value: unknown; family: ProducedFamily | null } {
  const cols: Array<{ name: string; cells: CubeCell[] }> = [];
  for (const name of names) {
    const cells: CubeCell[] = [];
    for (const r of rows) {
      const cell = cubeCellFromJs(r[name]);
      // A nested build's structural refusal (#SHAPE!/#AMBIGUOUS! inside a nested
      // frame) aborts the whole result; a plain bad CELL stays a cell error.
      if (isSolError(cell) && (Array.isArray(r[name]) || isRowObject(r[name]))) {
        return { value: cell, family: null };
      }
      cells.push(cell as CubeCell);
    }
    cols.push({ name, cells });
  }
  return { value: cubeFromColumns(cols), family: "cube" };
}

/** Rows of `{name: value}` → a frame, or — when any cell nests rows or a list — a
 *  cube (the container whose cells may hold frames and lists). */
function buildRows(rows: Record<string, unknown>[]): { value: unknown; family: ProducedFamily | null } {
  const names = rowKeys(rows);
  if (names.length === 0) {
    return { value: solError("#SHAPE!", "Returned rows with no named values; give each row at least one {name: value}"), family: null };
  }
  const nests = rows.some((r) => names.some((k) => Array.isArray(r[k]) || isRowObject(r[k])));
  return nests ? buildCube(rows, names) : buildFrame(rows, names);
}

/** The whole return value: a scalar, a list, rows of values (padded with null when
 *  ragged, as every broadcaster pads), or `{name: value}` row objects, which become a
 *  FRAME. Anything deeper or mixed-with-rows is #SHAPE!; a list or rows mixing
 *  families is #AMBIGUOUS!. `family` is what the value votes onto the result socket —
 *  null when it casts no vote. */
export function coerceScriptResult(v: unknown): { value: unknown; family: ProducedFamily | null } {
  if (isRowObject(v)) return buildRows([v]);
  if (!Array.isArray(v)) {
    const r = coerceCell(v);
    return { value: r.value, family: toSocketFamily(r.family) };
  }
  if (v.length === 0) return { value: [], family: null };
  const objRows = v.filter(isRowObject).length;
  if (objRows === v.length) return buildRows(v as Record<string, unknown>[]);
  if (objRows > 0) {
    return { value: solError("#SHAPE!", "Returned {name: value} rows mixed with other values; a frame is rows of {name: value} only"), family: null };
  }
  const rows = v.filter(Array.isArray).length;
  let vote: Vote = null;
  if (rows === 0) {
    const cells = v.map((c) => {
      const r = coerceCell(c);
      vote = combine(vote, r.family);
      return r.value;
    });
    if (vote === "mixed") {
      return { value: solError("#AMBIGUOUS!", "Returned a list that mixes value types; a list is one type. For a mixed row, return {name: value} rows"), family: null };
    }
    return { value: cells, family: toSocketFamily(vote) };
  }
  if (rows !== v.length) return { value: solError("#SHAPE!", "Returned values mixed with rows; return a list, or a list of rows"), family: null };
  const width = Math.max(...(v as unknown[][]).map((r) => r.length));
  const out: unknown[][] = [];
  for (const row of v as unknown[][]) {
    if (row.some(Array.isArray)) return { value: solError("#SHAPE!", "Returned rows nested deeper than a table; return a list of rows"), family: null };
    const cells = row.map((c) => {
      const r = coerceCell(c);
      vote = combine(vote, r.family);
      return r.value;
    });
    while (cells.length < width) cells.push(null);
    out.push(cells);
  }
  if (vote === "mixed") {
    return { value: solError("#AMBIGUOUS!", "Returned rows that mix value types; a table is single-typed. For typed columns, return {name: value} rows"), family: null };
  }
  return { value: out, family: toSocketFamily(vote) };
}
