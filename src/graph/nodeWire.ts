// [[D102]] graphOnCore
// The values cards hand each other, as the core's card bodies read and answer them (`crates/solenoid-core/src/nodes/
// values.rs`): a frame and a cube cell by cell, plain data (a chart, a document, an image) whole as JSON with its
// special numbers tagged, and everything else as `coreValue` sends it.
import { coreValue, readReply } from "./coreValues";
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
  if (Array.isArray(v)) return all(v);
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
      const cells = all(c.cells);
      if (!cells) return undefined;
      columns.push({ name: c.name, cells, ...(c.type ? { type: c.type } : {}), ...(c.format !== undefined ? { format: jsonEnc(c.format) } : {}) });
    }
    return { __cube: { columns } };
  }
  if (v && typeof v === "object" && isPlainData(v)) return { __json: jsonEnc(v) };
  return coreValue(v, true);
}

type Wire = { frame?: { columns: Record<string, unknown>[]; totalRows?: number; approx?: unknown }; cube?: { columns: Record<string, unknown>[] }; json?: unknown; list?: unknown[] };

/** A card body's answer back as a JS value; `{ none }` where it holds something JS can't take (a LAMBDA). */
export function readNodeReply(r: unknown): { value: unknown } | null {
  const o = r as Wire | null;
  if (!o || typeof o !== "object" || Array.isArray(o)) return readReply(r);
  if (o.list) {
    const items: unknown[] = [];
    for (const x of o.list) {
      const v = readNodeReply(x);
      if (!v) return null;
      items.push(v.value);
    }
    return { value: items };
  }
  if ("json" in o) return { value: jsonDec(o.json) };
  if (o.frame) {
    const columns: FrameColumn[] = [];
    for (const c of o.frame.columns) {
      const values = readNodeReply({ list: c.values as unknown[] });
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
      const cells = readNodeReply({ list: c.cells as unknown[] });
      if (!cells) return null;
      columns.push({ name: c.name as string, cells: cells.value as CubeColumn["cells"], ...(c.type ? { type: c.type as CubeColumn["type"] } : {}),
        ...("format" in c ? { format: jsonDec(c.format) as CubeColumn["format"] } : {}) });
    }
    return { value: makeCube(columns) satisfies CubeValue };
  }
  return readReply(r);
}
