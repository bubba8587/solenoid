import {
  AngleDialNode, SlicerNode, CableSwitchNode, DateInputNode, DateRangeNode, XYPadNode,
  PointPlotterNode, CurveNode, GridPainterNode,
  SparklineNode, ChartNode, HistogramNode, KpiNode, ProportionNode, SankeyNode, SurfaceNode, MermaidNode, GaugeNode, HeatmapCellNode, ChartBuilderNode,
  WaterfallNode, CandlestickNode, BoxplotNode, CalendarHeatmapNode, QuiverNode, SevenSegNode, RecordNode,
  FillBlanksNode, ReplaceValuesNode, MergeColumnsNode, HeadersNode, DropBlankRowsNode, DescribeNode, CorrMatrixNode, KMeansNode, PcaNode, LogisticNode, WindowNode,
  NumberInputNode, ArithmeticNode, DisplayNode, ComparisonNode, MathFnNode,
  FormatControllerNode, ExpressionNode, EquationNode, RegexNode, GroupByNode,
  ClampNode, BooleanOpNode, NotNode, IfNode, ConduitNode, CastNode, ConstantNode, MRoundNode,
  ListInputNode, AggregateNode, SeriesNode, SERIES_OP_META, type SeriesOp, ListLengthNode, ListIndexNode,
  SortNode, ReverseNode, SliceNode, FilterNode, SumIfsNode, FillNode, XLookupNode,
  GcdNode, IFErrorNode, NaNode, RandBetweenNode, RoundNNode, ConvertNode,
  UniqueNode, SetOpNode, SetRelationNode, ListTakeDropNode, VStackNode, ConcatListsNode, FrameFromListsNode, QuadraticRootsNode, PolyRootsNode, RunningNode, DiffNode,
  ArgMinMaxNode, ContainsNode, RankPercentileNode, RANK_PERCENTILE_OP_META, type RankPercentileOp,
  CorrelNode, CombinatoricsNode, TwoInputMathNode,
  SumProductNode, ChooseNode, BooleanInputNode, SliderInputNode, ColorPickerNode, ColorBlendNode, IsTestNode,
  SaveTimesNode,
  AlertNode, NormalizeNode, BinNode, OutliersNode, SmoothNode, FindPeaksNode, SpectrumNode, ShiftNode, CombinationsNode, EwmaNode, ConvolveNode, CrossNode, PolyfitNode, TrapzNode, RleNode, BetweenNode, IsCloseNode,
  ShuffleNode, NthElementNode, InterleaveNode, PadNode,
  StandardizeNode, CovarianceNode, FisherNode, BitwiseNode,
  DepreciationNode,
  TvmNode, IpmtPpmtNode, NpvNode, IrrNode, MirrNode, CumPmtNode, AmortizationNode, ReturnsNode,
  FvScheduleNode, IspmtNode, DollarNode, ProbNode,
  WeightedNode, BaseConvertNode,
  TextInputNode, TextTransformNode, TextLenNode, ConcatNode, TextSliceNode,
  TextFindNode, SubstituteNode, TextReplaceNode,
  ReptNode, PadTextNode, TruncateTextNode, WrapTextNode, ExactNode, TextSimilarityNode, FuzzyMatchNode,
  CharCodeNode, TextJoinNode, TextSplitNode, TextAfterBeforeNode,
  TextFilterNode, NumberValueNode, RomanArabicNode, FixedNode, UrlEncodeNode, HashNode, UuidNode, TemplateNode,
  PromoNode,
  TodayNowNode, DateConstructNode, TimeConstructNode,
  DateTimeValueNode, DATE_TIME_VALUE_OP_META, DatePartNode, WeekInfoNode,
  DateDiffNode, DateAddNode, WorkdaysNode, WORKDAYS_OP_META, EpochNode, DateTruncNode,
  RandArrayNode,
  XMatchNode,
  TBillNode, SecurityDiscNode, CouponNode, AccrintNode,
  AccrintMNode, PriceDiscNode, PriceMatNode, DurationNode,
  BondPriceNode, OddCouponNode,
  TBILL_OP_META, SECURITY_DISC_OP_META, COUPON_OP_META,
  PRICE_DISC_OP_META, PRICE_MAT_OP_META, DURATION_OP_META, BOND_PRICE_OP_META, ODD_COUPON_OP_META,
  type TBillOp, type SecurityDiscOp, type BondPriceOp, type OddCouponOp,
  ComplexFromNode, ComplexUnpackNode, ComplexUnaryNode, ComplexBinaryNode, ComplexPowerNode,
  COMPLEX_UNARY_OP_META, COMPLEX_BINARY_OP_META,
  type ComplexUnaryOp, type ComplexBinaryOp,
  TableInputNode, MatDetNode, MatSolveNode, MatEigenNode, TableMultNode, TableUnitNode, TableDiagNode, TableOuterNode, TableTransposeNode,
  HStackTableNode, TableReshapeNode, TableSelectNode, TableTakeDropNode, ExpandNode, SetCellNode, TableInfoNode,
  MapTableNode, ByAxisNode, MakeArrayNode, ReduceLambdaNode, ScanLambdaNode, LambdaNode,
  FrameInputNode, BuildFrameNode, SplitFrameNode, GetColumnNode, AddColumnNode, ComputedColumnNode, GetRowNode, DistinctNode,
  HeadNode, SortFrameNode, FilterFrameNode, JoinNode,
  ColumnsNode, GroupByFrameNode, PivotNode, UnpivotNode, NestNode, UnnestNode, AppendNode, BindColumnsNode, RenameNode, SplitColumnNode, AddIndexNode, DecisionMatrixNode, DecisionSensitivityNode,
  ReconcileNode,
  BuildCubeNode, NestJoinNode, CubeColumnsNode, CubeRollupNode,
  WebSourceNode, LocalFileNode, ImportHtmlNode, ImportXmlNode, DataFeedNode,
  WriteFileNode, WriteObsidianNode, ImportObsidianNode,
  GroupNode, NoteNode, ReportNode, SessionHistoryNode, PresentationNode, ImageNode, SvgPickerNode,
  CompositeNode, CompositeInputNode, CompositeOutputNode,
  MAT_DET_OP_META, TABLE_RESHAPE_OP_META, TABLE_SELECT_OP_META, TABLE_TAKEDROP_OP_META,
  type MatDetOp, type TableReshapeOp, type TableSelectOp, type TableTakeDropOp,
  IsEvenOddNode, FormatDollarNode,
  DistributionNode,
  RegressionNode, ForecastNode, ModeNode, TrimMeanNode, FrequencyNode, ConfidenceNode,
  BesselNode,
  SeriesSumNode, MultinomialNode, SwitchNode, IfsNode,
  HypothesisTestNode, HYPOTHESIS_TEST_OP_META, type HypothesisTestOp,
  EtsForecastNode, DecomposeNode, OdeIntegrateNode, FitDistributionNode, InterpolateNode, LinestNode, LogestNode, BinomDistRangeNode,
  NODE_KIND_ACCENTS,
  ARITHMETIC_OP_META, MATH_FN_OP_META, BOOLEAN_OP_META, REDUCE_OP_META,
  COMBINATORICS_OP_META, ARG_MIN_MAX_OP_META,
  SUM_PRODUCT_OP_META, CORREL_OP_META, TWO_INPUT_MATH_OP_META,
  COVARIANCE_OP_META, FISHER_OP_META, BITWISE_OP_META,
  DEPRECIATION_OP_META,
  IPMT_PPMT_OP_META, CUM_PMT_OP_META, DOLLAR_OP_META,
  WEIGHTED_OP_META,
  TEXT_TRANSFORM_OP_META, TEXT_SLICE_OP_META, TEXT_FIND_OP_META, TEXT_AFTER_BEFORE_OP_META,
  BESSEL_OP_META, REGRESSION_OP_META,
  TODAY_NOW_OP_META, DATE_PART_OP_META, WEEK_INFO_OP_META, DATE_DIFF_OP_META, DATE_ADD_OP_META,
  type ArithmeticOp, type MathFnOp, type BooleanOp, type ReduceOp,
  type CombinatoricsOp, type ArgMinMaxOp,
  type SumProductOp, type CorrelOp, type TwoInputMathOp,
  type CovarianceOp, type FisherOp, type BitwiseOp,
  type DepreciationOp,
  type IpmtPpmtOp, type CumPmtOp, type DollarOp, type WeightedOp,
  type CouponOp, type PriceDiscOp, type PriceMatOp, type DurationOp,
  type TextTransformOp, type TextSliceOp, type TextFindOp, type CharCodeOp, type TextAfterBeforeOp,
  type RomanArabicOp,
  type BesselOp, type RegressionOp,
  type TodayNowOp, type DateTimeValueOp, type DatePartOp, type WeekInfoOp, type DateDiffOp, type DateAddOp,
  ExpectNode, TornadoNode,
} from "./rete-nodes";
import type { NodeCatalogEntry, CatalogEntry } from "./AddNodeMenu";

// Label + description come from OP_META; tree structure and ordering are hand-authored.

const arithLeaf    = (op: ArithmeticOp):   NodeCatalogEntry => ({ type: `arith-${op}`,     label: ARITHMETIC_OP_META[op].label,     description: ARITHMETIC_OP_META[op].description,     keywords: "arithmetic", create: () => new ArithmeticNode({ op }), ...(op === "pow" ? { parity: false as const } : {}) });
const mathLeaf     = (op: MathFnOp, overrides?: Partial<NodeCatalogEntry>): NodeCatalogEntry => ({ type: `math-${op}`, label: MATH_FN_OP_META[op].label, description: MATH_FN_OP_META[op].description, create: () => new MathFnNode({ op }), ...overrides, keywords: ["math", overrides?.keywords].filter(Boolean).join(" ") });
const booleanLeaf  = (op: BooleanOp):      NodeCatalogEntry => ({ type: `bool-${op}`,      label: BOOLEAN_OP_META[op].label,        description: BOOLEAN_OP_META[op].description,        create: () => new BooleanOpNode({ op })     });
const reduceLeaf   = (op: ReduceOp):       NodeCatalogEntry => ({ type: `reduce-${op}`,    label: REDUCE_OP_META[op].label,         description: REDUCE_OP_META[op].description,         keywords: "aggregate", create: () => new AggregateNode({ op }), ...((REDUCE_OP_META[op] as { fx?: string }).fx ? { fx: [(REDUCE_OP_META[op] as { fx?: string }).fx!] } : {})     });
const combLeaf     = (op: CombinatoricsOp):NodeCatalogEntry => ({ type: `comb-${op}`,      label: COMBINATORICS_OP_META[op].label,  description: COMBINATORICS_OP_META[op].description,  keywords: "combinatorics", create: () => new CombinatoricsNode({ op }) });
// One Series node; the leaf types keep their historical spellings (nodeExcel keys).
const SERIES_LEAF_TYPE: Record<SeriesOp, string> = { range: "list-range", sequence: "list-sequence", linspace: "list-linspace", geometric: "list-geometric", fibonacci: "list-fibonacci", repeat: "list-repeat" };
// Every op is a leaf of the ONE Series card, so "series" must find all of them in search.
const seriesLeaf   = (op: SeriesOp, overrides?: Partial<NodeCatalogEntry>): NodeCatalogEntry => ({ type: SERIES_LEAF_TYPE[op], label: SERIES_OP_META[op].label, description: SERIES_OP_META[op].description, keywords: "series generate list", create: () => new SeriesNode({ op }), ...overrides });

// One Rank & Percentile node; the leaf types keep their historical spellings (nodeExcel keys).
const RP_LEAF_TYPE: Partial<Record<RankPercentileOp, string>> = { large: "nth-large", small: "nth-small", "rank-eq": "rank-eq", "rank-avg": "rank-avg", "percentile-inc": "stat-percentile", "quartile-inc": "stat-quartile", "percentrank-inc": "stat-percentrank" };
const rpLeaf       = (op: RankPercentileOp, overrides?: Partial<NodeCatalogEntry>): NodeCatalogEntry => ({ type: RP_LEAF_TYPE[op]!, label: RANK_PERCENTILE_OP_META[op].label, description: RANK_PERCENTILE_OP_META[op].description, create: () => new RankPercentileNode({ op }), ...overrides, keywords: ["rank & percentile", overrides?.keywords].filter(Boolean).join(" ") });
const argLeaf      = (op: ArgMinMaxOp):    NodeCatalogEntry => ({ type: `arg-${op}`,       label: ARG_MIN_MAX_OP_META[op].label,    description: ARG_MIN_MAX_OP_META[op].description,    create: () => new ArgMinMaxNode({ op })     });
const spLeaf       = (op: SumProductOp):   NodeCatalogEntry => ({ type: `sp-${op}`,        label: SUM_PRODUCT_OP_META[op].label,    description: SUM_PRODUCT_OP_META[op].description,    create: () => new SumProductNode({ op })    });
const correlLeaf   = (op: CorrelOp):       NodeCatalogEntry => ({ type: `correl-${op}`,    label: CORREL_OP_META[op].label,         description: CORREL_OP_META[op].description,         create: () => new CorrelNode({ op })        });
const twoMathLeaf  = (op: TwoInputMathOp): NodeCatalogEntry => ({ type: `twomath-${op}`,   label: TWO_INPUT_MATH_OP_META[op].label, description: TWO_INPUT_MATH_OP_META[op].description, create: () => new TwoInputMathNode({ op })  });
const covLeaf      = (op: CovarianceOp):   NodeCatalogEntry => ({ type: `cov-${op}`,       label: COVARIANCE_OP_META[op].label,     description: COVARIANCE_OP_META[op].description,     create: () => new CovarianceNode({ op })    });
const fisherLeaf   = (op: FisherOp):       NodeCatalogEntry => ({ type: `fisher-${op}`,    label: FISHER_OP_META[op].label,         description: FISHER_OP_META[op].description,         create: () => new FisherNode({ op })        });
const bitwiseLeaf  = (op: BitwiseOp):      NodeCatalogEntry => ({ type: `bitwise-${op}`,   label: BITWISE_OP_META[op].label,        description: BITWISE_OP_META[op].description,        create: () => new BitwiseNode({ op })       });
const deprLeaf     = (op: DepreciationOp): NodeCatalogEntry => ({ type: `depr-${op}`,      label: DEPRECIATION_OP_META[op].label,   description: DEPRECIATION_OP_META[op].description,   create: () => new DepreciationNode({ op })  });
const ipmtPpmtLeaf = (op: IpmtPpmtOp):    NodeCatalogEntry => ({ type: `ipmt-${op}`,      label: IPMT_PPMT_OP_META[op].label,      description: IPMT_PPMT_OP_META[op].description,      create: () => new IpmtPpmtNode({ op })      });
const cumPmtLeaf   = (op: CumPmtOp):       NodeCatalogEntry => ({ type: `cumpmt-${op}`,    label: CUM_PMT_OP_META[op].label,        description: CUM_PMT_OP_META[op].description,        create: () => new CumPmtNode({ op })        });
const regressionLeaf = (op: RegressionOp): NodeCatalogEntry => ({ type: `regression-${op}`,label: REGRESSION_OP_META[op].label,     description: REGRESSION_OP_META[op].description,     keywords: "slope", create: () => new RegressionNode({ op })    });
// One Hypothesis Test node; the leaf types keep their historical spellings (nodeExcel keys).
const TEST_LEAF_TYPE: Record<HypothesisTestOp, string> = {
  z: "z-test", "t-paired": "t-test-paired", "t-equal": "t-test-equal-var", "t-welch": "t-test-unequal-var", f: "f-test", chisq: "chisq-test",
  anova: "anova-test", mannwhitney: "mannwhitney-test", wilcoxon: "wilcoxon-test", kruskal: "kruskal-test", fisher: "fisher-exact-test", ks: "ks-test", proptest: "proportion-test", binomtest: "binomial-test",
};
const testLeaf     = (op: HypothesisTestOp, overrides?: Partial<NodeCatalogEntry>): NodeCatalogEntry => ({ type: TEST_LEAF_TYPE[op], label: HYPOTHESIS_TEST_OP_META[op].label, description: HYPOTHESIS_TEST_OP_META[op].description, create: () => new HypothesisTestNode({ op }), ...overrides, keywords: ["hypothesis test", overrides?.keywords].filter(Boolean).join(" ") });
const dollarLeaf    = (op: DollarOp):      NodeCatalogEntry => ({ type: `dollar-${op}`,     label: DOLLAR_OP_META[op].label,          description: DOLLAR_OP_META[op].description,          create: () => new DollarNode({ op }) });
const weightedLeaf   = (op: WeightedOp):      NodeCatalogEntry => ({ type: `weighted-${op}`,    label: WEIGHTED_OP_META[op].label,          description: WEIGHTED_OP_META[op].description,          create: () => new WeightedNode({ op }) });
const DT = NODE_KIND_ACCENTS.date;
// The Parse pair keeps its Excel-name types: `date-value` / `time-value` key the
// Excel-equivalent table, and the op is not part of either name.
const dateTimeValueLeaf = (op: DateTimeValueOp): NodeCatalogEntry => ({ type: op === "date" ? "date-value" : "time-value", label: DATE_TIME_VALUE_OP_META[op].label, description: DATE_TIME_VALUE_OP_META[op].description, create: () => new DateTimeValueNode({ op }), parity: false });
const datePartLeaf  = (op: DatePartOp):  NodeCatalogEntry => ({ type: `date-part-${op}`,  label: DATE_PART_OP_META[op].label,  description: DATE_PART_OP_META[op].description,  create: () => new DatePartNode({ op }),  parity: false });
const weekInfoLeaf  = (op: WeekInfoOp):  NodeCatalogEntry => ({ type: `date-week-${op}`,  label: WEEK_INFO_OP_META[op].label,  description: WEEK_INFO_OP_META[op].description,  create: () => new WeekInfoNode({ op }),  parity: false });
const dateDiffLeaf  = (op: DateDiffOp):  NodeCatalogEntry => ({ type: `date-diff-${op}`,  label: DATE_DIFF_OP_META[op].label,  description: DATE_DIFF_OP_META[op].description,  create: () => new DateDiffNode({ op }),  parity: false });
const dateAddLeaf   = (op: DateAddOp):   NodeCatalogEntry => ({ type: `date-add-${op}`,   label: DATE_ADD_OP_META[op].label,   description: DATE_ADD_OP_META[op].description,   create: () => new DateAddNode({ op }),   parity: false });
const todayNowLeaf  = (op: TodayNowOp):  NodeCatalogEntry => ({ type: `date-${op}`,        label: TODAY_NOW_OP_META[op].label,  description: TODAY_NOW_OP_META[op].description,  create: () => new TodayNowNode({ op }),  parity: false });

const priceDiscLeaf = (op: PriceDiscOp): NodeCatalogEntry => ({ type: `pricedisc-${op}`, label: PRICE_DISC_OP_META[op].label, description: PRICE_DISC_OP_META[op].description, create: () => new PriceDiscNode({ op }), parity: false });
const priceMatLeaf  = (op: PriceMatOp):  NodeCatalogEntry => ({ type: `pricemat-${op}`,  label: PRICE_MAT_OP_META[op].label,  description: PRICE_MAT_OP_META[op].description,  create: () => new PriceMatNode({ op }),  parity: false });
const durationLeaf  = (op: DurationOp):  NodeCatalogEntry => ({ type: `duration-${op}`,  label: DURATION_OP_META[op].label,   description: DURATION_OP_META[op].description,   create: () => new DurationNode({ op }),  parity: false });

const couponLeaf = (op: CouponOp): NodeCatalogEntry => ({ type: `coupon-${op}`, label: COUPON_OP_META[op].label, description: COUPON_OP_META[op].description, create: () => new CouponNode({ op }), parity: false });

const bondPriceLeaf = (op: BondPriceOp): NodeCatalogEntry => ({ type: `bondprice-${op}`, label: BOND_PRICE_OP_META[op].label, description: BOND_PRICE_OP_META[op].description, create: () => new BondPriceNode({ op }), parity: false });
const oddCouponLeaf = (op: OddCouponOp): NodeCatalogEntry => ({ type: `oddcoupon-${op}`, label: ODD_COUPON_OP_META[op].label, description: ODD_COUPON_OP_META[op].description, create: () => new OddCouponNode({ op }), parity: false });
const CX = NODE_KIND_ACCENTS.complex;
const complexUnaryLeaf  = (op: ComplexUnaryOp):  NodeCatalogEntry => ({ type: `cx-unary-${op}`,  label: COMPLEX_UNARY_OP_META[op].label,  description: COMPLEX_UNARY_OP_META[op].description,  create: () => new ComplexUnaryNode({ op }),  parity: false });
const complexBinaryLeaf = (op: ComplexBinaryOp): NodeCatalogEntry => ({ type: `cx-binary-${op}`, label: COMPLEX_BINARY_OP_META[op].label, description: COMPLEX_BINARY_OP_META[op].description, create: () => new ComplexBinaryNode({ op }), parity: false });

const besselLeaf = (op: BesselOp): NodeCatalogEntry => ({ type: `bessel-${op}`, label: BESSEL_OP_META[op].label, description: BESSEL_OP_META[op].description, create: () => new BesselNode({ op }), parity: false });

const matDetLeaf    = (op: MatDetOp):      NodeCatalogEntry => ({ type: `matdet-${op}`,    label: MAT_DET_OP_META[op].label,    description: MAT_DET_OP_META[op].description,    create: () => new MatDetNode({ op }),    parity: false });
const reshapeLeaf   = (op: TableReshapeOp):NodeCatalogEntry => ({ type: `reshape-${op}`,   label: TABLE_RESHAPE_OP_META[op].label, description: TABLE_RESHAPE_OP_META[op].description, create: () => new TableReshapeNode({ op }), parity: false });
const selectLeaf    = (op: TableSelectOp): NodeCatalogEntry => ({ type: `tblsel-${op}`,    label: TABLE_SELECT_OP_META[op].label, description: TABLE_SELECT_OP_META[op].description, create: () => new TableSelectNode({ op }), parity: false });
const takeDropLeaf  = (op: TableTakeDropOp): NodeCatalogEntry => ({ type: `tbltd-${op}`,   label: TABLE_TAKEDROP_OP_META[op].label, description: TABLE_TAKEDROP_OP_META[op].description, create: () => new TableTakeDropNode({ op }), parity: false, keywords: "rows columns edge first last head tail" });

const romanArabicLeaf = (op: RomanArabicOp): NodeCatalogEntry => ({
  type: `roman-arabic-${op}`,
  label: op === "roman" ? "ROMAN" : "ARABIC",
  description: op === "roman"
    ? "Converts an integer (1–3999) to a Roman numeral string. Excel: ROMAN."
    : "Converts a Roman numeral string to an integer. Excel: ARABIC.",
  create: () => new RomanArabicNode({ op }),
  parity: false,
});


const tbillLeaf    = (op: TBillOp):       NodeCatalogEntry => ({ type: `tbill-${op}`,   label: TBILL_OP_META[op].label,          description: TBILL_OP_META[op].description,          create: () => new TBillNode({ op }),          parity: false });
const secDiscLeaf  = (op: SecurityDiscOp): NodeCatalogEntry => ({ type: `secdesc-${op}`, label: SECURITY_DISC_OP_META[op].label,  description: SECURITY_DISC_OP_META[op].description,  create: () => new SecurityDiscNode({ op }),   parity: false });

const STR = NODE_KIND_ACCENTS.string;
const textXformLeaf         = (op: TextTransformOp):   NodeCatalogEntry => ({ type: `text-${op}`,              label: TEXT_TRANSFORM_OP_META[op].label,        description: TEXT_TRANSFORM_OP_META[op].description,        create: () => new TextTransformNode({ op }),     parity: false });
const textSliceLeaf         = (op: TextSliceOp):       NodeCatalogEntry => ({ type: `text-${op}`,              label: TEXT_SLICE_OP_META[op].label,            description: TEXT_SLICE_OP_META[op].description,            create: () => new TextSliceNode({ op }),         parity: false });
const textFindLeaf          = (op: TextFindOp):        NodeCatalogEntry => ({ type: `text-find-${op}`,         label: TEXT_FIND_OP_META[op].label,             description: TEXT_FIND_OP_META[op].description,             create: () => new TextFindNode({ op }),           parity: false });
const charCodeLeaf          = (op: CharCodeOp):        NodeCatalogEntry => ({ type: `char-code-${op}`,         label: op === "char" ? "CHAR" : "CODE",         description: op === "char" ? "Character at Unicode code point N (0–1114111). Excel: CHAR / UNICHAR." : "Unicode code point of the first character. Excel: CODE / UNICODE.", create: () => new CharCodeNode({ op }), parity: false });
const textAfterBeforeLeaf   = (op: TextAfterBeforeOp): NodeCatalogEntry => ({ type: `text-after-before-${op}`, label: TEXT_AFTER_BEFORE_OP_META[op].label,     description: TEXT_AFTER_BEFORE_OP_META[op].description,     create: () => new TextAfterBeforeNode({ op }), parity: false });

// ─── Catalog tree ─────────────────────────────────────────────────────────────

export const NODE_CATALOG: CatalogEntry[] = [
  // ── INPUT ────────────────────────────────────────────────────────────────────
  {
    type: "category", label: "Input", description: "Source nodes: where values enter your graph.",
    children: [
      { type: "number-input",        label: "Number Input",  description: "A literal number value, typed on the node.", accent: NODE_KIND_ACCENTS.input, keywords: "scalar value literal", create: () => new NumberInputNode() },
      { type: "list-input",  label: "List Input",    description: "Builds a list from comma-separated values (for example 1, 2, 3) in each row. Every row concatenates into one output list. Element type: number, text, date, or TRUE or FALSE. Excel: selecting a range like A1:A8.", accent: NODE_KIND_ACCENTS.list, keywords: "literal array csv combine concat number text string date boolean logical type", create: () => new ListInputNode() },
      { type: "text-input",    label: "Text Input",    description: "A literal string value, typed directly on the node.", accent: STR, keywords: "string literal", create: () => new TextInputNode() },
      { type: "boolean-input", label: "Boolean Input", description: "A TRUE or FALSE toggle that outputs a logical. It coerces to 1 or 0 where a number is needed.", accent: NODE_KIND_ACCENTS.logic, create: () => new BooleanInputNode() },
      { type: "date-input",    label: "Date Input",    description: "A single date value, typed or picked.", accent: DT, create: () => new DateInputNode(), parity: false, keywords: "date calendar day picker serial input" },
      { type: "table-input",   label: "Table Input",   description: "A typed-in 2-D table, one row per line, comma-separated. One element type (Num/Text/Date/Bool — mixed columns belong in Frame Input). Typed text is the stored truth: an unparseable cell shows NaN and keeps its text in the editor's Source view.", accent: NODE_KIND_ACCENTS.table, create: () => new TableInputNode() },
      { type: "frame-input",   label: "Frame Input", description: "A typed-in data table with named, typed columns and editable cells.", accent: NODE_KIND_ACCENTS.frame, create: () => new FrameInputNode(), parity: false },
      { type: "cx-from",       label: "COMPLEX",     description: "Builds a complex number from real and imaginary parts. Excel: COMPLEX.", accent: CX, create: () => new ComplexFromNode(), parity: false },
      { type: "lambda-make",   label: "LAMBDA",      description: "Defines a reusable formula as a value: parameters in the λ(…) row (bound positionally), other variables become captured inputs. Evaluates like Expression — standard Excel functions, separate from the visual nodes. Excel: LAMBDA.", accent: NODE_KIND_ACCENTS.lambda, create: () => new LambdaNode(), parity: false },
      { type: "constant",      label: "Constant",    description: "Predefined value: π, e, φ, ∞, 0, 1, true, false …", create: () => new ConstantNode() },
      { type: "pair", children: [
        { type: "randbetween", label: "RAND",        description: "Random float in [Bottom, Top]. Defaults to 0–1 (like Excel RAND()). Bottom and Top give a custom range.", create: () => new RandBetweenNode(), parity: false },
        { type: "na",          label: "NA",          description: "Outputs #N/A, which propagates through calculations like Excel. Catch it with IFERROR or IFNA.", create: () => new NaNode() },
      ]},
      {
        type: "category", label: "Control", description: "Interactive widgets that drive values in your graph.",
        children: [
          { type: "slider",      label: "Slider",      description: "A slider value, with min, max, and step configured on the node.", accent: NODE_KIND_ACCENTS.input, create: () => new SliderInputNode() },
          { type: "angle-dial",  label: "Angle Dial",  description: "A rotary dial: spin or type to set an angle in degrees, 0–359.", create: () => new AngleDialNode() },
          { type: "date-range",  label: "Date Range",  description: "Picks a start and end date. It outputs both serials. Subtract them for a duration.", create: () => new DateRangeNode(), parity: false, keywords: "date range period start end duration between from to picker" },
          { type: "xy-pad",      label: "XY Pad",      description: "Two values at once, from a handle in a square pad. Each is 0–1. Scale them with arithmetic for any range.", create: () => new XYPadNode(), parity: false },
          { type: "point-plotter", label: "Point Plotter", description: "Hand-plotted dataset on a small plane, out as a two-column X, Y frame.", create: () => new PointPlotterNode(), parity: false, keywords: "point plotter scatter draw data by hand click plane pad dataset xy points" },
          { type: "curve",       label: "Curve",       description: "Hand-drawn response curve: a no-overshoot spline through control points on a strip. Tuning curves, easing, tiered rates, lookup tables. Out as an X, Value frame.", create: () => new CurveNode(), parity: false, keywords: "curve envelope spline ease easing ramp response tuning interpolate draw shape function" },
          { type: "grid-painter", label: "Grid Painter", description: "Paintable matrix, any brush value (right-click erases to blank). Outputs the grid — masks for MAP, terrain for Surface, quick heatmap data.", create: () => new GridPainterNode(), parity: false, keywords: "grid painter paint matrix cells brush mask draw table pixel editor" },
          { type: "color-picker", label: "Color", description: "A color in RGB or HSV, out as a hex or rgb() string.", create: () => new ColorPickerNode(), parity: false },
          { type: "color-blend", label: "Color Blend", description: "Blend two colors with a standard blend mode: mix, multiply, screen, overlay, soft or hard light, darken, lighten, difference, exclusion, dodge, burn. Accepts any CSS color string. Outputs the hex result.", create: () => new ColorBlendNode(), parity: false, keywords: "color blend mix multiply screen overlay tint shade combine average darken lighten" },
          { type: "slicer",      label: "Slicer",      description: "Filters a Frame like an Excel slicer: choose a column, then the values whose rows to keep.", create: () => new SlicerNode() },
          { type: "cable-switch", label: "Input Switch", description: "A multiplexer, distinct from the logical SWITCH: wire several cables, name each slot, pick which passes through — any type. Many mode chooses several slots. The output becomes a Cube of the chosen name · value rows.", create: () => new CableSwitchNode(), parity: false, keywords: "switch multiplexer select choose route mux named cube collect multi" },
        ],
      },
      {
        type: "category", label: "Connections", description: "Live external data: load from a URL, a local CSV, or a web page. Stores the source, not the data. Refresh to re-pull.",
        children: [
          { type: "web-source",    label: "Web Source",  description: "Loads a Frame from a CSV or JSON URL. Columns are auto-typed. Stores the URL, not the data: refresh to re-pull. Desktop fetches any URL. The browser only fetches CORS-enabled ones.", create: () => new WebSourceNode(), parity: false },
          { type: "data-feed",     label: "Data Feed",   description: "Live economic and market data as a Frame: FRED series with no key, stock history through Alpha Vantage with a free key. Stores the series id or ticker, not the data. Refresh re-pulls. Desktop works with arbitrary URLs. The browser is CORS-limited.", create: () => new DataFeedNode(), parity: false },
          { type: "local-file",   label: "Local File",  description: "Loads a Frame from your data folder (Settings ▸ Data). A .parquet reads straight into the native engine — typed columns arrive intact, no inference; anything else is read as CSV with columns auto-typed. Stores the file name. Refresh to re-read. Desktop only.", create: () => new LocalFileNode(), parity: false, keywords: "csv parquet arrow column columnar native engine polars file load import" },
          { type: "import-html",   label: "Import HTML", description: "Grab the Nth HTML table on a page as a Frame, columns auto-typed. Stores the URL. Refresh to re-pull. Desktop any URL, browser CORS-only. Sheets: IMPORTHTML.", create: () => new ImportHtmlNode(), parity: false },
          { type: "import-xml",    label: "Import XML",  description: "Extracts a page's XPath matches (for example //h2/a) as a text list. Stores the URL. Refresh to re-pull. Desktop any URL, browser CORS-only. Sheets: IMPORTXML.", create: () => new ImportXmlNode(), parity: false },
          { type: "import-obsidian", label: "Import from Obsidian", description: "Picks a .md note from your Obsidian vault: it becomes a read-only Note — frontmatter turns into typed output sockets, the body renders inline. Reload re-reads from disk. Set the vault in Settings ▸ Obsidian. Desktop only.", create: () => new ImportObsidianNode(), parity: false, keywords: "obsidian vault markdown md note import read source frontmatter" },
          { type: "write-file",    label: "Write File",  description: "Writes a Frame to a file — CSV, or JSON as an array of row records: pick the format, arm it, then press Run. Never writes on its own. A normal recompute only updates the preview. Desktop only.", create: () => new WriteFileNode(), parity: false, keywords: "csv json write export save file sink" },
          { type: "write-obsidian", label: "Write to Obsidian", description: "Writes a Note or Report (its Document output) into your Obsidian vault as portable markdown — frontmatter, tables, mermaid, math, rasterized chart/image assets — under a vault-relative subfolder. Arm, then Run. Never writes on its own. Vault: Settings ▸ Obsidian. Desktop only.", create: () => new WriteObsidianNode(), parity: false, keywords: "obsidian vault markdown md note export sink write document" },
        ],
      },
    ],
  },

  // ── OUTPUT ───────────────────────────────────────────────────────────────────
  {
    type: "category", label: "Output", description: "Display, convert, and visualize values at the end of a chain.",
    children: [
      { type: "display",   label: "Display",  description: "Shows a value. Pass-through, so wiring continues after it.", create: () => new DisplayNode(), accent: NODE_KIND_ACCENTS.util },
      { type: "alert",     label: "Alert",    description: "Watch a value and fire a toast plus an Alerts HUD entry on a status change. Modes: range with Low/High thresholds, boolean where TRUE fires, change on any new value, or threshold-cross.", create: () => new AlertNode() },
      {
        type: "category", label: "Data Quality", description: "Trust the graph: validate values in place, and rank which upstream inputs matter most.",
        children: [
          { type: "expect", label: "Expect", description: "Data Validation, generalized: opt-in checks — not-null, unique for a list, in range, regex, allowlist. Always pass-through: a failure never blocks the value. It shows a red badge and fires an Alert once per new failure.", create: () => new ExpectNode(), parity: false, keywords: "expect validate validation data quality check rule assert not null unique range regex allowlist in list membership enum whitelist trust" },
          { type: "tornado", label: "Tornado", description: "One-at-a-time sensitivity ranking: Run perturbs each upstream Number or Slider ±10% (or its declared min/max), reads how much this value swings, and ranks the inputs by impact in an inline tornado chart. Pass-through.", create: () => new TornadoNode(), parity: false, keywords: "tornado sensitivity analysis what-if one at a time impact ranking swing trust" },
        ],
      },
      {
        // General plotters stay top-level; specialist figures cluster by what they show.
        type: "category", label: "Visuals", description: "Inline charts and readouts: plot or visualize a value at the end of a chain. All pass-through.",
        children: [
          { type: "chart",     label: "Chart",     description: "Plots a list or a frame as a column, bar, line, area, scatter, pie, radar, radial, or funnel chart; a frame's number columns become named series with a legend, or a composed (bars + lines) or bubble chart. Options takes a Chart Builder for styling.", create: () => new ChartNode(), parity: false, keywords: "chart plot graph column bar line area scatter pie radar radial funnel composed bubble multi-series legend" },
          { type: "chart-builder", label: "Chart Builder", description: "Style any chart and output an options string for its Options socket. A chart-type dropdown (Chart, Histogram, KPI, Proportion, Waterfall…) shows just the options that type reads — title, axes, color, grid, range, line, markers. Fields follow matplotlib.", create: () => new ChartBuilderNode(), parity: false, keywords: "chart builder options style title axes color grid range markers histogram kpi proportion treemap waffle sankey waterfall" },
          { type: "sparkline", label: "Sparkline", description: "A small inline chart of a list: line, column, or win/loss. Collapses to a headerless square. Excel: SPARKLINE.", create: () => new SparklineNode(), parity: false, keywords: "sparkline spark line column win loss winloss" },
          { type: "mermaid",   label: "Mermaid",   description: "Draws a diagram from Mermaid.js text: flowchart, sequence, class, state, gantt, or pie. The source is typed on the node or wired in from a Text node. The figure flows out a chart socket, so a Report renders it inline where its =name ref sits.", create: () => new MermaidNode(), parity: false, keywords: "mermaid diagram flowchart flow chart graph sequence class state gantt pie mindmap uml erd tree" },
          { type: "kpi",       label: "KPI card",  description: "A big-number stat card with a ↑/↓ delta vs a prior value, colored green/red.", create: () => new KpiNode(), parity: false, keywords: "kpi stat card metric scorecard delta variance big number" },
          { type: "record",    label: "Record",    description: "One frame row as labeled boxes, or every row as a gallery of cards or a board of lanes grouped by a column. Flip through rows with the pager or wire Row. The shown row flows back out. The Layout text places the boxes: one line per grid row, names split by | marks, and a repeated name merges its cells. A cell holding an image URL shows the picture.", create: () => new RecordNode(), parity: false, keywords: "record card form detail row browse fields layout boxes airtable gallery kanban board lanes" },
          { type: "gauge",     label: "Gauge",     description: "Shows a value on a fixed scale: a radial Dial reading the value as a fraction (1 = 100%, 1.5 = 150%), or a horizontal Bar on a zero-to-Max track with a target tick. Excel has no equivalent.", create: () => new GaugeNode(), parity: false, keywords: "gauge dial bullet graph target progress goal percent speedometer meter scale kpi" },
          { type: "seven-seg", label: "7-Segment", description: "A flat seven-segment readout of a number, with a Decimals setting — the meter-face look.", create: () => new SevenSegNode(), parity: false, keywords: "seven segment display digital readout meter lcd led digits retro" },
          {
            type: "category", label: "Distribution", description: "How a sample spreads: binned counts and five-number summaries.",
            children: [
              { type: "histogram", label: "Histogram", description: "Bin a list of numbers into equal-width buckets and plot the counts as columns, or a 2-D X/Y count grid as a density plot. numpy histogram / histogram2d.", create: () => new HistogramNode(), parity: false, keywords: "histogram bins distribution frequency FREQUENCY buckets histogram2d 2d bivariate density joint hexbin heatmap" },
              { type: "boxplot", label: "Boxplot", description: "Five-number summaries as boxes: one per numeric column of a wired Frame (or one for a plain list). Median line, quartile box, Tukey 1.5·IQR whiskers, outlier dots. The visual companion to QUARTILE.", create: () => new BoxplotNode(), parity: false, keywords: "boxplot box whisker quartile median outlier iqr spread distribution violin" },
            ],
          },
          {
            type: "category", label: "Proportion", description: "Parts of a whole: shares, flows, and space-filling layouts.",
            children: [
              { type: "proportion", label: "Proportion", description: "Parts of a whole from a 2-column frame (label, value): a Treemap sizes each label as a nested rectangle, or a Waffle fills a 10×10 grid of squares by share. Pick the layout on the card.", create: () => new ProportionNode(), parity: false, keywords: "treemap tree map rectangles waffle squares dot matrix proportion share percentage pictogram hierarchy area progress" },
              { type: "sankey",    label: "Sankey",    description: "A flow diagram: each row of a 3-column frame (From, To, Value) is an edge, and the band width shows the flow.", create: () => new SankeyNode(), parity: false, keywords: "sankey flow diagram alluvial edges links network flows" },
            ],
          },
          {
            type: "category", label: "Grids & Fields", description: "Figures over a 2-D grid: cell color, height, and direction.",
            children: [
              { type: "heatmap-cell", label: "Heatmap", description: "Color every cell of a Table on a cool-to-warm scale across its data range, like conditional formatting. Pass-through.", create: () => new HeatmapCellNode(), parity: false },
              { type: "surface", label: "Surface", description: "A shaded 3-D surface plot over a table of heights, with optional Xs and Ys coordinate lists; unwired axes count 1, 2, 3… — the same shape Grid Interpolate fills.", create: () => new SurfaceNode(), parity: false, keywords: "surface 3d mesh plot height field terrain contour wireframe grid" },
              { type: "contour", label: "Contour", description: "The flat twin of Surface: the same table of heights, with optional Xs and Ys, drawn as filled height bands with iso-lines. One table into both gives two views of one surface.", create: () => new SurfaceNode({ op: "contour" }), parity: false, keywords: "contour iso lines level topo topographic height map bands field 2d surface" },
              { type: "quiver", label: "Vector Field", description: "One arrow per grid cell from two same-shaped matrices (the X and Y components), colored by magnitude — gradients, flows, wind fields.", create: () => new QuiverNode(), parity: false, keywords: "quiver vector field arrows flow gradient wind direction magnitude" },
            ],
          },
          {
            type: "category", label: "Time & Finance", description: "Values over time: candles, bridges, and daily activity.",
            children: [
              { type: "candlestick", label: "Candlestick", description: "OHLC candles for price history, from a frame whose columns are Date, Open, High, Low, Close (the Data Feed's stock-history shape). With exactly four numeric columns the date is omitted.", create: () => new CandlestickNode(), parity: false, keywords: "candlestick candle ohlc stock price open high low close market trading finance" },
              { type: "waterfall", label: "Waterfall", description: "The finance bridge chart: each row of a 2-column frame (Label, Delta) steps the running total up or down, with a computed Total bar at the end.", create: () => new WaterfallNode(), parity: false, keywords: "waterfall bridge chart delta variance walk finance running total steps" },
              { type: "calendar-heatmap", label: "Calendar", description: "A year of daily activity as a weeks-by-weekdays grid, each day tinted by its value — the contribution-graph look: each row of a 2-column frame (Date, Value) tints one day, and duplicate days sum.", create: () => new CalendarHeatmapNode(), parity: false, keywords: "calendar heatmap daily activity year contribution github days streak" },
            ],
          },
        ],
      },
      { type: "conduit",    label: "Conduit",   description: "Bundle up to 8 cables into one block. They travel onward as a single ribbon that splits back into lanes at the destination. Rotate or extend it from the inspector.", create: () => new ConduitNode(), parity: false },
      { type: "format-controller", label: "Format", description: "Sets a docked socket's number format (decimal, fraction, %, currency…) and a unit label like °C, m, or kg. Units must match on connected cables.", create: () => new FormatControllerNode() },
      { type: "group", label: "Group", description: "A container: drop it around nodes, or select them and press Ctrl+G. Its header moves them together. Collapse it to a summary.", create: () => new GroupNode(), parity: false },
      // Query ships a PENDING internal snapshot, so every add path must hydrate the
      // CompositeNode right after create().
      { type: "pair", children: [
        { type: "composite", label: "Composite", description: "A reusable computing subgraph: one card with a typed input/output boundary. Built inside using Edit contents, or by selecting nodes and pressing Ctrl+Shift+G to collapse them into one.", create: () => new CompositeNode(), parity: false },
        { type: "query", label: "Query", description: "A Composite pre-shaped for data transformation: a table in, the verb chain built inside (Edit contents), the result out. Runs in Manual refresh mode — upstream changes only mark it stale until you press Refresh. Excel: Power Query (Get & Transform).", create: () => new CompositeNode({
          label: "Query",
          runMode: "manual",
          inputPorts: [{ id: "table", label: "Table", exposure: "exposed", tier: "basic", internalNodeId: "qin" }],
          outputPorts: [{ id: "result", label: "Result", tier: "basic", internalNodeId: "qout" }],
          internal: {
            nodes: [
              { id: "qin", type: "CompositeInputNode", init: { label: "Table" }, x: 0, y: 0 },
              { id: "qout", type: "CompositeOutputNode", init: { label: "Result" }, x: 420, y: 0 },
            ],
            connections: [{ source: "qin", sourceOutput: "value", target: "qout", targetInput: "value" }],
          },
        }), parity: false, keywords: "power query get transform etl refresh manual steps applied pipeline shape clean data table verbs" },
      ]},
      // FLAT_CATALOG-only: these live inside a Composite's internal graph, never on
      // the main canvas, but hydrate() must rebuild them from a save/paste snapshot.
      { type: "composite-input", label: "Composite Input", description: "Internal: a Composite's exposed-input boundary marker.", create: () => new CompositeInputNode(), parity: false, hidden: true },
      { type: "composite-output", label: "Composite Output", description: "Internal: a Composite's output boundary marker.", create: () => new CompositeOutputNode(), parity: false, hidden: true },
      { type: "pair", children: [
        { type: "note", label: "Note", description: "A free-floating markdown note, any position, any tint. Open the body with a ----fenced YAML block to turn each key into a typed output socket — a note doubling as a constants source. A Note only emits. To read live values into a document, use a Report.", create: () => new NoteNode(), parity: false },
        { type: "report", label: "Report", description: "A standalone markdown document, separate from the graph: prose with inline `=name` refs that render a wired value or chart formatted in the text, plus Notes embedded as placed objects. Opens from the small anchor card.", create: () => new ReportNode(), parity: false },
      ]},
      { type: "session-history", label: "Session History", description: "A live, dated log of this session's undo/redo actions (nodes added, removed, or moved; connections made or broken) with a copy button. No inputs or outputs. It doesn't persist. It autogenerates while it's on canvas.", create: () => new SessionHistoryNode(), parity: false },
      { type: "presentation", label: "Presentation", description: "Presenter mode: select nodes on canvas, Add step to capture them, then step through with Prev/Next. Each step flies the camera to fit its nodes. Pan/zoom only, no isolate/highlight.", create: () => new PresentationNode(), parity: false },
      { type: "pair", children: [
        { type: "convert", label: "Convert", description: "Converts between measurement units: degrees ↔ radians, length, mass, temperature, time, area, volume, speed, energy, pressure. Excel: CONVERT.", create: () => new ConvertNode() },
        { type: "cast", label: "Cast", description: "Change a value's data type: number, text, date serial, Boolean TRUE or FALSE, or complex. Works element-wise on lists. Excel: TEXT, VALUE.", create: () => new CastNode(), parity: false },
      ]},
    ],
  },

  // ── NUMBERS ──────────────────────────────────────────────────────────────────
  {
    type: "category", label: "Numbers", description: "Scalar math: arithmetic, functions, rounding, and trigonometry.",
    children: [
      { type: "expression", label: "Expression", description: "A formula like a*b+1: named variables become input sockets. Math functions, constants pi / tau / e / phi, element-wise broadcasting over lists and matrices, the dynamic-array core (TRANSPOSE, MMULT, SEQUENCE…), complex numbers, LAMBDA as a value. Any function loops over arrays (UPPER(name)). A name here computes what its visual node computes. Frames and cubes stay out by design — the table verbs are nodes. Row formulas live in Computed Column.", create: () => new ExpressionNode(), accent: NODE_KIND_ACCENTS.math },
      { type: "equation", label: "Equation", description: "A relation like V = I * R: every variable is an input and an output. Leave one unwired and it solves — algebraically where the equation inverts, numerically otherwise. A quadratic returns every real root as a list. All wired → Check turns TRUE or FALSE. Numbers and 1-D lists. √ and trig inversions take the principal branch.", create: () => new EquationNode(), accent: NODE_KIND_ACCENTS.math, keywords: "solve rearrange unknown goal seek formula bidirectional check quadratic roots" },
      {
        type: "category", label: "Arithmetic", description: "Two-input operations on numbers.",
        children: [
          { type: "pair", children: [arithLeaf("add"), arithLeaf("sub")] },
          { type: "pair", children: [arithLeaf("mul"), arithLeaf("div")] },
          { type: "pair", children: [arithLeaf("mod"), arithLeaf("quotient")] },
          { type: "pair", children: [
            arithLeaf("pow"),
            { type: "gcd-lcm", label: "GCD / LCM", description: "Greatest common divisor or least common multiple of two integers. Excel: GCD / LCM.", create: () => new GcdNode() },
          ]},
        ],
      },
      {
        type: "category", label: "Functions", description: "Single-input math functions.",
        children: [
          { type: "pair", children: [mathLeaf("abs"), mathLeaf("sign")] },
          { type: "pair", children: [mathLeaf("sqrt"), mathLeaf("sqrtpi")] },
          mathLeaf("exp"),
          { type: "pair", children: [mathLeaf("erf"), mathLeaf("erfc")] },
          { type: "pair", children: [mathLeaf("gamma"), mathLeaf("gammaln")] },
        ],
      },
      // PHI/GAUSS/STANDARDIZE live under Distributions ▸ Normal with their NORM.* kin.
      {
        type: "category", label: "Rounding", description: "Round and constrain numbers.",
        children: [
          mathLeaf("trunc"),
          { type: "pair", children: [
            { type: "math-ceiling", label: "CEILING", description: "Rounds up to a multiple (toward +∞). The multiple defaults to 1 so it snaps up to the next integer. Excel: CEILING.MATH(x, sig).", create: () => new MRoundNode({ op: "up" }), keywords: "ceil ceiling round up multiple significance" },
            { type: "math-floor", label: "FLOOR", description: "Rounds down to a multiple (toward −∞). The multiple defaults to 1 so it snaps down to the next integer. Excel: FLOOR.MATH(x, sig).", create: () => new MRoundNode({ op: "down" }), keywords: "floor round down multiple significance" },
          ]},
          { type: "pair", children: [
            mathLeaf("int"),
            { type: "math-mround", label: "MROUND", description: "Rounds to nearest multiple. Excel: MROUND(x, multiple).", create: () => new MRoundNode(), keywords: "mround round nearest multiple ceil floor ceiling" },
          ]},
          { type: "pair", children: [mathLeaf("even"), mathLeaf("odd")] },
          { type: "roundn-round", label: "ROUND to N digits", description: "Rounds to N decimal places. Excel: ROUND(x,2).", keywords: "rounding", create: () => new RoundNNode({ op: "round" }) },
          { type: "roundn-dir", label: "ROUNDUP / ROUNDDOWN", description: "Rounds away from zero or toward zero to N decimal places. Pick the direction in the node. Excel: ROUNDUP / ROUNDDOWN.", keywords: "rounding", create: () => new RoundNNode({ op: "roundup" }) },
          { type: "clamp", label: "Clamp", description: "Constrain a value to [min, max]. Excel: MIN(MAX(x,min),max).", create: () => new ClampNode() },
        ],
      },
      {
        type: "category", label: "Logarithms", description: "Logarithms and their inverses.",
        children: [
          { type: "pair", children: [
            mathLeaf("log"),
            mathLeaf("exp", { type: "math-exp-inv", description: "e to the power x, the inverse of LN. Excel: EXP(x)." }),
          ]},
          { type: "pair", children: [mathLeaf("log10"), mathLeaf("log2")] },
          twoMathLeaf("log"),
        ],
      },
      {
        type: "category", label: "Trigonometry", description: "Circular and hyperbolic functions with their inverses. Angles in radians. Use Convert to go between degrees and radians.",
        children: [
          { type: "pair", children: [mathLeaf("sin"), mathLeaf("asin")] },
          { type: "pair", children: [mathLeaf("cos"), mathLeaf("acos")] },
          { type: "pair", children: [mathLeaf("tan"), mathLeaf("atan")] },
          { type: "pair", children: [mathLeaf("cot"), mathLeaf("acot")] },
          { type: "pair", children: [mathLeaf("csc"), mathLeaf("sec")] },
          twoMathLeaf("atan2"),
          // HYPOTENUSE ships in the Geometry/Timesavers packs; the catalog builder inserts it here.
          { type: "pair", children: [mathLeaf("sinh"), mathLeaf("asinh")] },
          { type: "pair", children: [mathLeaf("cosh"), mathLeaf("acosh")] },
          { type: "pair", children: [mathLeaf("tanh"), mathLeaf("atanh")] },
          { type: "pair", children: [mathLeaf("coth"), mathLeaf("acoth")] },
          { type: "pair", children: [mathLeaf("csch"), mathLeaf("sech")] },
        ],
      },
      {
        type: "category", label: "Combinatorics", description: "Counting: factorials, combinations, permutations.",
        children: [
          { type: "pair", children: [combLeaf("fact"), combLeaf("factdouble")] },
          { type: "pair", children: [combLeaf("combin"), combLeaf("combina")] },
          { type: "pair", children: [combLeaf("permut"), combLeaf("permutationa")] },
          { type: "multinomial", label: "MULTINOMIAL", description: "Multinomial coefficient (n₁+n₂+…)! / (n₁!·n₂!·…). Excel: MULTINOMIAL.", create: () => new MultinomialNode() },
        ],
      },
      {
        type: "category", label: "Engineering", description: "DELTA, GESTEP, SERIESSUM, base conversion, and bitwise integer ops — Excel's Engineering set.",
        children: [
          { type: "pair", children: [twoMathLeaf("delta"), twoMathLeaf("gestep")] },
          { type: "seriessum", label: "SERIESSUM", description: "Power series sum Σ cᵢ·x^(n+i·m) using a list of coefficients. Excel: SERIESSUM.", create: () => new SeriesSumNode() },
          { type: "base-convert", label: "Base Convert", description: "Converts an integer between number bases (2–36), digits 0–9 only: a digit outside the source base, or a result needing letter digits, is null. Excel: BIN2DEC / DEC2BIN / OCT2DEC / DEC2OCT / BIN2OCT.", create: () => new BaseConvertNode(), parity: false },
          { type: "pair", children: [bitwiseLeaf("bitand"), bitwiseLeaf("bitor")] },
          { type: "pair", children: [bitwiseLeaf("bitxor"), bitwiseLeaf("bitlshift")] },
          bitwiseLeaf("bitrshift"),
          {
            type: "category", label: "Bessel", description: "Bessel and modified Bessel functions (J, Y, I, K), used in signal processing, heat transfer, and physics.",
            children: [
              { type: "pair", children: [besselLeaf("besselj"), besselLeaf("bessely")] },
              { type: "pair", children: [besselLeaf("besseli"), besselLeaf("besselk")] },
            ],
          },
        ],
      },
      {
        type: "category", label: "Complex Numbers", description: "Build complex numbers (a+bi), extract parts, and apply complex arithmetic and functions.",
        children: [
          { type: "cx-unpack", label: "IM Unpack",  description: "Extracts Real, Imaginary, |z|, and arg(z) from a complex number. Excel: IMREAL / IMAGINARY / IMABS / IMARGUMENT.", create: () => new ComplexUnpackNode(), parity: false },
          {
            type: "category", label: "Unary ops", description: "Functions that take one complex number and return a complex number.",
            children: [
              { type: "pair", children: [complexUnaryLeaf("conj"), complexUnaryLeaf("sqrt")] },
              { type: "pair", children: [complexUnaryLeaf("exp"),  complexUnaryLeaf("ln")]  },
              { type: "pair", children: [complexUnaryLeaf("log10"),complexUnaryLeaf("log2")] },
              { type: "pair", children: [complexUnaryLeaf("sin"),  complexUnaryLeaf("cos")]  },
              { type: "pair", children: [complexUnaryLeaf("tan"),  complexUnaryLeaf("cot")]  },
              { type: "pair", children: [complexUnaryLeaf("sec"),  complexUnaryLeaf("csc")]  },
              { type: "pair", children: [complexUnaryLeaf("sinh"), complexUnaryLeaf("cosh")] },
              { type: "pair", children: [complexUnaryLeaf("sech"), complexUnaryLeaf("csch")] },
            ],
          },
          {
            type: "category", label: "Binary ops", description: "Arithmetic on two complex numbers.",
            children: [
              { type: "pair", children: [complexBinaryLeaf("sum"),     complexBinaryLeaf("sub")]     },
              { type: "pair", children: [complexBinaryLeaf("product"), complexBinaryLeaf("div")]     },
              { type: "cx-power", label: "IMPOWER", description: "Complex number raised to a real power. Excel: IMPOWER.", create: () => new ComplexPowerNode(), parity: false },
              { type: "cx-quadratic", label: "Quadratic Roots", description: "Both roots of ax² + bx + c = 0 as complex numbers — a negative discriminant gives the conjugate pair. The Equation node covers the real-root case.", create: () => new QuadraticRootsNode(), parity: false, keywords: "quadratic formula discriminant complex roots polynomial" },
              { type: "cx-polyroots", label: "Polynomial Roots", description: "Every root of a polynomial from its coefficient list (highest degree first), complex pairs included, with the real roots alone as a second output. numpy.roots, R polyroot.", create: () => new PolyRootsNode(), parity: false, keywords: "polynomial roots polyroot np.roots zeros solve cubic quartic complex factor" },
            ],
          },
        ],
      },
    ],
  },

  // ── LISTS ────────────────────────────────────────────────────────────────────
  {
    type: "category", label: "Lists", description: "Build, reshape, search, and aggregate ordered collections of numbers.",
    children: [
      {
        type: "category", label: "Build", description: "Create lists.",
        children: [
          seriesLeaf("range", { accent: NODE_KIND_ACCENTS.list }),
          seriesLeaf("linspace"),
          { type: "list-concat",   label: "Concat Lists", description: "Joins lists end-to-end, in row order — add rows for more lists. A lone value counts as a 1-element list. Any element type. To stack lists as rows of a table instead, use VSTACK.", create: () => new ConcatListsNode(), keywords: "append join combine concatenate push" },
          seriesLeaf("repeat"),
          { type: "pair", children: [
            seriesLeaf("geometric"),
            seriesLeaf("fibonacci"),
          ]},
          { type: "list-randarray", label: "RANDARRAY", description: "List of N random numbers between Min and Max. Excel: RANDARRAY.", create: () => new RandArrayNode(), parity: false },
          { type: "list-combinations", label: "Combinations", description: "Every way to choose k items from the list — one row each, as combinations (order-independent) or permutations. Python itertools.", create: () => new CombinationsNode(), parity: false, keywords: "combinations permutations itertools choose subsets arrangements nCk nPk pairs tuples pick sample without replacement" },
          seriesLeaf("sequence", { parity: false }),
        ],
      },
      {
        type: "category", label: "Shape", description: "Reorder, trim, and filter lists.",
        children: [
          { type: "list-filter",  label: "List Filter", description: "Keeps list values passing condition rows (op + value, rows AND/OR; text ops ignore case, Match case per row); failures exit Dropped. 'No error' drops error cells. 'Has error' keeps only them. Any element type. For a TABLE's rows, use Frame Filter. Excel: FILTER.", accent: NODE_KIND_ACCENTS.list, create: () => new FilterNode(), keywords: "keep where condition predicate drop errors iserror noterror div0 remove errors clean" },
          { type: "list-fill",  label: "Coalesce / Fill", description: "Handles missing (null) cells: constant, forward/back-fill, mean/median/mode, interpolate, drop, or coalesce lists in priority order (first present wins, like SQL COALESCE). Errors pass through. Stats use present values only. Pairs with ISNULL.", accent: NODE_KIND_ACCENTS.list, create: () => new FillNode() },
          { type: "pair", children: [
            { type: "list-sort",    label: "List Sort", description: "Sorts a list ascending or descending — by its own values, or by a parallel key list when you wire one (sort names by their scores). Excel: SORT / SORTBY.", create: () => new SortNode() },
            { type: "list-reverse", label: "REVERSE", description: "Reverses the order of the list", create: () => new ReverseNode() },
          ]},
          { type: "pair", children: [
            { type: "list-slice", label: "SLICE",  description: "Sublist from Start to End, 1-based inclusive. Leave End blank to run to the end.", create: () => new SliceNode() },
            { type: "list-pad",   label: "Pad", description: "Extends a list to a target length by prepending or appending a fill value. Excel: PADLEFT / PADRIGHT.", create: () => new PadNode() },
          ]},
          { type: "pair", children: [
            { type: "list-take",  label: "TAKE",   description: "Keeps the first or last N elements. Excel: TAKE.", create: () => new ListTakeDropNode({ op: "take" }) },
            { type: "list-drop",  label: "DROP",   description: "Removes the first or last N elements. Excel: DROP.", create: () => new ListTakeDropNode({ op: "drop" }) },
          ]},
          { type: "list-unique",  label: "UNIQUE", description: "Removes duplicates, preserving first-occurrence order. Excel: UNIQUE.", create: () => new UniqueNode() },
          { type: "pair", children: [
            { type: "list-set",  label: "Set", description: "Set operations on two lists: union keeps what's in A or B, intersection what's in both, difference what's in A but not B, and symmetric difference what's in exactly one. Excel has no direct equivalent.", create: () => new SetOpNode(), parity: false, keywords: "set union intersect intersection difference except minus complement symmetric in A not in B compare two lists distinct dedupe subtract exclude common overlap" },
            { type: "list-set-relation", label: "Set relation", description: "Tests two lists as sets and gives TRUE or FALSE: equal means the same set, subset means every A is in B, superset means A contains all of B, and disjoint means no overlap. Excel builds these from COUNTIF.", create: () => new SetRelationNode(), parity: false, keywords: "set relation equal same identical subset superset disjoint overlap contains all within compare two lists membership issubset issuperset predicate test boolean" },
          ]},
          { type: "pair", children: [
            { type: "list-shuffle",    label: "Shuffle",    description: "Randomly reorder the list with a Fisher-Yates shuffle.", create: () => new ShuffleNode() },
            { type: "list-interleave", label: "Interleave", description: "Alternate elements of two lists: A[0], B[0], A[1], B[1], …", create: () => new InterleaveNode() },
          ]},
          { type: "list-nthelement", label: "Nth Element", description: "Every N-th element. Step subsampling.", create: () => new NthElementNode() },
        ],
      },
      {
        type: "category", label: "Transform", description: "Element-wise transforms: differences, rolling aggregates, rescaling, binning, shifting.",
        children: [
          { type: "pair", children: [
            { type: "list-diff",       label: "DIFF",       description: "Change between consecutive values: absolute difference (Δ, numpy diff), percent change (pandas pct_change), or the central-difference gradient (∇, numpy gradient — same length). Pick on the node.", create: () => new DiffNode(), keywords: "difference diff delta change percent pct_change growth rate return consecutive derivative gradient slope numpy" },
            { type: "list-running", label: "Running", description: "One aggregate per element over a window: SUM / AVERAGE / MIN / MAX / MEDIAN / PRODUCT / STDEV of everything so far (the running total) or of the last N (the moving average).", create: () => new RunningNode(), keywords: "running total cumulative rolling moving average sliding window prefix sum accumulate expanding cumsum min max median product stdev" },
          ]},
          { type: "pair", children: [
            { type: "list-normalize",  label: "Normalize",  description: "Rescale a list: to the 0–1 range (min→0, max→1), or to z-scores (distance from the mean in stdevs). Pick on the node. numpy/R scale.", create: () => new NormalizeNode(), keywords: "normalize rescale scale 0-1 minmax z-score zscore standardize mean stdev standard deviation feature scaling" },
            { type: "list-bin",       label: "Bin",           description: "Places each value into a bin: by wired breakpoints (0 below the first — R findInterval / numpy digitize) or into n equal-count quantile buckets 1..n (dplyr ntile / pandas qcut). Pick on the node.", create: () => new BinNode(), parity: false, keywords: "bin cut findinterval digitize bucket histogram interval discretize quantile ntile qcut quartile decile percentile" },
          ]},
          { type: "list-outliers",  label: "Outliers",      description: "Flags the outliers in a list by the z-score, IQR (boxplot whisker) or MAD (modified z) rule, as a frame with the cleaned Value (outliers blanked) and a logical Outlier column. scipy zscore, R boxplot.stats.", create: () => new OutliersNode(), parity: false, keywords: "outlier anomaly zscore z-score iqr mad boxplot whisker robust clean remove extreme" },
          { type: "list-smooth", label: "Smooth", description: "Smooths a series: Savitzky–Golay (polynomial window), LOWESS (robust local regression) or Gaussian — pick on the card. scipy savgol_filter / gaussian_filter1d, statsmodels lowess, R loess.", create: () => new SmoothNode(), parity: false, keywords: "savitzky–golay smooth smoothing savgol savitzky golay lowess loess gaussian filter denoise noise trend signal" },
          { type: "list-peaks", label: "Find Peaks", description: "The local maxima as a frame with Position and Height columns, filtered by minimum height, spacing and prominence. scipy.signal.find_peaks, R pracma::findpeaks.", create: () => new FindPeaksNode(), parity: false, keywords: "peaks find_peaks local maxima maximum prominence spikes signal detect" },
          { type: "pair", children: [
            { type: "list-shift",     label: "Shift",         description: "Slides the list by N places (negative = earlier); vacated slots go blank, or wrap around. pandas shift / numpy roll.", create: () => new ShiftNode(), parity: false, keywords: "shift lag lead roll offset displace slide delay pandas numpy" },
            { type: "list-ewma",      label: "EWMA",          description: "Exponentially weighted moving average: recent values weigh more, controlled by Alpha (0–1). Smoother than a flat window. pandas ewm.", create: () => new EwmaNode(), parity: false, keywords: "ewma exponential weighted moving average smoothing ema alpha decay pandas ewm smooth" },
          ]},
          { type: "pair", children: [
            { type: "list-convolve",  label: "Convolve",      description: "Sliding dot-product of two lists (full convolution): smoothing kernels, moving sums, signal filtering. numpy.convolve.", create: () => new ConvolveNode(), parity: false, keywords: "convolve convolution kernel filter signal smooth moving weighted numpy fir" },
            { type: "list-rle",       label: "Run Lengths",   description: "Compresses consecutive equal values into rows of value and run-length. R rle / run-length encoding.", create: () => new RleNode(), parity: false, keywords: "rle run length encoding compress consecutive runs streak count repeats groups" },
          ]},
          { type: "list-trapz",     label: "Integrate",     description: "Area under the curve through the points by the trapezoidal rule, at uniform spacing dx. The integral counterpart to DIFF's gradient. numpy.trapz.", create: () => new TrapzNode(), parity: false, keywords: "integrate integral trapz trapezoidal area under curve auc cumulative numpy calculus" },
            { type: "list-spectrum", label: "Spectrum (FFT)", description: "The frequency content of a signal: one row per bin with frequency (in the sample-rate's units), magnitude (a pure sine of amplitude A reads A) and phase. Any length — Bluestein's FFT. numpy.fft.rfft, R fft, MATLAB fft.", create: () => new SpectrumNode(), parity: false, keywords: "fft fourier spectrum frequency dft periodogram harmonics signal vibration rfft" },
        ],
      },
      {
        type: "category", label: "Find", description: "Look up values and positions.",
        children: [
          { type: "pair", children: [
            { type: "lookup-xlookup", label: "XLOOKUP", description: "Looks a value up in one Frame (or Cube) column and returns the matching cell from another; a list of lookup values returns one match each. Return = * gives the whole row. A Cube's matched cell comes out whole — drill in with INDEX. Exact match by default; ≤/≥ falls back to the closest smaller/larger number or date; First/Last picks which duplicate wins; If-not-found, else #N/A. Two aligned lists: Build Frame first. Excel: XLOOKUP or VLOOKUP.", accent: NODE_KIND_ACCENTS.frame, keywords: "xlookup vlookup hlookup lookup frame cube table list match find nested column", create: () => new XLookupNode() },
            { type: "lookup-xmatch",  label: "XMATCH",  description: "1-based position with match mode selector (exact / next larger / next smaller); a list of lookup values returns one position each. Supersedes the classic MATCH. Excel 365: XMATCH.", create: () => new XMatchNode() },
          ]},
          { type: "pair", children: [
            { type: "list-length", label: "LENGTH",  description: "Number of elements in the list. Excel: COUNT / ROWS.", create: () => new ListLengthNode() },
            { type: "list-index",  label: "INDEX",   description: "Reads a cell out of any container: the nth of a list, (Row, Column) of a Matrix, the cell of a Frame or Cube. Leaving Row or Column empty (or 0) selects the whole column or row. A nested Frame or Cube cell comes out whole — how data comes back out of a Cube. Excel: INDEX(range, row, col).", create: () => new ListIndexNode(), keywords: "cube frame cell nested drill get cell unnest slice whole row column" },
          ]},
          { type: "pair", children: [argLeaf("argmax"), argLeaf("argmin")] },
          { type: "pair", children: [argLeaf("argsort"), argLeaf("which")] },
          { type: "list-contains", label: "CONTAINS", description: "TRUE if the list contains the value — any element type, keyed by value. Excel: ISNUMBER(MATCH(value,range,0)).", create: () => new ContainsNode() },
        ],
      },
      { type: "list-groupby", label: "Group Lists", description: "Groups a parallel key-value pair of lists and aggregates each group, out as a frame with Key and Value columns. For a whole table use the frame Group By. Excel 365: GROUPBY, simplified 1D.", create: () => new GroupByNode(), parity: false },
      {
        type: "category", label: "Aggregate", description: "Reduce a list to a single number.",
        children: [
          spLeaf("sumproduct"),
          { type: "pair", children: [reduceLeaf("sum"), reduceLeaf("product")] },
          { type: "pair", children: [reduceLeaf("avg"), reduceLeaf("median")] },
          { type: "pair", children: [reduceLeaf("min"), reduceLeaf("max")] },
          { type: "pair", children: [reduceLeaf("count"), reduceLeaf("countdistinct")] },
          reduceLeaf("countblank"),
          { type: "pair", children: [reduceLeaf("geomean"), reduceLeaf("harmean")] },
          { type: "pair", children: [weightedLeaf("wavg"), weightedLeaf("wstdev")] },
          weightedLeaf("wvar"),
          {
            type: "category", label: "Spread & Shape", description: "Dispersion and distribution shape: standard deviation, variance, skew, kurtosis.",
            children: [
              { type: "pair", children: [reduceLeaf("stdev"), reduceLeaf("stdev_p")] },
              { type: "pair", children: [reduceLeaf("var_s"), reduceLeaf("var_p")] },
              { type: "pair", children: [reduceLeaf("sumsq"), reduceLeaf("devsq")] },
              reduceLeaf("avedev"),
              { type: "pair", children: [reduceLeaf("skew"), reduceLeaf("skew_p")] },
              reduceLeaf("kurt"),
              { type: "pair", children: [reduceLeaf("ptp"), reduceLeaf("iqr")] },
              { type: "pair", children: [reduceLeaf("mad"), reduceLeaf("sem")] },
              { type: "pair", children: [reduceLeaf("cv"), reduceLeaf("rms")] },
            ],
          },
          {
            type: "category", label: "Correlation", description: "Two parallel lists: correlation, covariance, the Fisher transform, and paired-list sums.",
            children: [
              correlLeaf("correl"),
              { type: "pair", children: [correlLeaf("spearman"), correlLeaf("kendall")] },
              { type: "pair", children: [covLeaf("pop"), covLeaf("samp")] },
              { type: "pair", children: [fisherLeaf("fisher"), fisherLeaf("fisherinv")] },
              spLeaf("sumx2my2"),
              { type: "pair", children: [spLeaf("sumx2py2"), spLeaf("sumxmy2")] },
            ],
          },
        ],
      },
      {
        type: "category", label: "Rank", description: "Rank, percentile, and distribution queries.",
        children: [
          { type: "pair", children: [rpLeaf("large"), rpLeaf("small")] },
          rpLeaf("percentile-inc", { label: "PERCENTILE", description: "Value at percentile p (0–1). Excel: PERCENTILE.INC." }),
          rpLeaf("quartile-inc", { label: "QUARTILE", description: "Quartile Q0–Q4. Excel: QUARTILE.INC." }),
          rpLeaf("percentrank-inc", { label: "PERCENTRANK", description: "Percentile rank of a value (0–1). Excel: PERCENTRANK.INC." }),
          { type: "pair", children: [rpLeaf("rank-eq"), rpLeaf("rank-avg")] },
        ],
      },
      {
        type: "category", label: "Regression", description: "Fit or interpolate: predict y from known data and measure the fit.",
        children: [
          { type: "linest",  label: "LINEST",  description: "Linear regression: three separate outputs (slope, intercept, and R²), wired individually. Excel: LINEST. Supersedes SLOPE, INTERCEPT, RSQ.", create: () => new LinestNode(), parity: false },
          { type: "forecast", label: "FORECAST.LINEAR", description: "Predict Y for one X or a list of them from known data — a straight line (FORECAST.LINEAR / TREND) or a growth curve y = b·mˣ (GROWTH). Pick on the card.", create: () => new ForecastNode(), parity: false, keywords: "forecast trend growth predict linear exponential regression fit extrapolate" },
          regressionLeaf("steyx"),
          { type: "logest",  label: "LOGEST",  description: "Exponential regression: [m, b] where y = b·mˣ. Requires all Ys > 0. Excel: LOGEST.", create: () => new LogestNode(), parity: false },
          { type: "polyfit", label: "Poly Fit", description: "Least-squares polynomial fit of the chosen degree, evaluated back over the data — degree 1 is a line, 2 a parabola, and so on. numpy.polyfit + polyval.", create: () => new PolyfitNode(), parity: false, keywords: "polynomial fit polyfit polyval regression curve degree quadratic cubic least squares numpy trendline" },
          { type: "ets-forecast", label: "Forecast (ETS)", description: "Holt–Winters exponential smoothing (additive level, trend and season): a forecast N steps ahead with a growing 95% band, season length detected or set. statsmodels ExponentialSmoothing, R HoltWinters / forecast::ets; Excel: FORECAST.ETS / .CONFINT / .SEASONALITY (same model, Microsoft's own parameter search — close, not identical).", create: () => new EtsForecastNode(), parity: false, keywords: "forecast ets exponential smoothing holt winters seasonal time series predict trend season confint seasonality" },
          { type: "decompose", label: "Decompose", description: "Splits a seasonal series into trend, a repeating seasonal pattern and the residual — additive, multiplicative, or STL (loess). statsmodels seasonal_decompose, R decompose / stl.", create: () => new DecomposeNode(), parity: false, keywords: "decompose decomposition seasonal trend residual seasonality time series stl loess classical moving average deseasonalize" },
          { type: "ode-integrate", label: "ODE Integrate", description: "Integrates dy/dt = f(t, y) with classic fixed-step RK4, from t0 to t1 in a set number of steps. Give the derivative as a lambda of t and y. Outputs one frame with t and y columns. scipy solve_ivp, R deSolve.", create: () => new OdeIntegrateNode(), parity: false, keywords: "ode integrate rk4 solve_ivp deSolve differential equation euler runge kutta initial value lambda" },
          { type: "interpolate", label: "INTERPOLATE", description: "Interpolates between known points (not a regression fit). List mode: 1-D, y for a query x. Grid mode: 2-D bilinear over a table of heights, with optional Xs and Ys (unwired axes count 1, 2, 3…); Forecast (default on) extrapolates beyond the range. For lookup tables: hardness conversions, pump curves, steam tables.", create: () => new InterpolateNode(), parity: false },
        ],
      },
      {
        type: "category", label: "Tests", description: "Hypothesis tests. Each returns a p-value.",
        children: [
          testLeaf("z", { parity: false }),
          { type: "pair", children: [testLeaf("t-paired", { parity: false }), testLeaf("t-equal", { parity: false })] },
          testLeaf("t-welch"),
          { type: "pair", children: [testLeaf("f"), testLeaf("chisq")] },
          { type: "pair", children: [testLeaf("anova", { parity: false, keywords: "anova f_oneway aov one-way groups means" }), testLeaf("kruskal", { parity: false, keywords: "kruskal wallis nonparametric anova ranks" })] },
          { type: "pair", children: [testLeaf("mannwhitney", { parity: false, keywords: "mann whitney wilcoxon rank sum nonparametric u test" }), testLeaf("wilcoxon", { parity: false, keywords: "wilcoxon signed rank paired nonparametric" })] },
          { type: "pair", children: [testLeaf("fisher", { parity: false, keywords: "fisher exact 2x2 contingency small sample" }), testLeaf("ks", { parity: false, keywords: "kolmogorov smirnov ks distribution two sample" })] },
          { type: "pair", children: [testLeaf("proptest", { parity: false, keywords: "proportion z test rates conversion a/b ab test" }), testLeaf("binomtest", { parity: false, keywords: "binomial exact test successes trials" })] },
        ],
      },
      {
        type: "category", label: "Stats", description: "Distribution summaries and frequency analysis.",
        children: [
          { type: "mode",      label: "MODE",      description: "Most frequent value — a single number, or a list of all of them on a tie (no arbitrary tie-break). One node superseding Excel's MODE.SNGL (picks one on a tie) and MODE.MULT (always an array).", create: () => new ModeNode() },
          { type: "trimmean", label: "TRIMMEAN",  description: "Average after removing the top and bottom p/2 fraction of values. Excel: TRIMMEAN(list, percent).", create: () => new TrimMeanNode() },
          { type: "frequency", label: "FREQUENCY", description: "Counts values falling into each bin interval. The result has bins+1 elements. Excel: FREQUENCY.", create: () => new FrequencyNode() },
          { type: "pair", children: [
            { type: "confidence-norm", label: "CONFIDENCE.NORM", description: "Normal-distribution confidence interval half-width. Excel: CONFIDENCE.NORM.", create: () => new ConfidenceNode({ op: "norm" }) },
            { type: "confidence-t",    label: "CONFIDENCE.T",    description: "t-distribution confidence interval half-width. Excel: CONFIDENCE.T.", create: () => new ConfidenceNode({ op: "t" }) },
          ]},
          { type: "prob", label: "PROB", description: "Sum of probabilities for values in a range [lo, hi]. Excel: PROB(range, prob_range, lower_limit, upper_limit).", create: () => new ProbNode() },
        ],
      },
    ],
  },

  // ── LOGIC ────────────────────────────────────────────────────────────────────
  {
    type: "category", label: "Logic", description: "Decisions, comparisons, boolean operations, and fallback handling.",
    children: [
      { type: "if", label: "IF", description: "If Condition is true → Value if true, else → Value if false. Excel: IF(A,B,C).", create: () => new IfNode(), accent: NODE_KIND_ACCENTS.logic },
      { type: "choose",  label: "CHOOSE",        description: "Returns one of several values by a 1-based index. Add as many values as you need. Excel: CHOOSE(index, val1, val2, …).", create: () => new ChooseNode() },
      { type: "switch",  label: "SWITCH",         description: "Matches a value against as many cases as you add and returns the matching result, or a default. Excel: SWITCH.", create: () => new SwitchNode() },
      { type: "ifs",     label: "IFS",            description: "Returns the first value whose condition is non-zero, like chained IF. Add as many condition/value pairs as you need, plus an Otherwise fallback. Excel: IFS.", create: () => new IfsNode() },
      { type: "iferror", label: "IFERROR / IFNA", description: "Returns Fallback when Value is an error (IFNA: only #N/A). A blank is not an error and passes through. Excel: IFERROR or IFNA.", create: () => new IFErrorNode() },
      { type: "is-test", label: "IS.TEST",    description: "Tests whether a value is a number, blank, error, N/A, boolean, text, or non-text. Excel: ISNUMBER / ISBLANK / ISERROR / ISNA / ISLOGICAL / ISTEXT / ISNONTEXT.", create: () => new IsTestNode() },
      { type: "iseven-isodd", label: "ISEVEN / ISODD", description: "TRUE if a number's integer part is even or odd. Pick which in the node. Emits a logical and broadcasts over a list. Excel: ISEVEN / ISODD.", create: () => new IsEvenOddNode() },
      { type: "comparison", label: "Comparison",  description: "Compares two values (=, ≠, <, >, ≤, ≥) and emits a logical TRUE or FALSE. Broadcasts over a list.", keywords: "compare", create: () => new ComparisonNode() },
      { type: "pair", children: [
        { type: "between", label: "Between", description: "TRUE when Low ≤ Value ≤ High (inclusive). R between / pandas Series.between.", create: () => new BetweenNode(), parity: false, keywords: "between range within inclusive bounds interval clamp test low high" },
        { type: "isclose", label: "Is Close", description: "TRUE when |A − B| ≤ tolerance — approximate equality for floats. math.isclose / numpy.isclose.", create: () => new IsCloseNode(), parity: false, keywords: "is close approximately equal tolerance almost float rounding epsilon isclose numpy" },
      ]},
      {
        type: "category", label: "Boolean", description: "Combine 0/1 signals. Any non-zero input counts as true.",
        children: [
          { type: "pair", children: [booleanLeaf("and"), booleanLeaf("or")] },
          { type: "not", label: "NOT", description: "Flips a single input: true → FALSE, false → TRUE. Broadcasts over a list. Excel: NOT(A).", create: () => new NotNode() },
          { type: "pair", children: [booleanLeaf("xor"), booleanLeaf("xnor")] },
          { type: "pair", children: [booleanLeaf("nand"), booleanLeaf("nor")] },
        ],
      },
    ],
  },

  // ── FINANCE ──────────────────────────────────────────────────────────────────
  {
    type: "category", label: "Finance", description: "Interest rate, TVM, depreciation, and cash-flow calculations.",
    children: [
      {
        type: "category", label: "Time value of money", description: "The annuity and compound-growth relations as acausal Equation nodes.",
        children: [
          { type: "tvm", label: "Time Value of Money", description: "The loan and annuity family as one relation over rate, nper, pmt, pv, fv. Any four wired and the fifth solves. All five → Check answers TRUE or FALSE. Payment timing (Excel's type argument) is the dropdown. Excel: PMT, PV, FV, NPER, RATE.", create: () => new TvmNode(), keywords: "pmt pv fv nper rate loan annuity payment mortgage present future value" },
          { type: "amortization", label: "Amortization Schedule", description: "The loan table Excel users build by hand: one row per period with Payment, Interest, Principal and the remaining Balance (Excel's PMT / IPMT / PPMT laid out; R amort.table, numpy_financial). Rate is per period; payment timing is the dropdown.", create: () => new AmortizationNode(), parity: false, keywords: "amortization amortisation schedule loan mortgage table payment interest principal balance ipmt ppmt pmt" },
          { type: "returns", label: "Returns", description: "The return-series one-liners: log / simple returns, cumulative return, drawdown and max drawdown, CAGR, annualized volatility, Sharpe and Sortino — pick on the card. pandas pct_change / cumprod, PerformanceAnalytics, quantmod.", create: () => new ReturnsNode(), parity: false, keywords: "log returns returns log return pct_change cumulative drawdown max drawdown cagr volatility sharpe sortino risk-free annualize annualise quant performance portfolio price series" },
          { type: "fin-compound-growth", label: "Compound Growth", description: "Lump-sum growth fv = pv·(1+rate)^nper — wire three, the fourth solves. Excel: FV or PV (pmt-less), PDURATION (solve nper), RRI (solve rate).", create: () => new EquationNode({ label: "Compound Growth", expr: "fv = pv * (1 + rate)^nper", locked: true }), keywords: "pduration rri compound interest growth doubling lump sum" },
        ],
      },
      {
        type: "category", label: "Rate conversion", description: "Convert between nominal and effective interest rates.",
        children: [
          { type: "fin-effective-rate", label: "Effective Rate", description: "APR ↔ APY: eff = (1 + nom/npery)^npery − 1. Two of nominal rate, effective rate, and compounds-per-year. The third solves. Excel: EFFECT, NOMINAL.", create: () => new EquationNode({ label: "Effective Rate", expr: "eff = (1 + nom/npery)^npery - 1", locked: true }), keywords: "effect nominal apr apy compounding annual percentage yield" },
        ],
      },
      {
        type: "category", label: "Periodic payment breakdown", description: "Interest vs. principal split for a single period.",
        children: [
          { type: "pair", children: [ipmtPpmtLeaf("ipmt"), ipmtPpmtLeaf("ppmt")] },
          { type: "pair", children: [cumPmtLeaf("cumipmt"), cumPmtLeaf("cumprinc")] },
        ],
      },
      {
        type: "category", label: "Cash flow analysis", description: "NPV, IRR, MIRR for irregular cash flows.",
        children: [
          { type: "npv",  label: "NPV",  description: "Net present value of cash flows discounted at a given rate. The first flow is period 1. Excel: NPV(rate, values).", create: () => new NpvNode() },
          { type: "irr",  label: "IRR",  description: "Internal rate of return: the rate at which NPV = 0. Excel: IRR(values).", create: () => new IrrNode() },
          { type: "mirr", label: "MIRR", description: "Modified IRR accounting for reinvestment rate and cost of capital. Excel: MIRR(values, finance_rate, reinvest_rate).", create: () => new MirrNode() },
          { type: "xirr", label: "XIRR", description: "IRR for cash flows at irregular dates, from a list of flows and a parallel list of dates. Excel: XIRR.", create: () => new IrrNode({ mode: "dates" }), parity: false },
          { type: "xnpv", label: "XNPV", description: "Net present value of cash flows, each with an explicit date. Excel: XNPV.", create: () => new NpvNode({ mode: "dates" }), parity: false },
        ],
      },
      {
        type: "category", label: "Bond pricing", description: "Price and yield for coupon bonds.",
        children: [
          { type: "pair", children: [bondPriceLeaf("price"), bondPriceLeaf("yield")] },
          { type: "pair", children: [oddCouponLeaf("oddfprice"), oddCouponLeaf("oddfyield")] },
          { type: "pair", children: [oddCouponLeaf("oddlprice"), oddCouponLeaf("oddlyield")] },
        ],
      },
      {
        type: "category", label: "Depreciation", description: "Depreciate an asset over its useful life.",
        children: [
          { type: "pair", children: [deprLeaf("sln"), deprLeaf("syd")] },
          { type: "pair", children: [deprLeaf("ddb"), deprLeaf("db")] },
          { type: "vdb", label: "VDB", description: DEPRECIATION_OP_META.vdb.description, create: () => new DepreciationNode({ op: "vdb" }) },
        ],
      },
      {
        type: "category", label: "Other", description: "Miscellaneous financial functions.",
        children: [
          { type: "fvschedule", label: "FVSCHEDULE", description: "Future value of principal after applying a schedule of interest rates. Excel: FVSCHEDULE.", create: () => new FvScheduleNode() },
          { type: "ispmt",      label: "ISPMT",      description: "Interest paid in a specific period of a straight-line-principal loan. Excel: ISPMT.", create: () => new IspmtNode() },
          { type: "pair", children: [dollarLeaf("dollarde"), dollarLeaf("dollarfr")] },
          { type: "pair", children: [tbillLeaf("tbilleq"), tbillLeaf("tbillprice")] },
          tbillLeaf("tbillyield"),
          { type: "pair", children: [secDiscLeaf("disc"), secDiscLeaf("intrate")] },
          secDiscLeaf("received"),
          { type: "pair", children: [
            { type: "accrint",  label: "ACCRINT",  description: "Accrued interest for a security that pays periodic interest. Excel: ACCRINT.",  create: () => new AccrintNode(),  parity: false },
            { type: "accrintm", label: "ACCRINTM", description: "Accrued interest for a security that pays interest at maturity. Excel: ACCRINTM.", create: () => new AccrintMNode(), parity: false },
          ]},
          { type: "pair", children: [priceDiscLeaf("pricedisc"), priceDiscLeaf("yielddisc")] },
          { type: "pair", children: [priceMatLeaf("pricemat"),  priceMatLeaf("yieldmat")]  },
          { type: "pair", children: [durationLeaf("duration"),  durationLeaf("mduration")] },
          // XNPV lives in Cash flow analysis beside XIRR, not here.
          {
            type: "category", label: "Coupon dates", description: "Coupon period day counts and dates for bond calculations.",
            children: [
              { type: "pair", children: [couponLeaf("coupdaybs"), couponLeaf("coupdays")] },
              { type: "pair", children: [couponLeaf("coupdaysnc"), couponLeaf("coupnum")] },
              { type: "pair", children: [couponLeaf("coupncd"), couponLeaf("couppcd")] },
            ],
          },
        ],
      },
    ],
  },

  // ── DISTRIBUTIONS ────────────────────────────────────────────────────────────
  {
    type: "category", label: "Distributions", description: "Probability distributions and related helpers.",
    children: [
      { type: "distribution", label: "Distribution", description: "Every probability distribution in one node: pick the distribution (normal, t, chi-squared, F, beta, gamma, lognormal, Weibull, exponential, binomial, Poisson, hypergeometric, negative binomial), then the form: CDF, PDF or PMF, a tail, or the inverse (quantile). The inverse trades the x input for a probability. Excel: the NORM.DIST / T.INV / BINOM.DIST families.", create: () => new DistributionNode(), keywords: "distribution probability cdf pdf pmf inverse quantile percentile critical value tail gaussian bell curve critbinom" },
      { type: "fit-distribution", label: "Fit Distribution", description: "Which distribution fits a sample? Fits Normal, Lognormal, Exponential, Gamma, Weibull, Uniform, Beta and Poisson by maximum likelihood (moments where standard), ranks them by AIC with the KS distance, and hands the winner's parameters back in the Distribution node's own order. scipy.stats.<dist>.fit, R fitdistrplus, @RISK / Crystal Ball fit.", create: () => new FitDistributionNode(), parity: false, keywords: "fit distribution fitdist fitdistr mle maximum likelihood aic goodness of fit ks which distribution normal lognormal gamma weibull exponential beta poisson @risk crystal ball" },
      { type: "pair", children: [
        mathLeaf("phi",   { keywords: "probability standard normal density" }),
        mathLeaf("gauss", { keywords: "probability standard normal" }),
      ]},
      { type: "pair", children: [
        { type: "stat-standardize", label: "STANDARDIZE", description: "z-score: (value − mean) ÷ std dev. Excel: STANDARDIZE.", create: () => new StandardizeNode(), keywords: "probability z score normalize" },
        { type: "binomdistrng", label: "Binomial Range", description: "P(lo ≤ X ≤ hi): the sum of binomial PMFs over a range. Excel: BINOM.DIST.RANGE.", create: () => new BinomDistRangeNode(), keywords: "binom.dist.range" },
      ]},
    ],
  },

  // ── DATE & TIME ───────────────────────────────────────────────────────────────
  {
    type: "category", label: "Date & Time", description: "Date serial type (like Excel): sources, extract parts, arithmetic, and working-day calculations.",
    children: [
      { type: "date-construct", label: "DATE (Build)", description: "Builds a date from Year, Month, Day. Handles overflow, so month 13 → Jan next year. Excel: DATE.", create: () => new DateConstructNode(), parity: false, accent: DT },
      { type: "pair", children: [todayNowLeaf("today"), todayNowLeaf("now")] },
      { type: "save-times",    label: "Save Times",  description: "When this document was last autosaved and when it was last written to a file, as two date values.", create: () => new SaveTimesNode(), parity: false, keywords: "save autosave saved timestamp version document file written when last clock" },
      { type: "date-time",     label: "TIME",      description: "Builds a time fraction 0–1 from Hour, Minute, Second. Add it to a date serial for date+time. Excel: TIME.", create: () => new TimeConstructNode(), parity: false },
      {
        type: "category", label: "Parse", description: "Convert text strings to date or time values, and Unix time both ways.",
        children: [
          { type: "pair", children: [dateTimeValueLeaf("date"), dateTimeValueLeaf("time")] },
          { type: "pair", children: [
            { type: "date-epoch-from", label: "Epoch → Date", description: "Unix time (seconds or milliseconds since 1970-01-01 UTC) → a date. pandas to_datetime(unit=), R as.POSIXct(origin=). Excel: n/86400 + 25569.", create: () => new EpochNode({ op: "from" }), parity: false, keywords: "epoch unix timestamp posix seconds milliseconds 1970 utc to_datetime" },
            { type: "date-epoch-to",   label: "Date → Epoch", description: "A date → Unix time in seconds or milliseconds. pandas astype(int64), R as.numeric(). Excel: (date − 25569)·86400.", create: () => new EpochNode({ op: "to" }), parity: false, keywords: "epoch unix timestamp posix seconds milliseconds 1970 utc" },
          ]},
        ],
      },
      {
        type: "category", label: "Extract Part", description: "Pull year, month, day, hour, minute, or second from a date serial.",
        children: [
          { type: "pair", children: [datePartLeaf("year"), datePartLeaf("month")] },
          { type: "pair", children: [datePartLeaf("day"),  datePartLeaf("hour")] },
          { type: "pair", children: [datePartLeaf("minute"), datePartLeaf("second")] },
        ],
      },
      {
        type: "category", label: "Week", description: "Day-of-week and week-number calculations.",
        children: [
          weekInfoLeaf("weekday"),
          { type: "pair", children: [weekInfoLeaf("weeknum"), weekInfoLeaf("isoweeknum")] },
        ],
      },
      {
        type: "category", label: "Difference", description: "Count days, 360-day days, or year fraction between two dates.",
        children: [
          dateDiffLeaf("days"),
          { type: "pair", children: [dateDiffLeaf("days360"), dateDiffLeaf("yearfrac")] },
        ],
      },
      {
        type: "category", label: "Add Months", description: "Shift a date by N months, jump to end of month, or snap to the start of a period.",
        children: [
          { type: "pair", children: [dateAddLeaf("edate"), dateAddLeaf("eomonth")] },
          { type: "date-trunc", label: "Truncate Date", description: "Floor a date to the start of its day / week / month / quarter / year, or ceiling to the next. The period bucket for a Group By (resample). lubridate floor_date / ceiling_date, pandas to_period, SQL DATE_TRUNC. Excel: DATE(YEAR(d), MONTH(d), 1).", create: () => new DateTruncNode(), parity: false, keywords: "truncate floor ceiling date period month week quarter year resample bucket floor_date date_trunc to_period start of month" },
        ],
      },
      { type: "pair", children: [
        { type: "date-workday",     label: "WORKDAY",     description: WORKDAYS_OP_META.workday.description, keywords: "workdays", create: () => new WorkdaysNode({ op: "workday" }),         parity: false },
        { type: "date-networkdays", label: "NETWORKDAYS", description: WORKDAYS_OP_META.networkdays.description, keywords: "workdays", create: () => new WorkdaysNode({ op: "networkdays" }), parity: false },
      ]},
      { type: "date-datedif",     label: "DATEDIF",     description: "Difference between two dates as whole years, months, or days, or the remainder past larger units (months ignoring years, days ignoring months or years). Pick on the node. Excel: DATEDIF.", create: () => new DateDiffNode({ op: "years" }), parity: false },
    ],
  },

  // ── TEXT ─────────────────────────────────────────────────────────────────────
  {
    type: "category", label: "Text", description: "String type: inputs, manipulation, and conversion to and from numbers.",
    children: [
      { type: "text-dollar", label: "DOLLAR",  description: "Format a number as a currency string, for example \"$1,234.56\" or \"-$78.90\". Excel: DOLLAR.", create: () => new FormatDollarNode(), parity: false },
      { type: "text-numbervalue", label: "NUMBERVALUE", description: "Parses a number from a string with custom decimal and group separators, for example \"1.234,56\" with decimal=\",\" group=\".\". Excel: NUMBERVALUE.", create: () => new NumberValueNode(), parity: false },
      { type: "text-fixed", label: "FIXED",     description: "Format a number as a fixed-decimal string with optional thousands separators. Excel: FIXED.", create: () => new FixedNode(), parity: false },
      { type: "pair", children: [romanArabicLeaf("roman"), romanArabicLeaf("arabic")] },
      {
        type: "category", label: "Transform", description: "Case, whitespace, and character manipulation.",
        children: [
          { type: "pair", children: [textXformLeaf("upper"), textXformLeaf("lower")] },
          { type: "pair", children: [textXformLeaf("trim"),  textXformLeaf("proper")] },
          { type: "pair", children: [textXformLeaf("clean"), textXformLeaf("unaccent")] },
          textXformLeaf("slugify"),
          { type: "pair", children: [
            { type: "text-pad", label: "Pad Text", description: "Pads text to a width with a fill character — on the left, right, or both sides. Python ljust / rjust / center, R str_pad.", create: () => new PadTextNode(), parity: false, keywords: "pad padding ljust rjust center justify align width fill zero-pad str_pad fixed width column" },
            { type: "text-truncate", label: "Truncate Text", description: "Cuts text to a maximum width, ending in an ellipsis when anything was cut. R str_trunc, textwrap.shorten.", create: () => new TruncateTextNode(), parity: false, keywords: "truncate shorten ellipsis clip cut width max length abbreviate str_trunc" },
          ]},
          { type: "text-wrap", label: "Wrap Text", description: "Wraps text into a list of lines no wider than a set number of characters, breaking on spaces. R str_wrap, Python textwrap.wrap.", create: () => new WrapTextNode(), parity: false, keywords: "wrap wraptext str_wrap textwrap lines width fold" },
          { type: "text-filter", label: "Text Filter", description: "Keeps strings from a list that contain, start with, or end with a pattern. Ignores case, like every comparison here.", create: () => new TextFilterNode(), parity: false, keywords: "contains not contains starts with begins ends with pattern substring match keep strings" },
        ],
      },
      {
        type: "category", label: "Build & Slice", description: "Concatenate, split, and extract substrings.",
        children: [
          { type: "text-concat", label: "CONCAT",    description: "Joins up to 4 strings together (A + B + C + D). Excel: CONCAT.",                            accent: STR, create: () => new ConcatNode(),    parity: false },
          { type: "template", label: "Template", description: "Fills a text with named values: {name} inserts the input of that name, {total:0.00} formats it with an Excel TEXT code, {{ }} print braces. Every new name grows a socket; a list on any name spills a list. R str_glue / glue, Python f-strings and str.format. Excel: TEXT & \"…\" chains.", create: () => new TemplateNode(), parity: false, keywords: "template glue format f-string interpolate placeholder string.format sprintf mail merge message label" },
          { type: "text-join",   label: "TEXTJOIN",  description: "Joins a list of strings with a delimiter, optionally ignoring empty strings. Excel: TEXTJOIN.",             create: () => new TextJoinNode(),  parity: false },
          { type: "text-split",  label: "TEXTSPLIT", description: "Splits text at a delimiter into a list of strings. Excel: TEXTSPLIT.",                                      create: () => new TextSplitNode(), parity: false },
          { type: "pair", children: [textSliceLeaf("left"), textSliceLeaf("right")] },
          textSliceLeaf("mid"),
          { type: "text-rept",   label: "REPT",      description: "Repeats text N times. Excel: REPT.",                                                                        create: () => new ReptNode(),      parity: false },
        ],
      },
      {
        type: "category", label: "Search & Replace", description: "Find positions, replace substrings, extract around delimiters.",
        children: [
          { type: "pair", children: [textFindLeaf("find"), textFindLeaf("search")] },
          { type: "pair", children: [textAfterBeforeLeaf("after"), textAfterBeforeLeaf("before")] },
          { type: "text-substitute", label: "SUBSTITUTE",  description: "Replaces old_text with new_text: every occurrence, or only the nth when Instance is set. Excel: SUBSTITUTE.", create: () => new SubstituteNode(),   parity: true },
          { type: "text-replace",    label: "REPLACE",     description: "Replaces N characters starting at a position. Excel: REPLACE.",          create: () => new TextReplaceNode(), parity: false },
          { type: "regex",           label: "REGEX",       description: "Tests, extracts, or replaces text using a regular expression. Excel 365: REGEXTEST / REGEXEXTRACT / REGEXREPLACE.", keywords: "regextest", create: () => new RegexNode(), parity: false },
        ],
      },
      {
        type: "category", label: "Measure & Encode", description: "String length, comparison, and character encoding.",
        children: [
          { type: "text-len",   label: "LEN",   description: "Number of characters in the string. Excel: LEN.",                          create: () => new TextLenNode(), parity: false },
          { type: "text-exact", label: "EXACT", description: "1 if two strings are identical (case-sensitive), else 0. Excel: EXACT.", create: () => new ExactNode(),   parity: false },
          { type: "pair", children: [
            { type: "text-similarity", label: "Text Similarity", description: "How alike two strings are: Levenshtein ratio, Damerau ratio, Jaro–Winkler (0–1), or the raw edit distance. rapidfuzz, R stringdist / stringsim. Excel: the Fuzzy Lookup add-in.", create: () => new TextSimilarityNode(), parity: false, keywords: "similarity fuzzy levenshtein edit distance jaro winkler damerau stringdist rapidfuzz typo match" },
            { type: "fuzzy-match",     label: "Fuzzy Match",     description: "The closest candidate to a text (and its score) above a threshold — typo-tolerant matching of names, SKUs, cities before an exact XLOOKUP. rapidfuzz process.extractOne, R stringdist amatch, Excel's Fuzzy Lookup add-in.", create: () => new FuzzyMatchNode(), parity: false, keywords: "fuzzy match lookup approximate nearest string typo dedupe reconcile names extractOne amatch" },
          ]},
          { type: "pair", children: [charCodeLeaf("char"), charCodeLeaf("code")] },
          { type: "pair", children: [
            { type: "url-encode", label: "ENCODEURL", description: "Percent-encode a string for use in a URL. Spaces become %20. Excel: ENCODEURL.", create: () => new UrlEncodeNode({ op: "encode" }), parity: false },
            { type: "url-decode", label: "DECODEURL", description: "Decode a percent-encoded URL string; %20 becomes a space.", create: () => new UrlEncodeNode({ op: "decode" }), parity: false },
          ]},
          { type: "pair", children: [
            { type: "base64-encode", label: "ENCODEBASE64", description: "Base64 of the UTF-8 text, standard alphabet with padding. Python base64.b64encode, R base64enc.", create: () => new UrlEncodeNode({ op: "base64" }), parity: false, keywords: "base64 encode b64encode" },
            { type: "base64-decode", label: "DECODEBASE64", description: "Text back from base64; non-base64 input passes through unchanged.", create: () => new UrlEncodeNode({ op: "unbase64" }), parity: false, keywords: "base64 decode b64decode" },
          ]},
          { type: "pair", children: [
            { type: "hash", label: "Hash", description: "Digest of a text: SHA-256, SHA-1, MD5, CRC-32 or FNV-1a, as lowercase hex. Hash an ID column to join on it without carrying the raw key. Python hashlib / zlib.crc32, R digest.", create: () => new HashNode(), parity: false, keywords: "hash digest sha256 sha1 md5 crc32 fnv checksum anonymize anonymise pseudonymize fingerprint hashlib" },
            { type: "uuid", label: "UUID", description: "A random v4 UUID, new on every recalculation (F9). Python uuid.uuid4, R uuid::UUIDgenerate.", create: () => new UuidNode(), parity: false, keywords: "uuid guid unique id identifier random key uuid4" },
          ]},
        ],
      },
    ],
  },

  // ── TABLES & FRAMES ───────────────────────────────────────────────────────────
  {
    type: "category", label: "Tables & Frames", description: "2D data: numeric tables and matrix math, plus data frames with named columns, reshape, and selection.",
    children: [
      { type: "table-info",  label: "ROWS / COLUMNS", description: "Number of rows and number of columns in a table. Excel: ROWS / COLUMNS.", create: () => new TableInfoNode(), parity: false },
      {
        type: "category", label: "Matrix math", description: "Linear algebra: multiply, invert, determinant, identity.",
        children: [
          { type: "table-mult",      label: "MMULT",     description: "Matrix multiply: A (m×n) × B (n×p) → result (m×p). Excel: MMULT.",                                    create: () => new TableMultNode(),                   parity: false },
          { type: "pair", children: [matDetLeaf("mdeterm"), matDetLeaf("minverse")] },
          { type: "pair", children: [matDetLeaf("trace"), matDetLeaf("rank")] },
          matDetLeaf("norm"),
          { type: "mat-solve", label: "Solve A·x = b", description: "Solves a square linear system: the x with A·x = b (Gaussian elimination with pivoting). numpy.linalg.solve, R solve(A, b). In Excel: MMULT(MINVERSE(A), b).", create: () => new MatSolveNode(), parity: false, keywords: "solve linear system equations gaussian elimination ax=b simultaneous" },
          { type: "mat-eigen", label: "Eigen (symmetric)", description: "Eigenvalues (largest first) and unit eigenvectors (as columns) of a symmetric matrix — a covariance or correlation matrix for PCA, a Laplacian. Jacobi rotations. numpy.linalg.eigh, R eigen(symmetric=TRUE).", create: () => new MatEigenNode(), parity: false, keywords: "eigen eigenvalues eigenvectors pca principal components symmetric jacobi spectral" },
          { type: "table-unit",      label: "MUNIT",     description: "n×n identity matrix: diagonal 1s, rest 0s, or blanks (nulls) so the off-diagonal stays out of sums. Excel: MUNIT.",                                             create: () => new TableUnitNode(),                   parity: false },
          { type: "table-diag",      label: "DIAGONAL",  description: "Turns a list into a square matrix's diagonal, the rest 0s or blanks (nulls, out of sums). numpy.diag.",                                              create: () => new TableDiagNode(),                   parity: false },
          { type: "pair", children: [
            { type: "table-outer",     label: "OUTER",     description: "Outer product of two lists: the matrix of every product a×b. numpy.outer.",                                                                          create: () => new TableOuterNode(),                  parity: false },
            { type: "vector-cross",    label: "Cross Product", description: "Cross product of two 3-D vectors — the vector perpendicular to both. numpy.cross.",                                                          create: () => new CrossNode(),                       parity: false, keywords: "cross product vector perpendicular normal 3d numpy physics torque" },
          ]},
          { type: "table-transpose", label: "TRANSPOSE", description: "Flips rows and columns of a table. Excel: TRANSPOSE.",                                                    create: () => new TableTransposeNode(),              parity: false },
        ],
      },
      {
        type: "category", label: "Shape", description: "Reshape between 1D lists and 2D tables, stack tables side-by-side.",
        children: [
          { type: "pair", children: [reshapeLeaf("wraprows"), reshapeLeaf("wrapcols")] },
          { type: "pair", children: [reshapeLeaf("tocol"),    reshapeLeaf("torow")]    },
          { type: "hstack-table", label: "HSTACK", description: "Concatenate tables side by side, in row order — add rows for more tables. A list counts as one row, so two lists make one long row. A shorter table pads down with #N/A. Excel: HSTACK.", create: () => new HStackTableNode(), parity: false },
          { type: "vstack-table", label: "VSTACK", description: "Stacks tables top-to-bottom, in row order — add rows for more tables. A list counts as one row, so two lists make a 2-row table. A narrower table pads right with #N/A. Excel: VSTACK.", create: () => new VStackNode(), parity: false, keywords: "stack rows lists to table matrix" },
          { type: "table-expand", label: "EXPAND", description: "Grow a table to a target row or column count. New cells take the wired Fill value, or stay empty (null) without one — wire NA into Fill for Excel's #N/A pad. Shrinking is #VALUE! — that's TAKE's job. Excel: EXPAND.", create: () => new ExpandNode(), parity: false, keywords: "grow pad resize table fill" },
          { type: "table-set-cell", label: "Set Cell", description: "Writes values into a table by address. Each row names a value and its 1-based row and column; a list writes a row, a table a block, from that cell. Later rows win on the same cell. A value that runs past the edge errors the result. Excel has no equivalent.", create: () => new SetCellNode(), keywords: "set cell overwrite poke write address table matrix block row" },
        ],
      },
      {
        type: "category", label: "Select", description: "Pick rows or columns — by index, or from the table's edges.",
        children: [
          { type: "pair", children: [selectLeaf("chooserows"), selectLeaf("choosecols")] },
          { type: "pair", children: [takeDropLeaf("take"), takeDropLeaf("drop")] },
        ],
      },
      {
        type: "category", label: "Lambda (per-cell / per-row)", description: "Apply a formula over a table: each cell, each row or column, fold to one value, or generate from indices.",
        children: [
          { type: "map-table",  label: "MAP",       description: "Applies a formula to every cell of up to three same-shaped tables. Variables value, value2, value3 = each table's cell; row, col = 1-based position (a scalar value2 or value3 broadcasts). Result type for text or date. Excel: MAP.", create: () => new MapTableNode(),  parity: false },
          { type: "by-axis",    label: "BYROW / BYCOL", description: "Reduces each row or column of a table to one value. Variable v = the row or column as a list. Pick the result type for text or date. Excel: BYROW or BYCOL.", create: () => new ByAxisNode(), parity: false },
          { type: "make-array", label: "MAKEARRAY", description: "Builds a rows×cols table from a formula of its indices. Variables row, col = 1-based row, column. Pick the result type for text or date. Excel: MAKEARRAY.", create: () => new MakeArrayNode(), parity: false },
          { type: "reduce-lambda", label: "REDUCE", description: "Fold a list or table to one value, starting from Initial. Variables acc = running accumulator, value = element at this step, step = 1-based position. Pick the result type for text or date. Excel: REDUCE.", create: () => new ReduceLambdaNode(), parity: false },
          { type: "scan-lambda", label: "SCAN", description: "REDUCE that keeps every running value: folds from Initial and emits the accumulator after each cell, same shape as the input. A running total is acc + value from 0. Variables acc, value, step. Pick the result type for text or date. Excel: SCAN.", create: () => new ScanLambdaNode(), parity: false, keywords: "running total cumulative accumulate prefix sum" },
        ],
      },
      {
        type: "category", label: "Frames (named columns)", description: "A data table = a Matrix plus a header list. Build one, take it apart, and read or add columns.",
        children: [
          { type: "build-frame", label: "Build Frame", description: "Combines a Matrix and a header text-list into a Frame. Missing headers auto-fill as Col1, Col2…. Duplicates are made unique.", create: () => new BuildFrameNode(), parity: false },
          { type: "frame-from-lists", label: "Frame from Lists", description: "Builds a Frame straight from lists: each row pairs a typed column name with a wired list of any type. Ragged columns pad with blanks. Add or remove columns with the row buttons.", create: () => new FrameFromListsNode(), parity: false, keywords: "lists to frame columns table build fast assemble" },
          { type: "split-frame", label: "Split Frame", description: "Takes a Frame apart into its numeric Matrix body and header text-list. The inverse of Build Frame. The type filter (All / Num / Date / Bool / Text) keeps only columns of that type — Num pulls just the numeric columns from a mixed frame. Text → headers only.", create: () => new SplitFrameNode(), parity: false },
          { type: "get-column",  label: "Get Column",  description: "Pulls one column out of a Frame as a list, by name or 1-based number. Read as Number, Text, or Date. This sets the output type.", create: () => new GetColumnNode(), parity: false },
          { type: "get-row",     label: "Get Row",     description: "Pulls one row out of a Frame by 1-based number, giving a 1-row Frame: a row mixes types, so it's not a list.", create: () => new GetRowNode(), parity: false },
          { type: "add-column",  label: "Add Column",  description: "Appends a list to a Frame as a new named column, or replace an existing column of that name. Shorter lists pad with blanks.", create: () => new AddColumnNode(), parity: false },
          { type: "computed-column", label: "Computed Column", description: "Adds a column computed row by row: @name reads this row's cell, a bare name is the whole column — @revenue / SUM(revenue) is share-of-total. [Unit Price] / @[Unit Price] spell names a variable can't. A λ input carries one formula across frames. Power Query: Custom Column.", keywords: "custom column calculated field formula derive mutate row-wise index this-row @", create: () => new ComputedColumnNode(), parity: false },
        ],
      },
      {
        type: "category", label: "Table verbs", description: "Relational verbs over a Frame: filter, sort, join, group, reshape, nest and unnest.",
        children: [
          { type: "distinct",    label: "Distinct",    description: "Removes duplicate rows from a Frame, keeping the first of each. The table form of UNIQUE. Rows compare case-sensitively: keys are identity, unlike Excel.", create: () => new DistinctNode(), parity: false },
          { type: "head",        label: "Head",        description: "Row slices: keep the first N, last N, skip the first N, or keep rows N–To (1-based). Power Query's Keep or Remove Rows family on one mode dropdown.", create: () => new HeadNode(), parity: false, keywords: "head tail first last skip range keep remove top bottom rows limit offset" },
          { type: "sort-frame",  label: "Frame Sort",  description: "Orders a Frame's rows by one column, ascending or descending. Blanks and errors sort last. Sorts are stable, so chain Frame Sorts for a multi-key order — innermost key first (sort by Sales, then by Region = Region groups, Sales within). Excel: SORT.", create: () => new SortFrameNode(), parity: false, keywords: "sort order multi key then by stable" },
          { type: "filter-frame",label: "Frame Filter", description: "Keeps rows passing condition rows (column + test + value, AND/OR). The SQL WHERE. Blanks/errors fail a value test and exit the Dropped output ('is blank' or 'has error' select them deliberately) — Kept + Dropped is always the whole Frame. 'No error' drops rows holding a #DIV/0!-style error. 'Has error' keeps only them. Text tests ignore case like Excel's =. Match case per condition. Excel: FILTER.", create: () => new FilterFrameNode(), parity: false, keywords: "filter rows where keep drop errors iserror noterror clean" },
          { type: "join",        label: "Join",        description: "Combines two Frames on a key column: inner / left / right / outer, or as-of (nearest match on a sorted number/date key, direction + tolerance). A left row matching several right rows fans out. As-of never does. Keys match case-sensitively, unlike Excel lookups. Excel: VLOOKUP or XLOOKUP left-join one column at a time.", create: () => new JoinNode(), parity: false },
          { type: "sumifs", label: "SUMIFS", description: "Aggregates one frame column under conditions on the others: sum/count/average/min/max, a Values column, criteria rows (column + test + value), matching all or any of them. Parallel lists go through Frame from Lists first. Excel: SUMIFS, COUNTIFS, AVERAGEIFS, MINIFS, MAXIFS.", create: () => new SumIfsNode(), keywords: "sumif countif averageif minif maxif criteria conditional aggregate frame all any or" },
          { type: "window", label: "Window", description: "A per-group column that keeps every row: running sum / average / min / max, rank / dense rank / percent rank / row number, lag / lead / difference / percent change, rolling (N), the group's total / average / count repeated per row, share of group, first / last — partitioned by key columns and ordered within each group. pandas groupby().transform / cumsum / shift / rank, dplyr group_by %>% mutate, SQL OVER (PARTITION BY … ORDER BY …).", create: () => new WindowNode(), parity: false, keywords: "window partition over running cumulative cumsum rank dense_rank row_number lag lead shift diff pct_change rolling moving transform group share percent of total first last ntile sql" },
          { type: "group-by-frame", label: "Group By", description: "Groups rows by key columns and aggregates one column (sum / average / min / max / count). Optional grand-total / subtotal rows re-aggregate the source (GROUPBY's total_depth). Keys group case-sensitively — no silent case-merge. Excel: GROUPBY.", create: () => new GroupByFrameNode(), parity: false },
          { type: "append",      label: "Append",      description: "Stacks Frames vertically in row order — add rows for more Frames. Columns match by name, a missing column fills blank. A type clash on a shared column is #TYPE!. Excel: VSTACK.", create: () => new AppendNode(), parity: false },
          { type: "bind-columns", label: "Bind Columns", description: "Frames side by side by position — add rows for more Frames. Every column rides through, a repeated name gets a suffix, a shorter Frame pads down with blanks. pandas concat(axis = 1), R bind_cols. Excel: HSTACK.", create: () => new BindColumnsNode(), parity: false, keywords: "bind_cols cbind concat axis 1 side by side zip frames columns hstack horizontal" },
          {
            type: "category", label: "Clean", description: "The everyday cleanup verbs: fill blanks from above, find and replace, drop spacer rows.",
            children: [
              { type: "fill-blanks", label: "Fill Down", description: "Fills blank cells from the neighboring row — Down carries the last value forward, Up the next one back. The classic un-merge of report-shaped tables. Name columns or leave blank for all. Errors are values, not blanks. Power Query: Fill Down / Fill Up.", create: () => new FillBlanksNode(), parity: false, keywords: "fill down up forward backward blanks nulls merged cells carry propagate ffill bfill clean" },
              { type: "replace-values", label: "Replace Values", description: "Find-and-replace in one column or all. Whole-cell swaps cells equal to Find (numbers match numerically. The replacement takes the column's type). Substring rewrites inside text cells. Case-sensitive. Power Query: Replace Values.", create: () => new ReplaceValuesNode(), parity: false, keywords: "replace find substitute swap value cells fix clean search change" },
              { type: "drop-blank-rows", label: "Drop Blank Rows", description: "Removes blank rows: only fully-blank spacer rows, or any row with a blank cell (keep complete rows only). Errors count as values, not blanks. Power Query: Remove Blank Rows.", create: () => new DropBlankRowsNode(), parity: false, keywords: "drop remove blank empty rows spacers nulls complete clean" },
            ],
          },
          // Everyday verbs stay top-level; surgery/reshape/compare fold into subcategories.
          {
            type: "category", label: "Columns", description: "Column surgery: keep, drop, rename, split, or number columns.",
            children: [
              { type: "columns", label: "Columns", description: "Keeps only the named columns, or drops them and passes the rest through. Excel: CHOOSECOLS.", keywords: "columns select keep drop remove choosecols", create: () => new ColumnsNode(), parity: false },
              { type: "rename",      label: "Rename",      description: "Renames columns using two parallel lists zipped by position: From [\"qty\"] → To [\"Quantity\"].", create: () => new RenameNode(), parity: false },
              { type: "split-column", label: "Split Column", description: "Splits one text column into several by a delimiter. The source column is replaced by the parts. Name the new columns or let them auto-number. Power Query: Split Column by Delimiter.", create: () => new SplitColumnNode(), parity: false, keywords: "split delimiter text column separate parse divide power query" },
              { type: "add-index",   label: "Add Index",   description: "Prepends a row-number column from a start value (default 1). Power Query: Add Index Column.", create: () => new AddIndexNode(), parity: false, keywords: "index row number sequence counter rownum power query" },
              { type: "merge-columns", label: "Merge Columns", description: "Joins two or more columns into one text column with a separator between parts. The sources drop and the merged column takes the first one\'s place. The inverse of Split Column. Power Query: Merge Columns.", create: () => new MergeColumnsNode(), parity: false, keywords: "merge combine concatenate join columns text textjoin concat inverse split" },
              { type: "headers", label: "Headers", description: "Promotes the first row to column names (for a table that arrived headerless), or demotes the names back into a first row of text. Power Query: Use First Row as Headers.", create: () => new HeadersNode(), parity: false, keywords: "promote demote headers first row column names use as titles header" },
            ],
          },
          {
            type: "category", label: "Reshape", description: "Change the layout: pivot wide, melt long, nest into a Cube and back.",
            children: [
              { type: "pivot",       label: "PIVOTBY",     description: "Cross-tab long → wide: Row and Column fields (multi-level headers), per-value aggregate functions (SUM / AVERAGE / COUNT / MEDIAN / STDEV / PRODUCT / PERCENTOF…). Grand totals + subtotals re-aggregate the source. Sort, filter mask, % running totals. Excel: PIVOTBY.", create: () => new PivotNode(), parity: true },
              { type: "unpivot",     label: "Unpivot",     description: "Reshapes wide → long (melt): keep the Id columns, turn each chosen Value column into variable/value rows. Excel's Power Query Unpivot.", create: () => new UnpivotNode(), parity: false },
              { type: "pair", children: [
                { type: "nest",   label: "Nest",   description: "Groups a flat Frame by key into a Cube. Each key's other columns collapse into a nested table cell. The flat → nested bridge.", create: () => new NestNode(), parity: false },
                { type: "unnest", label: "Unnest", description: "Expands a Cube's nested column one level: nested tables flatten to a Frame, nested cubes peel to a shallower Cube. Each parent row repeats per nested row. The inverse of Nest.", create: () => new UnnestNode(), parity: false },
              ]},
            ],
          },
          {
            type: "category", label: "Analyze", description: "Score, stress-test, and compare Frames: weighted decisions and version reconciliation.",
            children: [
              { type: "decision-matrix", label: "Decision Matrix", description: "Scores and ranks a Frame of options: rows are options, number columns criteria, an optional leading text column names them. Score = Σ(value × weight) / Σ|weight|, then competition rank on the rounded score. A negative weight penalizes a lower-is-better criterion such as cost. Each criterion normalizes Raw (use the numbers as they are), ÷Max (divide by the column's biggest value; the default), or Rank (keep only the order) so dollars and out-of-10 scores compare. Breakdown adds each criterion's signed contribution; the contributions sum to the Score. Output: Option · Score · Rank, best first.", create: () => new DecisionMatrixNode(), parity: false, keywords: "decision matrix weighted score rank ranking criteria weight choose compare options podium dmbv multi-criteria mcda" },
              { type: "decision-sensitivity", label: "Sensitivity", description: "Re-scores the same options (the Scores frame) under several weight Scenarios to see whether the winner holds. Each Scenarios row is one scenario: a text column names it, and a number column named after a criterion is that weight (missing → 1). Output: a Cube, one row per scenario. Scenario · Winner · Margin · Ranking: Margin is the top score minus the runner-up, Ranking nests the full Option·Score·Rank table to drill into, and options tied for first are listed together in Winner. Pairs with Decision Matrix.", create: () => new DecisionSensitivityNode(), parity: false, keywords: "decision sensitivity robustness scenario weight cube what-if stress test ranking stability mcda" },
              { type: "describe",    label: "Describe",    description: "One row per column: count, blank, distinct, and for number columns mean / std / min / 25% / 50% / 75% / max (min and max for dates). pandas describe, R summary.", create: () => new DescribeNode(), parity: false, keywords: "describe summary summarize profile statistics count mean std quartile overview explore eda" },
              { type: "corr-matrix", label: "Correlation Matrix", description: "The pairwise correlation (Pearson / Spearman / Kendall) or sample covariance between every pair of number columns, as a frame with a leading name column. Pairs use the rows where both sides are present. pandas df.corr / df.cov, R cor / cov.", create: () => new CorrMatrixNode(), parity: false, keywords: "correlation matrix corr cov covariance pearson spearman kendall pairwise heatmap" },
              { type: "kmeans", label: "K-Means", description: "Groups the rows into k clusters by their number columns (k-means++ seeding, the best of ten runs): a cluster id per row and a centers frame. sklearn KMeans, R kmeans.", create: () => new KMeansNode(), parity: false, keywords: "kmeans k-means cluster clustering segment centroid unsupervised group rows" },
              { type: "pca", label: "PCA", description: "Principal components of the number columns: the rows in the new axes (scores), how each feature loads on each axis, and the share of variance each axis explains — centered, or standardized first. sklearn PCA, R prcomp.", create: () => new PcaNode(), parity: false, keywords: "pca principal component analysis dimensionality reduction loadings scores explained variance prcomp eigen" },
              { type: "logistic", label: "Logistic Regression", description: "Fits a 0/1 target on the other number columns: log-odds coefficients with standard errors, z and p, plus the fitted probability per row. Unregularized maximum likelihood (IRLS). R glm(binomial), statsmodels Logit.", create: () => new LogisticNode(), parity: false, keywords: "logistic regression logit glm binomial classification probability odds ratio irls sigmoid" },
              { type: "reconcile",   label: "Reconcile",   description: "Compares two versions of a Frame by key: each row Added / Removed / Changed / Unchanged, with before/after/Δ per shared numeric column. Name a Price and Quantity column (on both sides) to decompose the total change into Price / Volume / Mix variance. Outputs the classified Frame + a Summary line.", create: () => new ReconcileNode(), parity: false, keywords: "reconcile compare diff variance price volume mix pvm audit changed added removed data quality trust" },
            ],
          },
        ],
      },
      {
        type: "category", label: "Cubes (nested tables)", description: "A Cube is a Frame whose cells can each hold anything: a scalar, a list, a nested Frame, or another Cube. The recursive container for relational/nested data. Read a cell back out with INDEX.",
        children: [
          { type: "nest-join", label: "Nest Join", description: "Nests two Frames into a Cube on a shared key: each Parent row gains a cell holding the sub-Frame of matching Child rows — one row per parent where a flat Join fans out. Feed the Cube back in as Parent to deepen one level (Customer → Order → LineItem). Equivalent: tidyr nest_join, Power Query merge-without-expand.", create: () => new NestJoinNode(), parity: false, keywords: "cube nest join relate nest_join relational merge group hierarchy multi-level deepen" },
          { type: "build-cube", label: "Build Cube", description: "Collect values into one Cube column. Each input row is a cell that can hold any value: a scalar, list, Frame, or nested Cube. The manual way to put non-table values into a cube. An unwired row takes a typed number.", create: () => new BuildCubeNode(), parity: false, keywords: "cube nest nested pack wrap list of frames container" },
          { type: "cube-columns", label: "Cube Columns", description: "Assembles a Cube from N column inputs: a list → its elements, a single-column cube → its cells, a frame or scalar → one cell. The Names list names them. Build Cube wraps values into one column. This lines columns up side by side — Customers[id, name, orders].", create: () => new CubeColumnsNode(), parity: false, keywords: "cube columns multi-column assemble combine build frame side by side hstack" },
          { type: "cube-rollup", label: "Cube Rollup", description: "Aggregates a column inside each row's nested sub-table, flattening the Cube back to a Frame with the roll-up appended: cost of an assembly = SUM of its nested parts. Same ops as Group By. The BOM shape: Nest Join parts under assemblies, roll up extended cost here.", create: () => new CubeRollupNode(), parity: false, keywords: "cube rollup aggregate sum bom bill of materials costing nested cost roll up assembly subtotal" },
        ],
      },
    ],
  },

  // Declared EMPTY so it sits before "Other": the catalog builder fills it per active
  // pack and prunes the row when no pack targets it. Cross-woven pack nodes stay put.
  {
    type: "category", label: "Packs", description: "Nodes from your enabled packs, by domain. Manage packs in Settings.",
    children: [],
  },

  // Pruned only if it ends up empty — it won't, since Promo is a permanent member.
  {
    type: "category", label: "Other", description: "Catch-all for odd one-offs and uncategorized pack nodes.",
    children: [
      { type: "image", label: "Image", description: "A free-floating picture: attach a local file or paste a web URL, and set its height. Annotation only. Carries no data. Web URLs persist in the save. Local files are session-only, not yet embedded.", create: () => new ImageNode(), parity: false },
      { type: "svg", label: "SVG", description: "An interactive SVG: attach a local .svg or paste a URL. The selected shape or layer outputs its name (label or id) — a map, floorplan, or schematic as a data selector. Adjustable highlight color. Also flows the picture out a chart socket for Reports.", create: () => new SvgPickerNode(), parity: false, keywords: "svg map picker region layer shape hotspot clickable diagram floorplan schematic slice filter select vector" },
      { type: "promo", label: "✨ Promo", description: "A random Solenoid tagline. Re-rolls on recalc (F9). Pure easter egg.", create: () => new PromoNode() },
    ],
  },
];
