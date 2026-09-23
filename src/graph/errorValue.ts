// [[C24]], [[D34]] oneErrorKind, [[E9]] errorsKeepOrigin, [[D37]] errorBeatsMissing
import { perfEnabled, recordNode } from "./perfProbe";
import { displayNameOf } from "./nodeNamer";

export type SolErrorCode =
  | "#DIV/0!" | "#N/A"
  | "#DOMAIN!" | "#CONV!" | "#OVERFLOW!"
  | "#SYNTAX!" | "#VALUE!" | "#TYPE!" | "#SHAPE!" | "#UNIT!"
  | "#NAME?" | "#REF!" | "#CIRC!"
  | "#SOLVE!"
  | "#AMBIGUOUS!"
  | "#ERROR!";

const TAG = "__solError";

export interface SolErrorOrigin {
  nodeId: string;
  nodeName: string;
  inputSlot?: string;
  rowIndex?: number;
}

export interface SolError {
  [TAG]: true;
  code: SolErrorCode;
  message: string;
  origin?: SolErrorOrigin;
}

export const ERROR_EXPLANATIONS: Record<SolErrorCode, string> = {
  "#DIV/0!": "Divided by zero. Check the divisor; the usual cause is an empty or zeroed field upstream.",
  "#N/A":    "A lookup or match found nothing. Check the search value, or wire an If-not-found fallback.",
  "#DOMAIN!": "An input was outside what the function accepts, such as the square root or log of a negative number, or ASIN beyond ±1.",
  "#CONV!":  "An iterative solver didn't converge. Try a different starting guess, or check the inputs are solvable.",
  "#OVERFLOW!": "The result is too large or small to represent. Reduce the input magnitudes.",
  "#SYNTAX!": "A formula couldn't be parsed. Check for unbalanced parentheses, doubled operators, or a missing argument.",
  "#VALUE!": "A value had the wrong type, or a formula failed while evaluating. Check each input is the kind of data the node expects.",
  "#TYPE!":  "The element type is wrong, like text where a number belongs or a number where a date does. Use a Cast node, or reshape the input.",
  "#SHAPE!": "The sizes of Lists or matrices don't line up. Check that the connected Lists and tables have matching lengths.",
  "#UNIT!":  "The units don't match dimensionally, like adding meters to seconds. Convert one side first, or check the unit an upstream Format Controller assigned.",
  "#NAME?":  "A name wasn't recognized as a function or variable. Check the spelling in the formula.",
  "#REF!":   "A reference points at something that no longer exists, usually a deleted node or column.",
  "#CIRC!":  "A circular dependency: the calculation feeds back into itself. Remove one cable in the cycle to break it.",
  "#SOLVE!": "The Equation node found no value that satisfies the equation. Check the known values, or rearrange the equation.",
  "#AMBIGUOUS!": "A date like 3/4/2026 could mean April 3 or March 4. Write the month as a name (3-Apr-2026) or use the ISO form (2026-04-03).",
  "#ERROR!": "The node failed unexpectedly. If it persists, it's likely a Solenoid bug worth reporting.",
};

export function solError(code: SolErrorCode, message: string): SolError {
  return { [TAG]: true, code, message };
}

export function isSolError(v: unknown): v is SolError {
  return typeof v === "object" && v !== null && (v as Record<string, unknown>)[TAG] === true;
}

export function isNaError(v: unknown): v is SolError {
  return isSolError(v) && v.code === "#N/A";
}

function fromThrown(e: unknown): SolError {
  if (isSolError(e)) return e;
  // Matched by name, not instanceof, so this module never imports the coercion layer.
  if (e instanceof Error && e.name === "ShapeError") {
    return solError("#SHAPE!", e.message);
  }
  const msg = e instanceof Error ? e.message : String(e);
  return solError("#ERROR!", `This node failed to compute: ${msg}`);
}

export function firstInputError(
  inputs: Record<string, unknown[] | undefined>,
): SolError | null {
  for (const arr of Object.values(inputs)) {
    if (!arr) continue;
    for (const v of arr) if (isSolError(v)) return v;
  }
  return null;
}

export const SEES_ERRORS: ReadonlySet<string> = new Set([
  "IFErrorNode", "IsTestNode",
  "ConduitNode", "CableSwitchNode",
  "DisplayNode", "NoteNode", "ReportNode",
  "ChartNode",
  "CompositeNode", "CompositeOutputNode",
]);

const WRAPPED = Symbol("solErrorGuard");

type DataFn = (inputs: Record<string, unknown[] | undefined>) =>
  Record<string, unknown> | Promise<Record<string, unknown>>;

// Duck-typed: importing from frame.ts would cycle, since frame.ts imports this module.
interface FrameLikeColumn { values: unknown[] }
interface FrameLike { __frame: true; columns: FrameLikeColumn[] }
export function isFrameLike(v: unknown): v is FrameLike {
  return typeof v === "object" && v !== null &&
    (v as { __frame?: unknown }).__frame === true &&
    Array.isArray((v as { columns?: unknown }).columns);
}

export const CELL_SCAN_HEAD = 64;
export const CELL_SCAN_STRIDE_SAMPLES = 32;

export function sampledCellIndices(len: number): number[] {
  if (len <= CELL_SCAN_HEAD) return Array.from({ length: len }, (_, i) => i);
  const idx: number[] = [];
  for (let i = 0; i < CELL_SCAN_HEAD; i++) idx.push(i);
  const step = Math.ceil((len - CELL_SCAN_HEAD) / CELL_SCAN_STRIDE_SAMPLES);
  for (let i = CELL_SCAN_HEAD; i < len; i += step) idx.push(i);
  return idx;
}

export function findCellError(v: unknown): SolError | null {
  if (isSolError(v)) return v;
  if (Array.isArray(v)) {
    for (const i of sampledCellIndices(v.length)) {
      const cell: unknown = v[i];
      if (isSolError(cell)) return cell;
      if (Array.isArray(cell)) { const e = findCellError(cell); if (e) return e; }
    }
    return null;
  }
  if (isFrameLike(v)) {
    for (const col of v.columns) {
      for (const i of sampledCellIndices(col.values.length)) {
        if (isSolError(col.values[i])) return col.values[i];
      }
    }
    return null;
  }
  return null;
}

// Goes through nodeNamer.ts because importing catalogUtils directly would cycle.
const nodeDisplayName = (n: object): string => displayNameOf(n);

function withOrigin(v: unknown, nodeId: string, nodeName: string): unknown {
  if (isSolError(v)) return v.origin ? v : { ...v, origin: { nodeId, nodeName } };
  if (Array.isArray(v)) {
    let out: unknown[] | null = null;
    for (let i = 0; i < v.length; i++) {
      const cell: unknown = v[i];
      if (isSolError(cell) && !cell.origin) {
        if (!out) out = v.slice();
        out[i] = { ...cell, origin: { nodeId, nodeName, rowIndex: i } };
      }
    }
    return out ?? v;
  }
  if (isFrameLike(v)) {
    let out: FrameLike | null = null;
    v.columns.forEach((col, ci) => {
      let values: unknown[] | null = null;
      for (let i = 0; i < col.values.length; i++) {
        const cell = col.values[i];
        if (isSolError(cell) && !cell.origin) {
          if (!values) values = col.values.slice();
          values[i] = { ...cell, origin: { nodeId, nodeName, rowIndex: i } };
        }
      }
      if (values) {
        if (!out) out = { ...v, columns: v.columns.slice() };
        out.columns[ci] = { ...col, values };
      }
    });
    return out ?? v;
  }
  return v;
}

function findInputSlot(inputs: Record<string, unknown[] | undefined>, err: SolError): string | undefined {
  for (const [key, arr] of Object.entries(inputs)) {
    if (arr?.includes(err)) return key;
  }
  return undefined;
}

type ErrorSink = (nodeId: string, err: SolError | null) => void;
const _errorSinks: ErrorSink[] = [];
export function registerErrorSink(fn: ErrorSink): () => void {
  _errorSinks.push(fn);
  return () => {
    const i = _errorSinks.indexOf(fn);
    if (i >= 0) _errorSinks.splice(i, 1);
  };
}
function reportError(nodeId: string, err: SolError | null): void {
  for (const sink of _errorSinks) sink(nodeId, err);
}
function reportOut(nodeId: string, out: Record<string, unknown> | undefined): void {
  if (!out || _errorSinks.length === 0) return;
  for (const v of Object.values(out)) {
    const err = findCellError(v);
    if (err) { reportError(nodeId, err); return; }
  }
  reportError(nodeId, null);
}

export function installErrorGuards(node: object): void {
  const n = node as {
    [WRAPPED]?: boolean;
    id?: string;
    label?: string;
    data?: DataFn;
    outputs?: Record<string, unknown>;
    cachedResult?: unknown;
    constructor: { name: string };
  };
  if (typeof n.data !== "function" || n[WRAPPED]) return;
  n[WRAPPED] = true;

  const orig = n.data.bind(n);
  const passRaw = SEES_ERRORS.has(n.constructor.name);
  const typeName = n.constructor.name;
  const nodeId = n.id ?? "?";

  const errorOut = (err: SolError, inputs?: Record<string, unknown[] | undefined>): Record<string, unknown> => {
    const tagged: SolError = err.origin ? err : {
      ...err,
      origin: { nodeId, nodeName: nodeDisplayName(n), inputSlot: inputs && findInputSlot(inputs, err) },
    };
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(n.outputs ?? {})) out[key] = tagged;
    if ("cachedResult" in n) n.cachedResult = tagged;
    const f = n as { cachedChart?: unknown; cachedPayload?: unknown };
    if ("cachedChart" in f) f.cachedChart = tagged;
    if ("cachedPayload" in f) f.cachedPayload = null;
    reportError(nodeId, tagged);
    return out;
  };

  const tagOutputs = (out: Record<string, unknown>): Record<string, unknown> => {
    let changed = false;
    const tagged: Record<string, unknown> = {};
    const nodeName = nodeDisplayName(n);
    for (const [k, v] of Object.entries(out)) {
      const t = withOrigin(v, nodeId, nodeName);
      tagged[k] = t;
      if (t !== v) changed = true;
    }
    const result = changed ? tagged : out;
    reportOut(nodeId, result);
    return result;
  };

  n.data = (inputs) => {
    if (!passRaw) {
      const err = firstInputError(inputs);
      if (err) return errorOut(err, inputs);
    }
    const probe = perfEnabled();
    const t0 = probe ? performance.now() : 0;
    try {
      const out = orig(inputs);
      if (out instanceof Promise) {
        const guarded = out.then(tagOutputs, (e) => errorOut(fromThrown(e)));
        return probe ? guarded.finally(() => recordNode(nodeId, typeName, performance.now() - t0)) : guarded;
      }
      const tagged = tagOutputs(out);
      if (probe) recordNode(nodeId, typeName, performance.now() - t0);
      return tagged;
    } catch (e) {
      if (probe) recordNode(nodeId, typeName, performance.now() - t0);
      return errorOut(fromThrown(e));
    }
  };
}
