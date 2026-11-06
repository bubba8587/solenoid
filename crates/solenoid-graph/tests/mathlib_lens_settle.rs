// Research prototype (branch research/mathlib-lens only): docs/audits/mathlib-lens-2026-11.md thread on the Type Settle.
//! On a graph without loops each port's type is a function of the ports upstream of it, so the settle's answer is
//! fixed by the wiring; only the number of passes depends on the visit order. Probes a chain of passthroughs listed
//! with and against the wiring.

use serde_json::json;
use solenoid_graph::conduit::Cable;
use solenoid_graph::settle::{node_from_json, settle, types_json};

fn chain(n: usize, backwards: bool) -> String {
    let mut facts = vec![json!({"id": "src", "ins": [], "outs": [["out", "number", "number", 0]], "pass": []})];
    let mut cables = Vec::new();
    for i in 0..n {
        facts.push(json!({
            "id": format!("p{i}"),
            "ins": [["in", "trueany", "trueany", 2]],
            "outs": [["out", "trueany", "trueany", 2]],
            "pass": [{"output": "out", "inputs": ["in"], "combine": "single"}],
        }));
        let from = if i == 0 { "src".to_string() } else { format!("p{}", i - 1) };
        cables.push(Cable { id: String::new(), source: from, source_output: "out".into(), target: format!("p{i}"), target_input: "in".into() });
    }
    if backwards {
        facts[1..].reverse();
    }
    let mut nodes: Vec<_> = facts.iter().map(node_from_json).collect();
    settle(&mut nodes, &cables);
    let types = types_json(&nodes);
    types[format!("p{}", n - 1)]["outs"]["out"].as_str().unwrap_or("?").to_string()
}

#[test]
fn a_chain_settles_whatever_the_order_within_the_caps() {
    for n in [5, 32, 33, 256, 257, 400] {
        let fwd = chain(n, false);
        let back = chain(n, true);
        println!("chain of {n:3}: listed with the wiring -> {fwd:8} listed against it -> {back}");
    }
}
