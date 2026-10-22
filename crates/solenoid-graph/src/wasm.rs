// [[D102]] graphOnCore
//! The WebAssembly entry: one `GraphCore` per editor, mirroring its nodes and cables, the nodes
//! staying the app's JavaScript objects (`src/graph/dataflowEngine.ts` drives it).

use std::fmt;
use std::rc::Rc;

use js_sys::{Array, Function, Map, Object, Promise, Reflect};
use ruggine::classic::Connection;
use ruggine::future::{now_or_never, ready, LocalBoxFuture};
use ruggine::{GetSchemes, NodeBase, NodeEditor};
use ruggine_engine::{DataflowEngine, DataflowNode, Error, Inputs, Outputs, PortSelection};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::{future_to_promise, JsFuture};

use crate::pass;

/// A canvas node: its id and the JavaScript object whose `data()` computes it.
struct HostNode {
    id: String,
    object: Object,
    cancelled: Function,
}

type Host = GetSchemes<HostNode, Connection>;

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

impl NodeBase for HostNode {
    fn id(&self) -> &str {
        &self.id
    }
}

/// The object's own keys, as `Object.keys`; nothing for a missing or non-object value.
fn keys_of(value: &JsValue) -> Rc<[String]> {
    if !value.is_object() {
        return Rc::from([]);
    }
    Object::keys(value.unchecked_ref())
        .iter()
        .filter_map(|k| k.as_string())
        .collect()
}

fn port_keys(object: &Object, side: &str) -> Rc<[String]> {
    keys_of(&Reflect::get(object, &JsValue::from_str(side)).unwrap_or(JsValue::UNDEFINED))
}

fn outputs_from_js(value: JsValue) -> Outputs<JsValue> {
    let mut out = Outputs::new();
    if value.is_object() {
        for key in keys_of(&value).iter() {
            let v = Reflect::get(&value, &JsValue::from_str(key)).unwrap_or(JsValue::UNDEFINED);
            out.insert(key.as_str(), v);
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

impl DataflowNode<JsValue> for HostNode {
    fn data(&self, inputs: Inputs<JsValue>) -> LocalBoxFuture<'_, Result<Outputs<JsValue>, Error>> {
        let data = match Reflect::get(&self.object, &JsValue::from_str("data")) {
            Ok(f) if f.is_function() => f.unchecked_into::<Function>(),
            _ => {
                return ready(Err(thrown(
                    js_sys::TypeError::new("node.data is not a function").into(),
                )))
            }
        };
        match data.call1(&self.object, &inputs_to_js(&inputs)) {
            Err(e) => ready(Err(rejected(&self.cancelled, e))),
            Ok(result) if result.is_instance_of::<Promise>() => {
                let pending = JsFuture::from(result.unchecked_into::<Promise>());
                let cancelled = self.cancelled.clone();
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

/// One editor's mirror and its dataflow engine.
#[wasm_bindgen]
pub struct GraphCore {
    editor: NodeEditor<Host>,
    engine: DataflowEngine<Host, JsValue>,
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

fn settled<T>(
    f: impl std::future::Future<Output = Result<T, ruggine::Error>>,
) -> Result<T, JsValue> {
    match now_or_never(f) {
        Some(r) => r.map_err(|e| js_sys::Error::new(&e.to_string()).into()),
        None => Err(js_sys::Error::new(
            "the mirror has no async pipes, so its edits finish at once",
        )
        .into()),
    }
}

#[wasm_bindgen]
impl GraphCore {
    /// `cancelled` is the class of error a fetch cut short by a reset rejects with.
    #[wasm_bindgen(constructor)]
    pub fn new(cancelled: Function) -> GraphCore {
        let editor = NodeEditor::<Host>::new();
        let engine = DataflowEngine::with_configure(|node: &Rc<HostNode>| {
            let (a, b) = (node.clone(), node.clone());
            PortSelection {
                inputs: Box::new(move || port_keys(&a.object, "inputs")),
                outputs: Box::new(move || port_keys(&b.object, "outputs")),
            }
        });
        editor
            .use_scope(&engine)
            .expect("a fresh editor takes an engine");
        GraphCore {
            editor,
            engine,
            cancelled,
        }
    }

    #[wasm_bindgen(js_name = addNode)]
    pub fn add_node(&self, id: String, object: Object) -> Result<(), JsValue> {
        let cancelled = self.cancelled.clone();
        settled(self.editor.add_node(Rc::new(HostNode {
            id,
            object,
            cancelled,
        })))
        .map(drop)
    }

    #[wasm_bindgen(js_name = removeNode)]
    pub fn remove_node(&self, id: &str) -> Result<(), JsValue> {
        settled(self.editor.remove_node(id)).map(drop)
    }

    #[wasm_bindgen(js_name = addConnection)]
    pub fn add_connection(
        &self,
        id: String,
        source: String,
        source_output: String,
        target: String,
        target_input: String,
    ) -> Result<(), JsValue> {
        let c = Connection {
            id,
            source,
            target,
            source_output,
            target_input,
        };
        settled(self.editor.add_connection(Rc::new(c))).map(drop)
    }

    #[wasm_bindgen(js_name = removeConnection)]
    pub fn remove_connection(&self, id: &str) -> Result<(), JsValue> {
        settled(self.editor.remove_connection(id)).map(drop)
    }

    /// The node's outputs, from the cache when present.
    pub fn fetch(&self, id: &str) -> Promise {
        let pending = self.engine.fetch(id);
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
        let pending = self.engine.fetch_inputs(id);
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
        self.engine
            .reset(id.as_deref())
            .map_err(|e| to_js(&self.cancelled, e))
    }

    /// Gives the node `outputs` without running it, until something clears its cache.
    pub fn seed(&self, id: String, outputs: JsValue) {
        let seeded = ruggine_engine::Cancellable::resolved(Ok(Rc::new(outputs_from_js(outputs))));
        self.engine.cache().patch(id, seeded);
    }

    /// Clears the node's cache alone, cancelling a run in flight.
    pub fn forget(&self, id: &str) {
        self.engine.cache().delete(id);
    }

    #[wasm_bindgen(js_name = isCached)]
    pub fn is_cached(&self, id: &str) -> bool {
        self.engine.cache().get(id).is_some()
    }

    #[wasm_bindgen(js_name = loopMembers)]
    pub fn loop_members(&self) -> Vec<String> {
        pass::loop_members(&self.editor)
    }

    #[wasm_bindgen(js_name = downstreamClosure)]
    pub fn downstream_closure(&self, id: &str) -> Vec<String> {
        pass::downstream_closure(&self.editor, id)
    }

    /// What a change to `id` reaches, its caches cleared; `undefined` without a node.
    pub fn invalidate(&self, id: Option<String>, keep_caches: bool) -> Option<Vec<String>> {
        pass::invalidate(&self.editor, &self.engine, id.as_deref(), keep_caches)
    }

    /// Every node's outputs in the editor's order, as a `Map`; `null` when `stop_on_cancel` and
    /// a reset cancelled the pass. `on_node(id, outputs)` runs as each node lands.
    #[wasm_bindgen(js_name = fetchAll)]
    pub fn fetch_all(&self, on_node: Option<Function>, stop_on_cancel: bool) -> Promise {
        let (editor, engine, cancelled) = (
            self.editor.clone(),
            self.engine.clone(),
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
