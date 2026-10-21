// [[C16]] polarsEngine
//! The WebAssembly entry: one string-in, string-out call per engine command.

use wasm_bindgen::prelude::*;

use crate::frame_backend::invoke;
use crate::wire::error_to_wire;

/// `{"ok": result}` or `{"err": {"__solError", code, message}}`, as JSON text.
#[wasm_bindgen]
pub fn engine_invoke(command: &str, args: &str) -> String {
    let parsed = match serde_json::from_str(args) {
        Ok(v) => v,
        Err(e) => return serde_json::json!({ "err": { "__solError": true, "code": "#ERROR!", "message": e.to_string() } }).to_string(),
    };
    match invoke(command, &parsed) {
        Ok(v) => serde_json::json!({ "ok": v }).to_string(),
        Err(e) => serde_json::json!({ "err": error_to_wire(&e) }).to_string(),
    }
}
