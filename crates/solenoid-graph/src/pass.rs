// [[C23]] calcModes
//! The compute pass's walks over the graph: which nodes sit on a cycle, what a change reaches,
//! clearing what it reaches, and pulling every node in the editor's order.

use std::rc::Rc;

use ruggine::classic::ClassicConnection;
use ruggine::fxhash::{FxHashMap, FxHashSet};
use ruggine::{ConnectionBase, NodeBase, NodeEditor, Schemes};
use ruggine_engine::{DataflowEngine, DataflowNode, Error, Outputs};

/// Every node on a cycle: self-loops first, in cable order, then each strongly connected
/// component of two or more as Tarjan's walk closes it.
pub fn loop_members<S: Schemes>(editor: &NodeEditor<S>) -> Vec<String> {
    let ids: Vec<String> = editor
        .get_nodes()
        .iter()
        .map(|n| n.id().to_owned())
        .collect();
    let slot: FxHashMap<&str, usize> = ids
        .iter()
        .enumerate()
        .map(|(i, id)| (id.as_str(), i))
        .collect();
    let mut adj: Vec<Vec<usize>> = vec![Vec::new(); ids.len()];
    let mut members = Vec::new();
    let mut seen = FxHashSet::default();
    for c in editor.get_connections() {
        if c.source() == c.target() {
            if seen.insert(c.source().to_owned()) {
                members.push(c.source().to_owned());
            }
            continue;
        }
        if let (Some(&s), Some(&t)) = (slot.get(c.source()), slot.get(c.target())) {
            if !adj[s].contains(&t) {
                adj[s].push(t);
            }
        }
    }
    const NONE: usize = usize::MAX;
    let mut index = vec![NONE; ids.len()];
    let mut low = vec![0; ids.len()];
    let mut on_stack = vec![false; ids.len()];
    let mut stack = Vec::new();
    let mut counter = 0;
    for start in 0..ids.len() {
        if index[start] != NONE {
            continue;
        }
        let mut work = vec![(start, 0usize)];
        while let Some(&mut (v, ref mut i)) = work.last_mut() {
            if *i == 0 && index[v] == NONE {
                index[v] = counter;
                low[v] = counter;
                counter += 1;
                stack.push(v);
                on_stack[v] = true;
            }
            if *i < adj[v].len() {
                let w = adj[v][*i];
                *i += 1;
                if index[w] == NONE {
                    work.push((w, 0));
                } else if on_stack[w] {
                    low[v] = low[v].min(index[w]);
                }
                continue;
            }
            if low[v] == index[v] {
                let mut component = Vec::new();
                loop {
                    let w = stack.pop().expect("v is on the stack");
                    on_stack[w] = false;
                    component.push(w);
                    if w == v {
                        break;
                    }
                }
                if component.len() > 1 {
                    for w in component {
                        if seen.insert(ids[w].clone()) {
                            members.push(ids[w].clone());
                        }
                    }
                }
            }
            work.pop();
            if let Some(&(parent, _)) = work.last() {
                low[parent] = low[parent].min(low[v]);
            }
        }
    }
    members
}

/// `start` and everything its cables reach, in breadth-first order. Follows every cable, not
/// only the outputs the engine computes.
pub fn downstream_closure<S: Schemes>(editor: &NodeEditor<S>, start: &str) -> Vec<String> {
    let mut seen = FxHashSet::default();
    seen.insert(start.to_owned());
    let mut queue = vec![start.to_owned()];
    let mut head = 0;
    while head < queue.len() {
        let id = queue[head].clone();
        head += 1;
        for c in editor.get_connections_from(&id) {
            if seen.insert(c.target().to_owned()) {
                queue.push(c.target().to_owned());
            }
        }
    }
    queue
}

/// Clears what a change to `changed` reaches and returns it; with no node, clears every cache
/// unless `keep_caches`, and returns `None`. Walks with a visited set, so a cable cycle can't
/// trap it.
pub fn invalidate<S, V>(
    editor: &NodeEditor<S>,
    engine: &DataflowEngine<S, V>,
    changed: Option<&str>,
    keep_caches: bool,
) -> Option<Vec<String>>
where
    S: Schemes,
    S::Node: DataflowNode<V>,
    S::Connection: ClassicConnection,
    V: Clone + 'static,
{
    let Some(changed) = changed.filter(|id| !id.is_empty()) else {
        if !keep_caches {
            engine.cache().clear();
        }
        return None;
    };
    let cone = downstream_closure(editor, changed);
    for id in &cone {
        engine.cache().delete(id.as_str());
    }
    Some(cone)
}

/// One node's pull in [`fetch_all`]: its outputs, or `None` when a reset cancelled it.
pub type Pulled<V> = (String, Option<Rc<Outputs<V>>>);

/// Fetches every node in the editor's order, skipping one removed mid-pass. A cancelled fetch
/// records `None`, or ends the pass with `Ok(None)` under `stop_on_cancel`; any other error ends
/// it with that error.
pub async fn fetch_all<S, V>(
    editor: &NodeEditor<S>,
    engine: &DataflowEngine<S, V>,
    mut on_node: impl FnMut(&str, &Rc<Outputs<V>>) -> Result<(), Error>,
    stop_on_cancel: bool,
) -> Result<Option<Vec<Pulled<V>>>, Error>
where
    S: Schemes,
    S::Node: DataflowNode<V>,
    S::Connection: ClassicConnection,
    V: Clone + 'static,
{
    let mut out = Vec::new();
    for node in editor.get_nodes() {
        let id = node.id().to_owned();
        if editor.get_node(&id).is_none() {
            continue;
        }
        match engine.fetch(&id).await {
            Ok(outputs) => {
                on_node(&id, &outputs)?;
                out.push((id, Some(outputs)));
            }
            Err(Error::Cancelled) if stop_on_cancel => return Ok(None),
            Err(Error::Cancelled) => out.push((id, None)),
            Err(e) => return Err(e),
        }
    }
    Ok(Some(out))
}
