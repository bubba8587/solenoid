// [[C26]] opArgDistinct, [[C63]] oneRecordNode, [[D5]] searchWiderThanLabel, [[D6]] opRowDerivesFromHost

import type { NodeCatalogEntry } from "./AddNodeMenu";
import { DIST_SPECS, DistributionsNode, type DistKey } from "./nodes/distribution";

import { ChartNode, SparklineNode, SurfaceNode, ProportionNode, RecordNode } from "./nodes/visual";
import { CHART_OP_META, SPARKLINE_OP_META, PROPORTION_OP_META, RECORD_OP_META } from "./nodes/visual";
import {
  FillNode, SetsNode, SumIfsNode,
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
import { NPVNode, IRRNode, NPV_OP_META, IRR_OP_META } from "./nodes/finance";
import {
  IsEvenOddNode, ComparisonNode, IsTestNode,
  PARITY_OP_META, COMPARISON_OP_META, IS_TEST_OP_META,
} from "./nodes/logic";
import { RegressionNode, CorrelNode, ForecastNode, LinestNode, REGRESSION_OP_META, CORREL_OP_META, FORECAST_OP_META, FIT_OP_META } from "./nodes/stats";
import {
  TwoInputMathNode, GCDNode, RoundNNode,
  TWO_INPUT_MATH_OP_META, GCD_OP_META, ROUNDN_OP_META,
} from "./nodes/scalar";
import {
  AggregateNode, ArgMinMaxNode, ArithmeticNode,
  BesselNode, BitwiseNode,
  BondPricingNode, BOND_PRICING_META, BooleanOpNode, CharCodeNode, 
  CombinatoricsNode, ComplexBinaryNode, ComplexUnaryNode,
  ConfidenceNode, ConstantNode, CouponNode, CovarianceNode,
  DateAddNode, DateDiffNode, EpochNode, SmoothNode, SMOOTH_OP_META, type SmoothOp, ReturnsNode, RETURNS_OP_META, type ReturnsOp, DISCOUNT_SECURITY_META,
  DatePartNode, DepreciationNode, DollarNode, DurationNode,
  ESeriesNode, 
  FisherNode,
  MRoundNode,
  MatDetNode, MathFXNode, 
  PhysicsConstantNode,
  DiscountSecurityNode, AccruedInterestNode, ACCRUED_INTEREST_OP_META,
  PaymentBreakdownNode, PAYMENT_BREAKDOWN_OP_META,
  RankPercentileNode, RomanArabicNode,
  SumProductNode,
  HypothesisTestNode, TableReshapeNode, TableSelectNode, TakeDropNode, TAKEDROP_OP_META,
  TextAfterBeforeNode, TextFindNode, TextSliceNode, TextTransformNode,
  TodayNowNode, UrlEncodeNode, WeekInfoNode, 
  WeightedNode,
} from "./rete-nodes";


export type OpExposure = "collapsed" | "leaves";

interface NodeOpsBase {
  type: string;
  expose?: OpExposure;
  /** Matched by `instanceof`: a constructor-name match breaks in a minified build. */
  ctor: new (...a: never[]) => object;
  mark?: boolean;
  leafOps?: string[];
}

export type NodeOpsDecl = NodeOpsBase & (
  | { ops: Array<OpEntryDecl>; create: (op: string) => unknown }
  | { ops?: undefined; create?: undefined }
);

export interface OpEntryDecl { op: string; label: string; fx?: string; keywords?: string }

function fromMeta(meta: Record<string, { label: string; fx?: string }>): OpEntryDecl[] {
  return Object.entries(meta).map(([op, m]) => ({ op, label: m.label, ...(m.fx ? { fx: m.fx } : {}) }));
}

const DIST_OPS: OpEntryDecl[] = (Object.keys(DIST_SPECS) as DistKey[]).map((op) => ({
  op,
  label: DIST_SPECS[op].label,
  fx: DIST_SPECS[op].excel.split(" / ")[0],
  keywords: DIST_SPECS[op].excel,
}));


const RANK_PERCENTILE_LEAF_OPS = [
  "large", "small", "rank-eq", "rank-avg", "percentile-inc", "quartile-inc", "percentrank-inc",
];

export const NODE_OPS: NodeOpsDecl[] = [
  { type: "chart", ctor: ChartNode, ops: fromMeta(CHART_OP_META),
    create: (op) => new ChartNode({ op: op as never }) },
  { type: "sparkline", ctor: SparklineNode, ops: fromMeta(SPARKLINE_OP_META),
    create: (op) => new SparklineNode({ op: op as never }) },
  { type: "proportion", ctor: ProportionNode, ops: fromMeta(PROPORTION_OP_META),
    create: (op) => new ProportionNode({ op: op as never }) },
  { type: "record", ctor: RecordNode, ops: fromMeta(RECORD_OP_META),
    create: (op) => new RecordNode({ op: op as never }) },
  { type: "surface", ctor: SurfaceNode },
  { type: "distributions", ctor: DistributionsNode, ops: DIST_OPS,
    create: (op) => new DistributionsNode({ op: op as never }) },

  { type: "takedrop", ctor: TakeDropNode, ops: fromMeta(TAKEDROP_OP_META),
    create: (op) => new TakeDropNode({ op: op as never }), leafOps: ["take", "drop"] },

  { type: "list-range", ctor: SeriesNode },
  { type: "list-fill", ctor: FillNode, ops: fromMeta(FILL_OP_META),
    create: (op) => new FillNode({ op: op as never }) },
  { type: "head", ctor: HeadNode, ops: fromMeta(HEAD_OP_META),
    create: (op) => new HeadNode({ op: op as never }) },
  { type: "xstack", ctor: StackNode, ops: fromMeta(STACK_OP_META),
    create: (op) => new StackNode({ op: op as never }) },
  { type: "by-axis", ctor: ByAxisNode, ops: fromMeta(BY_AXIS_OP_META),
    create: (op) => new ByAxisNode({ op: op as never }), leafOps: ["row", "col"] },
  { type: "npv", ctor: NPVNode, ops: fromMeta(NPV_OP_META),
    create: (op) => new NPVNode({ op: op as never }), leafOps: ["periods", "dates"] },
  { type: "irr", ctor: IRRNode, ops: fromMeta(IRR_OP_META),
    create: (op) => new IRRNode({ op: op as never }), leafOps: ["periods", "dates"] },
  { type: "keep-columns", ctor: ColumnsNode, ops: fromMeta(COLUMNS_OP_META),
    create: (op) => new ColumnsNode({ op: op as never }), leafOps: ["keep", "drop"] },
  { type: "list-pad", ctor: PadNode, ops: fromMeta(PAD_OP_META),
    create: (op) => new PadNode({ op: op as never }) },
  { type: "list-sets", ctor: SetsNode, ops: fromMeta(SET_META),
    create: (op) => new SetsNode({ op: op as never }) },
  { type: "iferror", ctor: IFErrorNode,
    ops: [{ op: "iferror", label: "IFERROR" }, { op: "ifna", label: "IFNA" }],
    create: (op) => new IFErrorNode({ op: op as never }), leafOps: ["iferror", "ifna"] },
  { type: "regex", ctor: RegexNode, ops: fromMeta(REGEX_OP_META),
    create: (op) => new RegexNode({ op: op as never }) },
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
  { type: "iseven-isodd", ctor: IsEvenOddNode, ops: fromMeta(PARITY_OP_META),
    create: (op) => new IsEvenOddNode({ op: op as never }), leafOps: ["iseven", "isodd"] },

  { type: "comparison", ctor: ComparisonNode, ops: fromMeta(COMPARISON_OP_META),
    create: (op) => new ComparisonNode({ op: op as never }) },
  { type: "is-test", ctor: IsTestNode, ops: fromMeta(IS_TEST_OP_META),
    create: (op) => new IsTestNode({ op: op as never }) },
  { type: "gcd-lcm", ctor: GCDNode, ops: fromMeta(GCD_OP_META),
    create: (op) => new GCDNode({ op: op as never }), leafOps: ["gcd", "lcm"] },

  { type: "twomath-log", ctor: TwoInputMathNode, ops: fromMeta(TWO_INPUT_MATH_OP_META),
    leafOps: ["log", "atan2", "delta", "gestep", "hypot"],
    create: (op) => new TwoInputMathNode({ op: op as never }) },
  { type: "roundn-round", ctor: RoundNNode, ops: fromMeta(ROUNDN_OP_META),
    leafOps: ["round", "roundup", "rounddown"],
    create: (op) => new RoundNNode({ op: op as never }) },

  { type: "reduce-sum", ctor: AggregateNode },
  { type: "arg-argmax", ctor: ArgMinMaxNode },
  { type: "arith-add", ctor: ArithmeticNode },
  { type: "bessel-besselj", ctor: BesselNode },
  { type: "bitwise-bitand", ctor: BitwiseNode },
  { type: "bool-and", ctor: BooleanOpNode },
  { type: "char-code-char", ctor: CharCodeNode },
  { type: "comb-fact", ctor: CombinatoricsNode },
  { type: "cx-binary-sum", ctor: ComplexBinaryNode },
  { type: "cx-unary-conj", ctor: ComplexUnaryNode },
  { type: "confidence-norm", ctor: ConfidenceNode },
  { type: "constant", ctor: ConstantNode },
  { type: "coupon-coupdaybs", ctor: CouponNode },
  { type: "cov-pop", ctor: CovarianceNode },
  { type: "date-add-edate", ctor: DateAddNode },
  { type: "date-epoch-from", ctor: EpochNode },
  { type: "returns", ctor: ReturnsNode, ops: fromMeta(RETURNS_OP_META),
    create: (op) => new ReturnsNode({ op: op as ReturnsOp }) },
  { type: "list-smooth", ctor: SmoothNode, ops: fromMeta(SMOOTH_OP_META),
    create: (op) => new SmoothNode({ op: op as SmoothOp }) },
  { type: "date-datedif", ctor: DateDiffNode, ops: fromMeta(DATE_DIFF_OP_META),
    create: (op) => new DateDiffNode({ op: op as never }), leafOps: ["days", "days360", "yearfrac", "years"] },
  { type: "date-part-year", ctor: DatePartNode },
  { type: "date-value", ctor: DateTimeValueNode },
  { type: "date-workday", ctor: WorkdaysNode },
  { type: "depr-sln", ctor: DepreciationNode },
  { type: "dollar-dollarde", ctor: DollarNode },
  { type: "duration-duration", ctor: DurationNode },
  { type: "fisher-fisher", ctor: FisherNode },
  { type: "math-ceiling", ctor: MRoundNode },
  { type: "matdet-mdeterm", ctor: MatDetNode },
  { type: "math-abs", ctor: MathFXNode },
  { type: "stat-percentile", ctor: RankPercentileNode,
    ops: [{ op: "percentile-inc", label: "PERCENTILE.INC" }, { op: "percentile-exc", label: "PERCENTILE.EXC" }],
    leafOps: RANK_PERCENTILE_LEAF_OPS,
    create: (op) => new RankPercentileNode({ op: op as never }) },
  { type: "stat-percentrank", ctor: RankPercentileNode,
    ops: [{ op: "percentrank-inc", label: "PERCENTRANK.INC" }, { op: "percentrank-exc", label: "PERCENTRANK.EXC" }],
    leafOps: RANK_PERCENTILE_LEAF_OPS,
    create: (op) => new RankPercentileNode({ op: op as never }) },
  { type: "stat-quartile", ctor: RankPercentileNode,
    ops: [{ op: "quartile-inc", label: "QUARTILE.INC" }, { op: "quartile-exc", label: "QUARTILE.EXC" }],
    leafOps: RANK_PERCENTILE_LEAF_OPS,
    create: (op) => new RankPercentileNode({ op: op as never }) },
  { type: "bond-pricing", ctor: BondPricingNode, ops: fromMeta(BOND_PRICING_META),
    create: (op) => new BondPricingNode({ op: op as never }) },
  { type: "accrued-interest", ctor: AccruedInterestNode, ops: fromMeta(ACCRUED_INTEREST_OP_META),
    create: (op) => new AccruedInterestNode({ op: op as never }) },
  { type: "payment-breakdown", ctor: PaymentBreakdownNode, ops: fromMeta(PAYMENT_BREAKDOWN_OP_META),
    create: (op) => new PaymentBreakdownNode({ op: op as never }) },
  { type: "discount-security", ctor: DiscountSecurityNode, ops: fromMeta(DISCOUNT_SECURITY_META),
    create: (op) => new DiscountSecurityNode({ op: op as never }) },
  { type: "roman-arabic-roman", ctor: RomanArabicNode },
  { type: "sp-sumproduct", ctor: SumProductNode },
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

export function opsFor(type: string): NodeOpsDecl | undefined {
  return BY_TYPE.get(type);
}

export function exposureOf(decl: NodeOpsDecl): OpExposure {
  return decl.expose ?? "collapsed";
}

export function opSearchLabel(hostLabel: string, opLabel: string): string {
  return `${hostLabel}: ${opLabel}`;
}

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

export function hiddenOps(decl: NodeOpsDecl, host: NodeCatalogEntry): Array<{ op: string; label: string }> {
  if (!decl.ops) return [];
  const own = new Set(decl.leafOps ?? []);
  if (!decl.leafOps) {
    const primary = primaryOpOf(host);
    if (primary) own.add(primary);
  }
  return decl.ops.filter((o) => !own.has(o.op));
}

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
    // Not the host's keywords, hiddenOps or ops mark ([[D6]] opRowDerivesFromHost); the op's own keywords ride along.
    keywords: op.keywords,
    hiddenOps: undefined,
    hideOpsMark: undefined,
  };
}

