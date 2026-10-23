//! [[C103]] untrustedContentSeams: the core's CSV reader and writer answer as Papa Parse and the TS typing did
//! (`fixtures/core/csv-rows.json.gz`, `csv-frames.json.gz`, `csv-sources.json.gz`, `csv-unparse.json.gz`, frozen by
//! `tests/graph/coreCsv.test.ts`).

use serde_json::Value as Json;
use solenoid_core::binary::{TAG_FALSE, TAG_NUM, TAG_STR, TAG_TRUE};
use solenoid_core::csv::{frame_columnar, parse_rows, source_columns, unparse, CsvOptions};
use std::io::Read;

fn load(name: &str) -> Vec<Json> {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("../../fixtures/core/{name}.json.gz"));
    let mut s = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(path).unwrap()).read_to_string(&mut s).unwrap();
    serde_json::from_str(&s).unwrap()
}

fn report(bad: &[String], total: usize) {
    assert!(bad.is_empty(), "{} of {total} differ:\n{}", bad.len(), bad.iter().take(20).cloned().collect::<Vec<_>>().join("\n"));
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
        other => format!("?{other}"),
    }
}

#[test]
fn frames_as_frozen() {
    let cases = load("csv-frames");
    let mut bad = Vec::new();
    for c in &cases {
        let (out, _) = frame_columnar(c["text"].as_str().unwrap());
        let mut strs = out.strs.as_str();
        let mut lens = out.lens.iter();
        let mut text = || {
            let n = *lens.next().unwrap() as usize;
            let end = strs.char_indices().scan(0, |u, (i, ch)| {
                let at = *u;
                *u += ch.len_utf16();
                Some((at, i))
            }).find(|&(u, _)| u == n).map_or(strs.len(), |(_, i)| i);
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
            .map(|col| (col["name"].as_str().unwrap().into(), col["type"].as_str().unwrap().into(), col["values"].as_array().unwrap().iter().map(want_key).collect(), strings(&col["raw"])))
            .collect();
        if got != want {
            bad.push(format!("{:?}\n  got  {got:?}\n  want {want:?}", c["text"]));
        }
    }
    report(&bad, cases.len());
}

#[test]
fn sources_as_frozen() {
    let cases = load("csv-sources");
    let mut bad = Vec::new();
    for c in &cases {
        let text = c["text"].as_str().unwrap();
        let got: Vec<(String, String, Vec<String>)> = source_columns(solenoid_core::jsnum::js_trim(text)).into_iter().map(|(n, t, cells)| (n, t.as_str().to_string(), cells)).collect();
        let want: Vec<(String, String, Vec<String>)> = c["columns"]
            .as_array()
            .unwrap()
            .iter()
            .map(|col| (col["name"].as_str().unwrap().into(), col["type"].as_str().unwrap().into(), strings(&col["cells"])))
            .collect();
        if got != want {
            bad.push(format!("{text:?}\n  got  {got:?}\n  want {want:?}"));
        }
    }
    report(&bad, cases.len());
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
