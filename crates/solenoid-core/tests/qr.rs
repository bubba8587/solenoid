// [[D99]] rustIsSpec
//! The QR Code card's encoder: what it draws reads back, with `rqrr`, to the text it was given at the level it was asked.

use qrcodegen::QrCodeEcc;
use solenoid_core::nodes::qr::encode;

const LEVELS: [(&str, QrCodeEcc); 4] =
    [("L", QrCodeEcc::Low), ("M", QrCodeEcc::Medium), ("Q", QrCodeEcc::Quartile), ("H", QrCodeEcc::High)];

/// A text in each mode and a few mixes, the card's own payloads, and one past a mid-size version.
fn texts() -> Vec<String> {
    let mut t: Vec<String> = [
        "0123456789",
        "HELLO WORLD",
        "hello world",
        "https://example.com/path?q=1&r=two#frag",
        "ABC12345678DEF",
        "naïve café",
        "日本語のテキスト",
        "😀ok",
        "line one\nline two",
        r"WIFI:T:WPA;S:My\;Net;P:se\:cret;;",
        "BEGIN:VCARD\nVERSION:3.0\nFN:Ada Lovelace\nEMAIL:ada@x.io\nEND:VCARD",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    t.push("A".repeat(60) + &"1".repeat(60) + &"a".repeat(60));
    t
}

#[test]
fn a_symbol_reads_back_to_its_text_at_the_level_asked() {
    let mut bad = Vec::new();
    for text in texts() {
        for (name, ecc) in LEVELS {
            let sym = encode(&text, ecc).unwrap();
            let size = sym.size() as usize;
            let grid = rqrr::SimpleGrid::from_func(size, |x, y| sym.get_module(x as i32, y as i32));
            match rqrr::Grid::new(grid).decode() {
                // The level stays as asked: the encoder never raises it to fill a version.
                Ok((meta, got)) if got == text && ["M", "L", "H", "Q"][meta.ecc_level as usize] == name => {}
                Ok((meta, got)) => bad.push(format!(
                    "{text:?} {name}: read {got:?} at {}",
                    ["M", "L", "H", "Q"][meta.ecc_level as usize]
                )),
                Err(e) => bad.push(format!("{text:?} {name}: {e:?}")),
            }
        }
    }
    assert!(bad.is_empty(), "{}", bad.join("\n"));
}

#[test]
fn a_text_past_the_largest_symbol_is_refused() {
    assert_eq!(
        encode(&"a".repeat(3000), QrCodeEcc::High).err().as_deref(),
        Some("The amount of data is too big to be stored in a QR Code")
    );
}
