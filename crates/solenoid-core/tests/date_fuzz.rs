// [[D114]] dateIsAKind, [[C137]] datesNeverSerials
//! Every card handed dates wherever a date can be wired (the wildcard, table and date sockets): its frozen cases with
//! their numbers there turned into dates and a table's Number columns into Date columns. No body may panic, and none
//! may hand back an input's day as a plain number where the frozen answer held it. `DATE_FUZZ_REPORT=1` also lists
//! the cases that now refuse or go blank, for review.

use serde_json::Value as Json;
use solenoid_core::excel_functions::V;
use solenoid_core::nodes::{reply, Cv};
use std::collections::BTreeSet;
use std::io::Read;

fn load(path: &std::path::Path) -> Vec<Json> {
    let mut s = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(path).unwrap()).read_to_string(&mut s).unwrap();
    serde_json::from_str(&s).unwrap()
}

const TAKES_DATES: &[&str] =
    &["frame", "cube", "anylist", "trueany", "anytable", "any", "anydata", "anycombo", "date", "datecombo", "datelist"];

/// The value with its numbers as dates, a table's Number columns as Date columns; the serials it turned.
fn dated(v: &Json, days: &mut BTreeSet<u64>) -> Json {
    match v {
        Json::Number(n) => {
            let x = n.as_f64().unwrap_or(0.0);
            days.insert(x.to_bits());
            serde_json::json!({ "__date": v })
        }
        Json::Array(a) => Json::Array(a.iter().map(|x| dated(x, days)).collect()),
        Json::Object(o) if o.contains_key("__frame") => {
            let mut f = v.clone();
            if let Some(cols) = f["__frame"]["columns"].as_array_mut() {
                for col in cols {
                    if col["type"] == "number" && col.get("unit").is_none_or(Json::is_null) {
                        col["type"] = "date".into();
                        for x in col["values"].as_array().into_iter().flatten() {
                            if let Some(n) = x.as_f64() {
                                days.insert(n.to_bits());
                            }
                        }
                    }
                }
            }
            f
        }
        other => other.clone(),
    }
}

/// Where the frozen answer held one of `days` as a number and the dated run hands it back as a number still.
fn leaks(want: &Cv, got: &Cv, days: &BTreeSet<u64>) -> bool {
    fn v(want: &V, got: &V, days: &BTreeSet<u64>) -> bool {
        match (want, got) {
            (V::Num(a), V::Num(b)) => a.abs() > 31.0 && days.contains(&a.to_bits()) && a.to_bits() == b.to_bits(),
            (V::List(a), V::List(b)) => a.iter().zip(b.iter()).any(|(x, y)| v(x, y, days)),
            _ => false,
        }
    }
    match (want, got) {
        (Cv::V(a), Cv::V(b)) => v(a, b, days),
        (Cv::Cells(a), Cv::Cells(b)) => a.iter().zip(b.iter()).any(|(x, y)| leaks(x, y, days)),
        (Cv::Frame(a), Cv::Frame(b)) => a.columns.iter().zip(&b.columns).any(|(p, q)| {
            // Describe's counts are counts, whatever a cell happens to hold.
            let counts = matches!(&*q.name, "count" | "blank" | "distinct");
            let hit = !counts
                && q.ty == solenoid_core::frame::FrameColType::Number
                && p.values.iter().zip(&q.values).any(|(x, y)| v(x, y, days));
            if hit && std::env::var("DATE_FUZZ_REPORT").is_ok() {
                eprintln!("  leaked column {:?}", q.name);
            }
            hit
        }),
        _ => false,
    }
}

fn refused_or_blank(got: &Cv) -> Option<&'static str> {
    match got {
        Cv::V(V::Err(_)) => Some("refuses"),
        Cv::V(V::Null) => Some("blank"),
        _ => None,
    }
}

#[test]
fn every_card_takes_dates_where_they_can_be_wired() {
    let report = std::env::var("DATE_FUZZ_REPORT").is_ok();
    let only: Option<Vec<String>> = std::env::var("NODES").ok().map(|s| s.split(',').map(String::from).collect());
    let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/core/nodes");
    let mut files: Vec<_> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().path()).collect();
    files.sort();
    std::panic::set_hook(Box::new(|_| {}));
    let (mut panics, mut leaked, mut changed) = (Vec::new(), Vec::new(), Vec::new());
    for path in files {
        let kind = path.file_name().unwrap().to_str().unwrap().trim_end_matches(".json.gz").to_string();
        // Cast to Number is the one way to a date's serial.
        if only.as_ref().is_some_and(|o| !o.contains(&kind)) || kind == "CastNode" {
            continue;
        }
        let (mut p, mut l, mut ch) = (0, 0, std::collections::BTreeMap::<&str, usize>::new());
        let mut example: Option<String> = None;
        let mut seen_err: Option<String> = None;
        for case in load(&path).iter().take(400) {
            let types: std::collections::HashMap<String, String> = case["sockets"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|r| Some((r[0].as_str()?.to_string(), r[1].as_str()?.to_string())))
                .collect();
            let mut days = BTreeSet::new();
            let mut c = case.clone();
            let mut hit = false;
            for inp in c["inputs"].as_array_mut().into_iter().flatten() {
                let key = inp[0].as_str().unwrap_or("").to_string();
                if types.get(&key).is_some_and(|t| TAKES_DATES.contains(&t.as_str())) {
                    let before = inp[1].clone();
                    inp[1] = dated(&inp[1], &mut days);
                    hit |= inp[1] != before;
                }
            }
            if !hit {
                continue;
            }
            c["kind"] = Json::String(kind.clone());
            c["clock"] = case["ctx"]["clock"].clone();
            let Ok(r) = std::panic::catch_unwind(|| reply(&c)) else {
                p += 1;
                example.get_or_insert_with(|| format!("panic on inputs {}", c["inputs"]));
                continue;
            };
            let Some(Ok(outs)) = r.answer else { continue };
            let Some(want) = case["result"]["out"].as_object() else { continue };
            for (k, got) in &outs {
                let Some(w) = want.get(k) else { continue };
                let w = solenoid_core::nodes::decode_card(w);
                if leaks(&w, got, &days) {
                    l += 1;
                    example.get_or_insert_with(|| format!("leak in {k}: inputs {}", c["inputs"]));
                }
                if report
                    && refused_or_blank(&w).is_none()
                    && let Some(why) = refused_or_blank(got)
                {
                    *ch.entry(why).or_default() += 1;
                    if let Cv::V(V::Err(e)) = got {
                        seen_err.get_or_insert_with(|| format!("{}: {} (init {})", e.code, e.message, case["init"]));
                    }
                }
            }
        }
        let ex = example.map(|e| e.chars().take(400).collect::<String>()).unwrap_or_default();
        if p > 0 {
            panics.push(format!("{kind}: {p} panic\n    {ex}"));
        } else if l > 0 {
            leaked.push(format!("{kind}: {l} leak\n    {ex}"));
        }
        if !ch.is_empty() {
            changed
                .push(format!("{kind}: {ch:?} {}", seen_err.unwrap_or_default().chars().take(200).collect::<String>()));
        }
    }
    let _ = std::panic::take_hook();
    if report {
        eprintln!("NOW REFUSES OR BLANK\n{}", changed.join("\n"));
    }
    eprintln!("PANICS\n{}\nLEAKS\n{}", panics.join("\n"), leaked.join("\n"));
    assert!(panics.is_empty() && leaked.is_empty());
}
