// [[D102]] graphOnCore, [[D35]] errorInErrorOut, [[E9]] errorsKeepOrigin, [[C120]] linearWork
//! A card the engine calls in Rust (`tree/specs/computation/graph-core.md` § Direct calls): what the core keeps for
//! it (its call, read from the JavaScript object when it may have changed, and the fields its body shows), and the
//! call itself, through the boundary on core values (`boundary_core.rs`) into its body (`solenoid_core::nodes`).

use std::cell::RefCell;
use std::rc::Rc;

use js_sys::{Array, Function, Object, Promise, Reflect};
use ruggine::classic;
use ruggine::future::{ready, LocalBoxFuture};
use ruggine::fxhash::{FxHashMap, FxHashSet};
use ruggine_engine::{Error, Inputs, Outputs};
use serde_json::{Map, Value as Json};
use solenoid_core::error_value::{sol_error, ErrorCode, Origin};
use solenoid_core::excel_functions::V;
use solenoid_core::nodes::{self, Shown};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

use crate::boundary::{self, host, BoundaryHost, Facts};
use crate::boundary_core::{
    self as core_boundary, coerce_all, find_cell_error, from_thrown, same_obj, tagged, with_origin,
    Arrived, Thrown,
};
use crate::value::Val;

/// The cached fields the guard and loop seeding set where a card has them.
pub(crate) const CACHED: [&str; 5] = [
    "cachedResult",
    "cachedValue",
    "cachedList",
    "cachedChart",
    "cachedPayload",
];

/// A card's call as its JavaScript object last gave it (`coreHeader`, `nodeOnCore.ts`).
pub(crate) struct Header {
    kind: String,
    label: String,
    /// The body's call with no inputs: what a save holds and the sockets, shared by every call (`Call::again`).
    call: nodes::Call,
    core_fields: Vec<String>,
    /// The field a class's `static coreWatch` names: its `coreWatched()` runs after a body that changed it.
    watch: Option<String>,
    facts: core_boundary::Facts,
    has: Vec<String>,
    /// The card's own format picks by column, where it has any.
    picks: Option<Map<String, Json>>,
    name: RefCell<Option<String>>,
    /// What `coreHeader` stamped the text it was read from, so a read that finds the same text keeps it.
    stamp: f64,
}

/// A frame as a card's format picks stamped it: the call that held the picks, the frame that arrived, the stamped one.
type Stamped = (Rc<Header>, V, Val);

/// What the core keeps for a direct card.
#[derive(Default)]
pub(crate) struct Direct {
    header: RefCell<Option<Rc<Header>>>,
    /// The call as last read, kept past a touch.
    last: RefCell<Option<Rc<Header>>>,
    shown: RefCell<FxHashMap<String, Val>>,
    adopted: RefCell<FxHashSet<String>>,
    /// Each output's frame as its format picks stamped it, kept while the frame and the picks stand.
    stamped: RefCell<FxHashMap<String, Stamped>>,
}

/// One direct card in its editor: its object, what its class is, and how its fields reach its object.
pub(crate) struct Card<'a> {
    pub object: &'a Object,
    pub facts: &'a Facts,
    pub direct: &'a Direct,
    /// `adopt(node, field)`: the object reads `field` from the core from now on (`GraphEditor.adopt`).
    pub adopt: &'a Function,
}

fn text(j: &Json, k: &str) -> Vec<String> {
    j.get(k)
        .and_then(Json::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

impl Direct {
    /// Its call is read afresh on the next compute.
    pub(crate) fn touch(&self) {
        *self.header.borrow_mut() = None;
    }

    fn header(
        &self,
        object: &Object,
        facts: &Facts,
        h: &BoundaryHost,
    ) -> Result<Rc<Header>, String> {
        if let Some(hd) = self.header.borrow().as_ref() {
            return Ok(hd.clone());
        }
        let last = self.last.borrow().clone();
        let stamp = last.as_ref().map_or(0.0, |l| l.stamp);
        let read = h
            .header
            .call2(&JsValue::NULL, object, &JsValue::from_f64(stamp))
            .map_err(|e| js_message(&e))?;
        // `null`: the call reads as it did when it was stamped `stamp`.
        if read.is_null() {
            if let Some(last) = last {
                *self.header.borrow_mut() = Some(last.clone());
                return Ok(last);
            }
        }
        let read: Array = read
            .dyn_into()
            .map_err(|_| "the card's call can't be read".to_string())?;
        let stamp = read.get(0).as_f64().unwrap_or(0.0);
        let raw = read.get(1).as_string().unwrap_or_default();
        let j: Json = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let lists = j
            .get("lists")
            .and_then(Json::as_array)
            .map(|rows| {
                rows.iter()
                    .filter_map(|r| {
                        Some((r.get(0)?.as_str()?.to_string(), nodes::decode(r.get(1)?)))
                    })
                    .collect()
            })
            .unwrap_or_default();
        let made = Rc::new(Header {
            kind: j
                .get("kind")
                .and_then(Json::as_str)
                .unwrap_or("")
                .to_string(),
            label: j
                .get("label")
                .and_then(Json::as_str)
                .unwrap_or("")
                .to_string(),
            core_fields: text(&j, "coreFields"),
            watch: j.get("watch").and_then(Json::as_str).map(String::from),
            facts: core_boundary::Facts {
                class: facts.class.clone(),
                sees: facts.sees,
                lazy: facts.lazy,
                unit_aware: facts.unit_aware,
                pass_keys: if facts.passthrough {
                    text(&j, "passthrough")
                } else {
                    Vec::new()
                },
                raw: text(&j, "raw"),
                no_widen: text(&j, "noWiden"),
                owns_literals: j
                    .get("ownsListLiterals")
                    .and_then(Json::as_bool)
                    .unwrap_or(false),
                literals: lists,
            },
            has: text(&j, "has"),
            picks: j.get("picks").and_then(Json::as_object).cloned(),
            name: RefCell::new(None),
            call: nodes::Call::from_json(&j),
            stamp,
        });
        *self.header.borrow_mut() = Some(made.clone());
        *self.last.borrow_mut() = Some(made.clone());
        Ok(made)
    }

    /// A field the card's component reads, now the core's.
    fn set_field(&self, card: &Card, field: &str, v: Val) {
        if !self.adopted.borrow().contains(field) {
            let _ = card
                .adopt
                .call2(&JsValue::NULL, card.object, &JsValue::from_str(field));
            self.adopted.borrow_mut().insert(field.to_owned());
        }
        self.shown.borrow_mut().insert(field.to_owned(), v);
    }

    /// A field as the card shows it, or `None` where its body never set it.
    pub(crate) fn shown(&self, field: &str) -> Option<Val> {
        self.shown.borrow().get(field).cloned()
    }

    /// A field JavaScript wrote; `false` where the core doesn't hold it.
    pub(crate) fn set_shown(&self, field: &str, v: JsValue) -> bool {
        if !self.adopted.borrow().contains(field) {
            return false;
        }
        self.shown
            .borrow_mut()
            .insert(field.to_owned(), Val::from_js(v));
        true
    }

    /// A field loop seeding sets, where the object has it.
    pub(crate) fn seed_field(&self, card: &Card, field: &str, v: Val) {
        let has = self.adopted.borrow().contains(field)
            || Reflect::has(card.object, &field.into()).unwrap_or(false);
        if has {
            self.set_field(card, field, v);
        }
    }

    /// The node leaves its editor: each field it showed is a plain property again, holding what it showed.
    pub(crate) fn restore(&self, object: &Object) {
        let shown: Vec<(String, Val)> = self.shown.borrow_mut().drain().collect();
        self.adopted.borrow_mut().clear();
        for (field, v) in shown {
            let d = Object::new();
            let _ = Reflect::set(&d, &"value".into(), &v.js());
            for flag in ["writable", "enumerable", "configurable"] {
                let _ = Reflect::set(&d, &flag.into(), &JsValue::TRUE);
            }
            let _ = Reflect::define_property(object, &field.into(), &d);
        }
    }
}

fn js_message(e: &JsValue) -> String {
    match e.dyn_ref::<js_sys::Error>() {
        Some(err) => String::from(err.message()),
        None => e
            .as_string()
            .unwrap_or_else(|| "the card's call can't be read".into()),
    }
}

fn err(code: ErrorCode, message: impl Into<String>) -> V {
    V::err(sol_error(code, message))
}

/// One call, with what it needs to answer.
struct Run<'a> {
    card: &'a Card<'a>,
    id: String,
    ports: &'a classic::Node,
    host: Rc<BoundaryHost>,
    header: Option<Rc<Header>>,
}

impl Run<'_> {
    fn name(&self) -> String {
        let read = || {
            self.host
                .node_name
                .call1(&JsValue::NULL, self.card.object)
                .ok()
                .and_then(|n| n.as_string())
                .unwrap_or_default()
        };
        match &self.header {
            Some(hd) => hd.name.borrow_mut().get_or_insert_with(read).clone(),
            None => read(),
        }
    }

    fn origin(&self, slot: Option<&str>) -> Origin {
        Origin {
            node_id: self.id.clone(),
            node_name: self.name(),
            input_slot: slot.map(String::from),
        }
    }

    /// A field as the card holds it now: the core's, or its object's own where the core holds none.
    fn field(&self, field: &str) -> Val {
        self.card.direct.shown(field).unwrap_or_else(|| {
            Val::from_js(
                Reflect::get(self.card.object, &field.into()).unwrap_or(JsValue::UNDEFINED),
            )
        })
    }

    fn has(&self, field: &str) -> bool {
        match &self.header {
            Some(hd) => hd.has.iter().any(|f| f == field),
            None => Reflect::has(self.card.object, &field.into()).unwrap_or(false),
        }
    }

    /// Every output the error; the card's cached result fields too.
    fn error_out(&self, e: Val, slot: Option<&str>) -> Outputs<Val> {
        let tag = match e.core().map(|a| &a.v) {
            Some(V::Err(x)) if x.origin.is_none() => Some(V::Err(tagged(x, || self.origin(slot)))),
            _ => None,
        };
        let e = tag.map_or(e, Val::bare);
        let mut out = Outputs::new();
        for key in self.ports.outputs().keys() {
            out.insert(key.to_owned(), e.clone());
        }
        let d = self.card.direct;
        if self.has("cachedResult") {
            d.set_field(self.card, "cachedResult", e.clone());
        }
        if self.has("cachedChart") {
            d.set_field(self.card, "cachedChart", e.clone());
        }
        if self.has("cachedPayload") {
            d.set_field(self.card, "cachedPayload", Val::bare(V::Null));
        }
        boundary::queue_report(&self.id, Some(e));
        out
    }

    fn thrown_out(&self, t: Thrown) -> Outputs<Val> {
        self.error_out(Val::bare(from_thrown(t)), None)
    }

    /// The body over the inputs (each already its own value, a lazy frame collected).
    fn run(&self, raw: &[(String, Vec<Val>)]) -> Outputs<Val> {
        let Some(header) = self.header.clone() else {
            return self.thrown_out(Thrown::Message("the card's call can't be read".into()));
        };
        let mut arrived: Vec<(String, Vec<Arrived>)> = Vec::with_capacity(raw.len());
        for (key, vals) in raw {
            let mut a = Vec::with_capacity(vals.len());
            for v in vals {
                match v.core() {
                    Some(x) => a.push(x.clone()),
                    None => {
                        return self.thrown_out(Thrown::Value(err(
                            ErrorCode::Value,
                            format!(
                                "{}: an input holds a value the card can't read",
                                header.label
                            ),
                        )))
                    }
                }
            }
            arrived.push((key.clone(), a));
        }
        let rung_of = |key: &str| self.ports.input(key).map(|p| p.socket().name.clone());
        let coerced = match coerce_all(&header.facts, &rung_of, &arrived) {
            Ok(c) => c,
            Err(t) => return self.thrown_out(t),
        };
        let units_in = coerced
            .iter()
            .filter_map(|(k, a)| Some((k.clone(), a.first()?.munit.as_deref()?.clone())))
            .collect();
        let inputs = coerced
            .into_iter()
            .map(|(k, a)| (k, a.into_iter().map(|x| x.v).collect()))
            .collect();
        let mut c = header.call.again(inputs, units_in);
        if !header.core_fields.is_empty() {
            let names: Array = header
                .core_fields
                .iter()
                .map(|f| JsValue::from_str(f))
                .collect();
            let fields = self
                .host
                .fields
                .call2(&JsValue::NULL, self.card.object, &names)
                .ok()
                .and_then(|t| t.as_string())
                .and_then(|t| serde_json::from_str::<Map<String, Json>>(&t).ok())
                .unwrap_or_default();
            Rc::make_mut(&mut c.init).extend(fields);
        }
        let watched = header.watch.as_deref().map(|f| self.field(f));
        let answer = {
            let _calc = solenoid_core::excel_functions::Calc::begin(boundary::clock());
            nodes::run(&header.kind, &mut c)
        };
        let units = std::mem::take(&mut c.matrix_units_out);
        let display = std::mem::take(&mut c.display);
        match answer {
            None => {
                self.show(display, &[]);
                self.thrown_out(Thrown::Message(format!(
                    "{} has no body on the core",
                    header.kind
                )))
            }
            Some(Err(e)) => {
                self.show(display, &[]);
                self.thrown_out(Thrown::Value(e))
            }
            Some(Ok(outs)) => {
                let vals: Vec<(String, Val)> = outs
                    .into_iter()
                    .map(|(k, v)| {
                        let unit = units
                            .iter()
                            .find(|(u, _)| *u == k)
                            .map(|(_, u)| Rc::new(u.clone()));
                        let same = || {
                            raw.iter()
                                .flat_map(|(_, vs)| vs.iter())
                                .find(|x| x.core().is_some_and(|a| same_obj(&a.v, &v)))
                        };
                        let val = match (&unit, same()) {
                            (None, Some(x)) => x.clone(),
                            _ => Val::from_core(Arrived { v, munit: unit }),
                        };
                        (k, val)
                    })
                    .collect();
                self.show(display, &vals);
                if let (Some(f), Some(before)) = (header.watch.as_deref(), watched) {
                    if before.differs(&self.field(f)) {
                        let hook = Reflect::get(self.card.object, &"coreWatched".into())
                            .ok()
                            .and_then(|h| h.dyn_into::<Function>().ok());
                        if let Some(hook) = hook {
                            let _ = hook.call0(self.card.object);
                        }
                    }
                }
                self.finish(&header, vals)
            }
        }
    }

    /// The fields the body set for the card's component: one that is an output is that output's value.
    fn show(&self, display: Vec<(String, Shown)>, outs: &[(String, Val)]) {
        for (field, s) in display {
            let v = match s {
                Shown::Undef => Val::bare(V::Undef),
                Shown::V(v) => outs
                    .iter()
                    .find(|(_, o)| o.core().is_some_and(|a| same_obj(&a.v, &v)))
                    .map_or_else(|| Val::bare(v), |(_, o)| o.clone()),
            };
            self.card.direct.set_field(self.card, &field, v);
        }
    }

    /// The card's answer: each output's frame stamped with its format picks, then tagged; reported to the error sinks.
    fn finish(&self, header: &Rc<Header>, vals: Vec<(String, Val)>) -> Outputs<Val> {
        let mut out = Outputs::new();
        let mut found: Option<Val> = None;
        for (key, val) in vals {
            let val = match &header.picks {
                Some(picks) => self.stamp(header, picks, &key, val),
                None => val,
            };
            let val = match val.core() {
                Some(a) => match with_origin(&a.v, &|| self.origin(None)) {
                    Some(t) => Val::from_core(Arrived {
                        v: t,
                        munit: a.munit.clone(),
                    }),
                    None => val,
                },
                None => val,
            };
            if found.is_none() {
                found = val
                    .core()
                    .and_then(|a| find_cell_error(&a.v))
                    .map(Val::bare);
            }
            out.insert(key, val);
        }
        boundary::queue_report(&self.id, found);
        out
    }

    /// A frame with the card's own format picks on its columns (a lazy one takes them as a step of its plan, in
    /// `nodeBoundary.ts`), kept while the frame and the picks stand so it keeps its identity.
    fn stamp(&self, header: &Rc<Header>, picks: &Map<String, Json>, key: &str, val: Val) -> Val {
        if val.is_frame_ref() {
            let js = val.js();
            return match self
                .host
                .stamp
                .call2(&JsValue::NULL, &self.id.as_str().into(), &js)
            {
                Ok(s) if s != js => Val::from_js(s),
                _ => val,
            };
        }
        let Some(V::Frame(f)) = val.core().map(|a| &a.v) else {
            return val;
        };
        let held = self
            .card
            .direct
            .stamped
            .borrow()
            .get(key)
            .and_then(|(hd, input, out)| {
                (Rc::ptr_eq(hd, header) && matches!(input, V::Frame(i) if Rc::ptr_eq(i, f)))
                    .then(|| out.clone())
            });
        if let Some(out) = held {
            return out;
        }
        let mut changed = false;
        let columns = f
            .columns
            .iter()
            .map(|c| match picks.get(&c.name) {
                Some(pick) if c.format.as_ref() != Some(pick) => {
                    changed = true;
                    nodes::Column {
                        format: Some(pick.clone()),
                        ..c.clone()
                    }
                }
                _ => c.clone(),
            })
            .collect();
        let out = if changed {
            Val::bare(V::Frame(Rc::new(nodes::Frame {
                columns,
                ..f.as_ref().clone()
            })))
        } else {
            val.clone()
        };
        self.card.direct.stamped.borrow_mut().insert(
            key.to_owned(),
            (header.clone(), V::Frame(f.clone()), out.clone()),
        );
        out
    }
}

/// Whether the card hands on in TypeScript what its pass-through input holds (`nodes::OFF_CORE`): a LAMBDA, or a
/// value the card wire doesn't carry.
pub(crate) fn off_core(class: &str, inputs: &Inputs<Val>) -> bool {
    let Some(key) = nodes::off_core_input(class) else {
        return false;
    };
    inputs
        .iter()
        .find(|(k, _)| *k == key)
        .and_then(|(_, vs)| vs.first())
        .is_some_and(|v| matches!(v.core().map(|a| &a.v), None | Some(V::Lambda(_))))
}

/// The card computed on `inputs`: the guard, the boundary and its body, all in Rust; a lazy frame's collect and the
/// first read of its call are the only calls into JavaScript.
pub(crate) fn call<'a>(
    card: &'a Card<'a>,
    ports: &'a classic::Node,
    inputs: Inputs<Val>,
) -> LocalBoxFuture<'a, Result<Outputs<Val>, Error>> {
    let h = match host() {
        Ok(h) => h,
        Err(_) => {
            return ready(Err(crate::wasm::thrown(boundary::sol_error(
                "#ERROR!",
                "the boundary host isn't set",
            ))))
        }
    };
    let header = card.direct.header(card.object, card.facts, &h);
    let run = Run {
        card,
        id: ports.id.clone(),
        ports,
        host: h,
        header: header.as_ref().ok().cloned(),
    };
    let raw: Vec<(String, Vec<Val>)> = inputs
        .iter()
        .map(|(k, v)| (k.to_owned(), v.clone()))
        .collect();
    if let Err(m) = header {
        return ready(Ok(run.thrown_out(Thrown::Message(m))));
    }
    if !card.facts.sees {
        if let Some((e, slot)) = raw.iter().find_map(|(k, vs)| {
            vs.iter()
                .find(|v| v.is_err())
                .map(|e| (e.clone(), k.clone()))
        }) {
            return ready(Ok(run.error_out(e, Some(&slot))));
        }
    }
    let t0 = boundary::perf_on().then(|| boundary::now(&run.host));
    let lazy_refs = !card.facts.lazy && raw.iter().any(|(_, vs)| vs.iter().any(Val::is_frame_ref));
    if !lazy_refs {
        let out = run.run(&raw);
        timed(&run, t0);
        return ready(Ok(out));
    }
    Box::pin(async move {
        let mut collected: Vec<(String, Vec<Val>)> = Vec::with_capacity(raw.len());
        for (key, vals) in &raw {
            let pending: Array = vals
                .iter()
                .map(|v| {
                    if v.is_frame_ref() {
                        run.host
                            .collect
                            .call1(&JsValue::NULL, &v.js())
                            .unwrap_or_else(|e| Promise::reject(&e).into())
                    } else {
                        v.js()
                    }
                })
                .collect();
            let settled = match JsFuture::from(Promise::all(&pending)).await {
                Ok(s) => s.unchecked_into::<Array>(),
                Err(e) => {
                    timed(&run, t0);
                    return Ok(run.error_out(Val::from_js(boundary::thrown_error(e)), None));
                }
            };
            let values: Vec<Val> = vals
                .iter()
                .enumerate()
                .map(|(i, v)| {
                    if v.is_frame_ref() {
                        Val::from_js(settled.get(i as u32))
                    } else {
                        v.clone()
                    }
                })
                .collect();
            if !card.facts.sees {
                if let Some(failed) = values.iter().find(|v| v.is_err()) {
                    timed(&run, t0);
                    return Ok(run.error_out(failed.clone(), None));
                }
            }
            collected.push((key.clone(), values));
        }
        let out = run.run(&collected);
        timed(&run, t0);
        Ok(out)
    })
}

/// The perf probe's row for the call.
fn timed(run: &Run, t0: Option<f64>) {
    if let Some(t0) = t0 {
        let args = Array::of3(
            &run.id.as_str().into(),
            &run.card.facts.class.as_str().into(),
            &JsValue::from_f64(boundary::now(&run.host) - t0),
        );
        let _ = Reflect::apply(&run.host.record_node, &JsValue::NULL, &args);
    }
}
