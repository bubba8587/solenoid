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
import { EquationNode } from "./equation";
import { GroupByNode } from "./list";
import { RegexNode } from "./text";
import { ComparisonNode, BooleanOpNode, NotNode, BetweenNode, IsCloseNode, IfNode, IFErrorNode, IsTestNode, IsEvenOddNode, NaNode, ChooseNode, SwitchNode, IfsNode } from "./logic";
import { ComplexFromNode, ComplexUnpackNode, ComplexUnaryNode, ComplexBinaryNode, ComplexPowerNode, QuadraticRootsNode, PolyRootsNode } from "./complex";
import {
  ListInputNode, SeriesNode, AggregateNode,
  ListLengthNode, ListIndexNode, SortNode, FilterNode, SumIfsNode,
  ReverseNode, SliceNode,
  UniqueNode, ListTakeDropNode, SetOpNode, SetRelationNode, IsInNode, TallyNode,
  ConcatListsNode, RunningNode, DiffNode,
  ArgMinMaxNode, ContainsNode,
  NormalizeNode, BinNode, OutliersNode, SmoothNode, FindPeaksNode, SpectrumNode, ShiftNode, CombinationsNode, EwmaNode, ConvolveNode, CrossNode, PolyfitNode, TrapzNode, RleNode, RepeatNode,
  ShuffleNode, NthElementNode, InterleaveNode,
  PadNode, GeometricNode, FibonacciNode,
  FillNode,
} from "./list";
import {
  RankPercentileNode, CorrelNode,
  StandardizeNode, CovarianceNode, FisherNode,
  RegressionNode, ForecastNode, EtsForecastNode, DecomposeNode, FitDistributionNode, ModeNode, TrimMeanNode, FrequencyNode, ConfidenceNode,
} from "./stats";
import { BitwiseNode, DepreciationNode, TvmNode, IpmtPpmtNode, NpvNode, IrrNode, MirrNode, CumPmtNode, AmortizationNode, ReturnsNode } from "./finance";
import { DisplayNode, AlertNode, RandBetweenNode } from "./display";
import { DistributionNode } from "./distribution";
import { ConduitNode } from "./conduit";
import { FrameFromListsNode } from "./frame";
import { FrameInputNode, BuildFrameNode, SplitFrameNode, GetColumnNode, AddColumnNode, ComputedColumnNode, GetRowNode, DistinctNode, HeadNode, SortFrameNode, FilterFrameNode, JoinNode, XLookupNode, SelectColumnsNode, DropColumnsNode, GroupByFrameNode, PivotNode, UnpivotNode, NestNode, UnnestNode, AppendNode, BindColumnsNode, RenameNode, SplitColumnNode, AddIndexNode, DecisionMatrixNode, DecisionSensitivityNode, FillBlanksNode, ReplaceValuesNode, MergeColumnsNode, HeadersNode, DropBlankRowsNode, DescribeNode, CorrMatrixNode, KMeansNode, PcaNode, LogisticNode, WindowNode } from "./frame";
import { BuildCubeNode, NestJoinNode, CubeColumnsNode, CubeRollupNode } from "./cube";
import { WebSourceNode, CsvConnectionNode, ParquetConnectionNode, ImportHtmlNode, ImportXmlNode } from "./connection";
import { DataFeedNode } from "./dataFeed";
import { WriteCsvNode, WriteJsonNode } from "./sink";
import { WriteObsidianNode } from "./obsidian";
import { ExpectNode } from "./quality";
import { TornadoNode } from "./tornado";
import { ReconcileNode } from "./frame";
import { SlicerNode, CableSwitchNode, DateInputNode, XYPadNode, PointPlotterNode, CurveNode, GridPainterNode } from "./control";
import { SparklineNode, ChartNode, MermaidNode, GaugeNode, HeatmapCellNode, ChartBuilderNode, TreemapNode, SankeyNode, HistogramNode, SurfaceNode, WaterfallNode, CandlestickNode, BoxplotNode, CalendarHeatmapNode, WaffleNode, QuiverNode, SevenSegNode, RecordNode } from "./visual";
import { NoteNode, ImageNode, SvgPickerNode } from "./annotation";
import { CompositeNode, CompositeInputNode, CompositeOutputNode } from "./composite";
import {
  TableInputNode, MatDetNode, MatSolveNode, MatEigenNode, TableMultNode, TableUnitNode, TableDiagNode, TableOuterNode, TableTransposeNode,
  HStackTableNode, VStackNode, TableReshapeNode, TableSelectNode, TableTakeDropNode, ExpandNode, TableInfoNode,
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
} from "./date";

// Runs at call-time, so forward-referencing every class above is safe; never
// relies on constructor.name (minification-proof).

export function nodeKindOf(node: ClassicPreset.Node): NodeKind {
  // The Composite node itself stays neutral gray (util, below).
  if (node instanceof CompositeInputNode || node instanceof CompositeOutputNode) return "boundary";
  if (node instanceof NumberInputNode || node instanceof ConstantNode || node instanceof PhysicsConstantNode || node instanceof ElementNode || node instanceof SliderInputNode || node instanceof RandBetweenNode || node instanceof WebSourceNode || node instanceof CsvConnectionNode || node instanceof ParquetConnectionNode || node instanceof ImportHtmlNode || node instanceof ImportXmlNode || node instanceof DataFeedNode || node instanceof XYPadNode || node instanceof ColorPickerNode || node instanceof SvgPickerNode || node instanceof PointPlotterNode || node instanceof CurveNode || node instanceof GridPainterNode) return "input";
  if (node instanceof SparklineNode || node instanceof ChartNode || node instanceof MermaidNode || node instanceof GaugeNode || node instanceof HeatmapCellNode || node instanceof ChartBuilderNode || node instanceof TornadoNode || node instanceof SurfaceNode) return "display";
  if (node instanceof WaterfallNode || node instanceof CandlestickNode || node instanceof BoxplotNode || node instanceof CalendarHeatmapNode || node instanceof WaffleNode || node instanceof QuiverNode || node instanceof SevenSegNode || node instanceof RecordNode) return "display";
  if (node instanceof ConvertNode || node instanceof CastNode) return "convert";
  if (
    node instanceof ComplexFromNode || node instanceof ComplexUnpackNode ||
    node instanceof ComplexUnaryNode || node instanceof ComplexBinaryNode ||
    node instanceof ComplexPowerNode || node instanceof QuadraticRootsNode || node instanceof PolyRootsNode
  ) return "complex";
  // Nodes that EMIT the logical type read as logic, matching their output color.
  if (
    node instanceof ComparisonNode || node instanceof BooleanOpNode ||
    node instanceof NotNode || node instanceof BetweenNode || node instanceof IsCloseNode ||
    node instanceof BooleanInputNode || node instanceof IsTestNode ||
    node instanceof IsEvenOddNode || node instanceof SetRelationNode ||
    node instanceof IsInNode
  ) return "logic";
  if (
    node instanceof ListInputNode || node instanceof SeriesNode || node instanceof AggregateNode ||
    node instanceof ListLengthNode || node instanceof ListIndexNode || node instanceof SortNode ||
    node instanceof FilterNode ||
    node instanceof ReverseNode || node instanceof SliceNode ||
    node instanceof UniqueNode || node instanceof ListTakeDropNode ||
    node instanceof SetOpNode || node instanceof TallyNode ||
    node instanceof ConcatListsNode || node instanceof RunningNode || node instanceof DiffNode ||
    node instanceof ArgMinMaxNode || node instanceof ContainsNode ||
    node instanceof NormalizeNode ||
    node instanceof BinNode || node instanceof OutliersNode || node instanceof SmoothNode || node instanceof FindPeaksNode || node instanceof SpectrumNode || node instanceof ShiftNode || node instanceof CombinationsNode || node instanceof RepeatNode ||
    node instanceof EwmaNode || node instanceof ConvolveNode || node instanceof CrossNode ||
    node instanceof PolyfitNode || node instanceof TrapzNode || node instanceof RleNode ||
    node instanceof ShuffleNode || node instanceof NthElementNode || node instanceof InterleaveNode ||
    node instanceof PadNode || node instanceof GeometricNode || node instanceof FibonacciNode ||
    node instanceof FillNode
  ) return "list";
  if (
    node instanceof RankPercentileNode || node instanceof CorrelNode ||
    node instanceof CombinatoricsNode || node instanceof TwoInputMathNode || node instanceof SumProductNode ||
    node instanceof StandardizeNode || node instanceof CovarianceNode || node instanceof FisherNode ||
    node instanceof BitwiseNode || node instanceof DepreciationNode ||
    node instanceof RegressionNode || node instanceof ForecastNode || node instanceof EtsForecastNode || node instanceof DecomposeNode || node instanceof FitDistributionNode || node instanceof ModeNode ||
    node instanceof TrimMeanNode || node instanceof FrequencyNode || node instanceof ConfidenceNode ||
    node instanceof SeriesSumNode || node instanceof MultinomialNode
  ) return "math";
  if (
    node instanceof TvmNode || node instanceof IpmtPpmtNode ||
    node instanceof NpvNode || node instanceof IrrNode || node instanceof MirrNode ||
    node instanceof CumPmtNode || node instanceof AmortizationNode || node instanceof ReturnsNode
  ) return "math";
  if (
    node instanceof DistributionNode
  ) return "math";
  if (
    node instanceof IFErrorNode || node instanceof ConduitNode ||
    node instanceof ChooseNode || node instanceof NaNode ||
    node instanceof AlertNode || node instanceof IfNode ||
    node instanceof SwitchNode || node instanceof IfsNode ||
    node instanceof CableSwitchNode || node instanceof NoteNode ||
    node instanceof ImageNode || node instanceof ExpectNode ||
    node instanceof WriteCsvNode || node instanceof WriteJsonNode ||
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
    node instanceof DateInputNode || node instanceof SaveTimesNode
  ) return "date";
  if (
    node instanceof TableInputNode || node instanceof MatDetNode || node instanceof MatSolveNode || node instanceof MatEigenNode ||
    node instanceof TableMultNode || node instanceof TableUnitNode || node instanceof TableDiagNode ||
    node instanceof TableOuterNode ||
    node instanceof TableTransposeNode || node instanceof HStackTableNode || node instanceof VStackNode ||
    node instanceof TableReshapeNode || node instanceof TableSelectNode ||
    node instanceof TableTakeDropNode || node instanceof ExpandNode ||
    node instanceof TableInfoNode || node instanceof MapTableNode ||
    node instanceof ByAxisNode || node instanceof MakeArrayNode ||
    node instanceof ReduceLambdaNode || node instanceof ScanLambdaNode
  ) return "table";
  if (
    node instanceof FrameInputNode ||
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
    node instanceof SelectColumnsNode ||
    node instanceof DropColumnsNode ||
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
  if (node instanceof GroupByNode) return "list";
  // Arithmetic, MathFn, Clamp, MRound, RoundN
  return "math";
}

// The type-switchable literals and the FC recolor with their element type, so their
// accent tracks the OUTPUT socket color, not the fixed kind color. Every accent
// consumer (the card, the minimap, the html-canvas snapshot) MUST read this — reading
// nodeKindOf directly freezes them on the kind color while the card recolors.
const SOCKET_DRIVEN_ACCENT = (node: ClassicPreset.Node): boolean =>
  node instanceof ListInputNode || node instanceof TableInputNode || node instanceof FormatControllerNode;

/** The final, theme-resolved accent hex for a node. Socket colors are CSS vars a
 *  `<canvas>` can't read, so this resolves them (via socketVarHex) to the same concrete
 *  color appTheme bakes into the var — letting the minimap and the html-canvas snapshot
 *  paint the SAME accent the DOM card shows. */
export function nodeAccent(node: ClassicPreset.Node, mode: "dark" | "light"): string {
  const kindAccent = themeAccent(NODE_KIND_ACCENTS[nodeKindOf(node)], mode);
  if (!SOCKET_DRIVEN_ACCENT(node)) return kindAccent;
  for (const port of Object.values(node.outputs ?? {})) {
    const socket = (port as { socket?: unknown } | undefined)?.socket;
    if (socket instanceof SolenoidSocket) return socketVarHex(SOCKET_COLORS[socket.dataType], mode);
  }
  return kindAccent;
}

// COARSE weights summed off HtmlCanvasLayer's existing nodecreated/noderemoved
// recount — never a live DOM element count. Baseline 1 == one scalar card, tiers
// calibrated so ~10 full charts ≈ the 100-unit default threshold.
export function nodeDomWeight(node: ClassicPreset.Node): number {
  // SVG Picker is a single <img> when idle; the heavy inline SVG mounts only on
  // hover, which never coincides with the pan/zoom gesture this gate serves.
  if (node instanceof SvgPickerNode) return 2;
  // Full figures (a recharts subtree, a mermaid diagram): ten ≈ the default threshold.
  if (
    node instanceof ChartNode || node instanceof HistogramNode ||
    node instanceof TreemapNode || node instanceof SankeyNode ||
    node instanceof MermaidNode || node instanceof RecordNode
  ) return 10;
  if (node instanceof HeatmapCellNode || node instanceof TornadoNode) return 6;
  if (
    node instanceof SparklineNode || node instanceof GaugeNode ||
    node instanceof ChartBuilderNode
  ) return 3;
  // Detected from the OUTPUT sockets, so a new grid-emitting node counts with no
  // class list.
  const grid = Object.values(node.outputs ?? {}).some((p) => {
    const s = (p as { socket?: ClassicPreset.Socket } | undefined)?.socket;
    return s instanceof SolenoidSocket && (s.dataType === "table" || s.dataType === "frame" || s.dataType === "cube");
  });
  if (grid) return 2;
  return 1;
}

// The one source of truth for the resizable set.
export function nodeResizable(node: ClassicPreset.Node): boolean {
  // Resize is a DISPLAY-only affordance; every other node wraps/truncates at its
  // content-driven size.
  return node instanceof DisplayNode;
}

// Detected from SOCKETS, so any new table/frame/lambda node is wide automatically;
// a manual resize still wins (inline width over the class).
export function nodeWide(node: ClassicPreset.Node): boolean {
  // Inline charts and drawing pads need the wide card to fit their fixed-width plot.
  if (node instanceof PointPlotterNode || node instanceof CurveNode) return true;
  if (node instanceof SparklineNode || node instanceof ChartNode || node instanceof MermaidNode || node instanceof TornadoNode) return true;
  if (node instanceof TreemapNode || node instanceof SankeyNode || node instanceof HistogramNode) return true;
  const ports = [...Object.values(node.inputs ?? {}), ...Object.values(node.outputs ?? {})];
  return ports.some((p) => {
    const s = (p as { socket?: ClassicPreset.Socket } | undefined)?.socket;
    return s instanceof SolenoidSocket && (s.dataType === "table" || s.dataType === "frame" || s.dataType === "lambda");
  });
}
