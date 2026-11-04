// [[C28]] literalsIffEditable, [[C10]] socketLattice
//! The one field an unwired input shows, by its card and its declared rung: the canvas draws it (`literalFieldOf`
//! asks here over wasm), a body reads the input through it (`Call::unwired`), and a load drops what it doesn't read
//! (`pruneLiterals`). One rule, so a value can't sit in a map the card doesn't show
//! (`tree/specs/documents/inline-literal-maps.md` § One field per input).

/// The cards whose wildcard slots take a keyed value read as the kind its button shows.
const KEYED: &[&str] = &[
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
/// The cards whose date slots take a date keyed as text (Expect's bounds, [[D120]] rangeBoundsTakeTheValuesKind).
const DATE: &[&str] = &["ExpectNode"];
/// The cards that keep their list rows as text themselves (List Input).
const OWNS_LISTS: &[&str] = &["ListInputNode"];

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Field {
    /// The number field; `literals`.
    Number,
    /// The TRUE/FALSE checkbox; `literals` as 1 or 0.
    Logical,
    /// The text field or a column picker; `stringLiterals`, kept as keyed.
    Text,
    /// A list keyed as comma-separated text; `stringLiterals`, parsed by its rung at the boundary.
    Csv,
    /// A wildcard slot's keyed text and its kind; `stringLiterals` and `literalKinds`.
    Keyed,
    /// A date keyed as text; `stringLiterals`.
    Date,
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
            Field::None => "none",
        }
    }
}

pub fn is_wildcard(rung: &str) -> bool {
    matches!(rung, "any" | "anycombo" | "anydata" | "trueany")
}

/// The field a `class` card's unwired input on `rung` shows. `kept_as_text`: the card keeps this input's value as text
/// (its key is in `stringLiterals`), which makes a number list a typed list.
pub fn field_of(class: &str, rung: &str, kept_as_text: bool) -> Field {
    if is_wildcard(rung) {
        return if KEYED.contains(&class) {
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
        "date" if DATE.contains(&class) => Field::Date,
        _ => Field::None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_rung_has_one_field_per_card() {
        assert_eq!(field_of("IfsNode", "trueany", false), Field::Keyed);
        assert_eq!(field_of("IfsNode", "logical", false), Field::Logical);
        assert_eq!(field_of("DisplayNode", "trueany", false), Field::None);
        assert_eq!(field_of("ReplaceValuesNode", "any", false), Field::Text);
        assert_eq!(field_of("SumNode", "numlist", false), Field::Number);
        assert_eq!(field_of("SumNode", "numlist", true), Field::Csv);
        assert_eq!(field_of("ExpectNode", "date", false), Field::Date);
        assert_eq!(field_of("DateAddNode", "date", false), Field::None);
    }
}
