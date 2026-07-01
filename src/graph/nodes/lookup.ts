import { ClassicPreset } from "rete";
import { numIn, numOut, listIn } from "./shared";
import { solError, type SolError } from "../errorValue";

// MATCH is intentionally not implemented — XMATCH supersedes it (exact mode
// is the default), the same way XLOOKUP supersedes VLOOKUP/HLOOKUP/LOOKUP.

// ─── XLOOKUP ───────────────────────────────────────────────────────────────────

export type XLookupMatchMode = "exact" | "next_smaller" | "next_larger";
export type XLookupSearchMode = "first_last" | "last_first" | "binary_asc" | "binary_desc";

export const XLOOKUP_MATCH_MODE_META: Record<XLookupMatchMode, string> = {
  exact:        "Exact match only (0)",
  next_smaller: "Exact or next smaller (-1)",
  next_larger:  "Exact or next larger (1)",
};

export const XLOOKUP_SEARCH_MODE_META: Record<XLookupSearchMode, string> = {
  first_last:  "First to last (1)",
  last_first:  "Last to first (-1)",
  binary_asc:  "Binary search, ascending (2)",
  binary_desc: "Binary search, descending (-2)",
};

export class XLookupNode extends ClassicPreset.Node {
  label: string;
  matchMode: XLookupMatchMode;
  searchMode: XLookupSearchMode;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = { lookup: 0 };
  width = 200;
  height = 330;

  constructor(init?: { label?: string; matchMode?: XLookupMatchMode; searchMode?: XLookupSearchMode }) {
    super("XLookup");
    this.label     = init?.label     ?? "XLOOKUP";
    this.matchMode = init?.matchMode ?? "exact";
    this.searchMode = init?.searchMode ?? "first_last";
    this.addInput("lookup",       numIn("Lookup"));
    this.addInput("keys",         listIn("Lookup list"));
    this.addInput("values",       listIn("Return list"));
    this.addInput("if_not_found", numIn("If not found"));
    this.addOutput("result", numOut("Value"));
  }

  data(inputs: { lookup?: number[]; keys?: number[][]; values?: number[][]; if_not_found?: number[] }) {
    const lookup   = inputs.lookup?.[0]       ?? this.literals.lookup ?? null;
    const keys     = inputs.keys?.[0]         ?? null;
    const values   = inputs.values?.[0]       ?? null;
    const fallback = inputs.if_not_found?.[0] ?? null;
    let result: number | SolError | null = null;
    if (keys && values && lookup !== null) {
      const idx = this._findIdx(keys, lookup);
      if (idx >= 0 && idx < values.length) result = values[idx];
      // A miss is Excel #N/A — unless If-not-found is wired (= IFNA inline).
      else result = fallback !== null ? fallback : solError("#N/A", "No match found in the lookup list");
    }
    this.cachedResult = result;
    return { result };
  }

  private _findIdx(keys: number[], lookup: number): number {
    switch (this.searchMode) {
      case "first_last":  return this._linear(keys, lookup, 0, 1);
      case "last_first":  return this._linear(keys, lookup, keys.length - 1, -1);
      case "binary_asc":  return this._binary(keys, lookup, true);
      case "binary_desc": return this._binary(keys, lookup, false);
    }
  }

  private _linear(keys: number[], lookup: number, from: number, step: 1 | -1): number {
    const n = keys.length;
    if (this.matchMode === "exact") {
      for (let i = from; step === 1 ? i < n : i >= 0; i += step) {
        if (keys[i] === lookup) return i;
      }
      return -1;
    }
    let bestIdx = -1, bestVal = this.matchMode === "next_smaller" ? -Infinity : Infinity;
    for (let i = from; step === 1 ? i < n : i >= 0; i += step) {
      const k = keys[i];
      if (k === lookup) return i;
      if (this.matchMode === "next_smaller" && k < lookup && k > bestVal) { bestVal = k; bestIdx = i; }
      if (this.matchMode === "next_larger"  && k > lookup && k < bestVal) { bestVal = k; bestIdx = i; }
    }
    return bestIdx;
  }

  private _binary(keys: number[], lookup: number, asc: boolean): number {
    let lo = 0, hi = keys.length - 1, bestIdx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const k = keys[mid];
      if (k === lookup) return mid;
      // For descending arrays, invert the "direction" of the comparison.
      const goRight = asc ? k < lookup : k > lookup;
      if (goRight) {
        if ((asc  && this.matchMode === "next_smaller") ||
            (!asc && this.matchMode === "next_larger"))  bestIdx = mid;
        lo = mid + 1;
      } else {
        if ((asc  && this.matchMode === "next_larger") ||
            (!asc && this.matchMode === "next_smaller")) bestIdx = mid;
        hi = mid - 1;
      }
    }
    return this.matchMode === "exact" ? -1 : bestIdx;
  }
}

