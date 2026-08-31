// Per OP family (a node class with an `op` field): what ops it has and how they
// surface. The `{ }` marker is DERIVED, never declared. An ARGUMENT family is not
// declared here at all (DESIGN.md § Op pickers; nodeOps.test.ts pins both directions).

import type { NodeCatalogEntry } from "./AddNodeMenu";
import { DIST_SPECS, DistributionNode, type DistKey } from "./nodes/distribution";

import { ChartNode, SparklineNode, SurfaceNode, GaugeNode, ProportionNode, RecordNode } from "./nodes/visual";
import { CHART_OP_META, SPARKLINE_OP_META, GAUGE_OP_META, PROPORTION_OP_META, RECORD_OP_META } from "./nodes/visual";
import {
  FillNode, SetNode, SumIfsNode,
  FILL_OP_META, COND_AGG_OP_META,
  SET_META, PAD_OP_META, PadNode,
  SeriesNode,
} from "./nodes/list";
import { HeadNode, ColumnsNode, HEAD_OP_META, COLUMNS_OP_META } from "./nodes/frame";
import { RegexNode, REGEX_OP_META } from "./nodes/text";
import { DATE_DIFF_OP_META, DateTimeValueNode, WorkdaysNode } from "./nodes/date";
import { IFErrorNode } from "./nodes/logic";
import { ByAxisNode, BY_AXIS_OP_META } from "./nodes/tableLambda";
import { StackNode, STACK_OP_META } from "./nodes/matrix";
import { NpvNode, IrrNode, NPV_OP_META, IRR_OP_META } from "./nodes/finance";
import {
  IsEvenOddNode, ComparisonNode, IsTestNode,
  PARITY_OP_META, COMPARISON_OP_META, IS_TEST_OP_META,
} from "./nodes/logic";
import { RegressionNode, CorrelNode, ForecastNode, LinestNode, REGRESSION_OP_META, CORREL_OP_META, FORECAST_OP_META, FIT_OP_META } from "./nodes/stats";
import {
  TwoInputMathNode, GcdNode, RoundNNode,
  TWO_INPUT_MATH_OP_META, GCD_OP_META, ROUNDN_OP_META,
} from "./nodes/scalar";
// Families whose every op has its own hand-written leaf, via the node barrel — they
// contribute no ops list, only their class (for `instanceof`).
import {
  AggregateNode, ArgMinMaxNode, ArithmeticNode,
  BesselNode, BitwiseNode,
  BondPriceNode, BooleanOpNode, CharCodeNode, 
  CombinatoricsNode, ComplexBinaryNode, ComplexUnaryNode,
  ConfidenceNode, ConstantNode, CouponNode, CovarianceNode,
  CumPmtNode, DateAddNode, DateDiffNode, EpochNode, SmoothNode, SMOOTH_OP_META, type SmoothOp, ReturnsNode, RETURNS_OP_META, type ReturnsOp,
  DatePartNode, DepreciationNode, DollarNode, DurationNode,
  ESeriesNode, 
  FisherNode,
  IpmtPpmtNode, MRoundNode,
  MatDetNode, MathFnNode, 
  OddCouponNode,
  PhysicsConstantNode,
  PriceDiscNode, PriceMatNode,
  RankPercentileNode, RomanArabicNode, SecurityDiscNode,
  SumProductNode, TBillNode, 
  HypothesisTestNode, TableReshapeNode, TableSelectNode, TakeDropNode, TAKEDROP_OP_META,
  TextAfterBeforeNode, TextFindNode, TextSliceNode, TextTransformNode,
  TodayNowNode, UrlEncodeNode, WeekInfoNode, 
  WeightedNode,
} from "./rete-nodes";


/** How a family's ops surface in the Add menu; per-op leaves are earned
 *  deliberately, so `collapsed` is the default. */
export type OpExposure = "collapsed" | "leaves";

interface NodeOpsBase {
  /** Catalog type of the leaf representing this family — the one that carries the
   *  `{ }` marker when ops are hidden. */
  type: string;
  /** Defaults to `collapsed`. */
  expose?: OpExposure;
  /** The node class, matched by `instanceof` — a constructor-NAME match would
   *  quietly break in a minified build. */
  ctor: new (...a: never[]) => object;
  /** Suppress the `{ }` marker while keeping every op searchable; the default is
   *  derived (marked iff ops are hidden). */
  mark?: boolean;
  /** Ops that already have a hand-written leaf of their own; machine-checked
   *  against the catalog by `nodeOps.test.ts`. */
  leafOps?: string[];
}

/** A declaration either lists its ops AND can build them, or lists neither — an
 *  ops list with no `create` would produce a search row that cannot be added to
 *  the graph. */
export type NodeOpsDecl = NodeOpsBase & (
  | { ops: Array<OpEntryDecl>; create: (op: string) => unknown }
  | { ops?: undefined; create?: undefined }
);

/** One op of a family; `fx` is the FORMULA name (formulaNaming Tier 3), declared where
 *  despacing the label would not yield it: a prose label (despacing a sentence
 *  collides — Coalesce/Fill's FILLINTERPOLATE) or a bare label whose family
 *  word lives in the card title (Running's SUM → RUNNINGSUM). */
export interface OpEntryDecl { op: string; label: string; fx?: string; keywords?: string }

/** Read an OP_META table into an op list — every table carries `label`, and `fx`
 *  rides along when declared. */
function fromMeta(meta: Record<string, { label: string; fx?: string }>): OpEntryDecl[] {
  return Object.entries(meta).map(([op, m]) => ({ op, label: m.label, ...(m.fx ? { fx: m.fx } : {}) }));
}

/** The Distribution node's op axis is the DISTRIBUTION; the curve/inverse pick
 *  is the `form` argument (an ArgSelect). Typing "norm.inv" or "weibull" still lands on
 *  the right pick — the Excel names ride in `keywords`, which scores at full
 *  weight and never renders. They used to sit in the LABEL, where four dotted
 *  spellings made one row 630px against a 94px median and, since the panel's
 *  columns size to their widest item, stretched the whole menu to 3× on the first
 *  keystroke. Each op's formula name (fx) is its primary Excel spelling — dotted,
 *  so despacing "Gamma" onto the GAMMA function can never happen. */
const DIST_OPS: OpEntryDecl[] = (Object.keys(DIST_SPECS) as DistKey[]).map((op) => ({
  op,
  label: DIST_SPECS[op].label,
  fx: DIST_SPECS[op].excel.split(" / ")[0],
  keywords: DIST_SPECS[op].excel,
}));


/** The Rank & Percentile ops that have their own Add-menu leaf (the .INC forms
 *  and the four bare ops); shared by its three pair declarations below, which
 *  the leafOps test checks against the class as a whole. */
const RANK_PERCENTILE_LEAF_OPS = [
  "large", "small", "rank-eq", "rank-avg", "percentile-inc", "quartile-inc", "percentrank-inc",
];

export const NODE_OPS: NodeOpsDecl[] = [
  // ── A chart TYPE is a thing you search for by name ──
  { type: "chart", ctor: ChartNode, ops: fromMeta(CHART_OP_META),
    create: (op) => new ChartNode({ op: op as never }) },
  { type: "sparkline", ctor: SparklineNode, ops: fromMeta(SPARKLINE_OP_META),
    create: (op) => new SparklineNode({ op: op as never }) },
  // A figure's drawing is likewise a thing you search for by name — "treemap", "kanban",
  // "bullet graph" — so each is an op row ("Proportion: Treemap"), like a chart type.
  { type: "gauge", ctor: GaugeNode, ops: fromMeta(GAUGE_OP_META),
    create: (op) => new GaugeNode({ op: op as never }) },
  { type: "proportion", ctor: ProportionNode, ops: fromMeta(PROPORTION_OP_META),
    create: (op) => new ProportionNode({ op: op as never }) },
  { type: "record", ctor: RecordNode, ops: fromMeta(RECORD_OP_META),
    create: (op) => new RecordNode({ op: op as never }) },
  // The 3-D surface and its flat contour twin: two views of one grid, one leaf each.
  { type: "surface", ctor: SurfaceNode },
  // A distribution is likewise a thing you search for by name; its ops' formula
  // names are the real Excel spellings (fx in DIST_OPS).
  { type: "distribution", ctor: DistributionNode, ops: DIST_OPS,
    create: (op) => new DistributionNode({ op: op as never }) },

  // TAKE/DROP are one rank-preserving class (list, matrix or scalar); both ops have
  // their own bare leaf, so neither becomes a "TAKE: Drop" colon row. The sign of the
  // count is the direction, an argument.
  { type: "takedrop", ctor: TakeDropNode, ops: fromMeta(TAKEDROP_OP_META),
    create: (op) => new TakeDropNode({ op: op as never }), leafOps: ["take", "drop"] },

  // ── Each op stands alone as a name ──
  // Three parameterizations of one arithmetic progression, each with its own leaf.
  { type: "list-range", ctor: SeriesNode },
  { type: "list-fill", ctor: FillNode, ops: fromMeta(FILL_OP_META),
    create: (op) => new FillNode({ op: op as never }) },
  { type: "head", ctor: HeadNode, ops: fromMeta(HEAD_OP_META),
    create: (op) => new HeadNode({ op: op as never }) },
  // Both ops have their own bare Add-menu leaf ("Keep Columns" / "Drop Columns"), so
  // neither becomes a "Keep Columns: Drop" colon row; the decl still carries kind +
  // op fx names for the accent and uniqueNameMap.
  { type: "xstack", ctor: StackNode, ops: fromMeta(STACK_OP_META),
    create: (op) => new StackNode({ op: op as never }) },
  { type: "by-axis", ctor: ByAxisNode, ops: fromMeta(BY_AXIS_OP_META),
    create: (op) => new ByAxisNode({ op: op as never }), leafOps: ["row", "col"] },
  { type: "npv", ctor: NpvNode, ops: fromMeta(NPV_OP_META),
    create: (op) => new NpvNode({ op: op as never }), leafOps: ["periods", "dates"] },
  { type: "irr", ctor: IrrNode, ops: fromMeta(IRR_OP_META),
    create: (op) => new IrrNode({ op: op as never }), leafOps: ["periods", "dates"] },
  { type: "keep-columns", ctor: ColumnsNode, ops: fromMeta(COLUMNS_OP_META),
    create: (op) => new ColumnsNode({ op: op as never }), leafOps: ["keep", "drop"] },
  { type: "list-pad", ctor: PadNode, ops: fromMeta(PAD_OP_META),
    create: (op) => new PadNode({ op: op as never }) },
  { type: "list-set", ctor: SetNode, ops: fromMeta(SET_META),
    create: (op) => new SetNode({ op: op as never }) },
  { type: "iferror", ctor: IFErrorNode,
    ops: [{ op: "iferror", label: "IFERROR" }, { op: "ifna", label: "IFNA" }],
    create: (op) => new IFErrorNode({ op: op as never }), leafOps: ["iferror", "ifna"] },
  { type: "regex", ctor: RegexNode, ops: fromMeta(REGEX_OP_META),
    create: (op) => new RegexNode({ op: op as never }) },
  // Text Filter's ops are its CONDITION; as operations they would also claim
  // formula names they can't own ("Contains" despaces onto CONTAINS).
  // Contains / starts with / ends with are the predicate ARGUMENT, not four functions.
  // (`contains` despaced onto the real CONTAINS function by coincidence, which is
  // exactly the collision aggregatorsAreArguments warns an argument's op rows cause.) Searched words moved
  // to the host leaf's keywords.
  { type: "sumifs", ctor: SumIfsNode, ops: fromMeta(COND_AGG_OP_META),
    create: (op) => new SumIfsNode({ op: op as never }) },
  { type: "regression-steyx", ctor: RegressionNode, ops: fromMeta(REGRESSION_OP_META),
    create: (op) => new RegressionNode({ op: op as never }) },
  { type: "correl-correl", ctor: CorrelNode, ops: fromMeta(CORREL_OP_META),
    create: (op) => new CorrelNode({ op: op as never }) },
  { type: "forecast", ctor: ForecastNode, ops: fromMeta(FORECAST_OP_META),
    create: (op) => new ForecastNode({ op: op as never }) },
  { type: "linest", ctor: LinestNode, ops: fromMeta(FIT_OP_META),
    create: (op) => new LinestNode({ op: op as never }) },
  // Label already names both ops.
  { type: "iseven-isodd", ctor: IsEvenOddNode, ops: fromMeta(PARITY_OP_META),
    create: (op) => new IsEvenOddNode({ op: op as never }), leafOps: ["iseven", "isodd"] },

  // `fromMeta` takes the NAME, dropping the dropdown's bare operator glyph.
  { type: "comparison", ctor: ComparisonNode, ops: fromMeta(COMPARISON_OP_META),
    create: (op) => new ComparisonNode({ op: op as never }) },
  { type: "is-test", ctor: IsTestNode, ops: fromMeta(IS_TEST_OP_META),
    create: (op) => new IsTestNode({ op: op as never }) },
  // Label already names both ops, so the marker would only echo it.
  { type: "gcd-lcm", ctor: GcdNode, ops: fromMeta(GCD_OP_META),
    create: (op) => new GcdNode({ op: op as never }), leafOps: ["gcd", "lcm"] },

  // ── Partially exposed: some ops already have leaves, the rest ride in search ──
  { type: "twomath-log", ctor: TwoInputMathNode, ops: fromMeta(TWO_INPUT_MATH_OP_META),
    leafOps: ["log", "atan2", "delta", "gestep", "hypot"],
    create: (op) => new TwoInputMathNode({ op: op as never }) },
  { type: "roundn-round", ctor: RoundNNode, ops: fromMeta(ROUNDN_OP_META),
    leafOps: ["round", "roundup", "rounddown"],
    create: (op) => new RoundNNode({ op: op as never }) },

  // ── Kind-only declarations: already listed op-by-op, so nothing to hide or add
  // to search — these only say what the dropdown selects between (which tints it).
  { type: "reduce-sum", ctor: AggregateNode },
  { type: "arg-argmax", ctor: ArgMinMaxNode },
  { type: "arith-add", ctor: ArithmeticNode },
  { type: "bessel-besselj", ctor: BesselNode },
  { type: "bitwise-bitand", ctor: BitwiseNode },
  { type: "bondprice-price", ctor: BondPriceNode },
  { type: "bool-and", ctor: BooleanOpNode },
  { type: "char-code-char", ctor: CharCodeNode },
  { type: "comb-fact", ctor: CombinatoricsNode },
  { type: "cx-binary-sum", ctor: ComplexBinaryNode },
  { type: "cx-unary-conj", ctor: ComplexUnaryNode },
  { type: "confidence-norm", ctor: ConfidenceNode },
  { type: "constant", ctor: ConstantNode },
  { type: "coupon-coupdaybs", ctor: CouponNode },
  { type: "cov-pop", ctor: CovarianceNode },
  { type: "cumpmt-cumipmt", ctor: CumPmtNode },
  { type: "date-add-edate", ctor: DateAddNode },
  { type: "date-epoch-from", ctor: EpochNode },
  // Each op is the operation (Sharpe IS the card); fx rides in RETURNS_OP_META.
  { type: "returns", ctor: ReturnsNode, ops: fromMeta(RETURNS_OP_META),
    create: (op) => new ReturnsNode({ op: op as ReturnsOp }) },
  { type: "list-smooth", ctor: SmoothNode, ops: fromMeta(SMOOTH_OP_META),
    create: (op) => new SmoothNode({ op: op as SmoothOp }) },
  // The day-count ops have Excel-name leaves; the DATEDIF units are hidden ops on
  // the DATEDIF leaf, which is why that leaf hosts the declaration.
  { type: "date-datedif", ctor: DateDiffNode, ops: fromMeta(DATE_DIFF_OP_META),
    create: (op) => new DateDiffNode({ op: op as never }), leafOps: ["days", "days360", "yearfrac", "years"] },
  { type: "date-part-year", ctor: DatePartNode },
  { type: "date-value", ctor: DateTimeValueNode },
  { type: "date-workday", ctor: WorkdaysNode },
  { type: "depr-sln", ctor: DepreciationNode },
  { type: "dollar-dollarde", ctor: DollarNode },
  { type: "duration-duration", ctor: DurationNode },
  { type: "fisher-fisher", ctor: FisherNode },
  { type: "ipmt-ipmt", ctor: IpmtPpmtNode },
  { type: "math-ceiling", ctor: MRoundNode },
  { type: "matdet-mdeterm", ctor: MatDetNode },
  { type: "math-abs", ctor: MathFnNode },
  { type: "oddcoupon-oddfprice", ctor: OddCouponNode },
  // ONE Rank & Percentile class hosts all ten order-statistic ops; the .EXC forms
  // have no leaf of their own, so each family leaf declares its pair and the
  // search rows ride the right host ("PERCENTILE: PERCENTILE.EXC"). The card
  // labels are family words, so the search names are declared here (overrideInPlace).
  { type: "stat-percentile", ctor: RankPercentileNode,
    ops: [{ op: "percentile-inc", label: "PERCENTILE.INC" }, { op: "percentile-exc", label: "PERCENTILE.EXC" }],
    leafOps: RANK_PERCENTILE_LEAF_OPS,
    create: (op) => new RankPercentileNode({ op: op as never }) },
  { type: "stat-percentrank", ctor: RankPercentileNode,
    ops: [{ op: "percentrank-inc", label: "PERCENTRANK.INC" }, { op: "percentrank-exc", label: "PERCENTRANK.EXC" }],
    leafOps: RANK_PERCENTILE_LEAF_OPS,
    create: (op) => new RankPercentileNode({ op: op as never }) },
  { type: "pricedisc-pricedisc", ctor: PriceDiscNode },
  { type: "pricemat-pricemat", ctor: PriceMatNode },
  { type: "stat-quartile", ctor: RankPercentileNode,
    ops: [{ op: "quartile-inc", label: "QUARTILE.INC" }, { op: "quartile-exc", label: "QUARTILE.EXC" }],
    leafOps: RANK_PERCENTILE_LEAF_OPS,
    create: (op) => new RankPercentileNode({ op: op as never }) },
  { type: "roman-arabic-roman", ctor: RomanArabicNode },
  { type: "secdesc-disc", ctor: SecurityDiscNode },
  { type: "sp-sumproduct", ctor: SumProductNode },
  { type: "tbill-tbilleq", ctor: TBillNode },
  { type: "z-test", ctor: HypothesisTestNode },
  { type: "reshape-wraprows", ctor: TableReshapeNode },
  { type: "tblsel-chooserows", ctor: TableSelectNode },
  { type: "text-after-before-after", ctor: TextAfterBeforeNode },
  { type: "text-find-find", ctor: TextFindNode },
  { type: "text-left", ctor: TextSliceNode },
  { type: "text-upper", ctor: TextTransformNode },
  { type: "date-today", ctor: TodayNowNode },
  { type: "url-encode", ctor: UrlEncodeNode },
  { type: "date-week-weekday", ctor: WeekInfoNode },
  { type: "weighted-wavg", ctor: WeightedNode },

  { type: "elec-eseries", ctor: ESeriesNode },
  { type: "em-constant", ctor: PhysicsConstantNode },
];

const BY_TYPE = new Map(NODE_OPS.map((d) => [d.type, d]));

/** The declaration for a catalog leaf type, if it hosts a family of ops. */
export function opsFor(type: string): NodeOpsDecl | undefined {
  return BY_TYPE.get(type);
}

/** How this family is exposed (default: collapsed). */
export function exposureOf(decl: NodeOpsDecl): OpExposure {
  return decl.expose ?? "collapsed";
}

/** The search-row label for one op ("Chart: Column"); the host label comes from the
 *  catalog, so a renamed node renames its ops too. */
export function opSearchLabel(hostLabel: string, opLabel: string): string {
  return `${hostLabel}: ${opLabel}`;
}

// The op a family's primary leaf itself creates, DERIVED by constructing that leaf
// rather than declared — a declaration could disagree with the code.
const _primaryOp = new Map<string, string | null>();
function primaryOpOf(host: NodeCatalogEntry): string | null {
  const hit = _primaryOp.get(host.type);
  if (hit !== undefined) return hit;
  let op: string | null = null;
  try {
    const inst = host.create() as { op?: unknown };
    if (typeof inst?.op === "string") op = inst.op;
  } catch { /* an uninstantiable leaf simply has no primary op */ }
  _primaryOp.set(host.type, op);
  return op;
}

/** The ops of this family with no Add-menu leaf of their own — what search has to
 *  carry, and what makes the host show `{ }`. */
export function hiddenOps(decl: NodeOpsDecl, host: NodeCatalogEntry): Array<{ op: string; label: string }> {
  if (!decl.ops) return []; // every op has its own leaf: the menu is not this declaration's business
  const own = new Set(decl.leafOps ?? []);
  if (!decl.leafOps) {
    const primary = primaryOpOf(host);
    if (primary) own.add(primary);
  }
  return decl.ops.filter((o) => !own.has(o.op));
}

/** A search-only row for an Excel function a leaf answers to under another name
 *  ("Table Size: ROWS") — the same "Host: Name" shape as a hidden op's row, so a
 *  user typing the Excel name sees it on the row they get, not just the host. When
 *  the host IS a function name the prefix only repeats itself ("AVERAGE: AVERAGEA",
 *  "LINEST: SLOPE"), so the row is the alias alone; the description still names
 *  the host (author, 2026-08-29). */
export function excelEntry(host: NodeCatalogEntry, name: string): NodeCatalogEntry {
  const hostIsFunction = /^[A-Z][A-Z0-9.]*$/.test(host.label);
  return {
    ...host,
    type: `${host.type}__excel-${name}`,
    label: hostIsFunction ? name : opSearchLabel(host.label, name),
    keywords: undefined,
    hiddenOps: undefined,
    hideOpsMark: undefined,
  };
}

/** The catalog entry for one op of a family — a generated leaf, or a search-only
 *  row when collapsed. */
export function opEntry(
  decl: NodeOpsDecl & { create: (op: string) => unknown },
  host: NodeCatalogEntry,
  op: OpEntryDecl,
): NodeCatalogEntry {
  return {
    ...host,
    type: `${decl.type}__op-${op.op}`,
    label: opSearchLabel(host.label, op.label),
    create: () => decl.create(op.op),
    // NOT the host's keywords: those describe the FAMILY, so inheriting them makes
    // every sibling row match identically and the ops stop discriminating. The op's
    // OWN keywords do ride along — that is where a family puts the per-op Excel
    // spellings that must stay findable without bloating the visible label.
    keywords: op.keywords,
    // NOT the host's ops-mark either — a row that IS one op has nothing folded up.
    hiddenOps: undefined,
    hideOpsMark: undefined,
  };
}

