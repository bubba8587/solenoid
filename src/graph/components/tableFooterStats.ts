// The Table popup's summary-footer statistics: one pure module so the picker's
// choices, the value it shows and its formatting are testable in a node env (the
// component only wires them to a <select>). Values come from the shared ColumnProfile
// (frameVerbs describeColumn) plus the two logical counts the summary pass collects.
import type { ColumnProfile } from "../frameVerbs";
import { formatScalar } from "./format";
import { formatDateSerial, DEFAULT_DATE_FORMAT } from "../nodes/date";

export type FooterColType = "number" | "string" | "date" | "logical";
export type FooterStat =
  | "sum" | "avg" | "min" | "max" | "median" | "range" | "stddev"
  | "earliest" | "latest"
  | "checked" | "unchecked"
  | "count" | "distinct" | "blank" | "error";

// profile + sum (numeric) + the TRUE/FALSE tallies (logical); one per column.
export type ColSummary = {
  profile: ColumnProfile;
  sum: number | null;
  checked: number | null;
  unchecked: number | null;
};

export const FOOTER_STAT_LABEL: Record<FooterStat, string> = {
  sum: "Sum", avg: "Average", min: "Min", max: "Max", median: "Median",
  range: "Range", stddev: "Std dev",
  earliest: "Earliest", latest: "Latest",
  checked: "Checked", unchecked: "Unchecked",
  count: "Count", distinct: "Distinct", blank: "Empty", error: "Errors",
};

// The presence stats every column offers, after its type-specific ones.
const COMMON_STATS: readonly FooterStat[] = ["count", "distinct", "blank", "error"];
// The picker's options, in order, keyed by column type.
export const STATS_BY_TYPE: Record<FooterColType, readonly FooterStat[]> = {
  number: ["sum", "avg", "min", "max", "median", "range", "stddev", ...COMMON_STATS],
  date: ["earliest", "latest", ...COMMON_STATS],
  logical: ["checked", "unchecked", ...COMMON_STATS],
  string: [...COMMON_STATS],
};

// The stat a column shows until one is picked. Kept as the long-standing default
// (Sum for a number column, Count otherwise) — the type-specific stats are one pick
// away in the dropdown.
export function defaultFooterStat(type: FooterColType): FooterStat {
  return type === "number" ? "sum" : "count";
}

export function footerStatValue(stat: FooterStat, s: ColSummary): number | null {
  const p = s.profile;
  switch (stat) {
    case "sum": return s.sum;
    case "avg": return p.mean;
    case "min": return p.min;
    case "max": return p.max;
    case "median": return p.median;
    // A date column's min/max are its serial bounds — earliest/latest are the same
    // pair, formatted as dates below.
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

// A date bound reads as a formatted date, not a raw serial; everything else is a plain
// number. Missing (no data) shows an em dash.
export function formatFooterStat(stat: FooterStat, v: number | null): string {
  if (v == null) return "—";
  if (stat === "earliest" || stat === "latest") return formatDateSerial(v, DEFAULT_DATE_FORMAT);
  return formatScalar(v);
}
