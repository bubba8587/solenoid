// ─── Multi-op node declarations ───────────────────────────────────────────────
// Several node classes host a FAMILY of operations behind an op selector on the
// card. The dropdown is a navigation convenience for closely-related work — each op
// is still its own thing — so the ops are normally ALSO listed individually in the
// Add menu, and nobody has to know which card hosts which op.
//
// Not all of them are. This module is the one place that declares, per class, what
// ops it has and how they should surface:
//
//   expose: "collapsed" (the DEFAULT) — one Add-menu leaf. It carries the `{ }`
//     marker, and every op with no leaf of its own is still reachable from SEARCH
//     as "Chart: Column". Nothing is undiscoverable just because it's folded up.
//   expose: "leaves" — one leaf per op, generated for any op that doesn't already
//     have a hand-written one. Flipping this single word is the whole change.
//
// The `{ }` marker is DERIVED, never declared: a leaf shows it iff the node has ops
// with no leaf of their own. So it cannot drift out of agreement with the menu the
// way a hand-maintained flag would — which is the same discipline the formula-parity
// ratchet enforces on the other surface.
//
// `kind` is a separate axis and does NOT affect the menu:
//   "operation" — the op stands alone as a name (SETUNION, ISODD, REGEXREPLACE), so
//     it earns its own formula name under D19 decision 2(a).
//   "argument"  — the op is meaningless without its host ("avg" is a parameter of
//     GROUPBY, not a function), so the family takes ONE formula name and the op
//     rides in as an argument.
//
// CLASSIFYING ONE — a JUDGEMENT, informed by several partial signals. None of these
// is decisive on its own, and they do disagree; when they do, weigh them rather than
// letting whichever was written last win.
//
//   • Would the user PICK this, or could it arrive computed? Something a person
//     always picks by hand is part of what the node IS; something that can arrive
//     from a lookup or a column is a parameter. (Nobody computes whether they want
//     a probability density or a cumulative distribution — so those are operations
//     even though Excel models the choice as a `cumulative` flag.)
//   • Would the user SEARCH the Add menu for it by name? "Column chart", "Sankey",
//     "speed of light" — yes. "avg", "4-band" — no.
//   • Is it meaningless without its host? "avg" says nothing without GROUP BY.
//   • Is it already an Excel function in its own right? Corroborating, not deciding:
//     Excel's own spelling reflects its grid, not this app's dataflow.
//
// The signals mostly agree. Where they don't, the interesting cases are the ones
// worth reading twice: an ELEMENT symbol is picked by hand AND searchable, yet it
// is data that can plainly come from a column, and a row per element would bury the
// menu — so it stays an argument. A RESISTOR band count is picked by hand and never
// computed, yet nobody thinks of "4-band decode" as a different operation from
// "5-band" — so it stays an argument too.

import type { NodeCatalogEntry } from "./AddNodeMenu";

import { ChartNode, SparklineNode } from "./nodes/visual";
import { CHART_OP_META, SPARKLINE_OP_META } from "./nodes/visual";
import {
  FillNode, GroupByNode, SetOpNode, SetRelationNode, SumIfsNode, CumulativeNode,
  FILL_OP_META, GROUP_BY_OP_META, SET_OP_META, SET_RELATION_META, COND_AGG_OP_META,
} from "./nodes/list";
import { HeadNode, PromoteHeadersNode, HEAD_OP_META, HEADER_OP_META } from "./nodes/frame";
import { RegexNode, TextFilterNode, REGEX_OP_META, TEXT_FILTER_OP_META } from "./nodes/text";
import { IsEvenOddNode, ComparisonNode, IsTestNode, PARITY_OP_META } from "./nodes/logic";
import { RegressionNode, CorrelNode, REGRESSION_OP_META, CORREL_OP_META } from "./nodes/stats";
import { TwoInputMathNode, GcdNode, RoundNNode, TWO_INPUT_MATH_OP_META } from "./nodes/scalar";
// The kind-only families below, via the node barrel — they contribute no ops list,
// only their class (for `instanceof`) and their kind.
import {
  AggregateNode, AntoineNode, ArgMinMaxNode, ArithmeticNode,
  BesselNode, BetaDistNode, BinomDistNode, BitwiseNode,
  BondPriceNode, BooleanOpNode, CharCodeNode, ChisqDistNode,
  ChisqInvNode, CombinatoricsNode, ComplexBinaryNode, ComplexUnaryNode,
  ConfidenceNode, ConstantNode, CouponNode, CovarianceNode,
  CubeRollupNode, CumPmtNode, DateAddNode, DateDiffNode,
  DatePartNode, DepreciationNode, DollarNode, DurationNode,
  ESeriesNode, ElementNode, ExponDistNode, FDistNode,
  FInvNode, FisherNode, GammaDistNode, GroupByFrameNode,
  HypgeomDistNode, IpmtPpmtNode, LognormDistNode, MRoundNode,
  MatDetNode, MathFnNode, NegbinomDistNode, NormDistNode,
  NormSDistNode, NthValueNode, OddCouponNode, PercentileNode,
  PercentrankNode, PhysicsConstantNode, PipeRoughnessNode, PivotNode,
  PoissonDistNode, PriceDiscNode, PriceMatNode, QuartileNode,
  RankNode, RollingNode, RomanArabicNode, SecurityDiscNode,
  SumProductNode, TBillNode, TDistNode, TInvNode,
  TTestNode, TableReshapeNode, TableSelectNode, TableTakeDropNode,
  TextAfterBeforeNode, TextFindNode, TextSliceNode, TextTransformNode,
  TodayNowNode, UrlEncodeNode, WeekInfoNode, WeibullDistNode,
  WeightedNode,
  ResistorCodeNode,
} from "./rete-nodes";


/** How a family's ops surface in the Add menu. `collapsed` is the default: a family
 *  earns per-op leaves deliberately, rather than every dropdown silently spraying
 *  entries into the tree. */
export type OpExposure = "collapsed" | "leaves";

/** Whether an op is its own operation or a parameter of its host (D19 2(a)). */
export type OpKind = "operation" | "argument";

interface NodeOpsBase {
  /** Catalog type of the leaf that represents this family in navigation. When ops
   *  are hidden, this is the leaf that carries the `{ }` marker. */
  type: string;
  kind: OpKind;
  /** Default `collapsed` — see the module note. */
  expose?: OpExposure;
  /** The node class. Used to resolve a live node back to its declaration —
   *  `instanceof`, not a constructor-NAME match, which a minified build would
   *  quietly break. */
  ctor: new (...a: never[]) => object;
  /** Suppress the `{ }` marker while keeping every op searchable. The subjective
   *  per-node call: a few labels already enumerate their ops ("GCD / LCM"), so the
   *  mark would only repeat the name back. Default is derived — marked iff ops are
   *  hidden — so silence here is never the reason a family looks complete. */
  mark?: boolean;
  /** Ops that ALREADY have a hand-written leaf of their own, when that is more than
   *  just this entry's own op (the partially-exposed families). Machine-checked
   *  against the real catalog by `nodeOps.test.ts`, so it cannot drift. */
  leafOps?: string[];
}

/** A declaration either lists its ops AND can build them, or lists neither.
 *
 *  The pairing is enforced here rather than trusted: an ops list with no way to
 *  construct one would produce a search row that cannot be added to the graph.
 *  Omitting BOTH is the kind-only form — the declaration says what the dropdown
 *  selects between and leaves the menu completely alone. That is right for a
 *  family already listed op-by-op (nothing is hidden, so there is nothing to
 *  list), and for one whose variants are DATA rather than operations, where a row
 *  per value would bury the menu it was meant to help. */
export type NodeOpsDecl = NodeOpsBase & (
  | { ops: Array<{ op: string; label: string }>; create: (op: string) => unknown }
  | { ops?: undefined; create?: undefined }
);

/** Read an OP_META table into the declaration's op list. The tables differ in their
 *  extra fields (some carry `description`, some `tex`/`plain`) but all carry `label`,
 *  which is the per-op identity the Add menu and search show. */
function fromMeta(meta: Record<string, { label: string }>): Array<{ op: string; label: string }> {
  return Object.entries(meta).map(([op, m]) => ({ op, label: m.label }));
}

/** Ops declared inline, for the families whose labels live in their React component's
 *  OPS array rather than an OP_META table. Transcribed to match those labels exactly;
 *  the glyph prefixes are dropped because a search row reads "Comparison: Greater or
 *  equal", where a bare "≥" would carry nothing. Unifying these into real OP_META
 *  tables the components consume is a follow-up, not a behavior change. */
const COMPARISON_OPS = [
  { op: "gt", label: "Greater than" },
  { op: "gte", label: "Greater or equal" },
  { op: "lt", label: "Less than" },
  { op: "lte", label: "Less or equal" },
  { op: "eq", label: "Equal" },
  { op: "neq", label: "Not equal" },
];
const IS_TEST_OPS = [
  { op: "isnumber", label: "ISNUMBER" },
  { op: "isblank", label: "ISBLANK" },
  { op: "isnull", label: "ISNULL" },
  { op: "iserror", label: "ISERROR" },
  { op: "isna", label: "ISNA" },
  { op: "islogical", label: "ISLOGICAL" },
  { op: "istext", label: "ISTEXT" },
  { op: "isnontext", label: "ISNONTEXT" },
];
const CUMULATIVE_OPS = [
  { op: "cumsum", label: "Running SUM" },
  { op: "cumprod", label: "Running PRODUCT" },
  { op: "cummax", label: "Running MAX" },
  { op: "cummin", label: "Running MIN" },
];
const GCD_OPS = [{ op: "gcd", label: "GCD" }, { op: "lcm", label: "LCM" }];
const ROUNDN_OPS = [
  { op: "round", label: "ROUND" },
  { op: "roundup", label: "ROUNDUP" },
  { op: "rounddown", label: "ROUNDDOWN" },
];

export const NODE_OPS: NodeOpsDecl[] = [
  // ── Operation-kind (continued): a chart TYPE is a thing you search for ──
  // "Column chart" and "Sankey" are distinct things a user looks up by name, which
  // is the test — not whether the value happens to be stored as a mode.
  { type: "chart", ctor: ChartNode, kind: "operation", ops: fromMeta(CHART_OP_META),
    create: (op) => new ChartNode({ op: op as never }) },
  { type: "sparkline", ctor: SparklineNode, kind: "operation", ops: fromMeta(SPARKLINE_OP_META),
    create: (op) => new SparklineNode({ op: op as never }) },

  // ── Argument-kind: the op is a parameter, not a thing you would search for ──
  // "Fill blanks with the mean" — `mean` alone names nothing.
  { type: "list-fill", ctor: FillNode, kind: "operation", ops: fromMeta(FILL_OP_META),
    create: (op) => new FillNode({ op: op as never }) },
  // The aggregator is an argument of GROUP BY; `avg` on its own is meaningless here.
  { type: "list-groupby", ctor: GroupByNode, kind: "argument", ops: fromMeta(GROUP_BY_OP_META),
    create: (op) => new GroupByNode({ op: op as never }) },
  { type: "head", ctor: HeadNode, kind: "operation", ops: fromMeta(HEAD_OP_META),
    create: (op) => new HeadNode({ op: op as never }) },

  // ── Operation-kind: each op stands alone as a name ──
  { type: "list-set", ctor: SetOpNode, kind: "operation", ops: fromMeta(SET_OP_META),
    create: (op) => new SetOpNode({ op: op as never }) },
  { type: "list-set-relation", ctor: SetRelationNode, kind: "operation", ops: fromMeta(SET_RELATION_META),
    create: (op) => new SetRelationNode({ op: op as never }) },
  { type: "regex", ctor: RegexNode, kind: "operation", ops: fromMeta(REGEX_OP_META),
    create: (op) => new RegexNode({ op: op as never }) },
  { type: "text-filter", ctor: TextFilterNode, kind: "operation", ops: fromMeta(TEXT_FILTER_OP_META),
    create: (op) => new TextFilterNode({ op: op as never }) },
  { type: "sumifs", ctor: SumIfsNode, kind: "operation", ops: fromMeta(COND_AGG_OP_META),
    create: (op) => new SumIfsNode({ op: op as never }) },
  { type: "regression-steyx", ctor: RegressionNode, kind: "operation", ops: fromMeta(REGRESSION_OP_META),
    create: (op) => new RegressionNode({ op: op as never }) },
  { type: "correl-correl", ctor: CorrelNode, kind: "operation", ops: fromMeta(CORREL_OP_META),
    create: (op) => new CorrelNode({ op: op as never }) },
  // Label already names both ops.
  { type: "iseven-isodd", ctor: IsEvenOddNode, kind: "operation", ops: fromMeta(PARITY_OP_META), mark: false,
    create: (op) => new IsEvenOddNode({ op: op as never }) },
  { type: "promote-headers", ctor: PromoteHeadersNode, kind: "operation", ops: fromMeta(HEADER_OP_META),
    create: (op) => new PromoteHeadersNode({ op: op as never }) },
  { type: "list-cumulative", ctor: CumulativeNode, kind: "operation", ops: CUMULATIVE_OPS,
    create: (op) => new CumulativeNode({ op: op as never }) },
  { type: "comparison", ctor: ComparisonNode, kind: "operation", ops: COMPARISON_OPS,
    create: (op) => new ComparisonNode({ op: op as never }) },
  { type: "is-test", ctor: IsTestNode, kind: "operation", ops: IS_TEST_OPS,
    create: (op) => new IsTestNode({ op: op as never }) },
  // Label already names both ops, so the marker would only echo it.
  { type: "gcd-lcm", ctor: GcdNode, kind: "operation", ops: GCD_OPS, mark: false,
    create: (op) => new GcdNode({ op: op as never }) },

  // ── Partially exposed: some ops already have leaves, the rest ride in search ──
  { type: "twomath-log", ctor: TwoInputMathNode, kind: "operation", ops: fromMeta(TWO_INPUT_MATH_OP_META),
    leafOps: ["log", "atan2", "delta", "gestep"],
    create: (op) => new TwoInputMathNode({ op: op as never }) },
  { type: "roundn-round", ctor: RoundNNode, kind: "operation", ops: ROUNDN_OPS,
    leafOps: ["round", "roundup"],
    create: (op) => new RoundNNode({ op: op as never }) },

  // ── Kind-only declarations ───────────────────────────────────────────────────
  // These families are ALREADY listed op-by-op in the Add menu, so there is nothing
  // to hide, mark or add to search — the declaration exists purely to say what the
  // dropdown selects between, which is what tints its edge (and, later, what decides
  // whether Tier 3 gives each op its own formula name).
  //
  // OPERATION: the variant is a distinct thing you would search the catalog for —
  // SUM, ARGMIN, LEFT, EOMONTH, PRICE, ROMAN. Nearly all of them are Excel function
  // names in their own right, which is the same test from the other direction.
  { type: "reduce-sum", ctor: AggregateNode, kind: "operation" },
  { type: "arg-argmax", ctor: ArgMinMaxNode, kind: "operation" },
  { type: "arith-add", ctor: ArithmeticNode, kind: "operation" },
  { type: "bessel-besselj", ctor: BesselNode, kind: "operation" },
  { type: "bitwise-bitand", ctor: BitwiseNode, kind: "operation" },
  { type: "bondprice-price", ctor: BondPriceNode, kind: "operation" },
  { type: "bool-and", ctor: BooleanOpNode, kind: "operation" },
  { type: "char-code-char", ctor: CharCodeNode, kind: "operation" },
  { type: "chisqdist", ctor: ChisqDistNode, kind: "operation" },
  { type: "chisqinv", ctor: ChisqInvNode, kind: "operation" },
  { type: "comb-fact", ctor: CombinatoricsNode, kind: "operation" },
  { type: "cx-binary-sum", ctor: ComplexBinaryNode, kind: "operation" },
  { type: "cx-unary-conj", ctor: ComplexUnaryNode, kind: "operation" },
  { type: "confidence-norm", ctor: ConfidenceNode, kind: "operation" },
  { type: "constant", ctor: ConstantNode, kind: "operation" },
  { type: "coupon-coupdaybs", ctor: CouponNode, kind: "operation" },
  { type: "cov-pop", ctor: CovarianceNode, kind: "operation" },
  { type: "cumpmt-cumipmt", ctor: CumPmtNode, kind: "operation" },
  { type: "date-add-edate", ctor: DateAddNode, kind: "operation" },
  { type: "date-diff-days", ctor: DateDiffNode, kind: "operation" },
  { type: "date-part-year", ctor: DatePartNode, kind: "operation" },
  { type: "depr-sln", ctor: DepreciationNode, kind: "operation" },
  { type: "dollar-dollarde", ctor: DollarNode, kind: "operation" },
  { type: "duration-duration", ctor: DurationNode, kind: "operation" },
  { type: "finv", ctor: FInvNode, kind: "operation" },
  { type: "fisher-fisher", ctor: FisherNode, kind: "operation" },
  { type: "ipmt-ipmt", ctor: IpmtPpmtNode, kind: "operation" },
  { type: "math-ceiling", ctor: MRoundNode, kind: "operation" },
  { type: "matdet-mdeterm", ctor: MatDetNode, kind: "operation" },
  { type: "math-abs", ctor: MathFnNode, kind: "operation" },
  { type: "nth-large", ctor: NthValueNode, kind: "operation" },
  { type: "oddcoupon-oddfprice", ctor: OddCouponNode, kind: "operation" },
  { type: "stat-percentile", ctor: PercentileNode, kind: "operation" },
  { type: "stat-percentrank", ctor: PercentrankNode, kind: "operation" },
  { type: "pricedisc-pricedisc", ctor: PriceDiscNode, kind: "operation" },
  { type: "pricemat-pricemat", ctor: PriceMatNode, kind: "operation" },
  { type: "stat-quartile", ctor: QuartileNode, kind: "operation" },
  { type: "rank-eq", ctor: RankNode, kind: "operation" },
  { type: "rolling-sum", ctor: RollingNode, kind: "operation" },
  { type: "roman-arabic-roman", ctor: RomanArabicNode, kind: "operation" },
  { type: "secdesc-disc", ctor: SecurityDiscNode, kind: "operation" },
  { type: "sp-sumproduct", ctor: SumProductNode, kind: "operation" },
  { type: "tbill-tbilleq", ctor: TBillNode, kind: "operation" },
  { type: "tinv", ctor: TInvNode, kind: "operation" },
  { type: "t-test-paired", ctor: TTestNode, kind: "operation" },
  { type: "reshape-wraprows", ctor: TableReshapeNode, kind: "operation" },
  { type: "tblsel-chooserows", ctor: TableSelectNode, kind: "operation" },
  { type: "tbltd-take", ctor: TableTakeDropNode, kind: "operation" },
  { type: "text-after-before-after", ctor: TextAfterBeforeNode, kind: "operation" },
  { type: "text-find-find", ctor: TextFindNode, kind: "operation" },
  { type: "text-left", ctor: TextSliceNode, kind: "operation" },
  { type: "text-upper", ctor: TextTransformNode, kind: "operation" },
  { type: "date-today", ctor: TodayNowNode, kind: "operation" },
  { type: "url-encode", ctor: UrlEncodeNode, kind: "operation" },
  { type: "date-week-weekday", ctor: WeekInfoNode, kind: "operation" },
  { type: "weighted-wavg", ctor: WeightedNode, kind: "operation" },

  // ARGUMENT — what survives the weighing above. Two groups:
  //   • the aggregator a host verb runs (Pivot / CubeRollup / GroupByFrame): "avg"
  //     means nothing without them, and can plausibly arrive computed;
  //   • the data-driven pickers (element symbol, Antoine substance, pipe material,
  //     resistor band count): each is a VALUE the graph could supply from a column
  //     or a spec table, and a menu row per value would bury the menu.
  // Everything else came out an operation — including the distribution forms, the
  // chart types and the E-series, which a person picks and never computes.
  { type: "th-antoine", ctor: AntoineNode, kind: "argument" },
  { type: "betadist", ctor: BetaDistNode, kind: "operation" },
  { type: "binomdist", ctor: BinomDistNode, kind: "operation" },
  { type: "cube-rollup", ctor: CubeRollupNode, kind: "argument" },
  { type: "elec-eseries", ctor: ESeriesNode, kind: "operation" },
  { type: "elec-resistor-code", ctor: ResistorCodeNode, kind: "argument" },
  { type: "ch-element", ctor: ElementNode, kind: "argument" },
  { type: "expodist", ctor: ExponDistNode, kind: "operation" },
  { type: "fdist", ctor: FDistNode, kind: "operation" },
  { type: "gammadist", ctor: GammaDistNode, kind: "operation" },
  { type: "group-by-frame", ctor: GroupByFrameNode, kind: "argument" },
  { type: "hypgeomdist", ctor: HypgeomDistNode, kind: "operation" },
  { type: "lognormdist", ctor: LognormDistNode, kind: "operation" },
  { type: "negbinomdist", ctor: NegbinomDistNode, kind: "operation" },
  { type: "normdist", ctor: NormDistNode, kind: "operation" },
  { type: "normsdist", ctor: NormSDistNode, kind: "operation" },
  { type: "em-constant", ctor: PhysicsConstantNode, kind: "operation" },
  { type: "fl-roughness", ctor: PipeRoughnessNode, kind: "argument" },
  { type: "pivot", ctor: PivotNode, kind: "argument" },
  { type: "poissondist", ctor: PoissonDistNode, kind: "operation" },
  { type: "tdist", ctor: TDistNode, kind: "operation" },
  { type: "weibulldist", ctor: WeibullDistNode, kind: "operation" },
];

const BY_TYPE = new Map(NODE_OPS.map((d) => [d.type, d]));

/** The declaration for a catalog leaf type, if it hosts a family of ops. */
export function opsFor(type: string): NodeOpsDecl | undefined {
  return BY_TYPE.get(type);
}

/** How this family is exposed (defaulting, per the module note, to collapsed). */
export function exposureOf(decl: NodeOpsDecl): OpExposure {
  return decl.expose ?? "collapsed";
}

/** The search-row label for one op: "Chart: Column". The host's label comes from the
 *  catalog rather than the declaration, so a renamed node renames its ops too. */
export function opSearchLabel(hostLabel: string, opLabel: string): string {
  return `${hostLabel}: ${opLabel}`;
}

// The op a family's primary leaf itself creates ("chart" -> "column"). Derived by
// constructing that one leaf, and memoized: it is fixed for the life of the session,
// and the alternative — declaring it — is a fact that could disagree with the code.
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

/** Build the catalog entry for one op of a family — used both for a generated leaf
 *  (expose: "leaves") and for a search-only row (collapsed). Only reachable for a
 *  declaration that lists ops, which by the type above also carries `create`. */
export function opEntry(
  decl: NodeOpsDecl & { create: (op: string) => unknown },
  host: NodeCatalogEntry,
  op: { op: string; label: string },
): NodeCatalogEntry {
  return {
    ...host,
    type: `${decl.type}__op-${op.op}`,
    label: opSearchLabel(host.label, op.label),
    create: () => decl.create(op.op),
    // The op rows inherit the host's description and keywords, so a search that
    // matches the family still matches each of its ops.
  };
}

/** The op kind of a live node — "operation" when its dropdown selects between
 *  distinct operations, "argument" when it selects a parameter of one operation.
 *  Undefined for a node whose family hasn't been declared yet, which is DIFFERENT
 *  from "argument" and must stay visually distinguishable from it until every
 *  op-selector family is declared. */
export function opKindForNode(node: object | undefined): OpKind | undefined {
  if (!node) return undefined;
  for (const d of NODE_OPS) if (node instanceof d.ctor) return d.kind;
  return undefined;
}
