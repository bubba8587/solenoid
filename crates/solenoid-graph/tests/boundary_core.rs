// [[D102]] graphOnCore, [[C10]] socketLattice, [[E9]] errorsKeepOrigin
//! The boundary on core values held to the frozen answers the JavaScript boundary gives
//! (`fixtures/core/boundary-*.json.gz`, written by `tests/graph/coreBoundary.test.ts`): every rung, full and
//! element-only, units kept and stripped; and the origin tagging of what a card answers.

use std::io::Read;
use std::rc::Rc;

use serde_json::{json, Map, Value as Json};
use solenoid_core::error_value::{sol_error, ErrorCode, Origin, SolError};
use solenoid_core::excel_functions::V;
use solenoid_core::nodes::{Column, Cube, CubeColumn, Frame};
use solenoid_core::unit_dims::UnitCell;
use solenoid_graph::boundary_core::{
    coerce_all, from_thrown, same_obj, with_origin, Arrived, Facts,
};

fn frozen(suite: &str) -> Vec<Json> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(format!("../../fixtures/core/{suite}.json.gz"));
    let mut s = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(path).unwrap())
        .read_to_string(&mut s)
        .unwrap();
    serde_json::from_str::<Vec<Json>>(&s).unwrap()
}

fn num(j: &Json) -> f64 {
    match j {
        Json::Number(n) => n.as_f64().unwrap(),
        Json::Object(o) => match o.get("__nf").and_then(Json::as_str) {
            Some("inf") => f64::INFINITY,
            Some("-inf") => f64::NEG_INFINITY,
            Some("-0") => -0.0,
            _ => f64::NAN,
        },
        _ => f64::NAN,
    }
}

fn list(items: Vec<V>) -> V {
    V::List(Rc::new(items))
}

/// A described value (`describe_` in coreBoundary.test.ts, through `enc`) as the core holds it.
fn value(j: &Json) -> Arrived {
    let bare = |v| Arrived { v, munit: None };
    match j {
        Json::Null => bare(V::Null),
        Json::Bool(b) => bare(V::Bool(*b)),
        Json::Number(_) => bare(V::Num(num(j))),
        Json::String(s) => bare(V::str(s)),
        Json::Array(a) => bare(list(a.iter().map(|x| value(x).v).collect())),
        Json::Object(o) => {
            if o.contains_key("__nf") {
                return bare(V::Num(num(j)));
            }
            if o.contains_key("__undef") {
                return bare(V::Undef);
            }
            if let Some(code) = o.get("#err").and_then(Json::as_str) {
                return bare(V::err(SolError {
                    origin: o.get("origin").and_then(Origin::from_json).map(Rc::new),
                    ..sol_error(
                        ErrorCode::from_wire(code),
                        o.get("msg").and_then(Json::as_str).unwrap_or(""),
                    )
                }));
            }
            if let Some(cells) = o.get("#arr") {
                return Arrived {
                    v: value(cells).v,
                    munit: o.get("unit").cloned().map(Rc::new),
                };
            }
            if o.get("__cx") == Some(&Json::Bool(true)) {
                return bare(V::Cx(num(&o["re"]), num(&o["im"])));
            }
            if o.get("__unitCell") == Some(&Json::Bool(true)) {
                return bare(V::Unit(Rc::new(UnitCell {
                    value: num(&o["value"]),
                    dim: o["dim"]
                        .as_object()
                        .unwrap()
                        .iter()
                        .map(|(k, x)| (k.clone(), num(x)))
                        .collect(),
                    display: o.get("display").and_then(Json::as_str).map(String::from),
                    ratio: o.get("ratio").and_then(Json::as_bool).unwrap_or(false),
                    scale: None,
                    offset: None,
                    unit_dim: None,
                })));
            }
            if o.get("__frame") == Some(&Json::Bool(true)) {
                let columns = o["columns"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|c| Column {
                        name: c["name"].as_str().unwrap().to_string(),
                        ty: c["type"].as_str().unwrap().parse().unwrap(),
                        values: c["values"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .map(|x| value(x).v)
                            .collect(),
                        unit: c.get("unit").cloned(),
                        format: c.get("format").cloned(),
                        raw: c.get("raw").cloned(),
                    })
                    .collect();
                return bare(V::Frame(Rc::new(Frame {
                    columns,
                    total_rows: None,
                    approx: None,
                })));
            }
            if o.get("__cube") == Some(&Json::Bool(true)) {
                let columns = o["columns"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|c| CubeColumn {
                        name: c["name"].as_str().unwrap().to_string(),
                        cells: c["cells"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .map(|x| value(x).v)
                            .collect(),
                        ty: c
                            .get("type")
                            .and_then(Json::as_str)
                            .map(|t| t.parse().unwrap()),
                        format: c.get("format").cloned(),
                    })
                    .collect();
                return bare(V::Cube(Rc::new(Cube { columns })));
            }
            panic!("a described value this test can't read: {j}")
        }
    }
}

fn n(x: f64) -> Json {
    if x.is_nan() {
        json!({ "__nf": "nan" })
    } else if x.is_infinite() {
        json!({ "__nf": if x > 0.0 { "inf" } else { "-inf" } })
    } else if x == 0.0 && x.is_sign_negative() {
        json!({ "__nf": "-0" })
    } else {
        json!(x)
    }
}

/// A value described as `describe_` and `enc` write it, a cube's depth left out.
fn describe(v: &V, munit: Option<&Json>) -> Json {
    let d = |x: &V| describe(x, None);
    match v {
        V::Null => Json::Null,
        V::Undef => json!({ "__undef": 1 }),
        V::Num(x) => n(*x),
        V::Str(s) => Json::String(s.to_string()),
        V::Bool(b) => Json::Bool(*b),
        V::Err(e) => {
            let mut o = Map::new();
            o.insert("#err".into(), e.code.as_str().into());
            o.insert("msg".into(), e.message.clone().into());
            if let Some(origin) = &e.origin {
                o.insert("origin".into(), origin.to_json());
            }
            Json::Object(o)
        }
        V::List(items) => {
            let cells = Json::Array(items.iter().map(d).collect());
            match munit {
                Some(u) => json!({ "#arr": cells, "unit": u }),
                None => cells,
            }
        }
        V::Cx(re, im) => json!({ "__cx": true, "re": n(*re), "im": n(*im) }),
        V::Unit(u) => {
            let mut o = Map::new();
            o.insert("__unitCell".into(), true.into());
            o.insert("value".into(), n(u.value));
            o.insert(
                "dim".into(),
                Json::Object(u.dim.iter().map(|(k, x)| (k.clone(), n(*x))).collect()),
            );
            if let Some(display) = &u.display {
                o.insert("display".into(), display.clone().into());
            }
            if u.ratio {
                o.insert("ratio".into(), true.into());
            }
            Json::Object(o)
        }
        V::Frame(f) => {
            let columns: Vec<Json> = f
                .columns
                .iter()
                .map(|c| {
                    let mut o = Map::new();
                    o.insert("name".into(), c.name.clone().into());
                    o.insert("type".into(), c.ty.as_str().into());
                    o.insert(
                        "values".into(),
                        Json::Array(c.values.iter().map(d).collect()),
                    );
                    for (k, x) in [("unit", &c.unit), ("format", &c.format), ("raw", &c.raw)] {
                        if let Some(x) = x {
                            o.insert(k.into(), x.clone());
                        }
                    }
                    Json::Object(o)
                })
                .collect();
            json!({ "__frame": true, "columns": columns })
        }
        V::Cube(c) => {
            let columns: Vec<Json> = c
                .columns
                .iter()
                .map(|c| {
                    let mut o = Map::new();
                    o.insert("name".into(), c.name.clone().into());
                    o.insert("cells".into(), Json::Array(c.cells.iter().map(d).collect()));
                    if let Some(t) = &c.ty {
                        o.insert("type".into(), t.as_str().into());
                    }
                    if let Some(f) = &c.format {
                        o.insert("format".into(), f.clone());
                    }
                    Json::Object(o)
                })
                .collect();
            json!({ "__cube": true, "columns": columns })
        }
        other => panic!("no description for {other:?}"),
    }
}

/// Numbers as f64 throughout and a cube's depth dropped, so two descriptions compare by what they say.
fn norm(j: &Json) -> Json {
    match j {
        Json::Number(x) => json!(x.as_f64().unwrap()),
        Json::Array(a) => Json::Array(a.iter().map(norm).collect()),
        Json::Object(o) => {
            // A key JavaScript holds as `undefined` is a key the core leaves out.
            let undef = json!({ "__undef": 1 });
            Json::Object(
                o.iter()
                    .filter(|(k, x)| k.as_str() != "depth" && **x != undef)
                    .map(|(k, x)| (k.clone(), norm(x)))
                    .collect(),
            )
        }
        other => other.clone(),
    }
}

fn probe() -> Origin {
    Origin {
        node_id: "probe".into(),
        node_name: "Probe".into(),
        input_slot: None,
    }
}

#[test]
fn arrival_on_every_rung() {
    let cases = frozen("boundary-arrival");
    assert!(cases.len() > 7000);
    let mut bad = Vec::new();
    for c in &cases {
        let rung = c["rung"].as_str().unwrap().to_string();
        let mode = c["mode"].as_str().unwrap();
        let input = value(&c["v"]);
        let facts = Facts {
            unit_aware: c["keep"].as_bool().unwrap(),
            raw: if mode == "raw" {
                vec!["a".into()]
            } else {
                Vec::new()
            },
            no_widen: if mode == "nowiden" {
                vec!["a".into()]
            } else {
                Vec::new()
            },
            ..Facts::default()
        };
        let got = if let V::Err(_) = input.v {
            json!({ "error": describe(&input.v, None)["#err"], "msg": describe(&input.v, None)["msg"] })
        } else {
            let rung_of = |k: &str| (k == "a").then(|| rung.clone());
            match coerce_all(&facts, &rung_of, &[("a".to_string(), vec![input.clone()])]) {
                Ok(out) => {
                    // The probe answers its input list, whose cells the guard then tags: an error as the value itself
                    // gets the probe as its origin.
                    let a = &out[0].1[0];
                    match with_origin(&list(vec![a.v.clone()]), &probe) {
                        Some(V::List(t)) => json!({ "val": describe(&t[0], None), "same": false }),
                        Some(_) => unreachable!("a list tags as a list"),
                        None => {
                            json!({ "val": describe(&a.v, a.munit.as_deref()), "same": same_obj(&a.v, &input.v) })
                        }
                    }
                }
                Err(t) => {
                    let e = describe(&from_thrown(t), None);
                    json!({ "error": e["#err"], "msg": e["msg"] })
                }
            }
        };
        if norm(&got) != norm(&c["want"]) {
            bad.push(json!({ "rung": c["rung"], "mode": c["mode"], "keep": c["keep"], "v": c["v"], "want": c["want"], "got": got }));
        }
    }
    assert!(
        bad.is_empty(),
        "{} of {} differ, the first: {}",
        bad.len(),
        cases.len(),
        Json::Array(bad.into_iter().take(4).collect())
    );
}

#[test]
fn origin_tagging() {
    let cases = frozen("boundary-origins");
    let mut bad = Vec::new();
    for c in &cases {
        let input = value(&c["v"]);
        // `out === v`, which NaN never is.
        let (out, same) = match with_origin(&input.v, &probe) {
            Some(t) => (t, false),
            None => (input.v.clone(), !matches!(input.v, V::Num(x) if x.is_nan())),
        };
        let got = json!({ "val": describe(&out, input.munit.as_deref()), "same": same });
        if norm(&got) != norm(&c["want"]) {
            bad.push(json!({ "v": c["v"], "want": c["want"], "got": got }));
        }
    }
    assert!(
        bad.is_empty(),
        "{} differ, the first: {}",
        bad.len(),
        Json::Array(bad.into_iter().take(4).collect())
    );
}

#[test]
fn the_direct_classes_are_sorted() {
    let d = solenoid_core::nodes::DIRECT;
    assert!(
        d.windows(2).all(|w| w[0] < w[1]),
        "nodes::DIRECT must stay sorted: is_direct searches it"
    );
}

#[test]
fn many_distinct_errors_tag_in_linear_time_and_repeats_share_a_copy() {
    let errs: Vec<V> = (0..40_000)
        .map(|i| V::err(sol_error(ErrorCode::DivZero, format!("row {i}"))))
        .collect();
    let mut cells = errs.clone();
    cells.push(errs[7].clone());
    let t0 = std::time::Instant::now();
    let Some(V::List(out)) = with_origin(&list(cells), &probe) else {
        panic!("a list of errors tags as a list")
    };
    assert!(t0.elapsed().as_secs_f64() < 1.0, "{:?}", t0.elapsed());
    let (V::Err(first), V::Err(again), V::Err(other)) = (&out[7], &out[40_000], &out[8]) else {
        panic!("errors stay errors")
    };
    assert!(Rc::ptr_eq(first, again));
    assert!(!Rc::ptr_eq(first, other));
    assert_eq!(first.origin.as_ref().unwrap().node_id, "probe");
}
