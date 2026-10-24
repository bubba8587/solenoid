// [[D102]] graphOnCore, [[C120]] linearWork
//! A value on a cable (`tree/specs/computation/graph-core.md` § Direct calls): one shared cell holding the form its
//! producer made, a core value or a JavaScript object, and the other form once a reader of the other kind asks for
//! it, kept beside the first so every reader of that kind gets the same one. Converting is the card wire
//! (`nodeWire.ts`), one host call per value converted, never per cell.

use std::cell::OnceCell;
use std::rc::Rc;

use js_sys::Array;
use serde_json::Value as Json;
use solenoid_core::excel_functions::V;
use wasm_bindgen::prelude::*;

use crate::boundary::{self, host};
use crate::boundary_core::{is_frame_ref, Arrived};

struct Inner {
    js: OnceCell<JsValue>,
    core: OnceCell<Option<Arrived>>,
}

#[derive(Clone)]
pub(crate) struct Val(Rc<Inner>);

impl Val {
    pub(crate) fn from_js(v: JsValue) -> Val {
        Val(Rc::new(Inner {
            js: OnceCell::from(v),
            core: OnceCell::new(),
        }))
    }

    pub(crate) fn from_core(a: Arrived) -> Val {
        Val(Rc::new(Inner {
            js: OnceCell::new(),
            core: OnceCell::from(Some(a)),
        }))
    }

    pub(crate) fn bare(v: V) -> Val {
        Val::from_core(Arrived::bare(v))
    }

    /// The JavaScript form, made once.
    pub(crate) fn js(&self) -> JsValue {
        self.0
            .js
            .get_or_init(|| match self.0.core.get() {
                Some(Some(a)) => to_js(a),
                _ => JsValue::UNDEFINED,
            })
            .clone()
    }

    /// The core form, made once; `None` for a value the card wire can't carry (a closure, an object of no kind it
    /// knows).
    pub(crate) fn core(&self) -> Option<&Arrived> {
        self.0
            .core
            .get_or_init(|| match self.0.js.get() {
                Some(v) => from_js(v),
                None => None,
            })
            .as_ref()
    }

    /// The core form where it was made or asked for already.
    fn core_now(&self) -> Option<&V> {
        self.0.core.get().and_then(Option::as_ref).map(|a| &a.v)
    }

    pub(crate) fn is_err(&self) -> bool {
        match (self.core_now(), self.0.js.get()) {
            (Some(v), _) => matches!(v, V::Err(_)),
            (None, Some(js)) => boundary::is_sol_error(js),
            _ => false,
        }
    }

    pub(crate) fn is_frame_ref(&self) -> bool {
        match (self.core_now(), self.0.js.get()) {
            (Some(v), _) => is_frame_ref(v),
            (None, Some(js)) => boundary::is_frame_ref(js),
            _ => false,
        }
    }

    /// `a !== b` as the change test read it: one cell is itself; two JavaScript objects by identity; two core values
    /// by value for a number, text, a logical or a blank, and by allocation otherwise.
    pub(crate) fn differs(&self, other: &Val) -> bool {
        if Rc::ptr_eq(&self.0, &other.0) {
            return false;
        }
        match (self.prim(), other.prim()) {
            (Some(a), Some(b)) => return a != b,
            (None, None) => {}
            _ => return true,
        }
        if let (Some(a), Some(b)) = (self.0.js.get(), other.0.js.get()) {
            return a != b;
        }
        match (self.core_now(), other.core_now()) {
            (Some(V::Cx(..)), _) => true,
            (Some(a), Some(b)) => !crate::boundary_core::same_obj(a, b),
            _ => true,
        }
    }

    /// The value as a JavaScript primitive would compare, where it is one.
    fn prim(&self) -> Option<Prim> {
        if let Some(v) = self.core_now() {
            return match v {
                V::Num(n) => Some(Prim::Num(*n)),
                V::Str(s) => Some(Prim::Str(s.to_string())),
                V::Bool(b) => Some(Prim::Bool(*b)),
                V::Null => Some(Prim::Null),
                V::Undef => Some(Prim::Undef),
                _ => None,
            };
        }
        let js = self.0.js.get()?;
        if let Some(n) = js.as_f64() {
            Some(Prim::Num(n))
        } else if let Some(s) = js.as_string() {
            Some(Prim::Str(s))
        } else if let Some(b) = js.as_bool() {
            Some(Prim::Bool(b))
        } else if js.is_null() {
            Some(Prim::Null)
        } else if js.is_undefined() {
            Some(Prim::Undef)
        } else {
            None
        }
    }
}

/// A primitive as `===` compares it: NaN unequal to itself, 0 equal to -0.
#[derive(PartialEq)]
enum Prim {
    Num(f64),
    Str(String),
    Bool(bool),
    Null,
    Undef,
}

/// A core value in JavaScript: a number, text, a logical or a blank at once, anything else through the card wire's
/// reader (`fromCore`, `readNodeReply`), with a table's unit put back on the array.
fn to_js(a: &Arrived) -> JsValue {
    match &a.v {
        V::Null => JsValue::NULL,
        V::Undef => JsValue::UNDEFINED,
        V::Num(n) => JsValue::from_f64(*n),
        V::Str(s) => JsValue::from_str(s),
        V::Bool(b) => JsValue::from_bool(*b),
        v => {
            let text = solenoid_core::nodes::reply_json(v);
            let unit = a
                .munit
                .as_ref()
                .map_or(JsValue::UNDEFINED, |u| JsValue::from_str(&u.to_string()));
            let read = host()
                .ok()
                .and_then(|h| {
                    h.from_core
                        .call2(&JsValue::NULL, &JsValue::from_str(&text), &unit)
                        .ok()
                })
                .and_then(|r| r.dyn_into::<Array>().ok());
            match read {
                Some(r) => r.get(0),
                None => boundary::sol_error("#VALUE!", "The card's answer can't be read back"),
            }
        }
    }
}

/// A JavaScript value as a core value: a number, text, a logical or a blank at once, anything else through the card
/// wire (`toCore`, `nodeWire`).
fn from_js(v: &JsValue) -> Option<Arrived> {
    if let Some(n) = v.as_f64() {
        return Some(Arrived::bare(V::Num(n)));
    }
    if let Some(s) = v.as_string() {
        return Some(Arrived::bare(V::str(&s)));
    }
    if let Some(b) = v.as_bool() {
        return Some(Arrived::bare(V::Bool(b)));
    }
    if v.is_null() {
        return Some(Arrived::bare(V::Null));
    }
    if v.is_undefined() {
        return Some(Arrived::bare(V::Undef));
    }
    let text = host()
        .ok()?
        .to_core
        .call1(&JsValue::NULL, v)
        .ok()?
        .as_string()?;
    let json: Json = serde_json::from_str(&text).ok()?;
    let munit = json.get("__munit").cloned().map(Rc::new);
    Some(Arrived {
        v: solenoid_core::nodes::decode(&json),
        munit,
    })
}
