// Per node class hosting an op selector: what ops it has and how they surface.
// The `{ }` marker is DERIVED, never declared; `kind` does not affect the menu.

import type { NodeCatalogEntry } from "./AddNodeMenu";
import { DIST_SPECS, DistributionNode, type DistKey } from "./nodes/distribution";

import { ChartNode, SparklineNode, SurfaceNode, RecordNode, GaugeNode, ProportionNode } from "./nodes/visual";
import { CHART_OP_META, SPARKLINE_OP_META } from "./nodes/visual";
import {
  FillNode, GroupByNode, SetOpNode, SetRelationNode, SumIfsNode, RunningNode,
  FILL_OP_META, COND_AGG_OP_META,
  SET_OP_META, SET_RELATION_META, PAD_OP_META, PadNode,
  SortNode, SeriesNode,
} from "./nodes/list";
import { HeadNode, HeadersNode, DropBlankRowsNode, ColumnsNode, HEAD_OP_META, COLUMNS_OP_META } from "./nodes/frame";
import { RegexNode, REGEX_OP_META } from "./nodes/text";
import { DATE_DIFF_OP_META, DateTimeValueNode, WorkdaysNode } from "./nodes/date";
import { IFErrorNode } from "./nodes/logic";
import { ByAxisNode, BY_AXIS_OP_META } from "./nodes/tableLambda";
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
// The kind-only families below, via the node barrel — they contribute no ops list,
// only their class (for `instanceof`) and their kind.
import {
  AggregateNode, AntoineNode, ArgMinMaxNode, ArithmeticNode,
  BesselNode, BitwiseNode,
  BondPriceNode, BooleanOpNode, CharCodeNode, 
  CombinatoricsNode, ComplexBinaryNode, ComplexUnaryNode,
  ConfidenceNode, ConstantNode, CouponNode, CovarianceNode,
  CubeRollupNode, CumPmtNode, DateAddNode, DateDiffNode, EpochNode, DateTruncNode, OutliersNode, SmoothNode, SMOOTH_OP_META, type SmoothOp, FindPeaksNode, CorrMatrixNode, KMeansNode, PcaNode, LogisticNode, AmortizationNode, ReturnsNode, RETURNS_OP_META, type ReturnsOp, WindowNode,
  DatePartNode, DepreciationNode, DollarNode, DurationNode,
  ESeriesNode, ElementNode, 
  FisherNode, GroupByFrameNode,
  IpmtPpmtNode, MRoundNode,
  MatDetNode, MatSolveNode, MatEigenNode, SpectrumNode, TextSimilarityNode, FuzzyMatchNode, EtsForecastNode, DecomposeNode, FitDistributionNode, MathFnNode, 
  OddCouponNode,
  PhysicsConstantNode, PipeRoughnessNode, PivotNode,
  PriceDiscNode, PriceMatNode,
  RankPercentileNode, RomanArabicNode, SecurityDiscNode,
  SumProductNode, TBillNode, 
  HypothesisTestNode, TableReshapeNode, TableSelectNode, TakeDropNode, TAKEDROP_OP_META,
  TextAfterBeforeNode, TextFindNode, TextSliceNode, TextTransformNode, PadTextNode, TruncateTextNode,
  TodayNowNode, UrlEncodeNode, HashNode, TemplateNode, WeekInfoNode, 
  WeightedNode,
  ResistorCodeNode,
  AlertNode, ColorBlendNode,
} from "./rete-nodes";


/** How a family's ops surface in the Add menu; per-op leaves are earned
 *  deliberately, so `collapsed` is the default. */
export type OpExposure = "collapsed" | "leaves";

/** Whether an op is its own operation or a parameter of its host (formulaNaming 2(a)). */
export type OpKind = "operation" | "argument";

interface NodeOpsBase {
  /** Catalog type of the leaf representing this family — the one that carries the
   *  `{ }` marker when ops are hidden. */
  type: string;
  kind: OpKind;
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
 *  is the arg-tagged `form` field. Typing "norm.inv" or "weibull" still lands on
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
  // ── Operation-kind: a chart TYPE is a thing you search for by name ──
  { type: "chart", ctor: ChartNode, kind: "operation", ops: fromMeta(CHART_OP_META),
    create: (op) => new ChartNode({ op: op as never }) },
  { type: "sparkline", ctor: SparklineNode, kind: "operation", ops: fromMeta(SPARKLINE_OP_META),
    create: (op) => new SparklineNode({ op: op as never }) },
  // Gauge draws a value on a scale two ways (Dial / Bar); the Bar style is the former
  // Bullet graph. The Dial/Bar pick is a SegToggle bound to `op`, but the two aren't
  // separate Add-menu names (both are just "Gauge") — "bullet"/"dial"/"bar" ride the
  // leaf's keywords for search, so no op rows here (and "bar" would collide with Chart's).
  { type: "gauge", ctor: GaugeNode, kind: "operation" },
  // Proportion draws parts of a whole two ways (Treemap / Waffle) — a SegToggle bound to
  // `op`, both named just "Proportion". The layout names ride the leaf keywords, so no op
  // rows (like Gauge).
  { type: "proportion", ctor: ProportionNode, kind: "operation" },
  // The record VIEW is a presentation parameter of the one figure, not three
  // things you'd call by name (author call) — neutral picker, no op rows;
  // "gallery"/"kanban" ride the host leaf's keywords.
  { type: "record", ctor: RecordNode, kind: "argument" },
  // The 3-D surface and its flat contour twin: two views of one grid, one leaf each.
  { type: "surface", ctor: SurfaceNode, kind: "operation" },
  // A distribution is likewise a thing you search for by name; its ops' formula
  // names are the real Excel spellings (fx in DIST_OPS).
  { type: "distribution", ctor: DistributionNode, kind: "operation", ops: DIST_OPS,
    create: (op) => new DistributionNode({ op: op as never }) },

  // Promote/demote are argument VALUES, not functions — no formula name, so no op rows.
  // The host leaf's `keywords` already carry "promote demote first row", which is where
  // an argument's searched words belong (aggregatorsAreArguments's reopen clause: aliases on the host).
  { type: "headers", ctor: HeadersNode, kind: "argument" },
  // Aggregators are arguments of Group By, not searchable ops (aggregatorsAreArguments).
  { type: "list-groupby", ctor: GroupByNode, kind: "argument" },
  // Direction toggles are parameters of ONE operation.
  { type: "list-sort", ctor: SortNode, kind: "argument" },
  // TAKE/DROP are one rank-preserving class (list, matrix or scalar); both ops have
  // their own bare leaf, so neither becomes a "TAKE: Drop" colon row. The sign of the
  // count is the direction, an argument.
  { type: "takedrop", ctor: TakeDropNode, kind: "operation", ops: fromMeta(TAKEDROP_OP_META),
    create: (op) => new TakeDropNode({ op: op as never }), leafOps: ["take", "drop"] },
  // Which rows count as blank is a parameter of Drop Blank Rows.
  { type: "drop-blank-rows", ctor: DropBlankRowsNode, kind: "argument" },
  // The trigger condition and the blend formula are parameters of their one node.
  { type: "alert", ctor: AlertNode, kind: "argument" },
  { type: "color-blend", ctor: ColorBlendNode, kind: "argument" },

  // ── Operation-kind: each op stands alone as a name ──
  // Three parameterizations of one arithmetic progression, each with its own leaf.
  { type: "list-range", ctor: SeriesNode, kind: "operation" },
  { type: "list-fill", ctor: FillNode, kind: "operation", ops: fromMeta(FILL_OP_META),
    create: (op) => new FillNode({ op: op as never }) },
  { type: "head", ctor: HeadNode, kind: "operation", ops: fromMeta(HEAD_OP_META),
    create: (op) => new HeadNode({ op: op as never }) },
  // Both ops have their own bare Add-menu leaf ("Keep Columns" / "Drop Columns"), so
  // neither becomes a "Keep Columns: Drop" colon row; the decl still carries kind +
  // op fx names for the accent and uniqueNameMap.
  { type: "by-axis", ctor: ByAxisNode, kind: "operation", ops: fromMeta(BY_AXIS_OP_META),
    create: (op) => new ByAxisNode({ op: op as never }), leafOps: ["row", "col"] },
  { type: "npv", ctor: NpvNode, kind: "operation", ops: fromMeta(NPV_OP_META),
    create: (op) => new NpvNode({ op: op as never }), leafOps: ["periods", "dates"] },
  { type: "irr", ctor: IrrNode, kind: "operation", ops: fromMeta(IRR_OP_META),
    create: (op) => new IrrNode({ op: op as never }), leafOps: ["periods", "dates"] },
  { type: "keep-columns", ctor: ColumnsNode, kind: "operation", ops: fromMeta(COLUMNS_OP_META),
    create: (op) => new ColumnsNode({ op: op as never }), leafOps: ["keep", "drop"] },
  { type: "list-pad", ctor: PadNode, kind: "operation", ops: fromMeta(PAD_OP_META),
    create: (op) => new PadNode({ op: op as never }) },
  { type: "list-set", ctor: SetOpNode, kind: "operation", ops: fromMeta(SET_OP_META),
    create: (op) => new SetOpNode({ op: op as never }) },
  { type: "list-set-relation", ctor: SetRelationNode, kind: "operation", ops: fromMeta(SET_RELATION_META),
    create: (op) => new SetRelationNode({ op: op as never }) },
  { type: "iferror", ctor: IFErrorNode, kind: "operation",
    ops: [{ op: "iferror", label: "IFERROR" }, { op: "ifna", label: "IFNA" }],
    create: (op) => new IFErrorNode({ op: op as never }), leafOps: ["iferror", "ifna"] },
  { type: "regex", ctor: RegexNode, kind: "operation", ops: fromMeta(REGEX_OP_META),
    create: (op) => new RegexNode({ op: op as never }) },
  // Text Filter's ops are its CONDITION; as operations they would also claim
  // formula names they can't own ("Contains" despaces onto CONTAINS).
  // Contains / starts with / ends with are the predicate ARGUMENT, not four functions.
  // (`contains` despaced onto the real CONTAINS function by coincidence, which is
  // exactly the collision aggregatorsAreArguments warns an argument's op rows cause.) Searched words moved
  // to the host leaf's keywords.
  { type: "text-pad", ctor: PadTextNode, kind: "argument" },
  { type: "text-truncate", ctor: TruncateTextNode, kind: "argument" },
  { type: "sumifs", ctor: SumIfsNode, kind: "operation", ops: fromMeta(COND_AGG_OP_META),
    create: (op) => new SumIfsNode({ op: op as never }) },
  { type: "regression-steyx", ctor: RegressionNode, kind: "operation", ops: fromMeta(REGRESSION_OP_META),
    create: (op) => new RegressionNode({ op: op as never }) },
  { type: "correl-correl", ctor: CorrelNode, kind: "operation", ops: fromMeta(CORREL_OP_META),
    create: (op) => new CorrelNode({ op: op as never }) },
  { type: "forecast", ctor: ForecastNode, kind: "operation", ops: fromMeta(FORECAST_OP_META),
    create: (op) => new ForecastNode({ op: op as never }) },
  { type: "linest", ctor: LinestNode, kind: "operation", ops: fromMeta(FIT_OP_META),
    create: (op) => new LinestNode({ op: op as never }) },
  // Label already names both ops.
  { type: "iseven-isodd", ctor: IsEvenOddNode, kind: "operation", ops: fromMeta(PARITY_OP_META),
    create: (op) => new IsEvenOddNode({ op: op as never }), leafOps: ["iseven", "isodd"] },

  // The aggregator is an ARGUMENT of the windowed scan, like Group By's and Cube
  // Rollup's: neutral picker, no op rows (searched words ride the host leaf's
  // keywords), and on the formula surface it is a PARAMETER of the family's one
  // function — RUNNING(op, list, [window]); the per-op RUNNING* names are dead (aggregatorsAreArguments).
  { type: "list-running", ctor: RunningNode, kind: "argument" },
  // `fromMeta` takes the NAME, dropping the dropdown's bare operator glyph.
  { type: "comparison", ctor: ComparisonNode, kind: "operation", ops: fromMeta(COMPARISON_OP_META),
    create: (op) => new ComparisonNode({ op: op as never }) },
  { type: "is-test", ctor: IsTestNode, kind: "operation", ops: fromMeta(IS_TEST_OP_META),
    create: (op) => new IsTestNode({ op: op as never }) },
  // Label already names both ops, so the marker would only echo it.
  { type: "gcd-lcm", ctor: GcdNode, kind: "operation", ops: fromMeta(GCD_OP_META),
    create: (op) => new GcdNode({ op: op as never }), leafOps: ["gcd", "lcm"] },

  // ── Partially exposed: some ops already have leaves, the rest ride in search ──
  { type: "twomath-log", ctor: TwoInputMathNode, kind: "operation", ops: fromMeta(TWO_INPUT_MATH_OP_META),
    leafOps: ["log", "atan2", "delta", "gestep", "hypot"],
    create: (op) => new TwoInputMathNode({ op: op as never }) },
  { type: "roundn-round", ctor: RoundNNode, kind: "operation", ops: fromMeta(ROUNDN_OP_META),
    leafOps: ["round", "roundup", "rounddown"],
    create: (op) => new RoundNNode({ op: op as never }) },

  // ── Kind-only declarations: already listed op-by-op, so nothing to hide or add
  // to search — these only say what the dropdown selects between (which tints it).
  { type: "reduce-sum", ctor: AggregateNode, kind: "operation" },
  { type: "arg-argmax", ctor: ArgMinMaxNode, kind: "operation" },
  { type: "arith-add", ctor: ArithmeticNode, kind: "operation" },
  { type: "bessel-besselj", ctor: BesselNode, kind: "operation" },
  { type: "bitwise-bitand", ctor: BitwiseNode, kind: "operation" },
  { type: "bondprice-price", ctor: BondPriceNode, kind: "operation" },
  { type: "bool-and", ctor: BooleanOpNode, kind: "operation" },
  { type: "char-code-char", ctor: CharCodeNode, kind: "operation" },
  { type: "comb-fact", ctor: CombinatoricsNode, kind: "operation" },
  { type: "cx-binary-sum", ctor: ComplexBinaryNode, kind: "operation" },
  { type: "cx-unary-conj", ctor: ComplexUnaryNode, kind: "operation" },
  { type: "confidence-norm", ctor: ConfidenceNode, kind: "operation" },
  { type: "constant", ctor: ConstantNode, kind: "operation" },
  { type: "coupon-coupdaybs", ctor: CouponNode, kind: "operation" },
  { type: "cov-pop", ctor: CovarianceNode, kind: "operation" },
  { type: "cumpmt-cumipmt", ctor: CumPmtNode, kind: "operation" },
  { type: "date-add-edate", ctor: DateAddNode, kind: "operation" },
  { type: "date-epoch-from", ctor: EpochNode, kind: "operation" },
  { type: "corr-matrix", ctor: CorrMatrixNode, kind: "argument" },
  { type: "kmeans", ctor: KMeansNode, kind: "argument" },
  { type: "pca", ctor: PcaNode, kind: "argument" },
  { type: "logistic", ctor: LogisticNode, kind: "argument" },
  { type: "window", ctor: WindowNode, kind: "argument" },
  { type: "amortization", ctor: AmortizationNode, kind: "argument" },
  // Each op is the operation (Sharpe IS the card); fx rides in RETURNS_OP_META.
  { type: "returns", ctor: ReturnsNode, kind: "operation", ops: fromMeta(RETURNS_OP_META),
    create: (op) => new ReturnsNode({ op: op as ReturnsOp }) },
  { type: "date-trunc", ctor: DateTruncNode, kind: "argument" },
  { type: "list-outliers", ctor: OutliersNode, kind: "argument" },
  { type: "list-smooth", ctor: SmoothNode, kind: "operation", ops: fromMeta(SMOOTH_OP_META),
    create: (op) => new SmoothNode({ op: op as SmoothOp }) },
  { type: "list-peaks", ctor: FindPeaksNode, kind: "argument" },
  // The day-count ops have Excel-name leaves; the DATEDIF units are hidden ops on
  // the DATEDIF leaf, which is why that leaf hosts the declaration.
  { type: "date-datedif", ctor: DateDiffNode, kind: "operation", ops: fromMeta(DATE_DIFF_OP_META),
    create: (op) => new DateDiffNode({ op: op as never }), leafOps: ["days", "days360", "yearfrac", "years"] },
  { type: "date-part-year", ctor: DatePartNode, kind: "operation" },
  { type: "date-value", ctor: DateTimeValueNode, kind: "operation" },
  { type: "date-workday", ctor: WorkdaysNode, kind: "operation" },
  { type: "depr-sln", ctor: DepreciationNode, kind: "operation" },
  { type: "dollar-dollarde", ctor: DollarNode, kind: "operation" },
  { type: "duration-duration", ctor: DurationNode, kind: "operation" },
  { type: "fisher-fisher", ctor: FisherNode, kind: "operation" },
  { type: "ipmt-ipmt", ctor: IpmtPpmtNode, kind: "operation" },
  { type: "math-ceiling", ctor: MRoundNode, kind: "operation" },
  { type: "matdet-mdeterm", ctor: MatDetNode, kind: "operation" },
  { type: "mat-solve", ctor: MatSolveNode, kind: "argument" },
  { type: "ets-forecast", ctor: EtsForecastNode, kind: "argument" },
  { type: "decompose", ctor: DecomposeNode, kind: "argument" },
  { type: "fit-distribution", ctor: FitDistributionNode, kind: "argument" },
  { type: "text-similarity", ctor: TextSimilarityNode, kind: "argument" },
  { type: "fuzzy-match", ctor: FuzzyMatchNode, kind: "argument" },
  { type: "mat-eigen", ctor: MatEigenNode, kind: "argument" },
  { type: "list-spectrum", ctor: SpectrumNode, kind: "argument" },
  { type: "math-abs", ctor: MathFnNode, kind: "operation" },
  { type: "oddcoupon-oddfprice", ctor: OddCouponNode, kind: "operation" },
  // ONE Rank & Percentile class hosts all ten order-statistic ops; the .EXC forms
  // have no leaf of their own, so each family leaf declares its pair and the
  // search rows ride the right host ("PERCENTILE: PERCENTILE.EXC"). The card
  // labels are family words, so the search names are declared here (overrideInPlace).
  { type: "stat-percentile", ctor: RankPercentileNode, kind: "operation",
    ops: [{ op: "percentile-inc", label: "PERCENTILE.INC" }, { op: "percentile-exc", label: "PERCENTILE.EXC" }],
    leafOps: RANK_PERCENTILE_LEAF_OPS,
    create: (op) => new RankPercentileNode({ op: op as never }) },
  { type: "stat-percentrank", ctor: RankPercentileNode, kind: "operation",
    ops: [{ op: "percentrank-inc", label: "PERCENTRANK.INC" }, { op: "percentrank-exc", label: "PERCENTRANK.EXC" }],
    leafOps: RANK_PERCENTILE_LEAF_OPS,
    create: (op) => new RankPercentileNode({ op: op as never }) },
  { type: "pricedisc-pricedisc", ctor: PriceDiscNode, kind: "operation" },
  { type: "pricemat-pricemat", ctor: PriceMatNode, kind: "operation" },
  { type: "stat-quartile", ctor: RankPercentileNode, kind: "operation",
    ops: [{ op: "quartile-inc", label: "QUARTILE.INC" }, { op: "quartile-exc", label: "QUARTILE.EXC" }],
    leafOps: RANK_PERCENTILE_LEAF_OPS,
    create: (op) => new RankPercentileNode({ op: op as never }) },
  { type: "roman-arabic-roman", ctor: RomanArabicNode, kind: "operation" },
  { type: "secdesc-disc", ctor: SecurityDiscNode, kind: "operation" },
  { type: "sp-sumproduct", ctor: SumProductNode, kind: "operation" },
  { type: "tbill-tbilleq", ctor: TBillNode, kind: "operation" },
  { type: "z-test", ctor: HypothesisTestNode, kind: "operation" },
  { type: "reshape-wraprows", ctor: TableReshapeNode, kind: "operation" },
  { type: "tblsel-chooserows", ctor: TableSelectNode, kind: "operation" },
  { type: "text-after-before-after", ctor: TextAfterBeforeNode, kind: "operation" },
  { type: "text-find-find", ctor: TextFindNode, kind: "operation" },
  { type: "text-left", ctor: TextSliceNode, kind: "operation" },
  { type: "text-upper", ctor: TextTransformNode, kind: "operation" },
  { type: "date-today", ctor: TodayNowNode, kind: "operation" },
  { type: "url-encode", ctor: UrlEncodeNode, kind: "operation" },
  { type: "hash", ctor: HashNode, kind: "argument" },
  { type: "template", ctor: TemplateNode, kind: "argument" },
  { type: "date-week-weekday", ctor: WeekInfoNode, kind: "operation" },
  { type: "weighted-wavg", ctor: WeightedNode, kind: "operation" },

  // ARGUMENT — the aggregator a host verb runs, plus the data-driven pickers, each
  // a VALUE the graph could supply from a column.
  { type: "th-antoine", ctor: AntoineNode, kind: "argument" },
  { type: "cube-rollup", ctor: CubeRollupNode, kind: "argument" },
  { type: "elec-eseries", ctor: ESeriesNode, kind: "operation" },
  { type: "elec-resistor-code", ctor: ResistorCodeNode, kind: "argument" },
  { type: "ch-element", ctor: ElementNode, kind: "argument" },
  { type: "group-by-frame", ctor: GroupByFrameNode, kind: "argument" },
  { type: "em-constant", ctor: PhysicsConstantNode, kind: "operation" },
  { type: "fl-roughness", ctor: PipeRoughnessNode, kind: "argument" },
  { type: "pivot", ctor: PivotNode, kind: "argument" },
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
  if (!decl.ops) return []; // kind-only: the menu is not this declaration's business
  const own = new Set(decl.leafOps ?? []);
  if (!decl.leafOps) {
    const primary = primaryOpOf(host);
    if (primary) own.add(primary);
  }
  return decl.ops.filter((o) => !own.has(o.op));
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

/** The op kind of a live node, undefined for an undeclared family — which RENDERS
 *  identically to "argument", so the coverage test is the only guard. */
export function opKindForNode(node: object | undefined): OpKind | undefined {
  if (!node) return undefined;
  for (const d of NODE_OPS) if (node instanceof d.ctor) return d.kind;
  return undefined;
}
