// [[engineering#Content entering or leaving the app is guarded where it crosses]], [[frame-verbs#Reading CSV text]]
//! The core's CSV reader and writer against their frozen answers (`fixtures/core/csv-*.json.gz`), natively.

use serde_json::Value as Json;
use solenoid_core::binary::{TAG_FALSE, TAG_NUM, TAG_STR, TAG_TRUE};
use solenoid_core::csv::{frame_columnar, parse_rows, source_columns, unparse, CsvOptions};
use std::io::Read;

fn load(name: &str) -> Vec<Json> {
    let path = std::path::PathBuf::from(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
        .join(format!("../../fixtures/core/{name}.json.gz"));
    let mut s = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(path).unwrap()).read_to_string(&mut s).unwrap();
    serde_json::from_str(&s).unwrap()
}

fn report(bad: &[String], total: usize) {
    assert!(
        bad.is_empty(),
        "{} of {total} differ:\n{}",
        bad.len(),
        bad.iter().take(20).cloned().collect::<Vec<_>>().join("\n")
    );
}

fn strings(v: &Json) -> Vec<String> {
    v.as_array().unwrap().iter().map(|s| s.as_str().unwrap().to_string()).collect()
}

#[test]
fn rows_as_frozen() {
    let cases = load("csv-rows");
    let mut bad = Vec::new();
    for c in &cases {
        let flag = |k: &str| c["opts"].get(k).and_then(Json::as_bool).unwrap_or(false);
        let opts = CsvOptions { detect_delimiter: flag("detectDelimiter"), keep_blank_lines: flag("keepBlankLines") };
        let want: Vec<Vec<String>> = c["rows"].as_array().unwrap().iter().map(strings).collect();
        let got = parse_rows(c["text"].as_str().unwrap(), opts);
        if got != want {
            bad.push(format!("{:?} {}\n  got  {got:?}\n  want {want:?}", c["text"], c["opts"]));
        }
    }
    report(&bad, cases.len());
}

/// A frozen cell as a comparable key: `-0` and the other tagged numbers by their bits.
fn want_key(v: &Json) -> String {
    match v {
        Json::Null => "null".into(),
        Json::Bool(b) => format!("b:{b}"),
        Json::Number(n) => format!("n:{}", n.as_f64().unwrap().to_bits()),
        Json::String(s) => format!("s:{s}"),
        Json::Object(o) if o.get("__nf").and_then(Json::as_str) == Some("-0") => format!("n:{}", (-0.0f64).to_bits()),
        Json::Object(o) if o.get("__nf").and_then(Json::as_str) == Some("nan") => format!("n:{}", f64::NAN.to_bits()),
        other => format!("?{other}"),
    }
}

/// `want_key` read back into a frozen cell.
fn key_json(k: &str) -> Json {
    match k.split_once(':') {
        Some(("s", t)) => Json::String(t.into()),
        Some(("b", b)) => Json::Bool(b == "true"),
        Some(("n", bits)) => {
            let n = f64::from_bits(bits.parse().unwrap());
            if n.is_nan() {
                serde_json::json!({ "__nf": "nan" })
            } else if n == 0.0 && n.is_sign_negative() {
                serde_json::json!({ "__nf": "-0" })
            } else {
                serde_json::json!(n)
            }
        }
        _ => Json::Null,
    }
}

/// Under `FREEZE_NATIVE` naming the suite, its cases take the answers they now get.
fn freeze(suite: &str, cases: &[Json]) -> bool {
    if !std::env::var("FREEZE_NATIVE").is_ok_and(|s| s.split(',').any(|x| x == suite || x == "1")) {
        return false;
    }
    let path = std::path::PathBuf::from(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
        .join(format!("../../fixtures/core/{suite}.json.gz"));
    let mut gz = flate2::write::GzEncoder::new(std::fs::File::create(path).unwrap(), flate2::Compression::best());
    std::io::Write::write_all(&mut gz, serde_json::to_string(cases).unwrap().as_bytes()).unwrap();
    gz.finish().unwrap();
    true
}

#[test]
fn frames_as_frozen() {
    let mut cases = load("csv-frames");
    let mut bad = Vec::new();
    for c in &mut cases {
        let (out, _) = frame_columnar(c["text"].as_str().unwrap(), Default::default());
        let mut strs = out.strs.as_str();
        let mut lens = out.lens.iter();
        let mut text = || {
            let n = *lens.next().unwrap() as usize;
            let end = strs
                .char_indices()
                .scan(0, |u, (i, ch)| {
                    let at = *u;
                    *u += ch.len_utf16();
                    Some((at, i))
                })
                .find(|&(u, _)| u == n)
                .map_or(strs.len(), |(_, i)| i);
            let (piece, rest) = strs.split_at(end);
            strs = rest;
            piece.to_string()
        };
        // (name, type, value keys, raw)
        let mut got: Vec<(String, String, Vec<String>, Vec<String>)> = Vec::new();
        let mut k = 0;
        for s in &out.schema {
            let len = s["len"].as_u64().unwrap() as usize;
            let mut keys = Vec::with_capacity(len);
            for _ in 0..len {
                keys.push(match out.tags[k] {
                    TAG_NUM => format!("n:{}", out.nums[k].to_bits()),
                    TAG_STR => format!("s:{}", text()),
                    TAG_TRUE => "b:true".into(),
                    TAG_FALSE => "b:false".into(),
                    _ => "null".into(),
                });
                k += 1;
            }
            if s.get("raw").is_some() {
                got.last_mut().unwrap().3 = keys.into_iter().map(|x| x.trim_start_matches("s:").to_string()).collect();
            } else {
                let raw = keys.iter().map(|x| x.strip_prefix("s:").unwrap_or("").to_string()).collect();
                got.push((s["name"].as_str().unwrap().into(), s["type"].as_str().unwrap().into(), keys, raw));
            }
        }
        let want: Vec<(String, String, Vec<String>, Vec<String>)> = c["columns"]
            .as_array()
            .unwrap()
            .iter()
            .map(|col| {
                (
                    col["name"].as_str().unwrap().into(),
                    col["type"].as_str().unwrap().into(),
                    col["values"].as_array().unwrap().iter().map(want_key).collect(),
                    strings(&col["raw"]),
                )
            })
            .collect();
        if got != want {
            bad.push(format!("{:?}\n  got  {got:?}\n  want {want:?}", c["text"]));
            c["columns"] = got
                .iter()
                .map(|(name, ty, keys, raw)| {
                    serde_json::json!({ "name": name, "type": ty, "values": keys.iter().map(|k| key_json(k)).collect::<Vec<_>>(), "raw": raw })
                })
                .collect();
        }
    }
    if !freeze("csv-frames", &cases) {
        report(&bad, cases.len());
    }
}

#[test]
fn sources_as_frozen() {
    let mut cases = load("csv-sources");
    let mut bad = Vec::new();
    for c in &mut cases {
        let text = c["text"].as_str().unwrap().to_string();
        let got: Vec<(String, String, Vec<String>)> = source_columns(solenoid_core::jsnum::trim_space(&text))
            .into_iter()
            .map(|(n, t, cells)| (n, t.as_str().to_string(), cells))
            .collect();
        let want: Vec<(String, String, Vec<String>)> = c["columns"]
            .as_array()
            .unwrap()
            .iter()
            .map(|col| {
                (col["name"].as_str().unwrap().into(), col["type"].as_str().unwrap().into(), strings(&col["cells"]))
            })
            .collect();
        if got != want {
            bad.push(format!("{text:?}\n  got  {got:?}\n  want {want:?}"));
            c["columns"] = got
                .iter()
                .map(|(name, ty, cells)| serde_json::json!({ "name": name, "type": ty, "cells": cells }))
                .collect();
        }
    }
    if !freeze("csv-sources", &cases) {
        report(&bad, cases.len());
    }
}

#[test]
fn unparse_as_frozen() {
    let cases = load("csv-unparse");
    let mut bad = Vec::new();
    for c in &cases {
        let fields = strings(&c["fields"]);
        let data: Vec<Vec<String>> = c["data"].as_array().unwrap().iter().map(strings).collect();
        let got = unparse(&fields, &data);
        if got != c["text"].as_str().unwrap() {
            bad.push(format!("{fields:?} {data:?}\n  got  {got:?}\n  want {:?}", c["text"]));
        }
    }
    report(&bad, cases.len());
}

#[test]
fn a_number_column_reads_its_stray_cells_as_nan() {
    let ty = |body: &str| source_columns(&format!("n\n{body}"))[0].1.as_str().to_string();
    // Missing markers never make a column text; other text may be a tenth of the filled cells.
    assert_eq!(ty("1\n2\nN/A\n-\n#DIV/0!\n"), "number");
    assert_eq!(ty("1\n2\n3\n4\n5\n6\n7\n8\n9\nsee note\n"), "number");
    assert_eq!(ty("1\n2\nsee note\n"), "string");
    assert_eq!(ty("N/A\nnull\n"), "string");
    assert_eq!(ty("2024-01-05\nN/A\n2024-02-01\n"), "date");
    let (cols, _) = frame_columnar("n\n1\nN/A\n3\n", Default::default());
    assert_eq!(cols.tags[..3], [TAG_NUM, TAG_NUM, TAG_NUM]);
    assert!(cols.nums[1].is_nan());
    assert_eq!(cols.schema[1]["raw"], true, "the source text rides beside the column");
}

/// An import told its file's date order types a column of numbers-alone dates Date (author 2026-11-10); in Auto the
/// same column stays text, since a slash date needs a four-digit year ([[C44]] dateSerials).
#[test]
fn an_import_reads_slash_dates_under_its_order() {
    use solenoid_core::excel_criteria::DateOrder;
    let text = "when,n\n1/2/26,1\n3/15/26,2\n12/1/25,3\n";
    let ty = |order| frame_columnar(text, order).0.schema[0]["type"].as_str().unwrap().to_string();
    assert_eq!(ty(DateOrder::Auto), "string");
    assert_eq!(ty(DateOrder::Mdy), "date");
    let (cols, _) = frame_columnar(text, DateOrder::Mdy);
    assert_eq!(cols.nums[..3], [46024.0, 46096.0, 45992.0]);
    // DMY can't read 3/15/26 (no 15th month): the column keeps its text.
    assert_eq!(ty(DateOrder::Dmy), "string");
}
