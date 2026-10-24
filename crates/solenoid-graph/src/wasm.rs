// [[D102]] graphOnCore
//! The WebAssembly entry: one `GraphCore` per editor, holding its graph (`model.rs`) with the nodes'
//! and cables' JavaScript objects, the pipes `src/graph/graphEditor.ts` adds, and the dataflow
//! engine `src/graph/dataflowEngine.ts` drives.

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
use crate::model::{Failure, Graph, Host, Port, Side, Signal};
use crate::pass;
use crate::session::{Entry, Mode, Session};

/// A canvas node's JavaScript object, whose `data()` computes it, and what its class is.
struct JsNode {
    object: Object,
    cancelled: Function,
    facts: Facts,
    /// The editor's engine runs nodes through the input boundary (`boundary.rs`); off for a raw engine.
    boundary: Rc<Cell<bool>>,
}

struct Js;

impl Host for Js {
    type Node = JsNode;
    type Connection = JsValue;
    type Value = JsValue;
    type Thrown = JsValue;

    fn data<'a>(
        node: &'a JsNode,
        ports: &'a classic::Node,
        inputs: Inputs<JsValue>,
    ) -> LocalBoxFuture<'a, Result<Outputs<JsValue>, Error>> {
        if node.boundary.get() {
            return boundary::call(&node.object, &node.facts, ports, inputs, None);
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

fn outputs_from_js(value: JsValue) -> Outputs<JsValue> {
    let mut out = Outputs::new();
    if value.is_object() {
        for key in keys_of(&value) {
            let v = Reflect::get(&value, &JsValue::from_str(&key)).unwrap_or(JsValue::UNDEFINED);
            out.insert(key, v);
        }
    }
    out
}

fn outputs_to_js(outputs: &Outputs<JsValue>) -> Object {
    let object = Object::new();
    for (key, value) in outputs.iter() {
        let _ = Reflect::set(&object, &JsValue::from_str(key), value);
    }
    object
}

fn inputs_to_js(inputs: &Inputs<JsValue>) -> Object {
    let object = Object::new();
    for (key, values) in inputs.iter() {
        let list: Array = values.iter().collect();
        let _ = Reflect::set(&object, &JsValue::from_str(key), &list);
    }
    object
}

thread_local! {
    static ON_PANIC: RefCell<Option<Function>> = const { RefCell::new(None) };
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
    let mut pending = Box::pin(async move {
        let (ports, facts) = (ports_of(&node), Facts::of(&node));
        boundary::call(&node, &facts, &ports, given, data.as_ref()).await
    });
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
        Poll::Ready(Ok(outputs)) => Ok(outputs_to_js(&outputs).into()),
        Poll::Ready(Err(e)) => Err(error(e)),
        Poll::Pending => Ok(future_to_promise(async move {
            pending
                .await
                .map(|o| outputs_to_js(&o).into())
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
    /// never fetches into a cycle ([[compute-pass]] § The model pass).
    fn seed_loops(&self, members: &[String], message: &str) {
        if members.is_empty() {
            return;
        }
        let circ = boundary::sol_error("#CIRC!", message);
        for id in members {
            let Some(node) = self.graph.get_node(id) else {
                continue;
            };
            let mut outputs = Outputs::new();
            for key in node.classic.outputs().keys() {
                outputs.insert(key.to_owned(), circ.clone());
            }
            let object = &node.object.object;
            for field in [
                "cachedResult",
                "cachedValue",
                "cachedList",
                "cachedChart",
                "cachedPayload",
            ] {
                let key = JsValue::from_str(field);
                if Reflect::has(object, &key).unwrap_or(false) {
                    let v = if field == "cachedPayload" {
                        JsValue::NULL
                    } else {
                        circ.clone()
                    };
                    let _ = Reflect::set(object, &key, &v);
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
    /// `cancelled` is the class of error a fetch cut short by a reset rejects with.
    #[wasm_bindgen(constructor)]
    pub fn new(cancelled: Function) -> GraphCore {
        GraphCore {
            shared: Rc::new(Shared {
                graph: Graph::new(),
                nests: RefCell::new(FxHashMap::default()),
                loops: RefCell::new(None),
            }),
            cancelled,
            boundary: Rc::new(Cell::new(false)),
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
        let given = inputs_from_js(&inputs);
        future_to_promise(async move {
            let Some(node) = node else {
                return Err(js_sys::Error::new("cannot find node").into());
            };
            match Js::data(&node.object, &node.classic, given).await {
                Ok(outputs) => Ok(outputs_to_js(&outputs).into()),
                Err(e) => Err(to_js(&cancelled, e)),
            }
        })
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
        let node = JsNode {
            facts: Facts::of(&object),
            object,
            cancelled: self.cancelled.clone(),
            boundary: self.boundary.clone(),
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
        self.shared.graph.remove_node(id).map_err(failed)
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
        self.shared.graph.add_connection(c, object).map_err(failed)
    }

    /// `false` when a `connectionremove` pipe cancelled it.
    #[wasm_bindgen(js_name = removeConnection)]
    pub fn remove_connection(&self, id: &str) -> Result<bool, JsValue> {
        self.shared.graph.remove_connection(id).map_err(failed)
    }

    /// Every cable, then every node; `false` when a `clear` pipe cancelled it.
    pub fn clear(&self) -> Result<bool, JsValue> {
        self.shared.graph.clear().map_err(failed)
    }

    #[wasm_bindgen(js_name = addPort)]
    pub fn add_port(&self, id: &str, output: bool, key: &str, ty: &str) -> Result<(), JsValue> {
        self.shared
            .graph
            .add_port(id, side(output), key, ty)
            .map_err(graph_error)
    }

    #[wasm_bindgen(js_name = removePort)]
    pub fn remove_port(&self, id: &str, output: bool, key: &str) -> Result<bool, JsValue> {
        self.shared
            .graph
            .remove_port(id, side(output), key)
            .map_err(graph_error)
    }

    #[wasm_bindgen(js_name = retypePort)]
    pub fn retype_port(
        &self,
        id: &str,
        output: bool,
        key: &str,
        ty: &str,
    ) -> Result<bool, JsValue> {
        self.shared
            .graph
            .retype_port(id, side(output), key, ty)
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

    /// The node's outputs, from the cache when present.
    pub fn fetch(&self, id: &str) -> Promise {
        let pending = self.shared.graph.engine().fetch(id);
        let cancelled = self.cancelled.clone();
        future_to_promise(async move {
            match pending.await {
                Ok(outputs) => Ok(outputs_to_js(&outputs).into()),
                Err(e) => Err(to_js(&cancelled, e)),
            }
        })
    }

    /// The node's inputs, fetching every predecessor.
    #[wasm_bindgen(js_name = fetchInputs)]
    pub fn fetch_inputs(&self, id: &str) -> Promise {
        let pending = self.shared.graph.engine().fetch_inputs(id);
        let cancelled = self.cancelled.clone();
        future_to_promise(async move {
            match pending.await {
                Ok(inputs) => Ok(inputs_to_js(&inputs).into()),
                Err(e) => Err(to_js(&cancelled, e)),
            }
        })
    }

    /// Clears the node's cache and everything downstream through the outputs it computes;
    /// without a node, every cache.
    pub fn reset(&self, id: Option<String>) -> Result<(), JsValue> {
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
        self.shared.graph.engine().cache().delete(id);
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
        pass::invalidate(g.editor(), g.engine(), changed.as_deref(), false);
        self.seed_loops(None);
        self.fetch_all(None, false)
    }

    /// The app's pass body ([[compute-pass]] § The pass body): `changed` retargeted to the composite holding it,
    /// what it reaches cleared (a full pass clears everything; an additive one, `render_only`, nothing), the loop set
    /// (reused by a value edit's targeted pass) seeded, every node fetched in the editor's order with `on_node(id,
    /// outputs)` answering whether its outputs changed. The nodes to re-render, in order; `null` when a reset
    /// cancelled the pass.
    pub fn pass(
        &self,
        changed: Option<String>,
        render_only: Option<Vec<String>>,
        topology: bool,
        on_node: Function,
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
        let (editor, engine) = (shared.graph.editor().clone(), shared.graph.engine().clone());
        let cone: Option<FxHashSet<String>> =
            pass::invalidate(&editor, &engine, changed.as_deref(), render_only.is_some())
                .map(|ids| ids.into_iter().collect());
        let loops = shared.loop_set(changed.is_some() && !topology);
        shared.seed_loops(&loops, CIRC_MESSAGE);
        future_to_promise(async move {
            let mut moved: FxHashSet<String> = FxHashSet::default();
            let mut sinks: FxHashSet<String> = FxHashSet::default();
            let landed = |id: &str, outputs: &Rc<Outputs<JsValue>>| {
                let object = outputs_to_js(outputs);
                let differs = on_node
                    .call2(&JsValue::NULL, &JsValue::from_str(id), &object)
                    .map_err(thrown)?
                    .is_truthy();
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
        })
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
        future_to_promise(async move {
            let mut objects = Vec::new();
            let landed = |id: &str, outputs: &Rc<Outputs<JsValue>>| {
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
        })
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
