//! [[D99]] rustIsSpec: the QR encoder draws the symbols the `qrcode` package drew (`fixtures/core/qr-encoder.json.gz`,
//! frozen by `tests/graph/coreQr.test.ts`): the same version, mask and modules, or the same error.

use serde_json::Value as Json;
use solenoid_core::qr::{encode, Level};
use std::io::Read;

#[test]
fn symbols_encode_as_frozen() {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/core/qr-encoder.json.gz");
    let mut s = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(path).unwrap()).read_to_string(&mut s).unwrap();
    let cases: Vec<Json> = serde_json::from_str(&s).unwrap();
    let mut bad = Vec::new();
    for c in &cases {
        let text = c["text"].as_str().unwrap();
        let level = match c["level"].as_str().unwrap() {
            "L" => Level::L,
            "Q" => Level::Q,
            "H" => Level::H,
            _ => Level::M,
        };
        let shown = if text.len() > 60 { format!("{}… ({} bytes)", &text[..text.char_indices().nth(40).map_or(text.len(), |(i, _)| i)], text.len()) } else { format!("{text:?}") };
        match (encode(text, level), c.get("thrown").and_then(Json::as_str)) {
            (Err(e), Some(want)) if e == want => {}
            (Err(e), _) => bad.push(format!("{shown} {level:?}: threw {e:?}")),
            (Ok(_), Some(want)) => bad.push(format!("{shown} {level:?}: drew a symbol, want {want:?}")),
            (Ok(sym), None) => {
                let modules: String = sym.modules.chunks(4).map(|n| {
                    let nib = (0..4).fold(0u32, |a, b| (a << 1) | n.get(b).copied().unwrap_or(0) as u32);
                    char::from_digit(nib, 16).unwrap()
                }).collect();
                let (version, mask) = (c["version"].as_u64().unwrap() as usize, c["mask"].as_u64().unwrap() as u32);
                if sym.version != version || sym.mask != mask || modules != c["modules"].as_str().unwrap() {
                    let diff = modules.chars().zip(c["modules"].as_str().unwrap().chars()).filter(|(a, b)| a != b).count();
                    bad.push(format!("{shown} {level:?}: version {} mask {}, want {version} {mask}; {diff} nibbles differ", sym.version, sym.mask));
                }
            }
        }
    }
    assert!(bad.is_empty(), "{} of {} differ:\n{}", bad.len(), cases.len(), bad.iter().take(30).cloned().collect::<Vec<_>>().join("\n"));
}
