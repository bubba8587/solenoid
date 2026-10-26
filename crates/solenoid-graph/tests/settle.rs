// [[C10]] socketLattice, [[D99]] rustIsSpec
//! The Type Settle held to the frozen answers the TypeScript gave over every seed graph
//! (`fixtures/core/settle.json.gz`, written by `tests/graph/coreSettle.test.ts`).

use std::io::Read;

use serde_json::{json, Value as Json};
use solenoid_graph::settle::{node_from_json, settle, types_json, Cable};

fn frozen() -> Vec<Json> {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/core/settle.json.gz");
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
