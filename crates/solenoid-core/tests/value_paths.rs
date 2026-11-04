// [[D114]] dateIsAKind, [[value-semantics#Comparing, keying and storing a value]]
//! Fails a local value reading outside the places allowed one.

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

/// Each pattern and the places allowed it.
const ALLOWED: &[(&str, &[&str])] = &[
    ("fn strict_eq(", &[]),
    (
        "V::Num(n) => FrameCell::Num(*n)",
        &["src/frame.rs", "src/nodes/columnar.rs", "src/frame_fns.rs", "src/nodes/text.rs"],
    ),
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
    assert!(
        found.is_empty(),
        "a local value reading; use its one path ([[value-semantics#Comparing, keying and storing a value]]):\n{}",
        found.join("\n")
    );
}
