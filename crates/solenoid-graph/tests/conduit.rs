// [[C10]] socketLattice, [[D99]] rustIsSpec
//! The Conduit walks held to the frozen answers the TypeScript gave over 300 seeded graphs
//! (`fixtures/core/conduit-walks.json.gz`, written by `tests/graph/coreConduitWalks.test.ts`).

use std::io::Read;

use serde_json::{json, Value as Json};
use solenoid_graph::conduit::{conduit_path, typed_source, Cable};

fn frozen() -> Vec<Json> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/core/conduit-walks.json.gz");
    let mut s = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(path).unwrap())
        .read_to_string(&mut s)
        .unwrap();
    serde_json::from_str(&s).unwrap()
}

#[test]
fn every_source_and_every_run_answers_as_frozen() {
    let cases = frozen();
    assert_eq!(cases.len(), 300);
    let mut bad = Vec::new();
    for (n, c) in cases.iter().enumerate() {
        let g = &c["graph"];
        let conduits: Vec<&str> = g["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|x| x["conduit"] == true)
            .map(|x| x["id"].as_str().unwrap())
            .collect();
        let is_conduit = |id: &str| conduits.contains(&id);
        let s = |x: &Json| x.as_str().unwrap().to_string();
        let cables: Vec<Cable> = g["cables"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| Cable {
                id: s(&x[0]),
                source: s(&x[1]),
                source_output: s(&x[2]),
                target: s(&x[3]),
                target_input: s(&x[4]),
            })
            .collect();
        for (port, want) in c["want"]["sources"].as_object().unwrap() {
            let (id, key) = port.split_once('.').unwrap();
            let got = typed_source(&is_conduit, &cables, id, key);
            if json!([got.0, got.1]) != *want {
                bad.push(json!({ "case": n, "port": port, "got": [got.0, got.1], "want": want }));
            }
        }
        for cable in &cables {
            let p = conduit_path(&is_conduit, &cables, cable);
            let got = json!({
                "connIds": p.conn_ids,
                "origin": [p.origin.0, p.origin.1],
                "terminals": p.terminals.iter().map(|(a, b)| json!([a, b])).collect::<Vec<_>>(),
                "conduits": p.conduits,
            });
            if got != c["want"]["paths"][&cable.id] {
                bad.push(json!({ "case": n, "cable": cable.id, "got": got, "want": c["want"]["paths"][&cable.id] }));
            }
        }
    }
    assert!(
        bad.is_empty(),
        "{} differ: {}",
        bad.len(),
        serde_json::to_string_pretty(&bad[..bad.len().min(6)]).unwrap()
    );
}
