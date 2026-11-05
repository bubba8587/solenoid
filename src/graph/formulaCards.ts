// [[B16]] oneFormulaSurface, [[B11]] maximalMerge
// Which card each formula function belongs to, read off the catalog: a card's Excel names, its ops' formula names,
// its label run together (Connected Regions is CONNECTEDREGIONS), and FORMULA_CARD_HOMES for the rest.

import { isCategory, isPair } from "./catalogSearch";
import { buildCatalog } from "./catalogUtils";
import { despace } from "./formulaNodeParity";
import { FUNCTION_ARITY, FRAME_SURFACE_NAMES } from "./excelFunctions";
import { packFormulaNames } from "./formulaExtensions";
import { NODE_OPS } from "./nodeOps";
import type { CatalogEntry } from "./AddNodeMenu";

export interface FormulaHome {
  /** The card's catalog type. */
  type: string;
  /** The op, mode or form on that card that answers the formula, as the card names it. */
  via?: string;
}

/** Functions no Excel name, op or label places: each names its card and how the card does it. */
export const FORMULA_CARD_HOMES: Record<string, FormulaHome> = {
  BINOMTEST: { type: "binomial-test" },
  COVAR: { type: "cov-pop" },
  DATETRUNC: { type: "date-trunc" },
  EIGENVECTORS: { type: "mat-eigen" },
  FITDIST: { type: "fit-distribution" },
  FROMEPOCH: { type: "date-epoch-from" },
  TOEPOCH: { type: "date-epoch-to" },
  GRIDDATA: { type: "interpolate", via: "Points mode" },
  HISTOGRAM2D: { type: "histogram", via: "2-D mode" },
  ISBOOLEAN: { type: "is-test", via: "ISBOOLEAN" },
  ISOUTLIER: { type: "list-outliers" },
  KRUSKAL: { type: "kruskal-test" },
  KSTEST: { type: "ks-test" },
  MANNWHITNEY: { type: "mannwhitney-test" },
  WILCOXON: { type: "wilcoxon-test" },
  PROPTEST: { type: "proportion-test" },
  LEVENSHTEIN: { type: "text-similarity", via: "Edit distance" },
  SIMILARITY: { type: "text-similarity" },
  NTILE: { type: "list-bin", via: "Equal-count buckets" },
  ORDINAL: { type: "ts-ordinal" },
  PADLEFT: { type: "list-pad", via: "Left" },
  PADRIGHT: { type: "list-pad", via: "Right" },
  PERMUTATIONS: { type: "list-combinations", via: "Permutations" },
  POLYROOTS: { type: "cx-polyroots" },
  RANDDIST: { type: "distributions", via: "Sample form" },
  RANK: { type: "rank-eq" },
  RLE: { type: "list-rle" },
  SOLVE: { type: "mat-solve" },
  SPECTRUM: { type: "list-spectrum" },
  STDEV: { type: "reduce-stdev" },
  VAR: { type: "reduce-var_s" },
  TRAPZ: { type: "list-trapz" },
  ZSCORE: { type: "list-normalize", via: "z-score" },
  // Pack functions behind a pack card.
  ESERIESVALUE: { type: "elec-eseries" },
  HEARTRATEZONES: { type: "hf-zones" },
  COLEBROOK: { type: "fl-colebrook" },
  ANTOINE: { type: "th-antoine" },
  SUNRISE: { type: "es-sunrise-sunset", via: "Sunrise" },
  SUNSET: { type: "es-sunrise-sunset", via: "Sunset" },
  DAYLENGTH: { type: "es-sunrise-sunset", via: "Day length" },
};

const FX_NAME = /^[A-Z][A-Z0-9.]*$/;

let _homes: Map<string, FormulaHome> | null = null;

/** Every formula function's card, by function name (UPPERCASE). Pack catalogs included, active or not. */
export function formulaHomes(): Map<string, FormulaHome> {
  if (_homes) return _homes;
  const homes = new Map<string, FormulaHome>();
  const byLabel = new Map<string, string>();
  const walk = (es: CatalogEntry[]): void => {
    for (const e of es) {
      if (isCategory(e)) { walk(e.children); continue; }
      if (isPair(e)) { walk(e.children); continue; }
      if (e.hidden) continue;
      const key = despace(e.label).toUpperCase();
      if (!byLabel.has(key)) byLabel.set(key, e.type);
      for (const x of e.excel ?? []) if (!homes.has(x.excel.toUpperCase())) homes.set(x.excel.toUpperCase(), { type: e.type });
    }
  };
  walk(buildCatalog(false));
  const names = [...Object.keys(FUNCTION_ARITY), ...packFormulaNames()].map((n) => n.toUpperCase());
  // An op's `fx` can be a display name with no function behind it (Drop Columns' KEEPCOLS): only real names count.
  const real = new Set(names);
  for (const d of NODE_OPS) {
    for (const o of d.ops ?? []) {
      for (const f of (o.fx ?? "").split(/[\s,/]+/)) {
        if (FX_NAME.test(f) && real.has(f) && !homes.has(f)) homes.set(f, { type: d.type, via: o.label });
      }
    }
  }
  for (const name of names) {
    if (homes.has(name) || name in FRAME_SURFACE_NAMES) continue;
    const hand = FORMULA_CARD_HOMES[name];
    if (hand) homes.set(name, hand);
    else if (byLabel.has(name)) homes.set(name, { type: byLabel.get(name)! });
  }
  _homes = homes;
  return homes;
}

/** The formula functions a card answers to, with the op that answers each. */
export function formulasOfCard(type: string): { name: string; via?: string }[] {
  const out: { name: string; via?: string }[] = [];
  for (const [name, home] of formulaHomes()) if (home.type === type) out.push({ name, ...(home.via ? { via: home.via } : {}) });
  return out;
}

/** Cards a formula reaches by an operator rather than a function name, with the operation each one is. */
export const CARD_OPERATORS: Record<string, { text: string; op?: string }[]> = {
  "arith-add": [{ text: "a + b" }],
  "arith-sub": [{ text: "a - b" }],
  "arith-mul": [{ text: "a * b" }],
  "arith-div": [{ text: "a / b" }],
  "arith-pow": [{ text: "a ^ b" }],
  "text-concat": [{ text: "a & b" }],
  comparison: [
    { text: "a = b", op: "eq" }, { text: "a <> b", op: "neq" }, { text: "a < b", op: "lt" },
    { text: "a <= b", op: "lte" }, { text: "a > b", op: "gt" }, { text: "a >= b", op: "gte" },
  ],
};
