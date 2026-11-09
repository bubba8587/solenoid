// [[D99]] rustIsSpec
//! What one engine call raises (a throw) never reaches the next call.

use serde_json::json;
use solenoid_core::frame_backend::invoke;

fn abs_of(x: f64) -> serde_json::Value {
    invoke("engine_call", &json!({ "name": "ABS", "args": [x] })).expect("engine_call answers")
}

/// A frame call's argument that throws as it decodes (a LAMBDA whose body doesn't parse) left its throw pending, and
/// the next call answered it as its own exception.
#[test]
fn a_frame_calls_throw_stays_its_own() {
    let frame = json!({ "columns": [{ "name": "a", "type": "number", "values": [1, 2] }] });
    let handle = invoke("engine_source", &json!({ "frame": frame })).expect("a frame uploads");
    let args = json!({ "name": "describeFrame", "handles": [handle], "args": [{ "__lambda": { "params": [], "expr": "(((" } }] });
    invoke("engine_frame_fn", &args).expect("engine_frame_fn answers");
    assert_eq!(abs_of(-2.0), json!({ "num": 2f64.to_bits().to_string() }));
}
