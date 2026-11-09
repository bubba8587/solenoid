// [[C130]] rustCore, [[C107]] obsidianPlugin
//! The exports every build of the module carries: the app's and the Obsidian plugin's, which has no graph engine
//! (`plugin` feature).

use std::cell::RefCell;

use js_sys::Function;
use wasm_bindgen::prelude::*;

thread_local! {
    static ON_PANIC: RefCell<Option<Function>> = const { RefCell::new(None) };
}

/// `handler(message)` runs when a panic starts, before the module traps, so the host can settle what was waiting on
/// it and instantiate the module afresh.
#[wasm_bindgen(js_name = setPanicHandler)]
pub fn set_panic_handler(handler: Function) {
    ON_PANIC.with(|h| *h.borrow_mut() = Some(handler));
    std::panic::set_hook(Box::new(|info| {
        let message = JsValue::from_str(&info.to_string());
        ON_PANIC.with(|h| {
            if let Some(f) = h.try_borrow().ok().and_then(|f| f.clone()) {
                let _ = f.call1(&JsValue::NULL, &message);
            }
        });
    }));
}

/// A node's or cable's id: sixteen lowercase hex digits from eight secure random bytes, netcore-rs's `getUID`.
#[wasm_bindgen]
pub fn uid() -> String {
    netcore::get_uid()
}

/// The socket lattice as the tables the app reads (`lattice::tables_json`).
#[wasm_bindgen(js_name = latticeTables)]
pub fn lattice_tables() -> String {
    crate::lattice::tables_json()
}

/// A unit id's unit (`unit_catalog::fc_unit_to_unit`) as `{ dim, scale, offset? }`, or `null` for an id that names none.
#[wasm_bindgen(js_name = fcUnit)]
pub fn fc_unit(id: &str) -> String {
    match solenoid_core::unit_catalog::fc_unit_to_unit(id) {
        Some(u) => {
            let mut j = serde_json::json!({ "dim": u.dim, "scale": u.scale });
            if let Some(o) = u.offset {
                j["offset"] = serde_json::json!(o);
            }
            j.to_string()
        }
        None => "null".into(),
    }
}

/// A dimension's label (`unit_lists::format_dim`): `{ length: 1, time: -1 }` reads `m/s`; dimensionless is "".
#[wasm_bindgen(js_name = formatDim)]
pub fn format_dim(dim: &str) -> String {
    let dim: solenoid_core::unit_dims::Dim = serde_json::from_str(dim).unwrap_or_default();
    solenoid_core::unit_lists::format_dim(&dim)
}
