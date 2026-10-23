// [[D102]] graphOnCore
//! The WebAssembly entry: one `GraphCore` per editor, holding its graph (`model.rs`) with the nodes'
//! and cables' JavaScript objects, the pipes `src/graph/graphEditor.ts` adds, and the dataflow
//! engine `src/graph/dataflowEngine.ts` drives.

use std::cell::RefCell;
use std::fmt;
use std::rc::Rc;

use js_sys::{Array, Function, Map, Object, Promise, Reflect};
use ruggine::classic::Connection;
use ruggine::future::{ready, LocalBoxFuture};
use ruggine::Root;
use ruggine_engine::{Error, Inputs, Outputs};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::{future_to_promise, JsFuture};

use crate::model::{Failure, Graph, Host, Port, Side, Signal};
use crate::pass;

/// A canvas node's JavaScript object, whose `data()` computes it.
struct JsNode {
    object: Object,
    cancelled: Function,
}

struct Js;

impl Host for Js {
    type Node = JsNode;
    type Connection = JsValue;
    type Value = JsValue;
    type Thrown = JsValue;

    fn data(
        node: &JsNode,
        inputs: Inputs<JsValue>,
    ) -> LocalBoxFuture<'_, Result<Outputs<JsValue>, Error>> {
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

fn thrown(value: JsValue) -> Error {
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

/// Panics: the tests' trigger for the recovery (`graphTrap.test.ts`).
#[wasm_bindgen(js_name = graphTrap)]
pub fn graph_trap() {
    panic!("graph_trap");
}

/// One editor's graph and its dataflow engine.
#[wasm_bindgen]
pub struct GraphCore {
    graph: Graph<Js>,
    cancelled: Function,
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
            graph: Graph::new(),
            cancelled,
        }
    }

    /// Adds `pipe(type, data)` after every pipe already here: it answers truthy to go on, falsy to
    /// stop the chain (cancelling the change a present-tense signal announces), and what it
    /// throws stops the chain and fails the edit. Returns the handle `removePipe` takes.
    #[wasm_bindgen(js_name = addPipe)]
    pub fn add_pipe(&self, pipe: Function) -> usize {
        self.graph.add_pipe(move |signal| {
            let (kind, data) = signal_to_js(signal);
            pipe.call2(&JsValue::NULL, &kind, &data)
                .map(|go| go.is_truthy())
        })
    }

    #[wasm_bindgen(js_name = removePipe)]
    pub fn remove_pipe(&self, handle: usize) -> bool {
        self.graph.remove_pipe(handle)
    }

    /// Attaches the engine here in the chain, registering the nodes already in the editor.
    #[wasm_bindgen(js_name = useEngine)]
    pub fn use_engine(&self) -> Result<(), JsValue> {
        self.graph.use_engine().map_err(failed)
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
            object,
            cancelled: self.cancelled.clone(),
        };
        self.graph
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
        self.graph.remove_node(id).map_err(failed)
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
        self.graph.add_connection(c, object).map_err(failed)
    }

    /// `false` when a `connectionremove` pipe cancelled it.
    #[wasm_bindgen(js_name = removeConnection)]
    pub fn remove_connection(&self, id: &str) -> Result<bool, JsValue> {
        self.graph.remove_connection(id).map_err(failed)
    }

    /// Every cable, then every node; `false` when a `clear` pipe cancelled it.
    pub fn clear(&self) -> Result<bool, JsValue> {
        self.graph.clear().map_err(failed)
    }

    #[wasm_bindgen(js_name = addPort)]
    pub fn add_port(&self, id: &str, output: bool, key: &str, ty: &str) -> Result<(), JsValue> {
        self.graph
            .add_port(id, side(output), key, ty)
            .map_err(graph_error)
    }

    #[wasm_bindgen(js_name = removePort)]
    pub fn remove_port(&self, id: &str, output: bool, key: &str) -> Result<bool, JsValue> {
        self.graph
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
        self.graph
            .retype_port(id, side(output), key, ty)
            .map_err(graph_error)
    }

    /// The node's ports on one side as `[key, type]` pairs, in order; `undefined` for a node not
    /// here.
    pub fn ports(&self, id: &str, output: bool) -> Option<Array> {
        self.graph.ports(id, side(output)).map(|ports| {
            ports
                .into_iter()
                .map(|(k, t)| Array::of2(&JsValue::from_str(&k), &JsValue::from_str(&t)))
                .collect()
        })
    }

    /// Puts the nodes in `order`, which must name every node once; `false` when it doesn't.
    #[wasm_bindgen(js_name = reorderNodes)]
    pub fn reorder_nodes(&self, order: Vec<String>) -> bool {
        self.graph.reorder_nodes(&order)
    }

    #[wasm_bindgen(js_name = nodeIds)]
    pub fn node_ids(&self) -> Vec<String> {
        self.graph.node_ids()
    }

    #[wasm_bindgen(js_name = connectionIds)]
    pub fn connection_ids(&self) -> Vec<String> {
        self.graph.connection_ids()
    }

    /// The node's outputs, from the cache when present.
    pub fn fetch(&self, id: &str) -> Promise {
        let pending = self.graph.engine().fetch(id);
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
        let pending = self.graph.engine().fetch_inputs(id);
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
        self.graph
            .engine()
            .reset(id.as_deref())
            .map_err(|e| to_js(&self.cancelled, e))
    }

    /// Gives the node `outputs` without running it, until something clears its cache.
    pub fn seed(&self, id: String, outputs: JsValue) {
        let seeded = ruggine_engine::Cancellable::resolved(Ok(Rc::new(outputs_from_js(outputs))));
        self.graph.engine().cache().patch(id, seeded);
    }

    /// Clears the node's cache alone, cancelling a run in flight.
    pub fn forget(&self, id: &str) {
        self.graph.engine().cache().delete(id);
    }

    #[wasm_bindgen(js_name = isCached)]
    pub fn is_cached(&self, id: &str) -> bool {
        self.graph.engine().cache().get(id).is_some()
    }

    #[wasm_bindgen(js_name = loopMembers)]
    pub fn loop_members(&self) -> Vec<String> {
        pass::loop_members(self.graph.editor())
    }

    #[wasm_bindgen(js_name = downstreamClosure)]
    pub fn downstream_closure(&self, id: &str) -> Vec<String> {
        pass::downstream_closure(self.graph.editor(), id)
    }

    /// What a change to `id` reaches, its caches cleared; `undefined` without a node.
    pub fn invalidate(&self, id: Option<String>, keep_caches: bool) -> Option<Vec<String>> {
        pass::invalidate(
            self.graph.editor(),
            self.graph.engine(),
            id.as_deref(),
            keep_caches,
        )
    }

    /// Every node's outputs in the editor's order, as a `Map`; `null` when `stop_on_cancel` and
    /// a reset cancelled the pass. `on_node(id, outputs)` runs as each node lands.
    #[wasm_bindgen(js_name = fetchAll)]
    pub fn fetch_all(&self, on_node: Option<Function>, stop_on_cancel: bool) -> Promise {
        let (editor, engine, cancelled) = (
            self.graph.editor().clone(),
            self.graph.engine().clone(),
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
