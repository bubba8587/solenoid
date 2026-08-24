import { describe, it, expect } from "vitest";
import { buildCatalog } from "./catalogUtils";
import { despace } from "./formulaNodeParity";
import { EXCEL_IMPL_META, FRAME_SURFACE_NAMES } from "./excelFunctions";
import type { CatalogEntry, CatalogCategory, CatalogPair, NodeCatalogEntry } from "./AddNodeMenu";

const isCategory = (e: CatalogEntry): e is CatalogCategory => e.type === "category";
const isPair = (e: CatalogEntry): e is CatalogPair => e.type === "pair";

// formulaNodeParity (the invariant the author demanded: node and formula surfaces MUST
// carry the same CAPABILITY). Every CURATED formula function — one with declared meta in
// EXCEL_IMPL_META — must be reachable as a node. Most match a catalog leaf's label or Excel
// alias directly; the rest are the SAME capability under a different node label or a node
// MODE (which the author explicitly blessed), enumerated here with where they live. A new
// declared function that has no node fails this until it gets one (or an entry below with a
// reason) — that is the gap-guard. Formula.js PASSTHROUGH functions (no declared meta, e.g.
// N / T / TYPE / SUBTOTAL) are the separate open-surface issue and are out of scope here.

// formula name → the node (and mode/op) that carries the same capability.
const FORMULA_NODE_ALIAS: Record<string, string> = {
  // Set family → the Set / Set relation nodes' ops
  SETUNION: "Set (union op)", SETINTERSECT: "Set (intersection op)",
  SETDIFFERENCE: "Set (difference op)", SETSYMDIFF: "Set (symmetric-difference op)",
  SETEQUAL: "Set relation (equal op)", SETSUBSET: "Set relation (subset op)",
  SETSUPERSET: "Set relation (superset op)", SETDISJOINT: "Set relation (disjoint op)",
  // Coalesce / Fill node ops
  COALESCE: "Coalesce / Fill (coalesce op)", FILLFORWARD: "Coalesce / Fill (forward op)",
  FILLBACKWARD: "Coalesce / Fill (backward op)", FILLMEAN: "Coalesce / Fill (mean op)",
  FILLMEDIAN: "Coalesce / Fill (median op)", FILLMODE: "Coalesce / Fill (mode op)",
  FILLINTERPOLATE: "Coalesce / Fill (interpolate op)", FILLVALUE: "Coalesce / Fill (value op)",
  FILLDROP: "Coalesce / Fill (drop op)",
  // Pad node directions
  PADLEFT: "Pad (left)", PADRIGHT: "Pad (right)",
  // HYPOT(A,B) = √(A²+B²) is TwoInputMath's hypot op (labelled HYPOT); HYPOTENUSE is its
  // curated formula spelling (the standalone Hypotenuse node was deleted 2026-08-24).
  HYPOTENUSE: "TwoInputMath (HYPOT op)",
  // stats nodes under their canonical labels
  COVAR: "Covariance node", RANK: "Rank node",
  STDEV: "Aggregate / Spread (stdev)", VAR: "Aggregate / Spread (variance)",
  // node MODES added for the data-node batch (author-blessed)
  GRADIENT: "DIFF node (∇ gradient mode)", PCTCHANGE: "DIFF node (% mode)",
  ZSCORE: "Normalize node (z-score mode)", PERMUTATIONS: "Combinations node (permutations mode)",
  RLE: "Run Lengths node", TRAPZ: "Integrate node",
  GROWTH: "TREND node (exponential mode)", ORDINAL: "Spell Number node (ordinal mode)",
  NTILE: "Bin node (quantiles mode)", ISOUTLIER: "Outliers node", FROMEPOCH: "Epoch → Date node", TOEPOCH: "Date → Epoch node",
  DATETRUNC: "Truncate Date node",
  LEVENSHTEIN: "Text Similarity node (edit distance)", SIMILARITY: "Text Similarity node",
  FITDIST: "Fit Distribution node", RANDDIST: "Distribution node (sample form)",
  POLYROOTS: "Polynomial Roots node",
  SAVGOL: "Smooth node (Savitzky–Golay op)", LOWESS: "Smooth node (LOWESS op)", GAUSSIANSMOOTH: "Smooth node (Gaussian op)",
  LOGRETURNS: "Returns node (log op)", CUMRETURNS: "Returns node (cumulative op)", DRAWDOWN: "Returns node (drawdown op)",
  MAXDRAWDOWN: "Returns node (max drawdown op)", CAGR: "Returns node (CAGR op)", VOLATILITY: "Returns node (volatility op)",
  SHARPE: "Returns node (Sharpe op)", SORTINO: "Returns node (Sortino op)",
  SOLVE: "Solve A·x = b node", EIGENVALUES: "Eigen (symmetric) node", EIGENVECTORS: "Eigen (symmetric) node", SPECTRUM: "Spectrum (FFT) node",
  HISTOGRAM2D: "Histogram node (2-D mode)",
  // the Hypothesis Test card's non-Excel ops
  KRUSKAL: "Hypothesis Test (Kruskal–Wallis op)", MANNWHITNEY: "Hypothesis Test (Mann–Whitney op)",
  WILCOXON: "Hypothesis Test (Wilcoxon op)", KSTEST: "Hypothesis Test (KS op)",
  PROPTEST: "Hypothesis Test (two-proportion op)", BINOMTEST: "Hypothesis Test (binomial op)",
};

function nodeNames(): Set<string> {
  const names = new Set<string>();
  const walk = (es: CatalogEntry[]): void => {
    for (const e of es) {
      if (isCategory(e)) { walk(e.children); continue; }
      if (isPair(e)) { walk(e.children); continue; }
      const leaf: NodeCatalogEntry = e;
      names.add(despace(leaf.label).toUpperCase());
      for (const x of leaf.excel ?? []) names.add(x.excel.toUpperCase());
    }
  };
  walk(buildCatalog(false));
  return names;
}

describe("formula ↔ node capability parity (curated surface)", () => {
  it("every declared-meta function is reachable as a node (name, alias, or blessed mode)", () => {
    const nodes = nodeNames();
    const uncovered = Object.keys(EXCEL_IMPL_META)
      .map((n) => n.toUpperCase())
      .filter((n) => !nodes.has(n) && !(n in FRAME_SURFACE_NAMES) && !(n in FORMULA_NODE_ALIAS));
    expect(
      uncovered,
      `Curated formula functions with NO node — either give them a node, or (if the capability ` +
      `already exists under another node label/op) add them to FORMULA_NODE_ALIAS with where it lives:\n  ` +
      uncovered.join("\n  "),
    ).toEqual([]);
  });

  it("the alias list stays honest — every entry is a declared function that needs it", () => {
    const nodes = nodeNames();
    const stale = Object.keys(FORMULA_NODE_ALIAS).filter(
      (n) => !(n in EXCEL_IMPL_META) || nodes.has(n),
    );
    expect(stale, `FORMULA_NODE_ALIAS entries that are no longer needed (drop them):\n  ${stale.join("\n  ")}`).toEqual([]);
  });
});
