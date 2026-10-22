//! [[B11]] maximalMerge, [[C96]] chartOptionsAreMatplotlib, [[C100]] chartIsAValue. `nodes/visual.ts`: the figure
//! cards, each answering its chart whole as `V::Json` (tagged as `nodeWire.ts` `jsonEnc` writes it), with the option
//! reader (`chartOptions.ts`), the XY reader (`xyPlot.ts`) and the frame-column readers they share.

use super::{err, list, Answer, Call, Column, Cube, Frame};
use crate::date_serial::{format_date_serial, DEFAULT_DATE_FORMAT};
use crate::excel_functions::{js_string_of, V};
use crate::jsnum::{js_lower, js_trim, string_to_number};
use serde_json::{json, Map, Value as Json};
use std::collections::HashMap;
use std::rc::Rc;

type Obj = Map<String, Json>;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "SparklineNode" => sparkline(c),
        "ChartNode" => chart(c),
        "MermaidNode" => mermaid(c),
        "GaugeNode" => gauge(c),
        "CandlestickNode" => candlestick(c),
        _ => return None,
    })
}

// ─── The wire's JSON ────────────────────────────────────────────────────────────

/// A number as `jsonEnc` writes it and a JSON reader takes it back: an integer as an integer, what JSON can't hold
/// tagged.
fn jn(n: f64) -> Json {
    if n.is_nan() {
        return json!({ "__nf": "nan" });
    }
    if n.is_infinite() {
        return json!({ "__nf": if n > 0.0 { "inf" } else { "-inf" } });
    }
    if n == 0.0 && n.is_sign_negative() {
        return json!({ "__nf": "-0" });
    }
    if n.fract() == 0.0 && n.abs() < 1e21 {
        if (0.0..18446744073709551616.0).contains(&n) {
            return Json::from(n as u64);
        }
        if (-9223372036854775808.0..0.0).contains(&n) {
            return Json::from(n as i64);
        }
    }
    Json::from(n)
}

fn jopt(n: Option<f64>) -> Json {
    n.map_or(Json::Null, jn)
}

fn undef() -> Json {
    json!({ "__undef": 1 })
}

/// `jsonEnc` of a value a figure carries as it came.
fn jv(v: &V) -> Json {
    match v {
        V::Undef => undef(),
        V::Null => Json::Null,
        V::Num(n) => jn(*n),
        V::Str(s) => Json::String(s.to_string()),
        V::Bool(b) => Json::Bool(*b),
        V::Err(e) => json!({ "__solError": true, "code": e.code, "message": e.message }),
        V::List(items) => Json::Array(items.iter().map(jv).collect()),
        V::Cx(re, im) => json!({ "__cx": true, "re": jn(*re), "im": jn(*im) }),
        V::Unit(u) => {
            let mut o = Obj::new();
            o.insert("__unitCell".into(), Json::Bool(true));
            o.insert("value".into(), jn(u.value));
            o.insert("dim".into(), Json::Object(u.dim.iter().map(|(k, x)| (k.clone(), jn(*x))).collect()));
            if let Some(d) = &u.display {
                o.insert("display".into(), Json::String(d.clone()));
            }
            if u.ratio {
                o.insert("ratio".into(), Json::Bool(true));
            }
            Json::Object(o)
        }
        V::Json(j) => (**j).clone(),
        _ => Json::Null,
    }
}

fn whole(j: Json) -> V {
    V::Json(Rc::new(j))
}

fn strs(items: &[String]) -> Json {
    Json::Array(items.iter().map(|s| Json::String(s.clone())).collect())
}

fn opt_nums(items: &[Option<f64>]) -> Json {
    Json::Array(items.iter().map(|n| jopt(*n)).collect())
}

/// What the error guard answers for a TypeError the TS body throws.
fn crashed(message: &str) -> V {
    err("#ERROR!", format!("This node failed to compute: {message}"))
}

// ─── Reading the card ───────────────────────────────────────────────────────────

/// `inputs[key]?.[0] ?? null`.
fn first(c: &Call, key: &str) -> V {
    match c.wired(key).and_then(|w| w.first()) {
        None | Some(V::Undef) => V::Null,
        Some(v) => v.clone(),
    }
}

/// `this.literals[key] ?? dflt`.
fn literal_or(c: &Call, key: &str, dflt: V) -> V {
    match c.literal(key) {
        V::Undef | V::Null => dflt,
        v => v,
    }
}

fn label(c: &Call) -> &str {
    c.field_str("label", "")
}

/// `opts.title || this.label || dflt`.
fn title(opts: &Obj, c: &Call, dflt: &str) -> String {
    match opts.get("title") {
        Some(Json::String(t)) if !t.is_empty() => t.clone(),
        _ if label(c).is_empty() => dflt.to_string(),
        _ => label(c).to_string(),
    }
}

/// JS truthiness of a wired value.
fn truthy(v: &V) -> bool {
    match v {
        V::Undef | V::Null => false,
        V::Num(n) => *n != 0.0 && !n.is_nan(),
        V::Str(s) => !s.is_empty(),
        V::Bool(b) => *b,
        _ => true,
    }
}

/// `parseChartOptions(readInput(inputs.options, this.stringLiterals.options ?? null))`: wired anything but text or a
/// blank, `input.split` throws.
fn read_options(c: &Call) -> Result<Obj, V> {
    let lit = match c.string_literal("options") {
        V::Undef => V::Null,
        v => v,
    };
    match c.read_input("options", lit) {
        V::Str(s) => Ok(parse_chart_options(&s)),
        v if !truthy(&v) => Ok(Obj::new()),
        _ => Err(crashed("input.split is not a function or its return value is not iterable")),
    }
}

// ─── chartOptions.ts ────────────────────────────────────────────────────────────

fn to_bool(v: &str) -> Option<bool> {
    match js_lower(js_trim(v)).as_ref() {
        "on" | "true" | "1" | "yes" | "y" => Some(true),
        "off" | "false" | "0" | "no" | "n" => Some(false),
        _ => None,
    }
}

fn to_num(v: &str) -> Option<f64> {
    let t = js_trim(v);
    if t.is_empty() {
        return None;
    }
    let n = string_to_number(t);
    n.is_finite().then_some(n)
}

fn to_pie_labels(v: &str) -> Option<&'static str> {
    let s = js_lower(js_trim(v));
    match s.as_ref() {
        "inside" | "center" | "on-chart" => Some("inside"),
        "outside" | "leader" => Some("outside"),
        _ => to_bool(&s).map(|b| if b { "outside" } else { "off" }),
    }
}

fn to_radar_scale(v: &str) -> Option<&'static str> {
    match js_lower(js_trim(v)).as_ref() {
        "axis" | "normalize" | "normalized" | "independent" => Some("axis"),
        "shared" | "raw" | "absolute" => Some("shared"),
        _ => None,
    }
}

fn to_line_style(v: &str) -> Option<&'static str> {
    match js_lower(js_trim(v)).as_ref() {
        "-" | "solid" => Some("solid"),
        "--" | "dashed" => Some("dashed"),
        ":" | "dotted" => Some("dotted"),
        "-." | "dashdot" => Some("dashdot"),
        "none" => Some("none"),
        _ => None,
    }
}

const CMAPS: [&str; 21] = [
    "viridis", "plasma", "inferno", "magma", "cividis", "turbo", "Blues", "Greens", "Reds", "Oranges", "Purples", "Greys",
    "YlOrRd", "YlGnBu", "coolwarm", "RdBu", "RdYlBu", "RdYlGn", "PiYG", "BrBG", "Spectral",
];

/// `normalizeCmap`: a map's own spelling, `_r` kept for a reversed one.
fn normalize_cmap(text: &str) -> Option<String> {
    let s = js_trim(text);
    let reversed = s.len() >= 2 && s.is_char_boundary(s.len() - 2) && s[s.len() - 2..].eq_ignore_ascii_case("_r");
    let stem = if reversed { &s[..s.len() - 2] } else { s };
    let lower = js_lower(stem);
    let base = CMAPS.iter().find(|m| js_lower(m) == lower)?;
    Some(if reversed { format!("{base}_r") } else { base.to_string() })
}

/// `isNumberSpec`: `^(\+)?(,)?(?:\.(\d{1,2}))?([fFeEgGd%])?$` on the trimmed text.
fn is_number_spec(spec: &str) -> bool {
    let s = js_trim(spec);
    if s.is_empty() {
        return false;
    }
    let mut rest = s.strip_prefix('+').unwrap_or(s);
    rest = rest.strip_prefix(',').unwrap_or(rest);
    if let Some(after) = rest.strip_prefix('.') {
        let digits = after.bytes().take_while(u8::is_ascii_digit).count();
        if !(1..=2).contains(&digits) {
            return false;
        }
        rest = &after[digits..];
    }
    rest.is_empty() || (rest.len() == 1 && "fFeEgGd%".contains(rest))
}

/// `parseChartOptions`: `key=value` pairs by matplotlib's names; an unknown key or an unreadable value is skipped.
pub(crate) fn parse_chart_options(input: &str) -> Obj {
    let mut o = Obj::new();
    let put_num = |o: &mut Obj, k: &str, n: Option<f64>| {
        if let Some(n) = n {
            o.insert(k.into(), jn(n));
        }
    };
    for part in input.split(';') {
        let Some(eq) = part.find('=') else { continue };
        let key = js_lower(js_trim(&part[..eq])).into_owned();
        let val = js_trim(&part[eq + 1..]);
        let text = |o: &mut Obj, k: &str| {
            if !val.is_empty() {
                o.insert(k.into(), Json::String(val.to_string()));
            }
        };
        let word = |o: &mut Obj, k: &str, w: Option<&str>| {
            if let Some(w) = w {
                o.insert(k.into(), Json::String(w.to_string()));
            }
        };
        let flag = |o: &mut Obj, k: &str| {
            if let Some(b) = to_bool(val) {
                o.insert(k.into(), Json::Bool(b));
            }
        };
        match key.as_str() {
            "title" | "xlabel" | "ylabel" | "color" | "x" | "s" | "c" | "annotate" | "by" => text(&mut o, &key),
            "grid" | "marker" | "annot" | "cbar" => flag(&mut o, &key),
            "pielabels" => word(&mut o, "pielabels", to_pie_labels(val)),
            "radarscale" => word(&mut o, "radarscale", to_radar_scale(val)),
            "linewidth" | "lw" => put_num(&mut o, "linewidth", to_num(val)),
            "markersize" | "ms" => put_num(&mut o, "markersize", to_num(val).filter(|n| *n > 0.0)),
            "alpha" => put_num(&mut o, "alpha", to_num(val)),
            "fontsize" => put_num(&mut o, "fontsize", to_num(val).filter(|n| *n > 0.0)),
            "ylim" | "xlim" => {
                let mut ends = val.split(',');
                let (lo, hi) = (ends.next().unwrap_or(""), ends.next().unwrap_or(""));
                let axis = &key[..1];
                put_num(&mut o, &format!("{axis}min"), to_num(lo));
                put_num(&mut o, &format!("{axis}max"), to_num(hi));
            }
            "ymin" | "ymax" | "xmin" | "xmax" | "vmin" | "vmax" | "center" => put_num(&mut o, &key, to_num(val)),
            "aspect" => {
                let s = js_lower(js_trim(val));
                word(&mut o, "aspect", match s.as_ref() {
                    "equal" => Some("equal"),
                    "auto" => Some("auto"),
                    _ => None,
                });
            }
            "maxgap" => put_num(&mut o, "maxgap", to_num(val).filter(|n| *n > 0.0)),
            "yscale" => word(&mut o, "yscale", match js_lower(val).as_ref() {
                "linear" => Some("linear"),
                "log" => Some("log"),
                _ => None,
            }),
            "linestyle" | "ls" => word(&mut o, "linestyle", to_line_style(val)),
            "y" => {
                let names: Vec<Json> = val.split(',').map(js_trim).filter(|t| !t.is_empty()).map(|t| Json::String(t.to_string())).collect();
                if !names.is_empty() {
                    o.insert("y".into(), Json::Array(names));
                }
            }
            "cmap" => {
                if let Some(m) = normalize_cmap(val) {
                    o.insert("cmap".into(), Json::String(m));
                }
            }
            "fmt" => {
                if is_number_spec(val) {
                    o.insert("fmt".into(), Json::String(val.to_string()));
                }
            }
            "origin" => word(&mut o, "origin", match js_lower(val).as_ref() {
                "upper" => Some("upper"),
                "lower" => Some("lower"),
                _ => None,
            }),
            _ => {}
        }
    }
    o
}

// ─── Frame columns ──────────────────────────────────────────────────────────────

/// `dateAnnotationPattern(format) || DEFAULT_DATE_FORMAT`.
fn date_pattern(format: Option<&Json>) -> String {
    let style = format.and_then(|f| f.get("format")).and_then(Json::as_str).unwrap_or("");
    if !(style.starts_with("date_") || style.starts_with("time_") || style == "datetime") {
        return DEFAULT_DATE_FORMAT.into();
    }
    let pattern = match style {
        "date_custom" => format.and_then(|f| f.get("customPattern")).and_then(Json::as_str).unwrap_or(""),
        "date_dmy" => "DD-MMM-YYYY",
        "date_iso" => "YYYY-MM-DD",
        "date_us" => "M/D/YYYY",
        "date_long" => "MMMM D, YYYY",
        "date_med" => "MMM D, YYYY",
        "date_dow" => "DDD, MMM D, YYYY",
        "time_24" => "HH:mm",
        "time_12" => "h:mm A",
        "datetime" => "YYYY-MM-DD HH:mm",
        _ => "",
    };
    if pattern.is_empty() { DEFAULT_DATE_FORMAT.into() } else { pattern.into() }
}

/// `formatFrameCell`: an error as its code, a logical as TRUE or FALSE, a date as its text, the rest as it is.
fn format_cell(ty: &str, v: &V, format: Option<&Json>) -> V {
    match v {
        V::Undef => V::Null,
        V::Err(e) => V::str(&e.code),
        V::Bool(b) => V::str(if *b { "TRUE" } else { "FALSE" }),
        V::Num(n) if ty == "date" && n.is_finite() => V::str(&format_date_serial(*n, &date_pattern(format))),
        other => other.clone(),
    }
}

/// `col.values[r] ?? null`.
fn cell(col: &Column, r: usize) -> V {
    match col.values.get(r) {
        None | Some(V::Undef) => V::Null,
        Some(v) => v.clone(),
    }
}

/// A shown cell as `String(...)` reads it, or `None` for a blank.
fn shown_text(col: &Column, r: usize, format: Option<&Json>) -> Option<String> {
    match format_cell(&col.ty, &cell(col, r), format) {
        V::Null => None,
        v => Some(js_string_of(&v)),
    }
}

fn finite(v: &V) -> Option<f64> {
    match v {
        V::Num(n) if n.is_finite() => Some(*n),
        _ => None,
    }
}

/// `colAsStrings`: each cell as shown, a blank as "".
fn col_strings(col: Option<&Column>) -> Vec<String> {
    col.map_or_else(Vec::new, |col| (0..col.values.len()).map(|r| shown_text(col, r, None).unwrap_or_default()).collect())
}

/// `colAsNumbers`: each cell as a number, read from its shown text where that is text.
fn col_numbers(col: Option<&Column>) -> Vec<Option<f64>> {
    let Some(col) = col else { return Vec::new() };
    col.values
        .iter()
        .map(|v| match format_cell(&col.ty, v, None) {
            V::Num(n) if n.is_finite() => Some(n),
            V::Str(s) if !js_trim(&s).is_empty() => Some(string_to_number(&s)).filter(|n| n.is_finite()),
            _ => None,
        })
        .collect()
}

/// `readFrameColumns`: a frame's columns, anything else none.
fn frame_columns(v: &V) -> &[Column] {
    match v {
        V::Frame(f) => &f.columns,
        _ => &[],
    }
}

/// `typedColumn`: the cells as one column of its known type, else the type every present cell shares.
fn typed_column(name: &str, cells: &[V], rows: usize, known: Option<&str>) -> Column {
    let present: Vec<&V> = cells.iter().filter(|c| !matches!(c, V::Null | V::Undef | V::Err(_))).collect();
    let ty = known.map(String::from).unwrap_or_else(|| {
        let all = |f: fn(&V) -> bool| !present.is_empty() && present.iter().all(|c| f(c));
        if all(|c| matches!(c, V::Num(_))) {
            "number".into()
        } else if all(|c| matches!(c, V::Bool(_))) {
            "logical".into()
        } else {
            "string".into()
        }
    });
    let values = (0..rows)
        .map(|i| match cells.get(i) {
            None | Some(V::Null | V::Undef) => V::Null,
            Some(e @ V::Err(_)) => e.clone(),
            Some(c) => match ty.as_str() {
                "string" => match c {
                    V::Str(_) => c.clone(),
                    _ => V::str(&js_string_of(c)),
                },
                "logical" => match c {
                    V::Bool(_) => c.clone(),
                    V::Num(n) => V::Bool(*n != 0.0),
                    V::Str(s) => V::Bool(js_lower(js_trim(s)) == "true"),
                    _ => V::Bool(false),
                },
                _ => match c {
                    V::Num(_) => c.clone(),
                    V::Bool(b) => V::Num(f64::from(u8::from(*b))),
                    V::Str(s) => V::Num(string_to_number(s)),
                    _ => V::Num(f64::NAN),
                },
            },
        })
        .collect();
    Column { name: name.to_string(), ty, values, unit: None, format: None, raw: None }
}

/// `flatCubeToFrame(cube, "scalar")`: the cube's flat columns as a frame, a value with a unit read as its number.
fn flat_cube(cube: &Cube) -> Frame {
    let nested = |cells: &[V]| cells.iter().any(|v| matches!(v, V::Cube(_) | V::Frame(_) | V::List(_)));
    let rows = cube.columns.iter().map(|c| c.cells.len()).max().unwrap_or(0);
    let columns = cube
        .columns
        .iter()
        .filter(|col| !nested(&col.cells))
        .map(|col| {
            let cells: Vec<V> = col.cells.iter().map(|v| if let V::Unit(u) = v { V::Num(u.value) } else { v.clone() }).collect();
            Column { format: col.format.clone(), ..typed_column(&col.name, &cells, rows, col.ty.as_deref()) }
        })
        .collect();
    Frame { columns, ..Frame::default() }
}

// ─── Sparkline ──────────────────────────────────────────────────────────────────

fn sparkline(c: &mut Call) -> Answer {
    let raw = first(c, "values");
    c.show("cachedResult", raw.clone());
    let op = match c.field_str("op", "line") {
        "bar" => "column",
        "area" => "line",
        o => o,
    }
    .to_string();
    let cells: Vec<Option<f64>> = match &raw {
        V::List(items) => items.iter().map(finite).collect(),
        V::Null => Vec::new(),
        v => vec![finite(v)],
    };
    let sign = |n: f64| if n > 0.0 { 1.0 } else if n < 0.0 { -1.0 } else { n };
    let signed: Vec<Option<f64>> = if op == "winloss" { cells.iter().map(|n| n.map(sign)).collect() } else { cells };
    let name = if label(c).is_empty() { "Sparkline".to_string() } else { label(c).to_string() };
    let chart = json!({
        "__chart": true,
        "op": if op == "winloss" { "column" } else { op.as_str() },
        "values": signed.iter().flatten().map(|n| jn(*n)).collect::<Vec<_>>(),
        "series": [{ "name": name, "values": opt_nums(&signed) }],
        "options": {},
        "title": name,
    });
    Ok(vec![("chart".into(), whole(chart))])
}

// ─── Chart ──────────────────────────────────────────────────────────────────────

/// `readChartRefs`: a References table's rows as reference marks, its columns found by name.
fn read_chart_refs(f: &V) -> Vec<Json> {
    let V::Frame(f) = f else { return Vec::new() };
    let col = |name: &str| f.columns.iter().find(|c| js_lower(js_trim(&c.name)) == name);
    let n = |v: &V| finite(v).map(jn);
    let t = |v: &V| match v {
        V::Str(s) if !js_trim(s).is_empty() => Some(Json::String(js_trim(s).to_string())),
        _ => None,
    };
    let nx = |v: &V| n(v).or_else(|| t(v));
    type Read<'a> = &'a dyn Fn(&V) -> Option<Json>;
    let fields: [(&str, Option<&Column>, Read); 6] =
        [("x", col("x"), &nx), ("x2", col("x2"), &nx), ("y", col("y"), &n), ("y2", col("y2"), &n), ("label", col("label"), &t), ("color", col("color"), &t)];
    let rows = f.columns.first().map_or(0, |c| c.values.len());
    let mut out = Vec::new();
    for r in 0..rows {
        let mut o = Obj::new();
        for (k, col, read) in &fields {
            if let Some(v) = col.and_then(|col| read(&cell(col, r))) {
                o.insert((*k).into(), v);
            }
        }
        if ["x", "x2", "y", "y2"].iter().any(|k| o.contains_key(*k)) {
            out.push(Json::Object(o));
        }
    }
    out
}

fn line_for(op: &str, opts: &Obj) -> Json {
    opts.get("linestyle").cloned().unwrap_or_else(|| Json::from(if op == "xyline" { "solid" } else { "none" }))
}

fn marker_for(op: &str, opts: &Obj, series: usize) -> bool {
    op != "xyline" || opts.get("marker").and_then(Json::as_bool).unwrap_or(series == 1)
}

/// `listXY`: a list plots at x = 1, 2, 3, …; a number is one point at x = 1.
fn list_xy(op: &str, raw: &V, opts: &Obj) -> Option<Obj> {
    let ys: Vec<V> = match raw {
        V::List(items) => items.to_vec(),
        V::Num(_) => vec![raw.clone()],
        _ => return None,
    };
    let points: Vec<Json> = ys.iter().enumerate().map(|(i, v)| finite(v).map_or(Json::Null, |y| json!({ "x": jn((i + 1) as f64), "y": jn(y) }))).collect();
    let series = json!([{ "name": "", "points": points, "line": line_for(op, opts), "marker": marker_for(op, opts, 1) }]);
    Some(json!({ "kind": "xy", "names": {}, "series": series }).as_object().cloned().unwrap_or_default())
}

/// `buildXY`: a frame, a list or a number as XY series, the columns picked by the options' names. A named column the
/// frame lacks is `#REF!`, a text column in a number role `#TYPE!`; `None` is nothing to plot.
fn build_xy(op: &str, raw: &V, opts: &Obj) -> Result<Option<Obj>, V> {
    let V::Frame(f) = raw else { return Ok(list_xy(op, raw, opts)) };
    let cols = &f.columns;
    if cols.is_empty() {
        return Ok(None);
    }
    let find = |name: &str, role: &str| -> Result<usize, V> {
        let key = js_lower(js_trim(name)).into_owned();
        cols.iter()
            .position(|c| js_lower(js_trim(&c.name)) == key)
            .ok_or_else(|| err("#REF!", format!("The options name a {role} column \"{name}\", which the data doesn't have")))
    };
    let named = |k: &str, role: &str| opts.get(k).and_then(Json::as_str).map(|n| find(n, role)).transpose();
    let x_named = named("x", "x");
    let s_named = named("s", "size");
    let c_named = named("c", "color");
    let t_named = named("annotate", "annotate");
    let by_named = named("by", "by");
    let y_named: Option<Result<Vec<usize>, V>> =
        opts.get("y").and_then(Json::as_array).map(|names| names.iter().filter_map(Json::as_str).map(|n| find(n, "y")).collect());
    let (xn, sn, cn, tn, byn) = (x_named?, s_named?, c_named?, t_named?, by_named?);
    let yn = y_named.transpose()?;
    let mut taken: Vec<usize> = [xn, sn, cn, tn, byn].into_iter().flatten().chain(yn.iter().flatten().copied()).collect();
    let mut pool: Vec<usize> = (0..cols.len()).filter(|i| cols[*i].ty == "number" && !taken.contains(i)).collect();
    let take = |pool: &mut Vec<usize>, taken: &mut Vec<usize>| {
        if pool.is_empty() {
            return None;
        }
        let c = pool.remove(0);
        taken.push(c);
        Some(c)
    };
    let bubble = op == "bubble";
    let mut x_col = xn;
    if x_col.is_none() {
        if bubble {
            x_col = take(&mut pool, &mut taken);
        } else if cols.len() >= 2 {
            x_col = (0..cols.len()).find(|i| !taken.contains(i));
            if let Some(x) = x_col {
                taken.push(x);
                pool.retain(|p| *p != x);
            }
        }
    }
    let mut y_cols: Vec<usize> = yn.clone().unwrap_or_default();
    if yn.is_none() {
        y_cols = if bubble { take(&mut pool, &mut taken).into_iter().collect() } else { std::mem::take(&mut pool) };
    }
    let mut s_col = sn;
    if s_col.is_none() && bubble {
        s_col = take(&mut pool, &mut taken);
    }
    if bubble && yn.is_none() && y_cols.is_empty() {
        if let Some(x) = x_col {
            y_cols = vec![x];
        }
    }
    for (i, role) in y_cols.iter().map(|i| (*i, "y")).chain(s_col.map(|i| (i, "size"))) {
        if cols[i].ty != "number" {
            return Err(err("#TYPE!", format!("Column \"{}\" is the {role} column but holds {}, not numbers", cols[i].name, cols[i].ty)));
        }
    }
    if y_cols.is_empty() {
        return Ok(None);
    }
    let rows = cols.iter().map(|c| c.values.len()).max().unwrap_or(0);
    let text = |i: usize, r: usize| shown_text(&cols[i], r, cols[i].format.as_ref());
    let mut xcats: Option<Vec<String>> = None;
    let x_at: Vec<Option<f64>> = match x_col {
        None => (0..rows).map(|r| Some((r + 1) as f64)).collect(),
        Some(x) if cols[x].ty == "number" || cols[x].ty == "date" => (0..rows).map(|r| finite(&cell(&cols[x], r))).collect(),
        Some(x) => {
            let (mut cats, mut idx) = (Vec::new(), HashMap::new());
            let out = (0..rows)
                .map(|r| {
                    let t = text(x, r)?;
                    Some(*idx.entry(t.clone()).or_insert_with(|| {
                        cats.push(t);
                        cats.len() - 1
                    }) as f64)
                })
                .collect();
            xcats = Some(cats);
            out
        }
    };
    let c_at = |r: usize| -> Option<Json> {
        let ci = cn?;
        if cols[ci].ty == "number" { finite(&cell(&cols[ci], r)).map(jn) } else { text(ci, r).map(Json::String) }
    };
    let mut groups: Vec<(Option<String>, Vec<usize>)> = Vec::new();
    match byn {
        Some(b) => {
            let mut at: HashMap<String, usize> = HashMap::new();
            for r in 0..rows {
                let k = text(b, r).unwrap_or_else(|| "—".into());
                let g = *at.entry(k.clone()).or_insert_with(|| {
                    groups.push((Some(k), Vec::new()));
                    groups.len() - 1
                });
                groups[g].1.push(r);
            }
        }
        None => groups.push((None, (0..rows).collect())),
    }
    let (mut s_vals, mut c_nums, mut c_cats) = (Vec::new(), Vec::new(), Vec::<String>::new());
    let mut series: Vec<Obj> = Vec::new();
    for &y in &y_cols {
        for (key, rs) in &groups {
            let points: Vec<Json> = rs
                .iter()
                .map(|&r| {
                    let (Some(xv), Some(yv)) = (x_at[r], finite(&cell(&cols[y], r))) else { return Json::Null };
                    let mut p = Obj::new();
                    p.insert("x".into(), jn(xv));
                    p.insert("y".into(), jn(yv));
                    if let Some(sv) = s_col.and_then(|s| finite(&cell(&cols[s], r))) {
                        s_vals.push(sv);
                        p.insert("s".into(), jn(sv));
                    }
                    if let Some(cv) = c_at(r) {
                        match &cv {
                            Json::String(s) if !c_cats.contains(s) => c_cats.push(s.clone()),
                            Json::String(_) => {}
                            n => c_nums.push(json_num(n)),
                        }
                        p.insert("c".into(), cv);
                    }
                    if let Some(tv) = tn.and_then(|t| text(t, r)).filter(|t| !t.is_empty()) {
                        p.insert("text".into(), Json::String(tv));
                    }
                    Json::Object(p)
                })
                .collect();
            let name = match key {
                None => cols[y].name.clone(),
                Some(k) if y_cols.len() > 1 => format!("{} · {k}", cols[y].name),
                Some(k) => k.clone(),
            };
            let mut s = Obj::new();
            s.insert("name".into(), Json::String(name));
            s.insert("points".into(), Json::Array(points));
            s.insert("line".into(), line_for(op, opts));
            series.push(s);
        }
    }
    let range = |vals: &[f64]| {
        let (lo, hi) = vals.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), v| (if *v < lo { *v } else { lo }, if *v > hi { *v } else { hi }));
        (lo <= hi).then(|| json!([jn(lo), jn(hi)]))
    };
    let (s_range, c_range) = (range(&s_vals), range(&c_nums));
    let marker = marker_for(op, opts, series.len());
    let series: Vec<Json> = series
        .into_iter()
        .map(|mut s| {
            s.insert("marker".into(), Json::Bool(marker));
            if let Some(r) = &s_range {
                s.insert("sRange".into(), r.clone());
            }
            if let Some(r) = &c_range {
                s.insert("cRange".into(), r.clone());
            }
            if !c_cats.is_empty() {
                s.insert("cCats".into(), strs(&c_cats));
            }
            Json::Object(s)
        })
        .collect();
    let mut names = Obj::new();
    let mut name = |k: &str, col: Option<usize>| {
        if let Some(i) = col {
            names.insert(k.into(), Json::String(cols[i].name.clone()));
        }
    };
    name("x", x_col);
    name("y", (y_cols.len() == 1).then(|| y_cols[0]));
    name("s", s_col);
    name("c", cn);
    name("text", tn);
    let mut p = Obj::new();
    p.insert("kind".into(), json!("xy"));
    p.insert("series".into(), Json::Array(series));
    if let Some(cats) = xcats {
        p.insert("xcats".into(), strs(&cats));
    }
    if x_col.is_some_and(|x| cols[x].ty == "date") {
        p.insert("xDate".into(), Json::Bool(true));
    }
    p.insert("names".into(), Json::Object(names));
    Ok(Some(p))
}

/// A number the wire carries, its tags read back.
fn json_num(j: &Json) -> f64 {
    match j {
        Json::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Json::Object(o) => match o.get("__nf").and_then(Json::as_str) {
            Some("inf") => f64::INFINITY,
            Some("-inf") => f64::NEG_INFINITY,
            Some("-0") => -0.0,
            _ => f64::NAN,
        },
        _ => f64::NAN,
    }
}

const XY_OPS: [&str; 3] = ["scatter", "xyline", "bubble"];

fn chart(c: &mut Call) -> Answer {
    let op = c.field_str("op", "column").to_string();
    let raw = match first(c, "values") {
        V::Cube(cube) => V::Frame(Rc::new(flat_cube(&cube))),
        V::Err(_) => V::Null,
        v => v,
    };
    let refs = read_chart_refs(&first(c, "references"));
    let lit = match c.string_literal("options") {
        V::Undef => V::Null,
        v => v,
    };
    let opt_str = match c.read_input("options", lit.clone()) {
        V::Str(s) => Some(s),
        V::Null => None,
        _ => match lit {
            V::Str(s) => Some(s),
            _ => None,
        },
    };
    let mut opts = opt_str.map(|s| parse_chart_options(&s)).unwrap_or_default();
    let (mut labels, mut series, mut payload): (Option<Vec<V>>, Option<Json>, Option<Obj>) = (None, None, None);
    let num_col = |col: &Column| -> Vec<V> { col.values.iter().map(|v| finite(v).map_or(V::Null, V::Num)).collect() };
    let refs_shown = if refs.is_empty() { V::Null } else { whole(Json::Array(refs.clone())) };
    let mut v = V::Null;
    if XY_OPS.contains(&op.as_str()) {
        let xy = match build_xy(&op, &raw, &opts) {
            Ok(xy) => xy,
            Err(e) => {
                for f in ["cachedLabels", "cachedSeries", "cachedPayload", "cachedResult"] {
                    c.show(f, V::Null);
                }
                c.show("cachedError", e.clone());
                c.show("cachedRefs", refs_shown);
                c.show("chartOptions", whole(Json::Object(opts)));
                return Ok(vec![("chart".into(), e)]);
            }
        };
        if let Some(xy) = &xy {
            let Some(s0) = xy["series"].as_array().and_then(|s| s.first()) else {
                return Err(crashed("Cannot read properties of undefined (reading 'points')"));
            };
            let ys = s0["points"].as_array().map(|ps| ps.iter().map(|p| p.get("y").map_or(V::Null, |y| V::Num(json_num(y)))).collect()).unwrap_or_default();
            v = list(ys);
            let explicit = op == "bubble" || opts.contains_key("x");
            let axis_name = |k: &str| xy["names"].get(k).and_then(Json::as_str).filter(|n| !n.is_empty()).map(|n| Json::String(n.into()));
            if explicit && !opts.contains_key("xlabel") {
                if let Some(n) = axis_name("x") {
                    opts.insert("xlabel".into(), n);
                }
            }
            if (explicit || opts.contains_key("y")) && !opts.contains_key("ylabel") {
                if let Some(n) = axis_name("y") {
                    opts.insert("ylabel".into(), n);
                }
            }
        }
        payload = xy;
    } else if matches!(&raw, V::Frame(f) if !f.columns.is_empty()) {
        let V::Frame(f) = &raw else { unreachable!() };
        let cols = &f.columns;
        let many = |s: &Vec<(String, Vec<V>)>| {
            (s.len() >= 2).then(|| Json::Array(s.iter().map(|(n, vs)| json!({ "name": n, "values": vs.iter().map(jv).collect::<Vec<_>>() })).collect()))
        };
        if op == "radar" && cols.len() >= 2 {
            let label_col = &cols[0];
            let num_cols: Vec<&Column> = cols[1..].iter().filter(|c| c.ty == "number").collect();
            labels = Some(num_cols.iter().map(|c| V::str(&c.name)).collect());
            let rows: Vec<(String, Vec<V>)> = (0..label_col.values.len())
                .map(|r| {
                    let name = shown_text(label_col, r, None).unwrap_or_else(|| format!("Row {}", r + 1));
                    (name, num_cols.iter().map(|c| finite(&cell(c, r)).map_or(V::Null, V::Num)).collect())
                })
                .collect();
            v = rows.first().map_or(V::Null, |(_, vs)| list(vs.clone()));
            series = many(&rows);
        } else if cols.len() >= 2 {
            labels = Some((0..cols[0].values.len()).map(|r| match format_cell(&cols[0].ty, &cell(&cols[0], r), None) {
                V::Null => V::str(""),
                x => x,
            }).collect());
            let rows: Vec<(String, Vec<V>)> = cols[1..].iter().filter(|c| c.ty == "number").map(|c| (c.name.clone(), num_col(c))).collect();
            v = rows.first().map_or(V::Null, |(_, vs)| list(vs.clone()));
            series = many(&rows);
        } else {
            v = list(num_col(&cols[0]));
        }
    } else if let V::List(items) = &raw {
        v = list(items.iter().map(|x| finite(x).map_or(V::Null, V::Num)).collect());
    } else if let V::Num(_) = raw {
        v = finite(&raw).map_or(V::Null, V::Num);
    }
    let options = Json::Object(opts.clone());
    let payload_j = payload.map(Json::Object);
    let labels_v = labels.map(list);
    let mut chart = Obj::new();
    chart.insert("__chart".into(), Json::Bool(true));
    chart.insert("op".into(), Json::String(op));
    chart.insert("values".into(), jv(&v));
    chart.insert("series".into(), series.clone().unwrap_or_else(undef));
    chart.insert("labels".into(), labels_v.as_ref().map_or_else(undef, jv));
    chart.insert("payload".into(), payload_j.clone().unwrap_or_else(undef));
    chart.insert("options".into(), options.clone());
    chart.insert("title".into(), Json::String(title(&opts, c, "Chart")));
    if !refs.is_empty() {
        chart.insert("refs".into(), Json::Array(refs));
    }
    c.show("cachedLabels", labels_v.unwrap_or(V::Null));
    c.show("cachedSeries", series.map_or(V::Null, whole));
    c.show("cachedPayload", payload_j.map_or(V::Null, whole));
    c.show("cachedError", V::Null);
    c.show("cachedRefs", refs_shown);
    c.show("chartOptions", whole(options));
    c.show("cachedResult", v);
    Ok(vec![("chart".into(), whole(Json::Object(chart)))])
}

// ─── Mermaid ────────────────────────────────────────────────────────────────────

fn mermaid(c: &mut Call) -> Answer {
    let lit = match c.string_literal("source") {
        V::Undef | V::Null => V::str(""),
        v => v,
    };
    let src = match c.read_input("source", lit) {
        V::Null => V::str(""),
        v => v,
    };
    c.show("cachedSource", src.clone());
    let name = if label(c).is_empty() { "Diagram" } else { label(c) };
    let diagram = json!({ "__mermaid": true, "source": jv(&src), "title": name });
    Ok(vec![("diagram".into(), whole(diagram))])
}

// ─── Gauge ──────────────────────────────────────────────────────────────────────

fn gauge(c: &mut Call) -> Answer {
    let value = c.read_input("value", literal_or(c, "value", V::Null));
    let (payload, opts, title) = if c.field_str("mode", "dial") == "bar" {
        let target = c.read_input("target", literal_or(c, "target", V::Null));
        let max = match c.read_input("max", literal_or(c, "max", V::Num(100.0))) {
            V::Null => literal_or(c, "max", V::Num(100.0)),
            m => m,
        };
        let opts = read_options(c)?;
        let payload = json!({ "kind": "scale", "style": "bar", "value": jv(&value), "target": jv(&target), "min": 0, "max": jv(&max) });
        let t = title(&opts, c, "Gauge");
        (payload, opts, t)
    } else {
        let payload = json!({ "kind": "scale", "style": "dial", "value": jv(&value), "target": null, "min": 0, "max": 1 });
        (payload, Obj::new(), title(&Obj::new(), c, "Gauge"))
    };
    c.show("chartOptions", whole(Json::Object(opts.clone())));
    c.show("cachedPayload", whole(payload.clone()));
    let chart = json!({ "__chart": true, "op": "scale", "values": jv(&value), "payload": payload, "options": opts, "title": title });
    Ok(vec![("chart".into(), whole(chart))])
}

// ─── Candlestick ────────────────────────────────────────────────────────────────

fn candlestick(c: &mut Call) -> Answer {
    let frame = first(c, "frame");
    let cols = frame_columns(&frame);
    if cols.is_empty() {
        c.show("cachedChart", V::Null);
        return Ok(vec![("chart".into(), V::Null)]);
    }
    if cols.len() < 4 {
        let e = err("#SHAPE!", "Candlestick needs Open, High, Low and Close columns (a date column first is optional)");
        c.show("cachedChart", e.clone());
        return Ok(vec![("chart".into(), e)]);
    }
    let at = usize::from(cols.len() >= 5);
    let open = col_numbers(cols.get(at));
    let labels = if at == 1 { col_strings(cols.first()) } else { (1..=open.len()).map(|i| i.to_string()).collect() };
    let close = col_numbers(cols.get(at + 3));
    let payload = json!({
        "kind": "candle",
        "labels": strs(&labels),
        "open": opt_nums(&open),
        "high": opt_nums(&col_numbers(cols.get(at + 1))),
        "low": opt_nums(&col_numbers(cols.get(at + 2))),
        "close": opt_nums(&close),
    });
    let opts = read_options(c)?;
    let chart = json!({
        "__chart": true, "op": "candle", "values": close.iter().flatten().map(|n| jn(*n)).collect::<Vec<_>>(), "payload": payload,
        "options": opts, "title": title(&opts, c, "Candlestick"),
    });
    c.show("chartOptions", whole(Json::Object(opts)));
    c.show("cachedChart", whole(chart.clone()));
    Ok(vec![("chart".into(), whole(chart))])
}
