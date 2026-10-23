//! [[D99]] rustIsSpec: the QR Code card's symbols (`fixtures/core/qr-encoder.json.gz`, frozen here with
//! `FREEZE_CORE=qr-encoder`): every mode and mode mix, lengths either side of each version's capacity, every error
//! correction level, and texts that pick each mask. Each frozen symbol is read back by `rqrr`, a decoder of its own,
//! to the text it was drawn from at the level and version it was drawn at.

use qrcodegen::{QrCode, QrCodeEcc, QrSegment, Version};
use serde_json::{json, Value as Json};
use solenoid_core::nodes::qr::encode;
use std::io::{Read, Write};

const LEVELS: [(&str, QrCodeEcc); 4] = [("L", QrCodeEcc::Low), ("M", QrCodeEcc::Medium), ("Q", QrCodeEcc::Quartile), ("H", QrCodeEcc::High)];

fn path() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/core/qr-encoder.json.gz")
}

fn level(name: &str) -> QrCodeEcc {
    LEVELS.iter().find(|(n, _)| *n == name).unwrap().1
}

fn mixes() -> Vec<String> {
    let mut m: Vec<String> = [
        "0", "7", "42", "123", "0123456789", "01234567890123456789", "A", "AB", "HELLO WORLD", "$%*+-./: ", "a", "hello world",
        "Hello, World!", "https://example.com", "https://example.com/path?q=1&r=two#frag", "HTTPS://EXAMPLE.COM/ABC",
        "ABC123", "123ABC", "A1B2C3D4", "ABC12345678DEF", "abc12345678def", "abc DEF ghi", "ABCDEFGH1234567890abcdefgh",
        "1234567890ABCDEFGHIJ", "x1234567890123456789y", "3.14159", "-7", "2024-01-15", "TRUE", "naïve café", "ÄÖü", "日本語のテキスト",
        "Ελληνικά", "😀ok", "😀😀😀", "line one\nline two", "tab\there", "WIFI:T:WPA;S:MyNet;P:secret;;",
        "BEGIN:VCARD\nVERSION:3.0\nFN:Ada Lovelace\nEMAIL:ada@x.io\nEND:VCARD", "MEBKM:TITLE:Example;URL:http://example.com;;",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "00000000000000000000000000000000000000000000000000",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    m.push("A".repeat(60) + &"1".repeat(60) + &"a".repeat(60));
    m.extend(["12AB34cd56EF78gh90", "ab1cd22ef333gh4444ij55555kl666666", "AB:CD/EF.GH-IJ+KL*MN%OP$QR", "Mississippi", "  pad  ", "A-B_C", "x,y"].map(String::from));
    m
}

/// A small seeded generator, so a refreeze draws the same texts.
fn rng(seed: u32) -> impl FnMut() -> f64 {
    let mut s = seed;
    move || {
        s = s.wrapping_add(0x6d2b79f5);
        let mut t = s;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        (t ^ (t >> 14)) as f64 / 4294967296.0
    }
}

/// The most of `ch` one segment holds at `version` and `ecc`.
fn capacity(ch: char, version: u8, ecc: QrCodeEcc) -> usize {
    let fits = |n: usize| QrCode::encode_segments_advanced(&QrSegment::make_segments(&ch.to_string().repeat(n)), ecc, Version::new(version), Version::new(version), None, false).is_ok();
    let (mut lo, mut hi) = (0, 7090);
    while lo + 1 < hi {
        let mid = (lo + hi) / 2;
        if fits(mid) { lo = mid } else { hi = mid }
    }
    lo
}

fn modules_hex(sym: &QrCode) -> String {
    let size = sym.size() as usize;
    let bit = |i: usize| i < size * size && sym.get_module((i % size) as i32, (i / size) as i32);
    (0..size * size).step_by(4).map(|i| char::from_digit((0..4).fold(0, |a, b| (a << 1) | bit(i + b) as u32), 16).unwrap()).collect()
}

fn case(text: &str, name: &str) -> Json {
    match encode(text, level(name)) {
        Ok(sym) => json!({ "text": text, "level": name, "version": sym.version().value(), "mask": sym.mask().value(), "size": sym.size(), "modules": modules_hex(&sym) }),
        Err(e) => json!({ "text": text, "level": name, "thrown": e }),
    }
}

fn generate() -> Vec<Json> {
    let mut out = Vec::new();
    for (name, _) in LEVELS {
        for t in mixes() {
            out.push(case(&t, name));
        }
    }
    // Either side of each version's capacity in each mode: every version up to 10 and the count-indicator widths'
    // boundaries (9 | 10, 26 | 27), a stride between, and the largest symbol's.
    let versions: Vec<u8> = (1..=12).chain([14, 17, 20, 23, 25, 26, 27, 28, 31, 35, 39, 40]).collect();
    for (name, ecc) in LEVELS {
        for ch in ['8', 'K', 'k'] {
            for &v in &versions {
                let n = capacity(ch, v, ecc);
                out.push(case(&ch.to_string().repeat(n), name));
                if name == "M" || [1, 9, 26, 39, 40].contains(&v) {
                    out.push(case(&ch.to_string().repeat(n + 1), name));
                }
            }
        }
    }
    // Texts that pick each mask, twice at each level.
    let mut rand = rng(7);
    let alphabet: Vec<char> = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 $%*+-./:".chars().collect();
    for (name, ecc) in LEVELS {
        let mut picked = [0; 8];
        let mut tries = 0;
        while tries < 20000 && picked.iter().any(|&k| k < 2) {
            tries += 1;
            let len = 1 + (rand() * 60.0).floor() as usize;
            let t: String = (0..len).map(|_| alphabet[(rand() * alphabet.len() as f64).floor() as usize]).collect();
            let mask = encode(&t, ecc).unwrap().mask().value() as usize;
            if picked[mask] >= 2 {
                continue;
            }
            picked[mask] += 1;
            out.push(case(&t, name));
        }
    }
    out
}

/// The cases, made and written once when freezing, read back otherwise.
fn frozen() -> &'static [Json] {
    static CASES: std::sync::OnceLock<Vec<Json>> = std::sync::OnceLock::new();
    CASES.get_or_init(read_or_freeze)
}

fn read_or_freeze() -> Vec<Json> {
    let freeze = std::env::var("FREEZE_CORE").unwrap_or_default();
    if freeze == "1" || freeze.split(',').any(|s| s == "qr-encoder") {
        let cases = generate();
        let mut gz = flate2::write::GzEncoder::new(std::fs::File::create(path()).unwrap(), flate2::Compression::best());
        gz.write_all(serde_json::to_string(&cases).unwrap().as_bytes()).unwrap();
        gz.finish().unwrap();
        return cases;
    }
    let mut s = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(path()).unwrap()).read_to_string(&mut s).unwrap();
    serde_json::from_str(&s).unwrap()
}

fn shown(text: &str) -> String {
    if text.len() > 60 { format!("{}… ({} bytes)", &text[..text.char_indices().nth(40).map_or(text.len(), |(i, _)| i)], text.len()) } else { format!("{text:?}") }
}

#[test]
fn symbols_encode_as_frozen() {
    let cases = frozen();
    let masks: std::collections::HashSet<String> = cases.iter().filter(|c| c.get("mask").is_some()).map(|c| format!("{}{}", c["level"], c["mask"])).collect();
    assert_eq!(masks.len(), 32, "every level picks every mask");
    let bad: Vec<String> = cases.iter().filter_map(|c| {
        let got = case(c["text"].as_str().unwrap(), c["level"].as_str().unwrap());
        (got != *c).then(|| format!("{} {}: drew {}, frozen {}", shown(c["text"].as_str().unwrap()), c["level"], got.get("version").or(got.get("thrown")).unwrap(), c.get("version").or(c.get("thrown")).unwrap()))
    }).collect();
    assert!(bad.is_empty(), "{} of {} differ:\n{}", bad.len(), cases.len(), bad.iter().take(30).cloned().collect::<Vec<_>>().join("\n"));
}

#[test]
fn frozen_symbols_decode_to_their_text() {
    let cases = frozen();
    let mut read = 0;
    let mut bad = Vec::new();
    for c in cases.iter().filter(|c| c.get("thrown").is_none()) {
        let (text, name) = (c["text"].as_str().unwrap(), c["level"].as_str().unwrap());
        let size = c["size"].as_u64().unwrap() as usize;
        let hex: Vec<u32> = c["modules"].as_str().unwrap().chars().map(|h| h.to_digit(16).unwrap()).collect();
        let grid = rqrr::SimpleGrid::from_func(size, |x, y| {
            let i = y * size + x;
            (hex[i >> 2] >> (3 - (i & 3))) & 1 == 1
        });
        match rqrr::Grid::new(grid).decode() {
            Ok((meta, got)) => {
                let ecc = ["M", "L", "H", "Q"][meta.ecc_level as usize];
                let want = (text, name, c["version"].as_u64().unwrap() as usize, c["mask"].as_u64().unwrap() as u16);
                if (got.as_str(), ecc, meta.version.0, meta.mask) != want {
                    bad.push(format!("{} {name}: read {:?} at {ecc} version {} mask {}", shown(text), shown(&got), meta.version.0, meta.mask));
                }
                read += 1;
            }
            Err(e) => bad.push(format!("{} {name}: {e:?}", shown(text))),
        }
    }
    assert!(bad.is_empty(), "{} unread:\n{}", bad.len(), bad.iter().take(30).cloned().collect::<Vec<_>>().join("\n"));
    assert!(read > 600, "{read} symbols read");
}
