// [[C42]], [[C111]] unfiledCardTakesOutputColor
import { ClassicPreset } from "rete";
import { type NodeKind, NODE_KIND_ACCENTS } from "./shared";
import { SolenoidSocket, SOCKET_COLORS } from "../sockets";
import { themeAccent, socketVarHex } from "../palette";
import { NumberInputNode, ConstantNode, BooleanInputNode, SliderInputNode, ColorPickerNode, ColorBlendNode, SaveTimesNode } from "./input";
import { PhysicsConstantNode } from "./physicsConstants";
import { ElementNode } from "./chemistry";
import { ConvertNode } from "./convert";
import { CastNode } from "./cast";
import { FormatControllerNode } from "./formatController";
import { ExpressionNode } from "./expression";
import { ScriptNode } from "./script";
import { EquationNode } from "./equation";
import { GroupListsNode } from "./list";
import { RegexNode } from "./text";
import { ComparisonNode, BooleanOpNode, NotNode, BetweenNode, IsCloseNode, IfNode, IFErrorNode, IsTestNode, IsEvenOddNode, NaNode, ChooseNode, SwitchNode, IfsNode } from "./logic";
import { ComplexFromNode, ComplexUnpackNode, ComplexUnaryNode, ComplexBinaryNode, ComplexPowerNode, QuadraticRootsNode, PolyRootsNode } from "./complex";
import {
  ListInputNode, SeriesNode, AggregateNode,
  ListLengthNode, ListIndexNode, SortNode, FilterNode, SumIfsNode,
  ReverseNode, SliceNode,
  UniqueNode, SetsNode, IsInNode, TallyNode,
  ConcatListsNode, RunningNode, DiffNode,
  ArgMinMaxNode, ContainsNode,
  NormalizeNode, BinNode, OutliersNode, SmoothNode, FindPeaksNode, SpectrumNode, ShiftNode, CombinationsNode, EwmaNode, ConvolveNode, CrossNode, PolyfitNode, TrapzNode, RleNode,
  ShuffleNode, NthElementNode, InterleaveNode,
  PadNode,
  FillNode,
} from "./list";
import {
  RankPercentileNode, CorrelNode,
  StandardizeNode, CovarianceNode, FisherNode,
  RegressionNode, ForecastNode, EtsForecastNode, DecomposeNode, OdeIntegrateNode, FitDistributionNode, ModeNode, TrimMeanNode, FrequencyNode, ConfidenceNode,
} from "./stats";
import { BitwiseNode, DepreciationNode, TvmNode, PaymentBreakdownNode, NPVNode, IRRNode, MirrNode, AmortizationNode, ReturnsNode } from "./finance";
import { DisplayNode, AlertNode, RandBetweenNode } from "./display";
import { DistributionsNode } from "./distribution";
import { ConduitNode } from "./conduit";
import { FrameFromListsNode } from "./frame";
import { ScheduleNode } from "./schedule";
import { FrameInputNode, BuildFrameNode, SplitFrameNode, GetColumnNode, AddColumnNode, ComputedColumnNode, GetRowNode, DistinctNode, HeadNode, SortFrameNode, FilterFrameNode, JoinNode, XLookupNode, ColumnsNode, GroupByFrameNode, PivotNode, UnpivotNode, NestNode, UnnestNode, AppendNode, BindColumnsNode, RenameNode, SplitColumnNode, AddIndexNode, DecisionMatrixNode, DecisionSensitivityNode, AllocatorNode, SettleNode, PayoffPlannerNode, FillBlanksNode, ReplaceValuesNode, MergeColumnsNode, HeadersNode, DropBlankRowsNode, DescribeNode, CorrMatrixNode, KMeansNode, PcaNode, LogisticNode, WindowNode } from "./frame";
import { CubeInputNode, BuildCubeNode, NestJoinNode, CubeColumnsNode, CubeRollupNode } from "./cube";
import { WebSourceNode, LocalFileNode, ImportHtmlNode, ImportXmlNode } from "./connection";
import { DataFeedNode } from "./dataFeed";
import { TaskNotesNode, WriteTasksNode } from "./taskNotes";
import { WriteFileNode } from "./sink";
import { WriteObsidianNode } from "./obsidian";
import { ExpectNode } from "./quality";
import { TornadoNode } from "./tornado";
import { ReconcileNode } from "./frame";
import { SlicerNode, CableSwitchNode, DateInputNode, XYPadNode, PointPlotterNode, CurveNode, GridPainterNode } from "./control";
import { SparklineNode, ChartNode, MergePlotsNode, MermaidNode, GaugeNode, HeatmapCellNode, ChartBuilderNode, ProportionNode, SankeyNode, HistogramNode, SurfaceNode, WaterfallNode, CandlestickNode, BoxplotNode, CalendarHeatmapNode, QuiverNode, RecordNode, KpiNode } from "./visual";
import { GanttNode } from "./gantt";
import { NoteNode, ImageNode, FileLinkNode, SvgPickerNode } from "./annotation";
import { ReportNode } from "./report";
import { QrCodeNode } from "./qr";
import { CompositeNode, CompositeInputNode, CompositeOutputNode } from "./composite";
import {
  TableInputNode, MatDetNode, MatSolveNode, MatEigenNode, TableMultNode, TableUnitNode, TableDiagNode, TableOuterNode, TableTransposeNode,
  StackNode, TableReshapeNode, TableSelectNode, TakeDropNode, ExpandNode, SetCellNode, TableInfoNode,
} from "./matrix";
import { MapTableNode, ByAxisNode, MakeArrayNode, ReduceLambdaNode, ScanLambdaNode } from "./tableLambda";
import { LambdaNode } from "./lambda";
import {
  CombinatoricsNode, TwoInputMathNode, SumProductNode,
  SeriesSumNode, MultinomialNode,
} from "./scalar";
import {
  TextInputNode, TextTransformNode, TextLenNode, ConcatNode, TextSliceNode,
  TextFindNode, SubstituteNode, TextReplaceNode,
  ReptNode, PadTextNode, TruncateTextNode, WrapTextNode, HashNode, UuidNode, TemplateNode, ExactNode, CharCodeNode, TextJoinNode, TextSplitNode, TextAfterBeforeNode,
  ReverseTextNode, SpellNumberNode, TextSimilarityNode, FuzzyMatchNode,
} from "./text";
import {
  TodayNowNode, DateConstructNode, TimeConstructNode,
  DateTimeValueNode, DatePartNode, WeekInfoNode,
  DateDiffNode, DateAddNode, WorkdaysNode,
  TimeZoneConvertNode, WorldClockNode,
} from "./date";

// Runs at call time, so forward references are safe; never relies on constructor.name, which minification breaks.

export function nodeKindOf(node: ClassicPreset.Node): NodeKind {
  return explicitKindOf(node) ?? "math";
}

export function explicitKindOf(node: ClassicPreset.Node): NodeKind | null {
  if (node instanceof CompositeInputNode || node instanceof CompositeOutputNode) return "boundary";
  if (node instanceof ReportNode) return "document";
  if (node instanceof NumberInputNode || node instanceof ConstantNode || node instanceof PhysicsConstantNode || node instanceof ElementNode || node instanceof SliderInputNode || node instanceof RandBetweenNode || node instanceof WebSourceNode || node instanceof LocalFileNode || node instanceof ImportHtmlNode || node instanceof ImportXmlNode || node instanceof DataFeedNode || node instanceof TaskNotesNode || node instanceof XYPadNode || node instanceof ColorPickerNode || node instanceof SvgPickerNode || node instanceof PointPlotterNode || node instanceof CurveNode || node instanceof GridPainterNode) return "input";
  if (node instanceof SparklineNode || node instanceof ChartNode || node instanceof MergePlotsNode || node instanceof GaugeNode || node instanceof HeatmapCellNode || node instanceof TornadoNode || node instanceof SurfaceNode) return "chart";
  if (node instanceof WaterfallNode || node instanceof CandlestickNode || node instanceof BoxplotNode || node instanceof CalendarHeatmapNode || node instanceof ProportionNode || node instanceof QuiverNode || node instanceof HistogramNode || node instanceof SankeyNode) return "chart";
  if (node instanceof QrCodeNode || node instanceof KpiNode || node instanceof GanttNode || node instanceof ChartBuilderNode || node instanceof MermaidNode || node instanceof RecordNode) return "chart";
  if (node instanceof ConvertNode || node instanceof CastNode) return "convert";
  if (
    node instanceof ComplexFromNode || node instanceof ComplexUnpackNode ||
    node instanceof ComplexUnaryNode || node instanceof ComplexBinaryNode ||
    node instanceof ComplexPowerNode || node instanceof QuadraticRootsNode || node instanceof PolyRootsNode
  ) return "complex";
  // Nodes that emit a logical read as logic, matching their output color.
  if (
    node instanceof ComparisonNode || node instanceof BooleanOpNode ||
    node instanceof NotNode || node instanceof BetweenNode || node instanceof IsCloseNode ||
    node instanceof BooleanInputNode || node instanceof IsTestNode ||
    node instanceof IsEvenOddNode ||
    node instanceof IsInNode
  ) return "logic";
  if (
    node instanceof ListInputNode || node instanceof SeriesNode || node instanceof AggregateNode ||
    node instanceof ListLengthNode || node instanceof ListIndexNode || node instanceof SortNode ||
    node instanceof FilterNode ||
    node instanceof ReverseNode || node instanceof SliceNode ||
    node instanceof UniqueNode ||
    node instanceof SetsNode || node instanceof TallyNode ||
    node instanceof ConcatListsNode || node instanceof RunningNode || node instanceof DiffNode ||
    node instanceof ArgMinMaxNode || node instanceof ContainsNode ||
    node instanceof NormalizeNode ||
    node instanceof BinNode || node instanceof OutliersNode || node instanceof SmoothNode || node instanceof FindPeaksNode || node instanceof SpectrumNode || node instanceof ShiftNode || node instanceof CombinationsNode ||
    node instanceof EwmaNode || node instanceof ConvolveNode || node instanceof CrossNode ||
    node instanceof PolyfitNode || node instanceof TrapzNode || node instanceof RleNode ||
    node instanceof ShuffleNode || node instanceof NthElementNode || node instanceof InterleaveNode ||
    node instanceof PadNode ||
    node instanceof FillNode
  ) return "list";
  if (
    node instanceof RankPercentileNode || node instanceof CorrelNode ||
    node instanceof CombinatoricsNode || node instanceof TwoInputMathNode || node instanceof SumProductNode ||
    node instanceof StandardizeNode || node instanceof CovarianceNode || node instanceof FisherNode ||
    node instanceof BitwiseNode || node instanceof DepreciationNode ||
    node instanceof RegressionNode || node instanceof ForecastNode || node instanceof EtsForecastNode || node instanceof DecomposeNode || node instanceof OdeIntegrateNode || node instanceof FitDistributionNode || node instanceof ModeNode ||
    node instanceof TrimMeanNode || node instanceof FrequencyNode || node instanceof ConfidenceNode ||
    node instanceof SeriesSumNode || node instanceof MultinomialNode
  ) return "math";
  if (
    node instanceof TvmNode || node instanceof PaymentBreakdownNode ||
    node instanceof NPVNode || node instanceof IRRNode || node instanceof MirrNode ||
    node instanceof AmortizationNode || node instanceof ReturnsNode
  ) return "math";
  if (
    node instanceof DistributionsNode
  ) return "math";
  if (
    node instanceof IFErrorNode || node instanceof ConduitNode ||
    node instanceof ChooseNode || node instanceof NaNode ||
    node instanceof AlertNode || node instanceof IfNode ||
    node instanceof SwitchNode || node instanceof IfsNode ||
    node instanceof CableSwitchNode || node instanceof NoteNode ||
    node instanceof ImageNode || node instanceof FileLinkNode ||
    node instanceof ExpectNode ||
    node instanceof WriteFileNode ||
    node instanceof WriteTasksNode ||
    node instanceof WriteObsidianNode ||
    node instanceof CompositeNode
  ) return "util";
  if (node instanceof DisplayNode) return "util";
  if (
    node instanceof TextInputNode || node instanceof TextTransformNode ||
    node instanceof TextLenNode || node instanceof ConcatNode ||
    node instanceof TextSliceNode || node instanceof TextFindNode ||
    node instanceof SubstituteNode || node instanceof TextReplaceNode ||
    node instanceof ReptNode || node instanceof PadTextNode || node instanceof TruncateTextNode || node instanceof WrapTextNode || node instanceof HashNode || node instanceof UuidNode || node instanceof TemplateNode || node instanceof ExactNode || node instanceof TextSimilarityNode || node instanceof FuzzyMatchNode ||
    node instanceof CharCodeNode || node instanceof TextJoinNode ||
    node instanceof TextSplitNode || node instanceof TextAfterBeforeNode ||
    node instanceof ReverseTextNode || node instanceof SpellNumberNode ||
    node instanceof ColorBlendNode
  ) return "string";
  if (
    node instanceof TodayNowNode || node instanceof DateConstructNode ||
    node instanceof TimeConstructNode || node instanceof DateTimeValueNode ||
    node instanceof DatePartNode ||
    node instanceof WeekInfoNode || node instanceof DateDiffNode ||
    node instanceof DateAddNode || node instanceof WorkdaysNode ||
    node instanceof DateInputNode || node instanceof SaveTimesNode ||
    node instanceof TimeZoneConvertNode || node instanceof WorldClockNode
  ) return "date";
  if (
    node instanceof TableInputNode || node instanceof MatDetNode || node instanceof MatSolveNode || node instanceof MatEigenNode ||
    node instanceof TableMultNode || node instanceof TableUnitNode || node instanceof TableDiagNode ||
    node instanceof TableOuterNode ||
    node instanceof TableTransposeNode || node instanceof StackNode ||
    node instanceof TableReshapeNode || node instanceof TableSelectNode ||
    node instanceof TakeDropNode || node instanceof ExpandNode || node instanceof SetCellNode ||
    node instanceof TableInfoNode || node instanceof MapTableNode ||
    node instanceof ByAxisNode || node instanceof MakeArrayNode ||
    node instanceof ReduceLambdaNode || node instanceof ScanLambdaNode
  ) return "table";
  if (
    node instanceof FrameInputNode || node instanceof CubeInputNode ||
    node instanceof BuildFrameNode || node instanceof FrameFromListsNode || node instanceof SplitFrameNode ||
    node instanceof GetColumnNode || node instanceof AddColumnNode ||
    node instanceof ComputedColumnNode ||
    node instanceof GetRowNode ||
    node instanceof DistinctNode ||
    node instanceof HeadNode ||
    node instanceof SortFrameNode ||
    node instanceof FilterFrameNode ||
    node instanceof SumIfsNode ||
    node instanceof JoinNode ||
    node instanceof XLookupNode ||
    node instanceof ColumnsNode ||
    node instanceof GroupByFrameNode ||
    node instanceof PivotNode ||
    node instanceof UnpivotNode ||
    node instanceof NestNode ||
    node instanceof UnnestNode ||
    node instanceof AppendNode || node instanceof BindColumnsNode ||
    node instanceof RenameNode ||
    node instanceof SplitColumnNode ||
    node instanceof AddIndexNode ||
    node instanceof FillBlanksNode ||
    node instanceof ReplaceValuesNode ||
    node instanceof MergeColumnsNode ||
    node instanceof HeadersNode ||
    node instanceof DropBlankRowsNode ||
    node instanceof DescribeNode || node instanceof CorrMatrixNode || node instanceof KMeansNode || node instanceof PcaNode || node instanceof LogisticNode || node instanceof WindowNode ||
    node instanceof DecisionMatrixNode ||
    node instanceof DecisionSensitivityNode ||
    node instanceof AllocatorNode ||
    node instanceof SettleNode ||
    node instanceof PayoffPlannerNode ||
    node instanceof ScheduleNode ||
    node instanceof ReconcileNode ||
    node instanceof BuildCubeNode ||
    node instanceof NestJoinNode ||
    node instanceof CubeColumnsNode ||
    node instanceof CubeRollupNode ||
    node instanceof SlicerNode
  ) return "frame";
  if (node instanceof FormatControllerNode) return "format";
  if (node instanceof LambdaNode) return "lambda";
  if (node instanceof ExpressionNode) return "math";
  if (node instanceof EquationNode) return "math";
  if (node instanceof RegexNode) return "string";
  if (node instanceof GroupListsNode) return "list";
  return null;
}

// These recolor with their output socket, so every accent consumer (card, minimap, canvas snapshot) must read nodeAccent, never nodeKindOf.
const SOCKET_DRIVEN_ACCENT = (node: ClassicPreset.Node): boolean =>
  node instanceof ListInputNode || node instanceof TableInputNode || node instanceof FormatControllerNode ||
  // Set's output swaps between list and logical per op.
  node instanceof SetsNode;

/** Resolves the socket CSS vars a <canvas> cannot read, so the minimap and canvas snapshot paint the accent the card shows. */
const NO_FAMILY_OUTPUTS = new Set(["number", "list", "numlist", "table", "any", "anylist", "anycombo", "anydata", "anytable", "trueany"]);

function unfiledOutput(node: ClassicPreset.Node): SolenoidSocket | null {
  if (explicitKindOf(node) !== null) return null;
  const outs = Object.values(node.outputs ?? {});
  if (outs.length !== 1) return null;
  const socket = (outs[0] as { socket?: unknown } | undefined)?.socket;
  return socket instanceof SolenoidSocket && !NO_FAMILY_OUTPUTS.has(socket.dataType) ? socket : null;
}

export function nodeAccent(node: ClassicPreset.Node, mode: "dark" | "light"): string {
  const kindAccent = themeAccent(NODE_KIND_ACCENTS[nodeKindOf(node)], mode);
  const unfiled = unfiledOutput(node);
  if (unfiled) return socketVarHex(SOCKET_COLORS[unfiled.dataType], mode);
  if (!SOCKET_DRIVEN_ACCENT(node)) return kindAccent;
  for (const port of Object.values(node.outputs ?? {})) {
    const socket = (port as { socket?: unknown } | undefined)?.socket;
    if (socket instanceof SolenoidSocket) return socketVarHex(SOCKET_COLORS[socket.dataType], mode);
  }
  return kindAccent;
}

export function nodeDomWeight(node: ClassicPreset.Node): number {
  // An idle SVG Picker is one <img>; its inline SVG mounts only on hover, never during a pan or zoom.
  if (node instanceof SvgPickerNode) return 2;
  if (
    node instanceof ChartNode || node instanceof MergePlotsNode || node instanceof HistogramNode ||
    node instanceof ProportionNode || node instanceof SankeyNode ||
    node instanceof MermaidNode || node instanceof RecordNode
  ) return 10;
  if (node instanceof HeatmapCellNode || node instanceof TornadoNode) return 6;
  if (
    node instanceof SparklineNode || node instanceof GaugeNode ||
    node instanceof ChartBuilderNode
  ) return 3;
  const grid = Object.values(node.outputs ?? {}).some((p) => {
    const s = (p as { socket?: ClassicPreset.Socket } | undefined)?.socket;
    return s instanceof SolenoidSocket && (s.dataType === "table" || s.dataType === "frame" || s.dataType === "cube");
  });
  if (grid) return 2;
  return 1;
}

export function nodeResizable(node: ClassicPreset.Node): boolean {
  return node instanceof DisplayNode;
}

export function nodeWide(node: ClassicPreset.Node): boolean {
  if (node instanceof PointPlotterNode || node instanceof CurveNode) return true;
  if (node instanceof ExpressionNode || node instanceof ScriptNode || node instanceof EquationNode) return true;
  if (node instanceof SparklineNode || node instanceof ChartNode || node instanceof MergePlotsNode || node instanceof MermaidNode || node instanceof TornadoNode) return true;
  if (node instanceof ProportionNode || node instanceof SankeyNode || node instanceof HistogramNode) return true;
  const ports = [...Object.values(node.inputs ?? {}), ...Object.values(node.outputs ?? {})];
  return ports.some((p) => {
    const s = (p as { socket?: ClassicPreset.Socket } | undefined)?.socket;
    return s instanceof SolenoidSocket && (s.dataType === "table" || s.dataType === "frame" || s.dataType === "cube" || s.dataType === "lambda");
  });
}

export function nodeMedium(node: ClassicPreset.Node): boolean {
  return Object.values(node.outputs ?? {}).some((p) => {
    const s = (p as { socket?: ClassicPreset.Socket } | undefined)?.socket;
    return s instanceof SolenoidSocket &&
      (s.dataType === "date" || s.dataType === "datelist" || s.dataType === "datecombo");
  });
}
