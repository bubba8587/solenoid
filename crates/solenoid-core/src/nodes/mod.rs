//! [[D102]] graphOnCore, [[D99]] rustIsSpec: the cards' bodies, each class's `data()`, on the core. A card keeps its
//! TypeScript class (its sockets, its saved fields, its component); its body is one `engine_node` call that names the
//! class and carries what a save holds, the socket types and the inputs as arrival coercion left them. The answer is
//! the outputs, or the error the body threw, beside the fields the body sets on the card for its component.
//! `tree/specs/computation/node-bodies.md` is the mechanism; `fixtures/core/nodes/` the answers each body is held to.

use crate::error_value::sol_error;
use crate::excel_functions::V;
use serde_json::{Map, Value as Json};
use std::rc::Rc;

mod complex;
mod control;
mod date;
mod finance;
mod frames;
mod kit;
mod list;
mod logic;
mod matrix;
mod packs;
mod scalar;
mod stats;
mod text;
mod units;
mod values;
mod visual;

pub use values::{decode, serialize_cube, serialize_frame, Column, Cube, CubeColumn, Frame};

/// A field the body leaves on the card for its component: a value (plain data as `V::Json`), or `undefined`.
pub enum Shown {
    V(V),
    Undef,
}

/// One body call: the card as a save holds it, its sockets, and the inputs it was handed.
pub struct Call {
    pub init: Map<String, Json>,
    pub literals: Map<String, Json>,
    pub string_literals: Map<String, Json>,
    /// Each input's declared socket type (`declaredTypeOf`) and label, in the card's order.
    pub sockets: Vec<(String, Option<String>, String)>,
    /// Each output's key and declared type, in the card's order.
    pub outputs: Vec<(String, Option<String>)>,
    /// The inputs as `data()` receives them: a key is there when a cable is, and holds each cable's value.
    pub inputs: Vec<(String, Vec<V>)>,
    pub display: Vec<(String, Shown)>,
}

/// What a body answers: its outputs in order, or the error it throws (the error guard makes it every output's).
pub type Answer = Result<Vec<(String, V)>, V>;

pub fn list(items: Vec<V>) -> V {
    V::List(Rc::new(items))
}

pub fn err(code: &str, message: impl Into<String>) -> V {
    V::err(sol_error(code, message))
}

impl Call {
    /// The call as `engine_node` takes it: the sockets, outputs and inputs as lists of pairs, in the card's order.
    pub fn from_json(j: &Json) -> Call {
        let obj = |k: &str| j.get(k).and_then(Json::as_object).cloned().unwrap_or_default();
        let rows = |k: &str| j.get(k).and_then(Json::as_array).cloned().unwrap_or_default();
        let text = |r: &Json, i: usize| r.get(i).and_then(Json::as_str).map(String::from);
        let sockets = rows("sockets")
            .iter()
            .map(|r| {
                let key = text(r, 0).unwrap_or_default();
                let label = text(r, 2).unwrap_or_else(|| key.clone());
                (key, text(r, 1), label)
            })
            .collect();
        let outputs = rows("outputs").iter().map(|r| (text(r, 0).unwrap_or_default(), text(r, 1))).collect();
        let inputs = rows("inputs")
            .iter()
            .map(|r| (text(r, 0).unwrap_or_default(), r.get(1).and_then(Json::as_array).map(|a| a.iter().map(decode).collect()).unwrap_or_default()))
            .collect();
        Call { init: obj("init"), literals: obj("literals"), string_literals: obj("stringLiterals"), sockets, outputs, inputs, display: Vec::new() }
    }

    /// `inputs[key]`: the cables' values, or `None` with no cable.
    pub fn wired(&self, key: &str) -> Option<&[V]> {
        self.inputs.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_slice())
    }

    /// `readInput(inputs[key], literal)`: unwired, the typed literal; wired, the first cable's value, a blank as null.
    pub fn read_input(&self, key: &str, literal: V) -> V {
        match self.wired(key) {
            None | Some([]) => literal,
            Some([first, ..]) => match first {
                V::Undef => V::Null,
                v => v.clone(),
            },
        }
    }

    /// `this.literals[key]`, `undefined` where it isn't set.
    pub fn literal(&self, key: &str) -> V {
        self.literals.get(key).map(decode).unwrap_or(V::Undef)
    }

    /// `this.stringLiterals[key]`.
    pub fn string_literal(&self, key: &str) -> V {
        self.string_literals.get(key).map(decode).unwrap_or(V::Undef)
    }

    /// `readInput(inputs[key], this.literals[key] ?? dflt)`.
    pub fn read_num(&self, key: &str, dflt: f64) -> V {
        let lit = match self.literal(key) {
            V::Undef | V::Null => V::Num(dflt),
            v => v,
        };
        self.read_input(key, lit)
    }

    /// A saved field as text (`this.op`), or `dflt` where the save leaves it out.
    pub fn field_str<'a>(&'a self, key: &str, dflt: &'a str) -> &'a str {
        self.init.get(key).and_then(Json::as_str).unwrap_or(dflt)
    }

    pub fn field(&self, key: &str) -> Option<&Json> {
        self.init.get(key)
    }

    pub fn label(&self, key: &str) -> String {
        self.sockets.iter().find(|(k, _, _)| k == key).map(|(_, _, l)| l.clone()).unwrap_or_else(|| key.to_string())
    }

    pub fn show(&mut self, field: &str, v: V) {
        self.display.push((field.to_string(), Shown::V(v)));
    }

    pub fn show_undef(&mut self, field: &str) {
        self.display.push((field.to_string(), Shown::Undef));
    }
}

/// The class's body, or `None` where the class has none on the core yet.
pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    scalar::run(kind, c)
        .or_else(|| logic::run(kind, c))
        .or_else(|| complex::run(kind, c))
        .or_else(|| control::run(kind, c))
        .or_else(|| text::run(kind, c))
        .or_else(|| date::run(kind, c))
        .or_else(|| stats::run(kind, c))
        .or_else(|| finance::run(kind, c))
        .or_else(|| list::run(kind, c))
        .or_else(|| matrix::run(kind, c))
        .or_else(|| packs::run(kind, c))
        .or_else(|| visual::run(kind, c))
        .or_else(|| frames::run(kind, c))
}

/// `engine_node`'s reply: `{"out": {key: value}, "display": {...}}`, `{"thrown": value, "display": ...}`, or
/// `{"none": true}` for a class with no body on the core.
pub struct NodeReply {
    pub answer: Option<Answer>,
    pub display: Vec<(String, Shown)>,
}

pub fn reply(args: &Json) -> NodeReply {
    let kind = args.get("kind").and_then(Json::as_str).unwrap_or("");
    let mut c = Call::from_json(args);
    crate::excel_functions::set_clock(args.get("clock").and_then(|j| serde_json::from_value(j.clone()).ok()));
    let answer = run(kind, &mut c);
    crate::excel_functions::set_clock(None);
    crate::excel_functions::take_bailed();
    crate::excel_functions::take_thrown();
    NodeReply { answer, display: c.display }
}

impl serde::Serialize for NodeReply {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use crate::frame_backend::Out;
        use serde::ser::SerializeMap;
        struct Outs<'a>(&'a [(String, V)]);
        impl serde::Serialize for Outs<'_> {
            fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                let mut m = s.serialize_map(Some(self.0.len()))?;
                for (k, v) in self.0 {
                    m.serialize_entry(k, &Out(v))?;
                }
                m.end()
            }
        }
        struct Shows<'a>(&'a [(String, Shown)]);
        impl serde::Serialize for Shows<'_> {
            fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                let mut m = s.serialize_map(Some(self.0.len()))?;
                for (k, v) in self.0 {
                    match v {
                        Shown::V(v) => m.serialize_entry(k, &Out(v))?,
                        Shown::Undef => m.serialize_entry(k, &serde_json::json!({ "undef": true }))?,
                    }
                }
                m.end()
            }
        }
        let mut m = s.serialize_map(None)?;
        match &self.answer {
            None => m.serialize_entry("none", &true)?,
            Some(Ok(outs)) => m.serialize_entry("out", &Outs(outs))?,
            Some(Err(e)) => m.serialize_entry("thrown", &Out(e))?,
        }
        m.serialize_entry("display", &Shows(&self.display))?;
        m.end()
    }
}
