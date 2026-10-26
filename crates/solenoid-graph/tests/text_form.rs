// [[B12]] losslessSaves, [[D99]] rustIsSpec
//! The text form held to the frozen answers the TypeScript gave over every seed graph and hand-written texts
//! (`fixtures/core/text-form.json.gz`, written by `tests/graph/coreTextForm.test.ts`).

use std::io::Read;

use serde_json::Value as Json;
use solenoid_graph::text_form::{read, write};

fn frozen() -> Vec<Json> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/core/text-form.json.gz");
    let mut s = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(path).unwrap())
        .read_to_string(&mut s)
        .unwrap();
    serde_json::from_str(&s).unwrap()
}

#[test]
fn every_text_reads_and_writes_as_frozen() {
    let cases = frozen();
    // The init field order the app passed (`nodeInit.ts`), the fixture's first case.
    let order: Vec<String> = cases[0]["order"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_str().unwrap().to_string())
        .collect();
    let mut bad = Vec::new();
    for c in &cases[1..] {
        let want = c["want"].as_str().unwrap();
        let got = match c["kind"].as_str().unwrap() {
            "write" => {
                let g: Json = serde_json::from_str(c["input"].as_str().unwrap()).unwrap();
                let names: Vec<String> = c["names"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|n| n.as_str().unwrap().to_string())
                    .collect();
                write(&g, &names, &order)
            }
            _ => match read(c["text"].as_str().unwrap(), 2) {
                Ok(g) => g.to_string(),
                Err(e) => format!("!{e}"),
            },
        };
        if got != want {
            bad.push(format!(
                "{} {}",
                c["kind"],
                c["graph"]
                    .as_str()
                    .or(c["text"].as_str())
                    .unwrap_or("")
                    .chars()
                    .take(40)
                    .collect::<String>()
            ));
        }
    }
    assert!(
        bad.is_empty(),
        "{} of {} differ: {bad:#?}",
        bad.len(),
        cases.len()
    );
}
