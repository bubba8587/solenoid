// [[script-sandbox]]
import { solError, isSolError, type SolError } from "../errorValue";
import { jsDateToSerial, serialToJsDate } from "./dateSerial";
import { isCx } from "../cxValue";
import { isSolDateTag } from "./scriptRun";
import { isSolDate, solDate } from "../dateValue";
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

type CellFamily = "number" | "text" | "date" | "logical" | "complex";
type Vote = CellFamily | "mixed" | null;

function combine(a: Vote, b: Vote): Vote {
  if (a === null) return b;
  if (b === null) return a;
  return a === b ? a : "mixed";
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

function isRowObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    && !(v instanceof Date) && !isSolError(v) && !isSolDateTag(v) && !isCx(v)
    && !("__unclonable" in v);
}

/** A date goes in as a JavaScript `Date`, never as its serial ([[C137]] datesNeverSerials); lists map through. */
function asDate(v: unknown): unknown {
  if (typeof v === "number") return Number.isFinite(v) ? serialToJsDate(v) : v;
  if (Array.isArray(v)) return v.map(asDate);
  return v;
}

/** Each date in a value as a JS `Date` ([[D114]] dateIsAKind). */
function datesToJs(v: unknown): unknown {
  if (isSolDate(v)) return Number.isFinite(v.__date) ? serialToJsDate(v.__date) : v.__date;
  if (Array.isArray(v)) return v.map(datesToJs);
  return v;
}

function frameToRows(f: FrameValue): Record<string, unknown>[] {
  const n = frameRowCount(f);
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const r: Record<string, unknown> = {};
    for (const c of f.columns) r[c.name] = c.type === "date" ? asDate(c.values[i] ?? null) : c.values[i] ?? null;
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

function cubeToRows(c: CubeValue): Record<string, unknown>[] {
  const n = c.columns.reduce((m, col) => Math.max(m, col.cells.length), 0);
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const r: Record<string, unknown> = {};
    for (const col of c.columns) {
      const js = cubeCellToJs(col.cells[i] ?? null);
      r[col.name] = col.type === "date" ? asDate(js) : js;
    }
    rows.push(r);
  }
  return rows;
}

/** `dated`: the input's settled type is a date family, so its numbers are serials. */
export async function scriptArgToJs(v: unknown): Promise<unknown> {
  if (isLambdaValue(v) || isChartValue(v) || isDocumentValue(v)) {
    const kind = isLambdaValue(v) ? "a lambda" : isChartValue(v) ? "a chart" : "a document";
    return solError("#TYPE!", `A script reads data values; ${kind} has no script form`);
  }
  if (isFrameRef(v) || isFrameValue(v)) {
    // Collect the full frame through a preview's `__ref`, never the truncated preview.
    const full = await readFrame(isFrameValue(v) && v.__ref ? (v.__ref as unknown as FrameInput) : (v as FrameInput));
    if (full == null || isSolError(full)) return full;
    return frameToRows(full);
  }
  if (isCubeValue(v)) return cubeToRows(v);
  return datesToJs(v);
}

const COL_TYPE: Record<Exclude<CellFamily, "complex">, FrameColType> = {
  number: "number", text: "string", date: "date", logical: "logical",
};

function rowKeys(rows: Record<string, unknown>[]): string[] {
  const names: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!names.includes(k)) names.push(k);
  return names;
}

function buildFrame(rows: Record<string, unknown>[], names: string[]): unknown {
  const columns: FrameColumn[] = [];
  for (const name of names) {
    let vote: Vote = null;
    const cells: FrameCell[] = [];
    for (const r of rows) {
      const c = coerceCell(r[name]);
      if (!isSolError(c.value)) vote = combine(vote, c.family);
      if (c.family === "complex") {
        return solError("#TYPE!", `Column "${name}" holds complex numbers; a frame column is numbers, text, dates, or booleans`);
      }
      cells.push(c.value as FrameCell);
    }
    if (vote === "mixed") {
      return solError("#AMBIGUOUS!", `Column "${name}" mixes value types; a frame column is one type`);
    }
    const type: FrameColType = vote === null || vote === "complex" ? "string" : COL_TYPE[vote];
    columns.push({ name, type, values: cells });
  }
  const frame: FrameValue = { __frame: true, columns };
  return frame;
}

function cubeCellFromJs(v: unknown): CubeCell | SolError {
  if (Array.isArray(v)) {
    if (v.length > 0 && v.every(isRowObject)) {
      const nested = buildRows(v);
      return nested as SolError | CubeCell;
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
    return nested as SolError | CubeCell;
  }
  return coerceCell(v).value as CubeCell;
}

function buildCube(rows: Record<string, unknown>[], names: string[]): unknown {
  const cols: Array<{ name: string; cells: CubeCell[] }> = [];
  for (const name of names) {
    const cells: CubeCell[] = [];
    for (const r of rows) {
      const cell = cubeCellFromJs(r[name]);
      if (isSolError(cell) && (Array.isArray(r[name]) || isRowObject(r[name]))) {
        return cell;
      }
      cells.push(cell as CubeCell);
    }
    cols.push({ name, cells });
  }
  return cubeFromColumns(cols);
}

function buildRows(rows: Record<string, unknown>[]): unknown {
  const names = rowKeys(rows);
  if (names.length === 0) {
    return solError("#SHAPE!", "Returned rows with no named values; give each row at least one {name: value}");
  }
  const nests = rows.some((r) => names.some((k) => Array.isArray(r[k]) || isRowObject(r[k])));
  return nests ? buildCube(rows, names) : buildFrame(rows, names);
}

/** A loose cell as it leaves the script: a date as a date ([[D114]] dateIsAKind); a table's cells stay as its columns hold them. */
function looseCell(c: unknown): { value: unknown; family: CellFamily | null } {
  const r = coerceCell(c);
  return r.family === "date" && typeof r.value === "number" ? { value: solDate(r.value), family: "date" } : r;
}

export function coerceScriptResult(v: unknown): unknown {
  if (isRowObject(v)) return buildRows([v]);
  if (!Array.isArray(v)) {
    const r = looseCell(v);
    return r.value;
  }
  if (v.length === 0) return [];
  const objRows = v.filter(isRowObject).length;
  if (objRows === v.length) return buildRows(v as Record<string, unknown>[]);
  if (objRows > 0) {
    return solError("#SHAPE!", "Returned {name: value} rows mixed with other values; a frame is rows of {name: value} only");
  }
  const rows = v.filter(Array.isArray).length;
  let vote: Vote = null;
  if (rows === 0) {
    const cells = v.map((c) => {
      const r = looseCell(c);
      vote = combine(vote, r.family);
      return r.value;
    });
    if (vote === "mixed") {
      return solError("#AMBIGUOUS!", "Returned a list that mixes value types; a list is one type. For a mixed row, return {name: value} rows");
    }
    return cells;
  }
  if (rows !== v.length) return solError("#SHAPE!", "Returned values mixed with rows; return a list, or a list of rows");
  const width = (v as unknown[][]).reduce((w, r) => Math.max(w, r.length), 0);
  const out: unknown[][] = [];
  for (const row of v as unknown[][]) {
    if (row.some(Array.isArray)) return solError("#SHAPE!", "Returned rows nested deeper than a table; return a list of rows");
    const cells = row.map((c) => {
      const r = looseCell(c);
      vote = combine(vote, r.family);
      return r.value;
    });
    while (cells.length < width) cells.push(null);
    out.push(cells);
  }
  if (vote === "mixed") {
    return solError("#AMBIGUOUS!", "Returned rows that mix value types; a table is single-typed. For typed columns, return {name: value} rows");
  }
  return out;
}
