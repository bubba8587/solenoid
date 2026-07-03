// Barrel re-export — mirrors rete-nodes.ts for node classes.
// Canvas.tsx imports everything from here; individual files stay unchanged.
// To add a new node: create the component file, add one line below.

// ─── Canvas infrastructure ────────────────────────────────────────────────────
export { SocketComponent } from "./SocketComponent";
export { ConnectionComponent } from "./ConnectionComponent";
export { ConduitComponent } from "./ConduitComponent";
export { SocketLegend } from "./SocketLegend";
export { ConfirmDialog } from "./ConfirmDialog";
export { NoticeToasts } from "./NoticeToasts";

// ─── Control ──────────────────────────────────────────────────────────────────
export { AngleDialComponent } from "./AngleDialNode";
export { SlicerComponent } from "./SlicerNode";

// ─── Input ────────────────────────────────────────────────────────────────────
export { NumberInputComponent } from "./NumberInputNode";
export { ConstantComponent } from "./ConstantNode";
export { BooleanInputComponent } from "./BooleanInputNode";
export { SliderInputComponent } from "./SliderInputNode";
export { ColorPickerComponent } from "./ColorPickerNode";
export { RandComponent } from "./RandNode";
export { RandBetweenComponent } from "./RandBetweenNode";
export { NaComponent } from "./NaNode";

// ─── Numbers — arithmetic / math functions ────────────────────────────────────
export { ArithmeticComponent } from "./ArithmeticNode";
export { MathFnComponent } from "./MathFnNode";
export { ClampComponent } from "./ClampNode";
export { MRoundComponent } from "./MRoundNode";
export { RoundNComponent } from "./RoundNNode";
export { GcdComponent } from "./GcdNode";
export { TwoInputMathComponent } from "./TwoInputMathNode";
export { CombinatoricsComponent } from "./CombinatoricsNode";
export { SeriesSumComponent } from "./SeriesSumNode";
export { MultinomialComponent } from "./MultinomialNode";
export { BitwiseComponent } from "./BitwiseNode";
export { BaseConvertComponent } from "./BaseConvertNode";
export { BesselComponent } from "./BesselNode";

// ─── Logic ────────────────────────────────────────────────────────────────────
export { BooleanComponent } from "./BooleanNode";
export { NotComponent } from "./NotNode";
export { IfComponent } from "./IfNode";
export { ComparisonComponent } from "./ComparisonNode";
export { IFErrorComponent } from "./IFErrorNode";
export { IsTestComponent } from "./IsTestNode";
export { ChooseComponent } from "./ChooseNode";
export { SwitchComponent } from "./SwitchNode";
export { IfsComponent } from "./IfsNode";

// ─── Lists — build ────────────────────────────────────────────────────────────
export { ListInputComponent } from "./ListInputNode";
export { RangeComponent } from "./RangeNode";
export { LinSpaceComponent } from "./LinSpaceNode";
export { VStackComponent } from "./VStackNode";
export { RepeatComponent } from "./RepeatNode";
export { GeometricComponent } from "./GeometricNode";
export { FibonacciComponent } from "./FibonacciNode";

// ─── Lists — shape ────────────────────────────────────────────────────────────
export { SortComponent } from "./SortNode";
export { ReverseComponent } from "./ReverseNode";
export { SliceComponent } from "./SliceNode";
export { TakeComponent } from "./TakeNode";
export { DropComponent } from "./DropNode";
export { UniqueComponent } from "./UniqueNode";
export { FilterComponent } from "./FilterNode";
export { FillComponent } from "./FillNode";
export { DiffComponent } from "./DiffNode";
export { CumulativeComponent } from "./CumulativeNode";
export { NormalizeComponent } from "./NormalizeNode";
export { ShuffleComponent } from "./ShuffleNode";
export { InterleaveComponent } from "./InterleaveNode";
export { NthElementComponent } from "./NthElementNode";
export { PadComponent } from "./PadNode";
export { RollingComponent } from "./RollingNode";

// ─── Lists — find / lookup ────────────────────────────────────────────────────
export { ListLengthComponent } from "./ListLengthNode";
export { ListIndexComponent } from "./ListIndexNode";
export { ArgMinMaxComponent } from "./ArgMinMaxNode";
export { ContainsComponent } from "./ContainsNode";
export { XLookupComponent } from "./XLookupNode";

// ─── Lists — aggregate / stats ────────────────────────────────────────────────
export { AggregateComponent } from "./AggregateNode";
export { SumProductComponent } from "./SumProductNode";
export { NthValueComponent } from "./NthValueNode";
export { PercentileComponent } from "./PercentileNode";
export { QuartileComponent } from "./QuartileNode";
export { PercentrankComponent } from "./PercentrankNode";
export { RankComponent } from "./RankNode";
export { CorrelComponent } from "./CorrelNode";
export { CovarianceComponent } from "./CovarianceNode";
export { FisherComponent } from "./FisherNode";
export { StandardizeComponent } from "./StandardizeNode";
export { RegressionComponent } from "./RegressionNode";
export { ForecastComponent } from "./ForecastNode";
export { ModeComponent } from "./ModeNode";
export { TrimMeanComponent } from "./TrimMeanNode";
export { FrequencyComponent } from "./FrequencyNode";
export { ConfidenceComponent } from "./ConfidenceNode";

// ─── Finance ──────────────────────────────────────────────────────────────────
export { InterestRateComponent } from "./InterestRateNode";
export { DepreciationComponent } from "./DepreciationNode";
export { TvmComponent } from "./TvmNode";
export { RateComponent } from "./RateNode";
export { IpmtPpmtComponent } from "./IpmtPpmtNode";
export { NpvComponent } from "./NpvNode";
export { IrrComponent } from "./IrrNode";
export { MirrComponent } from "./MirrNode";
export { CumPmtComponent } from "./CumPmtNode";
export { FvScheduleComponent } from "./FvScheduleNode";
export { IspmtComponent } from "./IspmtNode";
export { DollarComponent } from "./DollarNode";
export { VdbComponent } from "./VdbNode";
export { PdurationComponent } from "./PdurationNode";
export { RriComponent } from "./RriNode";
export { TBillComponent } from "./TBillNode";
export { SecurityDiscComponent } from "./SecurityDiscNode";
export { CouponComponent } from "./CouponNode";
export { AccrintComponent } from "./AccrintNode";
export { AccrintMComponent } from "./AccrintMNode";
export { PriceDiscComponent } from "./PriceDiscNode";
export { PriceMatComponent } from "./PriceMatNode";
export { DurationComponent } from "./DurationNode";
export { XnpvComponent } from "./XnpvNode";
export { BondPriceComponent } from "./BondPriceNode";
export { XirrComponent } from "./XirrNode";
export { OddCouponComponent } from "./OddCouponNode";

// ─── Currency formatting ──────────────────────────────────────────────────────
export { FormatDollarComponent } from "./TypeCoerceNodes";
export { IsEvenOddComponent } from "./IsEvenOddNode";

// ─── 2D Tables / Matrix ───────────────────────────────────────────────────────
export { TableInputComponent } from "./TableInputNode";
export {
  MatDetComponent, TableMultComponent, TableUnitComponent,
  TableTransposeComponent, HStackTableComponent,
  TableReshapeComponent, TableSelectComponent, TableInfoComponent,
} from "./MatrixNodes";
export { MapTableComponent, ByAxisComponent, MakeArrayComponent, ReduceLambdaComponent } from "./TableLambdaNodes";
export { LambdaComponent } from "./LambdaNode";

// ─── Frames (named-column data tables) ─────────────────────────────────────────
export {
  FrameInputComponent, BuildFrameComponent, SplitFrameComponent, GetColumnComponent, AddColumnComponent, GetRowComponent,
  DistinctComponent, HeadComponent, SortFrameComponent, FilterFrameComponent, JoinComponent, FrameLookupComponent,
  SelectColumnsComponent, DropColumnsComponent, GroupByFrameComponent, PivotComponent, UnpivotComponent,
  NestComponent, UnnestComponent, AppendComponent, RenameComponent,
  SplitColumnComponent, AddIndexComponent, DecisionMatrixComponent, DecisionSensitivityComponent,
  ReconcileComponent,
} from "./FrameNodes";

// ─── Trust & data quality ───────────────────────────────────────────────────────
export { ExpectComponent } from "./ExpectNode";
export { TornadoComponent } from "./TornadoNode";

// ─── Cubes (recursive nested tables) ───────────────────────────────────────────
export { BuildCubeComponent, NestJoinComponent, CubeColumnsComponent, CubeRollupComponent } from "./CubeNodes";

// ─── External-data connections (Web Source, CSV folder, Parquet folder) ─────────
export { WebSourceComponent, CsvConnectionComponent, ParquetConnectionComponent, ImportHtmlComponent, ImportXmlComponent } from "./ConnectionNodes";

// ─── File sinks (Write CSV, Write JSON) ──────────────────────────────────────────
export { WriteCsvComponent, WriteJsonComponent } from "./WriteNodes";

// ─── Cable Switch (control multiplexer) ─────────────────────────────────────────
export { CableSwitchComponent } from "./CableSwitchNode";

// ─── Note (canvas annotation) ───────────────────────────────────────────────────
export { NoteComponent } from "./NoteNode";

// ─── Report (standalone markdown document — canvas anchor card) ────────────────
export { ReportComponent } from "./ReportNode";

// ─── Session History (live undo/redo digest readout) ───────────────────────────
export { SessionHistoryComponent } from "./SessionHistoryNode";

// ─── Presentation (step list + camera-only presenter mode) ─────────────────────
export { PresentationComponent } from "./PresentationNode";

// ─── Image (canvas annotation) ──────────────────────────────────────────────────
export { ImageComponent } from "./ImageNode";

// ─── Group (framing container) ────────────────────────────────────────────────
export { GroupComponent } from "./GroupNode";

// ─── Composite (computing subgraph container) ──────────────────────────────────
export { CompositeComponent } from "./CompositeNode";

// ─── Complex numbers ──────────────────────────────────────────────────────────
export { ComplexFromComponent } from "./ComplexFromNode";
export { ComplexUnpackComponent } from "./ComplexUnpackNode";
export { ComplexUnaryComponent } from "./ComplexUnaryNode";
export { ComplexBinaryComponent } from "./ComplexBinaryNode";
export { ComplexPowerComponent } from "./ComplexPowerNode";

// ─── Distributions — normal / t / chi-squared ─────────────────────────────────
export { NormDistComponent } from "./NormDistNode";
export { NormInvComponent } from "./NormInvNode";
export { NormSDistComponent } from "./NormSDistNode";
export { NormSInvComponent } from "./NormSInvNode";
export { TDistComponent } from "./TDistNode";
export { TInvComponent } from "./TInvNode";
export { ChisqDistComponent } from "./ChisqDistNode";
export { ChisqInvComponent } from "./ChisqInvNode";

// ─── Distributions — continuous ───────────────────────────────────────────────
export { FDistComponent } from "./FDistNode";
export { FInvComponent } from "./FInvNode";
export { BetaDistComponent } from "./BetaDistNode";
export { BetaInvComponent } from "./BetaInvNode";
export { GammaDistComponent } from "./GammaDistNode";
export { GammaInvComponent } from "./GammaInvNode";
export { LognormDistComponent } from "./LognormDistNode";
export { LognormInvComponent } from "./LognormInvNode";
export { WeibullDistComponent } from "./WeibullDistNode";
export { ExponDistComponent } from "./ExponDistNode";

// ─── Distributions — discrete ─────────────────────────────────────────────────
export { BinomDistComponent } from "./BinomDistNode";
export { BinomInvComponent } from "./BinomInvNode";
export { PoissonDistComponent } from "./PoissonDistNode";
export { HypgeomDistComponent } from "./HypgeomDistNode";
export { NegbinomDistComponent } from "./NegbinomDistNode";

// ─── Distributions — discrete (extra) ────────────────────────────────────────
export { BinomDistRangeComponent } from "./BinomDistRangeNode";

// ─── Statistical tests ────────────────────────────────────────────────────────
export { ZTestComponent } from "./ZTestNode";
export { TTestComponent } from "./TTestNode";
export { FTestComponent } from "./FTestNode";
export { ChisqTestComponent } from "./ChisqTestNode";

// ─── Regression (extended) ────────────────────────────────────────────────────
export { TrendComponent } from "./TrendNode";
export { LinestComponent } from "./LinestNode";
export { LogestComponent } from "./LogestNode";

// ─── Text ─────────────────────────────────────────────────────────────────────
export { TextInputComponent } from "./TextInputNode";
export { TextTransformComponent } from "./TextTransformNode";
export { TextLenComponent } from "./TextLenNode";
export { ConcatComponent } from "./ConcatNode";
export { TextSliceComponent } from "./TextSliceNode";
export { TextFindComponent } from "./TextFindNode";
export { SubstituteComponent } from "./SubstituteNode";
export { TextReplaceComponent } from "./TextReplaceNode";
export { CastComponent } from "./CastNode";
export { ReptComponent } from "./ReptNode";
export { ExactComponent } from "./ExactNode";
export { CharCodeComponent } from "./CharCodeNode";
export { TextJoinComponent } from "./TextJoinNode";
export { TextSplitComponent } from "./TextSplitNode";
export { TextAfterBeforeComponent } from "./TextAfterBeforeNode";
export { NumberValueComponent } from "./NumberValueNode";
export { TextFilterComponent } from "./TextFilterNode";
export { RomanArabicComponent } from "./RomanArabicNode";
export { FixedComponent } from "./FixedNode";
export { TextMapComponent } from "./TextMapNode";
export { UrlEncodeComponent } from "./UrlEncodeNode";

// ─── Date & Time ──────────────────────────────────────────────────────────────
export {
  TodayNowComponent, DateConstructComponent, TimeConstructComponent,
  DateValueComponent, TimeValueComponent, DatePartComponent,
  WeekInfoComponent, DateDiffComponent, DateAddComponent,
  WorkdayComponent, NetworkdaysComponent, DateIfComponent,
} from "./DateNodes";

// ─── Stats (extended) ─────────────────────────────────────────────────────────
export { ModMultComponent } from "./ModMultNode";
export { ProbComponent } from "./ProbNode";
export { WeightedComponent } from "./WeightedNode";

// ─── List extras ──────────────────────────────────────────────────────────────
export { RandArrayComponent } from "./RandArrayNode";
export { SequenceComponent } from "./SequenceNode";
export { SortByComponent } from "./SortByNode";
export { XMatchComponent } from "./XMatchNode";

// ─── Convert / output ─────────────────────────────────────────────────────────
export { ConvertComponent } from "./ConvertNode";
export { DisplayComponent } from "./DisplayNode";
export { AlertComponent } from "./AlertNode";
export { SparklineComponent } from "./SparklineNode";
export { ChartComponent } from "./ChartNode";
export { GaugeComponent } from "./GaugeNode";
export { HeatmapCellComponent } from "./HeatmapCellNode";
export { ChartBuilderComponent } from "./ChartBuilderNode";
export { DatePickerComponent } from "./DatePickerNode";
export { XYPadComponent } from "./XYPadNode";

// ─── Format Controller ────────────────────────────────────────────────────────
export { FormatControllerComponent } from "./FormatControllerNode";

// ─── Expression ───────────────────────────────────────────────────────────────
export { ExpressionComponent } from "./ExpressionNode";

// ─── Regex / GroupBy ──────────────────────────────────────────────────────────
export { RegexComponent } from "./RegexNode";
export { GroupByComponent } from "./GroupByNode";
export { SocketContextMenu } from "./SocketContextMenu";
export type { SocketContextTarget } from "./SocketContextMenu";
export { CableContextMenu } from "./CableContextMenu";
export type { CableContextTarget } from "./CableContextMenu";
export { StandoffLinkMenu } from "./StandoffLinkMenu";
export type { StandoffLinkTarget } from "./StandoffLinkMenu";
export { NodeContextMenu } from "./NodeContextMenu";
export type { NodeContextTarget } from "./NodeContextMenu";
export { StandoffLayer } from "./StandoffLayer";

// ─── Packs (example built-in pack node) ───────────────────────────────────────
export { HypotenuseComponent } from "./HypotenuseNode";

// ─── Missing-type placeholder (load-time only, not in the Add menu) ───────────
export { PlaceholderComponent } from "./PlaceholderNode";

// ─── Other (easter egg) ───────────────────────────────────────────────────────
export { PromoComponent } from "./PromoNode";
