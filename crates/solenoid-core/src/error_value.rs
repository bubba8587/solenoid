// [[C130]] rustCore
//! Solenoid's error values, the parts the core uses.

use std::rc::Rc;

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
    /// A Formula.js `Error` by its message, which flows as a value until it is read as a SolError.
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

#[derive(Clone, Debug)]
pub struct SolError {
    pub code: ErrorCode,
    pub message: String,
    /// The JS side's reference to the uploaded original, handed back so it downloads as itself.
    pub reference: Option<u32>,
    /// The node the error started at ([[E9]] errorsKeepOrigin), which the graph's boundary sets and nothing overwrites.
    pub origin: Option<Rc<Origin>>,
}

/// An error's origin: the node's id and display name, and the input that carried it to a node that answered for it.
#[derive(Clone, Debug, PartialEq)]
pub struct Origin {
    pub node_id: String,
    pub node_name: String,
    pub input_slot: Option<String>,
}

/// Two errors are the same answer whatever node they started at.
impl PartialEq for SolError {
    fn eq(&self, other: &Self) -> bool {
        self.code == other.code && self.message == other.message && self.reference == other.reference
    }
}

impl Origin {
    /// `{nodeId, nodeName, inputSlot?}`, as the TS error carries it.
    pub fn to_json(&self) -> serde_json::Value {
        let mut o = serde_json::Map::new();
        o.insert("nodeId".into(), self.node_id.clone().into());
        o.insert("nodeName".into(), self.node_name.clone().into());
        if let Some(slot) = &self.input_slot {
            o.insert("inputSlot".into(), slot.clone().into());
        }
        serde_json::Value::Object(o)
    }

    pub fn from_json(j: &serde_json::Value) -> Option<Origin> {
        let text = |k: &str| j.get(k).and_then(serde_json::Value::as_str).map(String::from);
        Some(Origin {
            node_id: text("nodeId")?,
            node_name: text("nodeName").unwrap_or_default(),
            input_slot: text("inputSlot"),
        })
    }
}

pub fn sol_error(code: ErrorCode, message: impl Into<String>) -> SolError {
    SolError { code, message: message.into(), reference: None, origin: None }
}
