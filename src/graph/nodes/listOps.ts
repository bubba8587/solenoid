// [[C17]] shareImpl
import type { SolError } from "../errorValue";

export type Cell = number | null | SolError;

// ─── Shape: list in, list out ─────────────────────────────────────────────────

export type PadDir = "right" | "left";

export type RunningOp = "sum" | "avg" | "min" | "max" | "median" | "product" | "stdev";

// ─── Find: list in, scalar out ────────────────────────────────────────────────

export type ArgMinMaxOp = "argmax" | "argmin" | "argsort" | "argsort_desc" | "which";
export const ARG_LIST_OPS: ReadonlySet<ArgMinMaxOp> = new Set(["argsort", "argsort_desc", "which"]);

export type XMatchMatchMode = "exact" | "next_larger" | "next_smaller";
export type XMatchSearchMode = "first" | "last";

// ─── Weighted statistics ──────────────────────────────────────────────────────

export type WeightedOp = "wavg" | "wvar" | "wstdev";

// ─── Sets ─────────────────────────────────────────────────────────────────────

export type SetOp = "union" | "intersect" | "difference" | "symdiff";

export type SetRelation = "equal" | "subset" | "superset" | "disjoint";

// ─── Fill / Coalesce — the opt-in to treat a missing as something ──────────────

export type FillOp =
  | "constant" | "ffill" | "bfill" | "mean" | "median" | "mode"
  | "interpolate" | "drop" | "coalesce";

export type OutlierMethod = "z" | "iqr" | "mad";


