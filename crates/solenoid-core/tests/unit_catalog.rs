//! [[C25]] firstClassUnits: the core's unit catalog resolves every id as the TS did
//! (`fixtures/core/unit-catalog.json.gz`, frozen by `tests/graph/coreUnitCatalog.test.ts`).

use serde_json::Value as Json;
use solenoid_core::unit_catalog::fc_unit_to_unit;
use std::io::Read;

#[test]
fn every_id_resolves_as_frozen() {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/core/unit-catalog.json.gz");
    let mut s = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(path).unwrap()).read_to_string(&mut s).unwrap();
    let cases: Vec<Json> = serde_json::from_str(&s).unwrap();
    let num = |j: &Json| solenoid_core::wire::decode_cell(j);
    let mut bad = Vec::new();
    for c in &cases {
        let id = c["id"].as_str().unwrap();
        let got = fc_unit_to_unit(id);
        let ok = match (&got, c["unit"].as_object()) {
            (None, None) => true,
            (Some(u), Some(w)) => {
                let scale = matches!(num(&w["scale"]), solenoid_core::frame::FrameCell::Num(n) if n.to_bits() == u.scale.to_bits());
                let offset = match (w.get("offset"), u.offset) {
                    (None, None) => true,
                    (Some(o), Some(x)) => {
                        matches!(num(o), solenoid_core::frame::FrameCell::Num(n) if n.to_bits() == x.to_bits())
                    }
                    (Some(o), None) => o.as_f64() == Some(0.0),
                    _ => false,
                };
                let dim: Vec<(String, f64)> =
                    w["dim"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), v.as_f64().unwrap())).collect();
                let mine: Vec<(String, f64)> =
                    u.dim.iter().filter(|(_, e)| **e != 0.0).map(|(k, e)| (k.clone(), *e)).collect();
                let mut dim = dim;
                dim.sort_by(|a, b| a.0.cmp(&b.0));
                scale && offset && dim == mine
            }
            _ => false,
        };
        if !ok {
            bad.push(format!("{id}: got {got:?}, want {}", c["unit"]));
        }
    }
    assert!(bad.is_empty(), "{} of {} differ:\n{}", bad.len(), cases.len(), bad.join("\n"));
}
