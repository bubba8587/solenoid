// [[C24]] arraySemantics (nulls and errors in a column profile)
import { aggregate, percentileOf } from "../nodes/statsOps";
import { isSolError } from "../errorValue";
import type { FrameColType } from "../frame";
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

/** A column's profile, as Describe reads one. The popups show it in the Obsidian plugin too, which runs without the
 *  core, so it is computed here. */
export function describeColumn(values: readonly unknown[], type: FrameColType | undefined): ColumnProfile {
  let count = 0, error = 0;
  const distinctNums = new Set<number>(), distinctBools = new Set<boolean>(), distinctText = new Set<string>();
  for (const v of values) {
    if (v == null) continue;
    count++;
    if (isSolError(v)) error++;
    else if (typeof v === "number") distinctNums.add(v);
    else if (typeof v === "boolean") distinctBools.add(v);
    else distinctText.add(String(v));
  }
  const profile: ColumnProfile = {
    count, blank: values.length - count, error,
    distinct: distinctNums.size + distinctBools.size + distinctText.size,
    mean: null, std: null, min: null, q25: null, median: null, q75: null, max: null,
  };
  if (type === "number" || type === "date") {
    const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const stat = (op: "avg" | "stdev" | "min" | "max"): number | null => { const r = aggregate(op, nums); return typeof r === "number" ? r : null; };
    const sorted = type === "number" ? [...nums].sort((x, y) => x - y) : [];
    const pct = (q: number): number | null => {
      if (sorted.length === 0) return null;
      const r = percentileOf(sorted, q, false);
      return Number.isFinite(r) ? r : null;
    };
    profile.mean = type === "number" ? stat("avg") : null;
    profile.std = type === "number" ? stat("stdev") : null;
    profile.min = stat("min");
    profile.q25 = type === "number" ? pct(0.25) : null;
    profile.median = type === "number" ? pct(0.5) : null;
    profile.q75 = type === "number" ? pct(0.75) : null;
    profile.max = stat("max");
  }
  return profile;
}

/** One column's footer figures over every row. */
export function summarizeColumn(values: readonly unknown[], type: FooterColType): ColSummary {
  const profile = describeColumn(values, type);
  let sum: number | null = null;
  if (type === "number") {
    const r = aggregate("sum", values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)));
    sum = typeof r === "number" ? r : null;
  }
  const checked = type === "logical" ? values.filter((v) => v === true).length : null;
  const unchecked = type === "logical" ? values.filter((v) => v === false).length : null;
  return { profile, sum, checked, unchecked };
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
