import { ClassicPreset } from "rete";
import type { NodeKind } from "./shared";
import { SolenoidSocket } from "../sockets";
import { NumberInputNode, ConstantNode, BooleanInputNode, SliderInputNode, ColorPickerNode } from "./input";
import { ConvertNode } from "./convert";
import { CastNode } from "./cast";
import { FormatControllerNode } from "./formatController";
import { ExpressionNode } from "./expression";
import { GroupByNode, XMatchNode } from "./list";
import { RegexNode } from "./text";
import { ComparisonNode, BooleanOpNode, NotNode, IfNode, IFErrorNode, IsTestNode, IsEvenOddNode, NaNode, ChooseNode, SwitchNode, IfsNode } from "./logic";
import { ComplexFromNode, ComplexUnpackNode, ComplexUnaryNode, ComplexBinaryNode, ComplexPowerNode } from "./complex";
import {
  ListInputNode, RangeNode, AggregateNode,
  ListLengthNode, ListIndexNode, SortNode,
  ReverseNode, SliceNode,
  UniqueNode, TakeNode, DropNode,
  VStackNode, CumulativeNode, DiffNode,
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
import { BitwiseNode, InterestRateNode, DepreciationNode, TvmNode, RateNode, IpmtPpmtNode, NpvNode, IrrNode, MirrNode, CumPmtNode } from "./finance";
import { DisplayNode, AlertNode, RandBetweenNode } from "./display";
import { NormDistNode, NormInvNode, NormSDistNode, NormSInvNode, TDistNode, TInvNode, ChisqDistNode, ChisqInvNode } from "./dist-normal";
import { FDistNode, FInvNode, BetaDistNode, BetaInvNode, GammaDistNode, GammaInvNode, LognormDistNode, LognormInvNode, WeibullDistNode, ExponDistNode } from "./dist-continuous";
import { BinomDistNode, BinomInvNode, PoissonDistNode, HypgeomDistNode, NegbinomDistNode } from "./dist-discrete";
import { ConduitNode } from "./conduit";
import { FrameInputNode, BuildFrameNode, SplitFrameNode, GetColumnNode, AddColumnNode, GetRowNode, DistinctNode, HeadNode, SortFrameNode, FilterFrameNode, JoinNode, FrameLookupNode, SelectColumnsNode, DropColumnsNode, GroupByFrameNode, PivotNode, UnpivotNode, NestNode, UnnestNode, AppendNode, RenameNode, SplitColumnNode, AddIndexNode, DecisionMatrixNode, DecisionSensitivityNode } from "./frame";
import { WebSourceNode, CsvConnectionNode, ImportHtmlNode, ImportXmlNode } from "./connection";
import { WriteCsvNode, WriteJsonNode } from "./sink";
import { SlicerNode, CableSwitchNode, DatePickerNode, XYPadNode } from "./control";
import { SparklineNode, ChartNode, GaugeNode, HeatmapCellNode, ChartBuilderNode } from "./visual";
import { NoteNode, ImageNode } from "./annotation";
import { XLookupNode } from "./lookup";
import {
  TableInputNode, MatDetNode, TableMultNode, TableUnitNode, TableTransposeNode,
  HStackTableNode, TableReshapeNode, TableSelectNode, TableInfoNode,
} from "./matrix";
import { MapTableNode, ByAxisNode, MakeArrayNode, ReduceLambdaNode } from "./tableLambda";
import { LambdaNode } from "./lambda";
import {
  CombinatoricsNode, TwoInputMathNode, SumProductNode,
  SeriesSumNode, MultinomialNode,
} from "./scalar";
import {
  TextInputNode, TextTransformNode, TextLenNode, ConcatNode, TextSliceNode,
  TextFindNode, SubstituteNode, TextReplaceNode,
  ReptNode, ExactNode, CharCodeNode, TextJoinNode, TextSplitNode, TextAfterBeforeNode,
} from "./text";
import {
  TodayNowNode, DateConstructNode, TimeConstructNode,
  DateValueNode, TimeValueNode, DatePartNode, WeekInfoNode,
  DateDiffNode, DateAddNode, WorkdayNode, NetworkdaysNode,
} from "./date";

// ─── Kind resolver ─────────────────────────────────────────────────────────────
// Central instanceof map. Runs at call-time (after module init), so
// forward-referencing every class above is safe. Minification-proof —
// doesn't rely on constructor.name.

export function nodeKindOf(node: ClassicPreset.Node): NodeKind {
  if (node instanceof NumberInputNode || node instanceof ConstantNode || node instanceof SliderInputNode || node instanceof RandBetweenNode || node instanceof WebSourceNode || node instanceof CsvConnectionNode || node instanceof ImportHtmlNode || node instanceof ImportXmlNode || node instanceof XYPadNode || node instanceof ColorPickerNode) return "input";
  if (node instanceof SparklineNode || node instanceof ChartNode || node instanceof GaugeNode || node instanceof HeatmapCellNode || node instanceof ChartBuilderNode) return "display";
  if (node instanceof ConvertNode || node instanceof CastNode) return "convert";
  if (
    node instanceof ComplexFromNode || node instanceof ComplexUnpackNode ||
    node instanceof ComplexUnaryNode || node instanceof ComplexBinaryNode ||
    node instanceof ComplexPowerNode
  ) return "complex";
  // Nodes that EMIT the logical type (purple TRUE/FALSE socket) read as logic, so
  // their header colour matches what they output: Boolean source, the IS-checks,
  // and the parity test — alongside Comparison / Logical.
  if (
    node instanceof ComparisonNode || node instanceof BooleanOpNode ||
    node instanceof NotNode ||
    node instanceof BooleanInputNode || node instanceof IsTestNode ||
    node instanceof IsEvenOddNode
  ) return "logic";
  if (
    node instanceof ListInputNode || node instanceof RangeNode || node instanceof AggregateNode ||
    node instanceof ListLengthNode || node instanceof ListIndexNode || node instanceof SortNode ||
    node instanceof ReverseNode || node instanceof SliceNode ||
    node instanceof UniqueNode || node instanceof TakeNode || node instanceof DropNode ||
    node instanceof VStackNode || node instanceof CumulativeNode || node instanceof DiffNode ||
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
    node instanceof BitwiseNode || node instanceof InterestRateNode || node instanceof DepreciationNode ||
    node instanceof RegressionNode || node instanceof ForecastNode || node instanceof ModeNode ||
    node instanceof TrimMeanNode || node instanceof FrequencyNode || node instanceof ConfidenceNode ||
    node instanceof SeriesSumNode || node instanceof MultinomialNode
  ) return "math";
  if (
    node instanceof TvmNode || node instanceof RateNode || node instanceof IpmtPpmtNode ||
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
    node instanceof ImageNode ||
    node instanceof WriteCsvNode || node instanceof WriteJsonNode
  ) return "util";
  if (node instanceof DisplayNode) return "util";
  if (
    node instanceof TextInputNode || node instanceof TextTransformNode ||
    node instanceof TextLenNode || node instanceof ConcatNode ||
    node instanceof TextSliceNode || node instanceof TextFindNode ||
    node instanceof SubstituteNode || node instanceof TextReplaceNode ||
    node instanceof ReptNode || node instanceof ExactNode ||
    node instanceof CharCodeNode || node instanceof TextJoinNode ||
    node instanceof TextSplitNode || node instanceof TextAfterBeforeNode
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
    node instanceof TableTransposeNode || node instanceof HStackTableNode ||
    node instanceof TableReshapeNode || node instanceof TableSelectNode ||
    node instanceof TableInfoNode || node instanceof MapTableNode ||
    node instanceof ByAxisNode || node instanceof MakeArrayNode ||
    node instanceof ReduceLambdaNode
  ) return "table";
  if (
    node instanceof FrameInputNode ||
    node instanceof BuildFrameNode || node instanceof SplitFrameNode ||
    node instanceof GetColumnNode || node instanceof AddColumnNode ||
    node instanceof GetRowNode ||
    node instanceof DistinctNode ||
    node instanceof HeadNode ||
    node instanceof SortFrameNode ||
    node instanceof FilterFrameNode ||
    node instanceof JoinNode ||
    node instanceof FrameLookupNode ||
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
    node instanceof DecisionMatrixNode ||
    node instanceof DecisionSensitivityNode ||
    node instanceof SlicerNode
  ) return "frame";
  if (node instanceof FormatControllerNode) return "format";
  if (node instanceof LambdaNode) return "lambda";
  if (node instanceof ExpressionNode) return "math";
  if (node instanceof RegexNode) return "string";
  if (node instanceof GroupByNode) return "list";
  // Arithmetic, MathFn, Clamp, MRound, RoundN
  return "math";
}

// Which nodes expose a manual resize handle (width+height). The rule: boxes
// that hold user-entered text or a string / lookup result are worth widening;
// pure numeric compute results don't get a handle and truncate instead. Kept
// here next to nodeKindOf so the resizable set has one source of truth.
export function nodeResizable(node: ClassicPreset.Node): boolean {
  const k = nodeKindOf(node);
  if (k === "input" || k === "string" || k === "convert") return true;
  if (node instanceof DisplayNode) return true;
  if (node instanceof XLookupNode || node instanceof XMatchNode) return true;
  // Expression: widening gives long Excel formulas + the KaTeX preview room.
  if (node instanceof ExpressionNode) return true;
  return false;
}

// ─── Width tier ────────────────────────────────────────────────────────────────
// A node that carries 2D data (a table/matrix or a frame socket on either side)
// gets a wider default card so grid + named-column previews aren't cramped.
// Heights stay content-driven. Detected from sockets, so any new table/frame node
// is wide automatically — no per-class list to maintain. A manual resize still
// overrides this (inline width wins over the class).
export function nodeWide(node: ClassicPreset.Node): boolean {
  // The inline charts draw a fixed-width plot that needs the wide card to fit;
  // Heatmap qualifies on its table socket below.
  if (node instanceof SparklineNode || node instanceof ChartNode) return true;
  const ports = [...Object.values(node.inputs ?? {}), ...Object.values(node.outputs ?? {})];
  return ports.some((p) => {
    const s = (p as { socket?: ClassicPreset.Socket } | undefined)?.socket;
    return s instanceof SolenoidSocket && (s.dataType === "table" || s.dataType === "frame");
  });
}
