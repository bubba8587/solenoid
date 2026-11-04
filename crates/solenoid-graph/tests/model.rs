// [[C130]] rustCore, [[graph-core#The model]], [[graph-core#The engine]]
use std::cell::RefCell;
use std::rc::Rc;

use netcore::classic::{self, Connection};
use netcore::future::{now_or_never, ready, LocalBoxFuture};
use netcore::keymap;
use netcore_engine::{Error, Inputs, Outputs};
use solenoid_graph::model::{Failure, Graph, Host, Side, Signal};
use solenoid_graph::pass::loop_members;

/// Nodes add one to the sum of their inputs; a pipe throws a `String`.
struct Test;

impl Host for Test {
    type Node = &'static str;
    type Connection = &'static str;
    type Value = f64;
    type Thrown = String;

    fn data<'a>(
        _: &'a Self::Node,
        _: &'a classic::Node,
        inputs: Inputs<f64>,
    ) -> LocalBoxFuture<'a, Result<Outputs<f64>, Error>> {
        let sum: f64 = inputs.values().flatten().sum();
        ready(Ok(keymap! { "out" => sum + 1.0 }))
    }

    fn missing_output(_: &str) -> Option<f64> {
        Some(f64::NAN)
    }
}

fn port(key: &str, ty: &str) -> (String, String) {
    (key.to_owned(), ty.to_owned())
}

fn cable(id: &str, source: &str, target: &str, input: &str) -> Connection {
    Connection {
        id: id.into(),
        source: source.into(),
        target: target.into(),
        source_output: "out".into(),
        target_input: input.into(),
    }
}

fn describe(signal: &Signal<Test>) -> String {
    use netcore::Root::*;
    match signal {
        NodeCreate(n) | NodeCreated(n) | NodeRemove(n) | NodeRemoved(n) => {
            format!("{} {}", signal.type_name(), n.object)
        }
        ConnectionCreate(c) | ConnectionCreated(c) | ConnectionRemove(c) | ConnectionRemoved(c) => {
            format!("{} {}", signal.type_name(), c.object)
        }
        _ => signal.type_name().to_owned(),
    }
}

fn logged(graph: &Graph<Test>) -> Rc<RefCell<Vec<String>>> {
    let log = Rc::new(RefCell::new(Vec::new()));
    let sink = log.clone();
    graph.add_pipe(move |s| {
        sink.borrow_mut().push(describe(s));
        Ok(true)
    });
    log
}

fn two_nodes(graph: &Graph<Test>) {
    graph
        .add_node("a".into(), "a", &[], &[port("out", "number")])
        .unwrap();
    graph
        .add_node(
            "b".into(),
            "b",
            &[port("x", "number")],
            &[port("out", "number")],
        )
        .unwrap();
}

#[test]
fn signals_come_in_rete_order() {
    let graph = Graph::<Test>::new();
    let log = logged(&graph);
    two_nodes(&graph);
    graph
        .add_connection(cable("c", "a", "b", "x"), "c")
        .unwrap();
    graph.clear().unwrap();
    assert_eq!(
        *log.borrow(),
        [
            "nodecreate a",
            "nodecreated a",
            "nodecreate b",
            "nodecreated b",
            "connectioncreate c",
            "connectioncreated c",
            "clear",
            "connectionremove c",
            "connectionremoved c",
            "noderemove a",
            "noderemoved a",
            "noderemove b",
            "noderemoved b",
            "cleared",
        ]
    );
    assert!(graph.node_ids().is_empty());
}

#[test]
fn a_pipe_cancels_a_change_it_is_told_of_first() {
    let graph = Graph::<Test>::new();
    graph.add_pipe(|s| Ok(!matches!(s, netcore::Root::NodeCreate(n) if n.object == "no")));
    let log = logged(&graph);
    assert!(!graph.add_node("n".into(), "no", &[], &[]).unwrap());
    assert!(graph.add_node("y".into(), "yes", &[], &[]).unwrap());
    assert_eq!(graph.node_ids(), ["y"]);
    assert_eq!(*log.borrow(), ["nodecreate yes", "nodecreated yes"]);

    graph.add_pipe(|s| Ok(!matches!(s, netcore::Root::Clear)));
    assert!(!graph.clear().unwrap());
    assert_eq!(graph.node_ids(), ["y"]);
    assert_eq!(log.borrow().last().unwrap(), "clearcancelled");
}

#[test]
fn a_throwing_pipe_stops_the_chain_and_fails_the_edit() {
    let graph = Graph::<Test>::new();
    graph.add_pipe(|s| match s {
        netcore::Root::NodeCreated(_) => Err("boom".to_owned()),
        _ => Ok(true),
    });
    let log = logged(&graph);
    match graph.add_node("a".into(), "a", &[], &[]) {
        Err(Failure::Thrown(e)) => assert_eq!(e, "boom"),
        other => panic!("{other:?}"),
    }
    assert_eq!(graph.node_ids(), ["a"]);
    assert_eq!(*log.borrow(), ["nodecreate a"]);
    assert!(graph.add_node("b".into(), "b", &[], &[]).is_err());
    assert!(matches!(graph.remove_node("b"), Ok(true)));
}

#[test]
fn a_removed_pipe_hears_nothing_more() {
    let graph = Graph::<Test>::new();
    let log = Rc::new(RefCell::new(0));
    let count = log.clone();
    let handle = graph.add_pipe(move |_| {
        *count.borrow_mut() += 1;
        Ok(true)
    });
    graph.add_node("a".into(), "a", &[], &[]).unwrap();
    assert!(graph.remove_pipe(handle));
    assert!(!graph.remove_pipe(handle));
    graph.add_node("b".into(), "b", &[], &[]).unwrap();
    assert_eq!(*log.borrow(), 2);
}

#[test]
fn rete_errors_keep_their_messages() {
    let graph = Graph::<Test>::new();
    graph.add_node("a".into(), "a", &[], &[]).unwrap();
    let msg = |r: Result<bool, Failure<String>>| match r {
        Err(Failure::Graph(e)) => e.to_string(),
        other => panic!("{other:?}"),
    };
    assert_eq!(
        msg(graph.add_node("a".into(), "a", &[], &[])),
        "node has already been added"
    );
    assert_eq!(msg(graph.remove_node("z")), "cannot find node");
    assert_eq!(msg(graph.remove_connection("z")), "cannot find connection");
}

#[test]
fn ports_keep_javascript_key_order_and_their_types() {
    let graph = Graph::<Test>::new();
    graph
        .add_node(
            "n".into(),
            "n",
            &[port("b", "number"), port("1", "list")],
            &[port("out", "number")],
        )
        .unwrap();
    let inputs = |ports: &[(&str, &str)]| ports.iter().map(|(k, t)| port(k, t)).collect::<Vec<_>>();
    let out = [port("out", "number")];
    graph
        .set_ports(
            "n",
            &inputs(&[
                ("b", "number"),
                ("1", "list"),
                ("a", "string"),
                ("0", "date"),
            ]),
            &out,
        )
        .unwrap();
    let keys = |g: &Graph<Test>| g.ports("n", Side::Input).unwrap();
    assert_eq!(
        keys(&graph),
        [
            port("0", "date"),
            port("1", "list"),
            port("b", "number"),
            port("a", "string")
        ]
    );
    assert!(graph
        .set_ports("n", &inputs(&[("a", "string"), ("a", "string")]), &out)
        .is_err());
    graph
        .set_ports(
            "n",
            &inputs(&[
                ("0", "date"),
                ("1", "list"),
                ("a", "frame"),
                ("b", "number"),
            ]),
            &out,
        )
        .unwrap();
    assert_eq!(
        keys(&graph),
        [
            port("0", "date"),
            port("1", "list"),
            port("a", "frame"),
            port("b", "number")
        ]
    );
    assert!(graph.set_ports("zz", &[], &out).is_err());
    assert_eq!(
        graph.ports("n", Side::Output).unwrap(),
        [port("out", "number")]
    );
}

#[test]
fn the_engine_reads_the_model_ports_and_registers_nodes_added_before_it() {
    let graph = Graph::<Test>::new();
    two_nodes(&graph);
    graph
        .add_connection(cable("c", "a", "b", "x"), "c")
        .unwrap();
    graph.use_engine().unwrap();
    let fetch = |id: &str| now_or_never(graph.engine().fetch(id)).unwrap().unwrap();
    assert_eq!(fetch("b").get("out"), Some(&2.0));

    graph.set_ports("b", &[], &[port("out", "number")]).unwrap();
    graph.engine().reset(None).unwrap();
    assert_eq!(fetch("b").get("out"), Some(&1.0));
    assert!(loop_members(graph.editor(), |_, _| false).is_empty());
}

#[test]
fn an_output_the_answer_leaves_out_fails_only_its_node() {
    let graph = Graph::<Test>::new();
    graph
        .add_node(
            "n".into(),
            "n",
            &[],
            &[port("out", "number"), port("extra", "number")],
        )
        .unwrap();
    graph.use_engine().unwrap();
    let got = now_or_never(graph.engine().fetch("n")).unwrap().unwrap();
    assert_eq!(got.get("out"), Some(&1.0));
    assert!(got.get("extra").is_some_and(|v| v.is_nan()));
}

#[test]
fn a_removed_node_leaves_the_engine_cache_at_once() {
    let graph = Graph::<Test>::new();
    two_nodes(&graph);
    graph.use_engine().unwrap();
    now_or_never(graph.engine().fetch("a")).unwrap().unwrap();
    assert!(graph.engine().cache().get("a").is_some());
    assert!(graph.remove_node("a").unwrap());
    assert!(graph.engine().cache().get("a").is_none());
}
