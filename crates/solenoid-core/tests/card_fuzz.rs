// [[C130]] rustCore
//! Every frozen card case (`fixtures/core/nodes/`, up to 300 a class) run four times with a third of its text, in its
//! settings, typed literals and wired inputs, swapped for hostile text (emoji, combining marks, separators the
//! option readers split on, huge and non-finite numbers as text). None may panic: the shipped engine aborts on one,
//! which takes the whole graph down. The card fuzz beside `fuzz_formulas.rs`, which reaches only formula functions.
use serde_json::Value as Json;
use solenoid_core::nodes::reply;
use std::io::Read;

const NASTY: &[&str] = &[
    "",
    " ",
    "é",
    "😀",
    "e\u{301}",
    "ß",
    "İ",
    "\u{FFFD}",
    "a😀b=c;d",
    "=",
    ";",
    "😀=😀",
    "x=😀;y=é",
    "#😀",
    "[😀]",
    "{😀}",
    "(",
    ")",
    "\\",
    "\"",
    "😀,😀",
    "-",
    "+",
    "1e309",
    "-0",
    "NaN",
    "Infinity",
    "99999999999999999999999999999999999999999999999999",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "\n\n",
    "\t",
    "ylim=😀",
    "xlim=,",
    "lw=é",
    "😀:1",
    "#",
    "@",
    "$",
    "%",
    "😀%",
    "1/0",
    "2024-02-30",
    "😀-😀-😀",
    "H😀",
    "Hé2O",
    "e",
    "E",
    "0x",
    "١٢٣",
    "\u{202E}abc",
];

fn load(path: &std::path::Path) -> Vec<Json> {
    let mut s = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(path).unwrap()).read_to_string(&mut s).unwrap();
    serde_json::from_str(&s).unwrap()
}

fn mutate(j: &mut Json, next: &mut dyn FnMut(usize) -> usize, hits: &mut usize) {
    match j {
        Json::String(s) if !s.starts_with("__") => {
            if next(3) == 0 {
                *s = NASTY[next(NASTY.len())].to_string();
                *hits += 1;
            }
        }
        Json::Array(a) => a.iter_mut().for_each(|x| mutate(x, next, hits)),
        Json::Object(o) => o.iter_mut().filter(|(k, _)| !k.starts_with("__")).for_each(|(_, x)| mutate(x, next, hits)),
        _ => {}
    }
}

#[test]
fn hostile_text_never_panics_a_card() {
    // A panic's own message would flood the output; the cases that panicked are listed below instead.
    let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/core/nodes");
    let mut files: Vec<_> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().path()).collect();
    files.sort();
    let mut seed = 0x9E37_79B9_u64;
    let mut next = |m: usize| {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        (seed % m as u64) as usize
    };
    std::panic::set_hook(Box::new(|_| {}));
    let mut panics: std::collections::BTreeMap<String, (usize, String, String)> = Default::default();
    let mut runs = 0;
    for path in files {
        let kind = path.file_name().unwrap().to_str().unwrap().trim_end_matches(".json.gz").to_string();
        for case in load(&path).iter().take(300) {
            for _ in 0..4 {
                let mut c = case.clone();
                c["kind"] = Json::String(kind.clone());
                c["clock"] = case["ctx"]["clock"].clone();
                let mut hits = 0;
                for k in ["stringLiterals", "init", "inputs", "literals"] {
                    if let Some(x) = c.get_mut(k) {
                        mutate(x, &mut next, &mut hits);
                    }
                }
                if hits == 0 {
                    continue;
                }
                runs += 1;
                let shown = format!("lits {} init {} inputs {}", c["stringLiterals"], c["init"], c["inputs"]);
                if let Err(e) = std::panic::catch_unwind(|| reply(&c)) {
                    let msg = e
                        .downcast_ref::<String>()
                        .cloned()
                        .or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string()))
                        .unwrap_or_default();
                    let entry = panics.entry(kind.clone()).or_insert((0, msg, shown.chars().take(600).collect()));
                    entry.0 += 1;
                }
            }
        }
    }
    let _ = std::panic::take_hook();
    eprintln!("runs {runs}");
    for (k, (n, msg, shown)) in &panics {
        eprintln!("PANIC {k} x{n}: {msg}\n    {shown}");
    }
    assert!(panics.is_empty());
}
