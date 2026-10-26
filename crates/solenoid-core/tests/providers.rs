//! [[C23]] calcModes, [[D99]] rustIsSpec: the data providers' replies read as frozen (`fixtures/core/providers.json.gz`,
//! recorded by `tests/graph/coreProviders.test.ts`).

use serde_json::{json, Value as Json};
use solenoid_core::excel_functions::V;
use solenoid_core::frame::{FrameCell, FrameValue};
use solenoid_core::providers::{fx_rate, fx_series, holidays, weather};
use std::io::Read;

fn load(name: &str) -> Vec<Json> {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("../../fixtures/core/{name}.json.gz"));
    let mut s = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(path).unwrap()).read_to_string(&mut s).unwrap();
    serde_json::from_str(&s).unwrap()
}

/// A number as the fixture writes it: whole numbers as integers, NaN and the infinities as text.
fn n(x: f64) -> Json {
    if !x.is_finite() {
        json!(format!(
            "#{}",
            if x.is_nan() {
                "NaN".into()
            } else if x > 0.0 {
                "Infinity".to_string()
            } else {
                "-Infinity".into()
            }
        ))
    } else if x.fract() == 0.0 && x.abs() < 9e15 {
        json!(x as i64)
    } else {
        json!(x)
    }
}

fn cell(c: &FrameCell) -> Json {
    match c {
        FrameCell::Null => Json::Null,
        FrameCell::Num(x) => n(*x),
        FrameCell::Str(s) => json!(&**s),
        FrameCell::Bool(b) => json!(b),
        FrameCell::Err(_) => json!("#ERR"),
    }
}

fn frame(f: &FrameValue) -> Json {
    let columns: Vec<Json> = f
        .columns
        .iter()
        .map(|c| {
            let mut o = json!({ "name": c.name, "type": c.ty.as_str(), "values": c.values.iter().map(cell).collect::<Vec<_>>() });
            if let Some(u) = &c.unit {
                let mut u = u.to_json();
                for v in u["dim"].as_object_mut().unwrap().values_mut() {
                    *v = n(v.as_f64().unwrap());
                }
                o["unit"] = u;
            }
            o
        })
        .collect();
    json!({ "__frame": true, "columns": columns })
}

fn v(x: &V) -> Json {
    match x {
        V::Null => Json::Null,
        V::Num(x) => n(*x),
        V::Str(s) => json!(&**s),
        _ => panic!("unexpected value"),
    }
}

#[test]
fn replies_as_frozen() {
    let cases = load("providers");
    let mut bad = Vec::new();
    for (i, c) in cases.iter().enumerate() {
        let text = c["body"].as_str().unwrap();
        let a = |k: usize| c["args"][k].clone();
        let got = match c["kind"].as_str().unwrap() {
            "weather" => {
                let (d, now, cond) = weather(text, a(0).as_str().unwrap());
                json!([frame(&d), v(&now), v(&cond)])
            }
            "holidays" => {
                let (f, next) = holidays(text, a(0).as_str().unwrap(), a(1).as_f64().unwrap());
                json!([frame(&f), v(&next)])
            }
            "fxRate" => {
                let (date, serial, rate) = fx_rate(text, a(0).as_str().unwrap());
                json!([date, n(serial), v(&rate)])
            }
            _ => frame(&fx_series(text, a(0).as_str().unwrap())),
        };
        if got != c["want"] {
            bad.push(format!("#{i} {} {:.60}\n  got  {got}\n  want {}", c["kind"], text, c["want"]));
        }
    }
    assert!(bad.is_empty(), "{} of {} differ:\n{}", bad.len(), cases.len(), bad.join("\n"));
}
