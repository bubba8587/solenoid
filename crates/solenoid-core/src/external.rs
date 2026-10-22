// [[D99]] rustIsSpec
//! A pack's function, registered in JS at run time: the core evaluates the call's arguments and the TS makes the call
//! itself (`callFromCore` in excelFormula.ts). None leaves the formula to the TS, as a bail does.

use crate::excel_functions::V;

/// Whether a TS is there to call back.
pub const HOSTED: bool = cfg!(target_arch = "wasm32");

#[cfg(target_arch = "wasm32")]
mod host {
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    extern "C" {
        #[wasm_bindgen(catch, js_namespace = globalThis, js_name = __solenoidCallExternal)]
        pub fn call_external(name: &str, empty: &str, args: &str) -> Result<Option<String>, JsValue>;
    }
}

#[cfg(target_arch = "wasm32")]
pub fn call(name: &str, empty: &[bool], argv: &[V]) -> Option<V> {
    let args: Vec<_> = argv.iter().map(|v| crate::frame_backend::CallReply::Value(v.clone())).collect();
    let (args, empty) = (serde_json::to_string(&args).ok()?, serde_json::to_string(empty).ok()?);
    // The pack's body may call the core again, which resets the clock, the row and the bail flags this call reads.
    let saved = crate::excel_functions::save_calc_state();
    let out = host::call_external(name, &empty, &args);
    crate::excel_functions::restore_calc_state(saved);
    let j: serde_json::Value = serde_json::from_str(&out.ok()??).ok()?;
    Some(crate::eval::decode_value(&j))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn call(_name: &str, _empty: &[bool], _argv: &[V]) -> Option<V> {
    None
}
