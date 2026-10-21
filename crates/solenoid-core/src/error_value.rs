// [[C16]] polarsEngine
//! Port of `src/graph/errorValue.ts` (the parts the frame verbs use).

#[derive(Clone, Debug, PartialEq)]
pub struct SolError {
    pub code: String,
    pub message: String,
    /// The JS side's reference to the uploaded original, handed back so it downloads as itself.
    pub reference: Option<u32>,
}

pub fn sol_error(code: &str, message: impl Into<String>) -> SolError {
    SolError { code: code.to_string(), message: message.into(), reference: None }
}
