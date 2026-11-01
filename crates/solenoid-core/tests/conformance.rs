// [[C130]] rustCore, [[D99]] rustIsSpec
//! The core against its frozen answers (`fixtures/core/<suite>.json.gz`), natively: every case `coreConformance.test.ts`
//! once replayed through the wasm build, asked here through the same commands and compared as the JS compares it. The
//! JS keeps a sample of each suite, which proves the wasm build answers as this one, and the freeze routine
//! (`tree/specs/computation/rust-core.md`). `SUITE=columns,verbs cargo test --test conformance` runs only those.
//!
//! The fixtures hold values as `coreFixtures.ts` `enc` writes them; the helpers below turn that form into what the JS
//! sends (`coreValue`, `wire`, `encodeBinary`) and the core's reply into what the JS compares (`readReply`, `canon`,
//! `unitData`, `view`), so a case passes here exactly where it passes there.

use std::cell::RefCell;
use std::io::Read;
use std::path::PathBuf;

use serde_json::{json, Map, Value as Json};
use solenoid_core::frame::FrameCell;
use solenoid_core::frame_backend::invoke;
use solenoid_core::wire::decode_cell;

// ─── Reading the fixtures ─────────────────────────────────────────────────────────

/// A lone surrogate escape as U+FFFD: the core's text is well formed, and the JS's crosses as `toWellFormed` makes it.
fn well_formed(text: &str) -> String {
    let b = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let hex = |at: usize| -> Option<u32> {
        (at + 6 <= b.len() && b[at] == b'\\' && b[at + 1] == b'u')
            .then(|| u32::from_str_radix(std::str::from_utf8(&b[at + 2..at + 6]).ok()?, 16).ok())
            .flatten()
    };
    let mut start = 0;
    let mut i = 0;
    while i < b.len() {
        if b[i] != b'\\' {
            i += 1;
            continue;
        }
        match hex(i) {
            Some(h @ 0xD800..=0xDBFF) if matches!(hex(i + 6), Some(0xDC00..=0xDFFF)) => {
                let _ = h;
                i += 12;
            }
            Some(0xD800..=0xDFFF) => {
                out.push_str(&text[start..i]);
                out.push_str("\\ufffd");
                i += 6;
                start = i;
            }
            _ => i += 2,
        }
    }
    out.push_str(&text[start..]);
    out
}

fn load(suite: &str) -> Vec<Json> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("../../fixtures/core/{suite}.json.gz"));
    let mut s = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(&path).unwrap()).read_to_string(&mut s).unwrap();
    serde_json::from_str(&well_formed(&s)).unwrap()
}

/// The moment the cases were made at and replay at (`coreConformance.test.ts`: 2026-06-15 13:45:30.250, UTC).
fn clock() -> Json {
    json!({ "now": 46188.573266782405, "ms": 1781531130250u64 })
}

/// Whether `SUITE` (comma separated) leaves this suite in.
fn runs(suite: &str) -> bool {
    std::env::var("SUITE").map_or(true, |s| s.split(',').any(|x| x == suite))
}

/// `JSON.stringify(a) === JSON.stringify(b)`, as data: numbers by value, which is how they print, and an object's keys
/// in any order.
fn same(a: &Json, b: &Json) -> bool {
    match (a, b) {
        (Json::Number(x), Json::Number(y)) => x.as_f64() == y.as_f64(),
        (Json::Array(x), Json::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same(p, q)),
        (Json::Object(x), Json::Object(y)) => {
            x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| same(v, w)))
        }
        _ => a == b,
    }
}

/// Whether `FREEZE_NATIVE` (comma separated, or 1 for all) names the suite: its moved answers are written back.
fn freezing(suite: &str) -> bool {
    std::env::var("FREEZE_NATIVE").is_ok_and(|s| s.split(',').any(|x| x == suite || x == "1"))
}

/// `check` over the suite's own file; under `FREEZE_NATIVE` the cases whose answer moved take the new one and the
/// file is rewritten, with no wasm build between a change and its fixtures. The wasm replay (`coreConformance.test.ts`)
/// then holds the module to them.
fn check_or_freeze(suite: &str, got: impl Fn(&Json) -> Json) {
    if !freezing(suite) {
        return check(suite, &load(suite), got);
    }
    let mut cases = load(suite);
    let mut moved = 0;
    for c in &mut cases {
        let g = got(c);
        if !same(&g, &c["want"]) {
            c["want"] = g;
            moved += 1;
        }
    }
    if moved > 0 {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("../../fixtures/core/{suite}.json.gz"));
        let mut gz = flate2::write::GzEncoder::new(std::fs::File::create(&path).unwrap(), flate2::Compression::best());
        std::io::Write::write_all(&mut gz, serde_json::to_string(&cases).unwrap().as_bytes()).unwrap();
        gz.finish().unwrap();
    }
    eprintln!("{suite}: {moved} re-answered");
}

/// Every case's `got` against its `want`; the suite fails with the first few that differ.
fn check(suite: &str, cases: &[Json], got: impl Fn(&Json) -> Json) {
    if !runs(suite) {
        return;
    }
    let started = std::time::Instant::now();
    let mut bad = Vec::new();
    let mut n = 0;
    for c in cases {
        let g = got(c);
        if !same(&g, &c["want"]) {
            n += 1;
            if bad.len() < 4 {
                bad.push(format!("  case {}\n    got  {}", c, g));
            }
        }
    }
    assert!(n == 0, "{suite}: {n} of {} differ\n{}", cases.len(), bad.join("\n"));
    eprintln!("{suite}: {} cases in {:.1?}", cases.len(), started.elapsed());
}

// ─── Values as the JS sends them ──────────────────────────────────────────────────

fn tag<'a>(v: &'a Json, key: &str) -> Option<&'a Json> {
    v.as_object().and_then(|o| o.get(key))
}

fn is_undef(v: &Json) -> bool {
    tag(v, "__undef").is_some()
}

fn flag(v: &Json, key: &str) -> bool {
    tag(v, key) == Some(&Json::Bool(true))
}

thread_local! {
    /// The errors sent with a reference (`errorRef`), so one the core hands back comes back as itself.
    static SENT: RefCell<Vec<(String, String)>> = const { RefCell::new(Vec::new()) };
}

/// A fixture error `{__err, msg}` as `wireCell` sends one: with the reference it comes back under.
fn sent_error(v: &Json) -> Json {
    let (code, msg) = (v["__err"].as_str().unwrap().to_string(), v["msg"].as_str().unwrap_or("").to_string());
    let id = SENT.with(|s| {
        let mut s = s.borrow_mut();
        s.push((code.clone(), msg.clone()));
        s.len()
    });
    let mut o = json!({ "__err": code, "msg": msg, "ref": id });
    if let Some(origin) = tag(v, "origin") {
        o["origin"] = origin.clone();
    }
    o
}

/// `errorFromCore`: the message of the error sent under `reference` where it is still this code, else the core's.
fn from_core(code: &str, message: &str, reference: Option<u64>) -> String {
    reference
        .and_then(|r| SENT.with(|s| s.borrow().get((r as usize).wrapping_sub(1)).cloned()))
        .filter(|(c, _)| c == code)
        .map_or_else(|| message.to_string(), |(_, m)| m)
}

/// `JSON.parse(JSON.stringify(dec(v)))`: what a decoded fixture value is once JSON carries it. None is undefined.
fn js_json(v: &Json) -> Option<Json> {
    match v {
        Json::Array(items) => Some(Json::Array(items.iter().map(|x| js_json(x).unwrap_or(Json::Null)).collect())),
        Json::Object(o) if o.contains_key("__undef") => None,
        Json::Object(o) if o.contains_key("__nf") => Some(if o["__nf"] == "-0" { json!(0) } else { Json::Null }),
        Json::Object(o) if o.get("__err").is_some_and(Json::is_string) => Some(
            json!({ "__solError": true, "code": o["__err"], "message": o.get("msg").cloned().unwrap_or(json!("")) }),
        ),
        Json::Object(o) => Some(Json::Object(o.iter().filter_map(|(k, x)| Some((k.clone(), js_json(x)?))).collect())),
        _ => Some(v.clone()),
    }
}

/// `wire` (the function bodies' and Expression's arguments): lists recurse, the tagged cells stay tagged, an error
/// goes without a reference, and any other object as JSON carries it.
fn wire(v: &Json) -> Json {
    match v {
        Json::Array(items) => Json::Array(items.iter().map(wire).collect()),
        Json::Object(o) if o.contains_key("__undef") => json!({ "__undef": 1 }),
        Json::Object(o) if o.contains_key("__nf") => v.clone(),
        Json::Object(o) if o.get("__err").is_some_and(Json::is_string) => {
            json!({ "__err": o["__err"], "msg": o.get("msg").cloned().unwrap_or(json!("")) })
        }
        _ => js_json(v).unwrap_or(Json::Null),
    }
}

/// `wireCell` of a number field: a tagged one stays tagged.
fn wire_num(v: Option<&Json>) -> Json {
    match v {
        None => json!({ "__undef": 1 }),
        Some(x) => x.clone(),
    }
}

fn num_cell(x: f64) -> Json {
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

/// `coreValue(v, units)`; None where the value can't cross.
fn core_value(v: &Json, units: bool) -> Option<Json> {
    match v {
        Json::Array(items) => items.iter().map(|x| core_value(x, units)).collect::<Option<Vec<_>>>().map(Json::Array),
        Json::Object(o) if o.contains_key("__undef") => Some(json!({ "__undef": 1 })),
        Json::Object(o) if o.contains_key("__nf") => Some(v.clone()),
        Json::Object(o) if o.get("__err").is_some_and(Json::is_string) => Some(sent_error(v)),
        Json::Object(o) if flag(v, "__unitCell") => {
            if !units {
                return None;
            }
            // `dim` crosses as JSON.stringify writes it: a non-finite exponent as null.
            let dim: Map<String, Json> = o
                .get("dim")
                .and_then(Json::as_object)
                .map(|d| d.iter().map(|(k, x)| (k.clone(), js_json(x).unwrap_or(Json::Null))).collect())
                .unwrap_or_default();
            let mut u = json!({ "value": wire_num(o.get("value")), "dim": dim });
            if let Some(d) = o.get("display").filter(|d| !is_undef(d)) {
                u["display"] = d.clone();
            }
            if o.get("ratio").is_some_and(|r| r.as_bool() == Some(true)) {
                u["ratio"] = json!(true);
            }
            if let Some(id) = o.get("display").and_then(Json::as_str).filter(|d| !d.is_empty()) {
                let unit = solenoid_core::unit_catalog::fc_unit_to_unit(id);
                u["scale"] = unit.as_ref().map_or(Json::Null, |x| num_cell(x.scale));
                u["offset"] = unit.as_ref().and_then(|x| x.offset).map_or(Json::Null, num_cell);
                u["udim"] = unit.map_or(Json::Null, |x| {
                    Json::Object(x.dim.iter().map(|(k, e)| (k.clone(), num_cell(*e))).collect())
                });
            }
            Some(json!({ "__unit": u }))
        }
        Json::Object(o) if flag(v, "__cx") => Some(json!({ "__cx": [wire_num(o.get("re")), wire_num(o.get("im"))] })),
        Json::Object(_) => None,
        _ => Some(v.clone()),
    }
}

/// `coreValue` of a LAMBDA the fixture holds as `{params, expr, captured, capturedValues}`.
fn lambda_value(w: &Json) -> Option<Json> {
    let expr = w["expr"].as_str().filter(|e| !e.is_empty())?;
    let captured = w["captured"].as_array().cloned().unwrap_or_default();
    let undef = json!({ "__undef": 1 });
    let at = |i: usize| w["capturedValues"].get(i).unwrap_or(&undef).clone();
    let values = (0..captured.len()).map(|i| core_value(&at(i), true)).collect::<Option<Vec<_>>>()?;
    let read = (0..captured.len()).map(|i| core_value(&at(i), false)).collect::<Option<Vec<_>>>()?;
    Some(json!({ "__lambda": {
        "params": w["params"], "expr": expr, "captured": captured, "capturedValues": values, "readValues": read,
    } }))
}

/// A frame's cell as `encodeBinary` carries it: an error with its reference, any other object as its text.
fn frame_cell(v: &Json) -> Json {
    match v {
        Json::Object(o) if o.contains_key("__undef") => Json::Null,
        Json::Object(o) if o.contains_key("__nf") => v.clone(),
        Json::Object(o) if o.get("__err").is_some_and(Json::is_string) => sent_error(v),
        Json::Object(_) => json!("[object Object]"),
        Json::Array(_) => panic!("a list cell in a frame: {v}"),
        _ => v.clone(),
    }
}

/// A fixture frame onto the core's store, its units and formats with it where `meta`.
fn source(frame: &Json, meta: bool) -> Result<String, solenoid_core::error_value::SolError> {
    let columns: Vec<Json> = frame["columns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| {
            let mut w = json!({
                "name": c["name"], "type": c["type"],
                "values": c["values"].as_array().unwrap().iter().map(frame_cell).collect::<Vec<_>>(),
            });
            for key in ["unit", "format"] {
                if let Some(x) = c.get(key).filter(|_| meta).and_then(js_json) {
                    w[key] = x;
                }
            }
            w
        })
        .collect();
    invoke("engine_source", &json!({ "frame": { "columns": columns } })).map(|h| h.as_str().unwrap().to_string())
}

/// The cells of the core's frame `handle`, each as `decodeBinary` reads it back and `f` spells it.
fn collect(handle: &str, f: impl Fn(&FrameCell) -> Json) -> Vec<(Json, Json, Vec<Json>)> {
    let out = invoke("engine_collect", &json!({ "handle": handle })).unwrap();
    out.as_array()
        .unwrap()
        .iter()
        .map(|c| {
            (
                c["name"].clone(),
                c["type"].clone(),
                c["values"].as_array().unwrap().iter().map(|x| f(&decode_cell(x))).collect(),
            )
        })
        .collect()
}

fn error_message(e: &solenoid_core::error_value::SolError) -> String {
    let msg = if e.message.is_empty() { "from the engine" } else { e.message.as_str() };
    from_core(e.code.as_str(), msg, e.reference.map(u64::from))
}

/// `view`: a frame as the verbs and frame functions compare it.
fn view(handle: &str) -> Json {
    let cell = |c: &FrameCell| match c {
        FrameCell::Num(n) if n.is_nan() => json!("NaN"),
        FrameCell::Num(n) if n.is_infinite() => json!(if *n > 0.0 { "Infinity" } else { "-Infinity" }),
        FrameCell::Num(n) if *n == 0.0 && n.is_sign_negative() => json!("-0"),
        FrameCell::Num(n) => json!(n),
        FrameCell::Err(e) => json!({ "err": e.code.as_str(), "msg": error_message(e) }),
        FrameCell::Str(s) => json!(s.as_ref()),
        FrameCell::Bool(b) => json!(b),
        FrameCell::Null => Json::Null,
    };
    Json::Array(
        collect(handle, cell)
            .into_iter()
            .map(|(name, ty, values)| json!({ "name": name, "type": ty, "values": values }))
            .collect(),
    )
}

// ─── Replies as the JS reads them ─────────────────────────────────────────────────

fn from_bits(b: &Json) -> f64 {
    f64::from_bits(b.as_str().unwrap().parse::<u64>().unwrap())
}

fn is_nan_bits(b: &str) -> bool {
    from_bits(&json!(b)).is_nan()
}

fn reply_error(o: &Map<String, Json>) -> (String, String) {
    let code = o["err"].as_str().unwrap().to_string();
    let msg = from_core(&code, o.get("msg").and_then(Json::as_str).unwrap_or(""), o.get("ref").and_then(Json::as_u64));
    (code, msg)
}

/// `enc(unitData(readReply(r).value))`; None where `readReply` answers null (a throw, a value JS can't take back).
fn unit_reply(r: &Json) -> Option<Json> {
    if tag(r, "thrown").is_some() {
        return None;
    }
    from_reply(r)
}

fn from_reply(r: &Json) -> Option<Json> {
    let o = match r {
        Json::Null => return Some(Json::Null),
        Json::Number(_) => return Some(num_cell(r.as_f64().unwrap())),
        Json::Object(o) => o,
        _ => return None,
    };
    if let Some(b) = o.get("num") {
        return Some(num_cell(from_bits(b)));
    }
    if let Some(s) = o.get("str") {
        return Some(s.clone());
    }
    if let Some(b) = o.get("bool") {
        return Some(b.clone());
    }
    if o.contains_key("err") {
        let (code, msg) = reply_error(o);
        return Some(json!({ "__err": code, "msg": msg }));
    }
    if let Some(items) = o.get("list").and_then(Json::as_array) {
        return items.iter().map(from_reply).collect::<Option<Vec<_>>>().map(Json::Array);
    }
    if o.contains_key("undef") {
        return Some(json!({ "__undef": 1 }));
    }
    if o.contains_key("fx") {
        // An Error: `enc` lists no fields of it.
        return Some(json!({}));
    }
    if let Some(p) = o.get("cx").and_then(Json::as_array) {
        return Some(json!({ "__cx": true, "re": num_cell(from_bits(&p[0])), "im": num_cell(from_bits(&p[1])) }));
    }
    if let Some(u) = o.get("unit") {
        let dim: Vec<Json> =
            u["dim"].as_array().unwrap().iter().map(|p| json!([p[0], num_cell(from_bits(&p[1]))])).collect();
        return Some(
            json!({ "__u": num_cell(from_bits(&u["value"])), "dim": dim, "display": u["display"], "ratio": u["ratio"] }),
        );
    }
    None
}

/// `unitData` of a fixture value as the JS holds it: a unit cell spelled out, lists recursing.
fn unit_data(v: &Json) -> Json {
    match v {
        Json::Array(items) => Json::Array(items.iter().map(unit_data).collect()),
        Json::Object(o) if flag(v, "__unitCell") => {
            let mut dim: Vec<(&String, &Json)> =
                o.get("dim").and_then(Json::as_object).map(|d| d.iter().collect()).unwrap_or_default();
            dim.sort_by(|a, b| a.0.encode_utf16().cmp(b.0.encode_utf16()));
            json!({
                "__u": o["value"],
                "dim": dim.into_iter().map(|(k, x)| json!([k, x])).collect::<Vec<_>>(),
                "display": o.get("display").filter(|d| !is_undef(d)).cloned().unwrap_or(Json::Null),
                "ratio": o.get("ratio").cloned().unwrap_or(json!(false)),
            })
        }
        _ => v.clone(),
    }
}

/// `canon(readReply(r).value)`; None where `readReply` answers null.
fn canon_reply(r: &Json) -> Option<Json> {
    let o = match r {
        Json::Null => return Some(Json::Null),
        Json::Object(o) => o,
        _ => return None,
    };
    let num = |b: &Json| if is_nan_bits(b.as_str().unwrap()) { json!("NaN") } else { b.clone() };
    if let Some(b) = o.get("num") {
        return Some(json!({ "num": num(b) }));
    }
    if let Some(s) = o.get("str") {
        return Some(json!({ "str": s }));
    }
    if let Some(b) = o.get("bool") {
        return Some(json!({ "bool": b }));
    }
    if o.contains_key("err") {
        let (code, msg) = reply_error(o);
        return Some(json!({ "err": code, "msg": msg }));
    }
    if let Some(items) = o.get("list").and_then(Json::as_array) {
        return items.iter().map(canon_reply).collect::<Option<Vec<_>>>().map(|l| json!({ "list": l }));
    }
    if o.contains_key("undef") {
        return Some(json!({ "undef": true }));
    }
    if let Some(fx) = o.get("fx").and_then(Json::as_str) {
        // `canon` reads an Error's code out of its message: the first `#…` run of capitals, digits and `/?!.`.
        let code = fx.find('#').map_or("", |i| {
            let rest = &fx[i + 1..];
            let n = rest
                .find(|c: char| !(c.is_ascii_uppercase() || c.is_ascii_digit() || "/?!.".contains(c)))
                .unwrap_or(rest.len());
            if n == 0 {
                ""
            } else {
                &fx[i..i + 1 + n]
            }
        });
        return Some(json!({ "fx": code }));
    }
    if let Some(p) = o.get("cx").and_then(Json::as_array) {
        return Some(json!({ "cx": [num(&p[0]), num(&p[1])] }));
    }
    if o.contains_key("unit") {
        return Some(json!({ "other": "[object Object]" }));
    }
    None
}

/// `engineAnswer`: the core's reply as the function bodies and formulas compare it.
fn engine_answer(name: &str, r: &Json) -> Json {
    let Some(o) = r.as_object() else { return r.clone() };
    if o.contains_key("thrown") {
        return json!({ "err": "#VALUE!", "msg": format!("{name} can't compute with these arguments") });
    }
    if let Some(b) = o.get("num") {
        return json!({ "num": if is_nan_bits(b.as_str().unwrap()) { json!("NaN") } else { b.clone() } });
    }
    if let Some(items) = o.get("list").and_then(Json::as_array) {
        return json!({ "list": items.iter().map(|x| engine_answer(name, x)).collect::<Vec<_>>() });
    }
    if o.get("lambda").is_some_and(|l| l != &Json::Bool(false) && !l.is_null()) {
        return json!({ "lambda": true });
    }
    if let Some(p) = o.get("cx").and_then(Json::as_array) {
        let n = |b: &Json| if is_nan_bits(b.as_str().unwrap()) { json!("NaN") } else { b.clone() };
        return json!({ "cx": [n(&p[0]), n(&p[1])] });
    }
    if let Some(code) = o.get("err") {
        return json!({ "err": code, "msg": o.get("msg").cloned().unwrap_or(json!("")) });
    }
    r.clone()
}

// ─── The suites ───────────────────────────────────────────────────────────────────

#[test]
fn function_bodies() {
    check_or_freeze("function-bodies", |c| {
        let name = c["name"].as_str().unwrap();
        let args: Vec<Json> = c["args"].as_array().unwrap().iter().map(wire).collect();
        let r = invoke("engine_call", &json!({ "name": name, "args": args, "clock": clock() })).unwrap();
        engine_answer(name, &r)
    });
}

#[test]
fn computed_columns() {
    check_or_freeze("columns", |c| {
        let undef = |v: &Json| v.is_null() || is_undef(v);
        let bare = c.get("bare").filter(|b| !undef(b));
        let lambdas: Map<String, Json> = c
            .get("lambdas")
            .and_then(Json::as_object)
            .filter(|o| !o.contains_key("__undef"))
            .cloned()
            .unwrap_or_default();
        let reserved: Vec<String> = c
            .get("reserved")
            .and_then(Json::as_array)
            .map(|a| a.iter().map(|x| x.as_str().unwrap().to_string()).collect())
            .unwrap_or_default();
        let frame = &c["frame"];
        let cols = frame["columns"].as_array().unwrap();
        let rows = cols.iter().map(|col| col["values"].as_array().unwrap().len()).max().unwrap_or(0);
        let src = if bare.is_some() { "" } else { c["src"].as_str().unwrap() };
        let none = json!({ "none": true });

        // `columnInputs`: the names the formula reads, each that no column holds bound as `runColumn` would.
        let bodies: Vec<&str> =
            lambdas.values().chain(bare).filter_map(|l| l["expr"].as_str().filter(|e| !e.is_empty())).collect();
        let names = invoke("engine_formula_names", &json!({ "src": src, "bodies": bodies })).unwrap();
        if names["parses"] != json!(true) {
            return none;
        }
        let strs = |v: &Json| -> Vec<String> {
            v.as_array().map(|a| a.iter().map(|x| x.as_str().unwrap().to_string()).collect()).unwrap_or_default()
        };
        let col_names: Vec<String> = cols.iter().map(|col| col["name"].as_str().unwrap().to_string()).collect();
        let free = |p: &str| !col_names.iter().any(|n| n == p) && !reserved.iter().any(|n| n == p);
        let value = |p: &str| -> Option<Json> {
            if let Some(l) = lambdas.get(p) {
                return lambda_value(l);
            }
            match c["sides"].get(p) {
                Some(v) => core_value(v, false),
                None => core_value(&json!({ "__err": "#REF!", "msg": format!("No column \"{p}\"") }), false),
            }
        };
        let vars: Vec<String> = match bare {
            Some(b) => strs(&b["params"]),
            None => strs(&names["vars"]).into_iter().chain(lambdas.keys().cloned()).collect(),
        };
        let rows_read = strs(&names["rows"]);
        let (mut sides, mut row_sides) = (Map::new(), Map::new());
        for (list, out) in [(&vars, &mut sides), (&rows_read, &mut row_sides)] {
            for p in list {
                if !free(p) || out.contains_key(p) {
                    continue;
                }
                let Some(w) = value(p) else { return none };
                out.insert(p.clone(), w);
            }
        }
        let mut args = json!({
            "src": src, "sides": sides, "rowSides": row_sides, "reserved": reserved, "alias": {},
            "lambdas": lambdas.keys().collect::<Vec<_>>(), "clock": clock(), "rows": rows,
        });
        if let Some(b) = bare {
            let Some(w) = lambda_value(b) else { return none };
            args["bare"] = w["__lambda"].clone();
        }
        let mut named: Vec<String> = vars.iter().chain(&rows_read).cloned().collect();
        for l in lambdas.values().chain(bare) {
            named.extend(strs(&l["captured"]));
        }
        let read: Vec<Json> = cols.iter().filter(|col| named.iter().any(|n| col["name"] == **n)).cloned().collect();

        let handle = source(&json!({ "columns": read }), false).unwrap();
        args["handle"] = json!(handle);
        let r = invoke("engine_compute_column", &args).unwrap();
        let answer = if r.get("bail").is_some_and(|b| b == true) {
            none
        } else if let Some(e) = r.get("error") {
            json!({ "error": { "code": e["code"], "message": e["message"] } })
        } else {
            let cell = |x: &FrameCell| match x {
                FrameCell::Num(n) => num_cell(*n),
                FrameCell::Err(e) => json!({ "__err": e.code.as_str(), "msg": error_message(e) }),
                FrameCell::Str(s) => json!(s.as_ref()),
                FrameCell::Bool(b) => json!(b),
                FrameCell::Null => Json::Null,
            };
            let cells = collect(r["handle"].as_str().unwrap(), cell).swap_remove(0).2;
            json!({ "cells": cells, "sideVars": r["sideVars"] })
        };
        invoke("engine_clear", &json!({})).unwrap();
        answer
    });
}

/// `encodeOpCells`: a filter's value crosses as `encodeWireCell` writes it (-0 as JSON writes it), the rest as JSON.
fn op_wire(op: &Json) -> Json {
    let cell = |v: &Json| match v {
        Json::Object(o) if o.get("__nf").is_some_and(|n| n == "-0") => json!(0),
        Json::Object(o) if o.contains_key("__nf") => v.clone(),
        Json::Object(o) if o.get("__err").is_some_and(Json::is_string) => sent_error(v),
        _ => js_json(v).unwrap_or(Json::Null),
    };
    let mut w = js_json(op).unwrap();
    match op["kind"].as_str() {
        Some("filter") => match op.get("value") {
            Some(v) if !is_undef(v) => w["value"] = cell(v),
            _ => {}
        },
        Some("filterMulti") => {
            for (i, c) in op["conditions"].as_array().unwrap().iter().enumerate() {
                if let Some(v) = c.get("value").filter(|v| !is_undef(v)) {
                    w["conditions"][i]["value"] = cell(v);
                }
            }
        }
        _ => {}
    }
    w
}

#[test]
fn table_verbs() {
    check_or_freeze("verbs", |c| {
        let run = || -> Result<String, solenoid_core::error_value::SolError> {
            if c["kind"] == "unary" {
                let h = source(&c["frame"], true)?;
                let ops: Vec<Json> = c["ops"].as_array().unwrap().iter().map(op_wire).collect();
                Ok(invoke("engine_apply_many", &json!({ "handle": h, "ops": ops }))?.as_str().unwrap().to_string())
            } else {
                let (a, b) = (source(&c["l"], true)?, source(&c["r"], true)?);
                let out = match c["which"].as_u64().unwrap() {
                    0 => invoke("engine_join", &json!({ "left": a, "right": b, "opts": js_json(&c["opts"]) }))?,
                    1 => invoke("engine_append", &json!({ "handles": [a, b] }))?,
                    _ => invoke("engine_bind_columns", &json!({ "handles": [a, b] }))?,
                };
                Ok(out.as_str().unwrap().to_string())
            }
        };
        // A refusal throws as `toSolError` makes it: the core's code and message.
        let got = match run() {
            Ok(h) => json!({ "frame": view(&h) }),
            Err(e) => json!({ "error": { "code": e.code.as_str(), "message": e.message } }),
        };
        invoke("engine_clear", &json!({})).unwrap();
        got
    });
}

#[test]
fn frame_functions() {
    check_or_freeze("frame-fns", |c| {
        let none = json!({ "none": true });
        let Some(args) = c["args"].as_array().unwrap().iter().map(|a| core_value(a, false)).collect::<Option<Vec<_>>>()
        else {
            return none;
        };
        let handles = c["frames"].as_array().unwrap().iter().map(|f| source(f, false)).collect::<Result<Vec<_>, _>>();
        let got = match handles
            .and_then(|h| invoke("engine_frame_fn", &json!({ "name": c["name"], "handles": h, "args": args })))
        {
            Err(e) => json!({ "error": { "code": e.code.as_str(), "message": e.message } }),
            Ok(r) if r.get("bail").is_some_and(|b| b == true) => none,
            Ok(r) if r.get("error").is_some() => {
                let e = &r["error"];
                let code = e["code"].as_str().unwrap();
                json!({ "error": { "code": code, "message": from_core(code, e["message"].as_str().unwrap(), e.get("ref").and_then(Json::as_u64)) } })
            }
            Ok(r) => {
                let value = r.get("value").map(canon_reply);
                match (r.get("handle").and_then(Json::as_str), value) {
                    (_, Some(None)) => none,
                    (Some(h), Some(Some(v))) => json!({ "frame": view(h), "value": v }),
                    (Some(h), None) => json!({ "frame": view(h) }),
                    (None, Some(Some(v))) => json!({ "value": v }),
                    (None, None) => none,
                }
            }
        };
        invoke("engine_clear", &json!({})).unwrap();
        got
    });
}

fn eval_answer(c: &Json) -> Json {
    let env: Map<String, Json> = c["env"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), wire(v))).collect();
    engine_answer("", &invoke("engine_eval", &json!({ "src": c["src"], "env": env, "clock": clock() })).unwrap())
}

#[test]
fn formulas_over_values() {
    check_or_freeze("expressions", eval_answer);
}

#[test]
fn pack_functions() {
    check_or_freeze("pack-calls", eval_answer);
}

/// `parseFormula`: the core's tree, null for blank text or text that doesn't parse.
fn tree(src: &str) -> Json {
    if src.trim().is_empty() {
        return Json::Null;
    }
    invoke("engine_formula_parse", &json!({ "expr": src })).unwrap()
}

fn tree_fns(fns: &Json) -> Json {
    Json::Object(
        fns.as_object()
            .unwrap()
            .iter()
            .map(|(k, f)| (k.clone(), json!([f[0], tree(f[1].as_str().unwrap())])))
            .collect(),
    )
}

fn dim_answer(r: Json) -> Json {
    if r.get("dim").is_some() {
        json!({ "dim": r["dim"], "code": r["code"] })
    } else {
        r
    }
}

#[test]
fn formula_dimensions() {
    for suite in ["unit-dims", "unit-dims-fns"] {
        let cases = load(suite);
        let ask = |c: &Json, formula: Json, fns: Option<Json>| {
            let mut a = json!({ "env": c["env"], "codes": c["codes"] });
            a.as_object_mut().unwrap().extend(formula.as_object().unwrap().clone());
            if let Some(f) = fns {
                a["fns"] = f;
            }
            dim_answer(invoke("engine_dim_eval", &a).unwrap())
        };
        let fns = |c: &Json, as_tree: bool| c.get("fns").map(|f| if as_tree { tree_fns(f) } else { f.clone() });
        // As text, and as the tree a caller with no text (Equation's isolated side) sends.
        check(suite, &cases, |c| ask(c, json!({ "src": c["src"] }), fns(c, false)));
        check(suite, &cases, |c| ask(c, json!({ "ast": tree(c["src"].as_str().unwrap()) }), fns(c, true)));
    }
}

#[test]
fn affine_weights() {
    let cases = load("affine-weights");
    let ask = |c: &Json, formula: Json, fns: Json| {
        let mut a = json!({ "points": c["points"], "lists": c["lists"], "bare": c["bare"], "fns": fns });
        a.as_object_mut().unwrap().extend(formula.as_object().unwrap().clone());
        invoke("engine_affine_weight", &a).unwrap()
    };
    check("affine-weights", &cases, |c| ask(c, json!({ "src": c["src"] }), c["fns"].clone()));
    check("affine-weights", &cases, |c| {
        ask(c, json!({ "ast": tree(c["src"].as_str().unwrap()) }), tree_fns(&c["fns"]))
    });
}

#[test]
fn formula_trees() {
    check_or_freeze("formula-trees", |c| tree(c["src"].as_str().unwrap()));
}

#[test]
fn bodies_over_values_with_a_unit() {
    for suite in ["unit-lists", "unit-running", "unit-shapers", "unit-filters"] {
        check(suite, &load(suite), |c| {
            let Some(args) =
                c["args"].as_array().unwrap().iter().map(|a| core_value(a, true)).collect::<Option<Vec<_>>>()
            else {
                panic!("an argument that can't cross: {c}")
            };
            let r = invoke("engine_call", &json!({ "name": c["name"], "args": args, "clock": clock() })).unwrap();
            unit_reply(&r).unwrap_or(json!({ "unread": true }))
        });
    }
}

#[test]
fn expression_unit_wrapper() {
    check_or_freeze("expression-units", |c| {
        let o = c["env"].as_object().unwrap();
        let env: Map<String, Json> = o.iter().map(|(k, v)| (k.clone(), core_value(v, true).unwrap())).collect();
        let r = invoke(
            "engine_expression_units",
            &json!({ "src": c["src"], "env": env, "order": o.keys().collect::<Vec<_>>(), "clock": clock() }),
        )
        .unwrap();
        unit_reply(&r).unwrap_or(json!({ "unread": true }))
    });
}

/// `readNodeReply` then `enc(unitData(…))`: a card's answer, a list's bare cells as themselves.
fn node_value(r: &Json) -> Option<Json> {
    match r {
        Json::Number(n) => Some(num_cell(n.as_f64().unwrap())),
        Json::String(_) | Json::Bool(_) => Some(r.clone()),
        Json::Object(o) if o.get("list").is_some_and(Json::is_array) => {
            o["list"].as_array().unwrap().iter().map(node_value).collect::<Option<Vec<_>>>().map(Json::Array)
        }
        _ => unit_reply(r),
    }
}

/// `nodeWire` of a fixture value: lists cell by cell, the rest as `coreValue` sends it with its unit.
fn node_wire(v: &Json) -> Option<Json> {
    match v {
        Json::Array(items) => items.iter().map(node_wire).collect::<Option<Vec<_>>>().map(Json::Array),
        Json::Object(o) if o.contains_key("__frame") || o.contains_key("__cube") => panic!("a frame in a fold: {v}"),
        _ => core_value(v, true),
    }
}

#[test]
fn folds_over_values_with_a_unit() {
    let cases = load("fold-units");
    let has_initial = |c: &Json| c.get("initial").is_some_and(|i| !is_undef(i));
    // Through the cards' bodies, as `ReduceLambdaNode` and `ByAxisNode` send a call to `engine_node`.
    check("fold-units", &cases, |c| {
        let reduce = c["kind"] == "reduce";
        let mut inputs = vec![("table", c["m"].clone())];
        if has_initial(c) {
            inputs.push(("initial", c["initial"].clone()));
        }
        let label = if reduce { "REDUCE" } else { "ByAxisNode" };
        let mut wired = Vec::new();
        for (k, v) in &inputs {
            let Some(w) = node_wire(v) else {
                return json!({ "thrown": format!("{label}: an input holds a value the card can't read") });
            };
            wired.push(json!([k, [w]]));
        }
        let mut call = if reduce {
            json!({
                "kind": "ReduceLambdaNode", "init": { "label": "REDUCE", "resultAs": "number" }, "literals": {},
                "sockets": [["initial", "any", "Initial"], ["table", "anytable", "Values"], ["lambda", "lambda", "Lambda"]],
                "outputs": [["result", "number"]],
            })
        } else {
            let op = c["kind"].as_str().unwrap();
            json!({
                "kind": "ByAxisNode", "init": { "label": "", "op": op, "resultAs": "number" },
                "sockets": [["table", "anytable", "Table"], ["lambda", "lambda", "Lambda"]],
                "outputs": [["result", if op == "row" { "table" } else { "numlist" }]],
            })
        };
        call["stringLiterals"] = json!({ "formula": c["src"] });
        call["inputs"] = Json::Array(wired);
        call["clock"] = clock();
        let reply = serde_json::to_value(solenoid_core::nodes::reply(&call)).unwrap();
        let unreadable = || json!({ "thrown": "The card's answer can't be read back" });
        if let Some(t) = reply.get("thrown") {
            return match node_value(t) {
                Some(e) if tag(&e, "__err").is_some() => json!({ "thrown": e["msg"] }),
                Some(_) => panic!("a card threw a value that is no error: {t}"),
                None => unreadable(),
            };
        }
        match reply["out"].get("result") {
            None => json!({ "__undef": 1 }),
            Some(r) => match r.get("input").and_then(Json::as_array) {
                Some(from) => {
                    let (k, i) = (from[0].as_str().unwrap(), from[1].as_u64().unwrap());
                    assert_eq!(i, 0);
                    unit_data(&inputs.iter().find(|(key, _)| *key == k).unwrap().1)
                }
                None => node_value(r).unwrap_or_else(unreadable),
            },
        }
    });
    // The wrapper alone, where the nodes run it.
    let wrapped: Vec<Json> = cases.iter().filter(|c| c["wrapped"] == true).cloned().collect();
    check("fold-units", &wrapped, |c| {
        let m = &c["m"];
        // `toAnyMatrix`: a table socket's reading, a list one row and a scalar one cell.
        let matrix = if m.is_null() || is_undef(m) {
            Json::Null
        } else if !m.is_array() {
            json!([[m]])
        } else if m.as_array().unwrap().first().is_some_and(|x| !x.is_array()) {
            json!([m])
        } else {
            m.clone()
        };
        let mut a = json!({ "kind": c["kind"], "src": c["src"], "clock": clock() });
        if let Some(w) = core_value(&matrix, true) {
            a["m"] = w;
        }
        a["initial"] = if has_initial(c) { core_value(&c["initial"], true).unwrap_or(Json::Null) } else { json!(0) };
        unit_reply(&invoke("engine_fold_units", &a).unwrap()).unwrap_or(json!({ "unread": true }))
    });
}

#[test]
fn typed_date_text() {
    check_or_freeze("parse-date", |c| match invoke("engine_parse_date", &json!({ "text": c["text"] })).unwrap() {
        Json::Null => num_cell(f64::NAN),
        Json::Number(n) => num_cell(n.as_f64().unwrap()),
        r => json!({ "__err": "#AMBIGUOUS!", "msg": r["ambiguous"] }),
    });
}

#[test]
fn dimension_labels() {
    check_or_freeze("dim-labels", |c| {
        let dim: solenoid_core::unit_dims::Dim =
            serde_json::from_value(js_json(&c["dim"]).unwrap()).unwrap_or_default();
        json!(solenoid_core::unit_lists::format_dim(&dim))
    });
}
