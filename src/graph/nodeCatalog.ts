// [[C19]] namingModel, [[C53]] queryIsCompositePreset, [[C14]] currentExcelParity
import {
  AngleDialNode, SlicerNode, CableSwitchNode, DateInputNode, DateRangeNode, XYPadNode,
  PointPlotterNode, CurveNode, GridPainterNode,
  SparklineNode, ChartNode, MergePlotsNode, HistogramNode, KpiNode, ProportionNode, SankeyNode, SurfaceNode, MermaidNode, GaugeNode, HeatmapCellNode, ChartBuilderNode,
  WaterfallNode, CandlestickNode, BoxplotNode, CalendarHeatmapNode, QuiverNode, RecordNode, GanttNode,
  FillBlanksNode, ReplaceValuesNode, MergeColumnsNode, HeadersNode, DropBlankRowsNode, DescribeNode, CorrMatrixNode, WindowNode,
  NumberInputNode, ArithmeticNode, DisplayNode, ComparisonNode, MathFXNode,
  FormatControllerNode, ExpressionNode, ScriptNode, EquationNode, RegexNode, GroupListsNode,
  ClampNode, BooleanOpNode, NotNode, IfNode, ConduitNode, CastNode, ConstantNode, MRoundNode,
  ListInputNode, AggregateNode, SeriesNode, SERIES_OP_META, type SeriesOp, ListLengthNode, ListIndexNode,
  SortNode, ReverseNode, SliceNode, FilterNode, SumIfsNode, FillNode, XLookupNode,
  GCDNode, IFErrorNode, NaNode, RandBetweenNode, RoundNNode, ConvertNode,
  UniqueNode, SetsNode, ConcatListsNode, FrameFromListsNode, QuadraticRootsNode, RunningNode, DiffNode,
  ArgMinMaxNode, ContainsNode, RankPercentileNode, RANK_PERCENTILE_OP_META, type RankPercentileOp,
  CorrelNode, CombinatoricsNode, TwoInputMathNode,
  SumProductNode, ChooseNode, BooleanInputNode, SliderInputNode, ColorPickerNode, ColorBlendNode, IsTestNode,
  SaveTimesNode,
  AlertNode, NormalizeNode, BinNode, OutliersNode, ShiftNode, CombinationsNode, EwmaNode, CrossNode, PolyfitNode, TrapzNode, RleNode, BetweenNode, IsCloseNode,
  ShuffleNode, NthElementNode, InterleaveNode, PadNode,
  StandardizeNode, CovarianceNode, FisherNode, BitwiseNode,
  DepreciationNode,
  TvmNode, PaymentBreakdownNode, NPVNode, IRRNode, MirrNode, AmortizationNode, ReturnsNode,
  FvScheduleNode, IspmtNode, DollarNode, ProbNode,
  WeightedNode, BaseConvertNode,
  TextInputNode, TextTransformNode, TextLenNode, ConcatNode, TextSliceNode,
  TextFindNode, SubstituteNode, TextReplaceNode,
  ReptNode, PadTextNode, TruncateTextNode, WrapTextNode, ExactNode, TextSimilarityNode, FuzzyMatchNode,
  CharCodeNode, TextJoinNode, TextSplitNode, TextAfterBeforeNode,
  NumberValueNode, RomanArabicNode, FixedNode, UrlEncodeNode, HashNode, UuidNode, TemplateNode,
  PromoNode,
  TodayNowNode, DateConstructNode, TimeConstructNode,
  DateTimeValueNode, DATE_TIME_VALUE_OP_META, DatePartNode, WeekInfoNode,
  DateDiffNode, DateAddNode, WorkdaysNode, WORKDAYS_OP_META, EpochNode, DateTruncNode,
  RandArrayNode,
  XMatchNode,
  DiscountSecurityNode, CouponNode, AccruedInterestNode, DurationNode,
  BondPricingNode,
  COUPON_OP_META,
  DURATION_OP_META,
  ComplexFromNode, ComplexUnpackNode, ComplexUnaryNode, ComplexBinaryNode, ComplexPowerNode,
  COMPLEX_UNARY_OP_META, COMPLEX_BINARY_OP_META,
  type ComplexUnaryOp, type ComplexBinaryOp,
  TableInputNode, MatDetNode, TableMultNode, TableUnitNode, TableDiagNode, TableOuterNode, TableTransposeNode,
  StackNode, TableReshapeNode, TableSelectNode, TakeDropNode, ExpandNode, SetCellNode, TableInfoNode,
  MapTableNode, ByAxisNode, MakeArrayNode, ReduceLambdaNode, ScanLambdaNode, LambdaNode,
  FrameInputNode, BuildFrameNode, SplitFrameNode, GetColumnNode, AddColumnNode, ComputedColumnNode, GetRowNode, DistinctNode,
  HeadNode, SortFrameNode, FilterFrameNode, JoinNode,
  ColumnsNode, GroupByFrameNode, PivotNode, UnpivotNode, NestNode, UnnestNode, AppendNode, BindColumnsNode, RenameNode, SplitColumnNode, AddIndexNode, DecisionMatrixNode, DecisionSensitivityNode, AllocatorNode, SettleNode, PayoffPlannerNode, ScheduleNode, EarnedValueNode,
  ReconcileNode,
  BuildCubeNode, NestJoinNode, CubeColumnsNode, CubeRollupNode, CubeInputNode,
  WebSourceNode, LocalFileNode, ImportHtmlNode, ImportXmlNode, DataFeedNode, GeocodeNode, WeatherNode, HolidaysNode, FxNode, VaultFolderNode,
  WriteFileNode, WriteObsidianNode, TaskNotesNode, WriteTasksNode, ImportObsidianNode,
  GroupNode, NoteNode, ReportNode, SessionHistoryNode, PresentationNode, ImageNode, FileLinkNode, SvgPickerNode,
  CompositeNode, CompositeInputNode, CompositeOutputNode,
  MAT_DET_OP_META, TABLE_RESHAPE_OP_META, TABLE_SELECT_OP_META, TAKEDROP_OP_META,
  type MatDetOp, type TableReshapeOp, type TableSelectOp,
  IsEvenOddNode, FormatDollarNode,
  DistributionsNode,
  RegressionNode, ForecastNode, ModeNode, TrimMeanNode, FrequencyNode, ConfidenceNode,
  BesselNode,
  SeriesSumNode, MultinomialNode, SwitchNode, IfsNode,
  HypothesisTestNode, HYPOTHESIS_TEST_OP_META, type HypothesisTestOp,
  EtsForecastNode, InterpolateNode, LinestNode, BinomDistRangeNode,
  NODE_KIND_ACCENTS,
  ARITHMETIC_OP_META, MATH_FN_OP_META, BOOLEAN_OP_META, REDUCE_OP_META,
  COMBINATORICS_OP_META, ARG_MIN_MAX_OP_META,
  SUM_PRODUCT_OP_META, CORREL_OP_META, TWO_INPUT_MATH_OP_META,
  COVARIANCE_OP_META, FISHER_OP_META, BITWISE_OP_META,
  DEPRECIATION_OP_META,
  DOLLAR_OP_META,
  WEIGHTED_OP_META,
  TEXT_TRANSFORM_OP_META, TEXT_SLICE_OP_META, TEXT_FIND_OP_META, TEXT_AFTER_BEFORE_OP_META,
  BESSEL_OP_META, REGRESSION_OP_META,
  TODAY_NOW_OP_META, DATE_PART_OP_META, WEEK_INFO_OP_META, DATE_DIFF_OP_META, DATE_ADD_OP_META,
  type ArithmeticOp, type MathFnOp, type BooleanOp, type ReduceOp,
  type CombinatoricsOp, type ArgMinMaxOp,
  type SumProductOp, type CorrelOp, type TwoInputMathOp,
  type CovarianceOp, type FisherOp, type BitwiseOp,
  type DepreciationOp,
  type DollarOp, type WeightedOp,
  type CouponOp, type DurationOp,
  type TextTransformOp, type TextSliceOp, type TextFindOp, type CharCodeOp, type TextAfterBeforeOp,
  type RomanArabicOp,
  type BesselOp, type RegressionOp,
  type TodayNowOp, type DateTimeValueOp, type DatePartOp, type WeekInfoOp, type DateDiffOp, type DateAddOp,
  ExpectNode, TornadoNode,
} from "./rete-nodes";
import type { NodeCatalogEntry, CatalogEntry } from "./AddNodeMenu";


const arithLeaf    = (op: ArithmeticOp):   NodeCatalogEntry => ({ type: `arith-${op}`,     label: ARITHMETIC_OP_META[op].label,     description: ARITHMETIC_OP_META[op].description,     keywords: "arithmetic", create: () => new ArithmeticNode({ op }), ...(op === "pow" ? { parity: false as const } : {}) });
const mathLeaf     = (op: MathFnOp, overrides?: Partial<NodeCatalogEntry>): NodeCatalogEntry => ({ type: `math-${op}`, label: MATH_FN_OP_META[op].label, description: MATH_FN_OP_META[op].description, create: () => new MathFXNode({ op }), ...overrides, keywords: ["math", overrides?.keywords].filter(Boolean).join(" ") });
const booleanLeaf  = (op: BooleanOp):      NodeCatalogEntry => ({ type: `bool-${op}`,      label: BOOLEAN_OP_META[op].label,        description: BOOLEAN_OP_META[op].description,        create: () => new BooleanOpNode({ op })     });
const reduceLeaf   = (op: ReduceOp):       NodeCatalogEntry => ({ type: `reduce-${op}`,    label: REDUCE_OP_META[op].label,         description: REDUCE_OP_META[op].description,         keywords: ["aggregate", (REDUCE_OP_META[op] as { keywords?: string }).keywords].filter(Boolean).join(" "), create: () => new AggregateNode({ op }), ...((REDUCE_OP_META[op] as { fx?: string }).fx ? { fx: [(REDUCE_OP_META[op] as { fx?: string }).fx!] } : {})     });
const combLeaf     = (op: CombinatoricsOp):NodeCatalogEntry => ({ type: `comb-${op}`,      label: COMBINATORICS_OP_META[op].label,  description: COMBINATORICS_OP_META[op].description,  keywords: "combinatorics", create: () => new CombinatoricsNode({ op }) });
// NODE_EXCEL keys on these leaf types, so they don't follow the op names.
const SERIES_LEAF_TYPE: Record<SeriesOp, string> = { range: "list-range", sequence: "list-sequence", linspace: "list-linspace", geometric: "list-geometric", fibonacci: "list-fibonacci", repeat: "list-repeat" };
const seriesLeaf   = (op: SeriesOp, overrides?: Partial<NodeCatalogEntry>): NodeCatalogEntry => ({ type: SERIES_LEAF_TYPE[op], label: SERIES_OP_META[op].label, description: SERIES_OP_META[op].description, keywords: "series generate list", create: () => new SeriesNode({ op }), ...overrides });

// NODE_EXCEL keys on these leaf types, so they don't follow the op names.
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
const regressionLeaf = (op: RegressionOp): NodeCatalogEntry => ({ type: `regression-${op}`,label: REGRESSION_OP_META[op].label,     description: REGRESSION_OP_META[op].description,     keywords: "regression", create: () => new RegressionNode({ op })    });
// NODE_EXCEL keys on these leaf types, so they don't follow the op names.
const TEST_LEAF_TYPE: Record<HypothesisTestOp, string> = {
  z: "z-test", "t-paired": "t-test-paired", "t-equal": "t-test-equal-var", "t-welch": "t-test-unequal-var", f: "f-test", chisq: "chisq-test",
  anova: "anova-test", mannwhitney: "mannwhitney-test", wilcoxon: "wilcoxon-test", kruskal: "kruskal-test", fisher: "fisher-exact-test", ks: "ks-test", proptest: "proportion-test", binomtest: "binomial-test",
};
const testLeaf     = (op: HypothesisTestOp, overrides?: Partial<NodeCatalogEntry>): NodeCatalogEntry => ({ type: TEST_LEAF_TYPE[op], label: HYPOTHESIS_TEST_OP_META[op].label, description: HYPOTHESIS_TEST_OP_META[op].description, create: () => new HypothesisTestNode({ op }), ...overrides, keywords: ["hypothesis test", overrides?.keywords].filter(Boolean).join(" ") });
const dollarLeaf    = (op: DollarOp):      NodeCatalogEntry => ({ type: `dollar-${op}`,     label: DOLLAR_OP_META[op].label,          description: DOLLAR_OP_META[op].description,          create: () => new DollarNode({ op }) });
const weightedLeaf   = (op: WeightedOp):      NodeCatalogEntry => ({ type: `weighted-${op}`,    label: WEIGHTED_OP_META[op].label,          description: WEIGHTED_OP_META[op].description,          create: () => new WeightedNode({ op }) });
const DT = NODE_KIND_ACCENTS.date;
// NODE_EXCEL keys on `date-value` and `time-value`, so they don't follow the op names.
const dateTimeValueLeaf = (op: DateTimeValueOp): NodeCatalogEntry => ({ type: op === "date" ? "date-value" : "time-value", label: DATE_TIME_VALUE_OP_META[op].label, description: DATE_TIME_VALUE_OP_META[op].description, create: () => new DateTimeValueNode({ op }), parity: false });
const datePartLeaf  = (op: DatePartOp):  NodeCatalogEntry => ({ type: `date-part-${op}`,  label: DATE_PART_OP_META[op].label,  description: DATE_PART_OP_META[op].description,  create: () => new DatePartNode({ op }),  parity: false });
const weekInfoLeaf  = (op: WeekInfoOp):  NodeCatalogEntry => ({ type: `date-week-${op}`,  label: WEEK_INFO_OP_META[op].label,  description: WEEK_INFO_OP_META[op].description,  create: () => new WeekInfoNode({ op }),  parity: false });
const dateDiffLeaf  = (op: DateDiffOp):  NodeCatalogEntry => ({ type: `date-diff-${op}`,  label: DATE_DIFF_OP_META[op].label,  description: DATE_DIFF_OP_META[op].description,  create: () => new DateDiffNode({ op }),  parity: false });
const dateAddLeaf   = (op: DateAddOp):   NodeCatalogEntry => ({ type: `date-add-${op}`,   label: DATE_ADD_OP_META[op].label,   description: DATE_ADD_OP_META[op].description,   create: () => new DateAddNode({ op }),   parity: false });
const todayNowLeaf  = (op: TodayNowOp):  NodeCatalogEntry => ({ type: `date-${op}`,        label: TODAY_NOW_OP_META[op].label,  description: TODAY_NOW_OP_META[op].description,  create: () => new TodayNowNode({ op }),  parity: false });

const durationLeaf  = (op: DurationOp):  NodeCatalogEntry => ({ type: `duration-${op}`,  label: DURATION_OP_META[op].label,   description: DURATION_OP_META[op].description,   create: () => new DurationNode({ op }),  parity: false });

const couponLeaf = (op: CouponOp): NodeCatalogEntry => ({ type: `coupon-${op}`, label: COUPON_OP_META[op].label, description: COUPON_OP_META[op].description, create: () => new CouponNode({ op }), parity: false });

const CX = NODE_KIND_ACCENTS.complex;
const complexUnaryLeaf  = (op: ComplexUnaryOp):  NodeCatalogEntry => ({ type: `cx-unary-${op}`,  label: COMPLEX_UNARY_OP_META[op].label,  description: COMPLEX_UNARY_OP_META[op].description,  create: () => new ComplexUnaryNode({ op }),  parity: false });
const complexBinaryLeaf = (op: ComplexBinaryOp): NodeCatalogEntry => ({ type: `cx-binary-${op}`, label: COMPLEX_BINARY_OP_META[op].label, description: COMPLEX_BINARY_OP_META[op].description, create: () => new ComplexBinaryNode({ op }), parity: false });

const besselLeaf = (op: BesselOp): NodeCatalogEntry => ({ type: `bessel-${op}`, label: BESSEL_OP_META[op].label, description: BESSEL_OP_META[op].description, create: () => new BesselNode({ op }), parity: false });

const matDetLeaf    = (op: MatDetOp):      NodeCatalogEntry => ({ type: `matdet-${op}`,    label: MAT_DET_OP_META[op].label,    description: MAT_DET_OP_META[op].description,    create: () => new MatDetNode({ op }),    parity: false });
const reshapeLeaf   = (op: TableReshapeOp):NodeCatalogEntry => ({ type: `reshape-${op}`,   label: TABLE_RESHAPE_OP_META[op].label, description: TABLE_RESHAPE_OP_META[op].description, create: () => new TableReshapeNode({ op }), parity: false });
const selectLeaf    = (op: TableSelectOp): NodeCatalogEntry => ({ type: `tblsel-${op}`,    label: TABLE_SELECT_OP_META[op].label, description: TABLE_SELECT_OP_META[op].description, create: () => new TableSelectNode({ op }), parity: false });

const romanArabicLeaf = (op: RomanArabicOp): NodeCatalogEntry => ({
  type: `roman-arabic-${op}`,
  label: op === "roman" ? "ROMAN" : "ARABIC",
  description: op === "roman"
    ? "Converts an integer (1–3999) to a Roman numeral string. Excel: `ROMAN`."
    : "Converts a Roman numeral string to an integer. Excel: `ARABIC`.",
  create: () => new RomanArabicNode({ op }),
  parity: false,
});



const STR = NODE_KIND_ACCENTS.string;
const textXformLeaf         = (op: TextTransformOp):   NodeCatalogEntry => ({ type: `text-${op}`,              label: TEXT_TRANSFORM_OP_META[op].label,        description: TEXT_TRANSFORM_OP_META[op].description,        create: () => new TextTransformNode({ op }),     parity: false });
const textSliceLeaf         = (op: TextSliceOp):       NodeCatalogEntry => ({ type: `text-${op}`,              label: TEXT_SLICE_OP_META[op].label,            description: TEXT_SLICE_OP_META[op].description,            create: () => new TextSliceNode({ op }),         parity: false });
const textFindLeaf          = (op: TextFindOp):        NodeCatalogEntry => ({ type: `text-find-${op}`,         label: TEXT_FIND_OP_META[op].label,             description: TEXT_FIND_OP_META[op].description,             create: () => new TextFindNode({ op }),           parity: false });
const charCodeLeaf          = (op: CharCodeOp):        NodeCatalogEntry => ({ type: `char-code-${op}`,         label: op === "char" ? "CHAR" : "CODE",         description: op === "char" ? "Character at Unicode code point N (1–1114111). Excel: `CHAR` / `UNICHAR`." : "Unicode code point of the first character. Excel: `CODE` / `UNICODE`.", create: () => new CharCodeNode({ op }), parity: false });
const textAfterBeforeLeaf   = (op: TextAfterBeforeOp): NodeCatalogEntry => ({ type: `text-after-before-${op}`, label: TEXT_AFTER_BEFORE_OP_META[op].label,     description: TEXT_AFTER_BEFORE_OP_META[op].description,     create: () => new TextAfterBeforeNode({ op }), parity: false });

// ─── Catalog tree ─────────────────────────────────────────────────────────────

export const NODE_CATALOG: CatalogEntry[] = [
  // ── INPUT ────────────────────────────────────────────────────────────────────
  {
    type: "category", label: "Input", description: "Source nodes: where values enter your graph.",
    children: [
      { type: "number-input",        label: "Number Input",  description: "A literal number value.", accent: NODE_KIND_ACCENTS.input, keywords: "scalar value literal", create: () => new NumberInputNode() },
      { type: "list-input",  label: "List Input",    description: "Concatenates comma-separated values and other wired-in Lists into a single-row List.", accent: NODE_KIND_ACCENTS.list, keywords: "literal array csv combine concat number text string date boolean logical type", create: () => new ListInputNode() },
      { type: "text-input",    label: "Text Input",    description: "A literal string value.", accent: STR, keywords: "string literal", create: () => new TextInputNode() },
      { type: "boolean-input", label: "Boolean Input", description: "A `TRUE` or `FALSE` toggle that outputs a logical. It coerces to `1` or `0` where a number is needed.", accent: NODE_KIND_ACCENTS.logic, create: () => new BooleanInputNode() },
      { type: "date-input",    label: "Date Input",    description: "A single date value.", accent: DT, create: () => new DateInputNode(), parity: false, keywords: "date calendar day picker serial input" },
      { type: "table-input",   label: "Table Input",   description: "A grid you type in, one row per line with commas between cells. Every cell shares one type; for columns of different types, use Frame Input. A cell that doesn't parse shows `NaN` but keeps what you typed.", accent: NODE_KIND_ACCENTS.table, create: () => new TableInputNode() },
      { type: "frame-input",   label: "Frame Input", description: "A data table you type in, with named, typed columns. An `Fx` column is calculated from the others, like Computed Column.", accent: NODE_KIND_ACCENTS.frame, create: () => new FrameInputNode(), parity: false },
      { type: "cube-input", label: "Cube Input", description: "A typed-in Cube: rows of records whose values can be numbers, text, lists, or nested tables. Each cell edits in place in a popup.", accent: NODE_KIND_ACCENTS.frame, create: () => new CubeInputNode(), parity: false, keywords: "cube input literal type records nested list json source" },
      { type: "pair", children: [
        { type: "cx-from",       label: "COMPLEX",     description: "Builds a complex number from real and imaginary parts. Excel: `COMPLEX`.", accent: CX, create: () => new ComplexFromNode(), parity: false },
        { type: "lambda-make",   label: "LAMBDA",      description: "A reusable formula for MAP, BYROW, REDUCE and computed columns. Parameters fill in order, and any other variable becomes an input. Excel: `LAMBDA`.", accent: NODE_KIND_ACCENTS.lambda, create: () => new LambdaNode(), parity: false },
      ]},
      { type: "constant",      label: "Constant",    description: "Predefined value: π, e, φ, ∞, 0, 1, true, false …", create: () => new ConstantNode() },
      { type: "pair", children: [
        { type: "randbetween", label: "RAND",        description: "Random float in [Bottom, Top]. Defaults to 0–1 (like Excel `RAND()`). Bottom and Top give a custom range.", create: () => new RandBetweenNode(), parity: false, keywords: "random" },
        { type: "na",          label: "NA",          description: "Outputs `#N/A`, which propagates through calculations like Excel. Catch it with `IFERROR` or `IFNA`.", create: () => new NaNode() },
      ]},
      {
        type: "category", label: "Control", description: "Interactive widgets that drive values in your graph.",
        children: [
          { type: "slider",      label: "Slider",      description: "A slider value, with configurable min, max, and step.", accent: NODE_KIND_ACCENTS.input, create: () => new SliderInputNode() },
          { type: "angle-dial",  label: "Angle Dial",  description: "A rotary dial: spin or type to set an angle in degrees, 0–359.", create: () => new AngleDialNode() },
          { type: "date-range",  label: "Date Range",  description: "Picks a start and end date. It outputs both serials. Subtract them for a duration.", create: () => new DateRangeNode(), parity: false, keywords: "date range period start end duration between from to picker" },
          { type: "xy-pad",      label: "XY Pad",      description: "Two values at once, from a handle in a square pad. Each is 0–1. Scale them with arithmetic for any range.", create: () => new XYPadNode(), parity: false },
          { type: "point-plotter", label: "Point Plotter", description: "Hand-plotted dataset on a small plane, out as a two-column X, Y frame.", create: () => new PointPlotterNode(), parity: false, keywords: "point plotter scatter draw data by hand click plane pad dataset xy points" },
          { type: "curve",       label: "Curve",       description: "A hand-drawn response curve: a spline through control points on a strip, out as an X, Value frame. Tuning curves, easing, tiered rates.", create: () => new CurveNode(), parity: false, keywords: "curve envelope spline ease easing ramp response tuning interpolate draw shape function" },
          { type: "grid-painter", label: "Grid Painter", description: "Paintable matrix, any brush value (right-click erases to blank). Outputs the grid: masks for `MAP`, terrain for Surface, quick heatmap data.", create: () => new GridPainterNode(), parity: false, keywords: "grid painter paint matrix cells brush mask draw table pixel editor" },
          { type: "color-picker", label: "Color", description: "A color in RGB or HSV, out as a hex or `rgb()` string.", create: () => new ColorPickerNode(), parity: false },
          { type: "color-blend", label: "Color Blend", description: "Blends two colors with a standard blend mode: mix, multiply, screen, overlay, darken, lighten, difference, dodge, burn. Any CSS color string in, hex out.", create: () => new ColorBlendNode(), parity: false, keywords: "color blend mix multiply screen overlay tint shade combine average darken lighten" },
          { type: "slicer",      label: "Slicer",      description: "Filters a Frame like an Excel slicer: choose a column, then the values whose rows to keep.", create: () => new SlicerNode() },
          { type: "cable-switch", label: "Input Switch", description: "Passes on the value from the named slot you pick, of any type. Unlike `SWITCH`, it picks by name, not by matching a value. Many mode passes several, as a Cube of name and value rows.", create: () => new CableSwitchNode(), parity: false, keywords: "switch multiplexer select choose route mux named cube collect multi" },
        ],
      },
      {
        type: "category", label: "Connections", description: "Data from outside the graph: web and local files, live feeds, keyless lookups, and the sinks that write back. Stores the source, not the data.",
        children: [
          { type: "web-source",    label: "Web Source",  description: "A Frame from a CSV or JSON URL, columns auto-typed. Stores the URL, not the data. Desktop fetches any URL; the browser needs CORS.", create: () => new WebSourceNode(), parity: false },
          { type: "data-feed",     label: "Data Feed",   description: "Live economic and market data as a Frame: FRED series with no key, Alpha Vantage stock history with a free key. Stores the id, not the data.", create: () => new DataFeedNode(), parity: false },
          { type: "local-file",   label: "Local File",  description: "Loads a Frame from your data folder (Settings ▸ Data). Parquet reads straight into the native engine with its types intact; anything else reads as CSV with columns auto-typed. A Project XML, GanttProject, Primavera XER or plan CSV also comes out as a Plan for Schedule. Stores the file name. Refresh to re-read. Desktop only.", create: () => new LocalFileNode(), parity: false, keywords: "csv parquet arrow column columnar native engine polars file load import project xml mspdi plan smartsheet gantt gan primavera xer" },
          { type: "pair", children: [
            { type: "import-html",   label: "Import HTML", description: "Grab the Nth HTML table on a page as a Frame, columns auto-typed. Stores the URL. Refresh to re-pull. Desktop any URL, browser CORS-only. Sheets: `IMPORTHTML`.", create: () => new ImportHtmlNode(), parity: false },
            { type: "import-xml",    label: "Import XML",  description: "A page's XPath matches as a text list. Stores the URL; refresh re-pulls. Desktop any URL, browser CORS-only. Sheets: `IMPORTXML`.", create: () => new ImportXmlNode(), parity: false },
          ]},
          { type: "write-file",    label: "Write File",  description: "Writes a Frame as CSV or JSON rows, or Text as-is. Pick the format, arm it, then press Run. Never writes on its own. Desktop only.", create: () => new WriteFileNode(), parity: false, keywords: "csv json text write export save file sink xml mspdi verbatim string" },
          { type: "pair", children: [
            { type: "geocode",       label: "Geocode",     description: "A place name to latitude, longitude and timezone, with a pick among matches when the name is ambiguous. No key needed.", create: () => new GeocodeNode(), parity: false, keywords: "geocode place location city coordinates latitude longitude timezone lookup open-meteo" },
            { type: "weather",       label: "Weather",     description: "A daily forecast frame and the current temperature for a latitude and longitude. °C or °F carries as a unit. No key needed.", create: () => new WeatherNode(), parity: false, keywords: "weather forecast rain temperature precipitation climate open-meteo garden watering" },
          ]},
          { type: "pair", children: [
            { type: "holidays",      label: "Holidays",    description: "Public holidays for a country and year as a frame, the dates alone for NETWORKDAYS and WORKDAY, and days until the next one. No key needed.", create: () => new HolidaysNode(), parity: false, keywords: "holiday holidays public bank national country region nager networkdays workday calendar days off" },
            { type: "fx",            label: "Currency",    description: "Converts an amount at the latest ECB rate, carrying the target currency as a unit. History gives a date range's daily rates. No key needed.", create: () => new FxNode(), parity: false, keywords: "currency fx exchange rate money forex frankfurter ecb usd eur gbp dollar euro convert conversion history time series chart" },
          ]},
        ],
      },
    ],
  },

  // ── OUTPUT ───────────────────────────────────────────────────────────────────
  {
    type: "category", label: "Output", description: "Display, convert, and visualize values at the end of a chain.",
    children: [
      { type: "display",   label: "Display",  description: "Shows a value and passes it on unchanged.", create: () => new DisplayNode(), accent: NODE_KIND_ACCENTS.util },
      { type: "format-controller", label: "Format Controller", description: "Sets how a docked socket's value reads (decimals, fractions, percent, currency, a date style) and its unit, like `°C`, `m` or `kg`. A value that already has a unit locks it; Convert changes it.", create: () => new FormatControllerNode() },
      {
        type: "category", label: "Visuals", description: "Inline charts and readouts: plot or visualize a value at the end of a chain. All pass-through.",
        children: [
          { type: "chart",     label: "Chart (Recharts)",     description: "Plots a List or a Frame as a column, bar, line, area, scatter, pie, radar or funnel chart, among others. A Frame's number columns become named series with a legend, and can combine bars with lines.", create: () => new ChartNode(), parity: false, keywords: "chart plot graph column bar line area scatter pie radar radial funnel composed bubble multi-series legend" },
          { type: "kpi",       label: "KPI",  description: "A big-number stat card with a ↑/↓ delta vs a prior value, colored green/red.", create: () => new KpiNode(), parity: false, keywords: "kpi stat card metric scorecard delta variance big number" },
          { type: "sparkline", label: "Sparkline", description: "A small inline chart of a list: line, column, or win/loss. Collapses to a headerless square. Excel puts these in cells via Insert ▸ Sparklines.", create: () => new SparklineNode(), parity: false, keywords: "sparkline spark line column win loss winloss" },
          { type: "record",    label: "Record",    description: "One frame row as labeled boxes, or every row as a gallery, a board of lanes, or an indented list. An image URL cell shows the picture.", create: () => new RecordNode(), parity: false, keywords: "record card form detail row browse fields layout boxes airtable gallery kanban board lanes list outline title size clamp" },
          { type: "gantt",     label: "Gantt",     description: "A scheduled project: a bar per task, milestones, summary brackets, dependency arrows, the critical path, a baseline and a status line.", create: () => new GanttNode(), parity: false, keywords: "gantt chart project schedule timeline plan tasks bars milestones critical path dependencies predecessors baseline waterfall roadmap pert cpm" },
          { type: "gauge",     label: "Gauge",     description: "A value on a fixed scale: a radial Dial reading it as a fraction of 1, or a Bar from zero to Max with a target tick. Excel has no equivalent.", create: () => new GaugeNode(), parity: false, keywords: "gauge dial bar bullet graph target progress goal percent speedometer meter scale kpi" },
          { type: "chart-builder", label: "Chart Builder", description: "Styles any chart, producing an options string: title, axes, color, grid, range, line, markers, per chart type. Fields follow `matplotlib`.", create: () => new ChartBuilderNode(), parity: false, keywords: "chart builder options style title axes color grid range markers histogram kpi proportion treemap waffle sankey waterfall" },
          { type: "merge-plots", label: "Merge Plots", description: "Overlays several line, area, column, bar or scatter charts on one plot with shared axes; the legend names each source. Pie, gauge and other non-plot figures are refused.", create: () => new MergePlotsNode(), parity: false, keywords: "merge plots overlay combine superimpose layer stack multi series legend line scatter area column bar composed matplotlib" },
          { type: "mermaid",   label: "Mermaid Charts",   description: "Draws text-based Mermaid.js diagrams.", create: () => new MermaidNode(), parity: false, keywords: "mermaid diagram flowchart flow chart graph sequence class state gantt pie mindmap uml erd tree" },
          {
            type: "category", label: "Distribution", description: "How a sample spreads: binned counts and five-number summaries.",
            children: [
              { type: "histogram", label: "Histogram", description: "Bin a list of numbers into equal-width buckets and plot the counts as columns, or a 2-D X/Y count grid as a density plot. numpy `histogram` / `histogram2d`.", create: () => new HistogramNode(), parity: false, keywords: "histogram bins distribution frequency FREQUENCY buckets histogram2d 2d bivariate density joint hexbin heatmap" },
              { type: "boxplot", label: "Boxplot", description: "Five-number summaries as boxes, one per numeric column: median, quartile box, Tukey whiskers, outlier dots. The visual `QUARTILE`.", create: () => new BoxplotNode(), parity: false, keywords: "boxplot box whisker quartile median outlier iqr spread distribution violin" },
            ],
          },
          {
            type: "category", label: "Proportion", description: "Parts of a whole: shares, flows, and space-filling layouts.",
            children: [
              { type: "proportion", label: "Proportion", description: "Parts of a whole from a label, value frame: a Treemap of nested rectangles, or a Waffle filling a 10×10 grid by share.", create: () => new ProportionNode(), parity: false, keywords: "treemap tree map rectangles waffle squares dot matrix proportion share percentage pictogram hierarchy area progress" },
              { type: "sankey",    label: "Sankey",    description: "A flow diagram: each row of a 3-column frame (From, To, Value) is an edge, and the band width shows the flow.", create: () => new SankeyNode(), parity: false, keywords: "sankey flow diagram alluvial edges links network flows" },
            ],
          },
          {
            type: "category", label: "Grids & Fields", description: "Figures over a 2-D grid: cell color, height, and direction.",
            children: [
              { type: "heatmap-cell", label: "Heatmap", description: "Color every cell of a Table on a cool-to-warm scale across its data range, like conditional formatting. Pass-through.", create: () => new HeatmapCellNode(), parity: false },
              { type: "surface", label: "Surface", description: "A shaded 3-D surface plot over a table of heights, with optional Xs and Ys coordinate lists; absent axes count 1, 2, 3, and so on, the same shape Grid Interpolate fills.", create: () => new SurfaceNode(), parity: false, keywords: "surface 3d mesh plot height field terrain contour wireframe grid" },
              { type: "contour", label: "Contour", description: "The flat twin of Surface: the same table of heights drawn as filled height bands with iso-lines.", create: () => new SurfaceNode({ op: "contour" }), parity: false, keywords: "contour iso lines level topo topographic height map bands field 2d surface" },
              { type: "quiver", label: "Vector Field", description: "One arrow per grid cell from two same-shaped matrices (the X and Y components), colored by magnitude. For gradients, flows, and wind fields.", create: () => new QuiverNode(), parity: false, keywords: "quiver vector field arrows flow gradient wind direction magnitude" },
            ],
          },
          {
            type: "category", label: "Time & Finance", description: "Values over time: candles, bridges, and daily activity.",
            children: [
              { type: "candlestick", label: "Candlestick", description: "OHLC candles for price history from a Date, Open, High, Low, Close frame, the shape Data Feed's stock history has.", create: () => new CandlestickNode(), parity: false, keywords: "candlestick candle ohlc stock price open high low close market trading finance" },
              { type: "waterfall", label: "Waterfall", description: "The finance bridge chart: each row of a 2-column frame (Label, Delta) steps the running total up or down, with a computed Total bar at the end.", create: () => new WaterfallNode(), parity: false, keywords: "waterfall bridge chart delta variance walk finance running total steps" },
              { type: "calendar-heatmap", label: "Calendar", description: "A year of daily activity as a weeks-by-weekdays grid, each day tinted by its value from a Date, Value frame. Duplicate days sum.", create: () => new CalendarHeatmapNode(), parity: false, keywords: "calendar heatmap daily activity year contribution github days streak" },
            ],
          },
        ],
      },
      { type: "pair", children: [
        { type: "convert", label: "Convert", description: "Converts a value to another unit and rescales the number: length, mass, temperature, time, speed, energy and more. Excel: `CONVERT`.", create: () => new ConvertNode() },
        { type: "cast", label: "Cast", description: "Changes a value's type to number, text, date, `TRUE`/`FALSE` or complex, item by item on Lists. Excel: `TEXT`, `VALUE`.", create: () => new CastNode(), parity: false },
      ]},
      { type: "group", label: "Node Group", description: "A container: drop it around nodes, or select them and press G. Its header moves them together. Collapse it to a summary.", create: () => new GroupNode(), parity: false },
      { type: "pair", children: [
        { type: "composite", label: "Composite", description: "A reusable subgraph as one card with a typed boundary. Built inside via Edit contents, or from selected nodes with Ctrl+Shift+G.", create: () => new CompositeNode(), parity: false },
        { type: "query", label: "Query", description: "A Composite shaped for data transformation: table in, verb chain inside, result out. Recomputes only on Refresh. Excel: Power Query.", create: () => new CompositeNode({
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
      { type: "composite-input", label: "Composite Input", description: "Internal: a Composite's exposed-input boundary marker.", create: () => new CompositeInputNode(), parity: false, hidden: true },
      { type: "composite-output", label: "Composite Output", description: "Internal: a Composite's output boundary marker.", create: () => new CompositeOutputNode(), parity: false, hidden: true },
      { type: "conduit",    label: "Conduit",   description: "Bundle up to 8 cables into one block. They travel onward as a single ribbon that splits back into lanes at the destination. Rotate or extend it.", create: () => new ConduitNode(), parity: false },
      { type: "alert",     label: "Alert",    description: "Watches a value and fires a toast and an Alerts HUD entry on a status change: a Low/High range, `TRUE`, any new value, or a threshold cross.", create: () => new AlertNode() },
      {
        type: "category", label: "Data Quality", description: "Trust the graph: validate values in place, and rank which upstream inputs matter most.",
        children: [
          { type: "expect", label: "Expect", description: "Data validation: opt-in checks for not-null, unique, in range, regex or allowlist. A failure never blocks the value; it shows a red badge and fires an Alert once per new failure.", create: () => new ExpectNode(), parity: false, keywords: "expect validate validation data quality check rule assert not null unique range regex allowlist in list membership enum whitelist trust" },
          { type: "tornado", label: "Tornado", description: "One-at-a-time sensitivity: Run perturbs each upstream Number or Slider ±10% and ranks them by how far this value swings, as a tornado chart.", create: () => new TornadoNode(), parity: false, keywords: "tornado sensitivity analysis what-if one at a time impact ranking swing trust" },
        ],
      },
      { type: "presentation", label: "Presentation", description: "Presenter mode: select nodes, Add step captures them, Prev/Next steps through. Each step flies the camera to fit its nodes.", create: () => new PresentationNode(), parity: false },
      { type: "session-history", label: "Session History", description: "A live log of this session's undo and redo actions, like nodes added, moved or removed and connections made or broken, with a copy button. It isn't saved.", create: () => new SessionHistoryNode(), parity: false },
    ],
  },

  // ── NUMBERS ──────────────────────────────────────────────────────────────────
  {
    type: "category", label: "Numbers", description: "Scalar math: arithmetic, functions, rounding, and trigonometry.",
    children: [
      { type: "pair", children: [
        { type: "expression", label: "Expression", description: "A formula like `a*b+1`, where each variable becomes an input. Works on single values, Lists and matrices, with the Excel functions and the constants `pi`, `tau`, `e` and `phi`. For Frames, use a computed column.", create: () => new ExpressionNode(), accent: NODE_KIND_ACCENTS.math },
        { type: "equation", label: "Equation", description: "A relation like `V = I * R`: the one empty variable solves, a quadratic giving every real root. All given, Check turns `TRUE` or `FALSE`.", create: () => new EquationNode(), accent: NODE_KIND_ACCENTS.math, keywords: "solve rearrange unknown goal seek formula bidirectional check quadratic roots" },
      ]},
      { type: "script", label: "Script", description: "Runs JavaScript. Return `[ ]` for a List, `[[ ]]` for a table, `[{name: value}, …]` for a Frame or `[{name: [rows]}, …]` for a Cube; `Solenoid.date(serial)` returns a date. Runs sandboxed, with a 1-second limit.", keywords: "script javascript js code function program custom", create: () => new ScriptNode(), accent: NODE_KIND_ACCENTS.math },
      {
        type: "category", label: "Arithmetic", description: "Two-input operations on numbers.",
        children: [
          { type: "pair", children: [arithLeaf("add"), arithLeaf("sub")] },
          { type: "pair", children: [arithLeaf("mul"), arithLeaf("div")] },
          { type: "pair", children: [arithLeaf("mod"), arithLeaf("quotient")] },
          arithLeaf("pow"),
          { type: "pair", children: [
            { type: "gcd-lcm", label: "GCD", description: "Greatest common divisor of two integers. Excel: `GCD`.", create: () => new GCDNode() },
            { type: "lcm", label: "LCM", description: "Least common multiple of two integers. Excel: `LCM`.", create: () => new GCDNode({ op: "lcm" }) },
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
      {
        type: "category", label: "Rounding", description: "Round and constrain numbers.",
        children: [
          mathLeaf("trunc"),
          { type: "pair", children: [
            { type: "math-ceiling", label: "CEILING", description: "Rounds up to a multiple (toward +∞). The multiple defaults to 1 so it snaps up to the next integer. Excel: `CEILING.MATH`.", create: () => new MRoundNode({ op: "up" }), keywords: "ceil ceiling round up multiple significance" },
            { type: "math-floor", label: "FLOOR", description: "Rounds down to a multiple (toward −∞). The multiple defaults to 1 so it snaps down to the next integer. Excel: `FLOOR.MATH`.", create: () => new MRoundNode({ op: "down" }), keywords: "floor round down multiple significance" },
          ]},
          { type: "pair", children: [
            mathLeaf("int"),
            { type: "math-mround", label: "MROUND", description: "Rounds to nearest multiple. Excel: `MROUND`.", create: () => new MRoundNode(), keywords: "mround round nearest multiple ceil floor ceiling" },
          ]},
          { type: "pair", children: [mathLeaf("even"), mathLeaf("odd")] },
          { type: "roundn-round", label: "ROUND", description: "Rounds to N decimal places. Excel: `ROUND`.", keywords: "rounding", create: () => new RoundNNode({ op: "round" }) },
          { type: "pair", children: [
            { type: "roundn-dir", label: "ROUNDUP", description: "Rounds away from zero to N decimal places. Excel: `ROUNDUP`.", keywords: "rounding", create: () => new RoundNNode({ op: "roundup" }) },
            { type: "roundn-down", label: "ROUNDDOWN", description: "Rounds toward zero to N decimal places. Excel: `ROUNDDOWN`.", keywords: "rounding", create: () => new RoundNNode({ op: "rounddown" }) },
          ]},
          { type: "clamp", label: "Clamp", description: "Constrain a value to `[min, max]`. Excel: `MIN(MAX(x,min),max)`.", create: () => new ClampNode() },
        ],
      },
      {
        type: "category", label: "Logarithms", description: "Logarithms and their inverses.",
        children: [
          mathLeaf("log"),
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
          { type: "multinomial", label: "MULTINOMIAL", description: "Multinomial coefficient `(n₁+n₂+…)! / (n₁!·n₂!·…)`. Excel: `MULTINOMIAL`.", create: () => new MultinomialNode() },
        ],
      },
      {
        type: "category", label: "Engineering", description: "`DELTA`, `GESTEP`, `SERIESSUM`, base conversion, and bitwise integer ops: Excel's Engineering set.",
        children: [
          { type: "pair", children: [twoMathLeaf("delta"), twoMathLeaf("gestep")] },
          { type: "seriessum", label: "SERIESSUM", description: "Power series sum `Σ cᵢ·x^(n+i·m)` using a list of coefficients. Excel: `SERIESSUM`.", create: () => new SeriesSumNode() },
          { type: "base-convert", label: "Base Convert", description: "Converts an integer between bases 2–36 using digits 0–9 only; a digit outside the source base or a result needing letters is `null`. Excel: `BIN2DEC`, `DEC2BIN`, `OCT2DEC`, `DEC2OCT`.", create: () => new BaseConvertNode(), parity: false },
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
        type: "category", label: "Complex Numbers", description: "Build complex numbers (`a+bi`), extract parts, and apply complex arithmetic and functions.",
        children: [
          { type: "cx-unpack", label: "IM Unpack",  description: "Extracts Real, Imaginary, `|z|`, and `arg(z)` from a complex number. Excel: `IMREAL` / `IMAGINARY` / `IMABS` / `IMARGUMENT`.", create: () => new ComplexUnpackNode(), parity: false },
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
              { type: "cx-power", label: "IMPOWER", description: "Complex number raised to a real power. Excel: `IMPOWER`.", create: () => new ComplexPowerNode(), parity: false },
              { type: "cx-quadratic", label: "Quadratic Roots", description: "Both roots of `ax² + bx + c = 0` as complex numbers. A negative discriminant gives the conjugate pair. The Equation node covers the real-root case.", create: () => new QuadraticRootsNode(), parity: false, keywords: "quadratic formula discriminant complex roots polynomial" },
            ],
          },
        ],
      },
      {
        type: "category", label: "Distributions", description: "Probability distributions and related helpers.",
        children: [
          { type: "distributions", label: "Distributions", description: "Any distribution as CDF, PDF, PMF, tail, or inverse: normal, t, chi-squared, binomial, Poisson. Excel: the `NORM.DIST` / `T.INV` families.", create: () => new DistributionsNode(), keywords: "distribution probability cdf pdf pmf inverse quantile percentile critical value tail gaussian bell curve critbinom phi gauss standard normal density" },
          { type: "pair", children: [
            { type: "stat-standardize", label: "STANDARDIZE", description: "z-score: `(value − mean) ÷ std dev`. Excel: `STANDARDIZE`.", create: () => new StandardizeNode(), keywords: "probability z score normalize" },
            { type: "binomdistrng", label: "BINOM.DIST.RANGE", description: "`P(lo ≤ X ≤ hi)`: the sum of binomial PMFs over a range. Excel: `BINOM.DIST.RANGE`.", create: () => new BinomDistRangeNode(), keywords: "binom.dist.range" },
          ]},
        ],
      },
    ],
  },

  // ── DOCS & FILES ─────────────────────────────────────────────────────────────
  {
    type: "category", label: "Docs & Files", description: "Documents and files: markdown notes and reports, your Obsidian vault, and attached pictures, files and graphics.",
    children: [
      { type: "pair", children: [
        { type: "note", label: "Note", description: "A free-floating markdown note, any position, any tint. Open the body with a ----fenced YAML block to turn each key into a typed output, a note doubling as a constants source. The body is a Knap template over those fields: `{{ title }}`, `{% if %}`, `{% for %}` and the standard filters.", create: () => new NoteNode(), parity: false },
        { type: "report", label: "Report", description: "A markdown document written as a Knap template. `{{ name }}` shows a value the way the canvas does, `{% for %}` repeats over a Frame and `{% if %}` gates a section. A Note on Template supplies the text instead, and Records turns it into a mail merge, one page per row. The Knap tab in Help has the syntax.", keywords: "mail merge merge fields letters one note per row batch template document markdown knap", create: () => new ReportNode(), parity: false },
      ]},
      { type: "pair", children: [
        { type: "image", label: "Image", description: "A free-floating picture from a local file or a web URL. Annotation only, no data. Web URLs persist; local files are session-only.", create: () => new ImageNode(), parity: false },
        { type: "file-link", label: "File Link", description: "A link to a file on your computer: the path, not the file. Shows a title and preview with an Open button that launches it in its default app. Annotation only, no data. On desktop the link persists in the save; on the web an attach is session-only.", create: () => new FileLinkNode(), parity: false, keywords: "file link attachment attach open path shortcut document local disk launch reference external" },
      ]},
      { type: "pair", children: [
        { type: "svg", label: "SVG", description: "An interactive SVG from a local `.svg` or a URL: the selected shape outputs its name, so a map, floorplan, or schematic becomes a selector.", create: () => new SvgPickerNode(), parity: false, keywords: "svg map picker region layer shape hotspot clickable diagram floorplan schematic slice filter select vector" },
        { type: "promo", label: "✨ Promo", description: "A random Solenoid tagline. Re-rolls on recalc (F9). Pure easter egg.", create: () => new PromoNode() },
      ]},
      {
        type: "category", label: "Obsidian", description: "Your vault as data and back: notes and tasks in, notes and properties out. A folder of tasks read as a Vault Folder gives title, status, priority, due and tags; TaskNotes adds the rest. Set the vault in Settings ▸ Obsidian. Desktop only.",
        children: [
          { type: "vault-folder", label: "Vault Folder", description: "Reads an Obsidian vault folder as one cube: a row per note, file columns plus every frontmatter key. Types from an mdbase schema or types.json. Desktop only.", create: () => new VaultFolderNode(), parity: false, keywords: "obsidian vault notes markdown frontmatter cube folder mdbase bases properties tags links daily notes tasknotes" },
          { type: "import-obsidian", label: "Import Obsidian Note", description: "A `.md` note from your Obsidian vault as a read-only Note: frontmatter becomes typed outputs, the body renders inline. Desktop only.", create: () => new ImportObsidianNode(), parity: false, keywords: "obsidian vault markdown md note import read source frontmatter" },
          { type: "tasknotes", label: "TaskNotes", description: "Reads what a folder of files can't total: time tracked per task, recurring and completed instances, the calendar of events between two dates, the task-count stats. Through the TaskNotes plugin's local API. Turn the API on in the plugin; the address is in Settings ▸ Obsidian, the token on the card.", create: () => new TaskNotesNode(), parity: false, keywords: "tasknotes task notes obsidian plugin api tasks todo due scheduled projects calendar events stats time tracking timeEntries" },
          { type: "write-obsidian", label: "Write to Obsidian", description: "Writes a Note, a Report, or a cube of rows into your Obsidian vault. A Note or Report becomes one markdown note with its tables, diagrams, math and charts; a mail-merge Report writes one note per page. Rows write each note's frontmatter and body, keyed by a path column and patched line by line. Preview shows what Run would do. Never writes on its own. Desktop only.", create: () => new WriteObsidianNode(), parity: false, keywords: "obsidian vault markdown md note export sink write document properties frontmatter yaml note-body cube patch bases plan preview" },
          { type: "write-tasks", label: "Write Tasks", description: "Creates or updates TaskNotes tasks from rows: a row with a path updates that task, one without creates it from its title. Sends the writable task fields present, or the ones you list. Preview marks the rows that would not change; Run sends the rest. Never writes on its own.", create: () => new WriteTasksNode(), parity: false, keywords: "write tasks tasknotes obsidian create update sink api post put plan preview" },
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
          { type: "list-concat",   label: "Concat Lists", description: "Joins lists end-to-end, in row order. A lone value counts as a 1-element list. Any element type. To stack lists as rows of a table instead, use `VSTACK`.", create: () => new ConcatListsNode(), keywords: "append join combine concatenate push" },
          seriesLeaf("repeat"),
          { type: "pair", children: [
            seriesLeaf("geometric"),
            seriesLeaf("fibonacci"),
          ]},
          { type: "list-randarray", label: "RANDARRAY", description: "List of N random numbers between Min and Max. Excel: `RANDARRAY`.", create: () => new RandArrayNode(), parity: false },
          { type: "list-combinations", label: "Combinations", description: "Every way to choose k items from the list, one row each: combinations (order-independent) or permutations. Python `itertools`.", create: () => new CombinationsNode(), parity: false, keywords: "combinations permutations itertools choose subsets arrangements nCk nPk pairs tuples pick sample without replacement" },
          seriesLeaf("sequence", { parity: false }),
        ],
      },
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
        type: "category", label: "Shape", description: "Reorder, trim, and filter lists.",
        children: [
          { type: "list-filter",  label: "List Filter", description: "Keeps the List values that pass its condition rows, joined by AND or OR; the rest go to Dropped. Text tests ignore case unless a row's Match case is on. `No error` drops error cells and `Has error` keeps only them. For a table's rows, use Frame Filter. Excel: `FILTER`.", accent: NODE_KIND_ACCENTS.list, create: () => new FilterNode(), keywords: "keep where condition predicate drop errors iserror noterror div0 remove errors clean" },
          { type: "list-fill",  label: "Fill", keywords: "coalesce fill missing null impute interpolate", description: "Handles missing cells: a constant, forward/back-fill, mean/median/mode, interpolate, drop, or coalesce lists in order like SQL `COALESCE`.", accent: NODE_KIND_ACCENTS.list, create: () => new FillNode() },
          { type: "pair", children: [
            { type: "list-sort",    label: "List Sort", description: "Sorts a list ascending or descending, by its own values or by a parallel key list (sort names by their scores). Excel: `SORT` / `SORTBY`.", create: () => new SortNode() },
            { type: "list-reverse", label: "REVERSE", description: "Reverses the order of the list", create: () => new ReverseNode() },
          ]},
          { type: "pair", children: [
            { type: "list-slice", label: "SLICE",  description: "Sublist from Start to End, 1-based inclusive. Leave End blank to run to the end.", create: () => new SliceNode() },
            { type: "list-pad",   label: "Pad", description: "Extends a list to a target length by prepending or appending a fill value. Excel: `PADLEFT` / `PADRIGHT`.", create: () => new PadNode() },
          ]},
          { type: "list-unique",  label: "UNIQUE", description: "Removes duplicates, preserving first-occurrence order. Excel: `UNIQUE`.", create: () => new UniqueNode() },
          { type: "list-sets",  label: "Sets", description: "Set operations on two lists: union, intersection, difference, symmetric difference; the relations equal, subset, superset, disjoint give `TRUE` or `FALSE`. Excel builds these from `COUNTIF`.", create: () => new SetsNode(), parity: false, keywords: "set union intersect intersection difference except minus complement symmetric relation equal same identical subset superset disjoint overlap contains all within compare two lists distinct dedupe subtract exclude common membership issubset issuperset predicate test boolean" },
          { type: "pair", children: [
            { type: "list-shuffle",    label: "Shuffle",    description: "Randomly reorders the list, Fisher-Yates. With a weight per element, higher weights tend to land earlier: a weighted draw without replacement.", create: () => new ShuffleNode(), keywords: "shuffle random reorder permutation weighted weights sample without replacement np.random.choice pick draw lottery" },
            { type: "list-interleave", label: "Interleave", description: "Alternate elements of two lists: `A[0]`, `B[0]`, `A[1]`, `B[1]`, …", create: () => new InterleaveNode() },
          ]},
          { type: "list-nthelement", label: "Nth Element", description: "Every N-th element. Step subsampling.", create: () => new NthElementNode() },
        ],
      },
      {
        type: "category", label: "Transform", description: "Element-wise transforms: differences, rolling aggregates, rescaling, binning, shifting.",
        children: [
          { type: "pair", children: [
            { type: "list-diff",       label: "DIFF",       description: "Change between consecutive values: absolute, percent, or the length-keeping central gradient. numpy `diff` / `gradient`, pandas `pct_change`.", create: () => new DiffNode(), keywords: "difference diff delta change percent pct_change growth rate return consecutive derivative gradient slope numpy" },
            { type: "list-running", label: "Running", description: "One aggregate per element over everything so far, or the last N with a window: `SUM`, `AVERAGE`, `MIN`, `MAX`, `MEDIAN`, `PRODUCT`, `STDEV`.", create: () => new RunningNode(), keywords: "running total cumulative rolling moving average sliding window prefix sum accumulate expanding cumsum min max median product stdev" },
          ]},
          { type: "pair", children: [
            { type: "list-normalize",  label: "Normalize",  description: "Rescale a list: to the 0–1 range (min→0, max→1), or to z-scores (distance from the mean in stdevs). numpy/R `scale`.", create: () => new NormalizeNode(), keywords: "normalize rescale scale 0-1 minmax z-score zscore standardize mean stdev standard deviation feature scaling" },
            { type: "list-bin",       label: "Bin",           description: "Each value's bin by given breakpoints, or by n equal-count quantile buckets. R `findInterval`, numpy `digitize`, dplyr `ntile`, pandas `qcut`.", create: () => new BinNode(), parity: false, keywords: "bin cut findinterval digitize bucket histogram interval discretize quantile ntile qcut quartile decile percentile" },
          ]},
          { type: "list-outliers",  label: "Outliers",      description: "Flags outliers by the z-score, IQR or MAD rule: a frame with a cleaned Value column and a logical Outlier flag. scipy `zscore`, R `boxplot.stats`.", create: () => new OutliersNode(), parity: false, keywords: "outlier anomaly zscore z-score iqr mad boxplot whisker robust clean remove extreme" },
          { type: "pair", children: [
            { type: "list-shift",     label: "Shift",         description: "Slides the list by N places (negative = earlier); vacated slots go blank, or wrap around. pandas `shift` / numpy `roll`.", create: () => new ShiftNode(), parity: false, keywords: "shift lag lead roll offset displace slide delay pandas numpy" },
            { type: "list-ewma",      label: "EWMA",          description: "Exponentially weighted moving average: recent values weigh more, controlled by Alpha (0–1). Smoother than a flat window. pandas `ewm`.", create: () => new EwmaNode(), parity: false, keywords: "ewma exponential weighted moving average smoothing ema alpha decay pandas ewm smooth" },
          ]},
          { type: "pair", children: [
            { type: "list-rle",       label: "Run Lengths",   description: "Compresses consecutive equal values into rows of value and run-length. R `rle` / run-length encoding.", create: () => new RleNode(), parity: false, keywords: "rle run length encoding compress consecutive runs streak count repeats groups" },
            { type: "list-trapz",     label: "Integrate",     description: "Area under the curve through the points by the trapezoidal rule, at uniform spacing dx. The integral counterpart to `DIFF`'s gradient. `numpy.trapz`.", create: () => new TrapzNode(), parity: false, keywords: "integrate integral trapz trapezoidal area under curve auc cumulative numpy calculus" },
          ]},
        ],
      },
      {
        type: "category", label: "Find", description: "Look up values and positions.",
        children: [
          { type: "pair", children: [
            { type: "lookup-xlookup", label: "XLOOKUP", description: "Finds a value in one column of a Frame or Cube and returns the matching cell from another. A List of lookup values returns one match each, and Return = `*` gives the whole row. Exact match by default; ≤ or ≥ falls back to the closest smaller or larger number or date. First or Last picks which duplicate wins, and If not found replaces `#N/A`. For two Lists, combine them with Frame from Lists first. Excel: `XLOOKUP`, `VLOOKUP`.", accent: NODE_KIND_ACCENTS.frame, keywords: "xlookup vlookup hlookup lookup frame cube table list match find nested column", create: () => new XLookupNode() },
            { type: "lookup-xmatch",  label: "XMATCH",  description: "1-based position with match mode selector (exact / next larger / next smaller); a list of lookup values returns one position each. Supersedes the classic `MATCH`. Excel: `XMATCH`.", create: () => new XMatchNode() },
          ]},
          { type: "pair", children: [
            { type: "list-length", label: "LENGTH",  description: "Number of elements in the list. Like Excel's `ROWS`, or `COUNTA` for a filled range.", create: () => new ListLengthNode() },
            { type: "list-index",  label: "INDEX",   description: "One cell from any container: the nth of a list, or Row, Column of a Matrix, Frame or Cube. An empty one takes the whole row or column. Excel: `INDEX`.", create: () => new ListIndexNode(), keywords: "cube frame cell nested drill get cell unnest slice whole row column" },
          ]},
          { type: "pair", children: [argLeaf("argmax"), argLeaf("argmin")] },
          { type: "pair", children: [argLeaf("argsort"), argLeaf("which")] },
          { type: "list-contains", label: "CONTAINS", description: "`TRUE` if the list contains the value, any element type, keyed by value. Excel: `ISNUMBER(MATCH(value,range,0))`.", create: () => new ContainsNode() },
        ],
      },
      { type: "group-lists", label: "Group Lists", description: "Groups a key list and a parallel value list, one aggregate per key, as a Key, Value frame. Whole tables use GROUPBY. Excel: `GROUPBY`, 1D.", create: () => new GroupListsNode(), parity: false },
      {
        type: "category", label: "Rank", description: "Rank, percentile, and distribution queries.",
        children: [
          { type: "pair", children: [rpLeaf("large"), rpLeaf("small")] },
          rpLeaf("percentile-inc", { label: "PERCENTILE", description: "Value at percentile p (0–1). Excel: `PERCENTILE.INC`." }),
          rpLeaf("quartile-inc", { label: "QUARTILE", description: "Quartile Q0–Q4. Excel: `QUARTILE.INC`." }),
          rpLeaf("percentrank-inc", { label: "PERCENTRANK", description: "Percentile rank of a value (0–1). Excel: `PERCENTRANK.INC`." }),
          { type: "pair", children: [rpLeaf("rank-eq"), rpLeaf("rank-avg")] },
        ],
      },
      {
        type: "category", label: "Regression", description: "Fit or interpolate: predict y from known data and measure the fit.",
        children: [
          { type: "linest",  label: "LINEST",  description: "Fits a line with `LINEST`, giving slope, intercept and R², or a growth curve with `LOGEST`, giving m, b and R² on the log scale.", create: () => new LinestNode(), parity: false, keywords: "linest logest slope intercept rsq regression fit linear exponential growth curve least squares" },
          { type: "forecast", label: "FORECAST.LINEAR", description: "Predict Y for one X or a list of them from known data: a straight line or a growth curve y = b·mˣ. Excel: `FORECAST.LINEAR` / `TREND`, or `GROWTH`.", create: () => new ForecastNode(), parity: false, keywords: "forecast trend growth predict linear exponential regression fit extrapolate" },
          regressionLeaf("steyx"),
          { type: "polyfit", label: "Poly Fit", description: "Least-squares polynomial fit of the chosen degree, evaluated back over the data. Degree 1 is a line, 2 a parabola, and so on. `numpy.polyfit` + `polyval`.", create: () => new PolyfitNode(), parity: false, keywords: "polynomial fit polyfit polyval regression curve degree quadratic cubic least squares numpy trendline" },
          { type: "ets-forecast", label: "Forecast (ETS)", description: "Holt-Winters smoothing: a forecast N steps ahead with a 95% band. statsmodels `ExponentialSmoothing`, R `HoltWinters`. Excel `FORECAST.ETS`, roughly.", create: () => new EtsForecastNode(), parity: false, keywords: "forecast ets exponential smoothing holt winters seasonal time series predict trend season confint seasonality" },
          { type: "interpolate", label: "INTERPOLATE", description: "Estimates values between known points, not a regression fit. List mode finds y for an x along a line of points. Grid mode interpolates over a table of heights, with optional Xs and Ys that count 1, 2, 3… when left out. Forecast, on by default, extends past the range. Useful for lookup tables like steam tables, pump curves and hardness conversions.", create: () => new InterpolateNode(), parity: false },
        ],
      },
      {
        type: "category", label: "Tests", description: "Hypothesis tests. Each returns a p-value.",
        children: [
          testLeaf("z", { parity: false }),
          { type: "pair", children: [testLeaf("t-paired", { parity: false }), testLeaf("t-equal", { parity: false })] },
          testLeaf("t-welch"),
          { type: "pair", children: [testLeaf("f"), testLeaf("chisq")] },
          testLeaf("anova", { parity: false, keywords: "anova f_oneway aov one-way groups means" }),
          { type: "pair", children: [testLeaf("proptest", { parity: false, keywords: "proportion z test rates conversion a/b ab test" }), testLeaf("binomtest", { parity: false, keywords: "binomial exact test successes trials" })] },
        ],
      },
      {
        type: "category", label: "Stats", description: "Distribution summaries and frequency analysis.",
        children: [
          { type: "mode",      label: "MODE",      description: "Most frequent value: one number, or every tied value as a list; no arbitrary tie-break. One node replaces Excel's `MODE.SNGL`, which picks one on a tie, and `MODE.MULT`, which always returns an array.", create: () => new ModeNode() },
          { type: "trimmean", label: "TRIMMEAN",  description: "Average after removing the top and bottom p/2 fraction of values. Excel: `TRIMMEAN`.", create: () => new TrimMeanNode() },
          { type: "frequency", label: "FREQUENCY", description: "Counts values falling into each bin interval. The result has `bins+1` elements. Excel: `FREQUENCY`.", create: () => new FrequencyNode() },
          { type: "pair", children: [
            { type: "confidence-norm", label: "CONFIDENCE.NORM", description: "Normal-distribution confidence interval half-width. Excel: `CONFIDENCE.NORM`.", create: () => new ConfidenceNode({ op: "norm" }) },
            { type: "confidence-t",    label: "CONFIDENCE.T",    description: "t-distribution confidence interval half-width. Excel: `CONFIDENCE.T`.", create: () => new ConfidenceNode({ op: "t" }) },
          ]},
          { type: "prob", label: "PROB", description: "Sum of probabilities for values in a range `[lo, hi]`. Excel: `PROB`.", create: () => new ProbNode() },
        ],
      },
    ],
  },

  // ── LOGIC ────────────────────────────────────────────────────────────────────
  {
    type: "category", label: "Logic", description: "Decisions, comparisons, boolean operations, and fallback handling.",
    children: [
      { type: "if", label: "IF", description: "Returns Value if true when Condition is true, and Value if false otherwise. Excel: `IF`.", create: () => new IfNode(), accent: NODE_KIND_ACCENTS.logic },
      { type: "comparison", label: "Comparison",  description: "Compares two values (`=`, `≠`, `<`, `>`, `≤`, `≥`) and emits a logical `TRUE` or `FALSE`. Broadcasts over a list.", keywords: "compare", create: () => new ComparisonNode() },
      { type: "choose",  label: "CHOOSE",        description: "Returns one of several values by a 1-based index. Excel: `CHOOSE`.", create: () => new ChooseNode() },
      { type: "switch",  label: "SWITCH",         description: "Matches a value against as many cases as you add and returns the matching result, or a default. Excel: `SWITCH`.", create: () => new SwitchNode() },
      { type: "ifs",     label: "IFS",            description: "Returns the first value whose condition is non-zero, like chained `IF`, plus an Otherwise fallback. Excel: `IFS`.", create: () => new IfsNode() },
      { type: "pair", children: [
        { type: "iferror", label: "IFERROR", description: "Returns Fallback when Value is an error. A blank is not an error and passes through. Excel: `IFERROR`.", create: () => new IFErrorNode() },
        { type: "ifna", label: "IFNA", description: "Returns Fallback only when Value is `#N/A`; other errors pass through. Excel: `IFNA`.", create: () => new IFErrorNode({ op: "ifna" }) },
      ]},
      { type: "is-test", label: "Type Check", description: "A value's kind: number, blank, error, N/A, boolean or text. Excel: `ISNUMBER`, `ISBLANK`, `ISERROR`, `ISNA`, `ISLOGICAL`, `ISTEXT`, `ISNONTEXT`.", keywords: "is isnumber istext isblank iserror isna islogical isnull isnontext number blank error boolean logical text", create: () => new IsTestNode() },
      { type: "pair", children: [
        { type: "iseven-isodd", label: "ISEVEN", description: "`TRUE` if a number's integer part is even. Emits a logical and broadcasts over a list. Excel: `ISEVEN`.", create: () => new IsEvenOddNode() },
        { type: "isodd", label: "ISODD", description: "`TRUE` if a number's integer part is odd. Emits a logical and broadcasts over a list. Excel: `ISODD`.", create: () => new IsEvenOddNode({ op: "isodd" }) },
      ]},
      { type: "pair", children: [
        { type: "between", label: "Between", description: "`TRUE` when Low ≤ Value ≤ High (inclusive). R `between` / pandas `Series.between`.", create: () => new BetweenNode(), parity: false, keywords: "between range within inclusive bounds interval clamp test low high" },
        { type: "isclose", label: "Is Close", description: "`TRUE` when `|A − B| ≤ tolerance`: approximate equality for floats. `math.isclose` / `numpy.isclose`.", create: () => new IsCloseNode(), parity: false, keywords: "is close approximately equal tolerance almost float rounding epsilon isclose numpy" },
      ]},
      {
        type: "category", label: "Boolean", description: "Combine 0/1 signals. Any non-zero input counts as true.",
        children: [
          { type: "pair", children: [booleanLeaf("and"), booleanLeaf("or")] },
          { type: "not", label: "NOT", description: "Flips a single input: true → `FALSE`, false → `TRUE`. Broadcasts over a list. Excel: `NOT`.", create: () => new NotNode() },
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
          { type: "tvm", label: "Time Value of Money", description: "One relation over rate, nper, pmt, pv and fv: any four given and the fifth solves; all five and Check answers TRUE or FALSE. Excel: `PMT`, `PV`, `FV`, `NPER`, `RATE`.", create: () => new TvmNode(), keywords: "pmt pv fv nper rate loan annuity payment mortgage present future value" },
          { type: "amortization", label: "Amortization Schedule", description: "A loan table with one row per period: Payment, Interest, Principal and the remaining Balance. The rate is per period, and payment timing is set on the node. Excel: `PMT`, `IPMT`, `PPMT`.", create: () => new AmortizationNode(), parity: false, keywords: "amortization amortisation schedule loan mortgage table payment interest principal balance ipmt ppmt pmt" },
          { type: "returns", label: "Returns", description: "The return-series one-liners: log or simple returns, cumulative return, drawdown, CAGR, volatility, Sharpe and Sortino. pandas `pct_change`.", create: () => new ReturnsNode(), parity: false, keywords: "log returns returns log return pct_change cumulative drawdown max drawdown cagr volatility sharpe sortino risk-free annualize annualise quant performance portfolio price series" },
          { type: "fin-compound-growth", label: "Compound Growth", description: "Lump-sum growth `fv = pv·(1+rate)^nper`: any three give the fourth. Excel: `FV` or `PV` without `pmt`, `PDURATION` for `nper`, `RRI` for `rate`.", create: () => new EquationNode({ label: "Compound Growth", expr: "fv = pv * (1 + rate)^nper", locked: true }), keywords: "pduration rri compound interest growth doubling lump sum" },
        ],
      },
      {
        type: "category", label: "Rate conversion", description: "Convert between nominal and effective interest rates.",
        children: [
          { type: "fin-effective-rate", label: "Effective Rate", description: "APR ↔ APY: `eff = (1 + nom/npery)^npery − 1`. Two of nominal rate, effective rate, and compounds-per-year. The third solves. Excel: `EFFECT`, `NOMINAL`.", create: () => new EquationNode({ label: "Effective Rate", expr: "eff = (1 + nom/npery)^npery - 1", locked: true }), keywords: "effect nominal apr apy compounding annual percentage yield" },
        ],
      },
      {
        type: "payment-breakdown", label: "Payment Breakdown",
        description: "Splits a loan payment into interest and principal, for one period or cumulatively across a range of periods. Excel: `IPMT`, `PPMT`, `CUMIPMT`, `CUMPRINC`.",
        create: () => new PaymentBreakdownNode(),
        keywords: "payment breakdown ipmt ppmt cumipmt cumprinc interest principal loan amortization period cumulative range",
      },
      {
        type: "category", label: "Cash flow analysis", description: "NPV, IRR, MIRR for irregular cash flows.",
        children: [
          { type: "npv",  label: "NPV",  description: "Net present value of cash flows discounted at a given rate. The first flow is period 1. Excel: `NPV`.", create: () => new NPVNode() },
          { type: "irr",  label: "IRR",  description: "Internal rate of return: the rate at which `NPV = 0`. Excel: `IRR`.", create: () => new IRRNode() },
          { type: "mirr", label: "MIRR", description: "Modified IRR accounting for reinvestment rate and cost of capital. Excel: `MIRR`.", create: () => new MirrNode() },
          { type: "xirr", label: "XIRR", description: "IRR for cash flows at irregular dates, from a list of flows and a parallel list of dates. Excel: `XIRR`.", create: () => new IRRNode({ op: "dates" }), parity: false },
          { type: "xnpv", label: "XNPV", description: "Net present value of cash flows, each with an explicit date. Excel: `XNPV`.", create: () => new NPVNode({ op: "dates" }), parity: false },
        ],
      },
      {
        type: "category", label: "Bond pricing", description: "Price and yield for coupon bonds.",
        children: [
          { type: "bond-pricing", label: "Bond Pricing", description: "A coupon bond's price from its yield, or yield from price, `30/360` basis, odd first or last coupons too. Excel: `PRICE`, `YIELD`, `ODDF` / `ODDL`.", create: () => new BondPricingNode(), parity: false, keywords: "bond price yield coupon clean price yield to maturity ytm odd first last irregular period redemption par frequency" },
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
          { type: "fvschedule", label: "FVSCHEDULE", description: "Future value of principal after applying a schedule of interest rates. Excel: `FVSCHEDULE`.", create: () => new FvScheduleNode() },
          { type: "ispmt",      label: "ISPMT",      description: "Interest paid in a specific period of a straight-line-principal loan. Excel: `ISPMT`.", create: () => new IspmtNode() },
          { type: "pair", children: [dollarLeaf("dollarde"), dollarLeaf("dollarfr")] },
          { type: "discount-security", label: "Discount Security", description: "Price, yield and discount rate for non-coupon securities. Excel: `TBILLEQ`, `TBILLPRICE`, `TBILLYIELD`, `DISC`, `PRICEDISC`, `YIELDDISC`, `INTRATE`, `RECEIVED`, `PRICEMAT`, `YIELDMAT`.", create: () => new DiscountSecurityNode(), parity: false, keywords: "treasury bill t-bill tbill discount discounted security paper note zero coupon price yield rate redemption investment received interest at maturity money market bond equivalent" },
          { type: "accrued-interest", label: "Accrued Interest", description: "Interest a security has earned since issue but not yet paid at settlement, periodic or at maturity. Excel: `ACCRINT`, `ACCRINTM`.", create: () => new AccruedInterestNode(), parity: false, keywords: "accrued interest accrint accrintm coupon issue settlement periodic maturity bond par" },
          { type: "pair", children: [durationLeaf("duration"),  durationLeaf("mduration")] },
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

  // ── DATE & TIME ───────────────────────────────────────────────────────────────
  {
    type: "category", label: "Date & Time", description: "Date serial type (like Excel): sources, extract parts, arithmetic, and working-day calculations.",
    children: [
      { type: "date-construct", label: "DATE (Build)", description: "Builds a date from Year, Month, Day. Handles overflow, so month 13 → Jan next year. Excel: `DATE`.", create: () => new DateConstructNode(), parity: false, accent: DT },
      { type: "pair", children: [todayNowLeaf("today"), todayNowLeaf("now")] },
      { type: "date-time",     label: "TIME",      description: "Builds a time fraction 0–1 from Hour, Minute, Second. Add it to a date serial for date+time. Excel: `TIME`.", create: () => new TimeConstructNode(), parity: false },
      {
        type: "category", label: "Parse", description: "Convert text strings to date or time values, and Unix time both ways.",
        children: [
          { type: "pair", children: [dateTimeValueLeaf("date"), dateTimeValueLeaf("time")] },
          { type: "pair", children: [
            { type: "date-epoch-from", label: "Epoch → Date", description: "Unix time (seconds or milliseconds since `1970-01-01` UTC) → a date. pandas `to_datetime`, R `as.POSIXct`. Excel: `n/86400 + 25569`.", create: () => new EpochNode({ op: "from" }), parity: false, keywords: "epoch unix timestamp posix seconds milliseconds 1970 utc to_datetime" },
            { type: "date-epoch-to",   label: "Date → Epoch", description: "A date → Unix time in seconds or milliseconds. pandas `astype(int64)`, R `as.numeric()`. Excel: `(date − 25569)·86400`.", create: () => new EpochNode({ op: "to" }), parity: false, keywords: "epoch unix timestamp posix seconds milliseconds 1970 utc" },
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
          { type: "date-trunc", label: "Truncate Date", description: "Floors a date to its day, week, month, quarter or year, or ceilings to the next. lubridate `floor_date`, pandas `to_period`, SQL `DATE_TRUNC`. Excel: `DATE(YEAR(d), MONTH(d), 1)`.", create: () => new DateTruncNode(), parity: false, keywords: "truncate floor ceiling date period month week quarter year resample bucket floor_date date_trunc to_period start of month" },
        ],
      },
      { type: "pair", children: [
        { type: "date-workday",     label: "WORKDAY",     description: WORKDAYS_OP_META.workday.description, keywords: "workdays", create: () => new WorkdaysNode({ op: "workday" }),         parity: false },
        { type: "date-networkdays", label: "NETWORKDAYS", description: WORKDAYS_OP_META.networkdays.description, keywords: "workdays", create: () => new WorkdaysNode({ op: "networkdays" }), parity: false },
      ]},
      { type: "date-datedif",     label: "DATEDIF",     description: "Whole years, months, or days between two dates, or the remainder past larger units, like months ignoring years. Excel: `DATEDIF`.", create: () => new DateDiffNode({ op: "years" }), parity: false },
      { type: "save-times",    label: "Save Times",  description: "When this document was last autosaved and when it was last written to a file, as two date values.", create: () => new SaveTimesNode(), parity: false, keywords: "save autosave saved timestamp version document file written when last clock" },
    ],
  },

  // ── TEXT ─────────────────────────────────────────────────────────────────────
  {
    type: "category", label: "Text", description: "String type: inputs, manipulation, and conversion to and from numbers.",
    children: [
      {
        type: "category", label: "Transform", description: "Case, whitespace, and character manipulation.",
        children: [
          { type: "pair", children: [textXformLeaf("upper"), textXformLeaf("lower")] },
          { type: "pair", children: [textXformLeaf("trim"),  textXformLeaf("proper")] },
          { type: "pair", children: [textXformLeaf("clean"), textXformLeaf("unaccent")] },
          textXformLeaf("slugify"),
          { type: "pair", children: [
            { type: "text-pad", label: "Pad Text", description: "Pads text to a width with a fill character, on the left, right, or both sides. Python `ljust` / `rjust` / `center`, R `str_pad`.", create: () => new PadTextNode(), parity: false, keywords: "pad padding ljust rjust center justify align width fill zero-pad str_pad fixed width column" },
            { type: "text-truncate", label: "Truncate Text", description: "Cuts text to a maximum width, ending in an ellipsis when anything was cut. R `str_trunc`, `textwrap.shorten`.", create: () => new TruncateTextNode(), parity: false, keywords: "truncate shorten ellipsis clip cut width max length abbreviate str_trunc" },
          ]},
          { type: "text-wrap", label: "Wrap Text", description: "Wraps text into a list of lines no wider than a set number of characters, breaking on spaces. R `str_wrap`, Python `textwrap.wrap`.", create: () => new WrapTextNode(), parity: false, keywords: "wrap wraptext str_wrap textwrap lines width fold" },
        ],
      },
      {
        type: "category", label: "Build & Slice", description: "Concatenate, split, and extract substrings.",
        children: [
          { type: "text-concat", label: "CONCAT",    description: "Joins pieces of text in order, one per row. Excel: `CONCAT`.",                            accent: STR, create: () => new ConcatNode(),    parity: false },
          { type: "template", label: "Template", description: "Fills a text with named values: `{name}` inserts the input of that name, `{total:0.00}` formats it with an Excel `TEXT` code, `{{ }}` print braces. A list on any name spills a list. R `str_glue` / `glue`, Python f-strings and `str.format`. Excel: `TEXT` & \"…\" chains.", create: () => new TemplateNode(), parity: false, keywords: "template glue format f-string interpolate placeholder string.format sprintf mail merge message label" },
          { type: "text-join",   label: "TEXTJOIN",  description: "Joins a list of strings with a delimiter, optionally ignoring empty strings. Excel: `TEXTJOIN`.",             create: () => new TextJoinNode(),  parity: false },
          { type: "text-split",  label: "TEXTSPLIT", description: "Splits text at a delimiter into a list of strings. Excel: `TEXTSPLIT`.",                                      create: () => new TextSplitNode(), parity: false },
          { type: "pair", children: [textSliceLeaf("left"), textSliceLeaf("right")] },
          textSliceLeaf("mid"),
          { type: "text-rept",   label: "REPT",      description: "Repeats text N times. Excel: `REPT`.",                                                                        create: () => new ReptNode(),      parity: false },
        ],
      },
      {
        type: "category", label: "Search & Replace", description: "Find positions, replace substrings, extract around delimiters.",
        children: [
          { type: "pair", children: [textFindLeaf("find"), textFindLeaf("search")] },
          { type: "pair", children: [textAfterBeforeLeaf("after"), textAfterBeforeLeaf("before")] },
          { type: "text-substitute", label: "SUBSTITUTE",  description: "Replaces `old_text` with `new_text`: every occurrence, or only the nth when Instance is set. Excel: `SUBSTITUTE`.", create: () => new SubstituteNode(),   parity: true },
          { type: "text-replace",    label: "REPLACE",     description: "Replaces N characters starting at a position. Excel: `REPLACE`.",          create: () => new TextReplaceNode(), parity: false },
          { type: "regex",           label: "Regex",       description: "Tests, extracts, or replaces text using a regular expression. Excel: `REGEXTEST`, `REGEXEXTRACT`, `REGEXREPLACE`.", keywords: "regex regextest regexextract regexreplace regular expression match extract replace", create: () => new RegexNode(), parity: false },
        ],
      },
      {
        type: "category", label: "Measure & Encode", description: "String length, comparison, and character encoding.",
        children: [
          { type: "text-len",   label: "LEN",   description: "Number of characters in the string. Excel: `LEN`.",                          create: () => new TextLenNode(), parity: false },
          { type: "text-exact", label: "EXACT", description: "`1` if two strings are identical (case-sensitive), else `0`. Excel: `EXACT`.", create: () => new ExactNode(),   parity: false },
          { type: "pair", children: [
            { type: "text-similarity", label: "Text Similarity", description: "How alike two strings are: Levenshtein, Damerau, Jaro-Winkler, or the raw edit distance. `rapidfuzz`, R `stringdist`. Excel: the Fuzzy Lookup add-in.", create: () => new TextSimilarityNode(), parity: false, keywords: "similarity fuzzy levenshtein edit distance jaro winkler damerau stringdist rapidfuzz typo match" },
            { type: "fuzzy-match",     label: "Fuzzy Match",     description: "The closest candidate to a text and its score, above a threshold: typo-tolerant matching. rapidfuzz `extractOne`, R stringdist `amatch`.", create: () => new FuzzyMatchNode(), parity: false, keywords: "fuzzy match lookup approximate nearest string typo dedupe reconcile names extractOne amatch" },
          ]},
          { type: "pair", children: [charCodeLeaf("char"), charCodeLeaf("code")] },
          { type: "pair", children: [
            { type: "url-encode", label: "ENCODEURL", description: "Percent-encode a string for use in a URL. Spaces become `%20`. Excel: `ENCODEURL`.", create: () => new UrlEncodeNode({ op: "encode" }), parity: false },
            { type: "url-decode", label: "DECODEURL", description: "Decode a percent-encoded URL string; `%20` becomes a space.", create: () => new UrlEncodeNode({ op: "decode" }), parity: false },
          ]},
          { type: "pair", children: [
            { type: "base64-encode", label: "ENCODEBASE64", description: "Base64 of the UTF-8 text, standard alphabet with padding. Python `base64.b64encode`, R `base64enc`.", create: () => new UrlEncodeNode({ op: "base64" }), parity: false, keywords: "base64 encode b64encode" },
            { type: "base64-decode", label: "DECODEBASE64", description: "Text back from base64; non-base64 input passes through unchanged.", create: () => new UrlEncodeNode({ op: "unbase64" }), parity: false, keywords: "base64 decode b64decode" },
          ]},
          { type: "pair", children: [
            { type: "hash", label: "Hash", description: "Digest of a text as lowercase hex: SHA-256, SHA-1, MD5, CRC-32 or FNV-1a. Joins on a hashed ID keep the raw key out. Python `hashlib`, R `digest`.", create: () => new HashNode(), parity: false, keywords: "hash digest sha256 sha1 md5 crc32 fnv checksum anonymize anonymise pseudonymize fingerprint hashlib" },
            { type: "uuid", label: "UUID", description: "A random v4 UUID, new on every recalculation (F9). Python `uuid.uuid4`, R `uuid::UUIDgenerate`.", create: () => new UuidNode(), parity: false, keywords: "uuid guid unique id identifier random key uuid4" },
          ]},
        ],
      },
      { type: "text-dollar", label: "DOLLAR",  description: "Format a number as a currency string, for example `\"$1,234.56\"`, or `\"($78.90)\"` for a negative. Excel: `DOLLAR`.", create: () => new FormatDollarNode() },
      { type: "text-numbervalue", label: "NUMBERVALUE", description: "Parses a number from a string with custom decimal and group separators, for example `\"1.234,56\"` with `decimal=\",\"` `group=\".\"`. Excel: `NUMBERVALUE`.", create: () => new NumberValueNode(), parity: false },
      { type: "text-fixed", label: "FIXED",     description: "Format a number as a fixed-decimal string with optional thousands separators. Excel: `FIXED`.", create: () => new FixedNode() },
      { type: "pair", children: [romanArabicLeaf("roman"), romanArabicLeaf("arabic")] },
    ],
  },

  // ── TABLES & FRAMES ───────────────────────────────────────────────────────────
  {
    type: "category", label: "Tables & Frames", description: "2D data: numeric tables and matrix math, plus data frames with named columns, reshape, and selection.",
    children: [
      {
        type: "category", label: "Frames (named columns)", description: "A data table = a Matrix plus a header list. Build one, take it apart, and read or add columns.",
        children: [
          { type: "build-frame", label: "Build Frame", description: "Combines a Matrix and a List of headers into a Frame. Missing headers become `Col1`, `Col2`…, and duplicates are made unique.", create: () => new BuildFrameNode(), parity: false },
          { type: "frame-from-lists", label: "Frame from Lists", description: "Builds a Frame straight from lists: each column pairs a typed name with a list of any type. Ragged columns pad with blanks.", create: () => new FrameFromListsNode(), parity: false, keywords: "lists to frame columns table build fast assemble" },
          { type: "split-frame", label: "Split Frame", description: "Takes a Frame apart into its numeric Matrix body and header text-list; the inverse of Build Frame. The type filter (All / Num / Date / Bool / Text) keeps only columns of that type.", create: () => new SplitFrameNode(), parity: false },
          { type: "get-column",  label: "Get Column",  description: "Pulls one column out of a Frame as a list, by name or 1-based number. Read as Number, Text, or Date.", create: () => new GetColumnNode(), parity: false },
          { type: "get-row",     label: "Get Row",     description: "Pulls one row out of a Frame by 1-based number, as a one-row Frame, since a row can mix types.", create: () => new GetRowNode(), parity: false },
          { type: "add-column",  label: "Add Column",  description: "Appends a list to a Frame or Cube as a named column, or replaces the column of that name. Shorter lists pad with blanks.", create: () => new AddColumnNode(), parity: false },
          { type: "computed-column", label: "Computed Column", description: "Adds a column calculated once per row. `@Price` reads this row's Price and a bare `Price` is the whole column, so `@Price / SUM(Price)` is each row's share. Bracket a name with spaces: `@[Unit Price]`. Power Query: Custom Column.", keywords: "custom column calculated field formula derive mutate row-wise index this-row @", create: () => new ComputedColumnNode(), parity: false },
        ],
      },
      {
        type: "category", label: "Table verbs", description: "Relational verbs over a Frame: filter, sort, join, group, reshape, nest and unnest.",
        children: [
          { type: "distinct",    label: "Distinct",    description: "Removes duplicate rows from a Frame, keeping the first of each. Rows compare case-sensitively, unlike Excel. Excel: `UNIQUE`.", create: () => new DistinctNode(), parity: false },
          { type: "head",        label: "Head",        description: "Keeps a slice of rows: the first N, the last N, all but the first N, or rows N to To (1-based). Power Query: Keep Rows and Remove Rows.", create: () => new HeadNode(), parity: false, keywords: "head tail first last skip range keep remove top bottom rows limit offset" },
          { type: "sort-frame",  label: "Frame Sort",  description: "Sorts a Frame's rows by one column, ascending or descending, with blanks and errors last. Ties keep their order, so to sort by several columns, chain Frame Sorts from the least important column to the most. Excel: `SORT`.", create: () => new SortFrameNode(), parity: false, keywords: "sort order multi key then by stable" },
          { type: "filter-frame",label: "Frame Filter", description: "Keeps the rows that pass its conditions, joined by AND or OR; the rest go to Dropped. Blanks and errors fail a value test, and `is blank` and `has error` select them. SQL: `WHERE`. Excel: `FILTER`.", create: () => new FilterFrameNode(), parity: false, keywords: "filter rows where keep drop errors iserror noterror clean" },
          { type: "join",        label: "Join",        description: "Combines two Frames on a key column: inner, left, right, outer or as-of. A key with several matches gives one row per match, except in as-of. Keys are case-sensitive, unlike Excel's `XLOOKUP`.", create: () => new JoinNode(), parity: false },
          { type: "sumifs", label: "SUMIFS", description: "Aggregates one Frame column over the rows that meet criteria on other columns, matching all or any. Excel: `SUMIFS`, `COUNTIFS`, `AVERAGEIFS`, `MINIFS`, `MAXIFS`.", create: () => new SumIfsNode(), keywords: "sumif countif averageif minif maxif criteria conditional aggregate frame all any or" },
          { type: "window", label: "Window", description: "Adds a column calculated per group while keeping every row: running totals, ranks, lag and lead, rolling windows, shares. SQL `OVER`, pandas `transform`, dplyr `mutate`.", create: () => new WindowNode(), parity: false, keywords: "window partition over running cumulative cumsum rank dense_rank row_number lag lead shift diff pct_change rolling moving transform group share percent of total first last ntile sql" },
          { type: "group-by-frame", label: "GROUPBY", description: "Groups rows by key columns and aggregates one column, with optional total and subtotal rows. Excel: `GROUPBY`.", create: () => new GroupByFrameNode(), parity: false },
          { type: "pair", children: [
            { type: "append",      label: "Append",      description: "Stacks Frames vertically. Columns match by name, a missing column fills with blanks, and a type clash is `#TYPE!`. Excel: `VSTACK`.", create: () => new AppendNode(), parity: false },
            { type: "bind-columns", label: "Bind Columns", description: "Places Frames side by side by position. A repeated name gets a suffix, and a shorter Frame pads with blanks. pandas `concat`, R `bind_cols`, Excel `HSTACK`.", create: () => new BindColumnsNode(), parity: false, keywords: "bind_cols cbind concat axis 1 side by side zip frames columns hstack horizontal" },
          ]},
          {
            type: "category", label: "Clean", description: "The everyday cleanup verbs: fill blanks from above, find and replace, drop spacer rows.",
            children: [
              { type: "fill-blanks", label: "Fill Down", description: "Fills blank cells from the neighboring row: Down carries the last value forward, Up the next one back. Power Query: Fill Down.", create: () => new FillBlanksNode(), parity: false, keywords: "fill down up forward backward blanks nulls merged cells carry propagate ffill bfill clean" },
              { type: "replace-values", label: "Replace Values", description: "Find-and-replace in one column or all. Whole-cell swaps cells equal to Find, taking the column's type; Substring rewrites inside text cells. Case-sensitive. Power Query: Replace Values.", create: () => new ReplaceValuesNode(), parity: false, keywords: "replace find substitute swap value cells fix clean search change" },
              { type: "drop-blank-rows", label: "Drop Blank Rows", description: "Removes blank rows: only fully blank spacer rows, or any row with a blank cell. Errors count as values. Power Query: Remove Blank Rows.", create: () => new DropBlankRowsNode(), parity: false, keywords: "drop remove blank empty rows spacers nulls complete clean" },
            ],
          },
          {
            type: "category", label: "Columns", description: "Column surgery: keep, drop, rename, split, or number columns.",
            children: [
              { type: "pair", children: [
                { type: "keep-columns", label: "Keep Columns", description: "Keeps only the named columns, in the order given. Like Excel's `CHOOSECOLS`, but by column name.", keywords: "columns select keep choosecols", create: () => new ColumnsNode(), parity: false },
                { type: "drop-columns", label: "Drop Columns", description: "Removes the named columns; the rest pass through.", keywords: "columns drop remove", create: () => new ColumnsNode({ op: "drop" }), parity: false },
              ]},
              { type: "rename",      label: "Rename",      description: "Renames columns from two Lists matched by position: From `[\"qty\"]` → To `[\"Quantity\"]`.", create: () => new RenameNode(), parity: false },
              { type: "split-column", label: "Split Column", description: "Splits one text column into several by a delimiter, the parts replacing the source. Power Query: Split Column by Delimiter.", create: () => new SplitColumnNode(), parity: false, keywords: "split delimiter text column separate parse divide power query" },
              { type: "add-index",   label: "Add Index",   description: "Prepends a row-number column from a start value (default 1). Power Query: Add Index Column.", create: () => new AddIndexNode(), parity: false, keywords: "index row number sequence counter rownum power query" },
              { type: "merge-columns", label: "Merge Columns", description: "Joins two or more columns into one text column with a separator, in the first source\'s place. The inverse of Split Column. Power Query: Merge Columns.", create: () => new MergeColumnsNode(), parity: false, keywords: "merge combine concatenate join columns text textjoin concat inverse split" },
              { type: "headers", label: "Headers", description: "Promotes the first row to column names, or demotes the names back into a first row of text. Power Query: Use First Row as Headers.", create: () => new HeadersNode(), parity: false, keywords: "promote demote headers first row column names use as titles header" },
            ],
          },
          {
            type: "category", label: "Reshape", description: "Change the layout: pivot wide, melt long, nest into a Cube and back.",
            children: [
              { type: "pivot",       label: "PIVOTBY",     description: "Turns long data into a cross-tab by Row and Column fields, with `SUM`, `AVERAGE` or `COUNT` per value and optional totals and subtotals. Excel: `PIVOTBY`.", create: () => new PivotNode(), parity: true },
              { type: "unpivot",     label: "Unpivot",     description: "Turns wide data long: the Id columns stay, and each chosen Value column becomes variable and value rows. Power Query: Unpivot. pandas: `melt`.", create: () => new UnpivotNode(), parity: false },
              { type: "pair", children: [
                { type: "nest",   label: "Nest",   description: "Groups a flat Frame by key into a Cube. Each key's other columns collapse into a nested table cell. The flat → nested bridge.", create: () => new NestNode(), parity: false },
                { type: "unnest", label: "Unnest", description: "A Cube's nested column expanded one level, each parent row repeating per nested row; a nested Frame flattens fully. The inverse of Nest.", create: () => new UnnestNode(), parity: false },
              ]},
            ],
          },
          {
            type: "category", label: "Analyze", description: "Score, profile, and compare Frames: weighted decisions, column summaries and correlations, version reconciliation.",
            children: [
              { type: "decision-matrix", label: "Decision Matrix", description: "Scores and ranks a Frame of options: rows are options and number columns are criteria. Score = `Σ(value × weight) / Σ|weight|`, ranked on the rounded score. Weights come from a Weights table, one row per criterion; a negative weight favors lower values like cost, and a criterion left out weighs 1. Norm scales each criterion so dollars and out-of-10 scores compare: Raw, ÷Max (the default) or Rank. Breakdown adds each criterion's contribution to the Score.", create: () => new DecisionMatrixNode(), parity: false, keywords: "decision matrix weighted score rank ranking criteria weight choose compare options podium dmbv multi-criteria mcda" },
              { type: "decision-sensitivity", label: "Sensitivity", description: "Re-scores the same options under several weight Scenarios to see whether the winner holds. The Scenarios table is the Decision Matrix's Weights table with one weight column per scenario, and an optional Norm column. The result is a Cube with one row per scenario: the Winner, the Margin over the runner-up, and the full Ranking to drill into. Options tied for first are listed together. Pairs with Decision Matrix.", create: () => new DecisionSensitivityNode(), parity: false, keywords: "decision sensitivity robustness scenario weight cube what-if stress test ranking stability mcda" },
              { type: "describe",    label: "Describe",    description: "One row per column: count, blank, distinct, and for numbers mean, std, min, quartiles, max. pandas `describe`, R `summary`.", create: () => new DescribeNode(), parity: false, keywords: "describe summary summarize profile statistics count mean std quartile overview explore eda" },
              { type: "corr-matrix", label: "Correlation Matrix", description: "Pearson, Spearman or Kendall correlation, or covariance, between every pair of number columns, with a leading name column. pandas `df.corr`, R `cor`.", create: () => new CorrMatrixNode(), parity: false, keywords: "correlation matrix corr cov covariance pearson spearman kendall pairwise heatmap" },
              { type: "reconcile",   label: "Reconcile",   description: "Two Frame versions compared by key: each row Added, Removed, Changed or Unchanged, with before, after and Δ per number column.", create: () => new ReconcileNode(), parity: false, keywords: "reconcile compare diff variance price volume mix pvm audit changed added removed data quality trust" },
            ],
          },
          {
            type: "category", label: "Plan", description: "Rows in, a plan out: spread a budget, schedule a project, pay off debts, and settle who owes whom.",
            children: [
              { type: "allocator", label: "Allocator", description: "Spreads a budget across categories, each with a min, max and weight: all of it in proportion, or the least spend that meets a target. Water-filling.", create: () => new AllocatorNode(), parity: false, keywords: "budget allocator allocate allocation split spend divide categories weights value water-filling waterfilling proportional minimize target knapsack money planner portfolio" },
              { type: "schedule", label: "Schedule", description: "Critical-path scheduling: each task's Start, Finish, Float and Critical from its duration and predecessors, on working or calendar days.", create: () => new ScheduleNode(), parity: false, keywords: "schedule cpm critical path gantt project plan timeline tasks predecessors dependencies float slack milestone duration working days finish date pert multiple critical paths" },
              { type: "earned-value", label: "Earned Value", description: "Project performance at a status date: planned and earned value, actual cost, variances, SPI, CPI and EAC. Cost keeps its currency.", create: () => new EarnedValueNode(), parity: false, keywords: "earned value evm bcws bcwp acwp planned earned actual cost variance schedule variance spi cpi eac vac tcpi budget baseline project performance" },
              { type: "payoff-planner", label: "Payoff Planner", description: "Plans paying off several debts from each Balance, APR and minimum payment, plus an extra amount every month. Every minimum is paid; the extra and each freed minimum go to the head debt, avalanche (highest APR first) or snowball (smallest balance first). Summary gives months, interest and payoff date per debt; Schedule gives each month's balances.", create: () => new PayoffPlannerNode(), parity: false, keywords: "debt payoff planner avalanche snowball loans credit card interest extra payment months schedule" },
              { type: "settle",      label: "Group Cost Settle", description: "Squares up a group that paid unevenly: who pays whom in the fewest transfers, plus each person's Paid, Owes, Owed and Net.", create: () => new SettleNode(), parity: false, keywords: "settle settlement split bill trip expenses transactions ledger who owes whom debts transfers splitwise group cost share even up payer participants" },
            ],
          },
        ],
      },
      {
        type: "category", label: "Cubes (nested tables)", description: "A Cube is a Frame whose cells can hold anything: a scalar, a list, a nested Frame, or another Cube. `INDEX` reads a cell back out.",
        children: [
          { type: "nest-join", label: "Nest Join", description: "Nests two Frames into a Cube on a shared key: each Parent row gains a cell of its matching Child rows, so nothing fans out. tidyr `nest_join`.", create: () => new NestJoinNode(), parity: false, keywords: "cube nest join relate nest_join relational merge group hierarchy multi-level deepen" },
          { type: "build-cube", label: "Build Cube", description: "Collects values into one Cube column, each cell holding any value: a scalar, list, Frame, or nested Cube. The manual way to put non-table values into a cube.", create: () => new BuildCubeNode(), parity: false, keywords: "cube nest nested pack wrap list of frames container" },
          { type: "cube-columns", label: "Cube Columns", description: "Assembles a Cube from N columns side by side: a list gives its elements, a single-column cube its cells, a frame or scalar one cell. The Names list names them.", create: () => new CubeColumnsNode(), parity: false, keywords: "cube columns multi-column assemble combine build frame side by side hstack" },
          { type: "cube-rollup", label: "Cube Rollup", description: "Aggregates a column inside each row's nested table and flattens the Cube to a Frame with the roll-up appended: an assembly's cost as a `SUM` of parts.", create: () => new CubeRollupNode(), parity: false, keywords: "cube rollup aggregate sum bom bill of materials costing nested cost roll up assembly subtotal" },
        ],
      },
      {
        type: "category", label: "Select", description: "Pick rows or columns, by index or from the table's edges.",
        children: [
          { type: "pair", children: [selectLeaf("chooserows"), selectLeaf("choosecols")] },
          { type: "pair", children: [
            { type: "takedrop",      label: "TAKE", description: TAKEDROP_OP_META.take.description, create: () => new TakeDropNode({ op: "take" }), parity: true, keywords: "take drop list table rows columns elements edge first last head tail" },
            { type: "takedrop-drop", label: "DROP", description: TAKEDROP_OP_META.drop.description, create: () => new TakeDropNode({ op: "drop" }), parity: true, keywords: "take drop list table rows columns elements edge first last head tail" },
          ]},
        ],
      },
      {
        type: "category", label: "Shape", description: "Reshape between 1D lists and 2D tables, stack tables side-by-side.",
        children: [
          { type: "pair", children: [reshapeLeaf("wraprows"), reshapeLeaf("wrapcols")] },
          { type: "pair", children: [reshapeLeaf("tocol"),    reshapeLeaf("torow")]    },
          { type: "xstack", label: "XSTACK", description: "Stacks tables top-to-bottom or side by side, in row order. A list counts as one row; a ragged edge pads with `#N/A`. Excel: `VSTACK` / `HSTACK`.", create: () => new StackNode(), parity: false, keywords: "stack vertical horizontal rows side by side rbind cbind lists to table" },
          { type: "table-expand", label: "EXPAND", description: "Grows a table to a target number of rows or columns. New cells take the Fill value, or stay blank without one; use `NA` as Fill for Excel's `#N/A`. Shrinking is `#VALUE!`; use `TAKE` for that. Excel: `EXPAND`.", create: () => new ExpandNode(), parity: false, keywords: "grow pad resize table fill" },
          { type: "table-set-cell", label: "Set Cell", description: "Writes values into a table at a 1-based `(row, column)` address: a list writes a row, a table a block. Later writes win; a value past the edge errors. Excel has no equivalent.", create: () => new SetCellNode(), keywords: "set cell overwrite poke write address table matrix block row" },
        ],
      },
      {
        type: "category", label: "Lambda (per-cell / per-row)", description: "Apply a formula over a table: each cell, each row or column, fold to one value, or generate from indices.",
        children: [
          { type: "map-table",  label: "MAP",       description: "Applies a formula to every cell of up to three tables of the same shape. `value`, `value2` and `value3` are each table's cell, and `row` and `col` are its 1-based position; a single value in `value2` or `value3` is repeated to fit. Set Result type for text or dates. Excel: `MAP`.", create: () => new MapTableNode(),  parity: false },
          { type: "pair", children: [
            { type: "by-axis",    label: "BYROW", description: "Reduces each row or column of a table to one value. Variable `v` = the row or column as a list. Pick the result type for text or date. Excel: `BYROW`.", create: () => new ByAxisNode(), parity: false },
            { type: "by-col",    label: "BYCOL", description: "Reduces each row or column of a table to one value. Variable `v` = the row or column as a list. Pick the result type for text or date. Excel: `BYCOL`.", create: () => new ByAxisNode({ op: "col" }), parity: false },
          ]},
          { type: "make-array", label: "MAKEARRAY", description: "A rows×cols table from a formula of its indices, `row` and `col` 1-based. Pick the result type for text or date. Excel: `MAKEARRAY`.", create: () => new MakeArrayNode(), parity: false },
          { type: "reduce-lambda", label: "REDUCE", description: "Folds a list or table to one value from Initial: `acc` the accumulator, `value` this element, `step` its 1-based position. Excel: `REDUCE`.", create: () => new ReduceLambdaNode(), parity: false },
          { type: "scan-lambda", label: "SCAN", description: "`REDUCE` that keeps every running value, in the input's shape: a running total is `acc + value` from `0`. Same `acc`, `value`, `step`. Excel: `SCAN`.", create: () => new ScanLambdaNode(), parity: false, keywords: "running total cumulative accumulate prefix sum" },
        ],
      },
      {
        type: "category", label: "Matrix math", description: "Linear algebra: multiply, invert, determinant, identity.",
        children: [
          { type: "table-mult",      label: "MMULT",     description: "Matrix multiply: A (m×n) × B (n×p) → result (m×p). Excel: `MMULT`.",                                    create: () => new TableMultNode(),                   parity: false },
          { type: "pair", children: [matDetLeaf("mdeterm"), matDetLeaf("minverse")] },
          { type: "pair", children: [matDetLeaf("trace"), matDetLeaf("rank")] },
          matDetLeaf("norm"),
          { type: "table-unit",      label: "MUNIT",     description: "n×n identity matrix: diagonal 1s, rest 0s, or blanks (nulls) so the off-diagonal stays out of sums. Excel: `MUNIT`.",                                             create: () => new TableUnitNode(),                   parity: false },
          { type: "table-diag",      label: "DIAGONAL",  description: "Turns a list into a square matrix's diagonal, the rest 0s or blanks (nulls, out of sums). `numpy.diag`.",                                              create: () => new TableDiagNode(),                   parity: false },
          { type: "pair", children: [
            { type: "table-outer",     label: "OUTER",     description: "Outer product of two lists: the matrix of every product a×b. `numpy.outer`.",                                                                          create: () => new TableOuterNode(),                  parity: false },
            { type: "vector-cross",    label: "Cross Product", description: "Cross product of two 3-D vectors: the vector perpendicular to both. `numpy.cross`.",                                                          create: () => new CrossNode(),                       parity: false, keywords: "cross product vector perpendicular normal 3d numpy physics torque" },
          ]},
          { type: "table-transpose", label: "TRANSPOSE", description: "Flips rows and columns of a table. Excel: `TRANSPOSE`.",                                                    create: () => new TableTransposeNode(),              parity: false },
        ],
      },
      { type: "table-info",  label: "Table Size", description: "Number of rows and number of columns in a table. Excel: `ROWS` / `COLUMNS`.", create: () => new TableInfoNode(), parity: false, keywords: "rows columns count size dimensions" },
    ],
  },

  {
    type: "category", label: "Packs", description: "Nodes from your enabled packs, by domain. Manage packs in Settings.",
    children: [],
  },
];
