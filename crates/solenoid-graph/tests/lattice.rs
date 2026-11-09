// [[C10]] socketLattice, [[D99]] rustIsSpec, [[C139]] mathlibLaws
//! The lattice held to the frozen answers the TypeScript gave (`fixtures/core/lattice.json.gz`, written by
//! `tests/graph/coreLattice.test.ts`).

use std::io::Read;

use serde_json::{json, Value as Json};
use solenoid_graph::lattice::{
    adopt_type_for_base, agree_types, can_connect, combo_of, element_family, lattice_rank,
    project_type_to_base, type_at_rank,
};

fn frozen() -> Vec<Json> {
    let path = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
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

/// mathlib `Preorder` (`Mathlib/Order/Defs/PartialOrder.lean`): widening is reflexive and transitive over the concrete
/// types, so a chain of passthroughs reaches nothing a direct cable can't. It is a preorder, not a partial order (a
/// list and its combo reach each other). The seven combo-to-scalar narrowing edges are checked steps and don't compose
/// (`tree/specs/values/socket-lattice.md` § The shape of what connects).
#[test]
fn widening_is_a_preorder_and_narrowing_does_not_compose() {
    use solenoid_graph::lattice::{is_wildcard_rung, TYPES};
    let concrete: Vec<&str> = TYPES
        .iter()
        .copied()
        .filter(|t| !is_wildcard_rung(t) && *t != "trueany")
        .collect();
    let narrowing = |a: &str, b: &str| matches!((lattice_rank(a), lattice_rank(b)), (Some(x), Some(y)) if x > y);
    let widens = |a: &str, b: &str| can_connect(a, b) && !narrowing(a, b);
    for a in &concrete {
        assert!(can_connect(a, a), "{a} reaches itself");
        for b in &concrete {
            for c in &concrete {
                assert!(
                    !(widens(a, b) && widens(b, c)) || widens(a, c),
                    "{a} -> {b} -> {c} doesn't compose"
                );
            }
        }
    }
    let mut narrow: Vec<String> = concrete
        .iter()
        .flat_map(|a| {
            concrete
                .iter()
                .filter(move |b| can_connect(a, b) && narrowing(a, b))
                .map(move |b| format!("{a}->{b}"))
        })
        .collect();
    narrow.sort();
    assert_eq!(
        narrow,
        [
            "complexcombo->complex",
            "datecombo->date",
            "logicalcombo->logical",
            "logicalcombo->number",
            "numlist->logical",
            "numlist->number",
            "strcombo->string"
        ]
    );
    assert!(
        can_connect("list", "numlist")
            && can_connect("numlist", "number")
            && !can_connect("list", "number")
    );
}
