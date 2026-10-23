// [[D102]] graphOnCore
// The values cards hand each other, as the core's card bodies read and answer them (`crates/solenoid-core/src/nodes/
// values.rs`): a frame and a cube cell by cell, plain data (a chart, a document, an image) whole as JSON with its
// special numbers tagged, and everything else as `coreValue` sends it.
import { coreValue, readReply } from "./coreValues";
import { solError, type SolErrorCode } from "./errorValue";
import { cx } from "./cxValue";
import { matrixUnitOf, withMatrixUnit, type ColumnUnit } from "./unitValue";
import { isFrameValue, isCubeValue, makeCube, type FrameValue, type CubeValue, type CubeColumn, type FrameColumn } from "./frame";

/** The plain-data kinds a card makes whole, by their marker field. */
const DATA_MARKERS = ["__chart", "__document", "__image", "__svg", "__mermaid"] as const;

/** JSON with what JSON can't hold tagged: non-finite numbers, -0, undefined. */
export function jsonEnc(v: unknown): unknown {
  if (v === undefined) return { __undef: 1 };
  if (typeof v === "number") {
    if (Number.isNaN(v)) return { __nf: "nan" };
    if (!Number.isFinite(v)) return { __nf: v > 0 ? "inf" : "-inf" };
    return Object.is(v, -0) ? { __nf: "-0" } : v;
  }
  if (Array.isArray(v)) return v.map(jsonEnc);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (typeof x !== "function") out[k] = jsonEnc(x);
    return out;
  }
  return v;
}

export function jsonDec(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(jsonDec);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("__undef" in o) return undefined;
    if (typeof o.__nf === "string") return { nan: NaN, inf: Infinity, "-inf": -Infinity, "-0": -0 }[o.__nf];
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) out[k] = jsonDec(x);
    return out;
  }
  return v;
}

function isPlainData(v: object): boolean {
  return DATA_MARKERS.some((m) => (v as Record<string, unknown>)[m] === true);
}

function all(vs: readonly unknown[]): unknown[] | undefined {
  const out = vs.map(nodeWire);
  return out.includes(undefined) ? undefined : out;
}

/** A value as a card body on the core reads it; undefined where it can't cross (a frame ref, a closure, other objects). */
export function nodeWire(v: unknown): unknown {
  if (Array.isArray(v)) {
    const cells = all(v);
    // A table's unit is a hidden field on the array (`withMatrixUnit`), so it crosses beside the cells.
    const unit = matrixUnitOf(v);
    return cells && unit ? { __munit: jsonEnc(unit), m: cells } : cells;
  }
  if (isFrameValue(v)) {
    const columns: unknown[] = [];
    for (const c of v.columns) {
      const values = all(c.values);
      if (!values) return undefined;
      columns.push({ name: c.name, type: c.type, values, ...(c.unit ? { unit: jsonEnc(c.unit) } : {}),
        ...(c.format !== undefined ? { format: jsonEnc(c.format) } : {}), ...(c.raw ? { raw: c.raw } : {}) });
    }
    return { __frame: { columns, ...(v.__totalRows !== undefined ? { totalRows: v.__totalRows } : {}), ...(v.__approx ? { approx: jsonEnc(v.__approx) } : {}) } };
  }
  if (isCubeValue(v)) {
    const columns: unknown[] = [];
    for (const c of v.columns) {
      if (!Array.isArray(c.cells)) return undefined;
      const cells = all(c.cells);
      if (!cells) return undefined;
      columns.push({ name: c.name, cells, ...(c.type ? { type: c.type } : {}), ...(c.format !== undefined ? { format: jsonEnc(c.format) } : {}) });
    }
    return { __cube: { columns } };
  }
  // A frame ref is a backend handle and a plan of ops, plain data a card extends; the backend runs the plan later.
  if (v && typeof v === "object" && (isPlainData(v) || "__frameRef" in v)) return { __json: jsonEnc(v) };
  return coreValue(v, true);
}

type Wire = { frame?: { columns: Record<string, unknown>[]; totalRows?: number; approx?: unknown }; cube?: { columns: Record<string, unknown>[] }; json?: unknown; list?: unknown[] };

/** A list's items or a frame's or a cube's cells: a bare number, text or logical is itself (`nodes/values.rs` `Cell`). */
function cells(vs: unknown[]): { value: unknown[] } | null {
  // The parsed array is the reply's own, so where every cell is plain it is the column as it stands. (A preallocated
  // array of a million holes would be V8's slow dictionary kind.)
  if (vs.every((x) => x === null || typeof x !== "object")) return { value: vs };
  let failed = false;
  // A non-finite or -0 cell crosses as its bits; a column of them (a schedule past overflow) shares a handful.
  const bits = new Map<string, unknown>();
  const out = vs.map((x) => {
    if (x === null || typeof x !== "object") return x;
    const num = (x as { num?: string }).num;
    if (num !== undefined && bits.has(num)) return bits.get(num);
    const v = readNodeReply(x);
    if (num !== undefined && v) bits.set(num, v.value);
    if (!v) failed = true;
    return v?.value;
  });
  return failed ? null : { value: out };
}

/** A card body's answer back as a JS value; `{ none }` where it holds something JS can't take (a LAMBDA). */
export function readNodeReply(r: unknown): { value: unknown } | null {
  if (typeof r === "number" || typeof r === "string" || typeof r === "boolean") return { value: r };
  const o = r as Wire | null;
  if (!o || typeof o !== "object" || Array.isArray(o)) return readReply(r);
  if (o.list) return cells(o.list);
  if ("json" in o) return { value: jsonDec(o.json) };
  if (o.frame) {
    const columns: FrameColumn[] = [];
    for (const c of o.frame.columns) {
      const values = cells(c.values as unknown[]);
      if (!values) return null;
      columns.push({ name: c.name as string, type: c.type as FrameColumn["type"], values: values.value as FrameColumn["values"],
        ...(c.unit ? { unit: jsonDec(c.unit) as FrameColumn["unit"] } : {}), ...("format" in c ? { format: jsonDec(c.format) as FrameColumn["format"] } : {}),
        ...(c.raw ? { raw: c.raw as string[] } : {}) });
    }
    const f: FrameValue = { __frame: true, columns };
    if (o.frame.totalRows !== undefined) f.__totalRows = o.frame.totalRows;
    if (o.frame.approx) f.__approx = jsonDec(o.frame.approx) as FrameValue["__approx"];
    return { value: f };
  }
  if (o.cube) {
    const columns: CubeColumn[] = [];
    for (const c of o.cube.columns) {
      const read = cells(c.cells as unknown[]);
      if (!read) return null;
      columns.push({ name: c.name as string, cells: read.value as CubeColumn["cells"], ...(c.type ? { type: c.type as CubeColumn["type"] } : {}),
        ...("format" in c ? { format: jsonDec(c.format) as CubeColumn["format"] } : {}) });
    }
    return { value: makeCube(columns) satisfies CubeValue };
  }
  return readReply(r);
}

/** `nodeWire`'s inverse, for a frozen case's values: a LAMBDA comes back as its wire form. */
export function nodeUnwire(w: unknown): unknown {
  if (Array.isArray(w)) return w.map(nodeUnwire);
  if (!w || typeof w !== "object") return w;
  const o = w as Record<string, unknown>;
  if ("__munit" in o) return withMatrixUnit(nodeUnwire(o.m), jsonDec(o.__munit) as ColumnUnit);
  if ("__undef" in o) return undefined;
  if (typeof o.__nf === "string") return { nan: NaN, inf: Infinity, "-inf": -Infinity, "-0": -0 }[o.__nf];
  if (typeof o.__err === "string") return solError(o.__err as SolErrorCode, String(o.msg ?? ""));
  if (Array.isArray(o.__cx)) return cx(nodeUnwire(o.__cx[0]) as number, nodeUnwire(o.__cx[1]) as number);
  if (o.__unit) {
    const u = o.__unit as { value: unknown; dim?: Record<string, unknown>; display?: string; ratio?: boolean };
    const dim = Object.fromEntries(Object.entries(u.dim ?? {}).map(([k, x]) => [k, nodeUnwire(x) as number]));
    return { __unitCell: true, value: nodeUnwire(u.value), dim, ...(u.display ? { display: u.display } : {}), ...(u.ratio ? { ratio: true } : {}) };
  }
  if ("__json" in o) return jsonDec(o.__json);
  if (o.__frame) {
    const f = o.__frame as { columns: Record<string, unknown>[]; totalRows?: number; approx?: unknown };
    const out: FrameValue = { __frame: true, columns: f.columns.map((c) => ({ name: c.name as string, type: c.type as FrameColumn["type"], values: nodeUnwire(c.values) as FrameColumn["values"],
      ...(c.unit ? { unit: jsonDec(c.unit) as FrameColumn["unit"] } : {}), ...("format" in c ? { format: jsonDec(c.format) as FrameColumn["format"] } : {}), ...(c.raw ? { raw: c.raw as string[] } : {}) })) };
    if (f.totalRows !== undefined) out.__totalRows = f.totalRows;
    if (f.approx) out.__approx = jsonDec(f.approx) as FrameValue["__approx"];
    return out;
  }
  if (o.__cube) {
    const c = o.__cube as { columns: Record<string, unknown>[] };
    return makeCube(c.columns.map((col) => ({ name: col.name as string, cells: nodeUnwire(col.cells) as CubeColumn["cells"], ...(col.type ? { type: col.type as CubeColumn["type"] } : {}),
      ...("format" in col ? { format: jsonDec(col.format) as CubeColumn["format"] } : {}) })));
  }
  return w;
}
