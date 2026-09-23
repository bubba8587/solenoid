// [[C24]] arraySemantics (nulls and errors in a column profile)
import type { ColumnProfile } from "../frameVerbs";
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

export function formatFooterStat(stat: FooterStat, v: number | null): string {
  if (v == null) return "—";
  if (stat === "earliest" || stat === "latest") return formatDateSerial(v, DEFAULT_DATE_FORMAT);
  return formatScalar(v);
}
