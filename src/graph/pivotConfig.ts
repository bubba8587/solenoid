// [[C127]] pivotView, [[frame-verbs#pivot]]
// A Pivot card's field settings as one value: what Configure Fields edits and what the Pivot view's menu changes.
import type { AggOp } from "./frameOps";
import type { FrameCell } from "./frame";
import { isSolError } from "./errorValue";
import { csvList } from "./nodes/frameShapeHook";
import { listLiteralText } from "./listLiterals";

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

/** The PIVOTBY card's fields this module reads and writes (`PivotNode` has them). Structural, so a module that only edits
 *  a Pivot's layout, as the Obsidian plugin's table popup does, never pulls in the card classes. */
export interface PivotFields {
  stringLiterals: Record<string, string>;
  funcs: Record<string, AggOp>;
  detailFields: string[];
  filterExclude: Record<string, string[]>;
  rowTotalDepth: number; colTotalDepth: number;
  rowSort: number; colSort: number; relativeTo: number;
}

export function pivotConfigOf(node: PivotFields): PivotConfig {
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

export function writePivotConfig(node: PivotFields, c: PivotConfig): void {
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

/** Excel's grouped date fields, as the core derives them (`date_group_of`): `Months (When)` is `When` by month. */
export const DATE_GROUPS = ["Years", "Quarters", "Months", "Weeks", "Days"] as const;
export type DateGroup = (typeof DATE_GROUPS)[number];

export function dateGroupOf(name: string): { unit: DateGroup; from: string } | null {
  const m = /^(Years|Quarters|Months|Weeks|Days) \((.+)\)$/.exec(name);
  return m ? { unit: m[1] as DateGroup, from: m[2] } : null;
}

/** The field a date column is placed as: grouped, or the column itself with no grouping. */
export const groupedName = (from: string, unit: DateGroup | null): string => (unit ? `${unit} (${from})` : from);

/** A placed field regrouped where it stands in its zone; a filter on the old grouping goes, since its keys no longer match. */
export function regroupField(c: PivotConfig, zone: "rows" | "cols", field: string, unit: DateGroup | null): PivotConfig {
  const from = dateGroupOf(field)?.from ?? field;
  const name = groupedName(from, unit);
  if (name === field) return c;
  const list = [...c[zone]];
  const at = list.indexOf(field);
  if (at < 0) return c;
  if (list.includes(name)) list.splice(at, 1); else list[at] = name;
  const exclude = { ...c.exclude };
  delete exclude[field];
  return { ...c, [zone]: list, exclude };
}
