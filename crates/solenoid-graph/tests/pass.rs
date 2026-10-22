// [[C23]] calcModes
use std::cell::RefCell;
use std::rc::Rc;

use ruggine::classic::Connection;
use ruggine::future::{now_or_never, ready, LocalBoxFuture};
use ruggine::{keymap, GetSchemes, NodeBase, NodeEditor};
use ruggine_engine::{DataflowEngine, DataflowNode, Error, Inputs, Outputs, PortSelection};
use solenoid_graph::pass::{downstream_closure, fetch_all, invalidate, loop_members};

/// Sums its inputs plus one onto `out`; logs each run.
struct N {
    id: String,
    log: Rc<RefCell<Vec<String>>>,
}

impl NodeBase for N {
    fn id(&self) -> &str {
        &self.id
    }
}

impl DataflowNode<f64> for N {
    fn data(&self, inputs: Inputs<f64>) -> LocalBoxFuture<'_, Result<Outputs<f64>, Error>> {
        self.log.borrow_mut().push(self.id.clone());
        let sum: f64 = inputs.values().flatten().sum();
        ready(Ok(keymap! { "out" => sum + 1.0 }))
    }
}

type S = GetSchemes<N, Connection>;

struct Graph {
    editor: NodeEditor<S>,
    engine: DataflowEngine<S, f64>,
    log: Rc<RefCell<Vec<String>>>,
}

fn graph(nodes: &[&str], cables: &[(&str, &str)]) -> Graph {
    let log = Rc::new(RefCell::new(Vec::new()));
    let editor = NodeEditor::<S>::new();
    let engine = DataflowEngine::with_configure(|_: &Rc<N>| PortSelection {
        inputs: Box::new(|| Rc::from(["in".to_owned()])),
        outputs: Box::new(|| Rc::from(["out".to_owned()])),
    });
    editor.use_scope(&engine).unwrap();
    for id in nodes {
        let node = Rc::new(N {
            id: id.to_string(),
            log: log.clone(),
        });
        now_or_never(editor.add_node(node)).unwrap().unwrap();
    }
    for (i, (s, t)) in cables.iter().enumerate() {
        let c = Connection {
            id: format!("c{i}"),
            source: s.to_string(),
            target: t.to_string(),
            source_output: "out".into(),
            target_input: "in".into(),
        };
        now_or_never(editor.add_connection(Rc::new(c)))
            .unwrap()
            .unwrap();
    }
    Graph {
        editor,
        engine,
        log,
    }
}

#[test]
fn loop_members_lists_self_loops_then_each_cycle() {
    let g = graph(
        &["a", "b", "c", "d", "e"],
        &[("a", "b"), ("b", "c"), ("c", "b"), ("e", "e"), ("c", "d")],
    );
    assert_eq!(loop_members(&g.editor), ["e", "c", "b"]);
}

#[test]
fn loop_members_is_empty_on_a_dag() {
    let g = graph(&["a", "b", "c"], &[("a", "b"), ("a", "c"), ("b", "c")]);
    assert!(loop_members(&g.editor).is_empty());
}

#[test]
fn loop_members_survives_a_long_ring() {
    let ids: Vec<String> = (0..50_000).map(|i| format!("n{i}")).collect();
    let refs: Vec<&str> = ids.iter().map(String::as_str).collect();
    let mut cables: Vec<(&str, &str)> = refs.windows(2).map(|w| (w[0], w[1])).collect();
    cables.push((refs[refs.len() - 1], refs[0]));
    let g = graph(&refs, &cables);
    assert_eq!(loop_members(&g.editor).len(), 50_000);
}

#[test]
fn downstream_closure_walks_breadth_first_through_cycles() {
    let g = graph(
        &["a", "b", "c", "d"],
        &[("a", "c"), ("a", "b"), ("b", "d"), ("d", "a")],
    );
    assert_eq!(downstream_closure(&g.editor, "a"), ["a", "c", "b", "d"]);
    assert_eq!(downstream_closure(&g.editor, "gone"), ["gone"]);
}

#[test]
fn invalidate_clears_only_what_the_change_reaches() {
    let g = graph(&["a", "b", "c"], &[("a", "b")]);
    now_or_never(fetch_all(&g.editor, &g.engine, |_, _| Ok(()), false))
        .unwrap()
        .unwrap();
    assert_eq!(
        invalidate(&g.editor, &g.engine, Some("a"), false).unwrap(),
        ["a", "b"]
    );
    assert!(g.engine.cache().get("c").is_some());
    assert!(g.engine.cache().get("b").is_none());
    assert_eq!(invalidate(&g.editor, &g.engine, None, true), None);
    assert!(g.engine.cache().get("c").is_some());
    invalidate(&g.editor, &g.engine, None, false);
    assert!(g.engine.cache().get("c").is_none());
}

#[test]
fn fetch_all_pulls_in_editor_order_and_runs_each_node_once() {
    let g = graph(&["b", "a"], &[("a", "b")]);
    let mut landed = Vec::new();
    let values = now_or_never(fetch_all(
        &g.editor,
        &g.engine,
        |id, out| {
            landed.push((id.to_owned(), out["out"]));
            Ok(())
        },
        false,
    ))
    .unwrap()
    .unwrap()
    .unwrap();
    assert_eq!(landed, [("b".to_owned(), 2.0), ("a".to_owned(), 1.0)]);
    assert_eq!(values.len(), 2);
    assert_eq!(*g.log.borrow(), ["a", "b"]);
}

#[test]
fn fetch_all_stops_or_records_a_cancelled_node() {
    let g = graph(&["a", "b"], &[]);
    let engine = g.engine.clone();
    let stopped = now_or_never(fetch_all(
        &g.editor,
        &g.engine,
        |id, _| {
            if id == "a" {
                engine.cache().patch(
                    "b".into(),
                    ruggine_engine::Cancellable::resolved(Err(Error::Cancelled)),
                );
            }
            Ok(())
        },
        true,
    ))
    .unwrap()
    .unwrap();
    assert!(stopped.is_none());
    let recorded = now_or_never(fetch_all(&g.editor, &g.engine, |_, _| Ok(()), false))
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(recorded[1].1.is_none());
}

#[test]
fn a_seeded_loop_returns_its_seed() {
    let g = graph(&["a", "b"], &[("a", "b"), ("b", "a")]);
    for id in loop_members(&g.editor) {
        g.engine.cache().patch(
            id,
            ruggine_engine::Cancellable::resolved(Ok(Rc::new(keymap! { "out" => -1.0 }))),
        );
    }
    let values = now_or_never(fetch_all(&g.editor, &g.engine, |_, _| Ok(()), false))
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(values[0].1.as_ref().unwrap()["out"], -1.0);
    assert!(g.log.borrow().is_empty());
}
