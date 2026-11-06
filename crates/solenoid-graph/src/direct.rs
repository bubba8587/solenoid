// [[C130]] rustCore, [[C24]] arraySemantics, [[E9]] errorsKeepOrigin, [[C120]] linearWork
//! A card the engine calls in Rust (`tree/specs/computation/graph-core.md` § Direct calls): what the core keeps for it,
//! and the call through the boundary on core values (`boundary_core.rs`) into its body (`solenoid_core::nodes`).

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use js_sys::{Array, Function, Object, Reflect};
use netcore::classic;
use netcore::future::{ready, LocalBoxFuture};
use netcore::fxhash::{FxHashMap, FxHashSet};
use netcore_engine::{Error, Inputs, Outputs};
use serde_json::{Map, Value as Json};
use solenoid_core::error_value::{sol_error, ErrorCode, Origin};
use solenoid_core::excel_functions::V;
use solenoid_core::nodes::{self, Cv, Shown};
use wasm_bindgen::prelude::*;

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
type Stamped = (Rc<Header>, Rc<nodes::Frame>, Val);

/// A lazy frame as a card's format picks stamped it: the call that held the picks, the ref that arrived, the stamped one.
type StampedRef = (Rc<Header>, Rc<solenoid_core::frame_ref::FrameRef>, Val);

/// What the core keeps for a direct card.
#[derive(Default)]
pub(crate) struct Direct {
    header: RefCell<Option<Rc<Header>>>,
    /// The call as last read, kept past a touch.
    last: RefCell<Option<Rc<Header>>>,
    /// Cleared with every cache while the audit is on, unnamed: the next read checks the call still reads the same.
    audited: Cell<bool>,
    shown: RefCell<FxHashMap<String, Val>>,
    adopted: RefCell<FxHashSet<String>>,
    /// Each output's frame as its format picks stamped it, kept while the frame and the picks stand.
    stamped: RefCell<FxHashMap<String, Stamped>>,
    /// The same for a lazy frame: the picks a step of its plan.
    stamped_refs: RefCell<FxHashMap<String, StampedRef>>,
    /// A `nodes::keeps_answer` card's last answer, with the call and the inputs it answered (`call`).
    kept: RefCell<Option<Kept>>,
    /// What its body drew, and the recalc generation the draws hold for ([[C23]] calcModes).
    draws: RefCell<Option<(u64, nodes::Draws)>>,
}

/// A card's answer and the call, the sketch mode, the `coreFields` and the inputs it answered, and the recalculation it
/// stands for when it read the clock.
type Kept = (
    Rc<Header>,
    bool,
    Option<String>,
    Vec<(String, Vec<Val>)>,
    Outputs<Val>,
    Option<u64>,
);

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

/// A saved field reads the same as the value a body shows for it; a value that isn't a plain scalar never does.
fn saved_as(saved: &Json, v: &Cv) -> bool {
    let Cv::V(v) = v else { return false };
    match (saved, v) {
        (Json::Number(n), V::Num(x)) => n.as_f64() == Some(*x),
        (Json::String(t), V::Str(x)) => t.as_str() == &**x,
        (Json::Bool(b), V::Bool(x)) => b == x,
        (Json::Null, V::Null) => true,
        _ => false,
    }
}

thread_local! {
    static AUDIT: Cell<bool> = const { Cell::new(false) };
    static UNNAMED: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

/// On, a full clear re-reads every direct card's call as well and records each one whose call changed with its node
/// unnamed (`unnamed_edits`): the tests' check that every edit names its node.
pub(crate) fn set_audit(on: bool) {
    AUDIT.with(|a| a.set(on));
}

/// The cards the audit caught, as "Class label", since the last ask.
pub(crate) fn unnamed_edits() -> Vec<String> {
    UNNAMED.with(|u| std::mem::take(&mut *u.borrow_mut()))
}

impl Direct {
    /// Its node was named: its call is read afresh on the next compute.
    pub(crate) fn touch(&self) {
        self.audited.set(false);
        *self.header.borrow_mut() = None;
    }

    /// Every cache was cleared: the call stands, since every edit names its node (§ Direct calls).
    pub(crate) fn cleared(&self) {
        if AUDIT.with(Cell::get) && self.header.borrow_mut().take().is_some() {
            self.audited.set(true);
        }
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
        let stamp = last.as_ref().map_or_default(|l| l.stamp);
        let read = h
            .header
            .call2(&JsValue::NULL, object, &JsValue::from_f64(stamp))
            .map_err(|e| js_message(&e))?;
        let audited = self.audited.replace(false);
        // `null`: the call reads as it did when it was stamped `stamp`.
        if read.is_null()
            && let Some(last) = last
        {
            *self.header.borrow_mut() = Some(last.clone());
            return Ok(last);
        }
        let read: Array = read
            .dyn_into()
            .map_err(|_| "the card's call can't be read".to_string())?;
        let stamp = read.get(0).as_f64().unwrap_or(0.0);
        let raw = read.get(1).as_string().unwrap_or_default();
        let j: Json = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        if audited {
            let name = |k: &str| j.get(k).and_then(Json::as_str).unwrap_or("").to_string();
            UNNAMED.with(|u| {
                u.borrow_mut()
                    .push(format!("{} {}", name("kind"), name("label")))
            });
        }
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
                op: j
                    .pointer("/init/op")
                    .and_then(Json::as_str)
                    .unwrap_or("")
                    .to_string(),
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
    /// The body's answer read the clock (`Call::volatile`).
    volatile: Cell<bool>,
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
            Some(Cv::V(V::Err(x))) if x.origin.is_none() => {
                Some(V::Err(tagged(x, || self.origin(slot))))
            }
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
    /// The fields a class's `static coreFields` names, as the card reads them now (JSON text).
    fn core_fields(&self, header: &Header) -> Option<String> {
        if header.core_fields.is_empty() {
            return None;
        }
        let names: Array = header
            .core_fields
            .iter()
            .map(|f| JsValue::from_str(f))
            .collect();
        self.host
            .fields
            .call2(&JsValue::NULL, self.card.object, &names)
            .ok()
            .and_then(|t| t.as_string())
    }

    fn run(&self, raw: &[(String, Vec<Val>)], fields: Option<String>) -> Outputs<Val> {
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
                        )));
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
        if let Some(fields) = fields
            .or_else(|| self.core_fields(&header))
            .and_then(|t| serde_json::from_str::<Map<String, Json>>(&t).ok())
        {
            Rc::make_mut(&mut c.init).extend(fields);
        }
        let watched = header.watch.as_deref().map(|f| self.field(f));
        let generation = crate::wasm::recalc_gen();
        let held = self.card.direct.draws.borrow_mut().take();
        c.draws = Some(match held {
            Some((g, d)) if g == generation => d,
            _ => nodes::Draws::default(),
        });
        let answer = {
            let _calc = solenoid_core::excel_functions::Calc::begin(boundary::clock());
            nodes::run(&header.kind, &mut c)
        };
        if let Some(d) = c.draws.take().filter(|d| !d.is_empty()) {
            *self.card.direct.draws.borrow_mut() = Some((generation, d));
        }
        self.volatile.set(c.volatile);
        let units = std::mem::take(&mut c.matrix_units_out);
        let display = std::mem::take(&mut c.display);
        match answer {
            None => {
                self.show(&header, display, &[]);
                self.thrown_out(Thrown::Message(format!(
                    "{} has no body on the core",
                    header.kind
                )))
            }
            Some(Err(e)) => {
                self.show(&header, display, &[]);
                self.watch(&header, watched);
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
                self.show(&header, display, &vals);
                self.watch(&header, watched);
                self.finish(&header, vals)
            }
        }
    }

    /// `coreWatched()` in TypeScript, where the body changed the field its class's `static coreWatch` names.
    fn watch(&self, header: &Header, before: Option<Val>) {
        if let (Some(f), Some(before)) = (header.watch.as_deref(), before)
            && before.differs(&self.field(f))
        {
            let hook = Reflect::get(self.card.object, &"coreWatched".into())
                .ok()
                .and_then(|h| h.dyn_into::<Function>().ok());
            if let Some(hook) = hook {
                let _ = hook.call0(self.card.object);
            }
        }
    }

    /// The fields the body set for the card's component: one that is an output is that output's value. A body that
    /// rewrites a saved field (the Slider clamping its value, the Format Controller adopting a unit) leaves the call it
    /// read stale, so the next compute reads the call again.
    fn show(&self, header: &Header, display: Vec<(String, Shown)>, outs: &[(String, Val)]) {
        if display
            .iter()
            .any(|(field, s)| match (header.call.init.get(field), s) {
                (None, _) => false,
                (Some(saved), Shown::V(v)) => !saved_as(saved, v),
                (Some(_), Shown::Undef) => true,
            })
        {
            self.card.direct.touch();
        }
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

    /// A frame with the card's own format picks on its columns (a lazy one takes them as a step of its plan),
    /// kept while the frame and the picks stand so it keeps its identity.
    fn stamp(&self, header: &Rc<Header>, picks: &Map<String, Json>, key: &str, val: Val) -> Val {
        if let Some(r) = val.frame_ref() {
            if picks.is_empty() {
                return val;
            }
            let held =
                self.card
                    .direct
                    .stamped_refs
                    .borrow()
                    .get(key)
                    .and_then(|(hd, input, out)| {
                        (Rc::ptr_eq(hd, header) && Rc::ptr_eq(input, &r)).then(|| out.clone())
                    });
            if let Some(out) = held {
                return out;
            }
            let op = serde_json::json!({ "kind": "formats", "formats": picks });
            let out = Val::bare(Cv::Ref(r.then(op)));
            self.card
                .direct
                .stamped_refs
                .borrow_mut()
                .insert(key.to_owned(), (header.clone(), r, out.clone()));
            return out;
        }
        let Some(Cv::Frame(f)) = val.core().map(|a| &a.v) else {
            return val;
        };
        let held = self
            .card
            .direct
            .stamped
            .borrow()
            .get(key)
            .and_then(|(hd, input, out)| {
                (Rc::ptr_eq(hd, header) && Rc::ptr_eq(input, f)).then(|| out.clone())
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
            let out = Val::bare(Cv::Frame(Rc::new(nodes::Frame {
                columns,
                ..f.as_ref().clone()
            })));
            // What a view keeps beside the frame (Describe's tiles) stays beside the stamped one.
            if let Some(from) = val.js_now() {
                let _ = self
                    .host
                    .carry_sidecars
                    .call2(&JsValue::NULL, from, &out.js());
            }
            out
        } else {
            val.clone()
        };
        self.card
            .direct
            .stamped
            .borrow_mut()
            .insert(key.to_owned(), (header.clone(), f.clone(), out.clone()));
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
        .is_some_and(|v| matches!(v.core().map(|a| &a.v), None | Some(Cv::V(V::Lambda(_)))))
}

/// The card computed on `inputs`: the guard, a lazy frame's collect, the boundary and its body, all in Rust; the first
/// read of its call is the only call into JavaScript.
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
            ))));
        }
    };
    let header = card.direct.header(card.object, card.facts, &h);
    let run = Run {
        card,
        id: ports.id.clone(),
        ports,
        host: h,
        header: header.as_ref().ok().cloned(),
        volatile: Cell::new(false),
    };
    let raw: Vec<(String, Vec<Val>)> = inputs
        .iter()
        .map(|(k, v)| (k.to_owned(), v.clone()))
        .collect();
    if !card.facts.sees
        && let Some((e, slot)) = raw.iter().find_map(|(k, vs)| {
            vs.iter()
                .find(|v| v.is_err())
                .map(|e| (e.clone(), k.clone()))
        })
    {
        return ready(Ok(run.error_out(e, Some(&slot))));
    }
    if let Err(m) = header {
        return ready(Ok(run.thrown_out(Thrown::Message(m))));
    }
    let t0 = boundary::perf_on().then(|| boundary::now(&run.host));
    // A card that isn't lazy reads a lazy frame whole, read once a ref; one that fails is the answer.
    let mut raw = raw;
    if !card.facts.lazy {
        for (_, vals) in raw.iter_mut() {
            for v in vals.iter_mut() {
                if let Some(r) = v.frame_ref() {
                    *v = crate::value::collected(&r);
                    if !card.facts.sees && v.is_err() {
                        let failed = v.clone();
                        timed(&run, t0);
                        return ready(Ok(run.error_out(failed, None)));
                    }
                }
            }
        }
    }
    // A card that keeps its answer gives the last one over the same call and the same inputs, the same objects.
    let sketch = solenoid_core::frame_ref::sketch();
    let keeps = run
        .header
        .as_ref()
        .filter(|h| nodes::keeps_answer(&h.kind))
        .cloned();
    let fields = keeps.as_ref().and_then(|h| run.core_fields(h));
    let generation = || crate::wasm::session(|s| s.recalc_gen);
    if let Some(h) = &keeps
        && let Some((kh, ks, kf, kin, kout, kgen)) = &*card.direct.kept.borrow()
        && Rc::ptr_eq(kh, h)
        && *ks == sketch
        && *kf == fields
        && same_inputs(kin, &raw)
        && kgen.is_none_or(|g| g == generation())
    {
        timed(&run, t0);
        return ready(Ok(kout.clone()));
    }
    let out = run.run(&raw, fields.clone());
    if let Some(h) = keeps {
        // An answer that read the clock (TODAY, NOW) stands for this recalculation only.
        let kgen = run.volatile.get().then(generation);
        *card.direct.kept.borrow_mut() = Some((h, sketch, fields, raw, out.clone(), kgen));
    }
    timed(&run, t0);
    ready(Ok(out))
}

/// Two calls' inputs as the change test reads them: the same keys, each value the same.
fn same_inputs(a: &[(String, Vec<Val>)], b: &[(String, Vec<Val>)]) -> bool {
    a.len() == b.len()
        && a.iter().zip(b).all(|((ka, va), (kb, vb))| {
            ka == kb && va.len() == vb.len() && va.iter().zip(vb).all(|(x, y)| !x.differs(y))
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
