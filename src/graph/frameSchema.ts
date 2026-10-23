// [[C25]] firstClassUnits, [[D41]] formatFlowsDownstream, [[D99]] rustIsSpec
// The units and formats a frame verb leaves on its columns. The engines see no units: a column's unit and format ride
// beside its cells in the TS, so each verb's answer gets them back from the schema it read, by these rules, and the
// lowering hands an aggregate the scales it needs (`withUnitScales`).
import { solError } from "./errorValue";
import type { FrameColumn, FrameValue } from "./frame";
import type { FormatAnnotation } from "./formatAnnotationStore";
import type { AggOp, FrameOp, JoinOpts, PivotSpec, WindowFn } from "./frameOps";
import { sameColumnUnit, isAffineDisplay, type ColumnUnit } from "./unitValue";
import { dimEqual, dimPow, formatDim } from "./dimension";
import { fcUnitToUnit } from "./unitBridge";

/** A column's unit and format: what the engines don't carry. */
export interface ColumnMeta { unit?: ColumnUnit; format?: FormatAnnotation }

const metaOf = (c: FrameColumn | undefined): ColumnMeta =>
  c ? { ...(c.unit ? { unit: c.unit } : {}), ...(c.format ? { format: c.format } : {}) } : {};
const unitOnly = (unit: ColumnUnit | undefined): ColumnMeta => (unit ? { unit } : {});

/** The display scale of an offset unit (°C 1, °F 5/9), or undefined for any other unit. */
export function readingScaleOf(unit: ColumnUnit | undefined): number | undefined {
  const d = unit?.display;
  return d && isAffineDisplay(d) ? fcUnitToUnit(d)?.scale ?? 1 : undefined;
}

/** The display scale of a linear unit other than its base (km 1000), else undefined. */
export function linearScaleOf(unit: ColumnUnit | undefined): number | undefined {
  const d = unit?.display;
  if (!d || isAffineDisplay(d)) return undefined;
  const s = fcUnitToUnit(d)?.scale;
  return s === undefined || s === 1 ? undefined : s;
}

// ─── Units through an aggregate ───
// As in a formula: a spread keeps a linear unit and a variance squares it, in base SI as VAR's is. Readings on an
// offset scale (°C, °F) have no sum, product or share (the engine answers #UNIT!); a spread is a delta in kelvin (var a
// squared one); the averages and picks stay readings.
const UNIT_KEEPING_AGGS: ReadonlySet<string> = new Set(["sum", "avg", "min", "max", "median", "mode", "first", "last"]);
const AGG_READINGS_REFUSED: ReadonlySet<AggOp> = new Set(["sum", "product", "percentof"]);
const AGG_READINGS_DELTA: Partial<Record<AggOp, 1 | 2>> = { stdev: 1, stdevp: 1, var: 2, varp: 2 };
const WINDOW_UNIT_KEEPING: ReadonlySet<WindowFn> = new Set([
  "cumsum", "cumavg", "cummin", "cummax", "lag", "lead", "diff",
  "rolling_sum", "rolling_avg", "rolling_min", "rolling_max",
  "group_sum", "group_avg", "group_min", "group_max", "first", "last",
]);
const WINDOW_READINGS_REFUSED: ReadonlySet<WindowFn> = new Set(["cumsum", "rolling_sum", "group_sum", "share", "pct_change"]);

function planUnit(unit: ColumnUnit | undefined, given: number | undefined, refused: boolean, delta: 1 | 2 | undefined, keeps: boolean): ColumnUnit | undefined {
  const kept = unit && (keeps || delta === 1) ? unit : undefined;
  if ((given ?? readingScaleOf(unit)) === undefined) return delta === 2 ? (unit ? { dim: dimPow(unit.dim, 2) } : undefined) : kept;
  if (refused) return undefined;
  if (delta === undefined) return kept;
  return { dim: dimPow(unit?.dim ?? { temperature: 1 }, delta) };
}

/** The unit an aggregate's column takes over a column of `unit`. */
export function aggUnit(op: AggOp, unit: ColumnUnit | undefined, readingScale?: number): ColumnUnit | undefined {
  return planUnit(unit, readingScale, AGG_READINGS_REFUSED.has(op), AGG_READINGS_DELTA[op], UNIT_KEEPING_AGGS.has(op));
}

function windowUnit(fn: WindowFn, unit: ColumnUnit | undefined, readingScale?: number): ColumnUnit | undefined {
  return planUnit(unit, readingScale, WINDOW_READINGS_REFUSED.has(fn), fn === "diff" ? 1 : undefined, WINDOW_UNIT_KEEPING.has(fn));
}

/** The op as an engine needs it: an aggregate or window over readings names its reading scale, and a variance over a
 *  scaled linear unit its scale. */
export function withUnitScales(f: FrameValue, op: FrameOp): FrameOp {
  const unitOf = (name: string | undefined) => f.columns.find((c) => c.name === name)?.unit;
  const scaleOf = (name: string | undefined) => readingScaleOf(unitOf(name));
  if (op.kind === "groupBy") {
    return {
      ...op,
      aggs: op.aggs.map((a) => {
        const s = a.readingScale ?? scaleOf(a.column);
        if (s !== undefined) return { ...a, readingScale: s };
        const u = AGG_READINGS_DELTA[a.op] === 2 ? a.unitScale ?? linearScaleOf(unitOf(a.column)) : undefined;
        return u === undefined ? a : { ...a, unitScale: u };
      }),
    };
  }
  if (op.kind === "window") {
    const s = op.readingScale ?? scaleOf(op.column);
    return s === undefined ? op : { ...op, readingScale: s };
  }
  return op;
}

/** A pivot's value fields as the unit-blind engine needs them (each one's reading and linear scale), and the unit each
 *  one's body columns take. */
export function pivotUnits(schema: FrameValue, spec: PivotSpec): { scales: { readingScale?: number; unitScale?: number }[]; units: (ColumnUnit | undefined)[] } {
  const names = spec.values.filter((n) => n.trim() !== "");
  const cols = names.map((n) => schema.columns.find((c) => c.name === n));
  const funcs = names.map((_, i): AggOp => spec.funcs[i] ?? spec.funcs[0] ?? "sum");
  return {
    scales: cols.map((c) => {
      const r = readingScaleOf(c?.unit), u = linearScaleOf(c?.unit);
      return { ...(r !== undefined ? { readingScale: r } : {}), ...(u !== undefined ? { unitScale: u } : {}) };
    }),
    units: cols.map((c, v) => aggUnit(funcs[v], c?.unit)),
  };
}

/** The scale and offset that read a right join key in the left key's unit; null where none is needed. Keys of
 *  different dimensions, or money in different currencies, never match: #UNIT!. */
export function joinKeyTransform(left: FrameColumn | undefined, right: FrameColumn | undefined): { scale: number; offset: number } | null {
  const lu = left?.unit, ru = right?.unit;
  if (!lu || !ru || sameColumnUnit(lu, ru)) return null;
  const isCurrency = (d: typeof lu.dim) => dimEqual(d, { currency: 1 });
  if (!dimEqual(lu.dim, ru.dim) || (isCurrency(lu.dim) && (lu.display ?? "") !== (ru.display ?? ""))) {
    throw solError("#UNIT!", `Join keys measure different things (${lu.display ?? formatDim(lu.dim)} and ${ru.display ?? formatDim(ru.dim)}). Convert one key first`);
  }
  const affine = (u: ColumnUnit) => { const x = u.display ? fcUnitToUnit(u.display) : null; return { a: x?.scale ?? 1, b: x?.offset ?? 0 }; };
  const l = affine(lu), r = affine(ru);
  return { scale: r.a / l.a, offset: (r.b - l.b) / l.a };
}

// ─── What each verb leaves ───
// Each list holds one entry per column of the verb's answer, in its order; `out` is the column count the engine
// answered, for the verbs whose width hangs on the data.

/** The unit and format each of an op's output columns takes from the schema `f` it read. */
export function opMeta(f: FrameValue, op: FrameOp, out: number): ColumnMeta[] {
  const cols = f.columns;
  const named = (n: string | undefined) => cols.find((c) => c.name === n);
  switch (op.kind) {
    case "select": {
      const seen = new Set<string>();
      return op.columns.filter((n) => !seen.has(n) && (seen.add(n), true)).map((n) => metaOf(named(n)));
    }
    case "drop": { const gone = new Set(op.columns); return cols.filter((c) => !gone.has(c.name)).map(metaOf); }
    case "groupBy":
      return [
        ...op.keys.map((k) => unitOnly(named(k)?.unit)),
        ...op.aggs.map((a) => unitOnly(aggUnit(a.op, named(a.column)?.unit, a.readingScale))),
      ];
    case "unpivot": {
      const vals = op.valueColumns.map((n) => named(n));
      const shared = vals.length > 0 && vals.every((c) => sameColumnUnit(c?.unit, vals[0]?.unit)) ? vals[0]?.unit : undefined;
      return [...op.idColumns.map((n) => unitOnly(named(n)?.unit)), {}, unitOnly(shared)];
    }
    case "pivot": {
      const keys = op.rowFields.length;
      const { units } = pivotUnits(f, op);
      return Array.from({ length: out }, (_, i) => (i < keys || units.length === 0 ? {} : unitOnly(units[(i - keys) % units.length])));
    }
    case "window": {
      const name = op.as.trim() || op.fn;
      const unit = op.column !== undefined ? windowUnit(op.fn, named(op.column)?.unit, op.readingScale) : undefined;
      return [...cols.filter((c) => c.name !== name).map(metaOf), unitOnly(unit)];
    }
    case "addIndex": return [{}, ...cols.map(metaOf)];
    case "splitColumn": {
      const at = cols.findIndex((c) => c.name === op.column);
      if (op.delimiter === "" || at < 0) return cols.map(metaOf);
      const parts = Math.max(0, out - (cols.length - 1));
      return [...cols.slice(0, at).map(metaOf), ...Array.from({ length: parts }, () => ({})), ...cols.slice(at + 1).map(metaOf)];
    }
    case "mergeColumns": {
      const gone = new Set(op.columns);
      const at = cols.findIndex((c) => c.name === op.columns[0]);
      const before = cols.slice(0, Math.max(0, at)).filter((c) => !gone.has(c.name)).map(metaOf);
      const after = cols.filter((c) => !gone.has(c.name)).map(metaOf).slice(before.length);
      return [...before, {}, ...after];
    }
    case "formats":
      return cols.map((c) => {
        const ann = Object.prototype.hasOwnProperty.call(op.formats, c.name) ? op.formats[c.name] : undefined;
        return ann === undefined ? metaOf(c) : { ...unitOnly(c.unit), format: ann };
      });
    default:
      // Rows move and columns keep their place: rename, sort, distinct, head, the filters, fill, replace, the slices.
      return cols.map(metaOf);
  }
}

/** A join's columns: the left's, then the right's but its key; a semi or anti join keeps only the left's cells. */
export function joinMeta(left: FrameValue, right: FrameValue, opts: JoinOpts): ColumnMeta[] {
  if (opts.how === "semi" || opts.how === "anti") return left.columns.map(() => ({}));
  const rights = opts.how === "cross" ? right.columns : right.columns.filter((c) => c.name !== opts.rightKey);
  return [...left.columns.map(metaOf), ...rights.map(metaOf)];
}

/** Append's columns, by name in first-seen order: a unit or format every frame holding the column agrees on carries
 *  over; any disagreement drops it. */
export function appendMeta(frames: readonly FrameValue[]): ColumnMeta[] {
  const names: string[] = [];
  for (const f of frames) for (const c of f.columns) if (!names.includes(c.name)) names.push(c.name);
  return names.map((name) => {
    const cols = frames.flatMap((f) => f.columns.filter((c) => c.name === name).slice(0, 1));
    const unit = cols.every((c) => sameColumnUnit(c.unit, cols[0].unit)) ? cols[0].unit : undefined;
    const fmt = (c: FrameColumn) => JSON.stringify(c.format ?? null);
    const format = cols.every((c) => fmt(c) === fmt(cols[0])) ? cols[0].format : undefined;
    return { ...(unit ? { unit } : {}), ...(format ? { format } : {}) };
  });
}

/** Bind's columns: every frame's, side by side. */
export const bindMeta = (frames: readonly FrameValue[]): ColumnMeta[] => frames.flatMap((f) => f.columns.map(metaOf));

/** The engine's columns with each one's unit and format laid back on, position by position. */
export function withMeta(columns: FrameColumn[], meta: readonly ColumnMeta[]): FrameColumn[] {
  if (meta.length !== columns.length) return columns;
  return columns.map((c, i) => ({ ...c, ...meta[i] }));
}
