// [[C10]] socketLattice, [[D99]] rustIsSpec
//! The lattice held to the frozen answers the TypeScript gave (`fixtures/core/lattice.json.gz`, written by
//! `tests/graph/coreLattice.test.ts`).

use std::io::Read;

use serde_json::{json, Value as Json};
use solenoid_graph::lattice::{
    adopt_type_for_base, agree_types, can_connect, combo_of, element_family, lattice_rank,
    project_type_to_base, type_at_rank,
};

fn frozen() -> Vec<Json> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/core/lattice.json.gz");
    let mut s = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(path).unwrap())
        .read_to_string(&mut s)
        .unwrap();
    serde_json::from_str(&s).unwrap()
}

#[test]
fn every_pair_type_and_vote_answers_as_frozen() {
    let cases = frozen();
    assert!(cases.len() > 31 * 31);
    let mut bad = Vec::new();
    for c in &cases {
        let s = |k: &str| c[k].as_str().unwrap();
        let got = match s("kind") {
            "pair" => json!({
                "connects": can_connect(s("a"), s("b")),
                "adopts": adopt_type_for_base(s("a"), s("b")),
                "projects": project_type_to_base(s("a"), s("b")),
            }),
            "one" => {
                let t = s("t");
                json!({
                    "rank": lattice_rank(t), "family": element_family(t), "combo": combo_of(t),
                    "atRank": [type_at_rank(t, 0), type_at_rank(t, 1), type_at_rank(t, 2)],
                })
            }
            _ => {
                let ts: Vec<Option<&str>> = c["ts"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(Json::as_str)
                    .collect();
                json!(agree_types(&ts))
            }
        };
        if got != c["want"] {
            bad.push(json!({ "case": c, "got": got }));
        }
    }
    assert!(
        bad.is_empty(),
        "{}",
        serde_json::to_string_pretty(&bad[..bad.len().min(5)]).unwrap()
    );
}
