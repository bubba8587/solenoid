//! [[C69]] ganttPackages, [[D99]] rustIsSpec: the plan-file readers against the answers the TS readers gave
//! (`fixtures/core/plan-readers.json.gz`, recorded by `tests/graph/corePlanReaders.test.ts`). A key the TS left
//! undefined and one it set null read the same.

use serde_json::Value as Json;
use solenoid_core::plan_files::{parse_predecessors, read_plan_file};
use std::io::Read;

fn load(name: &str) -> Vec<Json> {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("../../fixtures/core/{name}.json.gz"));
    let mut s = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(path).unwrap()).read_to_string(&mut s).unwrap();
    serde_json::from_str(&s).unwrap()
}

/// Numbers as f64 and null-valued keys dropped, so `2` and `2.0`, a missing key and a null one compare equal.
fn plain(j: &Json) -> Json {
    match j {
        Json::Number(n) => serde_json::Number::from_f64(n.as_f64().unwrap()).map_or(Json::Null, Json::Number),
        Json::Array(a) => Json::Array(a.iter().map(plain).collect()),
        Json::Object(m) => {
            Json::Object(m.iter().filter(|(_, v)| !v.is_null()).map(|(k, v)| (k.clone(), plain(v))).collect())
        }
        _ => j.clone(),
    }
}

fn answer(got: Json) -> Json {
    match got {
        Json::Object(mut m) => {
            m.remove("format");
            match m.remove("error") {
                Some(Json::String(e)) => Json::String(format!("!{e}")),
                _ => Json::Object(m),
            }
        }
        other => other,
    }
}

#[test]
fn the_readers_give_the_frozen_answers() {
    let cases = load("plan-readers");
    assert!(cases.len() > 300);
    let mut bad = Vec::new();
    for c in &cases {
        let kind = c["kind"].as_str().unwrap();
        let text = c["text"].as_str().unwrap();
        let got = match kind {
            "sniff" => {
                let w: Vec<bool> = c["want"].as_array().unwrap().iter().map(|b| b.as_bool().unwrap()).collect();
                let want = if w[0] {
                    "mspdi"
                } else if w[2] {
                    "xer"
                } else if w[1] {
                    "gan"
                } else {
                    ""
                };
                let got = read_plan_file(text, None)["format"].as_str().unwrap_or("").to_string();
                if got != want {
                    bad.push(format!("sniff {:?}: {got} not {want}", &text[..text.len().min(60)]));
                }
                continue;
            }
            "pred" => {
                let names: Vec<String> =
                    c["names"].as_array().unwrap().iter().map(|n| n.as_str().unwrap().to_string()).collect();
                parse_predecessors(text, &names)
            }
            _ => answer(read_plan_file(text, Some(kind))),
        };
        if plain(&got) != plain(&c["want"]) {
            bad.push(format!(
                "{kind} {:?}\n  got  {}\n  want {}",
                &text[..text.len().min(60)],
                plain(&got),
                plain(&c["want"])
            ));
        }
    }
    assert!(bad.is_empty(), "{} of {} differ:\n{}", bad.len(), cases.len(), bad[..bad.len().min(6)].join("\n"));
}

/// The scheduler's weekend codes are the core's `WORKDAY.INTL` codes.
#[test]
fn the_scheduler_reads_weekend_codes_as_workday_intl() {
    use solenoid_core::date_ops::weekend_days as core_days;
    use solenoid_schedule::calendar::weekend_days as schedule_days;
    for code in [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0, 17.0] {
        let core = core_days(code).unwrap();
        let mut theirs: Vec<u8> = (0..7).filter(|d| core.has(f64::from(*d))).collect();
        let mut ours: Vec<u8> = schedule_days(Some(code)).iter().map(|d| *d as u8).collect();
        theirs.sort();
        ours.sort();
        assert_eq!(ours, theirs, "code {code}");
    }
}
