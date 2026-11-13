// [[B19]] spreadsheetHabits, [[table-popup#The Pivot view]], [[frame-verbs#pivot]]
// A Pivot card's field settings as one value: what Configure Fields edits and what the Pivot view's menu changes.
import type { AggOp } from "./frameOps";
import type { FrameCell } from "./frame";
import { isSolError } from "./errorValue";
import { csvList } from "./nodes/frameShapeHook";
import { listLiteralText } from "./listLiterals";
import { pivotLayoutOf } from "./pivotLayout";

/** What a pivot axis sorts by: one of its own fields or a value, by name, or a calculated field, by its id; `desc` for
 *  largest first. Saved as what it names, never a position, so it stays on its field however the fields around it
 *  change (the core turns it into PIVOTBY's position on each pass, `sort_position`). */
export interface PivotSort { by: "field" | "value" | "calc"; name: string; desc?: true }

export const sameSort = (a: PivotSort | null, b: PivotSort | null): boolean =>
  a === b || (!!a && !!b && a.by === b.by && a.name === b.name && !!a.desc === !!b.desc);

/** A saved sort read back: null for anything that isn't one. */
export function readPivotSort(v: unknown): PivotSort | null {
  const o = v as Partial<PivotSort> | null;
  if (!o || typeof o !== "object" || typeof o.name !== "string" || (o.by !== "field" && o.by !== "value" && o.by !== "calc")) return null;
  return { by: o.by, name: o.name, ...(o.desc === true ? { desc: true as const } : {}) };
}

/** Each calculated field's place, by its id, in the Values zone's order: the name of the value it sits before, null
 *  for after the values, false for dragged out of the pivot (its cable kept). A field it doesn't list sits after the
 *  values, in socket order, which is where a newly wired one lands. By name, so a place holds whatever happens to the
 *  values list. */
export type CalcPlaces = Array<[id: string, before: string | null | false]>;

export const calcIsOff = (place: CalcPlaces, id: string): boolean => place.some(([k, b]) => k === id && b === false);

/** Saved places read back, anything malformed left out. */
export function readCalcPlaces(v: unknown): CalcPlaces {
  if (!Array.isArray(v)) return [];
  const out: CalcPlaces = [];
  for (const p of v) {
    if (!Array.isArray(p) || typeof p[0] !== "string" || out.some(([k]) => k === p[0])) continue;
    const b: unknown = p[1];
    out.push([p[0], typeof b === "string" || b === false ? b : null]);
  }
  return out;
}

export interface PivotConfig {
  rows: string[];
  cols: string[];
  vals: string[];
  details: string[];
  /** Each value field's function, where it has its own. */
  funcs: Record<string, AggOp>;
  rowTotalDepth: number;
  colTotalDepth: number;
  /** What each axis sorts by; null is the default order. */
  rowSort: PivotSort | null;
  colSort: PivotSort | null;
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
  rowSort: PivotSort | null; colSort: PivotSort | null; relativeTo: number;
}

export function pivotConfigOf(node: PivotFields): PivotConfig {
  return {
    rows: names(node.stringLiterals?.rowFields),
    cols: names(node.stringLiterals?.colFields),
    vals: names(node.stringLiterals?.values),
    details: [...node.detailFields],
    funcs: { ...node.funcs },
    rowTotalDepth: node.rowTotalDepth, colTotalDepth: node.colTotalDepth,
    rowSort: node.rowSort && { ...node.rowSort }, colSort: node.colSort && { ...node.colSort }, relativeTo: node.relativeTo,
    exclude: Object.fromEntries(Object.entries(node.filterExclude ?? {}).map(([k, v]) => [k, [...v]])),
  };
}

/** Writes the settings to the card. A sort whose field or value this write takes off the pivot goes with it; one whose
 *  field is only away (a wired list that changed, a column the input lacks for now) is kept, and sorts again when the
 *  field is back. */
export function writePivotConfig(node: PivotFields, c: PivotConfig): void {
  const was = pivotConfigOf(node);
  const kept = (sort: PivotSort | null, wasFields: string[], fields: string[]): PivotSort | null => {
    if (!sort || sort.by === "calc") return sort && { ...sort };
    const [before, after] = sort.by === "field" ? [wasFields, fields] : [was.vals, c.vals];
    return before.includes(sort.name) && !after.includes(sort.name) ? null : { ...sort };
  };
  const rowSort = kept(c.rowSort, was.rows, c.rows);
  const colSort = kept(c.colSort, was.cols, c.cols);
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
  // A sort by the field follows it to its new name.
  const key = zone === "rows" ? "rowSort" : "colSort";
  const sort = c[key];
  const moved = sort?.by === "field" && sort.name === field ? { ...sort, name } : sort;
  return { ...c, [zone]: list, exclude, [key]: moved };
}


/** A calculated field as the Configure Fields popup drags it among the values: a token no column name can be. */
const CALC_TOKEN = "\u0000λ";
export const calcToken = (id: string): string => CALC_TOKEN + id;
export const calcIdOf = (token: string): string | null => (token.startsWith(CALC_TOKEN) ? token.slice(CALC_TOKEN.length) : null);

/** The calculated fields on the pivot, in the order the card places them: the listed ones in the list's order, then
 *  the rest (`ids`, wired, in socket order) with no place. */
function placedCalcs(place: CalcPlaces, ids: readonly string[]): CalcPlaces {
  const listed = place.filter(([id]) => ids.includes(id));
  const rest: CalcPlaces = ids.filter((id) => !listed.some(([k]) => k === id)).map((id) => [id, null]);
  return [...listed, ...rest].filter(([, before]) => before !== false);
}

/** The ids of the calculated fields on the pivot, in the card's order: the order a sort and the core count them in. */
export const calcsOnPivot = (place: CalcPlaces, ids: readonly string[]): string[] => placedCalcs(place, ids).map(([id]) => id);

/** The Values zone in its order: the plain values, each calculated field before the value its place names, and the
 *  ones with no place (or whose value is away) after them all. */
export function valuesWithCalcs(vals: readonly string[], place: CalcPlaces, ids: readonly string[]): string[] {
  const on = placedCalcs(place, ids);
  const out: string[] = [];
  for (const v of vals) {
    for (const [id, before] of on) if (before === v) out.push(calcToken(id));
    out.push(v);
  }
  for (const [id, before] of on) if (before === null || !vals.includes(before as string)) out.push(calcToken(id));
  return out;
}

/** The Values zone's order back to what the card saves: its plain values, and the calculated fields' places in the
 *  zone's order, each before the next value after it; a wired one not in the zone is off the pivot. A place for an
 *  unwired field is kept as it was. */
export function placesFrom(tokens: readonly string[], ids: readonly string[], prev: CalcPlaces): { vals: string[]; place: CalcPlaces } {
  const vals = tokens.filter((t) => calcIdOf(t) === null);
  const place: CalcPlaces = [];
  tokens.forEach((t, i) => {
    const id = calcIdOf(t);
    if (id !== null) place.push([id, tokens.slice(i + 1).find((x) => calcIdOf(x) === null) ?? null]);
  });
  for (const id of ids) if (!place.some(([k]) => k === id)) place.push([id, false]);
  for (const p of prev) if (!ids.includes(p[0])) place.push([p[0], p[1]]);
  return { vals, place };
}

/** A calculated field's name: as the card's last result names it (a wired name included), else as typed, else
 *  `Calculated N` by its row (`n`, 0-based), as the core names a blank one. */
export function calcFieldName(node: { cachedResult: unknown; stringLiterals: Record<string, string> }, id: string, n: number): string {
  const r = node.cachedResult;
  const layout = r && typeof r === "object" && !isSolError(r) ? pivotLayoutOf(r as never) : null;
  return layout?.calcNames?.[id] || node.stringLiterals[`calcName${id}`]?.trim() || `Calculated ${n + 1}`;
}
