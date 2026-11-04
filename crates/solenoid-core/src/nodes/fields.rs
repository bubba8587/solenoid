// [[C28]] literalsIffEditable, [[C10]] socketLattice
//! The one field an unwired input shows, by its card, its key and its declared rung: the canvas draws it
//! (`literalFieldOf` asks here over wasm), a body reads the input through it (`Call::unwired`), and a load drops what
//! it doesn't read (`pruneLiterals`). One rule, so a value can't sit in a map the card doesn't show
//! (`tree/specs/documents/inline-literal-maps.md` § One field per input).

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
    /// A date keyed as text; `stringLiterals`.
    Date,
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
            Field::Date => "date",
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
}
