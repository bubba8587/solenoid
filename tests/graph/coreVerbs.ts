// [[D99]] rustIsSpec
// The frame verbs as the tests call them, run on the core in wasm at once, cells, units and formats alike.
import type { FrameCell, FrameColType, FrameValue, CubeValue } from "../../src/graph/frame";
import type { ChartValue, LadderPayload } from "../../src/graph/chartValue";
import { isSolError, type SolError } from "../../src/graph/errorValue";
import { NestNode, UnnestNode, DecisionMatrixNode, DecisionSensitivityNode, ChoiceLadderNode } from "../../src/graph/nodes/frame";
import { NestJoinNode } from "../../src/graph/nodes/cube";
import { ChartNode } from "../../src/graph/nodes/visual";
import { MakeArrayNode } from "../../src/graph/nodes/tableLambda";
import { ArithmeticNode } from "../../src/graph/nodes/scalar";
import type { ArithmeticOp, UnitCell } from "../../src/graph/unitValue";
import type { ChartOptions } from "../../src/graph/nodes/chartOptions";
import type {
  AggOp, AggSpec, DecisionNormalize, FilterCombine, FilterCond, FilterOp, FrameOp, JoinOpts, LookupMatchMode, LookupSearchMode, PivotSpec, WindowSpec,
} from "../../src/graph/frameOps";
import { onCoreFrames, encodeOpCells, pivotOnEngine, frameFnOnCore } from "../../src/graph/frameBackend";
import { wasmInvokeSync } from "../../src/graph/engineWasm";
import { summarizeColumns, type ColSummary, type FooterColType } from "../../src/graph/components/tableFooterStats";

export { distinctColumnValues } from "../../src/graph/components/TablePopup";

export function applyVerb(f: FrameValue, op: FrameOp): FrameValue {
  if (op.kind === "pivot") {
    const out = pivotOnEngine(f, op);
    if (!out) throw new Error("the core trapped");
    return out;
  }
  return onCoreFrames([f], ([h]) => wasmInvokeSync<string>("engine_apply", { handle: h, op: encodeOpCells(op) }));
}

export const joinFrames = (left: FrameValue, right: FrameValue, opts: JoinOpts): FrameValue =>
  onCoreFrames([left, right], ([l, r]) => wasmInvokeSync<string>("engine_join", { left: l, right: r, opts }));

export const appendFrames = (frames: readonly FrameValue[]): FrameValue =>
  onCoreFrames(frames, (handles) => wasmInvokeSync<string>("engine_append", { handles }));

export const bindColumns = (frames: readonly FrameValue[]): FrameValue =>
  onCoreFrames(frames, (handles) => wasmInvokeSync<string>("engine_bind_columns", { handles }));

export function sampleFrame(f: FrameValue, n: number): FrameValue {
  let same = false;
  const out = onCoreFrames([f], ([h]) => {
    const r = wasmInvokeSync<{ handle: string }>("engine_sample", { handle: h, n });
    same = r.handle === h;
    return same ? wasmInvokeSync<string>("engine_apply_many", { handle: h, ops: [] }) : r.handle;
  });
  return same ? f : out;
}

export const sortByColumn = (f: FrameValue, by: string, dir: "asc" | "desc") => applyVerb(f, { kind: "sort", by, dir });
export const distinctRows = (f: FrameValue, columns?: string[]) => applyVerb(f, { kind: "distinct", ...(columns ? { columns } : {}) });
export const headRows = (f: FrameValue, n: number) => applyVerb(f, { kind: "head", n });
export const selectColumns = (f: FrameValue, columns: string[]) => applyVerb(f, { kind: "select", columns });
export const dropColumns = (f: FrameValue, columns: string[]) => applyVerb(f, { kind: "drop", columns });
export const renameColumns = (f: FrameValue, map: Record<string, string>) => applyVerb(f, { kind: "rename", map });
export const filterRows = (f: FrameValue, column: string, op: FilterOp, value: FrameCell, matchCase = false) =>
  applyVerb(f, { kind: "filter", column, op, value, matchCase });
export const filterRowsMulti = (f: FrameValue, combine: FilterCombine, conditions: FilterCond[], complement = false) =>
  applyVerb(f, { kind: "filterMulti", combine, conditions, complement });
export const groupByFrame = (f: FrameValue, keys: string[], aggs: AggSpec[]) => applyVerb(f, { kind: "groupBy", keys, aggs });
export const unpivotFrame = (f: FrameValue, idColumns: string[], valueColumns: string[], opts?: { variableName?: string; valueName?: string }) =>
  applyVerb(f, { kind: "unpivot", idColumns, valueColumns, ...opts });
export const pivotFrame = (f: FrameValue, spec: PivotSpec) => applyVerb(f, { kind: "pivot", ...spec });
export const windowFrame = (f: FrameValue, spec: WindowSpec) => applyVerb(f, { kind: "window", ...spec });
export const fillBlanks = (f: FrameValue, columns: string[], dir: "down" | "up") => applyVerb(f, { kind: "fillBlanks", columns, dir });
export const replaceValues = (f: FrameValue, column: string, find: string, replaceWith: string, mode: "cell" | "substring") =>
  applyVerb(f, { kind: "replaceValues", column, find, replaceWith, mode });
export const sliceRows = (f: FrameValue, mode: "first" | "last" | "skip" | "range", n: number, to?: number) =>
  applyVerb(f, { kind: "sliceRows", mode, n, ...(to === undefined ? {} : { to }) });
export const dropBlankRows = (f: FrameValue, mode: "all" | "any") => applyVerb(f, { kind: "dropBlankRows", mode });
export const addIndexColumn = (f: FrameValue, name: string, start: number) => applyVerb(f, { kind: "addIndex", name, start });
export const splitColumn = (f: FrameValue, column: string, delimiter: string, into?: string[]) =>
  applyVerb(f, { kind: "splitColumn", column, delimiter, ...(into ? { into } : {}) });
export const mergeColumns = (f: FrameValue, columns: string[], separator: string, name: string) =>
  applyVerb(f, { kind: "mergeColumns", columns, separator, name });

/** Whether one cell passes a filter: a one-row column through the filter verb. */
export function passesFilter(cell: FrameCell, op: FilterOp, value: FrameCell, type: FrameColType, matchCase: boolean): boolean {
  const out = filterRows({ __frame: true, columns: [{ name: "c", type, values: [cell] }] }, "c", op, value, matchCase);
  return out.columns[0].values.length === 1;
}

/** One group's aggregate: the whole column as a single group. */
export function aggregateGroup(values: FrameCell[], op: AggOp, type: FrameColType = "number"): FrameCell {
  const out = groupByFrame({ __frame: true, columns: [{ name: "v", type, values }] }, [], [{ column: "v", op, as: "out" }]);
  return out.columns[0].values[0] ?? null;
}

function frameFn(name: string, frames: FrameValue[], args: unknown[] = []): { frame?: FrameValue; value?: unknown } {
  const r = frameFnOnCore(name, frames, args);
  if (!r) throw new Error(`${name} didn't answer on the core`);
  return r;
}
const frameOf = (name: string, frames: FrameValue[], args: unknown[] = []): FrameValue => {
  const r = frameFn(name, frames, args);
  if (!r.frame) throw new Error(`${name} answered no frame`);
  return r.frame;
};

export const promoteHeaders = (f: FrameValue) => frameOf("promoteHeaders", [f]);
export const demoteHeaders = (f: FrameValue) => frameOf("demoteHeaders", [f]);
export const describeFrame = (f: FrameValue) => frameOf("describeFrame", [f]);
/** One column's footer figures, from the core's `columnProfiles`. */
export function summarizeColumn(values: unknown[], type: FooterColType): ColSummary {
  const s = summarizeColumns([{ values, type }]);
  if (!s) throw new Error("columnProfiles didn't answer on the core");
  return s[0];
}
export const correlationMatrix = (f: FrameValue, method: string) => frameOf("correlationMatrix", [f], [method]);

export interface ReconcileOpts { leftKey: string; rightKey: string; priceColumn?: string; qtyColumn?: string }
export interface PvmBreakdown { totalBefore: number; totalAfter: number; delta: number; price: number; volume: number; mix: number; excluded: number }
export interface ReconcileSummary {
  added: number; removed: number; changed: number; unchanged: number; skipped: number;
  addedColumns: string[]; removedColumns: string[]; pvm?: PvmBreakdown;
}
/** Reconcile's frame and its summary, which the core sends as a list: the five counts, the added and removed column
 *  names, and the PVM breakdown or null. */
export function reconcileFrames(left: FrameValue, right: FrameValue, opts: ReconcileOpts): { frame: FrameValue; summary: ReconcileSummary } {
  const r = frameFn("reconcileFrames", [left, right], [opts.leftKey, opts.rightKey, opts.priceColumn ?? "", opts.qtyColumn ?? ""]);
  const [added, removed, changed, unchanged, skipped, addedColumns, removedColumns, p] = r.value as [number, number, number, number, number, string[], string[], number[] | null];
  const summary: ReconcileSummary = { added, removed, changed, unchanged, skipped, addedColumns, removedColumns };
  if (p) summary.pvm = { totalBefore: p[0], totalAfter: p[1], delta: p[2], price: p[3], volume: p[4], mix: p[5], excluded: p[6] };
  return { frame: r.frame!, summary };
}

// ─── Lookups ───
export const lookupRowIndex = (f: FrameValue, column: string, lookup: string, mm: LookupMatchMode = "exact", sm: LookupSearchMode = "first") =>
  frameFn("lookupRowIndex", [f], [column, lookup, mm, sm]).value as number;
export const lookupCell = (f: FrameValue, column: string, ret: string, lookup: string, mm: LookupMatchMode = "exact", sm: LookupSearchMode = "first") =>
  frameFn("lookupCell", [f], [column, ret, lookup, mm, sm]).value;
export const frameRowAt = (f: FrameValue, i: number) => frameOf("frameRowAt", [f], [i]);

// ─── Nest / Unnest, through their cards ───
const orThrow = <T>(v: T | SolError | null): T => {
  if (isSolError(v)) throw v;
  return v as T;
};
export const nestFrame = (f: FrameValue, keys: string[], nestedName = "items"): CubeValue =>
  orThrow(new NestNode().data({ frame: [f], keys: [keys], nestedName: [nestedName] }).cube) as CubeValue;
export const unnestCube = (c: CubeValue, column: string): FrameValue | CubeValue =>
  orThrow(new UnnestNode().data({ cube: [c], column: [column] }).frame) as FrameValue | CubeValue;
/** Nest Join: each parent row gains a cell of its matching child rows; null where the parent has no `key` column. */
export const relateFramesToCube = (parent: FrameValue, child: FrameValue | CubeValue, key: string, nestedName: string): CubeValue | null =>
  orThrow(new NestJoinNode().data({ parent: [parent], child: [child], key: [key], name: [nestedName] }).cube);
/** Nest Join on a cube parent: the child deepens its first nested column's tables, a level down. */
export const relateCubeToFrame = (parent: CubeValue, child: FrameValue | CubeValue, key: string, nestedName: string): CubeValue =>
  orThrow(new NestJoinNode().data({ parent: [parent], child: [child], key: [key], name: [nestedName] }).cube) as CubeValue;

// ─── Arithmetic, through its card ───
/** The Arithmetic card on two cells: the dimension algebra as the card answers it. */
export const arithmeticCell = (op: ArithmeticOp, a: unknown, b: unknown) =>
  new ArithmeticNode({ op }).data({ a: [a], b: [b] }).result as number | UnitCell | SolError;

// ─── Formula reading and chart options, as the core reads them ───
/** The row references a formula reads (`@name`, `[name]`), as the column topo sees them. */
export const rowRefNames = (src: string): string[] =>
  wasmInvokeSync<{ rows?: string[] }>("engine_formula_names", { src, bodies: [] }).rows ?? [];
/** Why a formula fails to parse, as a lambda card says it; null where it parses. */
export function syntaxHint(src: string): string | null {
  const n = new MakeArrayNode({ expr: src, literals: { rows: 1, cols: 1 } });
  const r = n.data({}).result;
  return isSolError(r) && r.code === "#SYNTAX!" ? r.message : null;
}
/** An options string as a Chart card reads it. */
export function chartOptionsOf(options: string | null): ChartOptions {
  const n = new ChartNode();
  n.data({ values: [[1, 2]], options: [options] });
  return n.chartOptions;
}

// ─── Decisions, through their cards ───
/** The criteria a Decision Matrix scores: every number and logical column but the first text one, its labels. */
export function decisionCriteria(f: FrameValue): string[] {
  const label = f.columns.find((c) => c.type === "string");
  return f.columns.filter((c) => c !== label && (c.type === "number" || c.type === "logical")).map((c) => c.name);
}

export interface DecisionBound { atLeast: number | null; atMost: number | null }

/** The weights table the card reads, from weights by criterion, Norm overrides and deal-breakers. */
function weightsTable(f: FrameValue, weights: number[] | null, overrides: Record<string, DecisionNormalize>, bounds: DecisionBound[] | null): FrameValue | null {
  if (!weights && Object.keys(overrides).length === 0 && !bounds) return null;
  const criteria = decisionCriteria(f);
  const columns: FrameValue["columns"] = [
    { name: "Criterion", type: "string", values: criteria },
    { name: "Weight", type: "number", values: criteria.map((_, j) => weights?.[j] ?? 1) },
  ];
  if (Object.keys(overrides).length) columns.push({ name: "Norm", type: "string", values: criteria.map((n) => overrides[n] ?? null) });
  if (bounds) {
    columns.push({ name: "At least", type: "number", values: criteria.map((_, j) => bounds[j]?.atLeast ?? null) });
    columns.push({ name: "At most", type: "number", values: criteria.map((_, j) => bounds[j]?.atMost ?? null) });
  }
  return { __frame: true, columns };
}

/** The weights table as given; `decisionMatrix` reads it whole. */
export const resolveDecisionWeights = (wf: FrameValue | null, _criteria: string[]) =>
  ({ weights: wf, normOverrides: {} as Record<string, DecisionNormalize>, bounds: null as DecisionBound[] | null });

export function decisionMatrix(
  f: FrameValue, weights: number[] | FrameValue | null, normalize: DecisionNormalize, breakdown = false,
  overrides: Record<string, DecisionNormalize> = {}, bounds: DecisionBound[] | null = null,
): FrameValue {
  const wf = weights && !Array.isArray(weights) ? weights : weightsTable(f, weights, overrides, bounds);
  const node = new DecisionMatrixNode({ normalize, detail: breakdown ? "breakdown" : "summary" });
  return orThrow(node.data({ frame: [f], ...(wf ? { weights: [wf] } : {}) }).frame) as FrameValue;
}

export function decisionCube(c: CubeValue, wf: FrameValue | null, normalize: DecisionNormalize, breakdown = false): CubeValue {
  const node = new DecisionMatrixNode({ normalize, detail: breakdown ? "breakdown" : "summary" });
  return orThrow(node.data({ frame: [c], ...(wf ? { weights: [wf] } : {}) }).frame) as CubeValue;
}

export const decisionSensitivity = (scores: FrameValue, scenarios: FrameValue, normalize: DecisionNormalize): CubeValue =>
  orThrow(new DecisionSensitivityNode({ normalize }).data({ scores: [scores], scenarios: [scenarios] }).cube) as CubeValue;

export const flipPoints = (f: FrameValue, wf: FrameValue | null, normalize: DecisionNormalize): FrameValue =>
  orThrow(new DecisionSensitivityNode({ normalize, mode: "flips" }).data({ scores: [f], ...(wf ? { scenarios: [wf] } : {}) }).cube) as FrameValue;

export function choiceLadder(
  f: FrameValue, wf: FrameValue | null, limits: FrameValue | null, normalize: DecisionNormalize, close: number, choices: string[] = [],
): { plan: FrameValue; payload: LadderPayload } {
  const node = new ChoiceLadderNode({ normalize, choices });
  node.literals.close = close;
  const out = node.data({ frame: [f], ...(wf ? { weights: [wf] } : {}), ...(limits ? { limits: [limits] } : {}) });
  return { plan: orThrow(out.frame) as FrameValue, payload: (orThrow(out.chart) as ChartValue).payload as LadderPayload };
}
