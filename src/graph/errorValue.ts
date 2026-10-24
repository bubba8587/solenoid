// [[C24]], [[E9]] errorsKeepOrigin, [[C24]] arraySemantics

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
  "#SYNTAX!": "A formula couldn't be parsed, or a setting with no default is blank. Check for unbalanced parentheses, doubled operators, or a missing argument or setting.",
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

// Duck-typed: importing from frame.ts would cycle, since frame.ts imports this module.
interface FrameLikeColumn { values: unknown[] }
interface FrameLike { __frame: true; columns: FrameLikeColumn[] }
export function isFrameLike(v: unknown): v is FrameLike {
  return typeof v === "object" && v !== null &&
    (v as { __frame?: unknown }).__frame === true &&
    Array.isArray((v as { columns?: unknown }).columns);
}

// The bounded scan's shape, as the graph core's guard samples a container (`boundary.rs`, error-values.md).
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

/** What the graph core's guard reports after each node's call: the first error on its outputs, or `null` when they
 *  are clean, which re-arms a sink's edge detection. At most one report per node per call. */
type ErrorSink = (nodeId: string, err: SolError | null) => void;
const _errorSinks: ErrorSink[] = [];
export function registerErrorSink(fn: ErrorSink): () => void {
  _errorSinks.push(fn);
  return () => {
    const i = _errorSinks.indexOf(fn);
    if (i >= 0) _errorSinks.splice(i, 1);
  };
}
export function hasErrorSinks(): boolean {
  return _errorSinks.length > 0;
}
export function reportToErrorSinks(nodeId: string, err: SolError | null): void {
  for (const sink of _errorSinks) sink(nodeId, err);
}

// The real code set, so a foreign or malformed code from the boundary becomes #ERROR! rather than being trusted.
const CANONICAL_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_EXPLANATIONS));

function isCanonicalCode(c: unknown): c is SolErrorCode {
  return typeof c === "string" && CANONICAL_CODES.has(c);
}

/** Rust sets `__solError` itself, so its code must be re-validated. */
export function toSolError(thrown: unknown): SolError {
  if (isSolError(thrown)) {
    return isCanonicalCode(thrown.code) ? thrown : solError("#ERROR!", thrown.message);
  }
  if (thrown && typeof thrown === "object") {
    const o = thrown as Record<string, unknown>;
    const message = typeof o.message === "string" ? o.message : "IPC call failed";
    if (isCanonicalCode(o.code)) return solError(o.code, message);
    return solError("#ERROR!", message);
  }
  if (typeof thrown === "string") return solError("#ERROR!", thrown);
  return solError("#ERROR!", "IPC call failed");
}
