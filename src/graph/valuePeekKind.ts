// [[C24]] arraySemantics
// Pure, so displayPeekCoverage.test.ts can enumerate the kinds; the order mirrors DisplayComponent's branches so a
// peek shows a value exactly as a Display would.
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

/** Error first, then the object kinds, then table vs list vs scalar. The switch stays total, `empty` included. */
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
  return "scalar";
}

// The peek arms only for kinds whose card face is a summary chip hiding its content; a scalar, string or error
// already renders in full, and `empty` shows nothing.
const CHIP_SUMMARY_KINDS: ReadonlySet<PeekKind> = new Set([
  "frame", "cube", "chart", "mermaid", "svg", "lambda", "table", "list",
]);

export function isChipSummaryPeek(v: unknown): boolean {
  return CHIP_SUMMARY_KINDS.has(peekKindFor(v));
}
