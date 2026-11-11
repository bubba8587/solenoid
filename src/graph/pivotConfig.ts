// [[C127]] pivotView, [[frame-verbs#pivot]]
// A Pivot card's field settings as one value: what Configure Fields edits and what the Pivot view's menu changes.
import type { AggOp } from "./frameOps";
import type { FrameCell } from "./frame";
import { isSolError } from "./errorValue";
import { csvList } from "./nodes/frameShapeHook";
import { listLiteralText } from "./listLiterals";
import type { PivotNode } from "./nodes/frame";

export interface PivotConfig {
  rows: string[];
  cols: string[];
  vals: string[];
  details: string[];
  /** Each value field's function, where it has its own. */
  funcs: Record<string, AggOp>;
  rowTotalDepth: number;
  colTotalDepth: number;
  /** 1-based into [fields…, values…], negative descending, 0 none. */
  rowSort: number;
  colSort: number;
  relativeTo: number;
  /** A field's hidden values, by `pivotKey`. */
  exclude: Record<string, string[]>;
}

const names = (s: string | undefined) => csvList(s).filter(Boolean);

export function pivotConfigOf(node: PivotNode): PivotConfig {
  return {
    rows: names(node.stringLiterals?.rowFields),
    cols: names(node.stringLiterals?.colFields),
    vals: names(node.stringLiterals?.values),
    details: [...node.detailFields],
    funcs: { ...node.funcs },
    rowTotalDepth: node.rowTotalDepth, colTotalDepth: node.colTotalDepth,
    rowSort: node.rowSort, colSort: node.colSort, relativeTo: node.relativeTo,
    exclude: Object.fromEntries(Object.entries(node.filterExclude ?? {}).map(([k, v]) => [k, [...v]])),
  };
}

export function writePivotConfig(node: PivotNode, c: PivotConfig): void {
  node.stringLiterals.rowFields = listLiteralText(c.rows);
  node.stringLiterals.colFields = listLiteralText(c.cols);
  node.stringLiterals.values = listLiteralText(c.vals);
  node.detailFields = c.details;
  node.funcs = c.funcs;
  node.rowTotalDepth = c.rowTotalDepth; node.colTotalDepth = c.colTotalDepth;
  node.rowSort = c.rowSort; node.colSort = c.colSort; node.relativeTo = c.relativeTo;
  node.filterExclude = c.exclude;
}

/** A field value's key in the exclusion list, as the core forms it (`pivot_cell_key`): blank `""`, an error its code. */
export function pivotKey(cell: FrameCell): string {
  if (cell == null) return "";
  if (isSolError(cell)) return cell.code;
  if (typeof cell === "boolean") return cell ? "TRUE" : "FALSE";
  return String(cell);
}
