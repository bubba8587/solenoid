import { ClassicPreset } from "rete";
import type { NodeKind } from "./shared";
import { SolenoidSocket } from "../sockets";
import { NumberInputNode, ConstantNode, BooleanInputNode, SliderInputNode, ColorPickerNode, ColorBlendNode } from "./input";
import { PhysicsConstantNode } from "./physicsConstants";
import { ElementNode } from "./chemistry";
import { ConvertNode } from "./convert";
import { CastNode } from "./cast";
import { FormatControllerNode } from "./formatController";
import { ExpressionNode } from "./expression";
import { EquationNode } from "./equation";
import { GroupByNode } from "./list";
import { RegexNode } from "./text";
import { ComparisonNode, BooleanOpNode, NotNode, IfNode, IFErrorNode, IsTestNode, IsEvenOddNode, NaNode, ChooseNode, SwitchNode, IfsNode } from "./logic";
import { ComplexFromNode, ComplexUnpackNode, ComplexUnaryNode, ComplexBinaryNode, ComplexPowerNode, QuadraticRootsNode } from "./complex";
import {
  ListInputNode, RangeNode, AggregateNode,
  ListLengthNode, ListIndexNode, SortNode, FilterNode, SumIfsNode,
  ReverseNode, SliceNode,
  UniqueNode, TakeNode, DropNode, SetOpNode, SetRelationNode, IsInNode, TallyNode,
  ConcatListsNode, CumulativeNode, DiffNode,
  ArgMinMaxNode, ContainsNode,
  NormalizeNode, LinSpaceNode, RepeatNode,
  ShuffleNode, NthElementNode, InterleaveNode,
  PadNode, GeometricNode, FibonacciNode,
  RollingNode, FillNode,
} from "./list";
import {
  NthValueNode, PercentileNode, QuartileNode,
  PercentrankNode, RankNode, CorrelNode,
  StandardizeNode, CovarianceNode, FisherNode,
  RegressionNode, ForecastNode, ModeNode, TrimMeanNode, FrequencyNode, ConfidenceNode,
} from "./stats";
import { BitwiseNode, DepreciationNode, TvmNode, IpmtPpmtNode, NpvNode, IrrNode, MirrNode, CumPmtNode } from "./finance";
import { DisplayNode, AlertNode, RandBetweenNode } from "./display";
import { NormDistNode, NormInvNode, NormSDistNode, NormSInvNode, TDistNode, TInvNode, ChisqDistNode, ChisqInvNode } from "./dist-normal";
import { FDistNode, FInvNode, BetaDistNode, BetaInvNode, GammaDistNode, GammaInvNode, LognormDistNode, LognormInvNode, WeibullDistNode, ExponDistNode } from "./dist-continuous";
import { BinomDistNode, BinomInvNode, PoissonDistNode, HypgeomDistNode, NegbinomDistNode } from "./dist-discrete";
import { ConduitNode } from "./conduit";
import { FrameFromListsNode } from "./frame";
import { FrameInputNode, BuildFrameNode, SplitFrameNode, GetColumnNode, AddColumnNode, ComputedColumnNode, GetRowNode, DistinctNode, HeadNode, SortFrameNode, FilterFrameNode, JoinNode, XLookupNode, SelectColumnsNode, DropColumnsNode, GroupByFrameNode, PivotNode, UnpivotNode, NestNode, UnnestNode, AppendNode, RenameNode, SplitColumnNode, AddIndexNode, DecisionMatrixNode, DecisionSensitivityNode, FillBlanksNode, ReplaceValuesNode, MergeColumnsNode, HeadersNode, DropBlankRowsNode } from "./frame";
import { BuildCubeNode, NestJoinNode, CubeColumnsNode, CubeRollupNode } from "./cube";
import { WebSourceNode, CsvConnectionNode, ParquetConnectionNode, ImportHtmlNode, ImportXmlNode } from "./connection";
import { DataFeedNode } from "./dataFeed";
import { WriteCsvNode, WriteJsonNode } from "./sink";
import { WriteObsidianNode } from "./obsidian";
import { ExpectNode } from "./quality";
import { TornadoNode } from "./tornado";
import { ReconcileNode } from "./frame";
import { SlicerNode, CableSwitchNode, DatePickerNode, XYPadNode, PointPlotterNode, CurveNode, GridPainterNode } from "./control";
import { SparklineNode, ChartNode, MermaidNode, GaugeNode, HeatmapCellNode, ChartBuilderNode, TreemapNode, SankeyNode, HistogramNode, SurfaceNode, ContourNode, WaterfallNode, CandlestickNode, BoxplotNode, CalendarHeatmapNode, WaffleNode, QuiverNode, SevenSegNode } from "./visual";
import { NoteNode, ImageNode, SvgPickerNode } from "./annotation";
import { CompositeNode, CompositeInputNode, CompositeOutputNode } from "./composite";
import {
  TableInputNode, MatDetNode, TableMultNode, TableUnitNode, TableTransposeNode,
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
  ReptNode, ExactNode, CharCodeNode, TextJoinNode, TextSplitNode, TextAfterBeforeNode,
  ReverseTextNode, SpellNumberNode,
} from "./text";
import {
  TodayNowNode, DateConstructNode, TimeConstructNode,
  DateValueNode, TimeValueNode, DatePartNode, WeekInfoNode,
  DateDiffNode, DateAddNode, WorkdayNode, NetworkdaysNode,
} from "./date";

// Central instanceof map. Runs at call-time (after module init), so
// forward-referencing every class above is safe. Minification-proof — never
// relies on constructor.name.

export function nodeKindOf(node: ClassicPreset.Node): NodeKind {
  // Composite boundary markers read green ("special"); the Composite node
  // itself stays neutral gray (util, below).
  if (node instanceof CompositeInputNode || node instanceof CompositeOutputNode) return "boundary";
  if (node instanceof NumberInputNode || node instanceof ConstantNode || node instanceof PhysicsConstantNode || node instanceof ElementNode || node instanceof SliderInputNode || node instanceof RandBetweenNode || node instanceof WebSourceNode || node instanceof CsvConnectionNode || node instanceof ParquetConnectionNode || node instanceof ImportHtmlNode || node instanceof ImportXmlNode || node instanceof DataFeedNode || node instanceof XYPadNode || node instanceof ColorPickerNode || node instanceof SvgPickerNode || node instanceof PointPlotterNode || node instanceof CurveNode || node instanceof GridPainterNode) return "input";
  if (node instanceof SparklineNode || node instanceof ChartNode || node instanceof MermaidNode || node instanceof GaugeNode || node instanceof HeatmapCellNode || node instanceof ChartBuilderNode || node instanceof TornadoNode || node instanceof SurfaceNode) return "display";
  if (node instanceof ContourNode || node instanceof WaterfallNode || node instanceof CandlestickNode || node instanceof BoxplotNode || node instanceof CalendarHeatmapNode || node instanceof WaffleNode || node instanceof QuiverNode || node instanceof SevenSegNode) return "display";
  if (node instanceof ConvertNode || node instanceof CastNode) return "convert";
  if (
    node instanceof ComplexFromNode || node instanceof ComplexUnpackNode ||
    node instanceof ComplexUnaryNode || node instanceof ComplexBinaryNode ||
    node instanceof ComplexPowerNode || node instanceof QuadraticRootsNode
  ) return "complex";
  // Nodes that EMIT the logical type read as logic, so their header color
  // matches what they output.
  if (
    node instanceof ComparisonNode || node instanceof BooleanOpNode ||
    node instanceof NotNode ||
    node instanceof BooleanInputNode || node instanceof IsTestNode ||
    node instanceof IsEvenOddNode || node instanceof SetRelationNode ||
    node instanceof IsInNode
  ) return "logic";
  if (
    node instanceof ListInputNode || node instanceof RangeNode || node instanceof AggregateNode ||
    node instanceof ListLengthNode || node instanceof ListIndexNode || node instanceof SortNode ||
    node instanceof FilterNode ||
    node instanceof ReverseNode || node instanceof SliceNode ||
    node instanceof UniqueNode || node instanceof TakeNode || node instanceof DropNode ||
    node instanceof SetOpNode || node instanceof TallyNode ||
    node instanceof ConcatListsNode || node instanceof CumulativeNode || node instanceof DiffNode ||
    node instanceof ArgMinMaxNode || node instanceof ContainsNode ||
    node instanceof NormalizeNode || node instanceof LinSpaceNode || node instanceof RepeatNode ||
    node instanceof ShuffleNode || node instanceof NthElementNode || node instanceof InterleaveNode ||
    node instanceof PadNode || node instanceof GeometricNode || node instanceof FibonacciNode ||
    node instanceof RollingNode || node instanceof FillNode
  ) return "list";
  if (
    node instanceof NthValueNode || node instanceof PercentileNode || node instanceof QuartileNode ||
    node instanceof PercentrankNode || node instanceof RankNode || node instanceof CorrelNode ||
    node instanceof CombinatoricsNode || node instanceof TwoInputMathNode || node instanceof SumProductNode ||
    node instanceof StandardizeNode || node instanceof CovarianceNode || node instanceof FisherNode ||
    node instanceof BitwiseNode || node instanceof DepreciationNode ||
    node instanceof RegressionNode || node instanceof ForecastNode || node instanceof ModeNode ||
    node instanceof TrimMeanNode || node instanceof FrequencyNode || node instanceof ConfidenceNode ||
    node instanceof SeriesSumNode || node instanceof MultinomialNode
  ) return "math";
  if (
    node instanceof TvmNode || node instanceof IpmtPpmtNode ||
    node instanceof NpvNode || node instanceof IrrNode || node instanceof MirrNode ||
    node instanceof CumPmtNode
  ) return "math";
  if (
    node instanceof NormDistNode || node instanceof NormInvNode || node instanceof NormSDistNode ||
    node instanceof NormSInvNode || node instanceof TDistNode || node instanceof TInvNode ||
    node instanceof ChisqDistNode || node instanceof ChisqInvNode ||
    node instanceof FDistNode || node instanceof FInvNode || node instanceof BetaDistNode ||
    node instanceof BetaInvNode || node instanceof GammaDistNode || node instanceof GammaInvNode ||
    node instanceof LognormDistNode || node instanceof LognormInvNode || node instanceof WeibullDistNode ||
    node instanceof ExponDistNode ||
    node instanceof BinomDistNode || node instanceof BinomInvNode || node instanceof PoissonDistNode ||
    node instanceof HypgeomDistNode || node instanceof NegbinomDistNode
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
    node instanceof ReptNode || node instanceof ExactNode ||
    node instanceof CharCodeNode || node instanceof TextJoinNode ||
    node instanceof TextSplitNode || node instanceof TextAfterBeforeNode ||
    node instanceof ReverseTextNode || node instanceof SpellNumberNode ||
    node instanceof ColorBlendNode
  ) return "string";
  if (
    node instanceof TodayNowNode || node instanceof DateConstructNode ||
    node instanceof TimeConstructNode || node instanceof DateValueNode ||
    node instanceof TimeValueNode || node instanceof DatePartNode ||
    node instanceof WeekInfoNode || node instanceof DateDiffNode ||
    node instanceof DateAddNode || node instanceof WorkdayNode ||
    node instanceof NetworkdaysNode || node instanceof DatePickerNode
  ) return "date";
  if (
    node instanceof TableInputNode || node instanceof MatDetNode ||
    node instanceof TableMultNode || node instanceof TableUnitNode ||
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
    node instanceof AppendNode ||
    node instanceof RenameNode ||
    node instanceof SplitColumnNode ||
    node instanceof AddIndexNode ||
    node instanceof FillBlanksNode ||
    node instanceof ReplaceValuesNode ||
    node instanceof MergeColumnsNode ||
    node instanceof HeadersNode ||
    node instanceof DropBlankRowsNode ||
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

// How much a node contributes to the DOM cost the HTML-in-Canvas renderer
// exists to relieve — a RAW node count undercounts a chart-heavy graph.
// Weights are deliberately COARSE and summed off the same nodecreated /
// noderemoved recount HtmlCanvasLayer already runs — never a live DOM element
// count. Baseline is 1 == one scalar card; the heavy tiers are calibrated so
// ~10 full charts ≈ the 100-unit default threshold.
export function nodeDomWeight(node: ClassicPreset.Node): number {
  // SVG Picker's IDLE state is a single <img>; the heavy inline SVG mounts only
  // while the pointer is over the well, which never coincides with a pan/zoom
  // gesture (the only time this gate matters).
  if (node instanceof SvgPickerNode) return 2;
  // Full chart / diagram figures: a big recharts SVG subtree or a rendered mermaid
  // diagram. Ten of these ≈ the default threshold.
  if (
    node instanceof ChartNode || node instanceof HistogramNode ||
    node instanceof TreemapNode || node instanceof SankeyNode ||
    node instanceof MermaidNode
  ) return 10;
  // Grid-of-cells / inline bar figures — heavy, but a step below a full chart.
  if (node instanceof HeatmapCellNode || node instanceof TornadoNode) return 6;
  // Small inline figures (a sparkline strip, a gauge arc) and the option-field
  // heavy Chart Builder card.
  if (
    node instanceof SparklineNode || node instanceof GaugeNode ||
    node instanceof ChartBuilderNode
  ) return 3;
  // A grid PREVIEW is detected from the OUTPUT sockets (where the grid actually
  // renders), so any new grid-emitting node counts without a class list.
  const grid = Object.values(node.outputs ?? {}).some((p) => {
    const s = (p as { socket?: ClassicPreset.Socket } | undefined)?.socket;
    return s instanceof SolenoidSocket && (s.dataType === "table" || s.dataType === "frame" || s.dataType === "cube");
  });
  if (grid) return 2;
  return 1;
}

// Which nodes expose a manual resize handle (width+height) — the one source of
// truth for the resizable set.
export function nodeResizable(node: ClassicPreset.Node): boolean {
  // Resize is a DISPLAY-only affordance: the body-level grip grows the Display's
  // box. Other nodes wrap/truncate at their content-driven size.
  return node instanceof DisplayNode;
}

// A node carrying 2D data (table/frame socket on either side) or a LAMBDA
// socket gets a wider default card. Detected from sockets, so any new
// table/frame/lambda node is wide automatically — no per-class list. A manual
// resize still overrides this (inline width wins over the class).
export function nodeWide(node: ClassicPreset.Node): boolean {
  // The inline charts and the drawing controls' pads need the wide card to fit
  // their fixed-width plot (a class `width` field is only the layout mirror,
  // not a style).
  if (node instanceof PointPlotterNode || node instanceof CurveNode) return true;
  if (node instanceof SparklineNode || node instanceof ChartNode || node instanceof MermaidNode || node instanceof TornadoNode) return true;
  if (node instanceof TreemapNode || node instanceof SankeyNode || node instanceof HistogramNode) return true;
  const ports = [...Object.values(node.inputs ?? {}), ...Object.values(node.outputs ?? {})];
  return ports.some((p) => {
    const s = (p as { socket?: ClassicPreset.Socket } | undefined)?.socket;
    return s instanceof SolenoidSocket && (s.dataType === "table" || s.dataType === "frame" || s.dataType === "lambda");
  });
}
