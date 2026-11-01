//! [[C44]] dateSerials, [[D99]] rustIsSpec: relative date phrases read as chrono-node read them for `parseDate`
//! (`fixtures/core/relative-dates.json.gz`, frozen by `tests/graph/coreRelativeDates.test.ts`): the serial, `null`
//! for no date, `"throws"` where chrono threw, `"absolute"` for text that isn't a relative phrase.

use serde_json::Value as Json;
use solenoid_core::relative_date::{is_relative, relative_date, Zone};
use std::io::Read;

fn load() -> Vec<Json> {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/core/relative-dates.json.gz");
    let mut s = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(path).unwrap()).read_to_string(&mut s).unwrap();
    serde_json::from_str(&s).unwrap()
}

fn reading(text: &str, now: f64, zone: Zone) -> Json {
    if text.trim().is_empty() || !is_relative(text) {
        return Json::from("absolute");
    }
    match relative_date(text, now, zone) {
        Err(_) => Json::from("throws"),
        Ok(None) => Json::Null,
        Ok(Some(s)) => Json::from(s),
    }
}

#[test]
fn reads_every_frozen_phrase() {
    let cases = load();
    assert!(cases.len() > 30_000);
    let mut bad = Vec::new();
    for c in &cases {
        let text = c["text"].as_str().unwrap();
        let zone = c["zone"].as_str().unwrap();
        let now = c["now"].as_f64().unwrap();
        let got = reading(text, now, Zone::Named(zone));
        let same = match (&got, &c["want"]) {
            (Json::Number(a), Json::Number(b)) => a.as_f64() == b.as_f64(),
            (a, b) => a == b,
        };
        if !same {
            bad.push(format!("{text:?} {zone} {now}: want {} got {got}", c["want"]));
        }
        // The host zone natively is UTC: the app's own path reads the UTC cases the same.
        if zone == "UTC" && reading(text, now, Zone::Host) != got {
            bad.push(format!("{text:?} {now}: the host zone reads differently"));
        }
    }
    let shown: Vec<&String> = bad.iter().take(40).collect();
    assert!(bad.is_empty(), "{} of {} differ:\n{shown:#?}", bad.len(), cases.len());
}
