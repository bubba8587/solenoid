// [[C130]] rustCore
//! The frame-verb corpus (`fixtures/frame-verbs`), run natively through the engine's own commands:
//! the same files `frameVerbCorpus.test.ts` runs in wasm. Cells compare as there: numbers
//! sign-of-zero blind, errors by code.

use std::fs;
use std::path::Path;

use serde_json::{json, Value as Json};
use solenoid_core::error_value::ErrorCode;
use solenoid_core::frame::FrameCell;
use solenoid_core::frame_backend::invoke;
use solenoid_core::wire::decode_cell;

fn cells_equal(a: &FrameCell, b: &FrameCell) -> bool {
    match (a, b) {
        (FrameCell::Null, FrameCell::Null) => true,
        (FrameCell::Num(x), FrameCell::Num(y)) => (x.is_nan() && y.is_nan()) || x == y,
        (FrameCell::Str(x), FrameCell::Str(y)) => x == y,
        (FrameCell::Bool(x), FrameCell::Bool(y)) => x == y,
        (FrameCell::Err(x), FrameCell::Err(y)) => x.code == y.code,
        _ => false,
    }
}

fn columns_match(actual: &Json, expected: &Json) -> Result<(), String> {
    let (a, e) = (actual.as_array().unwrap(), expected["columns"].as_array().unwrap());
    if a.len() != e.len() {
        return Err(format!("{} columns, expected {}", a.len(), e.len()));
    }
    for (ac, ec) in a.iter().zip(e) {
        if ac["name"] != ec["name"] || ac["type"] != ec["type"] {
            return Err(format!("column {} {} vs expected {} {}", ac["name"], ac["type"], ec["name"], ec["type"]));
        }
        let (av, ev) = (ac["values"].as_array().unwrap(), ec["values"].as_array().unwrap());
        if av.len() != ev.len() || !av.iter().zip(ev).all(|(x, y)| cells_equal(&decode_cell(x), &decode_cell(y))) {
            return Err(format!("column {}: {} vs expected {}", ac["name"], json!(av), json!(ev)));
        }
    }
    Ok(())
}

fn source(frame: &Json) -> String {
    invoke("engine_source", &json!({ "frame": frame })).unwrap().as_str().unwrap().to_string()
}

fn run_case(verb: &str, kase: &Json) -> Result<Json, ErrorCode> {
    let frames = &kase["frames"];
    let op = &kase["op"];
    let handle = match op["kind"].as_str().unwrap() {
        "join" => {
            let mut opts = op.clone();
            opts.as_object_mut().unwrap().remove("kind");
            invoke("engine_join", &json!({ "left": source(&frames["left"]), "right": source(&frames["right"]), "opts": opts }))
        }
        "append" | "bindColumns" => {
            let handles: Vec<String> = op["frames"].as_array().unwrap().iter().map(|n| source(&frames[n.as_str().unwrap()])).collect();
            let cmd = if verb == "append" { "engine_append" } else { "engine_bind_columns" };
            invoke(cmd, &json!({ "handles": handles }))
        }
        "pipeline" => invoke("engine_apply_many", &json!({ "handle": source(&frames["in"]), "ops": op["ops"] })),
        _ => invoke("engine_apply", &json!({ "handle": source(&frames["in"]), "op": op })),
    };
    match handle {
        Ok(h) => Ok(invoke("engine_collect", &json!({ "handle": h })).unwrap()),
        Err(e) => Err(e.code),
    }
}

#[test]
fn corpus() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/frame-verbs");
    let mut files: Vec<_> = fs::read_dir(&dir).unwrap().map(|e| e.unwrap().path()).collect();
    files.sort();
    let (mut passed, mut failures) = (0, Vec::new());
    for path in files {
        let file: Json = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let verb = file["verb"].as_str().unwrap();
        for kase in file["cases"].as_array().unwrap() {
            let name = format!("{verb}: {}", kase["name"].as_str().unwrap());
            let outcome = match (run_case(verb, kase), kase.get("expectError").and_then(Json::as_str)) {
                (Err(code), Some(want)) if code.as_str() == want => Ok(()),
                (Err(code), want) => Err(format!("threw {code}, expected {}", want.unwrap_or("a frame"))),
                (Ok(_), Some(want)) => Err(format!("expected {want}, got a frame")),
                (Ok(out), None) => columns_match(&out, &kase["expect"]),
            };
            match outcome {
                Ok(()) => passed += 1,
                Err(why) => failures.push(format!("{name}\n    {why}")),
            }
        }
    }
    assert!(failures.is_empty(), "{passed} passed, {} failed:\n  {}", failures.len(), failures.join("\n  "));
    eprintln!("{passed} corpus cases pass");
}
