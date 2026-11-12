// [[B19]] spreadsheetHabits, [[table-popup#The Pivot view]], [[frame-verbs#pivot]]
// A Pivot card's field settings as one value: what Configure Fields edits and what the Pivot view's menu changes.
import type { AggOp } from "./frameOps";
import type { FrameCell } from "./frame";
import { isSolError } from "./errorValue";
import { csvList } from "./nodes/frameShapeHook";
import { listLiteralText } from "./listLiterals";
import { pivotLayoutOf } from "./pivotLayout";

export interface PivotConfig {
  rows: string[];
  cols: string[];
  vals: string[];
  details: string[];
  /** Each value field's function, where it has its own. */
  funcs: Record<string, AggOp>;
  rowTotalDepth: number;
  colTotalDepth: number;
  /** 1-based into [fields…, values…, calculated fields on the pivot…], negative descending, 0 none. */
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

/** What a sort's number names, by position: its axis's fields, then the values, then the calculated fields on the pivot. */
const sortKeys = (fields: readonly string[], vals: readonly string[], calcs: readonly string[]): string[] =>
  [...fields.map((f) => `f\u0000${f}`), ...vals.map((v) => `v\u0000${v}`), ...calcs.map((id) => `c\u0000${id}`)];

/** A sort (1-based into `before`, negative descending) as the number that names the same field in `after`, or 0, the
 *  default order, when that field is gone. A number past `before` names a calculated field the caller didn't list,
 *  and keeps its distance from the end. */
export function movedSort(sort: number, before: readonly string[], after: readonly string[]): number {
  if (!sort) return 0;
  const i = Math.abs(sort) - 1;
  const at = i < before.length ? after.indexOf(before[i]) : i + after.length - before.length;
  return at < 0 ? 0 : Math.sign(sort) * (at + 1);
}

/** Writes the settings to the card. A sort is saved as a position, so when the fields change and the sort itself
 *  doesn't, its number moves to name the field it named before (`movedSort`). `calcs`: the ids of the calculated
 *  fields on the pivot, in socket order, before and after this write, where the caller changes them. */
export function writePivotConfig(node: PivotFields, c: PivotConfig, calcs?: { before: readonly string[]; after: readonly string[] }): void {
  const was = pivotConfigOf(node);
  const sortFor = (sort: number, wasSort: number, wasFields: string[], fields: string[]) =>
    sort !== wasSort ? sort : movedSort(sort, sortKeys(wasFields, was.vals, calcs?.before ?? []), sortKeys(fields, c.vals, calcs?.after ?? []));
  const rowSort = sortFor(c.rowSort, was.rowSort, was.rows, c.rows);
  const colSort = sortFor(c.colSort, was.colSort, was.cols, c.cols);
  node.stringLiterals.rowFields = listLiteralText(c.rows);
  node.stringLiterals.colFields = listLiteralText(c.cols);
  node.stringLiterals.values = listLiteralText(c.vals);
  node.detailFields = c.details;
  node.funcs = c.funcs;
  node.rowTotalDepth = c.rowTotalDepth; node.colTotalDepth = c.colTotalDepth;
  node.rowSort = rowSort; node.colSort = colSort; node.relativeTo = c.relativeTo;
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


/** A calculated field as the Configure Fields popup drags it among the values: a token no column name can be. */
const CALC_TOKEN = "\u0000λ";
export const calcToken = (id: string): string => CALC_TOKEN + id;
export const calcIdOf = (token: string): string | null => (token.startsWith(CALC_TOKEN) ? token.slice(CALC_TOKEN.length) : null);

/** The Values zone in its order: the plain values, and each placed calculated field (`ids`, wired, in socket order)
 *  before the value its place names, or after them all with no place. One placed at -1 is out of the pivot. */
export function valuesWithCalcs(vals: readonly string[], place: Readonly<Record<string, number>>, ids: readonly string[]): string[] {
  const at = (id: string) => place[id] ?? Infinity;
  const placed = ids.filter((id) => at(id) >= 0);
  const out: string[] = [];
  vals.forEach((v, i) => {
    for (const id of placed) if (at(id) === i) out.push(calcToken(id));
    out.push(v);
  });
  for (const id of placed) if (at(id) >= vals.length) out.push(calcToken(id));
  return out;
}

/** The Values zone's order back to what the card saves: its plain values, and each calculated field's place, none
 *  when it trails the values, -1 for a wired one not in the zone. A place for an unwired field is kept as it was. */
export function placesFrom(tokens: readonly string[], ids: readonly string[], prev: Readonly<Record<string, number>>): { vals: string[]; place: Record<string, number> } {
  const vals = tokens.filter((t) => calcIdOf(t) === null);
  const place: Record<string, number> = {};
  for (const [id, at] of Object.entries(prev)) if (!ids.includes(id)) place[id] = at;
  let before = 0;
  for (const t of tokens) {
    const id = calcIdOf(t);
    if (id === null) before++;
    else if (before < vals.length) place[id] = before;
  }
  for (const id of ids) if (!tokens.includes(calcToken(id))) place[id] = -1;
  return { vals, place };
}

/** A calculated field's name: as the card's last result names it (a wired name included), else as typed, else
 *  `Calculated N` by its row (`n`, 0-based), as the core names a blank one. */
export function calcFieldName(node: { cachedResult: unknown; stringLiterals: Record<string, string> }, id: string, n: number): string {
  const r = node.cachedResult;
  const layout = r && typeof r === "object" && !isSolError(r) ? pivotLayoutOf(r as never) : null;
  return layout?.calcNames?.[id] || node.stringLiterals[`calcName${id}`]?.trim() || `Calculated ${n + 1}`;
}
