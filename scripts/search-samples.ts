// [[D5]] searchWiderThanLabel, [[C19]] namingModel
// One sample query per kind of searchable row, run through the real Add-menu search.
// tests/graph/searchSamples.test.ts runs them; SEARCH_SAMPLES_OUT=<file> also writes the results as JSON.
import { flattenLeaves, searchLeaves } from "../src/graph/catalogSearch";
import { buildCatalog } from "../src/graph/catalogUtils";

export interface SearchSample {
  kind: string;
  query: string;
  /** Row types that count as right; a type ending in `*` matches by prefix. */
  want: string[];
  /** How far down the first right row may sit. */
  within: number;
  /** A pack the row needs switched on; the sample searches with every pack on. */
  pack?: string;
}

const s = (kind: string, query: string, want: string | string[], within = 1, pack?: string): SearchSample =>
  ({ kind, query, want: Array.isArray(want) ? want : [want], within, ...(pack ? { pack } : {}) });

export const SEARCH_SAMPLES: SearchSample[] = [
  s("Card label", "Frame Input", "frame-input"),
  s("Card label", "List Sort", "list-sort"),
  s("Card label", "Computed Column", "computed-column"),
  s("Card label, lower case prefix", "frame in", "frame-input"),
  s("Card label, lower case prefix", "spark", "sparkline"),
  s("Card label is a function", "XLOOKUP", "lookup-xlookup"),
  s("Card label is a function", "BYROW", "by-axis"),
  s("Card label is a function", "TOCOL", "reshape-tocol"),
  s("Family name (hover hint)", "table reshape", "reshape-*", 4),
  s("Family name (hover hint)", "bessel", "bessel-*", 4),
  s("Family name (hover hint)", "coupon", "coupon-*", 3),
  s("Family name (hover hint)", "is test", "is-test*"),
  s("Family name (hover hint)", "by axis", "by-axis"),
  s("Op label (Card: Op)", "ISERR", "is-test__op-iserr"),
  s("Op label (Card: Op)", "ISERROR", "is-test__op-iserror"),
  s("Op label (Card: Op)", "Sharpe ratio", "returns__op-sharpe"),
  s("Op label (Card: Op)", "Standard Normal", "distributions__op-normal-s", 2),
  s("Op label (Card: Op)", "waffle", "proportion__op-waffle"),
  s("Op label (Card: Op)", "win/loss", "sparkline__op-winloss"),
  s("Op formula name (Excel → Card: Op)", "NORM.DIST", "distributions__excel-NORM.DIST"),
  s("Op formula name (Excel → Card: Op)", "SORTINO", "returns__excel-SORTINO"),
  s("Op formula name (Excel → Card: Op)", "LOGRETURNS", "returns__excel-LOGRETURNS"),
  s("Op formula name (Excel → Card: Op)", "FILLVALUE", "*__excel-FILLVALUE"),
  s("Card Excel name (Excel → Card)", "SORTBY", "list-sort__excel-SORTBY"),
  s("Card Excel name (Excel → Card)", "COUNTA", "reduce-count__excel-COUNTA"),
  s("Card Excel name (Excel → Card)", "COUNTIF", "sumifs__excel-COUNTIF"),
  s("Card Excel name (Excel → Card)", "ROWS", "*__excel-ROWS"),
  s("Card Excel name (Excel → Card)", "NORM.INV", "distributions__excel-NORM.INV"),
  s("Frame verb Excel names", "GROUPBY", "group-by-frame"),
  s("Frame verb Excel names", "PIVOTBY", "pivot"),
  s("Retired Excel name", "VLOOKUP", "lookup-xlookup"),
  s("Retired Excel name", "MATCH", "lookup-xmatch"),
  s("Retired Excel name", "SUMIF", "sumifs"),
  s("Retired Excel name", "STDEVP", "reduce-stdev*"),
  s("Keyword (alternate spelling)", "flatten", ["reshape-tocol", "reshape-torow"], 2),
  s("Pack card keyword", "savitzky-golay", "list-smooth*", 1, "Scientific"),
  s("Pack card keyword", "k-means", "kmeans*", 1, "Data Science"),
  s("Keyword (alternate spelling)", "kanban", "record__op-board"),
  s("Typo (one edit)", "frane input", "frame-input"),
  s("Typo (one edit)", "sunm", "reduce-sum"),
  s("Typo (one edit)", "xlookpu", "lookup-xlookup"),
  s("Typo (one edit)", "sparklnie", "sparkline"),
  s("Words in any order", "input frame", "frame-input"),
  s("Words in any order", "column computed", "computed-column"),
  s("Argument words (host keywords)", "scan by column", ["reshape-tocol", "reshape-torow"], 2),
  s("Argument words (host keywords)", "descending", "list-sort*", 3),
];

export interface SampleResult extends SearchSample {
  top: { type: string; label: string }[];
  rank: number | null;
  pass: boolean;
}

const matches = (want: string, type: string): boolean => {
  if (want.startsWith("*")) return type.endsWith(want.slice(1));
  if (want.endsWith("*")) return type.startsWith(want.slice(0, -1));
  return type === want;
};

export function runSearchSamples(samples = SEARCH_SAMPLES, depth = 5): SampleResult[] {
  const active = flattenLeaves(buildCatalog(true));
  // Every pack on, as a user who switched them on sees the menu; hidden entries stay out.
  const withPacks = flattenLeaves(buildCatalog(false)).filter((l) => !l.leaf.hidden);
  return samples.map((sample) => {
    const found = searchLeaves(sample.pack ? withPacks : active, sample.query);
    const at = found.findIndex((leaf) => sample.want.some((w) => matches(w, leaf.type)));
    const rank = at < 0 ? null : at + 1;
    return {
      ...sample,
      top: found.slice(0, depth).map((leaf) => ({ type: leaf.type, label: leaf.label })),
      rank,
      pass: rank !== null && rank <= sample.within,
    };
  });
}
