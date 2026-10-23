//! [[D99]] rustIsSpec: every card body on the core answers as its frozen TypeScript did (`fixtures/core/nodes/`,
//! frozen by `scripts/freeze-nodes.mjs`). A class with no body on the core is skipped; one with a body must answer
//! every frozen case. `NODES=ArithmeticNode,MathFXNode cargo test --test nodes` runs only those.

use serde_json::Value as Json;
use solenoid_core::excel_functions::V;
use solenoid_core::nodes::{reply, Shown};
use std::io::Read;
use std::path::PathBuf;

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/core/nodes")
}

fn load(path: &std::path::Path) -> Vec<Json> {
    let mut s = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(path).unwrap()).read_to_string(&mut s).unwrap();
    serde_json::from_str(&s).unwrap()
}

/// The same value as the TS reads it back: numbers by their bits (any NaN is NaN), errors by code and message, unit
/// cells by what crosses back.
fn same(a: &V, b: &V) -> bool {
    match (a, b) {
        (V::Num(x), V::Num(y)) => x.to_bits() == y.to_bits() || (x.is_nan() && y.is_nan()),
        (V::Str(x), V::Str(y)) => x == y,
        (V::Bool(x), V::Bool(y)) => x == y,
        (V::Null, V::Null) | (V::Undef, V::Undef) => true,
        (V::Err(x), V::Err(y)) => x.code == y.code && x.message == y.message,
        (V::Cx(a1, b1), V::Cx(a2, b2)) => same(&V::Num(*a1), &V::Num(*a2)) && same(&V::Num(*b1), &V::Num(*b2)),
        (V::List(x), V::List(y)) => x.len() == y.len() && x.iter().zip(y.iter()).all(|(p, q)| same(p, q)),
        (V::Unit(x), V::Unit(y)) => {
            same(&V::Num(x.value), &V::Num(y.value)) && x.display == y.display && x.ratio == y.ratio && {
                let nz = |d: &std::collections::BTreeMap<String, f64>| {
                    d.iter().filter(|(_, v)| **v != 0.0).map(|(k, v)| (k.clone(), v.to_bits())).collect::<Vec<_>>()
                };
                nz(&x.dim) == nz(&y.dim)
            }
        }
        (V::Json(x), V::Json(y)) => x == y,
        // A LAMBDA by what its reader sees: its parameters, its body's text, the names it captures with their values
        // as the body reads them and with their units, and its notes on its variables.
        (V::Lambda(x), V::Lambda(y)) => {
            let read = |l: &solenoid_core::eval::LambdaV| {
                l.captured.iter().flatten().map(|n| l.env.get(n).cloned().unwrap_or(V::Undef)).collect::<Vec<_>>()
            };
            let all = |a: &[V], b: &[V]| a.len() == b.len() && a.iter().zip(b).all(|(p, q)| same(p, q));
            x.params == y.params
                && x.src == y.src
                && x.eta == y.eta
                && x.captured == y.captured
                && x.descriptions == y.descriptions
                && all(&read(x), &read(y))
                && all(&x.units, &y.units)
        }
        (V::Frame(x), V::Frame(y)) => {
            x.total_rows == y.total_rows
                && x.approx == y.approx
                && x.columns.len() == y.columns.len()
                && x.columns.iter().zip(&y.columns).all(|(p, q)| {
                    p.name == q.name
                        && p.ty == q.ty
                        && p.unit == q.unit
                        && p.format == q.format
                        && p.raw == q.raw
                        && p.values.len() == q.values.len()
                        && p.values.iter().zip(&q.values).all(|(a, b)| same(a, b))
                })
        }
        (V::Cube(x), V::Cube(y)) => {
            x.columns.len() == y.columns.len()
                && x.columns.iter().zip(&y.columns).all(|(p, q)| {
                    p.name == q.name
                        && p.ty == q.ty
                        && p.format == q.format
                        && p.cells.len() == q.cells.len()
                        && p.cells.iter().zip(&q.cells).all(|(a, b)| same(a, b))
                })
        }
        _ => false,
    }
}

fn show(v: &V) -> String {
    match v {
        V::Num(n) => format!("{n:?}"),
        V::Str(s) => format!("{s:?}"),
        V::Bool(b) => b.to_string(),
        V::Null => "null".into(),
        V::Undef => "undefined".into(),
        V::Err(e) => format!("{}({:?})", e.code, e.message),
        V::Cx(a, b) => format!("cx({a},{b})"),
        V::List(l) => format!("[{}]", l.iter().map(show).collect::<Vec<_>>().join(", ")),
        V::Unit(u) => format!("unit({} {:?} {:?})", u.value, u.dim, u.display),
        V::Lambda(_) => "lambda".into(),
        V::Fx(m) => format!("fx({m})"),
        V::Json(j) => j.to_string(),
        V::Frame(f) => format!(
            "frame[{}]",
            f.columns
                .iter()
                .map(|c| format!("{}: [{}]", c.name, c.values.iter().map(show).collect::<Vec<_>>().join(", ")))
                .collect::<Vec<_>>()
                .join("; ")
        ),
        V::Cube(c) => format!(
            "cube[{}]",
            c.columns
                .iter()
                .map(|c| format!("{}: [{}]", c.name, c.cells.iter().map(show).collect::<Vec<_>>().join(", ")))
                .collect::<Vec<_>>()
                .join("; ")
        ),
    }
}

fn dec(j: &Json) -> V {
    solenoid_core::nodes::decode(j)
}

/// Why the core's answer differs from the frozen one, or `None` where they agree.
fn mismatch(case: &Json) -> Option<String> {
    let mut args = case.clone();
    args["clock"] = case["ctx"]["clock"].clone();
    let r = reply(&args);
    let answer = r.answer.expect("checked by the caller");
    // A JS exception froze as its text; the error guard shows it as this error, which is what the card answered.
    let mut result = case["result"].clone();
    if let Some(t) = result.get("thrownJs").and_then(Json::as_str).map(String::from) {
        let (name, msg) = t.split_once(": ").unwrap_or(("Error", t.as_str()));
        let e = if name == "ShapeError" {
            serde_json::json!({ "__err": "#SHAPE!", "msg": msg })
        } else {
            serde_json::json!({ "__err": "#ERROR!", "msg": format!("This node failed to compute: {msg}") })
        };
        result = serde_json::json!({ "thrown": e });
    }
    let result = &result;
    match (&answer, result.get("out"), result.get("thrown")) {
        (Ok(outs), Some(Json::Object(want)), _) => {
            for (k, w) in want {
                match outs.iter().find(|(o, _)| o == k) {
                    Some((_, got)) if same(got, &dec(w)) => {}
                    Some((_, got)) => return Some(format!("out {k}: got {}, want {}", show(got), show(&dec(w)))),
                    None => return Some(format!("out {k}: missing, want {}", show(&dec(w)))),
                }
            }
            if let Some((k, _)) = outs.iter().find(|(o, _)| !want.contains_key(o)) {
                return Some(format!("out {k}: not frozen"));
            }
            for (k, w) in want {
                let got = r.matrix_units.iter().find(|(o, _)| o == k && !o.starts_with("display:")).map(|(_, u)| u);
                if got != w.get("__munit") {
                    return Some(format!("out {k}: table unit {got:?}, want {:?}", w.get("__munit")));
                }
            }
        }
        (Err(e), _, Some(w)) if same(e, &dec(w)) => {}
        (Ok(outs), _, _) => {
            return Some(format!(
                "got outputs {:?}, want {result}",
                outs.iter().map(|(k, v)| format!("{k}={}", show(v))).collect::<Vec<_>>()
            ))
        }
        (Err(e), _, _) => return Some(format!("threw {}, want {result}", show(e))),
    }
    let want = case["display"].as_object().cloned().unwrap_or_default();
    let prior = case["prior"].as_object().cloned().unwrap_or_default();
    let mut set = std::collections::BTreeSet::new();
    for (k, got) in &r.display {
        set.insert(k.clone());
        let w = want.get(k).or_else(|| prior.get(k));
        let ok = match (got, w) {
            (Shown::Undef, None) => true,
            (Shown::Undef, Some(w)) => w.get("__undef").is_some(),
            (Shown::V(g), Some(w)) if w.get("__deleted").is_none() => same(g, &dec(w)),
            _ => false,
        };
        if !ok {
            let g = match got {
                Shown::V(v) => show(v),
                Shown::Undef => "undefined".into(),
            };
            return Some(format!("display {k}: got {g}, want {w:?}"));
        }
    }
    if let Some(k) = want.keys().find(|k| !set.contains(*k)) {
        return Some(format!("display {k}: not set, want {}", want[k]));
    }
    None
}

#[test]
fn card_bodies_answer_as_frozen() {
    let only: Option<Vec<String>> = std::env::var("NODES").ok().map(|s| s.split(',').map(String::from).collect());
    let mut files: Vec<_> = std::fs::read_dir(fixtures()).unwrap().map(|e| e.unwrap().path()).collect();
    files.sort();
    let (mut ported, mut failures) = (0, Vec::new());
    for path in files {
        let kind = path.file_name().unwrap().to_str().unwrap().trim_end_matches(".json.gz").to_string();
        if only.as_ref().is_some_and(|o| !o.contains(&kind)) {
            continue;
        }
        let cases = load(&path);
        let Some(first) = cases.first() else { continue };
        let mut probe = first.clone();
        probe["kind"] = Json::String(kind.clone());
        if reply(&probe).answer.is_none() {
            continue;
        }
        ported += 1;
        let (mut bad, mut shown) = (0, Vec::new());
        for case in &cases {
            if case.get("unstable").is_some() {
                continue;
            }
            let mut case = case.clone();
            case["kind"] = Json::String(kind.clone());
            if let Some(why) = mismatch(&case) {
                bad += 1;
                if shown.len() < 4 {
                    shown.push(format!(
                        "    {why}\n      init {} lits {} inputs {}",
                        case["init"], case["literals"], case["inputs"]
                    ));
                }
            }
        }
        if bad > 0 {
            failures.push(format!("{kind}: {bad} of {} differ\n{}", cases.len(), shown.join("\n")));
        }
    }
    eprintln!("{ported} classes on the core");
    assert!(failures.is_empty(), "\n{}", failures.join("\n"));
}
