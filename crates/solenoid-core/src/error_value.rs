// [[C130]] rustCore
//! Solenoid's error values, the parts the core uses.

use crate::spelled::spelled;

spelled! {
    /// Solenoid's error codes.
    pub enum ErrorCode {
        DivZero = "#DIV/0!",
        NotAvailable = "#N/A",
        Domain = "#DOMAIN!",
        Conv = "#CONV!",
        Overflow = "#OVERFLOW!",
        Syntax = "#SYNTAX!",
        Value = "#VALUE!",
        Type = "#TYPE!",
        Shape = "#SHAPE!",
        Unit = "#UNIT!",
        Name = "#NAME?",
        Ref = "#REF!",
        Circ = "#CIRC!",
        Solve = "#SOLVE!",
        Ambiguous = "#AMBIGUOUS!",
        Error = "#ERROR!",
    }
}

spelled! {
    /// A Formula.js `Error` by its message, which flows as a value until `normalizeFxResult` reads it as a SolError.
    pub enum FxError {
        Value = "#VALUE!",
        Ref = "#REF!",
        DivZero = "#DIV/0!",
        Num = "#NUM!",
        Name = "#NAME?",
        Null = "#NULL!",
        NotAvailable = "#N/A",
        Error = "#ERROR!",
    }
}

impl ErrorCode {
    /// A code read off the wire. The TS sends only its own codes; anything else reads as `#ERROR!`.
    pub fn from_wire(code: &str) -> ErrorCode {
        code.parse().unwrap_or(ErrorCode::Error)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct SolError {
    pub code: ErrorCode,
    pub message: String,
    /// The JS side's reference to the uploaded original, handed back so it downloads as itself.
    pub reference: Option<u32>,
}

pub fn sol_error(code: ErrorCode, message: impl Into<String>) -> SolError {
    SolError { code, message: message.into(), reference: None }
}
