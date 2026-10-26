// [[C25]] firstClassUnits, [[D99]] rustIsSpec
//! The Format Controller reconcile held to the frozen answers the TypeScript gave over every seed graph three ways and
//! 300 seeded graphs (`fixtures/core/fc-reconcile.json.gz`, written by `tests/graph/coreFcReconcile.test.ts`).

use std::io::Read;

use serde_json::{json, Map, Value as Json};
use solenoid_graph::conduit::Cable;
use solenoid_graph::fc::{node_from_json, reconcile};

fn frozen() -> Vec<Json> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/core/fc-reconcile.json.gz");
    let mut s = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(path).unwrap())
        .read_to_string(&mut s)
        .unwrap();
    serde_json::from_str(&s).unwrap()
}

#[test]
fn every_fc_and_convert_answers_as_frozen() {
    let cases = frozen();
    assert!(cases.len() > 300);
    let mut bad = Vec::new();
    for c in &cases {
        let mut nodes: Vec<_> = c["facts"]
            .as_array()
            .unwrap()
            .iter()
            .map(node_from_json)
            .collect();
        let s = |x: &Json| x.as_str().unwrap().to_string();
        let cables: Vec<Cable> = c["cables"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| Cable {
                id: String::new(),
                source: s(&x[0]),
                source_output: s(&x[1]),
                target: s(&x[2]),
                target_input: s(&x[3]),
            })
            .collect();
        let r = reconcile(&mut nodes, &cables);
        let fcs: Map<String, Json> = r
            .fcs
            .iter()
            .map(|(id, t, d)| (id.clone(), json!([t, d])))
            .collect();
        let converts: Map<String, Json> = r
            .converts
            .iter()
            .map(|(id, u, d)| (id.clone(), json!([u, d])))
            .collect();
        if json!({ "fcs": fcs, "converts": converts }) != c["want"] {
            bad.push(c["graph"].to_string());
        }
    }
    assert!(bad.is_empty(), "{bad:#?}");
}
