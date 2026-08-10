// Barrel re-export — mirrors rete-nodes.ts for node classes.

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
export { ColorBlendComponent } from "./ColorBlendNode";
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
export { SeriesComponent } from "./SeriesNode";
export { VStackComponent } from "./VStackNode";
export { RepeatComponent } from "./RepeatNode";
export { GeometricComponent } from "./GeometricNode";
export { FibonacciComponent } from "./FibonacciNode";

// ─── Lists — shape ────────────────────────────────────────────────────────────
export { SortComponent } from "./SortNode";
export { ReverseComponent } from "./ReverseNode";
export { SliceComponent } from "./SliceNode";
export { ListTakeDropComponent } from "./ListTakeDropNode";
export { UniqueComponent } from "./UniqueNode";
export { SetOpComponent } from "./SetOpNode";
export { SetRelationComponent } from "./SetRelationNode";
export { FilterComponent } from "./FilterNode";
export { SumIfsComponent } from "./SumIfsNode";
export { FillComponent } from "./FillNode";
export { DiffComponent } from "./DiffNode";
export { RunningComponent } from "./RunningNode";
export { NormalizeComponent } from "./NormalizeNode";
export { ShuffleComponent } from "./ShuffleNode";
export { InterleaveComponent } from "./InterleaveNode";
export { NthElementComponent } from "./NthElementNode";
export { PadComponent } from "./PadNode";

// ─── Lists — find / lookup ────────────────────────────────────────────────────
export { ListLengthComponent } from "./ListLengthNode";
export { ListIndexComponent } from "./ListIndexNode";
export { ArgMinMaxComponent } from "./ArgMinMaxNode";
export { ContainsComponent } from "./ContainsNode";

// ─── Lists — aggregate / stats ────────────────────────────────────────────────
export { AggregateComponent } from "./AggregateNode";
export { SumProductComponent } from "./SumProductNode";
export { RankPercentileComponent } from "./RankPercentileNode";
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
export { DepreciationComponent } from "./DepreciationNode";
export { TvmComponent } from "./TvmNode";
export { IpmtPpmtComponent } from "./IpmtPpmtNode";
export { NpvComponent } from "./NpvNode";
export { IrrComponent } from "./IrrNode";
export { MirrComponent } from "./MirrNode";
export { CumPmtComponent } from "./CumPmtNode";
export { FvScheduleComponent } from "./FvScheduleNode";
export { IspmtComponent } from "./IspmtNode";
export { DollarComponent } from "./DollarNode";
export { TBillComponent } from "./TBillNode";
export { SecurityDiscComponent } from "./SecurityDiscNode";
export { CouponComponent } from "./CouponNode";
export { AccrintComponent } from "./AccrintNode";
export { AccrintMComponent } from "./AccrintMNode";
export { PriceDiscComponent } from "./PriceDiscNode";
export { PriceMatComponent } from "./PriceMatNode";
export { DurationComponent } from "./DurationNode";
export { BondPriceComponent } from "./BondPriceNode";
export { OddCouponComponent } from "./OddCouponNode";

// ─── Currency formatting ──────────────────────────────────────────────────────
export { FormatDollarComponent } from "./TypeCoerceNodes";
export { IsEvenOddComponent } from "./IsEvenOddNode";

// ─── 2D Tables / Matrix ───────────────────────────────────────────────────────
export { TableInputComponent } from "./TableInputNode";
export {
  MatDetComponent, TableMultComponent, TableUnitComponent,
  TableTransposeComponent, HStackTableComponent,
  TableReshapeComponent, TableSelectComponent, TableTakeDropComponent, ExpandTableComponent, TableInfoComponent,
} from "./MatrixNodes";
export { MapTableComponent, ByAxisComponent, MakeArrayComponent, ReduceLambdaComponent, ScanLambdaComponent } from "./TableLambdaNodes";
export { LambdaComponent } from "./LambdaNode";

// ─── Frames (named-column data tables) ─────────────────────────────────────────
export {
  FrameInputComponent, BuildFrameComponent, SplitFrameComponent, GetColumnComponent, AddColumnComponent, ComputedColumnComponent, GetRowComponent,
  DistinctComponent, HeadComponent, SortFrameComponent, FilterFrameComponent, JoinComponent, XLookupComponent,
  SelectColumnsComponent, DropColumnsComponent, GroupByFrameComponent, PivotComponent, UnpivotComponent,
  NestComponent, UnnestComponent, AppendComponent, RenameComponent,
  SplitColumnComponent, AddIndexComponent, DecisionMatrixComponent, DecisionSensitivityComponent,
  ReconcileComponent,
  FillBlanksComponent, ReplaceValuesComponent, MergeColumnsComponent, HeadersComponent, DropBlankRowsComponent,
} from "./FrameNodes";

// ─── Trust & data quality ───────────────────────────────────────────────────────
export { ExpectComponent } from "./ExpectNode";
export { TornadoComponent } from "./TornadoNode";

// ─── Cubes (recursive nested tables) ───────────────────────────────────────────
export { BuildCubeComponent, NestJoinComponent, CubeColumnsComponent, CubeRollupComponent } from "./CubeNodes";

// ─── External-data connections (Web Source, CSV folder, Parquet folder) ─────────
export { WebSourceComponent, CsvConnectionComponent, ParquetConnectionComponent, ImportHtmlComponent, ImportXmlComponent, DataFeedComponent } from "./ConnectionNodes";

// ─── File sinks (Write CSV, Write JSON, Write to Obsidian) ────────────────────────
export { WriteCsvComponent, WriteJsonComponent, WriteObsidianComponent } from "./WriteNodes";

// ─── Import from Obsidian Vault (read a .md into a read-only Note) ────────────────
export { ImportObsidianComponent } from "./ImportObsidianNode";

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
export { SvgPickerComponent } from "./SvgPickerNode";

// ─── Group (framing container) ────────────────────────────────────────────────
export { GroupComponent } from "./GroupNode";

// ─── Composite (computing subgraph container) ──────────────────────────────────
export { CompositeComponent, CompositeInputMarkerComponent, CompositeOutputMarkerComponent } from "./CompositeNode";
// CompositeEditorOverlay is deliberately NOT re-exported here: it imports
// nodeRegistry, which imports this barrel — that closes a module-init cycle (TDZ).

// ─── Complex numbers ──────────────────────────────────────────────────────────
export { ComplexFromComponent } from "./ComplexFromNode";
export { ComplexUnpackComponent } from "./ComplexUnpackNode";
export { ComplexUnaryComponent } from "./ComplexUnaryNode";
export { ComplexBinaryComponent } from "./ComplexBinaryNode";
export { ComplexPowerComponent } from "./ComplexPowerNode";

// ─── Distributions — normal / t / chi-squared ─────────────────────────────────
export { DistributionComponent } from "./DistributionNode";

// ─── Distributions — continuous ───────────────────────────────────────────────

// ─── Distributions — discrete ─────────────────────────────────────────────────

// ─── Distributions — discrete (extra) ────────────────────────────────────────
export { BinomDistRangeComponent } from "./BinomDistRangeNode";

// ─── Statistical tests ────────────────────────────────────────────────────────
export { HypothesisTestComponent } from "./HypothesisTestNode";

// ─── Regression (extended) ────────────────────────────────────────────────────
export { TrendComponent } from "./TrendNode";
export { InterpolateComponent } from "./InterpolateNode";
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
export { UrlEncodeComponent } from "./UrlEncodeNode";

// ─── Date & Time ──────────────────────────────────────────────────────────────
export {
  TodayNowComponent, DateConstructComponent, TimeConstructComponent,
  DateTimeValueComponent, DatePartComponent,
  WeekInfoComponent, DateDiffComponent, DateAddComponent,
  WorkdaysComponent,
} from "./DateNodes";

// ─── Stats (extended) ─────────────────────────────────────────────────────────
export { ProbComponent } from "./ProbNode";
export { WeightedComponent } from "./WeightedNode";

// ─── List extras ──────────────────────────────────────────────────────────────
export { RandArrayComponent } from "./RandArrayNode";
export { SortByComponent } from "./SortByNode";
export { XMatchComponent } from "./XMatchNode";

// ─── Convert / output ─────────────────────────────────────────────────────────
export { ConvertComponent } from "./ConvertNode";
export { DisplayComponent } from "./DisplayNode";
export { AlertComponent } from "./AlertNode";
export { SparklineComponent } from "./SparklineNode";
export { ChartComponent } from "./ChartNode";
export { HistogramComponent } from "./HistogramNode";
export { KpiComponent } from "./KpiNode";
export { BulletComponent } from "./BulletNode";
export { TreemapComponent } from "./TreemapNode";
export { SankeyComponent } from "./SankeyNode";
export { SurfaceComponent } from "./SurfaceNode";
export {
  WaterfallComponent, CandlestickComponent, BoxplotComponent,
  CalendarHeatmapComponent, WaffleComponent, QuiverComponent,
} from "./FigureNodes";
export { SevenSegComponent } from "./SevenSegNode";
export { PointPlotterComponent } from "./PointPlotterNode";
export { CurveComponent } from "./CurveNode";
export { GridPainterComponent } from "./GridPainterNode";
export { MermaidComponent } from "./MermaidNode";
export { GaugeComponent } from "./GaugeNode";
export { HeatmapCellComponent } from "./HeatmapCellNode";
export { ChartBuilderComponent } from "./ChartBuilderNode";
export { DatePickerComponent } from "./DatePickerNode";
export { DateRangeComponent } from "./DateRangeNode";
export { XYPadComponent } from "./XYPadNode";

// ─── Format Controller ────────────────────────────────────────────────────────
export { FormatControllerComponent } from "./FormatControllerNode";

// ─── Expression ───────────────────────────────────────────────────────────────
export { ExpressionComponent } from "./ExpressionNode";

// ─── Equation (bidirectional solve) ─────────────────────────────────────────────
export { EquationComponent } from "./EquationNode";

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

// ─── Electricity & Circuits pack ───────────────────────────────────────────────
export { ParallelCombineComponent, ESeriesComponent, AwgComponent, ResistorCodeComponent } from "./ElectricalNodes";

// ─── Electromagnetism pack ───────────────────────────────────────────────────────
export { PhysicsConstantComponent } from "./PhysicsConstantNode";

// ─── Fluid Mechanics pack ────────────────────────────────────────────────────────
export { ColebrookComponent } from "./FluidsNodes";

// ─── Thermodynamics & Air pack ───────────────────────────────────────────────────
export { IsaAtmosphereComponent, AntoineComponent } from "./ThermoNodes";

// ─── Set & Relational pack ───────────────────────────────────────────────────────
export { IsInComponent, TallyComponent } from "./SetPackNodes";

// ─── Timesavers pack custom nodes ────────────────────────────────────────────────
export { ReverseTextComponent, SpellNumberComponent } from "./TimesaverNodes";

// ─── Earth & Sky pack ────────────────────────────────────────────────────────────
export { SolarPositionComponent, SunriseSunsetComponent, MoonPhaseComponent } from "./AstroNodes";

// ─── Chemistry Basics pack ───────────────────────────────────────────────────────
export { ElementComponent, MolarMassComponent } from "./ChemistryNodes";

// ─── Lists → tables fast path ─────────────────────────────────────────────────
export { ConcatListsComponent } from "./ConcatListsNode";
export { FrameFromListsComponent } from "./FrameFromListsNode";
export { QuadraticRootsComponent } from "./QuadraticRootsNode";

// ─── Missing-type placeholder (load-time only, not in the Add menu) ───────────
export { PlaceholderComponent } from "./PlaceholderNode";

// ─── Other (easter egg) ───────────────────────────────────────────────────────
export { PromoComponent } from "./PromoNode";
