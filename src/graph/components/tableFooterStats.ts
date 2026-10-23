// [[C24]] arraySemantics (nulls and errors in a column profile), [[D99]] rustIsSpec
import { isSolError } from "../errorValue";
import type { FrameCell } from "../frame";
import { frameFnOnCore } from "../frameBackend";
import { formatScalar } from "./format";
import { formatDateSerial, DEFAULT_DATE_FORMAT } from "../nodes/dateSerial";

export type FooterColType = "number" | "string" | "date" | "logical";
export type FooterStat =
  | "sum" | "avg" | "min" | "max" | "median" | "range" | "stddev"
  | "earliest" | "latest"
  | "checked" | "unchecked"
  | "count" | "distinct" | "blank" | "error";

export type ColSummary = {
  profile: ColumnProfile;
  sum: number | null;
  checked: number | null;
  unchecked: number | null;
};

export interface ColumnProfile {
  count: number; blank: number; error: number; distinct: number;
  mean: number | null; std: number | null; min: number | null;
  q25: number | null; median: number | null; q75: number | null; max: number | null;
}

/** A cell as the core reads it; anything else in a column (a nested list, a record) counts as filled text. */
const asCell = (v: unknown): FrameCell =>
  v == null ? null : typeof v === "number" || typeof v === "string" || typeof v === "boolean" || isSolError(v) ? v : String(v);

type ProfileRow = [number, number, number, number, ...(number | null)[]];

/** Each column's footer figures over every row, from the core's `columnProfiles` (Describe's kernel). Null where the
 *  core can't answer. */
export function summarizeColumns(columns: readonly { values: readonly unknown[]; type: FooterColType }[]): ColSummary[] | null {
  const frame = { __frame: true as const, columns: columns.map((c, i) => ({ name: String(i), type: c.type, values: c.values.map(asCell) })) };
  const r = frameFnOnCore("columnProfiles", [frame]);
  if (!r || !Array.isArray(r.value)) return null;
  return (r.value as ProfileRow[]).map(([count, blank, error, distinct, mean, std, min, q25, median, q75, max, sum, checked, unchecked]) => ({
    profile: { count, blank, error, distinct, mean, std, min, q25, median, q75, max },
    sum, checked, unchecked,
  }));
}

export const FOOTER_STAT_LABEL: Record<FooterStat, string> = {
  sum: "Sum", avg: "Average", min: "Min", max: "Max", median: "Median",
  range: "Range", stddev: "Std dev",
  earliest: "Earliest", latest: "Latest",
  checked: "Checked", unchecked: "Unchecked",
  count: "Count", distinct: "Distinct", blank: "Empty", error: "Errors",
};

const COMMON_STATS: readonly FooterStat[] = ["count", "distinct", "blank", "error"];
export const STATS_BY_TYPE: Record<FooterColType, readonly FooterStat[]> = {
  number: ["sum", "avg", "min", "max", "median", "range", "stddev", ...COMMON_STATS],
  date: ["earliest", "latest", ...COMMON_STATS],
  logical: ["checked", "unchecked", ...COMMON_STATS],
  string: [...COMMON_STATS],
};

export function defaultFooterStat(type: FooterColType): FooterStat {
  return type === "number" ? "sum" : "count";
}

/** The statistic a column's footer shows: the pick while the column's type still offers it, else the type's default. */
export function footerStatFor(type: FooterColType, picked: FooterStat | undefined): FooterStat {
  return picked !== undefined && STATS_BY_TYPE[type].includes(picked) ? picked : defaultFooterStat(type);
}

export function footerStatValue(stat: FooterStat, s: ColSummary): number | null {
  const p = s.profile;
  switch (stat) {
    case "sum": return s.sum;
    case "avg": return p.mean;
    case "min": return p.min;
    case "max": return p.max;
    case "median": return p.median;
    case "range": return p.min != null && p.max != null ? p.max - p.min : null;
    case "stddev": return p.std;
    case "earliest": return p.min;
    case "latest": return p.max;
    case "checked": return s.checked;
    case "unchecked": return s.unchecked;
    case "count": return p.count;
    case "distinct": return p.distinct;
    case "blank": return p.blank;
    case "error": return p.error;
  }
}

/** A statistic in the column's own units (a sum, a mean, the latest date), which reads through the column's format like a cell; the rest are counts. */
const IN_COLUMN_UNITS: ReadonlySet<FooterStat> = new Set(["sum", "avg", "min", "max", "median", "range", "stddev", "earliest", "latest"]);
export const statReadsAsCell = (stat: FooterStat): boolean => IN_COLUMN_UNITS.has(stat);

export function formatFooterStat(stat: FooterStat, v: number | null): string {
  if (v == null) return "—";
  if (stat === "earliest" || stat === "latest") return formatDateSerial(v, DEFAULT_DATE_FORMAT);
  return formatScalar(v);
}
