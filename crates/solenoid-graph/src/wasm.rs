// [[D102]] graphOnCore
//! The WebAssembly entry: one `GraphCore` per editor, holding its graph (`model.rs`) with the nodes'
//! and cables' JavaScript objects, the pipes `src/graph/graphEditor.ts` adds, and the dataflow
//! engine `src/graph/dataflowEngine.ts` drives, which calls a direct card's body in Rust
//! (`direct.rs`) and every other card's `data()` in JavaScript.

use std::cell::{Cell, RefCell};
use std::fmt;
use std::rc::Rc;
use std::rc::Weak;

use js_sys::{Array, Function, Map, Object, Promise, Reflect};
use ruggine::classic::{self, Connection};
use ruggine::future::{ready, LocalBoxFuture};
use ruggine::fxhash::{FxHashMap, FxHashSet};
use ruggine::{NodeBase, Root};
use ruggine_engine::{Error, Inputs, Outputs};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::{future_to_promise, JsFuture};

use crate::boundary::{self, Facts};
use crate::direct::{self, Card, Direct};
use crate::model::{Failure, Graph, Host, Port, Side, Signal};
use crate::pass;
use crate::session::{Entry, Mode, Session};
use crate::value::Val;

/// A canvas node's JavaScript object, whose `data()` computes it, and what its class is.
struct JsNode {
    object: Object,
    cancelled: Function,
    facts: Facts,
    /// The editor's engine runs nodes through the input boundary (`boundary.rs`); off for a raw engine.
    boundary: Rc<Cell<bool>>,
    /// What the core keeps for a card whose body it calls in Rust; `None` for every other card.
    direct: Option<Direct>,
    /// `GraphEditor.adopt`: a field the core holds for the card, read through the object.
    adopt: Function,
}

impl JsNode {
    fn card(&self) -> Option<Card<'_>> {
        Some(Card {
            object: &self.object,
            facts: &self.facts,
            direct: self.direct.as_ref()?,
            adopt: &self.adopt,
        })
    }
}

struct Js;

fn vals_to_js(inputs: Inputs<Val>) -> Inputs<JsValue> {
    let mut out = Inputs::new();
    for (key, values) in inputs.iter() {
        out.insert(key.to_owned(), values.iter().map(Val::js).collect());
    }
    out
}

fn outputs_to_vals(outputs: Outputs<JsValue>) -> Outputs<Val> {
    let mut out = Outputs::new();
    for (key, value) in outputs.iter() {
        out.insert(key.to_owned(), Val::from_js(value.clone()));
    }
    out
}

impl Host for Js {
    type Node = JsNode;
    type Connection = JsValue;
    type Value = Val;
    type Thrown = JsValue;

    fn data<'a>(
        node: &'a JsNode,
        ports: &'a classic::Node,
        inputs: Inputs<Val>,
    ) -> LocalBoxFuture<'a, Result<Outputs<Val>, Error>> {
        if node.boundary.get() {
            if node.direct.is_some()
                && DIRECT_CALLS.with(Cell::get)
                && !direct::off_core(&node.facts.class, &inputs)
            {
                return Box::pin(async move {
                    let card = node.card().expect("a direct card");
                    direct::call(&card, ports, inputs).await
                });
            }
            let pending =
                boundary::call(&node.object, &node.facts, ports, vals_to_js(inputs), None);
            return Box::pin(async move { pending.await.map(outputs_to_vals) });
        }
        let data = match Reflect::get(&node.object, &JsValue::from_str("data")) {
            Ok(f) if f.is_function() => f.unchecked_into::<Function>(),
            _ => {
                return ready(Err(thrown(
                    js_sys::TypeError::new("node.data is not a function").into(),
                )))
            }
        };
        match data.call1(&node.object, &inputs_to_js(&inputs)) {
            Err(e) => ready(Err(rejected(&node.cancelled, e))),
            Ok(result) if result.is_instance_of::<Promise>() => {
                let pending = JsFuture::from(result.unchecked_into::<Promise>());
                let cancelled = node.cancelled.clone();
                Box::pin(async move {
                    pending
                        .await
                        .map(outputs_from_js)
                        .map_err(|e| rejected(&cancelled, e))
                })
            }
            Ok(result) => ready(Ok(outputs_from_js(result))),
        }
    }
}

/// What a node's `data()` threw, carried through the engine to the fetch that awaits it.
struct Thrown(JsValue);

impl fmt::Debug for Thrown {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}", self.0)
    }
}

impl fmt::Display for Thrown {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Debug::fmt(self, f)
    }
}

impl std::error::Error for Thrown {}

pub(crate) fn thrown(value: JsValue) -> Error {
    Error::node(Thrown(value))
}

/// What `data()` threw or rejected with; a `Cancelled` (an inner engine's, passed up) stays a
/// cancellation, as rete-engine's `instanceof Cancelled` reads it.
fn rejected(cancelled: &Function, value: JsValue) -> Error {
    let is_cancelled = Reflect::get(cancelled, &JsValue::from_str("prototype"))
        .ok()
        .and_then(|p| p.dyn_into::<Object>().ok())
        .is_some_and(|p| p.is_prototype_of(&value));
    if is_cancelled {
        Error::Cancelled
    } else {
        thrown(value)
    }
}

/// The object's own keys, as `Object.keys`; nothing for a missing or non-object value.
fn keys_of(value: &JsValue) -> Vec<String> {
    if !value.is_object() {
        return Vec::new();
    }
    Object::keys(value.unchecked_ref())
        .iter()
        .filter_map(|k| k.as_string())
        .collect()
}

fn outputs_from_js(value: JsValue) -> Outputs<Val> {
    let mut out = Outputs::new();
    if value.is_object() {
        for key in keys_of(&value) {
            let v = Reflect::get(&value, &JsValue::from_str(&key)).unwrap_or(JsValue::UNDEFINED);
            out.insert(key, Val::from_js(v));
        }
    }
    out
}

fn js_outputs_to_js(outputs: &Outputs<JsValue>) -> Object {
    let object = Object::new();
    for (key, value) in outputs.iter() {
        let _ = Reflect::set(&object, &JsValue::from_str(key), value);
    }
    object
}

fn outputs_to_js(outputs: &Outputs<Val>) -> Object {
    let object = Object::new();
    for (key, value) in outputs.iter() {
        let _ = Reflect::set(&object, &JsValue::from_str(key), &value.js());
    }
    object
}

fn inputs_to_js(inputs: &Inputs<Val>) -> Object {
    let object = Object::new();
    for (key, values) in inputs.iter() {
        let list: Array = values.iter().map(Val::js).collect();
        let _ = Reflect::set(&object, &JsValue::from_str(key), &list);
    }
    object
}

thread_local! {
    static ON_PANIC: RefCell<Option<Function>> = const { RefCell::new(None) };
    static DIRECT_CALLS: Cell<bool> = const { Cell::new(true) };
}

/// Off, every card's `data()` runs in JavaScript, its body crossing through `nodeOnCore`: how the node recorder
/// (`FREEZE_NODES`) sees every call the suite makes.
#[wasm_bindgen(js_name = setDirectCalls)]
pub fn set_direct_calls(on: bool) {
    DIRECT_CALLS.with(|d| d.set(on));
}

/// On, every full clear checks that no direct card's call changed with its node unnamed (`unnamedEdits`).
#[wasm_bindgen(js_name = auditNamedEdits)]
pub fn audit_named_edits(on: bool) {
    direct::set_audit(on);
}

/// The cards whose call changed with their node unnamed, as "Class label", since the last ask.
#[wasm_bindgen(js_name = unnamedEdits)]
pub fn unnamed_edits() -> Vec<String> {
    direct::unnamed_edits()
}

/// `handler(message)` runs when a panic starts, before the module traps, so the host can settle what was waiting on
/// it and instantiate the module afresh.
#[wasm_bindgen(js_name = setPanicHandler)]
pub fn set_panic_handler(handler: Function) {
    ON_PANIC.with(|h| *h.borrow_mut() = Some(handler));
    std::panic::set_hook(Box::new(|info| {
        let message = JsValue::from_str(&info.to_string());
        ON_PANIC.with(|h| {
            if let Some(f) = h.try_borrow().ok().and_then(|f| f.clone()) {
                let _ = f.call1(&JsValue::NULL, &message);
            }
        });
    }));
}

/// A node's or cable's id: sixteen lowercase hex digits from eight secure random bytes, Ruggine's `getUID`.
#[wasm_bindgen]
pub fn uid() -> String {
    ruggine::get_uid()
}

/// Panics: the tests' trigger for the recovery (`graphTrap.test.ts`).
#[wasm_bindgen(js_name = graphTrap)]
pub fn graph_trap() {
    panic!("graph_trap");
}

/// The node's ports as its own object holds them (`inputs` and `outputs`, each port's socket `name`).
fn ports_of(node: &Object) -> classic::Node {
    let mut ports = classic::Node::new("");
    ports.id = Reflect::get(node, &"id".into())
        .ok()
        .and_then(|v| v.as_string())
        .unwrap_or_default();
    let socket_name = |port: &JsValue| {
        Reflect::get(port, &"socket".into())
            .and_then(|s| Reflect::get(&s, &"name".into()))
            .ok()
            .and_then(|n| n.as_string())
            .unwrap_or_default()
    };
    let side = |name: &str| Reflect::get(node, &name.into()).unwrap_or(JsValue::UNDEFINED);
    let (ins, outs) = (side("inputs"), side("outputs"));
    for key in keys_of(&ins) {
        let port = Reflect::get(&ins, &key.as_str().into()).unwrap_or(JsValue::UNDEFINED);
        let _ = ports.add_input(
            key,
            classic::Input::new(classic::Socket::new(socket_name(&port))),
        );
    }
    for key in keys_of(&outs) {
        let port = Reflect::get(&outs, &key.as_str().into()).unwrap_or(JsValue::UNDEFINED);
        let _ = ports.add_output(
            key,
            classic::Output::new(classic::Socket::new(socket_name(&port))),
        );
    }
    ports
}

fn inputs_from_js(inputs: &JsValue) -> Inputs<JsValue> {
    let mut given = Inputs::new();
    if !inputs.is_object() {
        return given;
    }
    for key in Object::keys(inputs.unchecked_ref()).iter() {
        let values = Reflect::get(inputs, &key).unwrap_or(JsValue::UNDEFINED);
        let list: Vec<JsValue> = values
            .dyn_ref::<Array>()
            .map(|a| a.to_vec())
            .unwrap_or_default();
        given.insert(key.as_string().unwrap_or_default(), list);
    }
    given
}

fn vals_from_js(inputs: &JsValue) -> Inputs<Val> {
    let mut given = Inputs::new();
    for (key, values) in inputs_from_js(inputs).iter() {
        given.insert(
            key.to_owned(),
            values.iter().cloned().map(Val::from_js).collect(),
        );
    }
    given
}

/// A call into the engine: the flags and the clock read once for it, and the error sinks' reports handed over when it
/// ends.
async fn entry<T>(work: impl std::future::Future<Output = T>) -> T {
    boundary::enter();
    let out = work.await;
    boundary::flush_reports();
    out
}

/// A node outside any editor computed on `inputs` through the input boundary, calling `data` (its own `data()` when
/// none): the outputs at once when nothing it does waits, else a promise of them. For tests and scripts that drive one
/// node.
#[wasm_bindgen(js_name = computeNode)]
pub fn compute_node(
    node: Object,
    inputs: JsValue,
    data: Option<Function>,
) -> Result<JsValue, JsValue> {
    use std::future::Future;
    use std::task::{Context, Poll, Waker};
    let given = inputs_from_js(&inputs);
    let mut pending = Box::pin(entry(async move {
        let (ports, facts) = (ports_of(&node), Facts::of(&node));
        boundary::call(&node, &facts, &ports, given, data.as_ref()).await
    }));
    let error = |e: Error| match e {
        Error::Node(e) => match e.downcast_ref::<Thrown>() {
            Some(Thrown(value)) => value.clone(),
            None => js_sys::Error::new(&e.to_string()).into(),
        },
        e => js_sys::Error::new(&e.to_string()).into(),
    };
    match pending
        .as_mut()
        .poll(&mut Context::from_waker(Waker::noop()))
    {
        Poll::Ready(Ok(outputs)) => Ok(js_outputs_to_js(&outputs).into()),
        Poll::Ready(Err(e)) => Err(error(e)),
        Poll::Pending => Ok(future_to_promise(async move {
            pending
                .await
                .map(|o| js_outputs_to_js(&o).into())
                .map_err(error)
        })
        .into()),
    }
}

/// What a change to a node inside a composite's editor reaches: the composites nesting it.
struct Shared {
    graph: Graph<Js>,
    /// Each composite node here and its own editor's core, which the pass retargets into.
    nests: RefCell<FxHashMap<String, Weak<Shared>>>,
    /// The loop set the last pass computed, which a value edit's targeted pass reuses.
    loops: RefCell<Option<Vec<String>>>,
    /// Cables added so far: a pass that sees this move re-seeds its loop set before its next fetch.
    wired: Cell<u64>,
    /// Each node's outputs as the last pass landed them: the change test's and the cable readouts' values.
    landed: RefCell<FxHashMap<String, Vec<(String, Val)>>>,
}

type Node = Rc<crate::model::GraphNode<Js>>;

impl Shared {
    /// The composites holding `id` in their editors, innermost first.
    fn owners(&self, id: &str) -> Option<Vec<Node>> {
        let nests = self.nests.borrow();
        for node in self.graph.editor().get_nodes() {
            let Some(inner) = nests.get(node.id()).and_then(Weak::upgrade) else {
                continue;
            };
            if inner.graph.get_node(id).is_some() {
                return Some(vec![node]);
            }
            if let Some(mut chain) = inner.owners(id) {
                chain.push(node);
                return Some(chain);
            }
        }
        None
    }

    /// Tells every composite on the way to `id` that its subgraph changed (an internal value edit fires no editor
    /// event); the outermost one, whose cache entry must go.
    fn mark_nested(&self, id: &str) -> Option<String> {
        let chain = self.owners(id)?;
        let mark = JsValue::from_str("markInternalEdit");
        for node in &chain {
            let object = &node.object.object;
            if let Ok(f) = Reflect::get(object, &mark).and_then(|f| f.dyn_into::<Function>()) {
                let _ = f.call0(object);
            }
        }
        chain.last().map(|n| n.id().to_owned())
    }

    /// A direct card's call is read afresh on its next compute: `id`'s. Without a node every cache is being
    /// cleared, and each card's call stands (§ Direct calls).
    fn touch(&self, id: Option<&str>) {
        match id {
            Some(id) => {
                if let Some(d) = self
                    .graph
                    .get_node(id)
                    .as_ref()
                    .and_then(|n| n.object.direct.as_ref())
                {
                    d.touch();
                }
            }
            None => {
                for node in self.graph.editor().get_nodes() {
                    if let Some(d) = &node.object.direct {
                        d.cleared();
                    }
                }
            }
        }
    }

    /// `id` changed in place, here or in a composite's editor at any depth: a direct card's call is read afresh.
    fn name(&self, id: &str) -> bool {
        if self.graph.get_node(id).is_some() {
            self.touch(Some(id));
            return true;
        }
        let inner: Vec<Rc<Shared>> = self
            .nests
            .borrow()
            .values()
            .filter_map(Weak::upgrade)
            .collect();
        inner.iter().any(|s| s.name(id))
    }

    /// Whether the outputs differ from what the node last landed (`!==` per key), which they then are.
    fn land(&self, id: &str, outputs: &Outputs<Val>) -> bool {
        let mut landed = self.landed.borrow_mut();
        let held = landed.entry(id.to_owned()).or_default();
        let mut moved = false;
        for (key, v) in outputs.iter() {
            match held.iter_mut().find(|(k, _)| k == key) {
                Some((_, old)) => {
                    moved |= old.differs(v);
                    *old = v.clone();
                }
                None => {
                    moved = true;
                    held.push((key.to_owned(), v.clone()));
                }
            }
        }
        moved
    }

    /// The node left the editor: the fields the core held for it go back to its object.
    fn left(&self, node: &Node) {
        self.landed.borrow_mut().remove(node.id());
        if let Some(d) = &node.object.direct {
            d.restore(&node.object.object);
        }
    }

    fn loop_set(&self, reuse: bool) -> Vec<String> {
        if reuse {
            if let Some(loops) = self.loops.borrow().as_ref() {
                return loops.clone();
            }
        }
        let loops = pass::loop_members(self.graph.editor());
        *self.loops.borrow_mut() = Some(loops.clone());
        loops
    }

    /// Every loop member answers `#CIRC!` on every output without running, its card's cached fields too, so a pass
    /// never fetches into a cycle (compute-pass.md § The model pass).
    fn seed_loops(&self, members: &[String], message: &str) {
        if members.is_empty() {
            return;
        }
        let circ = Val::from_js(boundary::sol_error("#CIRC!", message));
        for id in members {
            let Some(node) = self.graph.get_node(id) else {
                continue;
            };
            let mut outputs = Outputs::new();
            for key in node.classic.outputs().keys() {
                outputs.insert(key.to_owned(), circ.clone());
            }
            let object = &node.object.object;
            for field in direct::CACHED {
                let v = if field == "cachedPayload" {
                    Val::from_js(JsValue::NULL)
                } else {
                    circ.clone()
                };
                match node.object.card() {
                    Some(card) => card.direct.seed_field(&card, field, v),
                    None => {
                        let key = JsValue::from_str(field);
                        if Reflect::has(object, &key).unwrap_or(false) {
                            let _ = Reflect::set(object, &key, &v.js());
                        }
                    }
                }
            }
            let seeded = ruggine_engine::Cancellable::resolved(Ok(Rc::new(outputs)));
            self.graph.engine().cache().patch(id.clone(), seeded);
        }
    }
}

/// What a loop member answers.
const CIRC_MESSAGE: &str =
    "This node is part of a circular dependency: the calculation feeds back into itself";

/// One editor's graph and its dataflow engine.
#[wasm_bindgen]
pub struct GraphCore {
    shared: Rc<Shared>,
    cancelled: Function,
    boundary: Rc<Cell<bool>>,
    adopt: Function,
}

fn to_js(cancelled: &Function, error: Error) -> JsValue {
    match error {
        Error::Cancelled => Reflect::construct(cancelled, &Array::new()).unwrap_or_else(|e| e),
        Error::Node(e) => match e.downcast_ref::<Thrown>() {
            Some(Thrown(value)) => value.clone(),
            None => js_sys::Error::new(&e.to_string()).into(),
        },
        e => js_sys::Error::new(&e.to_string()).into(),
    }
}

fn failed(failure: Failure<JsValue>) -> JsValue {
    match failure {
        Failure::Thrown(value) => value,
        Failure::Graph(e) => graph_error(e),
    }
}

fn graph_error(e: ruggine::Error) -> JsValue {
    js_sys::Error::new(&e.to_string()).into()
}

fn side(output: bool) -> Side {
    if output {
        Side::Output
    } else {
        Side::Input
    }
}

fn ports(keys: Vec<String>, types: Vec<String>) -> Vec<Port> {
    keys.into_iter().zip(types).collect()
}

const SIGNALS: [&str; 11] = [
    "nodecreate",
    "nodecreated",
    "noderemove",
    "noderemoved",
    "connectioncreate",
    "connectioncreated",
    "connectionremove",
    "connectionremoved",
    "clear",
    "clearcancelled",
    "cleared",
];

thread_local! {
    static SIGNAL_NAMES: Vec<JsValue> = SIGNALS.iter().map(|s| JsValue::from_str(s)).collect();
}

/// The signal's `type` and `data`, as the host's pipes take them.
fn signal_to_js(signal: &Signal<Js>) -> (JsValue, JsValue) {
    let at = SIGNALS
        .iter()
        .position(|s| *s == signal.type_name())
        .expect("every signal is named");
    let data = match signal {
        Root::NodeCreate(n) | Root::NodeCreated(n) | Root::NodeRemove(n) | Root::NodeRemoved(n) => {
            n.object.object.clone().into()
        }
        Root::ConnectionCreate(c)
        | Root::ConnectionCreated(c)
        | Root::ConnectionRemove(c)
        | Root::ConnectionRemoved(c) => c.object.clone(),
        Root::Clear | Root::ClearCancelled | Root::Cleared => JsValue::UNDEFINED,
    };
    (SIGNAL_NAMES.with(|names| names[at].clone()), data)
}

#[wasm_bindgen]
impl GraphCore {
    /// `cancelled` is the class of error a fetch cut short by a reset rejects with; `adopt(node, field)` makes the
    /// object read a field the core holds for it (`GraphEditor.adopt`).
    #[wasm_bindgen(constructor)]
    pub fn new(cancelled: Function, adopt: Function) -> GraphCore {
        GraphCore {
            shared: Rc::new(Shared {
                graph: Graph::new(),
                nests: RefCell::new(FxHashMap::default()),
                loops: RefCell::new(None),
                wired: Cell::new(0),
                landed: RefCell::new(FxHashMap::default()),
            }),
            cancelled,
            boundary: Rc::new(Cell::new(false)),
            adopt,
        }
    }

    /// Adds `pipe(type, data)` after every pipe already here: it answers truthy to go on, falsy to
    /// stop the chain (cancelling the change a present-tense signal announces), and what it
    /// throws stops the chain and fails the edit. Returns the handle `removePipe` takes.
    #[wasm_bindgen(js_name = addPipe)]
    pub fn add_pipe(&self, pipe: Function) -> usize {
        self.shared.graph.add_pipe(move |signal| {
            let (kind, data) = signal_to_js(signal);
            pipe.call2(&JsValue::NULL, &kind, &data)
                .map(|go| go.is_truthy())
        })
    }

    #[wasm_bindgen(js_name = removePipe)]
    pub fn remove_pipe(&self, handle: usize) -> bool {
        self.shared.graph.remove_pipe(handle)
    }

    /// Attaches the engine here in the chain, registering the nodes already in the editor. A `raw` engine calls each
    /// node's `data()` as it is; any other runs it through the input boundary.
    #[wasm_bindgen(js_name = useEngine)]
    pub fn use_engine(&self, raw: bool) -> Result<(), JsValue> {
        self.boundary.set(!raw);
        self.shared.graph.use_engine().map_err(failed)
    }

    /// The node computed on `inputs` (one list per input key) as the engine computes it, without its cache.
    pub fn compute(&self, id: &str, inputs: JsValue) -> Promise {
        let node = self.shared.graph.get_node(id);
        let cancelled = self.cancelled.clone();
        let given = vals_from_js(&inputs);
        future_to_promise(entry(async move {
            let Some(node) = node else {
                return Err(js_sys::Error::new("cannot find node").into());
            };
            if let Some(d) = &node.object.direct {
                d.touch();
            }
            match Js::data(&node.object, &node.classic, given).await {
                Ok(outputs) => Ok(outputs_to_js(&outputs).into()),
                Err(e) => Err(to_js(&cancelled, e)),
            }
        }))
    }

    /// `false` when a `nodecreate` pipe cancelled it.
    #[wasm_bindgen(js_name = addNode)]
    pub fn add_node(
        &self,
        id: String,
        object: Object,
        input_keys: Vec<String>,
        input_types: Vec<String>,
        output_keys: Vec<String>,
        output_types: Vec<String>,
    ) -> Result<bool, JsValue> {
        let facts = Facts::of(&object);
        let node = JsNode {
            direct: solenoid_core::nodes::is_direct(&facts.class).then(Direct::default),
            facts,
            object,
            cancelled: self.cancelled.clone(),
            boundary: self.boundary.clone(),
            adopt: self.adopt.clone(),
        };
        self.shared
            .graph
            .add_node(
                id,
                node,
                &ports(input_keys, input_types),
                &ports(output_keys, output_types),
            )
            .map_err(failed)
    }

    /// `false` when a `noderemove` pipe cancelled it.
    #[wasm_bindgen(js_name = removeNode)]
    pub fn remove_node(&self, id: &str) -> Result<bool, JsValue> {
        let node = self.shared.graph.get_node(id);
        let removed = self.shared.graph.remove_node(id).map_err(failed)?;
        if let (true, Some(node)) = (removed, node) {
            self.shared.left(&node);
        }
        Ok(removed)
    }

    /// `false` when a `connectioncreate` pipe cancelled it.
    #[wasm_bindgen(js_name = addConnection)]
    pub fn add_connection(
        &self,
        object: JsValue,
        id: String,
        source: String,
        source_output: String,
        target: String,
        target_input: String,
    ) -> Result<bool, JsValue> {
        let c = Connection {
            id,
            source,
            target,
            source_output,
            target_input,
        };
        let added = self
            .shared
            .graph
            .add_connection(c, object)
            .map_err(failed)?;
        if added {
            self.shared.wired.set(self.shared.wired.get() + 1);
        }
        Ok(added)
    }

    /// `false` when a `connectionremove` pipe cancelled it.
    #[wasm_bindgen(js_name = removeConnection)]
    pub fn remove_connection(&self, id: &str) -> Result<bool, JsValue> {
        self.shared.graph.remove_connection(id).map_err(failed)
    }

    /// Every cable, then every node; `false` when a `clear` pipe cancelled it.
    pub fn clear(&self) -> Result<bool, JsValue> {
        let nodes = self.shared.graph.editor().get_nodes();
        let cleared = self.shared.graph.clear().map_err(failed)?;
        for node in nodes {
            if self.shared.graph.get_node(node.id()).is_none() {
                self.shared.left(&node);
            }
        }
        Ok(cleared)
    }

    /// Gives the node exactly these ports, in order: a node's socket changes reach the core as one call.
    #[wasm_bindgen(js_name = setPorts)]
    pub fn set_ports(
        &self,
        id: &str,
        input_keys: Vec<String>,
        input_types: Vec<String>,
        output_keys: Vec<String>,
        output_types: Vec<String>,
    ) -> Result<(), JsValue> {
        self.shared.touch(Some(id));
        self.shared
            .graph
            .set_ports(
                id,
                &ports(input_keys, input_types),
                &ports(output_keys, output_types),
            )
            .map_err(graph_error)
    }

    /// The node's ports on one side as `[key, type]` pairs, in order; `undefined` for a node not
    /// here.
    pub fn ports(&self, id: &str, output: bool) -> Option<Array> {
        self.shared.graph.ports(id, side(output)).map(|ports| {
            ports
                .into_iter()
                .map(|(k, t)| Array::of2(&JsValue::from_str(&k), &JsValue::from_str(&t)))
                .collect()
        })
    }

    /// Puts the nodes in `order`, which must name every node once; `false` when it doesn't.
    #[wasm_bindgen(js_name = reorderNodes)]
    pub fn reorder_nodes(&self, order: Vec<String>) -> bool {
        self.shared.graph.reorder_nodes(&order)
    }

    #[wasm_bindgen(js_name = nodeIds)]
    pub fn node_ids(&self) -> Vec<String> {
        self.shared.graph.node_ids()
    }

    #[wasm_bindgen(js_name = connectionIds)]
    pub fn connection_ids(&self) -> Vec<String> {
        self.shared.graph.connection_ids()
    }

    /// The node changed in place (a field, a literal, a label), here or inside a composite here: its call is read
    /// afresh on its next compute. `false` when no editor here holds it.
    pub fn named(&self, id: &str) -> bool {
        self.shared.name(id)
    }

    /// The node's outputs, from the cache when present.
    pub fn fetch(&self, id: &str) -> Promise {
        let engine = self.shared.graph.engine().clone();
        let id = id.to_owned();
        let cancelled = self.cancelled.clone();
        future_to_promise(entry(async move {
            match engine.fetch(&id).await {
                Ok(outputs) => Ok(outputs_to_js(&outputs).into()),
                Err(e) => Err(to_js(&cancelled, e)),
            }
        }))
    }

    /// The node's inputs, fetching every predecessor.
    #[wasm_bindgen(js_name = fetchInputs)]
    pub fn fetch_inputs(&self, id: &str) -> Promise {
        let engine = self.shared.graph.engine().clone();
        let id = id.to_owned();
        let cancelled = self.cancelled.clone();
        future_to_promise(entry(async move {
            match engine.fetch_inputs(&id).await {
                Ok(inputs) => Ok(inputs_to_js(&inputs).into()),
                Err(e) => Err(to_js(&cancelled, e)),
            }
        }))
    }

    /// Clears the node's cache and everything downstream through the outputs it computes;
    /// without a node, every cache.
    pub fn reset(&self, id: Option<String>) -> Result<(), JsValue> {
        self.shared.touch(id.as_deref());
        self.shared
            .graph
            .engine()
            .reset(id.as_deref())
            .map_err(|e| to_js(&self.cancelled, e))
    }

    /// Gives the node `outputs` without running it, until something clears its cache.
    pub fn seed(&self, id: String, outputs: JsValue) {
        let seeded = ruggine_engine::Cancellable::resolved(Ok(Rc::new(outputs_from_js(outputs))));
        self.shared.graph.engine().cache().patch(id, seeded);
    }

    /// Clears the node's cache alone, cancelling a run in flight.
    pub fn forget(&self, id: &str) {
        self.shared.touch(Some(id));
        self.shared.graph.engine().cache().delete(id);
    }

    /// A field the core holds for a direct card (`cachedResult` and the rest); `undefined` where it holds none.
    pub fn shown(&self, id: &str, field: &str) -> JsValue {
        self.shared
            .graph
            .get_node(id)
            .and_then(|n| n.object.direct.as_ref().and_then(|d| d.shown(field)))
            .map_or(JsValue::UNDEFINED, |v| v.js())
    }

    /// JavaScript wrote a field the core holds for a direct card; `false` where it holds none for it.
    #[wasm_bindgen(js_name = setShown)]
    pub fn set_shown(&self, id: &str, field: &str, value: JsValue) -> bool {
        self.shared.graph.get_node(id).is_some_and(|n| {
            n.object
                .direct
                .as_ref()
                .is_some_and(|d| d.set_shown(field, value))
        })
    }

    /// The output `key` of node `id` as the last pass landed it; `undefined` before one did.
    pub fn landed(&self, id: &str, key: &str) -> JsValue {
        let landed = self.shared.landed.borrow();
        landed
            .get(id)
            .and_then(|outs| outs.iter().find(|(k, _)| k == key))
            .map(|(_, v)| v.clone())
            .map_or(JsValue::UNDEFINED, |v| v.js())
    }

    #[wasm_bindgen(js_name = isCached)]
    pub fn is_cached(&self, id: &str) -> bool {
        self.shared.graph.engine().cache().get(id).is_some()
    }

    /// `id` is a composite node here whose own editor's core is `inner`.
    pub fn nest(&self, id: String, inner: &GraphCore) {
        self.shared
            .nests
            .borrow_mut()
            .insert(id, Rc::downgrade(&inner.shared));
    }

    pub fn unnest(&self, id: &str) {
        self.shared.nests.borrow_mut().remove(id);
    }

    /// Marks every composite holding `id` (at any depth) as edited inside; the outermost one's id, or `undefined`
    /// when no composite here holds it.
    #[wasm_bindgen(js_name = markNested)]
    pub fn mark_nested(&self, id: &str) -> Option<String> {
        self.shared.mark_nested(id)
    }

    /// Seeds `#CIRC!` on every loop member (with `message`, or the default one) and returns them.
    #[wasm_bindgen(js_name = seedLoops)]
    pub fn seed_loops(&self, message: Option<String>) -> Vec<String> {
        let loops = self.shared.loop_set(false);
        self.shared
            .seed_loops(&loops, message.as_deref().unwrap_or(CIRC_MESSAGE));
        loops
    }

    /// The model pass (`computeAll`): what `changed` reaches cleared (every cache without it), the loops seeded,
    /// every node fetched. A `Map` of each node's outputs, `null` for one a reset cancelled.
    #[wasm_bindgen(js_name = computeAll)]
    pub fn compute_all(&self, changed: Option<String>) -> Promise {
        let g = &self.shared.graph;
        self.shared.touch(changed.as_deref());
        pass::invalidate(g.editor(), g.engine(), changed.as_deref(), false);
        self.seed_loops(None);
        self.fetch_all(None, false)
    }

    /// The app's pass body (compute-pass.md § The pass body): `changed` retargeted to the composite holding it,
    /// what it reaches cleared (a full pass clears everything; an additive one, `render_only`, nothing), the loop set
    /// (reused by a value edit's targeted pass) seeded, every node fetched in the editor's order and landed (its
    /// outputs held for the cable readouts, the change test against what it landed before). The nodes to re-render, in
    /// order; `null` when a reset cancelled the pass.
    pub fn pass(
        &self,
        changed: Option<String>,
        render_only: Option<Vec<String>>,
        topology: bool,
    ) -> Promise {
        let shared = self.shared.clone();
        let cancelled = self.cancelled.clone();
        let changed = changed.filter(|id| !id.is_empty()).map(|id| {
            if shared.graph.get_node(&id).is_some() {
                id
            } else {
                shared.mark_nested(&id).unwrap_or(id)
            }
        });
        let render_only: Option<FxHashSet<String>> =
            render_only.map(|ids| ids.into_iter().collect());
        if render_only.is_none() {
            shared.touch(changed.as_deref());
        }
        let (editor, engine) = (shared.graph.editor().clone(), shared.graph.engine().clone());
        let cone: Option<FxHashSet<String>> =
            pass::invalidate(&editor, &engine, changed.as_deref(), render_only.is_some())
                .map(|ids| ids.into_iter().collect());
        let loops = shared.loop_set(changed.is_some() && !topology);
        shared.seed_loops(&loops, CIRC_MESSAGE);
        let seeded = Cell::new(shared.wired.get());
        future_to_promise(entry(async move {
            // A cable added while the pass waits can close a loop the seeding never saw, and a fetch into it waits on
            // itself forever. A node's fetch starts its whole upstream at once, so re-seeding before each one does.
            let reseed = || {
                if seeded.get() != shared.wired.get() {
                    seeded.set(shared.wired.get());
                    shared.seed_loops(&shared.loop_set(false), CIRC_MESSAGE);
                }
            };
            reseed();
            let mut moved: FxHashSet<String> = FxHashSet::default();
            let mut sinks: FxHashSet<String> = FxHashSet::default();
            let landed = |id: &str, outputs: &Rc<Outputs<Val>>| {
                reseed();
                let differs = shared.land(id, outputs);
                if cone.is_some() {
                    if outputs.is_empty() {
                        sinks.insert(id.to_owned());
                    } else if differs {
                        moved.insert(id.to_owned());
                    }
                }
                Ok(())
            };
            match pass::fetch_all(&editor, &engine, landed, true).await {
                Ok(Some(_)) => {
                    let ids = pass::render_set(
                        &editor,
                        render_only.as_ref(),
                        cone.as_ref(),
                        &moved,
                        &sinks,
                    );
                    Ok(ids.into_iter().map(JsValue::from).collect::<Array>().into())
                }
                Ok(None) => Ok(JsValue::NULL),
                Err(e) => Err(to_js(&cancelled, e)),
            }
        }))
    }

    #[wasm_bindgen(js_name = loopMembers)]
    pub fn loop_members(&self) -> Vec<String> {
        pass::loop_members(self.shared.graph.editor())
    }

    #[wasm_bindgen(js_name = downstreamClosure)]
    pub fn downstream_closure(&self, id: &str) -> Vec<String> {
        pass::downstream_closure(self.shared.graph.editor(), id)
    }

    /// What a change to `id` reaches, its caches cleared; `undefined` without a node.
    pub fn invalidate(&self, id: Option<String>, keep_caches: bool) -> Option<Vec<String>> {
        if !keep_caches {
            self.shared.touch(id.as_deref());
        }
        pass::invalidate(
            self.shared.graph.editor(),
            self.shared.graph.engine(),
            id.as_deref(),
            keep_caches,
        )
    }

    /// Every node's outputs in the editor's order, as a `Map`; `null` when `stop_on_cancel` and
    /// a reset cancelled the pass. `on_node(id, outputs)` runs as each node lands.
    #[wasm_bindgen(js_name = fetchAll)]
    pub fn fetch_all(&self, on_node: Option<Function>, stop_on_cancel: bool) -> Promise {
        let (editor, engine, cancelled) = (
            self.shared.graph.editor().clone(),
            self.shared.graph.engine().clone(),
            self.cancelled.clone(),
        );
        future_to_promise(entry(async move {
            let mut objects = Vec::new();
            let landed = |id: &str, outputs: &Rc<Outputs<Val>>| {
                let object = outputs_to_js(outputs);
                objects.push(object.clone());
                match &on_node {
                    Some(f) => f
                        .call2(&JsValue::NULL, &JsValue::from_str(id), &object)
                        .map(drop)
                        .map_err(thrown),
                    None => Ok(()),
                }
            };
            match pass::fetch_all(&editor, &engine, landed, stop_on_cancel).await {
                Ok(Some(pulled)) => {
                    let values = Map::new();
                    let mut objects = objects.into_iter();
                    for (id, outputs) in pulled {
                        let value: JsValue = match outputs {
                            Some(_) => objects.next().expect("one object per landed node").into(),
                            None => JsValue::NULL,
                        };
                        values.set(&JsValue::from_str(&id), &value);
                    }
                    Ok(values.into())
                }
                Ok(None) => Ok(JsValue::NULL),
                Err(e) => Err(to_js(&cancelled, e)),
            }
        }))
    }
}

thread_local! {
    static SESSION: RefCell<Session> = RefCell::new(Session::default());
}

fn session<T>(f: impl FnOnce(&mut Session) -> T) -> T {
    SESSION.with(|s| f(&mut s.borrow_mut()))
}

/// The pass's state as the host caches it: `{ mode, dirty, forceExact, gen, rebuilding, topoDirty, passActive }`.
#[wasm_bindgen(js_name = sessionSnapshot)]
pub fn session_snapshot() -> Object {
    session(|s| {
        let o = Object::new();
        let set = |k: &str, v: JsValue| {
            let _ = Reflect::set(&o, &k.into(), &v);
        };
        set("mode", s.mode.name().into());
        set("dirty", s.dirty.into());
        set("forceExact", (s.force_exact as f64).into());
        set("gen", (s.recalc_gen as f64).into());
        set("rebuilding", (s.rebuilding as f64).into());
        set("topoDirty", s.topo_dirty.into());
        set("passActive", s.pass_active.into());
        o
    })
}

/// A fresh instance (after a trap) takes back the state the host last saw; the coalesced rerun is gone.
#[wasm_bindgen(js_name = sessionRestore)]
pub fn session_restore(snapshot: Object) {
    let get = |k: &str| Reflect::get(&snapshot, &k.into()).unwrap_or(JsValue::UNDEFINED);
    let count = |k: &str| get(k).as_f64().unwrap_or(0.0).max(0.0) as u64;
    session(|s| {
        *s = Session {
            mode: Mode::read(&get("mode").as_string().unwrap_or_default()),
            dirty: get("dirty").is_truthy(),
            force_exact: count("forceExact") as u32,
            recalc_gen: count("gen"),
            rebuilding: count("rebuilding") as u32,
            topo_dirty: get("topoDirty").is_truthy(),
            pass_active: get("passActive").is_truthy(),
            rerun: None,
        }
    });
}

/// `false` when `mode` is the mode already.
#[wasm_bindgen(js_name = sessionSetMode)]
pub fn session_set_mode(mode: &str) -> bool {
    session(|s| s.set_mode(Mode::read(mode)))
}

/// Sets (`true`) or clears the dirty flag; `true` on a transition.
#[wasm_bindgen(js_name = sessionDirty)]
pub fn session_dirty(dirty: bool) -> bool {
    session(|s| {
        if dirty {
            s.mark_dirty()
        } else {
            s.clear_dirty()
        }
    })
}

/// Opens (`true`) or closes a force-exact bracket.
#[wasm_bindgen(js_name = sessionForceExact)]
pub fn session_force_exact(begin: bool) {
    session(|s| {
        if begin {
            s.begin_force_exact()
        } else {
            s.end_force_exact()
        }
    })
}

/// A new recalc generation, which every volatile node rolls on.
#[wasm_bindgen(js_name = sessionNextGeneration)]
pub fn session_next_generation() -> f64 {
    session(|s| s.next_generation() as f64)
}

/// Opens (`true`) or closes a rebuild scope; closing answers whether none is open after it.
#[wasm_bindgen(js_name = sessionRebuild)]
pub fn session_rebuild(begin: bool) -> bool {
    session(|s| {
        if begin {
            s.begin_rebuild();
            false
        } else {
            s.end_rebuild()
        }
    })
}

/// `withGraphRebuild`'s scope: opening clears the topology flag; closing answers `[noneOpen, cableChanged]`.
#[wasm_bindgen(js_name = sessionRebuildScope)]
pub fn session_rebuild_scope(open: bool) -> Array {
    session(|s| {
        if open {
            s.open_rebuild_scope();
            Array::new()
        } else {
            let (outermost, topo) = s.close_rebuild_scope();
            Array::of2(&outermost.into(), &topo.into())
        }
    })
}

#[wasm_bindgen(js_name = sessionMarkTopoDirty)]
pub fn session_mark_topo_dirty() {
    session(Session::mark_topo_dirty)
}

/// A request for a pass: `"gated"` (manual mode marked the graph dirty), `"queued"` (a pass in flight reruns) or
/// `"run"`.
#[wasm_bindgen(js_name = sessionEnter)]
pub fn session_enter(changed: Option<String>, force: bool) -> String {
    match session(|s| s.enter(changed.as_deref(), force)) {
        Entry::Gated => "gated",
        Entry::Queued => "queued",
        Entry::Run => "run",
    }
    .into()
}

/// The pass ended (`finished` when it didn't throw): the rerun it owes as `{ force, exact, changed }`, or `null`.
#[wasm_bindgen(js_name = sessionExit)]
pub fn session_exit(finished: bool) -> JsValue {
    match session(|s| s.exit(finished)) {
        None => JsValue::NULL,
        Some(r) => {
            let o = Object::new();
            let _ = Reflect::set(&o, &"force".into(), &r.force.into());
            let _ = Reflect::set(&o, &"exact".into(), &r.exact.into());
            let changed: Array = r.changed.into_iter().map(JsValue::from).collect();
            let _ = Reflect::set(&o, &"changed".into(), &changed);
            o.into()
        }
    }
}
