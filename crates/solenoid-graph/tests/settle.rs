// [[C10]] socketLattice, [[D99]] rustIsSpec, [[C139]] mathlibLaws
//! The Type Settle held to the frozen answers the TypeScript gave over every seed graph
//! (`fixtures/core/settle.json.gz`, written by `tests/graph/coreSettle.test.ts`).

use std::io::Read;

use serde_json::{json, Value as Json};
use solenoid_graph::conduit::Cable;
use solenoid_graph::settle::{node_from_json, settle, types_json};

fn frozen() -> Vec<Json> {
    let path = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("../../fixtures/core/settle.json.gz");
    let mut s = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(path).unwrap())
        .read_to_string(&mut s)
        .unwrap();
    serde_json::from_str(&s).unwrap()
}

#[test]
fn every_seed_graph_settles_as_frozen() {
    let cases = frozen();
    assert!(cases.len() > 60);
    let mut bad = Vec::new();
    for c in &cases {
        let mut nodes: Vec<_> = c["facts"]
            .as_array()
            .unwrap()
            .iter()
            .map(node_from_json)
            .collect();
        let cables: Vec<Cable> = c["cables"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| Cable {
                id: String::new(),
                source: x[0].as_str().unwrap().into(),
                source_output: x[1].as_str().unwrap().into(),
                target: x[2].as_str().unwrap().into(),
                target_input: x[3].as_str().unwrap().into(),
            })
            .collect();
        let settled = settle(&mut nodes, &cables);
        let got = json!({
            "types": types_json(&nodes),
            "conduitChanged": settled.conduit_changed,
            "adopted": settled.adopted.iter().collect::<Vec<_>>(),
        });
        let want = &c["want"];
        if got["conduitChanged"] != want["conduitChanged"] || got["adopted"] != want["adopted"] {
            bad.push(json!({ "graph": c["graph"], "got": [got["conduitChanged"], got["adopted"]], "want": [want["conduitChanged"], want["adopted"]] }));
            continue;
        }
        for (id, w) in want["types"].as_object().unwrap() {
            for side in ["ins", "outs"] {
                for (k, t) in w[side].as_object().unwrap() {
                    let g = &got["types"][id][side][k];
                    if g != t {
                        bad.push(json!({ "graph": c["graph"], "node": id, "side": side, "key": k, "got": g, "want": t }));
                    }
                }
            }
        }
    }
    assert!(
        bad.is_empty(),
        "{} differ: {}",
        bad.len(),
        serde_json::to_string_pretty(&bad[..bad.len().min(8)]).unwrap()
    );
}

/// Each port's type is a function of the ports upstream of it, so the answer is fixed by the wiring and a pass in
/// topological order settles any graph without loops (mathlib `Relation.church_rosser`'s order independence, here
/// by induction on depth). A chain of passthroughs listed against its wiring settles as one listed with it, at any
/// length; the old graph-order walk left the tail of a 257-card chain untyped (`tree/specs/values/socket-lattice.md` req. 9).
#[test]
fn a_chain_settles_whatever_order_its_cards_are_listed_in() {
    for n in [5, 300] {
        for backwards in [false, true] {
            let mut facts = vec![
                json!({"id": "src", "ins": [], "outs": [["out", "number", "number", 0]], "pass": []}),
            ];
            let mut cables = Vec::new();
            for i in 0..n {
                facts.push(json!({
                    "id": format!("p{i}"),
                    "ins": [["in", "trueany", "trueany", 2]],
                    "outs": [["out", "trueany", "trueany", 2]],
                    "pass": [{"output": "out", "inputs": ["in"], "combine": "single"}],
                }));
                let from = if i == 0 {
                    "src".to_string()
                } else {
                    format!("p{}", i - 1)
                };
                cables.push(Cable {
                    id: String::new(),
                    source: from,
                    source_output: "out".into(),
                    target: format!("p{i}"),
                    target_input: "in".into(),
                });
            }
            if backwards {
                facts[1..].reverse();
            }
            let mut nodes: Vec<_> = facts.iter().map(node_from_json).collect();
            let settled = settle(&mut nodes, &cables);
            let types = types_json(&nodes);
            assert_eq!(
                types[format!("p{}", n - 1)]["outs"]["out"],
                "number",
                "a chain of {n}, backwards {backwards}"
            );
            assert_eq!(settled.adopted.len(), n, "every passthrough adopted once");
        }
    }
}
