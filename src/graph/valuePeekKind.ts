// The value kinds a socket hover-peek can render (the peek arms only for the chip-summary
// kinds — isChipSummaryPeek below — but the switch stays total over all kinds). Mirrors
// DisplayComponent's own branch order so the peek shows a value exactly as the Display
// would. Pure (no React) so the coverage guard can enumerate it cheaply — SocketValuePeek
// switches on this, and displayPeekCoverage.test.ts pins that every kind has a branch.
import { isFrameValue, isCubeValue } from "./frame";
import { isChartValue } from "./chartValue";
import { isMermaidValue } from "./mermaidValue";
import { isSvgValue } from "./svgValue";
import { isLambdaValue } from "./nodes/lambda";
import { isSolError } from "./errorValue";

export const PEEK_KINDS = [
  "error", "frame", "cube", "chart", "mermaid", "svg", "lambda", "table", "list", "scalar", "empty",
] as const;
export type PeekKind = (typeof PEEK_KINDS)[number];

/** Classify a live socket value for the peek. The order matches DisplayComponent: error
 *  first, then the object kinds, then 2-D array (table) vs 1-D (list) vs scalar. `empty`
 *  is null / undefined / an empty array — the peek doesn't open for it (NodeSocket gates
 *  on a present value), but the branch keeps the switch total. */
export function peekKindFor(v: unknown): PeekKind {
  if (isSolError(v)) return "error";
  if (isFrameValue(v)) return "frame";
  if (isCubeValue(v)) return "cube";
  if (isChartValue(v)) return "chart";
  if (isMermaidValue(v)) return "mermaid";
  if (isSvgValue(v)) return "svg";
  if (isLambdaValue(v)) return "lambda";
  if (Array.isArray(v)) {
    if (v.length === 0) return "empty";
    return Array.isArray(v[0]) ? "table" : "list";
  }
  if (v === null || v === undefined) return "empty";
  return "scalar"; // number | string | boolean
}

// The kinds whose node-face representation is a SUMMARY CHIP that hides its content — a
// frame/cube/table/list/chart/diagram/svg/lambda. The hover value-peek arms ONLY for
// these: it reveals what the chip stands in for. A scalar/string/error renders in FULL on
// the face, so peeking it would just repeat it; `empty` shows nothing (decided 2026-09-08).
const CHIP_SUMMARY_KINDS: ReadonlySet<PeekKind> = new Set([
  "frame", "cube", "chart", "mermaid", "svg", "lambda", "table", "list",
]);

/** Whether a live socket value arms the hover value-peek — true only for chip-summary
 *  kinds, whose content is otherwise hidden behind the face chip. */
export function isChipSummaryPeek(v: unknown): boolean {
  return CHIP_SUMMARY_KINDS.has(peekKindFor(v));
}
