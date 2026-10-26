// [[C25]] firstClassUnits, [[D41]] formatFlowsDownstream, [[D99]] rustIsSpec
//! The annotation walk held to the frozen answers the TypeScript gave over every seed graph, three ways
//! (`fixtures/core/annotations.json.gz`, written by `tests/graph/coreAnnotations.test.ts`).

use std::io::Read;

use serde_json::Value as Json;
use solenoid_graph::annotate::{resolve_all, Node};
use solenoid_graph::conduit::Cable;

fn frozen() -> Vec<Json> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/core/annotations.json.gz");
    let mut s = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(path).unwrap())
        .read_to_string(&mut s)
        .unwrap();
    serde_json::from_str(&s).unwrap()
}

#[test]
fn every_annotation_and_origin_answers_as_frozen() {
    let cases = frozen();
    assert!(cases.len() > 60);
    let mut bad = Vec::new();
    for c in &cases {
        let nodes: Vec<Node> = c["facts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| Node {
                id: f["id"].as_str().unwrap().to_string(),
                facts: f,
            })
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
        let got = resolve_all(&nodes, &cables);
        for part in ["out", "down", "in", "origin"] {
            if got[part] != c["want"][part] {
                bad.push(format!("{} {part}", c["graph"]));
            }
        }
    }
    assert!(bad.is_empty(), "{bad:#?}");
}
