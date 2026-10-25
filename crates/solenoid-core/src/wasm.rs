// [[C130]] rustCore
//! The WebAssembly entry: one string-in, string-out call per engine command, plus the columnar
//! hand-off (`binary.rs`) for frames crossing in bulk.

use std::cell::RefCell;

use wasm_bindgen::prelude::*;

use crate::binary::{decode_frame, Columnar};
use crate::error_value::{ErrorCode, SolError};
use crate::frame::get_column;
use crate::frame_backend::{get, invoke, register};
use crate::wire::error_to_wire;

fn reply(r: Result<serde_json::Value, SolError>) -> String {
    match r {
        Ok(v) => serde_json::json!({ "ok": v }).to_string(),
        Err(e) => serde_json::json!({ "err": error_to_wire(&e) }).to_string(),
    }
}

/// `{"ok": result}` or `{"err": {"__solError", code, message}}`, as JSON text.
#[wasm_bindgen]
pub fn engine_invoke(command: &str, args: &str) -> String {
    match serde_json::from_str(args) {
        Ok(parsed)
            if matches!(
                command,
                "engine_call" | "engine_call_each" | "engine_eval" | "engine_expression_units" | "engine_fold_units"
            ) =>
        {
            match crate::frame_backend::call_reply(command, &parsed) {
                Ok(r) => format!("{{\"ok\":{}}}", serde_json::to_string(&r).expect("a call's reply serializes")),
                Err(e) => reply(Err(e)),
            }
        }
        Ok(parsed) if command == "engine_node" => format!(
            "{{\"ok\":{}}}",
            serde_json::to_string(&crate::nodes::reply(&parsed)).expect("a card's reply serializes")
        ),
        Ok(parsed) => reply(invoke(command, &parsed)),
        Err(e) => reply(Err(crate::error_value::sol_error(ErrorCode::Error, e.to_string()))),
    }
}

#[wasm_bindgen]
pub fn engine_source_bin(schema: &str, tags: &[u8], nums: &[f64], strs: &str, lens: &[u32]) -> String {
    reply(decode_frame(schema, tags, nums, strs, lens).map(|f| serde_json::json!(register(f))))
}

thread_local! {
    static STAGED: RefCell<Columnar> = RefCell::new(Columnar::default());
}

/// Stages a frame's cells for the `take_*` calls and answers its schema: every column, or the one
/// `column` names (`get_column`; `null` when none), each cut to `limit` cells when it's set.
#[wasm_bindgen]
pub fn engine_read_bin(handle: &str, column: Option<String>, limit: Option<u32>) -> String {
    reply(get(handle).map(|f| {
        let cols: Vec<_> = match &column {
            Some(name) => match get_column(&f, name) {
                Some(c) => vec![c],
                None => return serde_json::Value::Null,
            },
            None => f.columns.iter().collect(),
        };
        let out = Columnar::encode(&cols, limit.map(|l| l as usize));
        let schema = serde_json::json!({ "columns": out.schema, "rowCount": crate::frame::frame_row_count(&f) });
        STAGED.with(|s| *s.borrow_mut() = out);
        schema
    }))
}

/// Stages `csvToFrame`'s typed columns for the `take_*` calls and answers their schema (`csv::frame_columnar`).
#[wasm_bindgen]
pub fn engine_csv_frame(text: &str) -> String {
    let (out, rows) = crate::csv::frame_columnar(text);
    let schema = serde_json::json!({ "columns": out.schema, "rowCount": rows });
    STAGED.with(|s| *s.borrow_mut() = out);
    reply(Ok(schema))
}

/// Stages `parseCsvRows`'s fields for the `take_*` calls (`csv::rows_columnar`) and answers how many rows they make.
#[wasm_bindgen]
pub fn engine_csv_rows(text: &str, detect: bool, keep_blank: bool) -> String {
    let (out, rows) = crate::csv::rows_columnar(
        text,
        crate::csv::CsvOptions { detect_delimiter: detect, keep_blank_lines: keep_blank },
    );
    STAGED.with(|s| *s.borrow_mut() = out);
    reply(Ok(serde_json::json!(rows)))
}

#[wasm_bindgen]
pub fn take_tags() -> Vec<u8> {
    STAGED.with(|s| std::mem::take(&mut s.borrow_mut().tags))
}

#[wasm_bindgen]
pub fn take_nums() -> Vec<f64> {
    STAGED.with(|s| std::mem::take(&mut s.borrow_mut().nums))
}

#[wasm_bindgen]
pub fn take_strs() -> String {
    STAGED.with(|s| std::mem::take(&mut s.borrow_mut().strs))
}

#[wasm_bindgen]
pub fn take_lens() -> Vec<u32> {
    STAGED.with(|s| std::mem::take(&mut s.borrow_mut().lens))
}

// ─── Display formatting ([[D94]] oneNumberDisplay): the one copy the app's value boxes, popups and chips call ─────

thread_local! {
    static DISPLAY: std::cell::Cell<crate::card_helpers::NumberDisplay> =
        std::cell::Cell::new(crate::card_helpers::NumberDisplay::default());
}

/// The "Decimal places" and "Scientific from" settings every unformatted number shows by; the app sets them on load
/// and on each change.
#[wasm_bindgen]
pub fn display_settings(number_decimals: Option<f64>, sci_above: Option<String>) {
    DISPLAY.with(|d| d.set(crate::card_helpers::NumberDisplay::from_settings(number_decimals, sci_above.as_deref())));
}

/// A number nobody formatted, as the Format Controller's General style shows it.
#[wasm_bindgen]
pub fn fmt_scalar(n: f64) -> String {
    crate::card_helpers::format_scalar(n, DISPLAY.with(std::cell::Cell::get))
}

/// A number as a format annotation (its JSON) shows it.
#[wasm_bindgen]
pub fn fmt_annotated(n: f64, annotation: &str) -> String {
    let j: serde_json::Value = serde_json::from_str(annotation).unwrap_or(serde_json::Value::Null);
    let ann = crate::card_helpers::Annotation::from_json(&j);
    crate::card_helpers::format_number_with_annotation(n, &ann, DISPLAY.with(std::cell::Cell::get))
}

/// A date serial in a `YYYY-MM-DD`-style pattern.
#[wasm_bindgen]
pub fn fmt_date(serial: f64, pattern: &str) -> String {
    crate::date_serial::format_date_serial(serial, pattern)
}

/// Whether a card cell's text is a hex colour, as the Cards view draws it.
#[wasm_bindgen]
pub fn card_is_hex_color(text: &str) -> bool {
    crate::card_helpers::is_hex_color(text)
}

/// The address a card cell's text links to, if any.
#[wasm_bindgen]
pub fn card_link_href(text: &str) -> Option<String> {
    crate::card_helpers::link_href(text)
}

/// The image a Record cell's text shows, if any ([[C103]] untrustedContentSeams).
#[wasm_bindgen]
pub fn card_image_src(text: &str) -> Option<String> {
    crate::card_helpers::record_image_src(text)
}
