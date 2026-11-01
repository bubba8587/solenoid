// [[C130]] rustCore, [[C120]] linearWork
//! A value on a cable (`tree/specs/computation/graph-core.md` § Direct calls): one shared cell holding the form its
//! producer made, a core value or a JavaScript object, and the other form once a reader of the other kind asks for
//! it, kept beside the first so every reader of that kind gets the same one. Converting is the card wire
//! (`nodeWire.ts`), one host call per value converted, never per cell.

use std::cell::OnceCell;
use std::rc::Rc;

use js_sys::Array;
use serde_json::Value as Json;
use solenoid_core::excel_functions::V;
use solenoid_core::nodes::Cv;
use wasm_bindgen::prelude::*;

use crate::boundary::{self, host};
use crate::boundary_core::{is_frame_ref, Arrived};

struct Inner {
    js: OnceCell<JsValue>,
    core: OnceCell<Option<Arrived>>,
    /// A big list's first rows for a card's box, `[rows, length, table width]`, made once (`preview_js`).
    preview: OnceCell<JsValue>,
}

/// A list this long is shown by its first rows (`preview_js`).
const PREVIEW_FROM: usize = 10_000;
/// The rows, and a table's columns, a box's preview holds: what a box draws.
const PREVIEW_CELLS: usize = 4;

#[derive(Clone)]
pub(crate) struct Val(Rc<Inner>);

impl Val {
    pub(crate) fn from_js(v: JsValue) -> Val {
        Val(Rc::new(Inner {
            js: OnceCell::from(v),
            core: OnceCell::new(),
            preview: OnceCell::new(),
        }))
    }

    pub(crate) fn from_core(a: Arrived) -> Val {
        Val(Rc::new(Inner {
            js: OnceCell::new(),
            core: OnceCell::from(Some(a)),
            preview: OnceCell::new(),
        }))
    }

    pub(crate) fn bare(v: impl Into<Cv>) -> Val {
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

    /// What a card's box shows ([[C120]] linearWork, drawing stops at the screen): a big list the core made and
    /// JavaScript hasn't taken whole as `[first rows, length, table width]`, made once, so the box never takes the whole of it;
    /// anything else as `[value]`, its JavaScript form.
    pub(crate) fn preview_js(&self) -> JsValue {
        if let Some(js) = self.0.js.get() {
            return Array::of1(js).into();
        }
        match self.0.core.get() {
            Some(Some(a)) if a.munit.is_none() => match &a.v {
                Cv::V(V::List(items)) if items.len() >= PREVIEW_FROM => self
                    .0
                    .preview
                    .get_or_init(|| {
                        // A table's rows are cut to their first columns too; its width rides beside its length.
                        let cut = |v: &V| match v {
                            V::List(r) => solenoid_core::nodes::list(
                                r.iter().take(PREVIEW_CELLS).cloned().collect(),
                            ),
                            other => other.clone(),
                        };
                        let rows = Arrived::bare(solenoid_core::nodes::list(
                            items.iter().take(PREVIEW_CELLS).map(cut).collect(),
                        ));
                        let width = match items.first() {
                            Some(V::List(r)) => JsValue::from_f64(r.len() as f64),
                            _ => JsValue::UNDEFINED,
                        };
                        Array::of3(
                            &to_js(&rows),
                            &JsValue::from_f64(items.len() as f64),
                            &width,
                        )
                        .into()
                    })
                    .clone(),
                // A big frame: its first rows in every column, its row count beside them.
                Cv::Frame(f)
                    if f.columns.iter().map(|c| c.values.len()).max().unwrap_or(0)
                        >= PREVIEW_FROM =>
                {
                    self.0
                        .preview
                        .get_or_init(|| {
                            let rows = f.columns.iter().map(|c| c.values.len()).max().unwrap_or(0);
                            let columns = f
                                .columns
                                .iter()
                                .map(|c| solenoid_core::nodes::Column {
                                    values: c.values.iter().take(PREVIEW_CELLS).cloned().collect(),
                                    raw: c.raw.as_ref().map(|r| match r {
                                        Json::Array(a) => Json::Array(
                                            a.iter().take(PREVIEW_CELLS).cloned().collect(),
                                        ),
                                        other => other.clone(),
                                    }),
                                    ..c.clone()
                                })
                                .collect();
                            let cut = solenoid_core::nodes::Frame {
                                columns,
                                ..(**f).clone()
                            };
                            let preview = Arrived::bare(Cv::Frame(Rc::new(cut)));
                            Array::of2(&to_js(&preview), &JsValue::from_f64(rows as f64)).into()
                        })
                        .clone()
                }
                _ => Array::of1(&self.js()).into(),
            },
            _ => Array::of1(&self.js()).into(),
        }
    }

    /// The JavaScript form where it was made or asked for already.
    pub(crate) fn js_now(&self) -> Option<&JsValue> {
        self.0.js.get()
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
    fn core_now(&self) -> Option<&Cv> {
        self.0.core.get().and_then(Option::as_ref).map(|a| &a.v)
    }

    pub(crate) fn is_err(&self) -> bool {
        match (self.core_now(), self.0.js.get()) {
            (Some(v), _) => v.is_sol_error(),
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
            (Some(Cv::V(V::Cx(..))), _) => true,
            (Some(a), Some(b)) => !crate::boundary_core::same_obj(a, b),
            _ => true,
        }
    }

    /// The value as a JavaScript primitive would compare, where it is one.
    fn prim(&self) -> Option<Prim> {
        if let Some(v) = self.core_now() {
            let Cv::V(v) = v else { return None };
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
        Cv::V(V::Null) => JsValue::NULL,
        Cv::V(V::Undef) => JsValue::UNDEFINED,
        Cv::V(V::Num(n)) => JsValue::from_f64(*n),
        Cv::V(V::Str(s)) => JsValue::from_str(s),
        Cv::V(V::Bool(b)) => JsValue::from_bool(*b),
        v => {
            let unit = a
                .munit
                .as_ref()
                .map_or(JsValue::UNDEFINED, |u| JsValue::from_str(&u.to_string()));
            let read = host()
                .ok()
                .and_then(|h| match binary_out(v) {
                    // Kept for the object JavaScript makes of it, so it comes back as its id (`columnar::keep`).
                    Some(args) => {
                        args.push(&unit);
                        let id = (a.munit.is_none())
                            .then(|| solenoid_core::nodes::columnar::keep(v.clone()));
                        args.push(
                            &id.map_or(JsValue::UNDEFINED, |id| JsValue::from_f64(f64::from(id))),
                        );
                        h.from_core_bin.apply(&JsValue::NULL, &args).ok()
                    }
                    None => {
                        let text = solenoid_core::nodes::reply_json(v);
                        h.from_core
                            .call2(&JsValue::NULL, &JsValue::from_str(&text), &unit)
                            .ok()
                    }
                })
                .and_then(|r| r.dyn_into::<Array>().ok());
            match read {
                Some(r) => r.get(0),
                None => boundary::sol_error("#VALUE!", "The card's answer can't be read back"),
            }
        }
    }
}

/// A frame's or a list's cells as `fromCoreBin` takes them, where it's big enough and every cell is flat
/// (`nodes::columnar`).
fn binary_out(v: &Cv) -> Option<Array> {
    let (kind, schema, c) = solenoid_core::nodes::columnar::binary_out(v)?;
    let args = Array::new();
    args.push(&JsValue::from_str(kind));
    args.push(&schema.map_or(JsValue::UNDEFINED, |s| JsValue::from_str(&s)));
    args.push(&js_sys::Uint8Array::from(&c.tags[..]));
    args.push(&js_sys::Float64Array::from(&c.nums[..]));
    args.push(&JsValue::from_str(&c.strs));
    args.push(&js_sys::Uint32Array::from(&c.lens[..]));
    Some(args)
}

/// `toCore`'s buffers (`[kind, schema, tags, nums, strs, lens]`) as the frame or list they carry.
fn binary_in(a: &Array) -> Option<Cv> {
    use solenoid_core::nodes::columnar;
    let tags = a.get(2).dyn_into::<js_sys::Uint8Array>().ok()?.to_vec();
    let nums = a.get(3).dyn_into::<js_sys::Float64Array>().ok()?.to_vec();
    let strs = a.get(4).as_string()?;
    let lens = a.get(5).dyn_into::<js_sys::Uint32Array>().ok()?.to_vec();
    match a.get(0).as_string()?.as_str() {
        "frame" => columnar::frame_in(&a.get(1).as_string()?, &tags, &nums, &strs, &lens).ok(),
        "list" => columnar::list_in(&tags, &nums, &strs, &lens).ok(),
        _ => None,
    }
}

/// A JavaScript value as a core value: a number, text, a logical or a blank at once, a frame or a list of flat cells
/// as buffers, anything else through the card wire (`toCore`, `nodeWire`).
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
    let h = host().ok()?;
    let wired = h.to_core.call1(&JsValue::NULL, v).ok()?;
    // An object that crossed before is the value kept under its id.
    if let Some(id) = wired.as_f64() {
        return solenoid_core::nodes::columnar::kept(id as u32).map(Arrived::bare);
    }
    if let Some(a) = wired.dyn_ref::<Array>() {
        let cv = binary_in(a)?;
        let id = solenoid_core::nodes::columnar::keep(cv.clone());
        h.held
            .call2(&JsValue::NULL, v, &JsValue::from_f64(f64::from(id)))
            .ok()?;
        return Some(Arrived::bare(cv));
    }
    let text = wired.as_string()?;
    let json: Json = serde_json::from_str(&text).ok()?;
    let munit = json.get("__munit").cloned().map(Rc::new);
    Some(Arrived {
        v: solenoid_core::nodes::decode_card(&json),
        munit,
    })
}
