// Add-menu catalog: leaf factories + full category tree.
// Edit this file to add/move/rename entries in the Add menu.
// Imported by Canvas.tsx; kept separate so agents edit this, not the full canvas.

import {
  AngleDialNode, SlicerNode, CableSwitchNode, DatePickerNode, XYPadNode,
  SparklineNode, ChartNode, MermaidNode, GaugeNode, HeatmapCellNode, ChartBuilderNode,
  NumberInputNode, ArithmeticNode, DisplayNode, ComparisonNode, MathFnNode,
  FormatControllerNode, ExpressionNode, RegexNode, GroupByNode,
  ClampNode, BooleanOpNode, NotNode, IfNode, ConduitNode, CastNode, ConstantNode, MRoundNode,
  ListInputNode, AggregateNode, RangeNode, ListLengthNode, ListIndexNode,
  SortNode, ReverseNode, SliceNode, FilterNode, FillNode, XLookupNode,
  GcdNode, IFErrorNode, NaNode, RandBetweenNode, RoundNNode, ConvertNode,
  UniqueNode, TakeNode, DropNode, VStackNode, CumulativeNode, DiffNode,
  ArgMinMaxNode, ContainsNode, NthValueNode, PercentileNode, QuartileNode,
  PercentrankNode, RankNode, CorrelNode, CombinatoricsNode, TwoInputMathNode,
  SumProductNode, ChooseNode, BooleanInputNode, SliderInputNode, ColorPickerNode, IsTestNode,
  AlertNode, NormalizeNode, LinSpaceNode, RepeatNode,
  ShuffleNode, NthElementNode, InterleaveNode, PadNode, GeometricNode,
  FibonacciNode, StandardizeNode, CovarianceNode, FisherNode, BitwiseNode,
  InterestRateNode, DepreciationNode,
  TvmNode, RateNode, IpmtPpmtNode, NpvNode, IrrNode, MirrNode, CumPmtNode,
  FvScheduleNode, IspmtNode, DollarNode, VdbNode, ProbNode,
  PdurationNode, RriNode, WeightedNode, BaseConvertNode,
  TextInputNode, TextTransformNode, TextLenNode, ConcatNode, TextSliceNode,
  TextFindNode, SubstituteNode, TextReplaceNode,
  ReptNode, ExactNode,
  CharCodeNode, TextJoinNode, TextSplitNode, TextAfterBeforeNode,
  TextFilterNode, NumberValueNode, RomanArabicNode, FixedNode, TextMapNode, UrlEncodeNode,
  PromoNode,
  TodayNowNode, DateConstructNode, TimeConstructNode,
  DateValueNode, TimeValueNode, DatePartNode, WeekInfoNode,
  DateDiffNode, DateAddNode, WorkdayNode, NetworkdaysNode, DateIfNode,
  RandArrayNode, SequenceNode,
  SortByNode, XMatchNode,
  TBillNode, SecurityDiscNode, CouponNode, AccrintNode,
  AccrintMNode, PriceDiscNode, PriceMatNode, DurationNode, XnpvNode,
  BondPriceNode, XirrNode, OddCouponNode,
  TBILL_OP_META, SECURITY_DISC_OP_META, COUPON_OP_META,
  PRICE_DISC_OP_META, PRICE_MAT_OP_META, DURATION_OP_META, BOND_PRICE_OP_META, ODD_COUPON_OP_META,
  type TBillOp, type SecurityDiscOp, type BondPriceOp, type OddCouponOp,
  ComplexFromNode, ComplexUnpackNode, ComplexUnaryNode, ComplexBinaryNode, ComplexPowerNode,
  COMPLEX_UNARY_OP_META, COMPLEX_BINARY_OP_META,
  type ComplexUnaryOp, type ComplexBinaryOp,
  TableInputNode, MatDetNode, TableMultNode, TableUnitNode, TableTransposeNode,
  HStackTableNode, TableReshapeNode, TableSelectNode, TableInfoNode,
  MapTableNode, ByAxisNode, MakeArrayNode, ReduceLambdaNode, LambdaNode,
  FrameInputNode, BuildFrameNode, SplitFrameNode, GetColumnNode, AddColumnNode, GetRowNode, DistinctNode,
  HeadNode, SortFrameNode, FilterFrameNode, JoinNode, FrameLookupNode,
  SelectColumnsNode, DropColumnsNode, GroupByFrameNode, PivotNode, UnpivotNode, NestNode, UnnestNode, AppendNode, RenameNode, SplitColumnNode, AddIndexNode, DecisionMatrixNode, DecisionSensitivityNode,
  ReconcileNode,
  BuildCubeNode, NestJoinNode, CubeColumnsNode, CubeRollupNode,
  WebSourceNode, CsvConnectionNode, ParquetConnectionNode, ImportHtmlNode, ImportXmlNode,
  WriteCsvNode, WriteJsonNode,
  GroupNode, NoteNode, ReportNode, SessionHistoryNode, PresentationNode, ImageNode,
  CompositeNode, CompositeInputNode, CompositeOutputNode,
  MAT_DET_OP_META, TABLE_RESHAPE_OP_META, TABLE_SELECT_OP_META,
  type MatDetOp, type TableReshapeOp, type TableSelectOp,
  IsEvenOddNode, FormatDollarNode,
  NormDistNode, NormInvNode, NormSDistNode, NormSInvNode,
  TDistNode, TInvNode, ChisqDistNode, ChisqInvNode,
  FDistNode, FInvNode, BetaDistNode, BetaInvNode,
  GammaDistNode, GammaInvNode, LognormDistNode, LognormInvNode,
  WeibullDistNode, ExponDistNode,
  BinomDistNode, BinomInvNode, PoissonDistNode, HypgeomDistNode, NegbinomDistNode,
  RegressionNode, ForecastNode, ModeNode, TrimMeanNode, FrequencyNode, ConfidenceNode,
  BesselNode,
  SeriesSumNode, MultinomialNode, RollingNode, SwitchNode, IfsNode,
  ZTestNode, TTestNode, FTestNode, ChisqTestNode,
  TrendNode, LinestNode, LogestNode, BinomDistRangeNode, ModMultNode,
  NODE_KIND_ACCENTS,
  ARITHMETIC_OP_META, MATH_FN_OP_META, BOOLEAN_OP_META, REDUCE_OP_META,
  COMBINATORICS_OP_META, NTH_VALUE_OP_META, ARG_MIN_MAX_OP_META,
  SUM_PRODUCT_OP_META, RANK_OP_META, CORREL_OP_META, TWO_INPUT_MATH_OP_META,
  COVARIANCE_OP_META, FISHER_OP_META, BITWISE_OP_META,
  INTEREST_RATE_OP_META, DEPRECIATION_OP_META,
  TVM_OP_META, IPMT_PPMT_OP_META, CUM_PMT_OP_META, DOLLAR_OP_META,
  WEIGHTED_OP_META,
  TEXT_TRANSFORM_OP_META, TEXT_SLICE_OP_META, TEXT_FIND_OP_META, TEXT_AFTER_BEFORE_OP_META,
  BESSEL_OP_META, REGRESSION_OP_META, ROLLING_OP_META, T_TEST_OP_META,
  TODAY_NOW_OP_META, DATE_PART_OP_META, WEEK_INFO_OP_META, DATE_DIFF_OP_META, DATE_ADD_OP_META,
  type ArithmeticOp, type MathFnOp, type BooleanOp, type ReduceOp,
  type CombinatoricsOp, type NthValueOp, type ArgMinMaxOp,
  type SumProductOp, type RankOp, type CorrelOp, type TwoInputMathOp,
  type CovarianceOp, type FisherOp, type BitwiseOp,
  type InterestRateOp, type DepreciationOp,
  type TvmOp, type IpmtPpmtOp, type CumPmtOp, type DollarOp, type WeightedOp,
  type CouponOp, type PriceDiscOp, type PriceMatOp, type DurationOp,
  type TextTransformOp, type TextSliceOp, type TextFindOp, type CharCodeOp, type TextAfterBeforeOp,
  type RomanArabicOp,
  type BesselOp, type RegressionOp, type RollingOp, type TTestOp,
  type TodayNowOp, type DatePartOp, type WeekInfoOp, type DateDiffOp, type DateAddOp,
  ExpectNode, TornadoNode,
} from "./rete-nodes";
import type { NodeCatalogEntry, CatalogEntry } from "./AddNodeMenu";

// ─── Leaf factories ───────────────────────────────────────────────────────────
// Label + description come from OP_META (single source of truth).
// Tree structure, pairs, and ordering are hand-authored in NODE_CATALOG below.

const arithLeaf    = (op: ArithmeticOp):   NodeCatalogEntry => ({ type: `arith-${op}`,     label: ARITHMETIC_OP_META[op].label,     description: ARITHMETIC_OP_META[op].description,     create: () => new ArithmeticNode({ op }), ...(op === "pow" ? { parity: false as const } : {}) });
const mathLeaf     = (op: MathFnOp, overrides?: Partial<NodeCatalogEntry>): NodeCatalogEntry => ({ type: `math-${op}`, label: MATH_FN_OP_META[op].label, description: MATH_FN_OP_META[op].description, create: () => new MathFnNode({ op }), ...overrides });
const booleanLeaf  = (op: BooleanOp):      NodeCatalogEntry => ({ type: `bool-${op}`,      label: BOOLEAN_OP_META[op].label,        description: BOOLEAN_OP_META[op].description,        create: () => new BooleanOpNode({ op })     });
const reduceLeaf   = (op: ReduceOp):       NodeCatalogEntry => ({ type: `reduce-${op}`,    label: REDUCE_OP_META[op].label,         description: REDUCE_OP_META[op].description,         create: () => new AggregateNode({ op })     });
const combLeaf     = (op: CombinatoricsOp):NodeCatalogEntry => ({ type: `comb-${op}`,      label: COMBINATORICS_OP_META[op].label,  description: COMBINATORICS_OP_META[op].description,  create: () => new CombinatoricsNode({ op }) });
const nthLeaf      = (op: NthValueOp):     NodeCatalogEntry => ({ type: `nth-${op}`,       label: NTH_VALUE_OP_META[op].label,      description: NTH_VALUE_OP_META[op].description,      create: () => new NthValueNode({ op })      });
const argLeaf      = (op: ArgMinMaxOp):    NodeCatalogEntry => ({ type: `arg-${op}`,       label: ARG_MIN_MAX_OP_META[op].label,    description: ARG_MIN_MAX_OP_META[op].description,    create: () => new ArgMinMaxNode({ op })     });
const spLeaf       = (op: SumProductOp):   NodeCatalogEntry => ({ type: `sp-${op}`,        label: SUM_PRODUCT_OP_META[op].label,    description: SUM_PRODUCT_OP_META[op].description,    create: () => new SumProductNode({ op })    });
const rankLeaf     = (op: RankOp):         NodeCatalogEntry => ({ type: `rank-${op}`,      label: RANK_OP_META[op].label,           description: RANK_OP_META[op].description,           create: () => new RankNode({ op })          });
const correlLeaf   = (op: CorrelOp):       NodeCatalogEntry => ({ type: `correl-${op}`,    label: CORREL_OP_META[op].label,         description: CORREL_OP_META[op].description,         create: () => new CorrelNode({ op })        });
const twoMathLeaf  = (op: TwoInputMathOp): NodeCatalogEntry => ({ type: `twomath-${op}`,   label: TWO_INPUT_MATH_OP_META[op].label, description: TWO_INPUT_MATH_OP_META[op].description, create: () => new TwoInputMathNode({ op })  });
const covLeaf      = (op: CovarianceOp):   NodeCatalogEntry => ({ type: `cov-${op}`,       label: COVARIANCE_OP_META[op].label,     description: COVARIANCE_OP_META[op].description,     create: () => new CovarianceNode({ op })    });
const fisherLeaf   = (op: FisherOp):       NodeCatalogEntry => ({ type: `fisher-${op}`,    label: FISHER_OP_META[op].label,         description: FISHER_OP_META[op].description,         create: () => new FisherNode({ op })        });
const bitwiseLeaf  = (op: BitwiseOp):      NodeCatalogEntry => ({ type: `bitwise-${op}`,   label: BITWISE_OP_META[op].label,        description: BITWISE_OP_META[op].description,        create: () => new BitwiseNode({ op })       });
const irLeaf       = (op: InterestRateOp): NodeCatalogEntry => ({ type: `ir-${op}`,        label: INTEREST_RATE_OP_META[op].label,  description: INTEREST_RATE_OP_META[op].description,  create: () => new InterestRateNode({ op })  });
const deprLeaf     = (op: DepreciationOp): NodeCatalogEntry => ({ type: `depr-${op}`,      label: DEPRECIATION_OP_META[op].label,   description: DEPRECIATION_OP_META[op].description,   create: () => new DepreciationNode({ op })  });
const tvmLeaf      = (op: TvmOp):          NodeCatalogEntry => ({ type: `tvm-${op}`,       label: TVM_OP_META[op].label,            description: TVM_OP_META[op].description,            create: () => new TvmNode({ op })           });
const ipmtPpmtLeaf = (op: IpmtPpmtOp):    NodeCatalogEntry => ({ type: `ipmt-${op}`,      label: IPMT_PPMT_OP_META[op].label,      description: IPMT_PPMT_OP_META[op].description,      create: () => new IpmtPpmtNode({ op })      });
const cumPmtLeaf   = (op: CumPmtOp):       NodeCatalogEntry => ({ type: `cumpmt-${op}`,    label: CUM_PMT_OP_META[op].label,        description: CUM_PMT_OP_META[op].description,        create: () => new CumPmtNode({ op })        });
const regressionLeaf = (op: RegressionOp): NodeCatalogEntry => ({ type: `regression-${op}`,label: REGRESSION_OP_META[op].label,     description: REGRESSION_OP_META[op].description,     create: () => new RegressionNode({ op })    });
const rollingLeaf  = (op: RollingOp):      NodeCatalogEntry => ({ type: `rolling-${op}`,   label: ROLLING_OP_META[op].label,        description: ROLLING_OP_META[op].description,        create: () => new RollingNode({ op })       });
const ttestLeaf    = (op: TTestOp):        NodeCatalogEntry => ({ type: `t-test-${op}`,    label: T_TEST_OP_META[op].label,         description: T_TEST_OP_META[op].description,         create: () => new TTestNode({ op }),         parity: false });
const dollarLeaf    = (op: DollarOp):      NodeCatalogEntry => ({ type: `dollar-${op}`,     label: DOLLAR_OP_META[op].label,          description: DOLLAR_OP_META[op].description,          create: () => new DollarNode({ op }) });
const weightedLeaf   = (op: WeightedOp):      NodeCatalogEntry => ({ type: `weighted-${op}`,    label: WEIGHTED_OP_META[op].label,          description: WEIGHTED_OP_META[op].description,          create: () => new WeightedNode({ op }) });
const DT = NODE_KIND_ACCENTS.date;
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

const romanArabicLeaf = (op: RomanArabicOp): NodeCatalogEntry => ({
  type: `roman-arabic-${op}`,
  label: op === "roman" ? "ROMAN" : "ARABIC",
  description: op === "roman"
    ? "Convert an integer (1–3999) to a Roman numeral string   (Excel: =ROMAN)"
    : "Convert a Roman numeral string to an integer   (Excel: =ARABIC)",
  create: () => new RomanArabicNode({ op }),
  parity: false,
});


const tbillLeaf    = (op: TBillOp):       NodeCatalogEntry => ({ type: `tbill-${op}`,   label: TBILL_OP_META[op].label,          description: TBILL_OP_META[op].description,          create: () => new TBillNode({ op }),          parity: false });
const secDiscLeaf  = (op: SecurityDiscOp): NodeCatalogEntry => ({ type: `secdesc-${op}`, label: SECURITY_DISC_OP_META[op].label,  description: SECURITY_DISC_OP_META[op].description,  create: () => new SecurityDiscNode({ op }),   parity: false });

const STR = NODE_KIND_ACCENTS.string;
const textXformLeaf         = (op: TextTransformOp):   NodeCatalogEntry => ({ type: `text-${op}`,              label: TEXT_TRANSFORM_OP_META[op].label,        description: TEXT_TRANSFORM_OP_META[op].description,        create: () => new TextTransformNode({ op }),     parity: false });
const textSliceLeaf         = (op: TextSliceOp):       NodeCatalogEntry => ({ type: `text-${op}`,              label: TEXT_SLICE_OP_META[op].label,            description: TEXT_SLICE_OP_META[op].description,            create: () => new TextSliceNode({ op }),         parity: false });
const textFindLeaf          = (op: TextFindOp):        NodeCatalogEntry => ({ type: `text-find-${op}`,         label: TEXT_FIND_OP_META[op].label,             description: TEXT_FIND_OP_META[op].description,             create: () => new TextFindNode({ op }),           parity: false });
const charCodeLeaf          = (op: CharCodeOp):        NodeCatalogEntry => ({ type: `char-code-${op}`,         label: op === "char" ? "CHAR" : "CODE",         description: op === "char" ? "Character at Unicode code point N (0–1114111)   (Excel: =CHAR / =UNICHAR)" : "Unicode code point of the first character   (Excel: =CODE / =UNICODE)", create: () => new CharCodeNode({ op }), parity: false });
const textAfterBeforeLeaf   = (op: TextAfterBeforeOp): NodeCatalogEntry => ({ type: `text-after-before-${op}`, label: TEXT_AFTER_BEFORE_OP_META[op].label,     description: TEXT_AFTER_BEFORE_OP_META[op].description,     create: () => new TextAfterBeforeNode({ op }), parity: false });

// ─── Catalog tree ─────────────────────────────────────────────────────────────

export const NODE_CATALOG: CatalogEntry[] = [
  // ── INPUT ────────────────────────────────────────────────────────────────────
  {
    type: "category", label: "Input", description: "Source nodes — where values enter your graph.",
    children: [
      { type: "number-input",        label: "Number Input",  description: "Editable number — type a value into the field.", accent: NODE_KIND_ACCENTS.input, keywords: "scalar value literal", create: () => new NumberInputNode() },
      { type: "list-input",  label: "List Input",    description: "Collect numbers into a list — add rows with +   (Excel: selecting a range like A1:A8)", accent: NODE_KIND_ACCENTS.list, keywords: "literal array", create: () => new ListInputNode() },
      { type: "text-input",    label: "Text Input",    description: "A literal string value — type your text directly in the node.", accent: STR, keywords: "string literal", create: () => new TextInputNode() },
      { type: "boolean-input", label: "Boolean Input", description: "A TRUE / FALSE toggle — outputs a logical (coerces to 1 / 0 where a number is needed).", accent: NODE_KIND_ACCENTS.logic, create: () => new BooleanInputNode() },
      { type: "table-input",   label: "Table Input",   description: "Enter a 2D table — one row per line, comma-separated values per row. Outputs a table socket plus row and column counts.", accent: NODE_KIND_ACCENTS.table, create: () => new TableInputNode() },
      { type: "frame-input",   label: "Frame Input", description: "Type a data table directly — named columns, editable cells. Click the chip to edit in a grid. Outputs a Frame.", accent: NODE_KIND_ACCENTS.frame, create: () => new FrameInputNode(), parity: false },
      { type: "cx-from",       label: "COMPLEX",     description: "Build a complex number from real and imaginary parts   (Excel: =COMPLEX)", accent: CX, create: () => new ComplexFromNode(), parity: false },
      { type: "lambda-make",   label: "LAMBDA",      description: "Define a reusable formula as a value   (Excel: =LAMBDA). Parameters go in the λ(…) row; other variables become captured inputs. Wire into MAP / BYROW / REDUCE / MAKEARRAY — parameters bind positionally. Like Expression, the formula evaluates via Formula.js (standard Excel functions), separate from the visual nodes.", accent: NODE_KIND_ACCENTS.lambda, create: () => new LambdaNode(), parity: false },
      { type: "constant",      label: "Constant",    description: "Predefined value: π, e, φ, ∞, 0, 1, true, false …", create: () => new ConstantNode() },
      { type: "randbetween",   label: "RAND",        description: "Random float in [Bottom, Top]. Defaults to 0–1 (like Excel RAND()). Wire Bottom/Top for a custom range.", create: () => new RandBetweenNode(), parity: false },
      { type: "na",            label: "NA",          description: "Outputs #N/A — propagates through calculations like Excel. Catch it with IFERROR / IFNA.", create: () => new NaNode() },
      {
        type: "category", label: "Connections", description: "Live external data — load from a URL, a local CSV, or a web page. Stores the source (not the data); refresh to re-pull.",
        children: [
          { type: "web-source",    label: "Web Source",  description: "Load a Frame from a CSV or JSON URL — columns auto-typed. Stores the URL, not the data: refresh to re-pull. Desktop fetches any URL; the browser only CORS-enabled ones.", create: () => new WebSourceNode(), parity: false },
          { type: "csv-connection", label: "CSV File",    description: "Load a Frame from a .csv in your data folder (Settings ▸ Data) — columns auto-typed. Stores the file name; refresh to re-read. Desktop only.", create: () => new CsvConnectionNode(), parity: false },
          { type: "parquet-connection", label: "Parquet File", description: "Load a Frame from a .parquet in your data folder (Settings ▸ Data) — read straight into the native engine, so typed columns arrive intact with no inference step (unlike CSV). Stores the file name; refresh to re-read. Desktop (native engine) only.", create: () => new ParquetConnectionNode(), parity: false, keywords: "parquet arrow column columnar native engine polars" },
          { type: "import-html",   label: "Import HTML", description: "Grab the Nth HTML table on a page as a Frame, columns auto-typed. Stores the URL; refresh to re-pull. Desktop any URL, browser CORS-only.   (Sheets: =IMPORTHTML)", create: () => new ImportHtmlNode(), parity: false },
          { type: "import-xml",    label: "Import XML",  description: "Extract a page's XPath matches (e.g. //h2/a) as a text list. Stores the URL; refresh to re-pull. Desktop any URL, browser CORS-only.   (Sheets: =IMPORTXML)", create: () => new ImportXmlNode(), parity: false },
          { type: "write-csv",     label: "Write CSV",   description: "Write a Frame to a .csv file — arm it, then press Run. Never writes on its own; a normal recompute only updates the preview. Desktop only.", create: () => new WriteCsvNode(), parity: false },
          { type: "write-json",    label: "Write JSON",  description: "Write a Frame to a .json file (array of row records) — arm it, then press Run. Never writes on its own; a normal recompute only updates the preview. Desktop only.", create: () => new WriteJsonNode(), parity: false },
        ],
      },
    ],
  },

  // ── CONTROL ──────────────────────────────────────────────────────────────────
  {
    type: "category", label: "Control", description: "Interactive widgets that drive values in your graph.",
    children: [
      { type: "slider",      label: "Slider",      description: "Drag a slider to set a value — configure min, max, step on the node.", accent: NODE_KIND_ACCENTS.input, create: () => new SliderInputNode() },
      { type: "angle-dial",  label: "Angle Dial",  description: "Rotary dial — spin or type to set an angle in degrees (0–359).", create: () => new AngleDialNode() },
      { type: "date-picker", label: "Date Picker", description: "Pick a day from a calendar field — outputs the matching date serial. Wire it into any date function.", create: () => new DatePickerNode(), parity: false },
      { type: "xy-pad",      label: "XY Pad",      description: "Drag a handle in a square to set two values at once. Outputs X and Y, each 0–1; scale them with arithmetic for any range.", create: () => new XYPadNode(), parity: false },
      { type: "color-picker", label: "Color", description: "Pick a colour (RGB or HSV); choose output format (hex / rgb() / hsl()). Outputs a CSS colour string.", create: () => new ColorPickerNode(), parity: false },
      { type: "slicer",      label: "Slicer",      description: "Filter a Frame like an Excel slicer — pick a column, click its values to keep matching rows.", create: () => new SlicerNode() },
      { type: "cable-switch", label: "Input Switch", description: "A multiplexer (not the logical SWITCH): wire several cables in, pick which one passes through. Any type.", create: () => new CableSwitchNode(), parity: false },
    ],
  },

  // ── OUTPUT ───────────────────────────────────────────────────────────────────
  {
    type: "category", label: "Output", description: "Display, convert, and visualize values at the end of a chain.",
    children: [
      { type: "display",   label: "Display",  description: "Show a value — pass-through so you can keep wiring after it.", create: () => new DisplayNode(), accent: NODE_KIND_ACCENTS.util },
      { type: "alert",     label: "Alert",    description: "Watch a value and FIRE on a status change (toast + the Alerts HUD): range (Low/High thresholds), boolean (TRUE fires), change (any new value), or threshold-cross modes.", create: () => new AlertNode() },
      {
        type: "category", label: "Data Quality", description: "Trust the graph: validate values in place, and rank which upstream inputs matter most.",
        children: [
          { type: "expect", label: "Expect", description: "Data Validation, generalized: check a value against up to four opt-in rules — not-null, unique (for a list), in range, matches a regex. Always pass-through (a failure never blocks the value); a failing check shows a red badge and fires an Alert once per new failure.", create: () => new ExpectNode(), parity: false, keywords: "expect validate validation data quality check rule assert not null unique range regex trust" },
          { type: "tornado", label: "Tornado", description: "One-at-a-time sensitivity ranking. Wire in any numeric value, then Run: it perturbs each upstream Number/Slider input ±10% (or its declared min/max) one at a time, reads how much THIS node's value swings, and ranks the inputs by impact in an inline tornado chart. Pass-through.", create: () => new TornadoNode(), parity: false, keywords: "tornado sensitivity analysis what-if one at a time impact ranking swing trust" },
        ],
      },
      {
        type: "category", label: "Visuals", description: "Inline charts and readouts — plot or visualize a value at the end of a chain. All pass-through.",
        children: [
          { type: "sparkline", label: "Sparkline", description: "A small inline chart of a list — line, area, or column. Pass-through, so you can keep wiring after it.   (Excel: SPARKLINE)", create: () => new SparklineNode(), parity: false },
          { type: "chart",     label: "Chart",     description: "Plot a list — column, bar, line, or area. Wire a Chart Builder into Options to style it. Pass-through.", create: () => new ChartNode(), parity: false },
          { type: "chart-builder", label: "Chart Builder", description: "Style a Chart — title, axes, colour, grid, range, line, markers — and output an options string for its Options socket. Fields follow matplotlib.", create: () => new ChartBuilderNode(), parity: false },
          { type: "mermaid",   label: "Mermaid",   description: "Draw a diagram from Mermaid.js text — flowchart, sequence, class, state, gantt, pie, and more. Type the source on the node (or wire a Text node into it) and its figure flows out a chart socket, so a Report renders it inline where its =name ref sits.", create: () => new MermaidNode(), parity: false, keywords: "mermaid diagram flowchart flow chart graph sequence class state gantt pie mindmap uml erd tree" },
          { type: "gauge",     label: "Gauge",     description: "Show a value on a radial dial between Min and Max — a speedometer-style readout. Pass-through.", create: () => new GaugeNode(), parity: false },
          { type: "heatmap-cell", label: "Heatmap", description: "Colour every cell of a Table on a cool-to-warm scale across its data range, like conditional formatting. Pass-through.", create: () => new HeatmapCellNode(), parity: false },
        ],
      },
      { type: "conduit",    label: "Conduit",   description: "Bundle up to 8 cables into one block — they travel onward as a single ribbon that splits back into lanes at the destination. Rotate or extend it from the inspector.", create: () => new ConduitNode(), parity: false },
      { type: "format-controller", label: "Format", description: "Attach to a socket to set its number format (decimal, fraction, %, currency…) and unit label (°C, m, kg…). Units must match on connected cables.", create: () => new FormatControllerNode() },
      { type: "group", label: "Group", description: "A container — drop it around nodes (or select + Ctrl+G). Drag its header to move them together; collapse to a summary.", create: () => new GroupNode(), parity: false },
      // Not user-addable from the menu (no catalog UI entry point — select nodes
      // and press Ctrl+Shift+G instead, see compositeLogic.ts). `hidden: true`
      // keeps it in FLAT_CATALOG so nodeCtorRegistry can still reconstruct a
      // saved/pasted Composite card — the same mechanism a since-removed node
      // type uses to stay loadable without cluttering the Add menu.
      { type: "composite", label: "Composite", description: "A computing subgraph — select nodes and press Ctrl+Shift+G to collapse them into one typed card with a declared input/output boundary.", create: () => new CompositeNode(), parity: false, hidden: true },
      // The boundary marker nodes that live INSIDE a Composite's private
      // internal graph (never on the main canvas) — hidden for the same
      // reason as "composite" above: FLAT_CATALOG-only, so hydrate() can
      // reconstruct them from a save/paste snapshot.
      { type: "composite-input", label: "Composite Input", description: "Internal — a Composite's exposed-input boundary marker.", create: () => new CompositeInputNode(), parity: false, hidden: true },
      { type: "composite-output", label: "Composite Output", description: "Internal — a Composite's output boundary marker.", create: () => new CompositeOutputNode(), parity: false, hidden: true },
      { type: "note", label: "Note", description: "A free-floating markdown note — title + body, drag it anywhere, tint it. Open the body with a ----fenced YAML block to turn each key into a typed OUTPUT socket (a note as a constants source). A Note only emits — to read live graph values into a document, use a Report.", create: () => new NoteNode(), parity: false },
      { type: "report", label: "Report", description: "A standalone markdown document, separate from the graph — write prose with inline `=name` refs (wire a value, it shows formatted in the text) and embed existing Notes as placed objects. Open it from the small anchor card.", create: () => new ReportNode(), parity: false },
      { type: "session-history", label: "Session History", description: "A live, dated log of this session's undo/redo actions — nodes added/removed/moved, connections made/broken — with a copy button. No inputs/outputs; it doesn't persist, just autogenerates while it's on canvas.", create: () => new SessionHistoryNode(), parity: false },
      { type: "presentation", label: "Presentation", description: "Presenter mode: select nodes on canvas, Add step to capture them, then step through with Prev/Next — each step flies the camera to fit its nodes (pan/zoom only, no isolate/highlight).", create: () => new PresentationNode(), parity: false },
      { type: "convert", label: "Convert", description: "Convert between measurement units — including degrees ↔ radians, length, mass, temperature, time, area, volume, speed, energy, pressure.   (Excel: =CONVERT)", create: () => new ConvertNode() },
      { type: "cast", label: "Cast", description: "Change a value's data type — number, text, date (serial), Boolean (TRUE/FALSE), or complex. Works element-wise on lists.   (Excel: =TEXT, =VALUE)", create: () => new CastNode(), parity: false },
    ],
  },

  // ── NUMBERS ──────────────────────────────────────────────────────────────────
  {
    type: "category", label: "Numbers", description: "Scalar math: arithmetic, functions, rounding, and trigonometry.",
    children: [
      { type: "expression", label: "Expression", description: "Type a formula like a*b+1 — named variables become input sockets. Supports math functions, the constants pi / tau / e / phi, and list broadcasting. Pick the result type to loop any function over arrays (e.g. UPPER(name), DATE(y,m,d)). Functions evaluate via Formula.js (a standard Excel-function library), SEPARATE from the visual nodes — so a function here can differ from the matching node for statistics, dates, units, and error / null handling. Scope is capped on purpose: scalars and 1-D lists only — no matrices/frames, no complex numbers, no type-directed semantics. For those, build a subgraph instead.", create: () => new ExpressionNode(), accent: NODE_KIND_ACCENTS.math },
      {
        type: "category", label: "Arithmetic", description: "Two-input operations on numbers.",
        children: [
          { type: "pair", children: [arithLeaf("add"), arithLeaf("sub")] },
          { type: "pair", children: [arithLeaf("mul"), arithLeaf("div")] },
          { type: "pair", children: [arithLeaf("mod"), arithLeaf("quotient")] },
          { type: "pair", children: [
            arithLeaf("pow"),
            { type: "gcd-lcm", label: "GCD / LCM", description: "Greatest common divisor or least common multiple of two integers   (Excel: =GCD / =LCM)", create: () => new GcdNode() },
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
        type: "category", label: "Probability", description: "Standard normal curve functions.",
        children: [
          { type: "pair", children: [mathLeaf("phi"), mathLeaf("gauss")] },
          { type: "stat-standardize", label: "STANDARDIZE", description: "z-score: (value − mean) ÷ std dev   (Excel: =STANDARDIZE)", create: () => new StandardizeNode() },
        ],
      },
      {
        type: "category", label: "Rounding", description: "Round and constrain numbers.",
        children: [
          { type: "pair", children: [mathLeaf("round"), mathLeaf("trunc")] },
          { type: "pair", children: [
            { type: "math-ceiling", label: "CEILING", description: "Round UP to a multiple (toward +∞); the multiple defaults to 1 so it snaps up to the next integer   (Excel: =CEILING.MATH(x, sig))", create: () => new MRoundNode({ op: "up" }), keywords: "ceil ceiling round up multiple significance" },
            { type: "math-floor", label: "FLOOR", description: "Round DOWN to a multiple (toward −∞); the multiple defaults to 1 so it snaps down to the next integer   (Excel: =FLOOR.MATH(x, sig))", create: () => new MRoundNode({ op: "down" }), keywords: "floor round down multiple significance" },
          ]},
          { type: "pair", children: [
            mathLeaf("int"),
            { type: "math-mround", label: "MROUND", description: "Round to nearest multiple   (Excel: =MROUND(x, multiple))", create: () => new MRoundNode(), keywords: "mround round nearest multiple ceil floor ceiling" },
          ]},
          { type: "pair", children: [mathLeaf("even"), mathLeaf("odd")] },
          { type: "roundn-round", label: "ROUND to N digits", description: "Round to N decimal places   (Excel: =ROUND(x,2))", create: () => new RoundNNode({ op: "round" }) },
          { type: "roundn-dir", label: "ROUNDUP / ROUNDDOWN", description: "Round away from zero (UP) or toward zero (DOWN) to N decimal places — pick direction in the node   (Excel: =ROUNDUP / =ROUNDDOWN)", create: () => new RoundNNode({ op: "roundup" }) },
          { type: "clamp", label: "Clamp", description: "Constrain a value to [min, max]   (Excel: =MIN(MAX(x,min),max))", create: () => new ClampNode() },
        ],
      },
      {
        type: "category", label: "Logarithms", description: "Logarithms and their inverses.",
        children: [
          { type: "pair", children: [
            mathLeaf("log"),
            mathLeaf("exp", { type: "math-exp-inv", description: "e to the power x — inverse of LN   (Excel: =EXP(x))" }),
          ]},
          { type: "pair", children: [mathLeaf("log10"), mathLeaf("log2")] },
          twoMathLeaf("log"),
        ],
      },
      {
        type: "category", label: "Trigonometry", description: "Angles in radians. Use Convert to go between degrees and radians.",
        children: [
          { type: "pair", children: [mathLeaf("sin"), mathLeaf("asin")] },
          { type: "pair", children: [mathLeaf("cos"), mathLeaf("acos")] },
          { type: "pair", children: [mathLeaf("tan"), mathLeaf("atan")] },
          { type: "pair", children: [mathLeaf("cot"), mathLeaf("acot")] },
          { type: "pair", children: [mathLeaf("csc"), mathLeaf("sec")] },
          twoMathLeaf("atan2"),
          // HYPOT lives in the Geometry / Timesavers packs as HYPOTENUSE (it's
          // not an Excel function); inserted here by the catalog builder.
        ],
      },
      {
        type: "category", label: "Hyperbolic", description: "Hyperbolic functions and their inverses.",
        children: [
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
          { type: "multinomial", label: "MULTINOMIAL", description: "Multinomial coefficient (n₁+n₂+…)! / (n₁!·n₂!·…)   (Excel: =MULTINOMIAL)", create: () => new MultinomialNode() },
        ],
      },
      {
        type: "category", label: "Bitwise", description: "Integer bit manipulation — AND, OR, XOR, shifts.",
        children: [
          { type: "pair", children: [bitwiseLeaf("bitand"), bitwiseLeaf("bitor")] },
          { type: "pair", children: [bitwiseLeaf("bitxor"), bitwiseLeaf("bitlshift")] },
          bitwiseLeaf("bitrshift"),
        ],
      },
      {
        type: "category", label: "Engineering", description: "DELTA, GESTEP, SERIESSUM, base conversion.",
        children: [
          { type: "pair", children: [twoMathLeaf("delta"), twoMathLeaf("gestep")] },
          { type: "seriessum", label: "SERIESSUM", description: "Power series sum Σ cᵢ·x^(n+i·m) using a list of coefficients   (Excel: =SERIESSUM)", create: () => new SeriesSumNode() },
          { type: "base-convert", label: "Base Convert", description: "Convert an integer between number bases — BIN2DEC, DEC2BIN, OCT2DEC, DEC2OCT, BIN2OCT, etc. Wire From and To base or set them inline. Bases needing A–F digits return null.", create: () => new BaseConvertNode(), parity: false },
          {
            type: "category", label: "Bessel", description: "Bessel and modified Bessel functions (J, Y, I, K) — used in signal processing, heat transfer, and physics.",
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
          { type: "cx-unpack", label: "IM Unpack",  description: "Extract Real, Imaginary, |z|, and arg(z) from a complex number   (Excel: =IMREAL / =IMAGINARY / =IMABS / =IMARGUMENT)", create: () => new ComplexUnpackNode(), parity: false },
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
              { type: "cx-power", label: "IMPOWER", description: "Complex number raised to a real power   (Excel: =IMPOWER)", create: () => new ComplexPowerNode(), parity: false },
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
          { type: "list-range",    label: "Range",     description: "Generate a sequence: start, start+step, …, < stop   (Excel: =SEQUENCE or =ROW() trick)", accent: NODE_KIND_ACCENTS.list, create: () => new RangeNode() },
          { type: "list-linspace", label: "LinSpace",  description: "Count evenly spaced values from Start to End inclusive", create: () => new LinSpaceNode() },
          { type: "list-vstack",   label: "VStack",    description: "Join two lists end-to-end   (Excel: =VSTACK)", create: () => new VStackNode() },
          { type: "list-repeat",   label: "Repeat",    description: "Array of one value repeated N times   (e.g. ZEROS / ONES)", create: () => new RepeatNode() },
          { type: "pair", children: [
            { type: "list-geometric", label: "Geometric", description: "Geometric series: start × ratio^0, start × ratio^1, …", create: () => new GeometricNode() },
            { type: "list-fibonacci", label: "Fibonacci",  description: "First N Fibonacci numbers: 1, 1, 2, 3, 5, 8, …", create: () => new FibonacciNode() },
          ]},
          { type: "list-randarray", label: "RANDARRAY", description: "List of N random numbers between Min and Max   (Excel: =RANDARRAY)", create: () => new RandArrayNode(), parity: false },
          { type: "list-sequence",  label: "SEQUENCE",  description: "List of N numbers starting at Start with Step between each — like Range but count-first   (Excel: =SEQUENCE)", create: () => new SequenceNode(), parity: false },
        ],
      },
      {
        type: "category", label: "Shape", description: "Reorder, trim, and filter lists.",
        children: [
          { type: "list-filter",  label: "FILTER", description: "Keep list values or table rows that pass a condition   (Excel: =FILTER). One or two comparisons (AND/OR), or wire a Keep-if mask (nonzero keeps). Chain with SUM / COUNT / AVERAGE for SUMIF(S) / COUNTIF(S).", accent: NODE_KIND_ACCENTS.list, create: () => new FilterNode() },
          { type: "list-fill",  label: "Coalesce / Fill", description: "Handle missing (null) cells: fill with a constant, forward/back-fill, impute mean/median/mode, interpolate, drop them, or coalesce any number of lists in priority order (first present wins, SQL COALESCE). Errors pass through; stats use the present values only. Pairs with ISNULL.", accent: NODE_KIND_ACCENTS.list, create: () => new FillNode() },
          { type: "pair", children: [
            { type: "list-sort",    label: "SORT",    description: "Sort ascending or descending   (Excel: =SORT(range))", create: () => new SortNode() },
            { type: "list-reverse", label: "REVERSE", description: "Reverse the order of the list", create: () => new ReverseNode() },
          ]},
          { type: "list-slice",   label: "SLICE",  description: "Sublist from Start to End, 1-based inclusive (leave End blank for to-the-end)", create: () => new SliceNode() },
          { type: "pair", children: [
            { type: "list-take",  label: "TAKE",   description: "Keep the first or last N elements   (Excel: =TAKE)", create: () => new TakeNode() },
            { type: "list-drop",  label: "DROP",   description: "Remove the first or last N elements   (Excel: =DROP)", create: () => new DropNode() },
          ]},
          { type: "list-unique",  label: "UNIQUE", description: "Remove duplicates, preserving first-occurrence order   (Excel: =UNIQUE)", create: () => new UniqueNode() },
          { type: "pair", children: [
            { type: "list-diff",       label: "DIFF",       description: "Consecutive differences — result[i] = list[i+1] − list[i]", create: () => new DiffNode() },
            { type: "list-cumulative", label: "Cumulative", description: "Running SUM / MAX / MIN / PRODUCT along the list", create: () => new CumulativeNode() },
          ]},
          { type: "pair", children: [
            { type: "list-normalize",  label: "Normalize",  description: "Scale list to 0–1 range — min maps to 0, max maps to 1", create: () => new NormalizeNode() },
            { type: "list-shuffle",    label: "Shuffle",    description: "Randomly reorder the list (Fisher-Yates)", create: () => new ShuffleNode() },
          ]},
          { type: "pair", children: [
            { type: "list-interleave", label: "Interleave", description: "Alternate elements of two lists: A[0], B[0], A[1], B[1], …", create: () => new InterleaveNode() },
            { type: "list-nthelement", label: "Nth Element", description: "Every N-th element (step subsampling)", create: () => new NthElementNode() },
          ]},
          { type: "list-pad", label: "Pad", description: "Extend list to a target length by prepending or appending a fill value   (Excel: PADLEFT / PADRIGHT)", create: () => new PadNode() },
          { type: "list-sortby", label: "SORTBY", description: "Sort one list by the values in a parallel list — elements at the same index stay paired   (Excel 365: =SORTBY)", create: () => new SortByNode(), parity: false },
          {
            type: "category", label: "Rolling", description: "Sliding-window aggregate over a list.",
            children: [
              { type: "pair", children: [rollingLeaf("sum"), rollingLeaf("avg")] },
              { type: "pair", children: [rollingLeaf("min"), rollingLeaf("max")] },
              { type: "pair", children: [rollingLeaf("stdev"), rollingLeaf("median")] },
            ],
          },
        ],
      },
      {
        type: "category", label: "Find", description: "Look up values and positions.",
        children: [
          { type: "pair", children: [
            { type: "lookup-xlookup", label: "XLOOKUP", description: "Find a value in one list, return the value at the same position in another   (Excel: =XLOOKUP)", accent: NODE_KIND_ACCENTS.list, create: () => new XLookupNode() },
            { type: "lookup-xmatch",  label: "XMATCH",  description: "1-based position with match mode selector (exact / next larger / next smaller) — supersedes the classic MATCH   (Excel 365: =XMATCH)", create: () => new XMatchNode() },
          ]},
          { type: "pair", children: [
            { type: "list-length", label: "LENGTH",  description: "Number of elements in the list   (Excel: =COUNT / =ROWS)", create: () => new ListLengthNode() },
            { type: "list-index",  label: "INDEX",   description: "Read a cell out of any container: the nth of a list, the (Row, Column) of a Matrix, or the cell of a Frame / Cube. A nested Frame/Cube cell comes out whole, so this is how you pull data back out of a Cube.   (Excel: =INDEX(range, row, col))", create: () => new ListIndexNode(), keywords: "cube frame cell nested drill get cell unnest" },
          ]},
          { type: "pair", children: [argLeaf("argmax"), argLeaf("argmin")] },
          { type: "list-contains", label: "CONTAINS", description: "1 if the list contains the value, else 0   (Excel: =ISNUMBER(MATCH(value,range,0)))", create: () => new ContainsNode() },
        ],
      },
      { type: "list-groupby", label: "Group Lists", description: "Group a parallel key-value pair of LISTS and aggregate each group — produces unique-keys and aggregated-values outputs. (For a whole table use the frame Group By; Excel 365: =GROUPBY, simplified 1D.)", create: () => new GroupByNode(), parity: false },
      {
        type: "category", label: "Aggregate", description: "Reduce a list to a single number.",
        children: [
          spLeaf("sumproduct"),
          { type: "pair", children: [reduceLeaf("sum"), reduceLeaf("product")] },
          { type: "pair", children: [reduceLeaf("avg"), reduceLeaf("median")] },
          { type: "pair", children: [reduceLeaf("min"), reduceLeaf("max")] },
          reduceLeaf("count"),
          { type: "pair", children: [reduceLeaf("geomean"), reduceLeaf("harmean")] },
          { type: "pair", children: [reduceLeaf("stdev"), reduceLeaf("stdev_p")] },
          { type: "pair", children: [reduceLeaf("var_s"), reduceLeaf("var_p")] },
          { type: "pair", children: [reduceLeaf("sumsq"), reduceLeaf("devsq")] },
          reduceLeaf("avedev"),
          { type: "pair", children: [reduceLeaf("skew"), reduceLeaf("skew_p")] },
          reduceLeaf("kurt"),
          correlLeaf("correl"),
          spLeaf("sumx2my2"),
          { type: "pair", children: [spLeaf("sumx2py2"), spLeaf("sumxmy2")] },
          { type: "pair", children: [covLeaf("pop"), covLeaf("samp")] },
          { type: "pair", children: [fisherLeaf("fisher"), fisherLeaf("fisherinv")] },
          { type: "pair", children: [weightedLeaf("wavg"), weightedLeaf("wstdev")] },
          weightedLeaf("wvar"),
        ],
      },
      {
        type: "category", label: "Rank", description: "Rank, percentile, and distribution queries.",
        children: [
          { type: "pair", children: [nthLeaf("large"), nthLeaf("small")] },
          { type: "stat-percentile",  label: "PERCENTILE",  description: "Value at percentile p (0–1)   (Excel: =PERCENTILE.INC)", create: () => new PercentileNode() },
          { type: "stat-quartile",    label: "QUARTILE",    description: "Quartile Q0–Q4   (Excel: =QUARTILE.INC)", create: () => new QuartileNode() },
          { type: "stat-percentrank", label: "PERCENTRANK", description: "Percentile rank of a value (0–1)   (Excel: =PERCENTRANK.INC)", create: () => new PercentrankNode() },
          { type: "pair", children: [rankLeaf("eq"), rankLeaf("avg")] },
        ],
      },
      {
        type: "category", label: "Regression", description: "Linear regression: fit a line, predict, measure error.",
        children: [
          { type: "linest",  label: "LINEST",  description: "Linear regression: three separate outputs — slope, intercept, and R² — wired individually   (Excel: =LINEST; supersedes SLOPE, INTERCEPT, RSQ)", create: () => new LinestNode(), parity: false },
          { type: "forecast", label: "FORECAST.LINEAR", description: "Predict y for new x using linear regression through known data   (Excel: =FORECAST.LINEAR)", create: () => new ForecastNode() },
          regressionLeaf("steyx"),
          { type: "logest",  label: "LOGEST",  description: "Exponential regression: [m, b] where y = b·mˣ — requires all Ys > 0   (Excel: =LOGEST)", create: () => new LogestNode(), parity: false },
          { type: "trend",   label: "TREND",   description: "Predict Y values for new Xs using a fitted linear regression   (Excel: =TREND)", create: () => new TrendNode(), parity: false },
        ],
      },
      {
        type: "category", label: "Tests", description: "Hypothesis tests — returns p-value.",
        children: [
          { type: "z-test",    label: "Z.TEST",    description: "One-tailed z-test: P(mean > μ₀) given a population or sample   (Excel: =Z.TEST)", create: () => new ZTestNode(), parity: false },
          { type: "pair", children: [ttestLeaf("paired"), ttestLeaf("equal-var")] },
          { type: "t-test-unequal-var", label: "T.TEST (Welch)", description: "Two-sample t-test assuming unequal variances — Welch's t-test (2-tailed)   (Excel: =T.TEST type=3)", create: () => new TTestNode({ op: "unequal-var" }) },
          { type: "f-test",    label: "F.TEST",    description: "Two-tailed F-test for equal variances   (Excel: =F.TEST)", create: () => new FTestNode() },
          { type: "chisq-test", label: "CHISQ.TEST", description: "Chi-square goodness-of-fit test (observed vs. expected)   (Excel: =CHISQ.TEST)", create: () => new ChisqTestNode() },
        ],
      },
      {
        type: "category", label: "Stats", description: "Distribution summaries and frequency analysis.",
        children: [
          { type: "mode",      label: "MODE",      description: "Most frequent value — ties resolved by smallest value   (Excel: =MODE.SNGL)", create: () => new ModeNode() },
          { type: "mode-mult", label: "MODE.MULT", description: "All modes as a list — use when multiple values tie for most frequent   (Excel: =MODE.MULT)", create: () => new ModMultNode() },
          { type: "trimmean", label: "TRIMMEAN",  description: "Average after removing the top and bottom p/2 fraction of values   (Excel: =TRIMMEAN(list, percent))", create: () => new TrimMeanNode() },
          { type: "frequency", label: "FREQUENCY", description: "Count values falling into each bin interval — result has bins+1 elements   (Excel: =FREQUENCY)", create: () => new FrequencyNode() },
          { type: "pair", children: [
            { type: "confidence-norm", label: "CONFIDENCE.NORM", description: "Normal-distribution confidence interval half-width   (Excel: =CONFIDENCE.NORM)", create: () => new ConfidenceNode({ op: "norm" }) },
            { type: "confidence-t",    label: "CONFIDENCE.T",    description: "t-distribution confidence interval half-width   (Excel: =CONFIDENCE.T)", create: () => new ConfidenceNode({ op: "t" }) },
          ]},
          { type: "prob", label: "PROB", description: "Sum of probabilities for values in a range [lo, hi]   (Excel: =PROB(range, prob_range, lower_limit, upper_limit))", create: () => new ProbNode() },
        ],
      },
    ],
  },

  // ── LOGIC ────────────────────────────────────────────────────────────────────
  {
    type: "category", label: "Logic", description: "Decisions, comparisons, boolean operations, and fallback handling.",
    children: [
      { type: "if", label: "IF", description: "If Condition is true → Value if true, else → Value if false   (Excel: =IF(A,B,C))", create: () => new IfNode(), accent: NODE_KIND_ACCENTS.logic },
      { type: "choose",  label: "CHOOSE",        description: "Return one of several values by a 1-based index — add as many values as you need   (Excel: =CHOOSE(index, val1, val2, …))", create: () => new ChooseNode() },
      { type: "switch",  label: "SWITCH",         description: "Match a value against as many cases as you add, return the matching result — or a default   (Excel: =SWITCH)", create: () => new SwitchNode() },
      { type: "ifs",     label: "IFS",            description: "Return the first value whose condition is non-zero — like chained IF; add as many condition/value pairs as you need, plus an Otherwise fallback   (Excel: =IFS)", create: () => new IfsNode() },
      { type: "iferror", label: "IFERROR / IFNA", description: "Return Fallback when Value is an error (IFERROR) or null/not-found (IFNA)   (Excel: =IFERROR / =IFNA)", create: () => new IFErrorNode() },
      { type: "is-test", label: "IS.TEST",    description: "Test whether a value is a number, blank, error, N/A, boolean, text, or non-text   (Excel: =ISNUMBER / =ISBLANK / =ISERROR / =ISNA / =ISLOGICAL / =ISTEXT / =ISNONTEXT)", create: () => new IsTestNode() },
      { type: "iseven-isodd", label: "ISEVEN / ISODD", description: "TRUE if a number's integer part is even (ISEVEN) or odd (ISODD) — pick which in the node. Emits a logical; broadcasts over a list   (Excel: =ISEVEN / =ISODD)", create: () => new IsEvenOddNode() },
      { type: "comparison", label: "Comparison",  description: "Compare two values → 1 (true) or 0 (false). Pick the operator (>, <, ≥, ≤, =, ≠) in the node.", create: () => new ComparisonNode() },
      {
        type: "category", label: "Boolean", description: "Combine 0/1 signals. Any non-zero input counts as true.",
        children: [
          { type: "pair", children: [booleanLeaf("and"), booleanLeaf("or")] },
          { type: "not", label: "NOT", description: "Flip a single input: true → FALSE, false → TRUE; broadcasts over a list   (Excel: =NOT(A))", create: () => new NotNode() },
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
        type: "category", label: "Rate conversion", description: "Convert between nominal and effective interest rates.",
        children: [{ type: "pair", children: [irLeaf("effect"), irLeaf("nominal")] }],
      },
      {
        type: "category", label: "Time value of money", description: "PMT, PV, FV, NPER — core loan and investment calculations.",
        children: [
          { type: "pair", children: [tvmLeaf("pmt"), tvmLeaf("pv")] },
          { type: "pair", children: [tvmLeaf("fv"), tvmLeaf("nper")] },
          { type: "rate", label: "RATE", description: "Interest rate per period — solved iteratively from nper, pmt, pv   (Excel: =RATE)", create: () => new RateNode() },
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
          { type: "npv",  label: "NPV",  description: "Net present value of cash flows discounted at a given rate (first flow = period 1)   (Excel: =NPV(rate, values))", create: () => new NpvNode() },
          { type: "irr",  label: "IRR",  description: "Internal rate of return — rate at which NPV = 0   (Excel: =IRR(values))", create: () => new IrrNode() },
          { type: "mirr", label: "MIRR", description: "Modified IRR accounting for reinvestment rate and cost of capital   (Excel: =MIRR(values, finance_rate, reinvest_rate))", create: () => new MirrNode() },
          { type: "xirr", label: "XIRR", description: "IRR for cash flows at irregular dates — wire a list of flows and a parallel list of date serials   (Excel: =XIRR)", create: () => new XirrNode(), parity: false },
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
          { type: "vdb", label: "VDB", description: "Variable declining balance depreciation over a period range — uses DDB and switches to straight-line when SL gives a higher deduction   (Excel: =VDB)", create: () => new VdbNode() },
        ],
      },
      {
        type: "category", label: "Other", description: "Miscellaneous financial functions.",
        children: [
          { type: "fvschedule", label: "FVSCHEDULE", description: "Future value of principal after applying a schedule of interest rates   (Excel: =FVSCHEDULE)", create: () => new FvScheduleNode() },
          { type: "ispmt",      label: "ISPMT",      description: "Interest paid in a specific period of a straight-line-principal loan   (Excel: =ISPMT)", create: () => new IspmtNode() },
          { type: "pair", children: [dollarLeaf("dollarde"), dollarLeaf("dollarfr")] },
          { type: "pair", children: [
            { type: "pduration", label: "PDURATION", description: "Periods needed to grow PV to FV at a given rate   (Excel: =PDURATION)", create: () => new PdurationNode() },
            { type: "rri",       label: "RRI",       description: "Equivalent interest rate for growth from PV to FV in N periods   (Excel: =RRI)", create: () => new RriNode() },
          ]},
          { type: "pair", children: [tbillLeaf("tbilleq"), tbillLeaf("tbillprice")] },
          tbillLeaf("tbillyield"),
          { type: "pair", children: [secDiscLeaf("disc"), secDiscLeaf("intrate")] },
          secDiscLeaf("received"),
          { type: "accrint",  label: "ACCRINT",  description: "Accrued interest for a security that pays periodic interest   (Excel: =ACCRINT)",  create: () => new AccrintNode(),  parity: false },
          { type: "accrintm", label: "ACCRINTM", description: "Accrued interest for a security that pays interest at maturity   (Excel: =ACCRINTM)", create: () => new AccrintMNode(), parity: false },
          { type: "pair", children: [priceDiscLeaf("pricedisc"), priceDiscLeaf("yielddisc")] },
          { type: "pair", children: [priceMatLeaf("pricemat"),  priceMatLeaf("yieldmat")]  },
          { type: "pair", children: [durationLeaf("duration"),  durationLeaf("mduration")] },
          { type: "xnpv", label: "XNPV", description: "Net present value of cash flows with specific dates — like NPV but with explicit dates   (Excel: =XNPV)", create: () => new XnpvNode(), parity: false },
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
    type: "category", label: "Distributions", description: "Probability distributions: CDF, PDF/PMF, and inverse (quantile) functions.",
    children: [
      {
        type: "category", label: "Normal", description: "Normal / Gaussian distribution.",
        children: [
          { type: "pair", children: [
            { type: "normdist",  label: "NORM.DIST",   description: "Normal CDF or PDF   (Excel: =NORM.DIST(x, mean, stdev, cumulative))", create: () => new NormDistNode() },
            { type: "norminv",   label: "NORM.INV",    description: "Inverse normal — value at percentile p   (Excel: =NORM.INV)", create: () => new NormInvNode() },
          ]},
          { type: "pair", children: [
            { type: "normsdist", label: "NORM.S.DIST", description: "Standard normal CDF or PDF (mean=0, stdev=1)   (Excel: =NORM.S.DIST)", create: () => new NormSDistNode() },
            { type: "normsinv",  label: "NORM.S.INV",  description: "Inverse standard normal   (Excel: =NORM.S.INV)", create: () => new NormSInvNode() },
          ]},
        ],
      },
      {
        type: "category", label: "t-distribution", description: "Student's t-distribution for small samples.",
        children: [{ type: "pair", children: [
          { type: "tdist", label: "T.DIST", description: "t CDF, PDF, two-tailed, or right-tail   (Excel: =T.DIST / T.DIST.2T / T.DIST.RT)", create: () => new TDistNode() },
          { type: "tinv",  label: "T.INV",  description: "Inverse t-distribution — left-tail or two-tailed   (Excel: =T.INV / T.INV.2T)", create: () => new TInvNode() },
        ]}],
      },
      {
        type: "category", label: "Chi-Squared", description: "Chi-squared distribution.",
        children: [{ type: "pair", children: [
          { type: "chisqdist", label: "CHISQ.DIST", description: "Chi-squared CDF, PDF, or right-tail   (Excel: =CHISQ.DIST / CHISQ.DIST.RT)", create: () => new ChisqDistNode() },
          { type: "chisqinv",  label: "CHISQ.INV",  description: "Inverse chi-squared   (Excel: =CHISQ.INV / CHISQ.INV.RT)", create: () => new ChisqInvNode() },
        ]}],
      },
      {
        type: "category", label: "F-distribution", description: "F distribution for variance ratios.",
        children: [{ type: "pair", children: [
          { type: "fdist", label: "F.DIST", description: "F CDF, PDF, or right-tail   (Excel: =F.DIST / F.DIST.RT)", create: () => new FDistNode() },
          { type: "finv",  label: "F.INV",  description: "Inverse F distribution   (Excel: =F.INV / F.INV.RT)", create: () => new FInvNode() },
        ]}],
      },
      {
        type: "category", label: "Beta", description: "Beta distribution for probabilities and proportions.",
        children: [{ type: "pair", children: [
          { type: "betadist", label: "BETA.DIST", description: "Beta CDF or PDF   (Excel: =BETA.DIST)", create: () => new BetaDistNode() },
          { type: "betainv",  label: "BETA.INV",  description: "Inverse beta distribution   (Excel: =BETA.INV)", create: () => new BetaInvNode() },
        ]}],
      },
      {
        type: "category", label: "Gamma", description: "Gamma distribution for waiting times.",
        children: [{ type: "pair", children: [
          { type: "gammadist", label: "GAMMA.DIST", description: "Gamma CDF or PDF   (Excel: =GAMMA.DIST)", create: () => new GammaDistNode() },
          { type: "gammainv",  label: "GAMMA.INV",  description: "Inverse gamma distribution   (Excel: =GAMMA.INV)", create: () => new GammaInvNode() },
        ]}],
      },
      {
        type: "category", label: "Lognormal", description: "Lognormal distribution — variable whose log is normal.",
        children: [{ type: "pair", children: [
          { type: "lognormdist", label: "LOGNORM.DIST", description: "Lognormal CDF or PDF   (Excel: =LOGNORM.DIST)", create: () => new LognormDistNode() },
          { type: "lognorminv",  label: "LOGNORM.INV",  description: "Inverse lognormal   (Excel: =LOGNORM.INV)", create: () => new LognormInvNode() },
        ]}],
      },
      {
        type: "category", label: "Other continuous", description: "Weibull and exponential distributions.",
        children: [{ type: "pair", children: [
          { type: "weibulldist", label: "WEIBULL.DIST", description: "Weibull CDF or PDF — failure / reliability modeling   (Excel: =WEIBULL.DIST)", create: () => new WeibullDistNode() },
          { type: "expodist",    label: "EXPON.DIST",   description: "Exponential CDF or PDF — time between events   (Excel: =EXPON.DIST)", create: () => new ExponDistNode() },
        ]}],
      },
      {
        type: "category", label: "Discrete", description: "Discrete distributions: binomial, Poisson, hypergeometric, negative binomial.",
        children: [
          { type: "pair", children: [
            { type: "binomdist", label: "BINOM.DIST", description: "Binomial PMF or CDF — k successes in n trials   (Excel: =BINOM.DIST)", create: () => new BinomDistNode() },
            { type: "binominv",  label: "BINOM.INV",  description: "Smallest k such that BINOM.DIST CDF ≥ alpha   (Excel: =BINOM.INV / CRITBINOM)", create: () => new BinomInvNode() },
          ]},
          { type: "poissondist", label: "POISSON.DIST", description: "Poisson PMF or CDF — events in a fixed interval   (Excel: =POISSON.DIST)", create: () => new PoissonDistNode() },
          { type: "pair", children: [
            { type: "hypgeomdist",  label: "HYPGEOM.DIST",  description: "Hypergeometric PMF or CDF — sampling without replacement   (Excel: =HYPGEOM.DIST)", create: () => new HypgeomDistNode() },
            { type: "negbinomdist", label: "NEGBINOM.DIST", description: "Negative binomial PMF or CDF — failures before r-th success   (Excel: =NEGBINOM.DIST)", create: () => new NegbinomDistNode() },
          ]},
          { type: "binomdistrng", label: "BINOM.DIST.RANGE", description: "P(lo ≤ X ≤ hi) — sum of binomial PMFs over a range   (Excel: =BINOM.DIST.RANGE)", create: () => new BinomDistRangeNode() },
        ],
      },
    ],
  },

  // ── DATE & TIME ───────────────────────────────────────────────────────────────
  {
    type: "category", label: "Date & Time", description: "Date serial type (like Excel): sources, extract parts, arithmetic, and working-day calculations.",
    children: [
      { type: "date-construct", label: "DATE",      description: "Build a date from Year, Month, Day — handles overflow (month 13 → Jan next year)   (Excel: =DATE)", create: () => new DateConstructNode(), parity: false, accent: DT },
      { type: "pair", children: [todayNowLeaf("today"), todayNowLeaf("now")] },
      { type: "date-time",     label: "TIME",      description: "Build a time fraction 0–1 from Hour, Minute, Second — add to a date serial for date+time   (Excel: =TIME)", create: () => new TimeConstructNode(), parity: false },
      {
        type: "category", label: "Parse", description: "Convert text strings to date or time values.",
        children: [
          { type: "date-value",  label: "DATEVALUE", description: "Parse a date string (e.g. \"2026-06-15\") into a date serial   (Excel: =DATEVALUE, parity: ISO format)", create: () => new DateValueNode(),  parity: false },
          { type: "time-value",  label: "TIMEVALUE", description: "Parse a time string (e.g. \"14:30:00\") into a fraction 0–1   (Excel: =TIMEVALUE)", create: () => new TimeValueNode(),  parity: false },
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
        type: "category", label: "Add Months", description: "Shift a date by N months or jump to end of month.",
        children: [
          { type: "pair", children: [dateAddLeaf("edate"), dateAddLeaf("eomonth")] },
        ],
      },
      { type: "date-workday",     label: "WORKDAY",     description: "Date N working days from start — weekend_code 1=Sat+Sun, 2–7 and 11–17 per Excel   (Excel: =WORKDAY / =WORKDAY.INTL via weekend_code)", create: () => new WorkdayNode(),     parity: false },
      { type: "date-networkdays", label: "NETWORKDAYS", description: "Count working days between start and end — weekend_code 1=Sat+Sun, 2–7 and 11–17 per Excel   (Excel: =NETWORKDAYS / =NETWORKDAYS.INTL via weekend_code)", create: () => new NetworkdaysNode(), parity: false },
      { type: "date-datedif",     label: "DATEDIF",     description: "Difference between two dates in Years, Months, or Days — unit selector on the node   (Excel: =DATEDIF)", create: () => new DateIfNode(),      parity: false },
    ],
  },

  // ── TEXT ─────────────────────────────────────────────────────────────────────
  {
    type: "category", label: "Text", description: "String type: inputs, manipulation, and conversion to/from numbers.",
    children: [
      { type: "text-dollar", label: "DOLLAR",  description: "Format a number as a currency string — \"$1,234.56\" or \"-$78.90\"   (Excel: =DOLLAR)", create: () => new FormatDollarNode(), parity: false },
      { type: "text-numbervalue", label: "NUMBERVALUE", description: "Parse a number from a string with custom decimal and group separators — e.g. \"1.234,56\" with decimal=\",\" group=\".\"   (Excel: =NUMBERVALUE)", create: () => new NumberValueNode(), parity: false },
      { type: "text-fixed", label: "FIXED",     description: "Format a number as a fixed-decimal string with optional thousands separators   (Excel: =FIXED)", create: () => new FixedNode(), parity: false },
      { type: "pair", children: [romanArabicLeaf("roman"), romanArabicLeaf("arabic")] },
      {
        type: "category", label: "Transform", description: "Case, whitespace, and character manipulation.",
        children: [
          { type: "pair", children: [textXformLeaf("upper"), textXformLeaf("lower")] },
          { type: "pair", children: [textXformLeaf("trim"),  textXformLeaf("proper")] },
          textXformLeaf("clean"),
          { type: "text-map",    label: "Text Map",    description: "Apply UPPER / LOWER / TRIM / PROPER / CLEAN to every string in a list", create: () => new TextMapNode(),    parity: false },
          { type: "text-filter", label: "Text Filter", description: "Keep strings from a list that contain, start with, or end with a pattern — case-sensitive", create: () => new TextFilterNode(), parity: false },
        ],
      },
      {
        type: "category", label: "Build & Slice", description: "Concatenate, split, and extract substrings.",
        children: [
          { type: "text-concat", label: "CONCAT",    description: "Join up to 4 strings together (A + B + C + D)   (Excel: =CONCAT)",                            accent: STR, create: () => new ConcatNode(),    parity: false },
          { type: "text-join",   label: "TEXTJOIN",  description: "Join a list of strings with a delimiter, optionally ignoring empty strings   (Excel: =TEXTJOIN)",             create: () => new TextJoinNode(),  parity: false },
          { type: "text-split",  label: "TEXTSPLIT", description: "Split text at a delimiter into a list of strings   (Excel: =TEXTSPLIT)",                                      create: () => new TextSplitNode(), parity: false },
          { type: "pair", children: [textSliceLeaf("left"), textSliceLeaf("right")] },
          textSliceLeaf("mid"),
          { type: "text-rept",   label: "REPT",      description: "Repeat text N times   (Excel: =REPT)",                                                                        create: () => new ReptNode(),      parity: false },
        ],
      },
      {
        type: "category", label: "Search & Replace", description: "Find positions, replace substrings, extract around delimiters.",
        children: [
          { type: "pair", children: [textFindLeaf("find"), textFindLeaf("search")] },
          { type: "pair", children: [textAfterBeforeLeaf("after"), textAfterBeforeLeaf("before")] },
          { type: "text-substitute", label: "SUBSTITUTE",  description: "Replace all occurrences of old_text with new_text   (Excel: =SUBSTITUTE)", create: () => new SubstituteNode(),   parity: false },
          { type: "text-replace",    label: "REPLACE",     description: "Replace N characters starting at a position   (Excel: =REPLACE)",          create: () => new TextReplaceNode(), parity: false },
          { type: "regex",           label: "REGEX",       description: "REGEXTEST / REGEXEXTRACT / REGEXREPLACE — test, extract, or replace text using a regular expression   (Excel 365: =REGEXTEST / =REGEXEXTRACT / =REGEXREPLACE)", create: () => new RegexNode(), parity: false },
        ],
      },
      {
        type: "category", label: "Measure & Encode", description: "String length, comparison, and character encoding.",
        children: [
          { type: "text-len",   label: "LEN",   description: "Number of characters in the string   (Excel: =LEN)",                          create: () => new TextLenNode(), parity: false },
          { type: "text-exact", label: "EXACT", description: "1 if two strings are identical (case-sensitive), else 0   (Excel: =EXACT)", create: () => new ExactNode(),   parity: false },
          { type: "pair", children: [charCodeLeaf("char"), charCodeLeaf("code")] },
          { type: "pair", children: [
            { type: "url-encode", label: "ENCODEURL", description: "Percent-encode a string for use in a URL — spaces become %20, etc.   (Excel: =ENCODEURL)", create: () => new UrlEncodeNode({ op: "encode" }), parity: false },
            { type: "url-decode", label: "DECODEURL", description: "Decode a percent-encoded URL string — %20 becomes space, etc.", create: () => new UrlEncodeNode({ op: "decode" }), parity: false },
          ]},
        ],
      },
    ],
  },

  // ── TABLES & FRAMES ───────────────────────────────────────────────────────────
  {
    type: "category", label: "Tables & Frames", description: "2D data: numeric tables and matrix math, plus data frames with named columns, reshape, and selection.",
    children: [
      { type: "table-info",  label: "ROWS / COLUMNS", description: "Number of rows and number of columns in a table   (Excel: =ROWS / =COLUMNS)", create: () => new TableInfoNode(), parity: false },
      {
        type: "category", label: "Matrix math", description: "Linear algebra: multiply, invert, determinant, identity.",
        children: [
          { type: "table-mult",      label: "MMULT",     description: "Matrix multiply — A (m×n) × B (n×p) → result (m×p)   (Excel: =MMULT)",                                    create: () => new TableMultNode(),                   parity: false },
          { type: "pair", children: [matDetLeaf("mdeterm"), matDetLeaf("minverse")] },
          { type: "table-unit",      label: "MUNIT",     description: "n×n identity matrix — diagonal 1s, rest 0s   (Excel: =MUNIT)",                                             create: () => new TableUnitNode(),                   parity: false },
          { type: "table-transpose", label: "TRANSPOSE", description: "Flip rows and columns of a table   (Excel: =TRANSPOSE)",                                                    create: () => new TableTransposeNode(),              parity: false },
        ],
      },
      {
        type: "category", label: "Shape", description: "Reshape between 1D lists and 2D tables, stack tables side-by-side.",
        children: [
          { type: "pair", children: [reshapeLeaf("wraprows"), reshapeLeaf("wrapcols")] },
          { type: "pair", children: [reshapeLeaf("tocol"),    reshapeLeaf("torow")]    },
          { type: "hstack-table", label: "HSTACK", description: "Concatenate two tables side by side (same number of rows)   (Excel: =HSTACK)", create: () => new HStackTableNode(), parity: false },
        ],
      },
      {
        type: "category", label: "Select", description: "Pick specific rows or columns by index.",
        children: [
          { type: "pair", children: [selectLeaf("chooserows"), selectLeaf("choosecols")] },
        ],
      },
      {
        type: "category", label: "Lambda (per-cell / per-row)", description: "Apply a formula over a table: each cell, each row/column, fold to one value, or generate from indices.",
        children: [
          { type: "map-table",  label: "MAP",       description: "Apply a formula to every cell of up to three same-shaped tables   (Excel: =MAP). Variables x, y, z = each table's cell; r, c = 1-based position (a scalar y/z broadcasts). Pick the result type for text/date.", create: () => new MapTableNode(),  parity: false },
          { type: "by-axis",    label: "BYROW / BYCOL", description: "Reduce each row or column of a table to one value   (Excel: =BYROW / =BYCOL). Variable v = the row/column as a list; pick the result type for text/date.", create: () => new ByAxisNode(), parity: false },
          { type: "make-array", label: "MAKEARRAY", description: "Build a rows×cols table from a formula of its indices   (Excel: =MAKEARRAY). Variables r, c = 1-based row, column; pick the result type for text/date.", create: () => new MakeArrayNode(), parity: false },
          { type: "reduce-lambda", label: "REDUCE", description: "Fold a list or table to one value, starting from Initial   (Excel: =REDUCE). Variables acc = running value, x = current cell, i = position; pick the result type for text/date.", create: () => new ReduceLambdaNode(), parity: false },
        ],
      },
      {
        type: "category", label: "Frames (named columns)", description: "A data table = a Matrix plus a header list. Build one, take it apart, and read or add columns.",
        children: [
          { type: "build-frame", label: "Build Frame", description: "Combine a Matrix and a header text-list into a Frame. Missing headers auto-fill as Col1, Col2…; duplicates are made unique.", create: () => new BuildFrameNode(), parity: false },
          { type: "split-frame", label: "Split Frame", description: "Take a Frame apart into its numeric Matrix body and its header text-list — the inverse of Build Frame. A type filter (All / Num / Date / Bool / Text) keeps only columns of that type, so you can pull just the numeric columns out of a MIXED frame (a text·num·date·num frame → Num gives a 2-column matrix + those 2 headers). Text → headers only.", create: () => new SplitFrameNode(), parity: false },
          { type: "get-column",  label: "Get Column",  description: "Pull one column out of a Frame as a list, by name or 1-based number. Read as Number, Text, or Date (sets the output type).", create: () => new GetColumnNode(), parity: false },
          { type: "get-row",     label: "Get Row",     description: "Pull one row out of a Frame by 1-based number — a 1-row Frame (a row mixes types, so it's not a list).", create: () => new GetRowNode(), parity: false },
          { type: "add-column",  label: "Add Column",  description: "Append a list to a Frame as a new named column (or replace an existing column of that name). Shorter lists pad with blanks.", create: () => new AddColumnNode(), parity: false },
        ],
      },
      {
        type: "category", label: "Table verbs", description: "Relational verbs over a Frame: filter, sort, join, group, reshape, nest/unnest.",
        children: [
          { type: "distinct",    label: "Distinct",    description: "Remove duplicate rows from a Frame, keeping the first of each (the table form of UNIQUE). Rows compare case-sensitively — keys are identity, unlike Excel.", create: () => new DistinctNode(), parity: false },
          { type: "head",        label: "Head",        description: "Keep the first N rows of a Frame (the rest are dropped). Wire or type the row count.", create: () => new HeadNode(), parity: false },
          { type: "sort-frame",  label: "Sort",        description: "Order a Frame's rows by one column, ascending or descending. Blanks and errors sort last (Excel: =SORT).", create: () => new SortFrameNode(), parity: false },
          { type: "filter-frame",label: "Filter Rows", description: "Keep a Frame's rows whose chosen column passes a test (>, =, contains…). Chain for AND. Blanks/errors drop. Text tests ignore case like Excel's =; Match case for exact (Excel: =FILTER).", create: () => new FilterFrameNode(), parity: false },
          { type: "join",        label: "Join",        description: "Combine two Frames on a key column — inner / left / right / outer, or as-of (nearest match on a sorted number/date key, with a direction + tolerance). A left row matching several right rows fans out (as-of never fans out). Keys match case-sensitively, unlike Excel lookups. The relational JOIN (Excel: VLOOKUP/XLOOKUP do a left join one column at a time).", create: () => new JoinNode(), parity: false },
          { type: "frame-lookup",label: "Frame Lookup", description: "Look up a value in one column of a Frame OR a Cube and return the matching cell from another column — VLOOKUP / XLOOKUP for tables. On a Cube it matches the key in the top-level column and returns the matched cell WHOLE, so a nested table/cube comes out intact (drill into it with INDEX). Exact match by default; an approximate mode (≤/≥) falls back to the closest smaller/larger number (or date; a Cube key matches dates by serial). If-not-found falls back, else #N/A (Excel: =XLOOKUP / =VLOOKUP).", create: () => new FrameLookupNode(), parity: false, keywords: "xlookup vlookup lookup frame cube table match find nested" },
          { type: "select-cols", label: "Select Columns", description: "Keep only the named columns, in the order given. Type a comma-separated list or wire one (Excel: =CHOOSECOLS).", create: () => new SelectColumnsNode(), parity: false },
          { type: "drop-cols",   label: "Drop Columns",   description: "Remove the named columns from a Frame; the rest pass through. Type a comma-separated list or wire one.", create: () => new DropColumnsNode(), parity: false },
          { type: "group-by-frame", label: "Group By", description: "Group a Frame's rows by one or more key columns and aggregate one column (sum / average / min / max / count) — a PivotTable's row grouping, but keys group case-sensitively (no silent case-merge) (Excel: =GROUPBY).", create: () => new GroupByFrameNode(), parity: false },
          { type: "pivot",       label: "PIVOTBY",     description: "Cross-tab long → wide (Excel: =PIVOTBY): group by one or more Row and Column fields (multi-level headers), aggregate one or more value columns (per-value function: SUM / AVERAGE / COUNT / MEDIAN / STDEV / PRODUCT / PERCENTOF …), with grand totals + subtotals, sort, a filter mask, and % running totals. Totals re-aggregate the source.", create: () => new PivotNode(), parity: true },
          { type: "unpivot",     label: "Unpivot",     description: "Reshape wide → long (melt): keep the Id columns, turn each chosen Value column into variable/value rows. Excel's Power Query Unpivot.", create: () => new UnpivotNode(), parity: false },
          { type: "nest",        label: "Nest",        description: "Group a flat Frame by key into a Cube — each key's other columns collapse into a nested table cell. The flat → nested bridge.", create: () => new NestNode(), parity: false },
          { type: "unnest",      label: "Unnest",      description: "Expand a Cube's nested-table column back to a flat Frame — each parent row repeats per nested row. The nested → flat bridge (inverse of Nest).", create: () => new UnnestNode(), parity: false },
          { type: "append",      label: "Append",      description: "Stack two Frames vertically, matching columns by name (a missing column fills blank). A type clash on a shared column is #TYPE! (Excel: =VSTACK).", create: () => new AppendNode(), parity: false },
          { type: "rename",      label: "Rename",      description: "Rename columns via two parallel lists — From [\"qty\"] → To [\"Quantity\"], zipped by position. Type or wire each list.", create: () => new RenameNode(), parity: false },
          { type: "split-column", label: "Split Column", description: "Split one text column into several by a delimiter — the source column is replaced by the parts. Name the new columns or let them auto-number. (Power Query: Split Column by Delimiter.)", create: () => new SplitColumnNode(), parity: false, keywords: "split delimiter text column separate parse divide power query" },
          { type: "add-index",   label: "Add Index",   description: "Prepend a numeric row-number column counting from a start value (default 1). (Power Query: Add Index Column; Excel: =SEQUENCE(ROWS(...)).)", create: () => new AddIndexNode(), parity: false, keywords: "index row number sequence counter rownum power query" },
          { type: "decision-matrix", label: "Decision Matrix", description: "Score and rank a Frame of options: rows are options, number columns are criteria, an optional leading text column names them. Each option gets a weighted average Σ(score × weight) / Σ|weight| (a NEGATIVE weight penalises a lower-is-better criterion like cost or risk), then a competition rank. Set a weight per criterion in the labeled boxes on the node (default 1; or wire the Weights socket to drive them); pick Raw / ÷Max / Rank to compare criteria on incompatible scales. Output: Option · Score · Rank, best first — chart the podium with Get Column \"Score\" → Chart.", create: () => new DecisionMatrixNode(), parity: false, keywords: "decision matrix weighted score rank ranking criteria weight choose compare options podium dmbv multi-criteria mcda" },
          { type: "decision-sensitivity", label: "Sensitivity", description: "Stress-test a decision: score the same options (the Scores frame) under several weight Scenarios and see whether the winner holds. Scenarios is a Frame where each ROW is a scenario — its first text column names it, and a number column named after a criterion is that criterion's weight (missing → 1). Output is a Cube, one row per scenario: Scenario · Winner · Margin (top − runner-up; a thin margin flips easily) · Ranking (the full Option·Score·Rank table nested in the cell — drill in). Pairs with Decision Matrix.", create: () => new DecisionSensitivityNode(), parity: false, keywords: "decision sensitivity robustness scenario weight cube what-if stress test ranking stability mcda" },
          { type: "reconcile",   label: "Reconcile",   description: "Compare two versions of a Frame by a key column: classify each row Added / Removed / Changed / Unchanged, with a before/after/Δ per shared numeric column. Name a Price and a Quantity column (both present on both sides) to also decompose the total change into Price / Volume / Mix variance. Outputs the classified Frame plus a readable Summary line.", create: () => new ReconcileNode(), parity: false, keywords: "reconcile compare diff variance price volume mix pvm audit changed added removed data quality trust" },
        ],
      },
      {
        type: "category", label: "Cubes (nested tables)", description: "A Cube is a Frame whose cells can each hold anything — a scalar, a list, a nested Frame, or another Cube. The recursive container for relational/nested data. Read a cell back out with INDEX.",
        children: [
          { type: "nest-join", label: "Nest Join", description: "Nest two Frames into a Cube on a shared key column: each Parent row gains a cell holding the sub-Frame of matching Child rows. Unlike a flat Join (which fans out into repeated rows), this keeps one row per parent and tucks the children inside. Feed a previous Nest Join's Cube back in as the Parent to deepen the hierarchy one level (Customer → Order → LineItem).   (tidyr nest_join / Power Query merge-without-expand)", create: () => new NestJoinNode(), parity: false, keywords: "cube nest join relate nest_join relational merge group hierarchy multi-level deepen" },
          { type: "build-cube", label: "Build Cube", description: "Collect values into one Cube column — each input row is a cell that can be ANY value (a scalar, list, Frame, or nested Cube). The manual way to put non-table values into a cube. Add/remove rows; an unwired row takes a typed number.", create: () => new BuildCubeNode(), parity: false, keywords: "cube nest nested pack wrap list of frames container" },
          { type: "cube-columns", label: "Cube Columns", description: "Assemble a multi-column Cube from N column inputs — each input is one column: a list → its elements, a single-column cube (e.g. from Build Cube) → its cells, a frame/scalar → one cell. Name the columns with the Names list. (Build Cube wraps values into one column; this lines columns up side by side — e.g. Customers[id, name, orders].)", create: () => new CubeColumnsNode(), parity: false, keywords: "cube columns multi-column assemble combine build frame side by side hstack" },
          { type: "cube-rollup", label: "Cube Rollup", description: "Aggregate a column INSIDE each row's nested sub-table, flattening the Cube back to a Frame with the roll-up appended — \"cost of an assembly = SUM of its nested parts\". Same aggregate ops as Group By (sum/average/min/max/count…). The BOM / nested-costing shape: nest parts under an assembly with Nest Join, then roll up their extended cost here.", create: () => new CubeRollupNode(), parity: false, keywords: "cube rollup aggregate sum bom bill of materials costing nested cost roll up assembly subtotal" },
        ],
      },
    ],
  },

  // ── OTHER ────────────────────────────────────────────────────────────────────
  // Catch-all home: the Promo easter egg (below) plus any pack node that doesn't
  // target a specific category. The catalog builder prunes it only if it ends up
  // empty — it won't here, since Promo is a permanent core member.
  {
    type: "category", label: "Other", description: "Catch-all — odd one-offs and uncategorized pack nodes.",
    children: [
      { type: "image", label: "Image", description: "A free-floating picture — attach a local file or paste a web URL, set its height. Annotation only; carries no data. Web URLs persist in the save; local files are session-only (not yet embedded).", create: () => new ImageNode(), parity: false },
      { type: "promo", label: "✨ Promo", description: "A random Solenoid tagline — re-rolls on recalc (F9). Pure easter egg.", create: () => new PromoNode() },
    ],
  },
];
