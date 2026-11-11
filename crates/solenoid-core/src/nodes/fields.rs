// [[C28]] literalsIffEditable, [[C10]] socketLattice, [[D96]] emptySlotShowsItsValue
//! The one field an unwired input shows: the canvas draws it, a body reads the input through it (`Call::unwired`) and a
//! load drops what it doesn't read (`tree/specs/documents/inline-literal-maps.md` § One field per input).

use super::{decode, err, Call};
use crate::error_value::ErrorCode;
use crate::excel_functions::V;
use serde_json::{Map, Value as Json};
use std::rc::Rc;

/// The cards whose wildcard slots take a keyed value read as the kind its button shows.
const KEYED: &[&str] = &[
    "ContainsNode",
    "IFErrorNode",
    "IfNode",
    "IfsNode",
    "SwitchNode",
    "ChooseNode",
    "SetCellNode",
    "BuildCubeNode",
    "CubeColumnsNode",
    "XMatchNode",
    "ScriptNode",
    "ComparisonNode",
    "BetweenNode",
];
/// The cards whose op reads a wildcard slot as text, kept exactly as keyed.
const TEXT: &[&str] = &["ReplaceValuesNode"];
/// The cards whose variables (their inputs on a wildcard or any-list rung) take a typed number while unwired.
const NUMBER_VARIABLES: &[&str] = &["ExpressionNode", "LambdaNode", "ComputedColumnNode"];
/// The cards that keep their list rows as text themselves (List Input).
const OWNS_LISTS: &[&str] = &["ListInputNode"];
/// Inputs whose card names their field itself, whatever the rung: `(card, key, field)`. A key matches itself, or a
/// row of it numbered from 0 (`value` covers `value0`, `value1`, …).
const ROWS: &[(&str, &str, Field)] = &[
    // A criterion row, read by the column's type ([[C58]] tableInputRawText).
    ("FilterNode", "value", Field::Text),
    ("FilterFrameNode", "value", Field::Text),
    ("SumIfsNode", "value", Field::Text),
    // The bounds take the checked value's kind ([[D120]] rangeBoundsTakeTheValuesKind).
    ("ExpectNode", "min", Field::Bound),
    ("ExpectNode", "max", Field::Bound),
    ("ExpectNode", "allowed", Field::Csv),
    ("IsCloseNode", "a", Field::Number),
    ("IsCloseNode", "b", Field::Number),
    // The accumulator's start.
    ("ReduceLambdaNode", "initial", Field::Number),
    ("ScanLambdaNode", "initial", Field::Number),
    // Coalesce's Else rows: a typed number is a constant.
    ("FillNode", "e", Field::Number),
];

/// What an empty field reads as and shows (`tree/specs/documents/inline-literal-maps.md` § What an empty field is).
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Empty {
    /// The card computes with this value, shown muted.
    Fallback(Fill),
    /// The card does what the word names (`[all]`); the body reads the field as left out.
    Behavior(&'static str),
    /// A hint, shown muted in italics; the card computes nothing from it, so a blank here may blank the card.
    Example(&'static str),
    /// Nothing shown; the card answers a named error.
    Required,
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Fill {
    Num(f64),
    Bool(bool),
    Text(&'static str),
}

/// Each declared field's kind: `(card, key, kind)`, a key matching itself or a numbered row of it. Settings declare
/// theirs through their role (`inputRoles`), shared with the formulas. A body reads an empty field only through
/// `Call::unwired`, so a value it computes from is always one declared here.
const EMPTY: &[(&str, &str, Empty)] = &[
    ("AccruedInterestNode", "par", Empty::Fallback(Fill::Num(1000.0))),
    ("AccruedInterestNode", "rate", Empty::Fallback(Fill::Num(0.06))),
    ("AddColumnNode", "name", Empty::Fallback(Fill::Text(""))),
    ("AddIndexNode", "name", Empty::Fallback(Fill::Text("Index"))),
    ("AlertNode", "high", Empty::Fallback(Fill::Num(100.0))),
    ("AlertNode", "low", Empty::Fallback(Fill::Num(0.0))),
    ("AlertNode", "match", Empty::Fallback(Fill::Text(""))),
    ("AlertNode", "target", Empty::Fallback(Fill::Num(0.0))),
    ("AlertNode", "text", Empty::Fallback(Fill::Text(""))),
    ("AlertNode", "value", Empty::Example("50")),
    ("AllocatorNode", "amount", Empty::Fallback(Fill::Num(0.0))),
    ("AmortizationNode", "fv", Empty::Fallback(Fill::Num(0.0))),
    ("AmortizationNode", "nper", Empty::Fallback(Fill::Num(0.0))),
    ("AmortizationNode", "pv", Empty::Fallback(Fill::Num(0.0))),
    ("AmortizationNode", "rate", Empty::Fallback(Fill::Num(0.0))),
    ("AntoineNode", "t", Empty::Example("25")),
    ("ArgMinMaxNode", "list", Empty::Fallback(Fill::Text(""))),
    ("ArithmeticNode", "a", Empty::Fallback(Fill::Num(0.0))),
    ("ArithmeticNode", "b", Empty::Fallback(Fill::Num(0.0))),
    ("AwgNode", "gauge", Empty::Example("12")),
    ("BaseConvertNode", "value", Empty::Fallback(Fill::Num(0.0))),
    ("BesselNode", "x", Empty::Fallback(Fill::Num(1.0))),
    ("BetweenNode", "hi", Empty::Fallback(Fill::Num(0.0))),
    ("BetweenNode", "lo", Empty::Fallback(Fill::Num(0.0))),
    ("BetweenNode", "value", Empty::Fallback(Fill::Num(0.0))),
    ("BinNode", "n", Empty::Fallback(Fill::Num(4.0))),
    ("BinomDistRangeNode", "hi", Empty::Behavior("same as low")),
    ("BinomDistRangeNode", "lo", Empty::Fallback(Fill::Num(0.0))),
    ("BinomDistRangeNode", "n", Empty::Fallback(Fill::Num(10.0))),
    ("BinomDistRangeNode", "p", Empty::Fallback(Fill::Num(0.5))),
    ("BitwiseNode", "a", Empty::Fallback(Fill::Num(0.0))),
    ("BitwiseNode", "b", Empty::Fallback(Fill::Num(0.0))),
    ("BondPricingNode", "pr", Empty::Fallback(Fill::Num(97.5))),
    ("BondPricingNode", "rate", Empty::Fallback(Fill::Num(0.065))),
    ("BondPricingNode", "redemption", Empty::Fallback(Fill::Num(100.0))),
    ("BondPricingNode", "yld", Empty::Fallback(Fill::Num(0.07))),
    ("BooleanOpNode", "a", Empty::Fallback(Fill::Bool(false))),
    ("BoxplotNode", "options", Empty::Fallback(Fill::Text(""))),
    ("BuildCubeNode", "name", Empty::Fallback(Fill::Text(""))),
    ("BuildCubeNode", "v0", Empty::Fallback(Fill::Text(""))),
    ("BuildCubeNode", "v1", Empty::Fallback(Fill::Text(""))),
    ("BuildCubeNode", "v2", Empty::Fallback(Fill::Text(""))),
    ("BuildFrameNode", "headers", Empty::Fallback(Fill::Text(""))),
    ("CalendarHeatmapNode", "options", Empty::Fallback(Fill::Text(""))),
    ("CandlestickNode", "options", Empty::Fallback(Fill::Text(""))),
    ("CardsNode", "layout", Empty::Fallback(Fill::Text(""))),
    ("CardsNode", "options", Empty::Fallback(Fill::Text(""))),
    ("CardsNode", "rows", Empty::Fallback(Fill::Text(""))),
    ("CastNode", "decimal_sep", Empty::Fallback(Fill::Text("."))),
    ("CastNode", "format", Empty::Fallback(Fill::Text(""))),
    // No group separator when the decimal one is a comma, else a comma.
    ("CastNode", "group_sep", Empty::Behavior("auto")),
    ("CharCodeNode", "code", Empty::Example("65")),
    ("CharCodeNode", "text", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "alpha", Empty::Behavior("auto")),
    ("ChartBuilderNode", "annot", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "annotate", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "arrows", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "aspect", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "baseline", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "by", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "c", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "cardsize", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "cbar", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "center", Empty::Behavior("auto")),
    ("ChartBuilderNode", "clamp", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "cmap", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "collapse", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "color", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "columns", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "critical", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "fiscal_start", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "fit", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "fmt", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "fontsize", Empty::Behavior("auto")),
    ("ChartBuilderNode", "grid", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "group_by", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "histogram", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "labels", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "layout", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "linestyle", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "linewidth", Empty::Behavior("auto")),
    ("ChartBuilderNode", "marker", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "markersize", Empty::Behavior("auto")),
    ("ChartBuilderNode", "maxgap", Empty::Behavior("auto")),
    ("ChartBuilderNode", "minutes", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "origin", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "pielabels", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "radarscale", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "s", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "status", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "tiers", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "title", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "today", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "vmax", Empty::Behavior("auto")),
    ("ChartBuilderNode", "vmin", Empty::Behavior("auto")),
    ("ChartBuilderNode", "week", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "weekends", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "window", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "x", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "xlabel", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "xmax", Empty::Behavior("auto")),
    ("ChartBuilderNode", "xmin", Empty::Behavior("auto")),
    ("ChartBuilderNode", "y", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "ylabel", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "ymax", Empty::Behavior("auto")),
    ("ChartBuilderNode", "ymin", Empty::Behavior("auto")),
    ("ChartBuilderNode", "yscale", Empty::Fallback(Fill::Text(""))),
    ("ChartBuilderNode", "zoom", Empty::Fallback(Fill::Text(""))),
    ("ChartNode", "options", Empty::Fallback(Fill::Text(""))),
    ("ChoiceLadderNode", "close", Empty::Fallback(Fill::Num(0.05))),
    ("ChooseNode", "v0", Empty::Fallback(Fill::Text(""))),
    ("ChooseNode", "v1", Empty::Fallback(Fill::Text(""))),
    ("ChooseNode", "v2", Empty::Fallback(Fill::Text(""))),
    ("ChooseNode", "v3", Empty::Fallback(Fill::Text(""))),
    ("ClampNode", "value", Empty::Fallback(Fill::Num(0.0))),
    ("ColebrookNode", "re", Empty::Example("100000")),
    ("ColebrookNode", "rr", Empty::Example("0.0001")),
    ("ColorBlendNode", "a", Empty::Fallback(Fill::Text(""))),
    ("ColorBlendNode", "b", Empty::Fallback(Fill::Text(""))),
    ("ColumnsNode", "columns", Empty::Fallback(Fill::Text(""))),
    ("CombinatoricsNode", "k", Empty::Fallback(Fill::Num(0.0))),
    ("CombinatoricsNode", "n", Empty::Fallback(Fill::Num(0.0))),
    ("ComparisonNode", "a", Empty::Fallback(Fill::Num(0.0))),
    ("ComparisonNode", "b", Empty::Fallback(Fill::Num(0.0))),
    ("ComplexFromNode", "im", Empty::Fallback(Fill::Num(0.0))),
    ("ComplexFromNode", "re", Empty::Fallback(Fill::Num(0.0))),
    ("ComplexPowerNode", "n", Empty::Fallback(Fill::Num(0.0))),
    ("ConcatNode", "v0", Empty::Fallback(Fill::Text(""))),
    ("ConcatNode", "v1", Empty::Fallback(Fill::Text(""))),
    ("ConcatNode", "v2", Empty::Fallback(Fill::Text(""))),
    ("ConcatNode", "v3", Empty::Fallback(Fill::Text(""))),
    ("ConditionalRegionsNode", "labels", Empty::Fallback(Fill::Text(""))),
    ("ConditionalRegionsNode", "values", Empty::Fallback(Fill::Text(""))),
    ("ConfidenceNode", "alpha", Empty::Fallback(Fill::Num(0.05))),
    ("ConfidenceNode", "n", Empty::Fallback(Fill::Num(30.0))),
    ("ConfidenceNode", "stdev", Empty::Fallback(Fill::Num(1.0))),
    ("ContainsNode", "value", Empty::Fallback(Fill::Text(""))),
    ("ConvertNode", "in", Empty::Fallback(Fill::Num(0.0))),
    ("CubeColumnsNode", "c0", Empty::Fallback(Fill::Text(""))),
    ("CubeColumnsNode", "c1", Empty::Fallback(Fill::Text(""))),
    ("CubeColumnsNode", "names", Empty::Fallback(Fill::Text(""))),
    ("CubeRollupNode", "as", Empty::Fallback(Fill::Text(""))),
    ("CubeRollupNode", "column", Empty::Fallback(Fill::Text(""))),
    ("CubeRollupNode", "nested", Empty::Fallback(Fill::Text(""))),
    ("DateAddNode", "months", Empty::Fallback(Fill::Num(0.0))),
    ("DateConstructNode", "day", Empty::Fallback(Fill::Num(1.0))),
    ("DateConstructNode", "month", Empty::Fallback(Fill::Num(1.0))),
    ("DateConstructNode", "year", Empty::Fallback(Fill::Num(2024.0))),
    ("DateDiffNode", "basis", Empty::Fallback(Fill::Num(0.0))),
    ("DateTimeValueNode", "text", Empty::Fallback(Fill::Text(""))),
    ("DelayedPassNode", "start", Empty::Fallback(Fill::Num(0.0))),
    ("DepreciationNode", "cost", Empty::Fallback(Fill::Num(0.0))),
    ("DepreciationNode", "end", Empty::Fallback(Fill::Num(0.0))),
    ("DepreciationNode", "factor", Empty::Fallback(Fill::Num(2.0))),
    ("DepreciationNode", "life", Empty::Fallback(Fill::Num(1.0))),
    ("DepreciationNode", "month", Empty::Fallback(Fill::Num(12.0))),
    ("DepreciationNode", "per", Empty::Fallback(Fill::Num(1.0))),
    ("DepreciationNode", "salvage", Empty::Fallback(Fill::Num(0.0))),
    ("DepreciationNode", "start", Empty::Fallback(Fill::Num(0.0))),
    ("DiscountSecurityNode", "basis", Empty::Fallback(Fill::Num(0.0))),
    ("DiscountSecurityNode", "discount", Empty::Fallback(Fill::Num(0.0))),
    ("DiscountSecurityNode", "investment", Empty::Fallback(Fill::Num(1000.0))),
    ("DiscountSecurityNode", "pr", Empty::Fallback(Fill::Num(97.5))),
    ("DiscountSecurityNode", "rate", Empty::Fallback(Fill::Num(0.0))),
    ("DiscountSecurityNode", "redemption", Empty::Fallback(Fill::Num(100.0))),
    ("DiscountSecurityNode", "yld", Empty::Fallback(Fill::Num(0.0))),
    ("DistributionsNode", "M", Empty::Fallback(Fill::Num(10.0))),
    ("DistributionsNode", "N", Empty::Fallback(Fill::Num(20.0))),
    ("DistributionsNode", "alpha", Empty::Fallback(Fill::Num(2.0))),
    ("DistributionsNode", "beta", Empty::Fallback(Fill::Num(5.0))),
    ("DistributionsNode", "count", Empty::Fallback(Fill::Num(100.0))),
    ("DistributionsNode", "df", Empty::Fallback(Fill::Num(10.0))),
    ("DistributionsNode", "df1", Empty::Fallback(Fill::Num(5.0))),
    ("DistributionsNode", "df2", Empty::Fallback(Fill::Num(10.0))),
    ("DistributionsNode", "k", Empty::Fallback(Fill::Num(0.0))),
    ("DistributionsNode", "lambda", Empty::Fallback(Fill::Num(1.0))),
    ("DistributionsNode", "mean", Empty::Fallback(Fill::Num(0.0))),
    ("DistributionsNode", "n", Empty::Fallback(Fill::Num(10.0))),
    ("DistributionsNode", "p", Empty::Fallback(Fill::Num(0.0))),
    ("DistributionsNode", "r", Empty::Fallback(Fill::Num(5.0))),
    ("DistributionsNode", "stdev", Empty::Fallback(Fill::Num(1.0))),
    ("DistributionsNode", "x", Empty::Fallback(Fill::Num(0.0))),
    ("DistributionsNode", "z", Empty::Fallback(Fill::Num(0.0))),
    ("DollarNode", "dollar", Empty::Fallback(Fill::Num(0.0))),
    ("DollarNode", "fraction", Empty::Fallback(Fill::Num(32.0))),
    ("DurationNode", "coupon", Empty::Fallback(Fill::Num(0.0))),
    ("DurationNode", "yld", Empty::Fallback(Fill::Num(0.0))),
    ("ESeriesNode", "value", Empty::Example("4600")),
    ("EarnedValueNode", "cost", Empty::Fallback(Fill::Text(""))),
    ("EarnedValueNode", "holidays", Empty::Fallback(Fill::Text(""))),
    ("EarnedValueNode", "weekend_code", Empty::Fallback(Fill::Num(1.0))),
    ("EditFrameNode", "key", Empty::Behavior("row number")),
    ("ElementNode", "symbol", Empty::Behavior("the card's pick")),
    ("EmSpectrumNode", "freq", Empty::Example("5e14")),
    ("EmSpectrumNode", "wavelength", Empty::Example("6e-7")),
    ("EpochNode", "value", Empty::Fallback(Fill::Num(0.0))),
    ("ExactNode", "a", Empty::Fallback(Fill::Text(""))),
    ("ExactNode", "b", Empty::Fallback(Fill::Text(""))),
    ("ExpectNode", "allowed", Empty::Fallback(Fill::Text(""))),
    ("ExpectNode", "max", Empty::Fallback(Fill::Num(100.0))),
    ("ExpectNode", "min", Empty::Fallback(Fill::Num(0.0))),
    ("ExpectNode", "pattern", Empty::Fallback(Fill::Text(""))),
    ("FillBlanksNode", "columns", Empty::Fallback(Fill::Text(""))),
    ("FillNode", "e", Empty::Behavior("none")),
    ("FillNode", "value", Empty::Fallback(Fill::Num(0.0))),
    ("FilterFrameNode", "column0", Empty::Fallback(Fill::Text(""))),
    ("FilterFrameNode", "value0", Empty::Fallback(Fill::Text(""))),
    ("FilterNode", "value0", Empty::Fallback(Fill::Text(""))),
    ("FisherNode", "value", Empty::Fallback(Fill::Num(0.0))),
    ("FixedNode", "number", Empty::Fallback(Fill::Num(0.0))),
    ("ForecastNode", "x", Empty::Fallback(Fill::Num(0.0))),
    ("FormatDollarNode", "number", Empty::Fallback(Fill::Num(0.0))),
    ("FrameFromListsNode", "name0", Empty::Fallback(Fill::Text(""))),
    ("FrameFromListsNode", "name1", Empty::Fallback(Fill::Text(""))),
    ("FuzzyMatchNode", "candidates", Empty::Fallback(Fill::Text(""))),
    ("FuzzyMatchNode", "needle", Empty::Fallback(Fill::Text(""))),
    ("FvScheduleNode", "pv", Empty::Fallback(Fill::Num(1000.0))),
    ("FxNode", "amount", Empty::Fallback(Fill::Num(1.0))),
    ("FxNode", "from", Empty::Fallback(Fill::Text(""))),
    ("FxNode", "to", Empty::Fallback(Fill::Text(""))),
    ("GCDNode", "a", Empty::Fallback(Fill::Num(0.0))),
    ("GCDNode", "b", Empty::Fallback(Fill::Num(0.0))),
    ("GanttNode", "holidays", Empty::Fallback(Fill::Text(""))),
    ("GanttNode", "options", Empty::Fallback(Fill::Text(""))),
    ("GanttNode", "weekend_code", Empty::Fallback(Fill::Num(1.0))),
    ("GaugeNode", "options", Empty::Fallback(Fill::Text(""))),
    ("GaugeNode", "value", Empty::Example("75")),
    ("GeocodeNode", "place", Empty::Fallback(Fill::Text(""))),
    ("GetColumnNode", "name", Empty::Fallback(Fill::Text(""))),
    ("GroupByFrameNode", "column", Empty::Fallback(Fill::Text(""))),
    ("GroupByFrameNode", "keys", Empty::Fallback(Fill::Text(""))),
    ("HashNode", "text", Empty::Fallback(Fill::Text(""))),
    ("HeatmapNode", "options", Empty::Fallback(Fill::Text(""))),
    ("HistogramNode", "options", Empty::Fallback(Fill::Text(""))),
    ("HistogramNode", "values", Empty::Fallback(Fill::Num(0.0))),
    ("HrZonesNode", "age", Empty::Example("30")),
    ("HrZonesNode", "max", Empty::Example("190")),
    ("HrZonesNode", "resting", Empty::Example("60")),
    ("HypothesisTestNode", "k", Empty::Fallback(Fill::Num(0.0))),
    ("HypothesisTestNode", "n", Empty::Fallback(Fill::Num(1.0))),
    ("HypothesisTestNode", "n1", Empty::Fallback(Fill::Num(1.0))),
    ("HypothesisTestNode", "n2", Empty::Fallback(Fill::Num(1.0))),
    ("HypothesisTestNode", "p0", Empty::Fallback(Fill::Num(0.5))),
    ("HypothesisTestNode", "sigma", Empty::Behavior("from sample")),
    ("HypothesisTestNode", "x", Empty::Fallback(Fill::Num(0.0))),
    ("HypothesisTestNode", "x1", Empty::Fallback(Fill::Num(0.0))),
    ("HypothesisTestNode", "x2", Empty::Fallback(Fill::Num(0.0))),
    ("IFErrorNode", "fallback", Empty::Fallback(Fill::Num(0.0))),
    ("IFErrorNode", "value", Empty::Fallback(Fill::Num(0.0))),
    ("IRRNode", "dates", Empty::Fallback(Fill::Text(""))),
    ("IfNode", "cond", Empty::Fallback(Fill::Bool(false))),
    ("IfNode", "else", Empty::Fallback(Fill::Text(""))),
    ("IfNode", "then", Empty::Fallback(Fill::Text(""))),
    ("IfsNode", "cond0", Empty::Fallback(Fill::Bool(false))),
    ("IfsNode", "cond1", Empty::Fallback(Fill::Bool(false))),
    ("IfsNode", "cond2", Empty::Fallback(Fill::Bool(false))),
    ("IfsNode", "otherwise", Empty::Fallback(Fill::Text(""))),
    ("IfsNode", "val0", Empty::Fallback(Fill::Text(""))),
    ("IfsNode", "val1", Empty::Fallback(Fill::Text(""))),
    ("IfsNode", "val2", Empty::Fallback(Fill::Text(""))),
    ("ImportObsidianNode", "path", Empty::Fallback(Fill::Text(""))),
    ("InterpolateNode", "gx", Empty::Required),
    ("InterpolateNode", "gy", Empty::Required),
    ("InterpolateNode", "new_xs", Empty::Fallback(Fill::Num(0.0))),
    ("IsCloseNode", "a", Empty::Fallback(Fill::Num(0.0))),
    ("IsCloseNode", "b", Empty::Fallback(Fill::Num(0.0))),
    ("IsEvenOddNode", "in", Empty::Fallback(Fill::Num(0.0))),
    ("IsaAtmosphereNode", "alt", Empty::Fallback(Fill::Num(0.0))),
    ("IspmtNode", "nper", Empty::Fallback(Fill::Num(0.0))),
    ("IspmtNode", "per", Empty::Fallback(Fill::Num(1.0))),
    ("IspmtNode", "pv", Empty::Fallback(Fill::Num(0.0))),
    ("IspmtNode", "rate", Empty::Fallback(Fill::Num(0.0))),
    ("JoinNode", "leftKey", Empty::Fallback(Fill::Text(""))),
    ("JoinNode", "rightKey", Empty::Fallback(Fill::Text(""))),
    ("JoinNode", "tolerance", Empty::Behavior("exact")),
    ("KpiNode", "options", Empty::Fallback(Fill::Text(""))),
    ("KpiNode", "prev", Empty::Example("1100")),
    ("KpiNode", "value", Empty::Example("1250")),
    ("ListIndexNode", "column", Empty::Behavior("all")),
    ("ListIndexNode", "index", Empty::Behavior("all")),
    ("ListInputNode", "v0", Empty::Fallback(Fill::Text(""))),
    ("LogisticNode", "target", Empty::Fallback(Fill::Text(""))),
    ("MRoundNode", "value", Empty::Fallback(Fill::Num(0.0))),
    ("MakeArrayNode", "cols", Empty::Fallback(Fill::Num(0.0))),
    ("MakeArrayNode", "rows", Empty::Fallback(Fill::Num(0.0))),
    ("MathFXNode", "in", Empty::Fallback(Fill::Num(0.0))),
    ("MergeColumnsNode", "columns", Empty::Fallback(Fill::Text(""))),
    ("MergeColumnsNode", "name", Empty::Fallback(Fill::Text(""))),
    ("MergeColumnsNode", "separator", Empty::Fallback(Fill::Text(""))),
    ("MergePlotsNode", "options", Empty::Fallback(Fill::Text(""))),
    ("MermaidNode", "source", Empty::Fallback(Fill::Text(""))),
    ("MirrNode", "finrate", Empty::Fallback(Fill::Num(0.0))),
    ("MirrNode", "reinrate", Empty::Fallback(Fill::Num(0.0))),
    ("MolarMassNode", "formula", Empty::Example("H2O")),
    ("NPVNode", "dates", Empty::Fallback(Fill::Text(""))),
    ("NPVNode", "rate", Empty::Fallback(Fill::Num(0.0))),
    ("NestJoinNode", "key", Empty::Fallback(Fill::Text(""))),
    ("NestJoinNode", "name", Empty::Fallback(Fill::Text(""))),
    ("NestNode", "keys", Empty::Fallback(Fill::Text(""))),
    ("NestNode", "nestedName", Empty::Fallback(Fill::Text("items"))),
    ("NotNode", "in", Empty::Fallback(Fill::Num(0.0))),
    ("OdeIntegrateNode", "t0", Empty::Fallback(Fill::Num(0.0))),
    ("OdeIntegrateNode", "t1", Empty::Fallback(Fill::Num(1.0))),
    ("OdeIntegrateNode", "y0", Empty::Fallback(Fill::Num(1.0))),
    // 3 for a z-score, 1.5 for IQR fences, 3.5 for a MAD score.
    ("OutliersNode", "threshold", Empty::Behavior("by method")),
    ("PadNode", "fill", Empty::Fallback(Fill::Num(0.0))),
    ("PadTextNode", "text", Empty::Fallback(Fill::Text(""))),
    ("PaymentBreakdownNode", "end", Empty::Fallback(Fill::Num(1.0))),
    ("PaymentBreakdownNode", "fv", Empty::Fallback(Fill::Num(0.0))),
    ("PaymentBreakdownNode", "nper", Empty::Fallback(Fill::Num(0.0))),
    ("PaymentBreakdownNode", "per", Empty::Fallback(Fill::Num(1.0))),
    ("PaymentBreakdownNode", "pv", Empty::Fallback(Fill::Num(0.0))),
    ("PaymentBreakdownNode", "rate", Empty::Fallback(Fill::Num(0.0))),
    ("PaymentBreakdownNode", "start", Empty::Fallback(Fill::Num(1.0))),
    ("PayoffPlannerNode", "extra", Empty::Fallback(Fill::Num(0.0))),
    ("PipeRoughnessNode", "d", Empty::Example("0.1")),
    ("PivotNode", "colFields", Empty::Fallback(Fill::Text(""))),
    ("PivotNode", "filter", Empty::Fallback(Fill::Text(""))),
    ("PivotNode", "rowFields", Empty::Fallback(Fill::Text(""))),
    ("PivotNode", "values", Empty::Fallback(Fill::Text(""))),
    ("ProbNode", "hi", Empty::Fallback(Fill::Num(1.0))),
    ("ProbNode", "lo", Empty::Fallback(Fill::Num(0.0))),
    ("ProportionNode", "options", Empty::Fallback(Fill::Text(""))),
    ("QrCodeNode", "text", Empty::Fallback(Fill::Text(""))),
    ("QuadraticRootsNode", "a", Empty::Fallback(Fill::Num(1.0))),
    ("QuadraticRootsNode", "b", Empty::Fallback(Fill::Num(0.0))),
    ("QuadraticRootsNode", "c", Empty::Fallback(Fill::Num(0.0))),
    ("QuiverNode", "options", Empty::Fallback(Fill::Text(""))),
    ("RandBetweenNode", "bound1", Empty::Fallback(Fill::Num(0.0))),
    ("RandBetweenNode", "bound2", Empty::Fallback(Fill::Num(1.0))),
    ("RankPercentileNode", "value", Empty::Fallback(Fill::Num(0.0))),
    ("ReconcileNode", "key", Empty::Fallback(Fill::Text(""))),
    ("ReconcileNode", "priceColumn", Empty::Fallback(Fill::Text(""))),
    ("ReconcileNode", "qtyColumn", Empty::Fallback(Fill::Text(""))),
    ("RecordNode", "by", Empty::Fallback(Fill::Text(""))),
    ("RecordNode", "layout", Empty::Fallback(Fill::Text(""))),
    ("RecordNode", "options", Empty::Fallback(Fill::Text(""))),
    ("RecordNode", "rows", Empty::Fallback(Fill::Text(""))),
    ("ReduceLambdaNode", "initial", Empty::Fallback(Fill::Num(0.0))),
    ("RegexNode", "pattern", Empty::Fallback(Fill::Text(""))),
    ("RegexNode", "replacement", Empty::Fallback(Fill::Text(""))),
    ("RenameNode", "from", Empty::Fallback(Fill::Text(""))),
    ("RenameNode", "to", Empty::Fallback(Fill::Text(""))),
    ("ReplaceValuesNode", "column", Empty::Fallback(Fill::Text(""))),
    ("ReplaceValuesNode", "find", Empty::Fallback(Fill::Text(""))),
    ("ReplaceValuesNode", "replace", Empty::Fallback(Fill::Text(""))),
    ("ReptNode", "text", Empty::Fallback(Fill::Text(""))),
    ("ReturnsNode", "periods", Empty::Fallback(Fill::Num(1.0))),
    ("ReturnsNode", "rf", Empty::Fallback(Fill::Num(0.0))),
    ("ReverseTextNode", "text", Empty::Fallback(Fill::Text(""))),
    ("RomanArabicNode", "number", Empty::Fallback(Fill::Num(0.0))),
    ("RomanArabicNode", "text", Empty::Fallback(Fill::Text(""))),
    ("RoundNNode", "value", Empty::Fallback(Fill::Num(0.0))),
    ("SankeyNode", "options", Empty::Fallback(Fill::Text(""))),
    ("ScanLambdaNode", "initial", Empty::Fallback(Fill::Num(0.0))),
    ("ScheduleNode", "holidays", Empty::Fallback(Fill::Text(""))),
    ("ScheduleNode", "hours", Empty::Fallback(Fill::Num(8.0))),
    ("ScheduleNode", "weekend_code", Empty::Fallback(Fill::Num(1.0))),
    ("ScriptNode", "x", Empty::Fallback(Fill::Text(""))),
    ("SeriesNode", "cols", Empty::Fallback(Fill::Num(1.0))),
    ("SeriesNode", "count", Empty::Required),
    ("SeriesNode", "end", Empty::Fallback(Fill::Num(1.0))),
    ("SeriesNode", "ratio", Empty::Fallback(Fill::Num(2.0))),
    ("SeriesNode", "start", Empty::Fallback(Fill::Num(1.0))),
    ("SeriesNode", "step", Empty::Fallback(Fill::Num(1.0))),
    ("SeriesNode", "stop", Empty::Behavior("none")),
    ("SeriesNode", "value", Empty::Fallback(Fill::Num(0.0))),
    ("SeriesSumNode", "m", Empty::Fallback(Fill::Num(0.0))),
    ("SeriesSumNode", "n", Empty::Fallback(Fill::Num(0.0))),
    ("SeriesSumNode", "x", Empty::Fallback(Fill::Num(0.0))),
    ("SetCellNode", "col0", Empty::Fallback(Fill::Num(1.0))),
    ("SetCellNode", "row0", Empty::Fallback(Fill::Num(1.0))),
    ("SetCellNode", "value0", Empty::Fallback(Fill::Text(""))),
    ("ShuffleNode", "weights", Empty::Behavior("equal")),
    ("SliderInputNode", "max", Empty::Fallback(Fill::Num(100.0))),
    ("SliderInputNode", "min", Empty::Fallback(Fill::Num(0.0))),
    ("SliderInputNode", "step", Empty::Fallback(Fill::Num(1.0))),
    ("SolarPositionNode", "lat", Empty::Fallback(Fill::Num(0.0))),
    ("SolarPositionNode", "lon", Empty::Fallback(Fill::Num(0.0))),
    ("SortFrameNode", "column", Empty::Fallback(Fill::Text(""))),
    ("SparklineNode", "values", Empty::Fallback(Fill::Num(0.0))),
    ("SpellNumberNode", "value", Empty::Fallback(Fill::Num(0.0))),
    ("SplitColumnNode", "column", Empty::Fallback(Fill::Text(""))),
    ("SplitColumnNode", "delimiter", Empty::Fallback(Fill::Text(""))),
    ("SplitColumnNode", "into", Empty::Fallback(Fill::Text(""))),
    ("StandardizeNode", "mean", Empty::Fallback(Fill::Num(0.0))),
    ("StandardizeNode", "stdev", Empty::Fallback(Fill::Num(1.0))),
    ("StandardizeNode", "value", Empty::Fallback(Fill::Num(0.0))),
    ("SubstituteNode", "new_text", Empty::Fallback(Fill::Text(""))),
    ("SubstituteNode", "old_text", Empty::Fallback(Fill::Text(""))),
    ("SubstituteNode", "text", Empty::Fallback(Fill::Text(""))),
    ("SumIfsNode", "column0", Empty::Fallback(Fill::Text(""))),
    ("SumIfsNode", "value0", Empty::Fallback(Fill::Text(""))),
    ("SumIfsNode", "values", Empty::Fallback(Fill::Text(""))),
    ("SunriseSunsetNode", "lat", Empty::Fallback(Fill::Num(0.0))),
    ("SunriseSunsetNode", "lon", Empty::Fallback(Fill::Num(0.0))),
    ("SurfaceNode", "levels", Empty::Fallback(Fill::Num(8.0))),
    ("SurfaceNode", "options", Empty::Fallback(Fill::Text(""))),
    ("SurfaceNode", "xs", Empty::Fallback(Fill::Text(""))),
    ("SurfaceNode", "ys", Empty::Fallback(Fill::Text(""))),
    ("SwitchNode", "default", Empty::Fallback(Fill::Text(""))),
    ("SwitchNode", "expr", Empty::Example("Value")),
    ("SwitchNode", "then0", Empty::Fallback(Fill::Text(""))),
    ("SwitchNode", "then1", Empty::Fallback(Fill::Text(""))),
    ("SwitchNode", "then2", Empty::Fallback(Fill::Text(""))),
    ("SwitchNode", "when0", Empty::Fallback(Fill::Text(""))),
    ("SwitchNode", "when1", Empty::Fallback(Fill::Text(""))),
    ("SwitchNode", "when2", Empty::Fallback(Fill::Text(""))),
    ("TemplateNode", "template", Empty::Fallback(Fill::Text(""))),
    ("TextAfterBeforeNode", "delimiter", Empty::Fallback(Fill::Text(""))),
    ("TextAfterBeforeNode", "text", Empty::Fallback(Fill::Text(""))),
    ("TextFindNode", "haystack", Empty::Fallback(Fill::Text(""))),
    ("TextFindNode", "needle", Empty::Fallback(Fill::Text(""))),
    ("TextJoinNode", "strings", Empty::Fallback(Fill::Text(""))),
    ("TextLenNode", "text", Empty::Fallback(Fill::Text(""))),
    ("TextReplaceNode", "new_text", Empty::Fallback(Fill::Text(""))),
    ("TextReplaceNode", "text", Empty::Fallback(Fill::Text(""))),
    ("TextSimilarityNode", "a", Empty::Fallback(Fill::Text(""))),
    ("TextSimilarityNode", "b", Empty::Fallback(Fill::Text(""))),
    ("TextSliceNode", "text", Empty::Fallback(Fill::Text(""))),
    ("TextSplitNode", "text", Empty::Fallback(Fill::Text(""))),
    ("TextTransformNode", "text", Empty::Fallback(Fill::Text(""))),
    ("TimeConstructNode", "hour", Empty::Fallback(Fill::Num(0.0))),
    ("TimeConstructNode", "minute", Empty::Fallback(Fill::Num(0.0))),
    ("TimeConstructNode", "second", Empty::Fallback(Fill::Num(0.0))),
    ("TimeZoneConvertNode", "from", Empty::Fallback(Fill::Text(""))),
    ("TimeZoneConvertNode", "to", Empty::Fallback(Fill::Text(""))),
    ("TornadoNode", "value", Empty::Fallback(Fill::Num(0.0))),
    ("TruncateTextNode", "text", Empty::Fallback(Fill::Text(""))),
    ("TwoInputMathNode", "a", Empty::Fallback(Fill::Num(0.0))),
    ("TwoInputMathNode", "b", Empty::Fallback(Fill::Num(0.0))),
    ("UnitCircleNode", "angle", Empty::Fallback(Fill::Num(0.0))),
    ("UnnestNode", "column", Empty::Fallback(Fill::Text(""))),
    ("UnpivotNode", "idColumns", Empty::Fallback(Fill::Text(""))),
    ("UnpivotNode", "valueColumns", Empty::Fallback(Fill::Text(""))),
    ("UrlEncodeNode", "text", Empty::Fallback(Fill::Text(""))),
    ("VaultFolderNode", "folder", Empty::Fallback(Fill::Text(""))),
    ("VaultFolderNode", "glob", Empty::Fallback(Fill::Text(""))),
    ("WaterfallNode", "options", Empty::Fallback(Fill::Text(""))),
    ("WeatherNode", "lat", Empty::Fallback(Fill::Num(0.0))),
    ("WeatherNode", "lon", Empty::Fallback(Fill::Num(0.0))),
    ("WindowNode", "column", Empty::Fallback(Fill::Text(""))),
    ("WindowNode", "keys", Empty::Fallback(Fill::Text(""))),
    ("WindowNode", "name", Empty::Fallback(Fill::Text(""))),
    ("WindowNode", "orderBy", Empty::Fallback(Fill::Text(""))),
    ("WorkdaysNode", "days", Empty::Fallback(Fill::Num(5.0))),
    ("WorkdaysNode", "holidays", Empty::Fallback(Fill::Text(""))),
    ("WorldClockNode", "zones", Empty::Fallback(Fill::Text(""))),
    ("WrapTextNode", "text", Empty::Fallback(Fill::Text(""))),
    ("WriteObsidianNode", "keys", Empty::Behavior("all")),
    ("WriteObsidianNode", "path", Empty::Fallback(Fill::Text(""))),
    ("WriteTasksNode", "keys", Empty::Behavior("all")),
    ("XLookupNode", "ifNotFound", Empty::Fallback(Fill::Text(""))),
    ("XLookupNode", "inColumn", Empty::Fallback(Fill::Text(""))),
    ("XLookupNode", "inRow", Empty::Behavior("names")),
    ("XLookupNode", "lookup", Empty::Fallback(Fill::Text(""))),
    ("XLookupNode", "returnColumn", Empty::Behavior("all")),
    ("XLookupNode", "returnRow", Empty::Behavior("all")),
    ("XMatchNode", "value", Empty::Fallback(Fill::Text(""))),
];

/// Fields whose kind depends on the card's op: `(card, op, key, kind)`, ahead of `EMPTY`.
const EMPTY_BY_OP: &[(&str, &str, &str, Empty)] = &[
    // J₀(0) and I₀(0) are answers, so an empty x is 0 there; K and Y have none at 0 and keep 1.
    ("BesselNode", "besseli", "x", Empty::Fallback(Fill::Num(0.0))),
    ("BesselNode", "besselj", "x", Empty::Fallback(Fill::Num(0.0))),
    ("MRoundNode", "down", "multiple", Empty::Fallback(Fill::Num(1.0))),
    ("MRoundNode", "up", "multiple", Empty::Fallback(Fill::Num(1.0))),
    ("TakeDropNode", "drop", "cols", Empty::Behavior("none")),
    ("TakeDropNode", "drop", "rows", Empty::Behavior("none")),
    ("TwoInputMathNode", "log", "b", Empty::Fallback(Fill::Num(10.0))),
];

/// The solver cards: an empty field is the unknown they solve for.
const SOLVERS: &[&str] = &["EquationNode", "TvmNode"];

/// A `class` card's declared kind for its empty field `key` under `op`, where it declares one.
pub fn empty_of(class: &str, op: &str, key: &str) -> Option<Empty> {
    if SOLVERS.contains(&class) {
        return Some(Empty::Behavior("solve"));
    }
    // An exact key wins over a numbered row of a shorter one (`df1` is its own field, not row 1 of `df`).
    let by_op = |exact: bool| {
        EMPTY_BY_OP
            .iter()
            .find(|(c, o, row, _)| *c == class && *o == op && if exact { key == *row } else { is_row(key, row) })
    };
    if let Some(&(_, _, _, e)) = by_op(true).or_else(|| by_op(false)) {
        return Some(e);
    }
    let plain = |exact: bool| {
        EMPTY.iter().find(|(c, row, _)| *c == class && if exact { key == *row } else { is_row(key, row) })
    };
    plain(true).or_else(|| plain(false)).map(|&(_, _, e)| e)
}

impl Empty {
    /// The kind's name and what the field shows: `None` for a Fallback of empty text and for Required.
    pub fn shown(self) -> (&'static str, Option<String>) {
        match self {
            Empty::Fallback(Fill::Num(n)) => ("fallback", Some(crate::jsnum::number_to_string(n))),
            Empty::Fallback(Fill::Bool(b)) => ("fallback", Some(if b { "TRUE" } else { "FALSE" }.into())),
            Empty::Fallback(Fill::Text(t)) => ("fallback", (!t.is_empty()).then(|| t.to_string())),
            Empty::Behavior(w) => ("behavior", Some(format!("[{w}]"))),
            Empty::Example(h) => ("example", Some(h.to_string())),
            Empty::Required => ("required", None),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Field {
    /// The number field; `literals`.
    Number,
    /// The TRUE/FALSE checkbox; `literals` as 1 or 0.
    Logical,
    /// The text field or a column picker; `stringLiterals`, kept as keyed.
    Text,
    /// A list keyed as comma-separated text; `stringLiterals`, parsed by its rung at the boundary (a typed list) or by
    /// the body (`Call::csv_text`).
    Csv,
    /// A wildcard slot's keyed text and its kind; `stringLiterals` and `literalKinds`.
    Keyed,
    /// A range bound, which takes the checked value's kind: the number field on a number rung (`literals`), a date's
    /// text on a date rung (`stringLiterals`). Each kind keeps its own value, so a card moving between the two keeps
    /// both, and reads only the one its rung shows.
    Bound,
    /// Wire-only.
    None,
}

impl Field {
    pub fn name(self) -> &'static str {
        match self {
            Field::Number => "number",
            Field::Logical => "logical",
            Field::Text => "text",
            Field::Csv => "csv",
            Field::Keyed => "keyed",
            Field::Bound => "bound",
            Field::None => "none",
        }
    }
}

pub fn is_wildcard(rung: &str) -> bool {
    matches!(rung, "any" | "anycombo" | "anydata" | "trueany")
}

/// `key` is `row`, or `row` and a number.
fn is_row(key: &str, row: &str) -> bool {
    key.strip_prefix(row).is_some_and(|n| n.is_empty() || n.bytes().all(|b| b.is_ascii_digit()))
}

/// The field a `class` card's unwired input `key` on `rung` shows. `kept_as_text`: the card keeps this input's value
/// as text (its key is in `stringLiterals`), which makes a number list a typed list.
pub fn field_of(class: &str, key: &str, rung: &str, kept_as_text: bool) -> Field {
    if let Some(&(_, _, field)) = ROWS.iter().find(|(c, row, _)| *c == class && is_row(key, row)) {
        return field;
    }
    if is_wildcard(rung) || rung == "anylist" {
        return if NUMBER_VARIABLES.contains(&class) {
            Field::Number
        } else if rung == "anylist" {
            Field::None
        } else if KEYED.contains(&class) {
            Field::Keyed
        } else if TEXT.contains(&class) {
            Field::Text
        } else {
            Field::None
        };
    }
    match rung {
        "number" => Field::Number,
        "numlist" if kept_as_text || OWNS_LISTS.contains(&class) => Field::Csv,
        "numlist" => Field::Number,
        "logical" | "logicalcombo" => Field::Logical,
        "string" | "strcombo" => Field::Text,
        "strlist" | "datelist" | "logicallist" => Field::Csv,
        _ => Field::None,
    }
}

/// A card's saved values, `literals` and `stringLiterals`. Their maps are private to this module, so a body reads an
/// input only through the field the card shows for it (`Call::unwired`), never around it.
#[derive(Clone, Default)]
pub struct Saved {
    numbers: Rc<Map<String, Json>>,
    texts: Rc<Map<String, Json>>,
}

impl Saved {
    pub fn new(numbers: Map<String, Json>, texts: Map<String, Json>) -> Saved {
        Saved { numbers: Rc::new(numbers), texts: Rc::new(texts) }
    }

    fn number(&self, key: &str) -> V {
        self.numbers.get(key).map(decode).unwrap_or(V::Undef)
    }

    fn text(&self, key: &str) -> V {
        self.texts.get(key).map(decode).unwrap_or(V::Undef)
    }

    fn raw_text(&self, key: &str) -> Option<&str> {
        self.texts.get(key).and_then(Json::as_str)
    }
}

impl Call {
    /// The field `key`'s unwired value lives in ([[C28]] literalsIffEditable).
    pub fn literal_field(&self, key: &str) -> Field {
        field_of(&self.class, key, self.rung(key), self.saved.texts.contains_key(key))
    }

    /// An unwired input's value, read from the one field the card shows for it: a number, a logical (TRUE or FALSE),
    /// text as keyed, a keyed value as its kind, or a bound as its rung's kind (a date's text on a date rung);
    /// `undefined` where nothing is set or the input is wire-only. A typed list arrives through the boundary as if
    /// wired, so it reads `undefined` here.
    ///
    /// A key with no socket is the card's own saved field kept in the literal maps (a setting a mode's input takes
    /// over, a widget's state): its number, else its text, as saved.
    pub fn unwired(&self, key: &str) -> V {
        if !self.sockets.iter().any(|s| s.key == key) {
            return match self.saved.number(key) {
                V::Undef | V::Null => self.saved.text(key),
                v => v,
            };
        }
        let v = self.field_value(key);
        let empty = matches!(v, V::Undef) || matches!(&v, V::Str(t) if t.is_empty());
        match (empty, empty_of(&self.class, self.field_str("op", ""), key)) {
            (true, Some(Empty::Fallback(Fill::Num(n)))) => V::Num(n),
            (true, Some(Empty::Fallback(Fill::Bool(b)))) => V::Bool(b),
            (true, Some(Empty::Fallback(Fill::Text(t)))) if !t.is_empty() => V::str(t),
            (true, Some(Empty::Required)) => {
                err(ErrorCode::Syntax, format!("{} is empty, and it has no default", self.label(key)))
            }
            _ => v,
        }
    }

    /// What the field holds, before its empty kind applies.
    fn field_value(&self, key: &str) -> V {
        match self.literal_field(key) {
            Field::Number => match self.saved.number(key) {
                V::Num(n) => V::Num(n),
                _ => V::Undef,
            },
            Field::Logical => match self.saved.number(key) {
                V::Num(n) if n.is_nan() => V::Null,
                V::Num(n) => V::Bool(n != 0.0),
                V::Bool(b) => V::Bool(b),
                _ => V::Undef,
            },
            Field::Bound if self.rung(key) != "date" => match self.saved.number(key) {
                V::Num(n) => V::Num(n),
                _ => V::Undef,
            },
            Field::Text | Field::Bound => match self.saved.text(key) {
                V::Str(s) => V::Str(s),
                _ => V::Undef,
            },
            Field::Keyed => self.keyed(key),
            Field::Csv | Field::None => V::Undef,
        }
    }

    /// A list field's text as keyed, for a body that splits it itself (a list on a rung the boundary doesn't parse);
    /// `None` where the input's field isn't a list or nothing is keyed.
    pub fn csv_text(&self, key: &str) -> Option<&str> {
        if self.literal_field(key) != Field::Csv {
            return None;
        }
        self.saved.raw_text(key)
    }

    /// A wildcard slot's keyed text, read as its kind the way a Frame Input cell of that type reads it ([[C58]]
    /// tableInputRawText); `undefined` where nothing is keyed. A body reads the slot through `unwired`, which applies
    /// its empty kind.
    pub(super) fn keyed(&self, key: &str) -> V {
        match self.saved.raw_text(key) {
            Some(text) => super::list::keyed_value(self.keyed_kind(key), text),
            None => V::Undef,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_input_has_one_field_per_card() {
        assert_eq!(field_of("IfsNode", "v0", "trueany", false), Field::Keyed);
        assert_eq!(field_of("IfsNode", "c0", "logical", false), Field::Logical);
        assert_eq!(field_of("DisplayNode", "in", "trueany", false), Field::None);
        assert_eq!(field_of("ReplaceValuesNode", "find", "any", false), Field::Text);
        assert_eq!(field_of("SumNode", "a", "numlist", false), Field::Number);
        assert_eq!(field_of("SumNode", "a", "numlist", true), Field::Csv);
        assert_eq!(field_of("ExpectNode", "min", "date", false), Field::Bound);
        assert_eq!(field_of("ExpectNode", "max", "number", true), Field::Bound);
        assert_eq!(field_of("DateAddNode", "start", "date", false), Field::None);
        assert_eq!(field_of("FilterFrameNode", "value12", "any", true), Field::Text);
        assert_eq!(field_of("FilterFrameNode", "frame", "anydata", false), Field::None);
        assert_eq!(field_of("FilterNode", "values", "any", false), Field::None);
        assert_eq!(field_of("ExpressionNode", "rate", "anydata", false), Field::Number);
        assert_eq!(field_of("LambdaNode", "rate", "anylist", false), Field::Number);
        assert_eq!(field_of("ContainsNode", "list", "anylist", false), Field::None);
    }

    #[test]
    fn a_behavior_is_never_a_value() {
        let kinds = EMPTY.iter().map(|&(_, _, e)| e).chain(EMPTY_BY_OP.iter().map(|&(_, _, _, e)| e));
        for e in kinds {
            if let Empty::Behavior(w) = e {
                assert!(w.parse::<f64>().is_err() && !["TRUE", "FALSE"].contains(&w), "a value as a Behavior: {w}");
            }
        }
    }

    #[test]
    fn an_empty_field_declares_its_kind() {
        assert_eq!(empty_of("MolarMassNode", "", "formula").map(Empty::shown), Some(("example", Some("H2O".into()))));
        assert_eq!(
            empty_of("XLookupNode", "", "returnColumn").map(Empty::shown),
            Some(("behavior", Some("[all]".into())))
        );
        assert_eq!(empty_of("DollarNode", "", "dollar").map(Empty::shown), Some(("fallback", Some("0".into()))));
        assert_eq!(Empty::Fallback(Fill::Text("")).shown(), ("fallback", None));
        assert_eq!(Empty::Fallback(Fill::Bool(false)).shown(), ("fallback", Some("FALSE".into())));
        assert_eq!(Empty::Required.shown(), ("required", None));
        assert_eq!(empty_of("RoundNNode", "round", "value"), Some(Empty::Fallback(Fill::Num(0.0))));
        assert_eq!(empty_of("TvmNode", "", "fv"), Some(Empty::Behavior("solve")));
        assert_eq!(empty_of("NoSuchNode", "", "x"), None);
        assert_eq!(empty_of("DistributionsNode", "f", "df1"), Some(Empty::Fallback(Fill::Num(5.0))));
        assert_eq!(empty_of("TwoInputMathNode", "log", "b"), Some(Empty::Fallback(Fill::Num(10.0))));
        assert_eq!(empty_of("TwoInputMathNode", "atan2", "b"), Some(Empty::Fallback(Fill::Num(0.0))));
    }
}
