// [[C130]] rustCore, [[D99]] rustIsSpec
// The frame verbs' vocabulary: the ops a card asks the engine for and their settings. The verbs themselves run on the
// core (`crates/solenoid-core`) or on Polars.
import type { FrameCell } from "./frame";
import type { ComparisonOp } from "./nodes/logic";
import type { FormatAnnotation } from "./formatAnnotationStore";

export type AggOp =
  | "sum" | "avg" | "min" | "max" | "count"
  | "product" | "median" | "mode" | "stdev" | "stdevp" | "var" | "varp"
  | "percentof";

export type FilterOp =
  | ComparisonOp | "contains" | "startsWith" | "endsWith" | "isblank" | "notblank" | "iserror" | "noterror"
  | "listContains" | "listContainsAny" | "listContainsAll" | "listEmpty";

export const VALUELESS_FILTER_OPS: ReadonlySet<FilterOp> = new Set<FilterOp>(["isblank", "notblank", "iserror", "noterror", "listEmpty"]);

export interface FilterCond { column: string; op: FilterOp; value: FrameCell; matchCase?: boolean }
export interface FilterCondConfig { op: FilterOp; matchCase?: boolean }
export type FilterCombine = "and" | "or";

/** `readingScale` marks the column as readings on an offset scale (°C 1, °F 5/9); `unitScale` is a linear unit's
 *  scale (km 1000), which a variance needs to land in base SI. The engines see no units, so the lowering names both
 *  (`withUnitScales`). */
export interface AggSpec { column: string; op: AggOp; as: string; readingScale?: number; unitScale?: number }

export interface PivotSpec {
  rowFields: readonly string[];
  colFields: readonly string[];
  values: readonly string[];
  funcs: readonly AggOp[];
  rowTotalDepth?: number;
  colTotalDepth?: number;
  rowSort?: number;
  colSort?: number;
  relativeTo?: number;
  filter?: ReadonlyArray<boolean | null>;
  /** Columns the Pivot view lists under each row group ([[C128]] pivotDetails); the output never changes with them. */
  details?: readonly string[];
}

export type WindowFn =
  | "row_number" | "rank" | "dense_rank" | "percent_rank" | "ntile"
  | "cumsum" | "cumavg" | "cummin" | "cummax" | "cumcount"
  | "lag" | "lead" | "diff" | "pct_change"
  | "rolling_sum" | "rolling_avg" | "rolling_min" | "rolling_max"
  | "group_sum" | "group_avg" | "group_min" | "group_max" | "group_count" | "share" | "first" | "last";

export interface WindowSpec {
  /** As on `AggSpec`: the column holds readings on an offset scale. */
  readingScale?: number;
  partitionBy: string[];
  orderBy?: string;
  orderDir?: "asc" | "desc";
  fn: WindowFn;
  column?: string;
  as: string;
  n?: number;
}

export const WINDOW_FN_NEEDS_COLUMN: ReadonlySet<WindowFn> = new Set([
  "cumsum", "cumavg", "cummin", "cummax", "lag", "lead", "diff", "pct_change",
  "rolling_sum", "rolling_avg", "rolling_min", "rolling_max",
  "group_sum", "group_avg", "group_min", "group_max", "group_count", "share", "first", "last",
]);
export const WINDOW_FN_NEEDS_N: ReadonlySet<WindowFn> = new Set(["lag", "lead", "rolling_sum", "rolling_avg", "rolling_min", "rolling_max", "ntile"]);

export const PCT_CHANGE_FROM_ZERO = "Percent change from zero is undefined";
export const ZERO_GROUP_TOTAL = "The group total is 0";

export type FrameOp =
  | { kind: "select"; columns: string[] }
  | { kind: "drop"; columns: string[] }
  | { kind: "rename"; map: Record<string, string> }
  | { kind: "sort"; by: string; dir: "asc" | "desc" }
  | { kind: "distinct"; columns?: string[] }
  | { kind: "head"; n: number }
  | { kind: "filter"; column: string; op: FilterOp; value: FrameCell; matchCase?: boolean }
  | { kind: "filterMulti"; combine: FilterCombine; conditions: FilterCond[]; complement?: boolean }
  | { kind: "groupBy"; keys: string[]; aggs: AggSpec[] }
  | { kind: "unpivot"; idColumns: string[]; valueColumns: string[]; variableName?: string; valueName?: string }
  | ({ kind: "pivot" } & PivotSpec)
  | ({ kind: "window" } & WindowSpec)
  | { kind: "fillBlanks"; columns: string[]; dir: "down" | "up" }
  | { kind: "replaceValues"; column: string; find: string; replaceWith: string; mode: "cell" | "substring" }
  | { kind: "sliceRows"; mode: "first" | "last" | "skip" | "range"; n: number; to?: number }
  | { kind: "dropBlankRows"; mode: "all" | "any" }
  | { kind: "addIndex"; name: string; start: number }
  | { kind: "splitColumn"; column: string; delimiter: string; into?: string[] }
  | { kind: "mergeColumns"; columns: string[]; separator: string; name: string }
  | { kind: "formats"; formats: Record<string, FormatAnnotation> };

export const FRAME_OP_KINDS = [
  "select", "drop", "rename", "sort", "distinct", "head",
  "filter", "filterMulti", "groupBy", "unpivot", "pivot", "window", "fillBlanks", "replaceValues", "sliceRows",
  "dropBlankRows", "addIndex", "splitColumn", "mergeColumns", "formats",
] as const satisfies readonly FrameOp["kind"][];
type _MissingFrameOpKind = Exclude<FrameOp["kind"], (typeof FRAME_OP_KINDS)[number]>;
const _frameOpKindsExhaustive: _MissingFrameOpKind[] = [] satisfies never[];
void _frameOpKindsExhaustive;

export type JoinHow = "inner" | "left" | "right" | "outer" | "semi" | "anti" | "asof" | "cross";
export type AsofDirection = "backward" | "forward" | "nearest";
export interface JoinOpts {
  leftKey: string; rightKey: string; how: JoinHow;
  asofDirection?: AsofDirection;
  asofTolerance?: number;
  rightKeyScale?: number;
  rightKeyOffset?: number;
}

export type LookupMatchMode = "exact" | "nextSmaller" | "nextLarger";
export type LookupSearchMode = "first" | "last";
export type DecisionNormalize = "none" | "max" | "range" | "rank";
export type CorrMethod = "pearson" | "spearman" | "kendall" | "covariance";
