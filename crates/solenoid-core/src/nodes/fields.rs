// [[C28]] literalsIffEditable, [[C10]] socketLattice, [[D96]] emptySlotShowsItsValue
//! The one field an unwired input shows, by its card, its key and its declared rung: the canvas draws it
//! (`literalFieldOf` asks here over wasm), a body reads the input through it (`Call::unwired`), and a load drops what
//! it doesn't read (`pruneLiterals`). One rule, so a value can't sit in a map the card doesn't show
//! (`tree/specs/documents/inline-literal-maps.md` § One field per input).

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
    ("AlertNode", "value", Empty::Example("50")),
    ("AllocatorNode", "amount", Empty::Fallback(Fill::Num(0.0))),
    ("AmortizationNode", "fv", Empty::Fallback(Fill::Num(0.0))),
    ("AmortizationNode", "nper", Empty::Fallback(Fill::Num(0.0))),
    ("AmortizationNode", "pv", Empty::Fallback(Fill::Num(0.0))),
    ("AmortizationNode", "rate", Empty::Fallback(Fill::Num(0.0))),
    ("AntoineNode", "t", Empty::Example("25")),
    ("AwgNode", "gauge", Empty::Example("12")),
    ("BaseConvertNode", "value", Empty::Fallback(Fill::Num(0.0))),
    ("BesselNode", "x", Empty::Fallback(Fill::Num(1.0))),
    ("BinNode", "n", Empty::Fallback(Fill::Num(4.0))),
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
    ("CastNode", "decimal_sep", Empty::Fallback(Fill::Text("."))),
    // No group separator when the decimal one is a comma, else a comma.
    ("CastNode", "group_sep", Empty::Behavior("auto")),
    ("CharCodeNode", "code", Empty::Fallback(Fill::Num(65.0))),
    ("ChoiceLadderNode", "close", Empty::Fallback(Fill::Num(0.05))),
    ("ColebrookNode", "re", Empty::Example("100000")),
    ("ColebrookNode", "rr", Empty::Example("0.0001")),
    ("CombinatoricsNode", "k", Empty::Fallback(Fill::Num(0.0))),
    ("CombinatoricsNode", "n", Empty::Fallback(Fill::Num(0.0))),
    ("ComplexFromNode", "im", Empty::Fallback(Fill::Num(0.0))),
    ("ComplexFromNode", "re", Empty::Fallback(Fill::Num(0.0))),
    ("ComplexPowerNode", "n", Empty::Fallback(Fill::Num(2.0))),
    ("ConfidenceNode", "alpha", Empty::Fallback(Fill::Num(0.05))),
    ("ConfidenceNode", "n", Empty::Fallback(Fill::Num(30.0))),
    ("ConfidenceNode", "stdev", Empty::Fallback(Fill::Num(1.0))),
    ("DateAddNode", "months", Empty::Fallback(Fill::Num(0.0))),
    ("DateConstructNode", "day", Empty::Fallback(Fill::Num(1.0))),
    ("DateConstructNode", "month", Empty::Fallback(Fill::Num(1.0))),
    ("DateConstructNode", "year", Empty::Fallback(Fill::Num(2024.0))),
    ("DepreciationNode", "end", Empty::Fallback(Fill::Num(0.0))),
    ("DepreciationNode", "month", Empty::Fallback(Fill::Num(12.0))),
    ("DepreciationNode", "start", Empty::Fallback(Fill::Num(0.0))),
    ("DistributionsNode", "count", Empty::Fallback(Fill::Num(100.0))),
    ("DollarNode", "dollar", Empty::Fallback(Fill::Num(0.0))),
    ("DollarNode", "fraction", Empty::Fallback(Fill::Num(32.0))),
    ("DurationNode", "coupon", Empty::Fallback(Fill::Num(0.08))),
    ("DurationNode", "yld", Empty::Fallback(Fill::Num(0.09))),
    ("ESeriesNode", "value", Empty::Example("4600")),
    ("EarnedValueNode", "weekend_code", Empty::Fallback(Fill::Num(1.0))),
    ("EmSpectrumNode", "freq", Empty::Example("5e14")),
    ("EpochNode", "value", Empty::Fallback(Fill::Num(0.0))),
    ("ExpectNode", "max", Empty::Fallback(Fill::Num(100.0))),
    ("ExpectNode", "min", Empty::Fallback(Fill::Num(0.0))),
    ("FillNode", "value", Empty::Fallback(Fill::Num(0.0))),
    ("FixedNode", "number", Empty::Fallback(Fill::Num(0.0))),
    ("FormatDollarNode", "number", Empty::Fallback(Fill::Num(0.0))),
    ("FvScheduleNode", "pv", Empty::Fallback(Fill::Num(1000.0))),
    ("GanttNode", "weekend_code", Empty::Fallback(Fill::Num(1.0))),
    ("HrZonesNode", "age", Empty::Example("30")),
    ("HypothesisTestNode", "k", Empty::Fallback(Fill::Num(0.0))),
    ("HypothesisTestNode", "n", Empty::Fallback(Fill::Num(1.0))),
    ("HypothesisTestNode", "n1", Empty::Fallback(Fill::Num(1.0))),
    ("HypothesisTestNode", "n2", Empty::Fallback(Fill::Num(1.0))),
    ("HypothesisTestNode", "p0", Empty::Fallback(Fill::Num(0.5))),
    ("HypothesisTestNode", "x", Empty::Fallback(Fill::Num(0.0))),
    ("HypothesisTestNode", "x1", Empty::Fallback(Fill::Num(0.0))),
    ("HypothesisTestNode", "x2", Empty::Fallback(Fill::Num(0.0))),
    ("IspmtNode", "nper", Empty::Fallback(Fill::Num(0.0))),
    ("IspmtNode", "per", Empty::Fallback(Fill::Num(1.0))),
    ("IspmtNode", "pv", Empty::Fallback(Fill::Num(0.0))),
    ("IspmtNode", "rate", Empty::Fallback(Fill::Num(0.0))),
    ("MakeArrayNode", "cols", Empty::Fallback(Fill::Num(0.0))),
    ("MakeArrayNode", "rows", Empty::Fallback(Fill::Num(0.0))),
    ("MirrNode", "finrate", Empty::Fallback(Fill::Num(0.1))),
    ("MirrNode", "reinrate", Empty::Fallback(Fill::Num(0.12))),
    ("MolarMassNode", "formula", Empty::Example("H2O")),
    ("NPVNode", "rate", Empty::Fallback(Fill::Num(0.1))),
    ("NotNode", "in", Empty::Fallback(Fill::Num(0.0))),
    ("OdeIntegrateNode", "t0", Empty::Fallback(Fill::Num(0.0))),
    ("OdeIntegrateNode", "t1", Empty::Fallback(Fill::Num(1.0))),
    ("OdeIntegrateNode", "y0", Empty::Fallback(Fill::Num(1.0))),
    // 3 for a z-score, 1.5 for IQR fences, 3.5 for a MAD score.
    ("OutliersNode", "threshold", Empty::Behavior("by method")),
    ("PadNode", "fill", Empty::Fallback(Fill::Num(0.0))),
    ("PaymentBreakdownNode", "end", Empty::Fallback(Fill::Num(1.0))),
    ("PaymentBreakdownNode", "fv", Empty::Fallback(Fill::Num(0.0))),
    ("PaymentBreakdownNode", "nper", Empty::Fallback(Fill::Num(0.0))),
    ("PaymentBreakdownNode", "per", Empty::Fallback(Fill::Num(1.0))),
    ("PaymentBreakdownNode", "pv", Empty::Fallback(Fill::Num(0.0))),
    ("PaymentBreakdownNode", "rate", Empty::Fallback(Fill::Num(0.0))),
    ("PaymentBreakdownNode", "start", Empty::Fallback(Fill::Num(1.0))),
    ("PayoffPlannerNode", "extra", Empty::Fallback(Fill::Num(0.0))),
    ("ProbNode", "hi", Empty::Fallback(Fill::Num(1.0))),
    ("ProbNode", "lo", Empty::Fallback(Fill::Num(0.0))),
    ("RandBetweenNode", "bound1", Empty::Fallback(Fill::Num(0.0))),
    ("RandBetweenNode", "bound2", Empty::Fallback(Fill::Num(1.0))),
    ("ReduceLambdaNode", "initial", Empty::Fallback(Fill::Num(0.0))),
    ("ReturnsNode", "periods", Empty::Fallback(Fill::Num(1.0))),
    ("ReturnsNode", "rf", Empty::Fallback(Fill::Num(0.0))),
    ("RomanArabicNode", "number", Empty::Fallback(Fill::Num(1.0))),
    ("ScanLambdaNode", "initial", Empty::Fallback(Fill::Num(0.0))),
    ("ScheduleNode", "hours", Empty::Fallback(Fill::Num(8.0))),
    ("ScheduleNode", "weekend_code", Empty::Fallback(Fill::Num(1.0))),
    ("SeriesNode", "end", Empty::Fallback(Fill::Num(1.0))),
    ("SeriesNode", "ratio", Empty::Fallback(Fill::Num(2.0))),
    ("SeriesNode", "value", Empty::Fallback(Fill::Num(0.0))),
    ("SeriesSumNode", "m", Empty::Fallback(Fill::Num(1.0))),
    ("SeriesSumNode", "n", Empty::Fallback(Fill::Num(0.0))),
    ("SeriesSumNode", "x", Empty::Fallback(Fill::Num(1.0))),
    ("SwitchNode", "expr", Empty::Example("Value")),
    ("TimeConstructNode", "hour", Empty::Fallback(Fill::Num(0.0))),
    ("TimeConstructNode", "minute", Empty::Fallback(Fill::Num(0.0))),
    ("TimeConstructNode", "second", Empty::Fallback(Fill::Num(0.0))),
    ("WorkdaysNode", "days", Empty::Fallback(Fill::Num(5.0))),
    ("WriteObsidianNode", "keys", Empty::Behavior("all")),
    ("WriteTasksNode", "keys", Empty::Behavior("all")),
    ("XLookupNode", "inRow", Empty::Behavior("names")),
    ("XLookupNode", "returnColumn", Empty::Behavior("all")),
    ("XLookupNode", "returnRow", Empty::Behavior("all")),
];

/// A `class` card's declared kind for its empty field `key`, where it declares one.
pub fn empty_of(class: &str, key: &str) -> Option<Empty> {
    EMPTY.iter().find(|(c, row, _)| *c == class && is_row(key, row)).map(|&(_, _, e)| e)
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
        match (empty, empty_of(&self.class, key)) {
            (true, Some(Empty::Fallback(Fill::Num(n)))) => V::Num(n),
            (true, Some(Empty::Fallback(Fill::Bool(b)))) => V::Bool(b),
            (true, Some(Empty::Fallback(Fill::Text(t)))) => V::str(t),
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
    /// tableInputRawText); `undefined` where nothing is keyed.
    pub fn keyed(&self, key: &str) -> V {
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
    fn an_empty_field_declares_its_kind() {
        assert_eq!(empty_of("MolarMassNode", "formula").map(Empty::shown), Some(("example", Some("H2O".into()))));
        assert_eq!(empty_of("XLookupNode", "returnColumn").map(Empty::shown), Some(("behavior", Some("[all]".into()))));
        assert_eq!(empty_of("DollarNode", "dollar").map(Empty::shown), Some(("fallback", Some("0".into()))));
        assert_eq!(Empty::Fallback(Fill::Text("")).shown(), ("fallback", None));
        assert_eq!(Empty::Fallback(Fill::Bool(false)).shown(), ("fallback", Some("FALSE".into())));
        assert_eq!(Empty::Required.shown(), ("required", None));
        assert_eq!(empty_of("RoundNNode", "value"), None);
    }
}
