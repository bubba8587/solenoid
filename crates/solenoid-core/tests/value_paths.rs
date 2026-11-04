// [[D114]] dateIsAKind
//! Each way of reading a value for a comparison, a key or a cell has one path (`tree/specs/values/value-semantics.md`
//! § Comparing, keying and storing a value). A card that builds its own converter with a catch-all lets a new kind fall
//! to text or to a shared key; this fails on one.

use std::path::Path;

fn sources(dir: &Path, out: &mut Vec<(String, String)>) {
    for e in std::fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        if p.is_dir() {
            sources(&p, out);
        } else if p.extension().is_some_and(|x| x == "rs") {
            let rel = p
                .strip_prefix(std::env::var("CARGO_MANIFEST_DIR").unwrap())
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            out.push((rel, std::fs::read_to_string(&p).unwrap()));
        }
    }
}

/// The places allowed each pattern, with why.
const ALLOWED: &[(&str, &[&str])] = &[
    // A local `===` copy instead of `strict_equals`.
    ("fn strict_eq(", &[]),
    // A value-to-cell `match` beside the one in `FrameCell::of_scalar`: the computed-cell tagging (a NaN, a format and
    // a list each have their own error), the binary list transport (a date there keeps its tag on the JSON path), a
    // frame function's argument (a date is refused there until its column is typed) and Cast to Logical's reading.
    (
        "V::Num(n) => FrameCell::Num(*n)",
        &["src/frame.rs", "src/nodes/columnar.rs", "src/frame_fns.rs", "src/nodes/text.rs"],
    ),
    // A value's display text made into a cell something then compares.
    ("FrameCell::str(&value_text(", &["src/nodes/list.rs"]),
];

#[test]
fn every_value_reading_goes_through_its_one_path() {
    let mut files = Vec::new();
    sources(&Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("src"), &mut files);
    let mut found = Vec::new();
    for (pattern, allowed) in ALLOWED {
        for (file, text) in &files {
            let hits = text.matches(pattern).count();
            if hits > 0 && !allowed.contains(&file.as_str()) {
                found.push(format!("{file}: {hits} × `{pattern}`"));
            }
        }
    }
    assert!(found.is_empty(), "a local value reading; use its one path (value-semantics.md):\n{}", found.join("\n"));
}
