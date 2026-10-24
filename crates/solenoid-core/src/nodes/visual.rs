//! [[B11]] maximalMerge, [[C96]] chartOptionsAreMatplotlib, [[C100]] chartIsAValue. The figure
//! cards, each answering its chart whole as `V::Json` (tagged as `nodeWire.ts` `jsonEnc` writes it), with the option
//! reader, the XY reader and the frame-column readers they share.

use super::scalar::{read_role, Role};
use super::{err, list, Answer, Call, Column, Cube, Frame};
use crate::date_serial::{format_date_serial, DEFAULT_DATE_FORMAT};
use crate::error_value::ErrorCode;
use crate::excel_functions::{js_string_of, V};
use crate::frame::FrameColType;
use crate::jsnum::{js_lower, js_trim, math_round, number_to_string, string_to_number};
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
        "MergePlotsNode" => merge_plots(c),
        "HistogramNode" => histogram(c),
        "KpiNode" => kpi(c),
        "ProportionNode" => proportion(c),
        "SankeyNode" => sankey(c),
        "HeatmapNode" => heatmap(c),
        "SurfaceNode" => surface(c),
        "WaterfallNode" => waterfall(c),
        "BoxplotNode" => boxplot(c),
        "CalendarHeatmapNode" => calendar_heatmap(c),
        "QuiverNode" => quiver(c),
        "ChartBuilderNode" => chart_builder(c),
        _ => return None,
    })
}

// ─── The wire's JSON ────────────────────────────────────────────────────────────

/// A number as `jsonEnc` writes it and a JSON reader takes it back: an integer as an integer, what JSON can't hold
/// tagged.
pub(crate) fn jn(n: f64) -> Json {
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

pub(crate) fn jopt(n: Option<f64>) -> Json {
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

/// What the error guard answers for a TypeError a body throws.
fn crashed(message: &str) -> V {
    err(ErrorCode::Error, format!("This node failed to compute: {message}"))
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

/// The options input, parsed: wired, anything but text or a blank is the crash `input.split` throws.
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

// ─── Chart options ──────────────────────────────────────────────────────────────

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
    "viridis", "plasma", "inferno", "magma", "cividis", "turbo", "Blues", "Greens", "Reds", "Oranges", "Purples",
    "Greys", "YlOrRd", "YlGnBu", "coolwarm", "RdBu", "RdYlBu", "RdYlGn", "PiYG", "BrBG", "Spectral",
];

/// A map's own spelling, `_r` kept for a reversed one.
fn normalize_cmap(text: &str) -> Option<String> {
    let s = js_trim(text);
    let reversed = s.len() >= 2 && s.is_char_boundary(s.len() - 2) && s[s.len() - 2..].eq_ignore_ascii_case("_r");
    let stem = if reversed { &s[..s.len() - 2] } else { s };
    let lower = js_lower(stem);
    let base = CMAPS.iter().find(|m| js_lower(m) == lower)?;
    Some(if reversed { format!("{base}_r") } else { base.to_string() })
}

/// `^(\+)?(,)?(?:\.(\d{1,2}))?([fFeEgGd%])?$` on the trimmed text.
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

/// `key=value` pairs by matplotlib's names; an unknown key or an unreadable value is skipped.
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
                word(
                    &mut o,
                    "aspect",
                    match s.as_ref() {
                        "equal" => Some("equal"),
                        "auto" => Some("auto"),
                        _ => None,
                    },
                );
            }
            "maxgap" => put_num(&mut o, "maxgap", to_num(val).filter(|n| *n > 0.0)),
            "yscale" => word(
                &mut o,
                "yscale",
                match js_lower(val).as_ref() {
                    "linear" => Some("linear"),
                    "log" => Some("log"),
                    _ => None,
                },
            ),
            "linestyle" | "ls" => word(&mut o, "linestyle", to_line_style(val)),
            "y" => {
                let names: Vec<Json> = val
                    .split(',')
                    .map(js_trim)
                    .filter(|t| !t.is_empty())
                    .map(|t| Json::String(t.to_string()))
                    .collect();
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
            "origin" => word(
                &mut o,
                "origin",
                match js_lower(val).as_ref() {
                    "upper" => Some("upper"),
                    "lower" => Some("lower"),
                    _ => None,
                },
            ),
            _ => {}
        }
    }
    o
}

// ─── Frame columns ──────────────────────────────────────────────────────────────

/// The format's date pattern, else `DEFAULT_DATE_FORMAT`.
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
    if pattern.is_empty() {
        DEFAULT_DATE_FORMAT.into()
    } else {
        pattern.into()
    }
}

/// An error as its code, a logical as TRUE or FALSE, a date as its text, the rest as it is.
fn format_cell(ty: FrameColType, v: &V, format: Option<&Json>) -> V {
    match v {
        V::Undef => V::Null,
        V::Err(e) => V::str(e.code.as_str()),
        V::Bool(b) => V::str(if *b { "TRUE" } else { "FALSE" }),
        V::Num(n) if ty == FrameColType::Date && n.is_finite() => {
            V::str(&format_date_serial(*n, &date_pattern(format)))
        }
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
    match format_cell(col.ty, &cell(col, r), format) {
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

/// Each cell as shown, a blank as "".
fn col_strings(col: Option<&Column>) -> Vec<String> {
    col.map_or_else(Vec::new, |col| {
        (0..col.values.len()).map(|r| shown_text(col, r, None).unwrap_or_default()).collect()
    })
}

/// Each cell as a number, read from its shown text where that is text.
fn col_numbers(col: Option<&Column>) -> Vec<Option<f64>> {
    let Some(col) = col else { return Vec::new() };
    col.values
        .iter()
        .map(|v| match format_cell(col.ty, v, None) {
            V::Num(n) if n.is_finite() => Some(n),
            V::Str(s) if !js_trim(&s).is_empty() => Some(string_to_number(&s)).filter(|n| n.is_finite()),
            _ => None,
        })
        .collect()
}

/// A frame's columns, anything else none.
fn frame_columns(v: &V) -> &[Column] {
    match v {
        V::Frame(f) => &f.columns,
        _ => &[],
    }
}

/// The cells as one column of its known type, else the type every present cell shares.
fn typed_column(name: &str, cells: &[V], rows: usize, known: Option<FrameColType>) -> Column {
    let present: Vec<&V> = cells.iter().filter(|c| !matches!(c, V::Null | V::Undef | V::Err(_))).collect();
    let ty = known.unwrap_or_else(|| {
        let all = |f: fn(&V) -> bool| !present.is_empty() && present.iter().all(|c| f(c));
        if all(|c| matches!(c, V::Num(_))) {
            FrameColType::Number
        } else if all(|c| matches!(c, V::Bool(_))) {
            FrameColType::Logical
        } else {
            FrameColType::String
        }
    });
    let values = (0..rows)
        .map(|i| match cells.get(i) {
            None | Some(V::Null | V::Undef) => V::Null,
            Some(e @ V::Err(_)) => e.clone(),
            Some(c) => match ty {
                FrameColType::String => match c {
                    V::Str(_) => c.clone(),
                    _ => V::str(&js_string_of(c)),
                },
                FrameColType::Logical => match c {
                    V::Bool(_) => c.clone(),
                    V::Num(n) => V::Bool(*n != 0.0),
                    V::Str(s) => V::Bool(js_lower(js_trim(s)) == "true"),
                    _ => V::Bool(false),
                },
                FrameColType::Number | FrameColType::Date => match c {
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

/// The cube's flat columns as a frame, a value with a unit read as its number.
fn flat_cube(cube: &Cube) -> Frame {
    let nested = |cells: &[V]| cells.iter().any(|v| matches!(v, V::Cube(_) | V::Frame(_) | V::List(_)));
    let rows = cube.columns.iter().map(|c| c.cells.len()).max().unwrap_or(0);
    let columns = cube
        .columns
        .iter()
        .filter(|col| !nested(&col.cells))
        .map(|col| {
            let cells: Vec<V> =
                col.cells.iter().map(|v| if let V::Unit(u) = v { V::Num(u.value) } else { v.clone() }).collect();
            Column { format: col.format.clone(), ..typed_column(&col.name, &cells, rows, col.ty) }
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
    let sign = |n: f64| {
        if n > 0.0 {
            1.0
        } else if n < 0.0 {
            -1.0
        } else {
            n
        }
    };
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

/// A References table's rows as reference marks, its columns found by name.
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
    let fields: [(&str, Option<&Column>, Read); 6] = [
        ("x", col("x"), &nx),
        ("x2", col("x2"), &nx),
        ("y", col("y"), &n),
        ("y2", col("y2"), &n),
        ("label", col("label"), &t),
        ("color", col("color"), &t),
    ];
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

/// A list plots at x = 1, 2, 3, …; a number is one point at x = 1.
fn list_xy(op: &str, raw: &V, opts: &Obj) -> Option<Obj> {
    let ys: Vec<V> = match raw {
        V::List(items) => items.to_vec(),
        V::Num(_) => vec![raw.clone()],
        _ => return None,
    };
    let points: Vec<Json> = ys
        .iter()
        .enumerate()
        .map(|(i, v)| finite(v).map_or(Json::Null, |y| json!({ "x": jn((i + 1) as f64), "y": jn(y) })))
        .collect();
    let series =
        json!([{ "name": "", "points": points, "line": line_for(op, opts), "marker": marker_for(op, opts, 1) }]);
    Some(json!({ "kind": "xy", "names": {}, "series": series }).as_object().cloned().unwrap_or_default())
}

/// A frame, a list or a number as XY series, the columns picked by the options' names. A named column the
/// frame lacks is `#REF!`, a text column in a number role `#TYPE!`; `None` is nothing to plot.
fn build_xy(op: &str, raw: &V, opts: &Obj) -> Result<Option<Obj>, V> {
    let V::Frame(f) = raw else { return Ok(list_xy(op, raw, opts)) };
    let cols = &f.columns;
    if cols.is_empty() {
        return Ok(None);
    }
    let find = |name: &str, role: &str| -> Result<usize, V> {
        let key = js_lower(js_trim(name)).into_owned();
        cols.iter().position(|c| js_lower(js_trim(&c.name)) == key).ok_or_else(|| {
            err(ErrorCode::Ref, format!("The options name a {role} column \"{name}\", which the data doesn't have"))
        })
    };
    let named = |k: &str, role: &str| opts.get(k).and_then(Json::as_str).map(|n| find(n, role)).transpose();
    let x_named = named("x", "x");
    let s_named = named("s", "size");
    let c_named = named("c", "color");
    let t_named = named("annotate", "annotate");
    let by_named = named("by", "by");
    let y_named: Option<Result<Vec<usize>, V>> = opts
        .get("y")
        .and_then(Json::as_array)
        .map(|names| names.iter().filter_map(Json::as_str).map(|n| find(n, "y")).collect());
    let (xn, sn, cn, tn, byn) = (x_named?, s_named?, c_named?, t_named?, by_named?);
    let yn = y_named.transpose()?;
    let mut taken: Vec<usize> =
        [xn, sn, cn, tn, byn].into_iter().flatten().chain(yn.iter().flatten().copied()).collect();
    let mut pool: Vec<usize> =
        (0..cols.len()).filter(|i| cols[*i].ty == FrameColType::Number && !taken.contains(i)).collect();
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
        if cols[i].ty != FrameColType::Number {
            return Err(err(
                ErrorCode::Type,
                format!("Column \"{}\" is the {role} column but holds {}, not numbers", cols[i].name, cols[i].ty),
            ));
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
        Some(x) if cols[x].ty == FrameColType::Number || cols[x].ty == FrameColType::Date => {
            (0..rows).map(|r| finite(&cell(&cols[x], r))).collect()
        }
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
        if cols[ci].ty == FrameColType::Number {
            finite(&cell(&cols[ci], r)).map(jn)
        } else {
            text(ci, r).map(Json::String)
        }
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
    let mut c_seen = std::collections::HashSet::<String>::new();
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
                            Json::String(s) if !c_seen.contains(s) => {
                                c_seen.insert(s.clone());
                                c_cats.push(s.clone());
                            }
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
        let (lo, hi) = vals.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), v| {
            (if *v < lo { *v } else { lo }, if *v > hi { *v } else { hi })
        });
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
    if x_col.is_some_and(|x| cols[x].ty == FrameColType::Date) {
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
            let ys = s0["points"]
                .as_array()
                .map(|ps| ps.iter().map(|p| p.get("y").map_or(V::Null, |y| V::Num(json_num(y)))).collect())
                .unwrap_or_default();
            v = list(ys);
            let explicit = op == "bubble" || opts.contains_key("x");
            let axis_name = |k: &str| {
                xy["names"].get(k).and_then(Json::as_str).filter(|n| !n.is_empty()).map(|n| Json::String(n.into()))
            };
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
            (s.len() >= 2).then(|| {
                Json::Array(
                    s.iter()
                        .map(|(n, vs)| json!({ "name": n, "values": vs.iter().map(jv).collect::<Vec<_>>() }))
                        .collect(),
                )
            })
        };
        if op == "radar" && cols.len() >= 2 {
            let label_col = &cols[0];
            let num_cols: Vec<&Column> = cols[1..].iter().filter(|c| c.ty == FrameColType::Number).collect();
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
            labels = Some(
                (0..cols[0].values.len())
                    .map(|r| match format_cell(cols[0].ty, &cell(&cols[0], r), None) {
                        V::Null => V::str(""),
                        x => x,
                    })
                    .collect(),
            );
            let rows: Vec<(String, Vec<V>)> = cols[1..]
                .iter()
                .filter(|c| c.ty == FrameColType::Number)
                .map(|c| (c.name.clone(), num_col(c)))
                .collect();
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
        let payload =
            json!({ "kind": "scale", "style": "dial", "value": jv(&value), "target": null, "min": 0, "max": 1 });
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
        let e = err(
            ErrorCode::Shape,
            "Candlestick needs Open, High, Low and Close columns (a date column first is optional)",
        );
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

// ─── Merge Plots ────────────────────────────────────────────────────────────────

/// A field of plain data, `None` where it is missing or `undefined`.
fn field<'a>(o: &'a Json, k: &str) -> Option<&'a Json> {
    o.get(k).filter(|v| v.get("__undef").is_none())
}

/// `typeof v === "number"`: a JSON number or a tagged one.
fn is_number(j: &Json) -> bool {
    j.is_number() || j.get("__nf").is_some()
}

fn json_truthy(j: &Json) -> bool {
    match j {
        Json::Null => false,
        Json::Bool(b) => *b,
        Json::String(s) => !s.is_empty(),
        Json::Number(n) => n.as_f64() != Some(0.0),
        Json::Object(o) if o.contains_key("__undef") => false,
        Json::Object(o) => !matches!(o.get("__nf").and_then(Json::as_str), Some("nan" | "-0")),
        Json::Array(_) => true,
    }
}

/// `String(v)` of a field of plain data.
fn json_text(j: Option<&Json>) -> String {
    match j {
        None => "undefined".into(),
        Some(Json::String(s)) => s.clone(),
        Some(Json::Null) => "null".into(),
        Some(n) if is_number(n) => number_to_string(json_num(n)),
        Some(Json::Bool(b)) => b.to_string(),
        Some(Json::Array(a)) => {
            a.iter().map(|x| if x.is_null() { String::new() } else { json_text(Some(x)) }).collect::<Vec<_>>().join(",")
        }
        Some(_) => "[object Object]".into(),
    }
}

fn or_undef(j: Option<&Json>) -> Json {
    j.cloned().unwrap_or_else(undef)
}

const PLANAR_OPS: [&str; 7] = ["line", "area", "column", "bar", "scatter", "xyline", "bubble"];
const OVERLAY_KEYS: [&str; 13] = [
    "title",
    "xlabel",
    "ylabel",
    "grid",
    "aspect",
    "yscale",
    "xmin",
    "xmax",
    "ymin",
    "ymax",
    "maxgap",
    "linewidth",
    "fontsize",
];

fn merge_plots(c: &mut Call) -> Answer {
    let mut opts = read_options(c)?;
    opts.retain(|k, _| OVERLAY_KEYS.contains(&k.as_str()));
    let keys: Vec<String> = c
        .sockets
        .iter()
        .map(|s| s.key.clone())
        .filter(|k| k.len() > 1 && k.starts_with('p') && k[1..].bytes().all(|b| b.is_ascii_digit()))
        .collect();
    let mut sources: Vec<(Rc<Json>, usize)> = Vec::new();
    let mut refusal: Option<V> = None;
    for (i, key) in keys.iter().enumerate() {
        let V::Json(cv) = first(c, key) else { continue };
        if cv.get("__chart") != Some(&Json::Bool(true)) {
            continue;
        }
        let op = field(&cv, "op");
        if !op.and_then(Json::as_str).is_some_and(|o| PLANAR_OPS.contains(&o)) {
            refusal.get_or_insert_with(|| {
                err(
                    ErrorCode::Type,
                    format!("Plot {} is a {} chart, which has no x/y plane to overlay", i + 1, json_text(op)),
                )
            });
            continue;
        }
        sources.push((cv, i + 1));
    }
    let payload = match refusal {
        Some(e) => Err(e),
        None if sources.iter().any(|(cv, _)| is_xy(cv)) => merge_xy(&sources),
        None => Ok(merge_overlay(&sources)),
    };
    let payload = match payload {
        Ok(p) => p,
        Err(e) => {
            c.show("chartOptions", whole(Json::Object(opts)));
            c.show("cachedChart", e.clone());
            return Ok(vec![("chart".into(), e)]);
        }
    };
    let refs: Vec<Json> = sources
        .iter()
        .flat_map(|(cv, _)| field(cv, "refs").and_then(Json::as_array).cloned().unwrap_or_default())
        .collect();
    let mut chart = Obj::new();
    chart.insert("__chart".into(), Json::Bool(true));
    chart.insert("op".into(), json!("overlay"));
    chart.insert("values".into(), Json::Null);
    chart.insert("payload".into(), payload);
    chart.insert("options".into(), Json::Object(opts.clone()));
    chart.insert("title".into(), Json::String(title(&opts, c, "Merged Plot")));
    if !refs.is_empty() {
        chart.insert("refs".into(), Json::Array(refs));
    }
    let chart = whole(Json::Object(chart));
    c.show("chartOptions", whole(Json::Object(opts)));
    c.show("cachedChart", chart.clone());
    Ok(vec![("chart".into(), chart)])
}

fn is_xy(cv: &Json) -> bool {
    field(cv, "payload").and_then(|p| p.get("kind")) == Some(&json!("xy"))
}

/// Labelled series move onto the union of every source's labels (a label repeated within one source keeps a slot
/// per repeat); an unlabelled one stays by position.
fn merge_overlay(sources: &[(Rc<Json>, usize)]) -> Json {
    let mut labels: Vec<Json> = Vec::new();
    let mut slots: HashMap<String, Vec<usize>> = HashMap::new();
    let slot_maps: Vec<Option<Vec<usize>>> = sources
        .iter()
        .map(|(cv, _)| {
            let ls = field(cv, "labels").and_then(Json::as_array).filter(|l| !l.is_empty())?;
            let mut seen: HashMap<String, usize> = HashMap::new();
            Some(
                ls.iter()
                    .map(|l| {
                        let key = l.to_string();
                        let k = seen.get(&key).copied().unwrap_or(0);
                        seen.insert(key.clone(), k + 1);
                        let at = slots.entry(key).or_default();
                        if at.len() <= k {
                            at.push(labels.len());
                            labels.push(l.clone());
                        }
                        at[k]
                    })
                    .collect(),
            )
        })
        .collect();
    let mut series: Vec<Json> = Vec::new();
    for (i, (cv, _)) in sources.iter().enumerate() {
        let o = field(cv, "options");
        let opt = |k: &str| o.and_then(|o| field(o, k));
        let mut style = Obj::new();
        style.insert("color".into(), opt("color").filter(|c| json_truthy(c)).cloned().unwrap_or_else(undef));
        for k in ["markersize", "linewidth", "alpha", "marker"] {
            style.insert(k.into(), or_undef(opt(k)));
        }
        let place = |values: Option<&Json>| -> Json {
            let Some(to) = &slot_maps[i] else { return or_undef(values) };
            let mut out = vec![Json::Null; labels.len()];
            for (j, v) in values.and_then(Json::as_array).into_iter().flatten().enumerate() {
                if j < to.len() {
                    out[to[j]] = v.clone();
                }
            }
            Json::Array(out)
        };
        let mut push = |name: Json, values: Json| {
            let mut s = Obj::new();
            s.insert("name".into(), name);
            s.insert("kind".into(), or_undef(field(cv, "op")));
            s.insert("values".into(), values);
            s.extend(style.clone());
            series.push(Json::Object(s));
        };
        let title_or_blank = || field(cv, "title").filter(|t| !t.is_null()).cloned().unwrap_or_else(|| json!(""));
        let values = field(cv, "values");
        match field(cv, "series").and_then(Json::as_array).filter(|s| !s.is_empty()) {
            Some(ss) => {
                for s in ss {
                    push(or_undef(field(s, "name")), place(field(s, "values")));
                }
            }
            None if values.is_some_and(Json::is_array) => push(title_or_blank(), place(values)),
            None if values.is_some_and(is_number) => push(title_or_blank(), place(Some(&json!([values.cloned()])))),
            None => {}
        }
    }
    json!({ "kind": "overlay", "series": series, "labels": if labels.is_empty() { undef() } else { Json::Array(labels) } })
}

/// One plot's series on the shared plane: `(series, xcats, xDate)`.
type XySource = (Vec<Json>, Option<Json>, Option<Json>);

/// One Merge Plots source as XY series on a shared numeric plane, its own options as each series' style.
fn source_as_xy(cv: &Json, plot_no: usize) -> Result<XySource, V> {
    let empty = json!({});
    let o = field(cv, "options").unwrap_or(&empty);
    let style = |many: bool| {
        let mut st = Obj::new();
        if let Some(col) = field(o, "color").filter(|c| json_truthy(c) && !many) {
            st.insert("color".into(), col.clone());
        }
        for k in ["markersize", "linewidth", "alpha"] {
            if let Some(v) = field(o, k) {
                st.insert(k.into(), v.clone());
            }
        }
        st
    };
    if is_xy(cv) {
        let p = field(cv, "payload").unwrap_or(&empty);
        let ss = field(p, "series").and_then(Json::as_array).cloned().unwrap_or_default();
        let many = ss.len() > 1;
        let st = style(many);
        let title = field(cv, "title").filter(|t| json_truthy(t));
        let series = ss
            .into_iter()
            .map(|s| {
                let mut s = s.as_object().cloned().unwrap_or_default();
                let own = s.get("name").filter(|v| v.get("__undef").is_none()).cloned();
                let name = if many { own } else { title.cloned().or(own) };
                s.extend(st.clone());
                s.insert("name".into(), name.filter(|n| !n.is_null()).unwrap_or_else(|| json!("")));
                Json::Object(s)
            })
            .collect();
        return Ok((series, field(p, "xcats").cloned(), field(p, "xDate").cloned()));
    }
    let op = field(cv, "op");
    if let Some(o @ ("column" | "bar")) = op.and_then(Json::as_str) {
        return Err(err(
            ErrorCode::Type,
            format!("Plot {plot_no} is a {o} chart; bars can't share an x/y plane with a scatter or XY line"),
        ));
    }
    let labels = field(cv, "labels").and_then(Json::as_array).filter(|l| !l.is_empty());
    if labels.is_some_and(|l| !l.iter().all(Json::is_number)) {
        return Err(err(
            ErrorCode::Type,
            format!(
                "Plot {plot_no} plots against text labels, so it can't share an x/y plane with a scatter or XY line"
            ),
        ));
    }
    let x_at = |i: usize| match labels {
        Some(l) => l.get(i).cloned().unwrap_or_else(undef),
        None => jn((i + 1) as f64),
    };
    let to_points = |vals: Option<&Json>| -> Json {
        Json::Array(
            vals.and_then(Json::as_array)
                .into_iter()
                .flatten()
                .enumerate()
                .map(|(i, v)| if v.is_number() { json!({ "x": x_at(i), "y": v }) } else { Json::Null })
                .collect(),
        )
    };
    let title_or_blank = || field(cv, "title").filter(|t| !t.is_null()).cloned().unwrap_or_else(|| json!(""));
    let values = field(cv, "values");
    let raw: Vec<(Json, Json)> = match field(cv, "series").and_then(Json::as_array).filter(|s| !s.is_empty()) {
        Some(ss) => ss.iter().map(|s| (or_undef(field(s, "name")), to_points(field(s, "values")))).collect(),
        None if values.is_some_and(Json::is_array) => vec![(title_or_blank(), to_points(values))],
        None if values.is_some_and(is_number) => vec![(title_or_blank(), to_points(Some(&json!([values.cloned()]))))],
        None => Vec::new(),
    };
    let st = style(raw.len() > 1);
    let marker = field(o, "marker").filter(|m| !m.is_null()).cloned().unwrap_or(Json::Bool(false));
    let series = raw
        .into_iter()
        .map(|(name, points)| {
            let mut s = Obj::new();
            s.insert("name".into(), name);
            s.insert("points".into(), points);
            s.insert("line".into(), json!("solid"));
            s.insert("marker".into(), marker.clone());
            s.extend(st.clone());
            Json::Object(s)
        })
        .collect();
    Ok((series, None, None))
}

/// Text x values are indices into their own plot's categories, so they move onto one shared list; text beside
/// numbers has no one x axis.
fn merge_xy(sources: &[(Rc<Json>, usize)]) -> Result<Json, V> {
    let mut got: Vec<(usize, XySource)> = Vec::new();
    for (cv, plot_no) in sources {
        let g = source_as_xy(cv, *plot_no)?;
        let drawn =
            g.0.iter()
                .any(|s| s.get("points").and_then(Json::as_array).is_some_and(|ps| ps.iter().any(|p| !p.is_null())));
        if drawn {
            got.push((*plot_no, g));
        }
    }
    let has_cats = |g: &XySource| g.1.as_ref().is_some_and(json_truthy);
    let text_x = got.iter().find(|(_, g)| has_cats(g));
    let num_x = got.iter().find(|(_, g)| !has_cats(g));
    if let (Some((t, _)), Some((n, _))) = (text_x, num_x) {
        return Err(err(
            ErrorCode::Type,
            format!("Plot {t} plots against text x values and plot {n} against numbers, so they have no one x axis"),
        ));
    }
    let mut xcats: Vec<Json> = Vec::new();
    let mut at: HashMap<String, usize> = HashMap::new();
    let mut series: Vec<Json> = Vec::new();
    for (_, (ss, cats, _)) in &got {
        let Some(cats) = cats.as_ref().filter(|c| json_truthy(c)) else {
            series.extend(ss.iter().cloned());
            continue;
        };
        let to: Vec<usize> = cats
            .as_array()
            .into_iter()
            .flatten()
            .map(|c| {
                *at.entry(c.to_string()).or_insert_with(|| {
                    xcats.push(c.clone());
                    xcats.len() - 1
                })
            })
            .collect();
        for s in ss {
            let mut s = s.as_object().cloned().unwrap_or_default();
            let points: Vec<Json> = s
                .get("points")
                .and_then(Json::as_array)
                .into_iter()
                .flatten()
                .map(|p| {
                    if p.is_null() {
                        return Json::Null;
                    }
                    let mut p = p.as_object().cloned().unwrap_or_default();
                    let x = p.get("x").map_or(f64::NAN, json_num);
                    if x >= 0.0 && x.fract() == 0.0 && (x as usize) < to.len() {
                        p.insert("x".into(), jn(to[x as usize] as f64));
                    }
                    Json::Object(p)
                })
                .collect();
            s.insert("points".into(), Json::Array(points));
            series.push(Json::Object(s));
        }
    }
    let axis_name = |k: &str| {
        let all: Vec<Option<&Json>> = sources
            .iter()
            .map(|(cv, _)| {
                if is_xy(cv) {
                    field(cv, "payload").and_then(|p| p.get("names")).and_then(|n| field(n, k))
                } else {
                    None
                }
            })
            .collect();
        all[0].filter(|a| all.iter().all(|n| *n == Some(*a)) && json_truthy(a)).cloned()
    };
    let mut names = Obj::new();
    for k in ["x", "y"] {
        if let Some(n) = axis_name(k) {
            names.insert(k.into(), n);
        }
    }
    let mut p = Obj::new();
    p.insert("kind".into(), json!("xy"));
    p.insert("series".into(), Json::Array(series));
    if text_x.is_some() {
        p.insert("xcats".into(), Json::Array(xcats));
    }
    p.insert("names".into(), Json::Object(names));
    if !got.is_empty() && got.iter().all(|(_, g)| g.2.as_ref().is_some_and(json_truthy)) {
        p.insert("xDate".into(), Json::Bool(true));
    }
    Ok(Json::Object(p))
}

// ─── Histogram ──────────────────────────────────────────────────────────────────

/// A bin count below 1, or not a number, has no histogram.
fn bin_count(k: &V) -> Result<f64, V> {
    match k {
        V::Num(n) if n.is_finite() && n.floor() >= 1.0 => Ok(*n),
        _ => Err(err(ErrorCode::Domain, "Bins must be 1 or more")),
    }
}

/// The lower edges over `[min, max]` (min < max), and each value's bin by them, the last closed.
pub(crate) fn equal_width_bins(min: f64, max: f64, bins: usize) -> (Vec<f64>, impl Fn(f64) -> usize) {
    let w = (max - min) / bins as f64;
    let edges: Vec<f64> = (0..bins).map(|i| min + i as f64 * w).collect();
    let e = edges.clone();
    let idx = move |v: f64| {
        let f = ((v - min) / w).floor();
        let top = (bins - 1) as f64;
        let mut i = (if f < 0.0 {
            0.0
        } else if f > top {
            top
        } else {
            f
        }) as usize;
        if i > 0 && v < e[i] {
            i -= 1;
        } else if i + 1 < bins && v >= e[i + 1] {
            i += 1;
        }
        i
    };
    (edges, idx)
}

fn bins_of(k: f64) -> usize {
    k.floor().clamp(1.0, 100.0) as usize
}

fn extent(nums: &[f64]) -> (f64, f64) {
    nums.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), v| {
        (if *v < lo { *v } else { lo }, if *v > hi { *v } else { hi })
    })
}

fn histogram_bins(vals: &[V], k: &V) -> Result<Vec<f64>, V> {
    let nums: Vec<f64> = vals.iter().filter_map(finite).collect();
    let bins = bins_of(bin_count(k)?);
    if nums.is_empty() {
        return Ok(Vec::new());
    }
    let (min, max) = extent(&nums);
    let mut counts = vec![0.0; bins];
    if min == max {
        counts[0] = nums.len() as f64;
        return Ok(counts);
    }
    let (_, idx) = equal_width_bins(min, max, bins);
    for x in nums {
        counts[idx(x)] += 1.0;
    }
    Ok(counts)
}

/// `counts[yBin][xBin]` and each axis' lower edges.
type Histogram2d = (Vec<Vec<f64>>, Vec<f64>, Vec<f64>);

fn histogram2d(xs: &[V], ys: &[V], kx: &V, ky: &V) -> Result<Option<Histogram2d>, V> {
    let (kx, ky) = (bin_count(kx)?, bin_count(ky)?);
    let (px, py): (Vec<f64>, Vec<f64>) = xs.iter().zip(ys).filter_map(|(x, y)| Some((finite(x)?, finite(y)?))).unzip();
    if px.is_empty() {
        return Ok(None);
    }
    type Axis = (Vec<f64>, Box<dyn Fn(f64) -> usize>);
    let axis = |nums: &[f64], k: f64| -> Axis {
        let (min, max) = extent(nums);
        if min == max {
            return (vec![min], Box::new(|_| 0));
        }
        let (edges, idx) = equal_width_bins(min, max, bins_of(k));
        (edges, Box::new(idx))
    };
    let ((xe, xi), (ye, yi)) = (axis(&px, kx), axis(&py, ky));
    let mut counts = vec![vec![0.0; xe.len()]; ye.len()];
    for (x, y) in px.iter().zip(&py) {
        counts[yi(*y)][xi(*x)] += 1.0;
    }
    Ok(Some((counts, xe, ye)))
}

fn list_of(v: V) -> Vec<V> {
    match v {
        V::List(items) => items.to_vec(),
        V::Null => Vec::new(),
        v => vec![v],
    }
}

fn histogram(c: &mut Call) -> Answer {
    let xs = list_of(first(c, "values"));
    let kx = read_role(c, "bins", &Role::Setting(V::Num(10.0)));
    let opts = read_options(c)?;
    let title = title(&opts, c, "Histogram");
    c.show("chartOptions", whole(Json::Object(opts.clone())));
    if c.field_str("mode", "1d") == "2d" {
        let ys = list_of(first(c, "y"));
        let ky = read_role(c, "ybins", &Role::Setting(V::Num(10.0)));
        c.show("cachedResult", V::Null);
        let h = match histogram2d(&xs, &ys, &kx, &ky) {
            Ok(h) => h,
            Err(e) => {
                c.show("cachedChart", V::Null);
                return Ok(vec![("chart".into(), e)]);
            }
        };
        let edge = |v: &f64| Json::String(number_to_string(crate::unit_value::to_precision(*v, 3)));
        let (z, rows, cols) = match &h {
            Some((counts, xe, ye)) => (
                counts.iter().map(|r| Json::Array(r.iter().map(|n| jn(*n)).collect())).collect(),
                ye.iter().map(edge).collect(),
                xe.iter().map(edge).collect(),
            ),
            None => (Vec::new(), Vec::new(), Vec::new()),
        };
        let mut options = Obj::new();
        options.insert("origin".into(), json!("lower"));
        options.insert("aspect".into(), json!("auto"));
        options.extend(opts);
        let chart = json!({
            "__chart": true, "op": "heatmap", "values": null, "payload": { "kind": "heatmap", "z": z, "rows": rows, "cols": cols },
            "options": options, "title": title,
        });
        c.show("cachedChart", if h.is_some() { whole(chart.clone()) } else { V::Null });
        return Ok(vec![("chart".into(), whole(chart))]);
    }
    let counts = match histogram_bins(&xs, &kx) {
        Ok(counts) => counts,
        Err(e) => {
            c.show("cachedResult", V::Null);
            c.show("cachedChart", V::Null);
            return Ok(vec![("chart".into(), e)]);
        }
    };
    c.show("cachedResult", list(counts.iter().map(|n| V::Num(*n)).collect()));
    let chart = whole(json!({
        "__chart": true, "op": "column", "values": counts.iter().map(|n| jn(*n)).collect::<Vec<_>>(), "options": opts, "title": title,
    }));
    c.show("cachedChart", chart.clone());
    Ok(vec![("chart".into(), chart)])
}

// ─── KPI ────────────────────────────────────────────────────────────────────────

fn kpi(c: &mut Call) -> Answer {
    let value = c.read_input("value", literal_or(c, "value", V::Null));
    let prev = c.read_input("prev", literal_or(c, "prev", V::Null));
    let opts = read_options(c)?;
    let unit = match c.string_literal("unit") {
        V::Undef | V::Null => V::str(""),
        u => u,
    };
    let good_up = !matches!(literal_or(c, "goodUp", V::Num(1.0)), V::Num(n) if n == 0.0);
    let payload =
        json!({ "kind": "kpi", "value": jv(&value), "prev": jv(&prev), "unit": jv(&unit), "goodUp": good_up });
    c.show("chartOptions", whole(Json::Object(opts.clone())));
    c.show("cachedPayload", whole(payload.clone()));
    let chart = json!({ "__chart": true, "op": "kpi", "values": jv(&value), "payload": payload, "options": opts, "title": title(&opts, c, "KPI") });
    Ok(vec![("chart".into(), whole(chart))])
}

// ─── The frame-fed figures ──────────────────────────────────────────────────────

/// A figure's chart, shown on the card and answered.
fn figure(c: &mut Call, op: &str, values: Json, payload: Json, opts: Obj, dflt: &str) -> Answer {
    let chart = json!({ "__chart": true, "op": op, "values": values, "payload": payload, "options": opts, "title": title(&opts, c, dflt) });
    c.show("chartOptions", whole(Json::Object(opts)));
    let chart = whole(chart);
    c.show("cachedChart", chart.clone());
    Ok(vec![("chart".into(), chart)])
}

fn known(xs: &[Option<f64>]) -> Json {
    Json::Array(xs.iter().flatten().map(|n| jn(*n)).collect())
}

fn proportion(c: &mut Call) -> Answer {
    let frame = first(c, "frame");
    let cols = frame_columns(&frame);
    let names = col_strings(cols.first());
    let values: Vec<f64> = col_numbers(cols.get(1).or(cols.first())).into_iter().map(|x| x.unwrap_or(0.0)).collect();
    let opts = read_options(c)?;
    let layout = if c.field_str("op", "treemap") == "waffle" { "waffle" } else { "treemap" };
    let values = Json::Array(values.iter().map(|n| jn(*n)).collect());
    let payload = json!({ "kind": "proportion", "layout": layout, "names": strs(&names), "values": values });
    figure(c, "proportion", values, payload, opts, "Proportion")
}

/// Repeated from-to pairs summed into one flow.
fn merge_flows(sources: &[String], targets: &[String], values: &[f64]) -> (Vec<String>, Vec<String>, Vec<f64>) {
    let mut at: HashMap<(String, String), usize> = HashMap::new();
    let (mut s, mut t, mut v) = (Vec::new(), Vec::new(), Vec::new());
    for (i, src) in sources.iter().enumerate() {
        let tgt = targets.get(i).cloned().unwrap_or_default();
        let val = values.get(i).copied().unwrap_or(0.0);
        if let Some(&j) = at.get(&(src.clone(), tgt.clone())) {
            v[j] += val;
            continue;
        }
        at.insert((src.clone(), tgt.clone()), v.len());
        s.push(src.clone());
        t.push(tgt);
        v.push(val);
    }
    (s, t, v)
}

type Flows = (Vec<String>, Vec<String>, Vec<f64>);

/// A flow that would close a loop is dropped and counted.
fn acyclic_flows((sources, targets, values): Flows) -> (Flows, usize) {
    // Names as indices and one stamped visit list, and no walk where nothing can reach the source ([[C120]] linearWork).
    let mut ids: HashMap<String, usize> = HashMap::new();
    let mut adj: Vec<Vec<usize>> = Vec::new();
    let mut fed: Vec<bool> = Vec::new();
    let mut edges: std::collections::HashSet<(usize, usize)> = std::collections::HashSet::new();
    let (mut seen, mut walk): (Vec<u32>, u32) = (Vec::new(), 0);
    let (mut s, mut t, mut v, mut dropped) = (Vec::new(), Vec::new(), Vec::new(), 0);
    for ((src, tgt), val) in sources.into_iter().zip(targets).zip(values) {
        if src.is_empty() || tgt.is_empty() || src == tgt || val.is_nan() || val <= 0.0 {
            s.push(src);
            t.push(tgt);
            v.push(val);
            continue;
        }
        let mut id = |name: &str| {
            let next = ids.len();
            let k = *ids.entry(name.to_owned()).or_insert(next);
            if k == adj.len() {
                adj.push(Vec::new());
                fed.push(false);
                seen.push(0);
            }
            k
        };
        let (a, b) = (id(&src), id(&tgt));
        let closes = fed[a] && !adj[b].is_empty() && !edges.contains(&(a, b)) && {
            walk += 1;
            let mut stack = vec![b];
            let mut hit = false;
            while let Some(n) = stack.pop() {
                if n == a {
                    hit = true;
                    break;
                }
                if seen[n] != walk {
                    seen[n] = walk;
                    stack.extend(&adj[n]);
                }
            }
            hit
        };
        if closes {
            dropped += 1;
            continue;
        }
        if edges.insert((a, b)) {
            adj[a].push(b);
        }
        fed[b] = true;
        s.push(src);
        t.push(tgt);
        v.push(val);
    }
    ((s, t, v), dropped)
}

fn sankey(c: &mut Call) -> Answer {
    let frame = first(c, "frame");
    let cols = frame_columns(&frame);
    let amounts: Vec<f64> = col_numbers(cols.get(2)).into_iter().map(|x| x.unwrap_or(0.0)).collect();
    let flows = merge_flows(&col_strings(cols.first()), &col_strings(cols.get(1)), &amounts);
    let opts = read_options(c)?;
    let ((sources, targets, values), dropped) = acyclic_flows(flows);
    c.show("droppedLoops", V::Num(dropped as f64));
    c.show("chartOptions", whole(Json::Object(opts.clone())));
    let drawable = sources
        .iter()
        .zip(&targets)
        .zip(&values)
        .any(|((s, t), v)| !s.is_empty() && !t.is_empty() && s != t && *v > 0.0);
    if dropped > 0 && !drawable {
        c.show("cachedPayload", V::Null);
        return Ok(vec![("chart".into(), err(ErrorCode::Shape, "The flows form a loop; a Sankey needs a direction"))]);
    }
    let values = Json::Array(values.iter().map(|n| jn(*n)).collect());
    let payload = json!({ "kind": "sankey", "sources": strs(&sources), "targets": strs(&targets), "values": values });
    c.show("cachedPayload", whole(payload.clone()));
    let chart = json!({ "__chart": true, "op": "sankey", "values": values, "payload": payload, "options": opts, "title": title(&opts, c, "Sankey") });
    Ok(vec![("chart".into(), whole(chart))])
}

/// The most rows, and the most columns, a Heatmap draws.
const HEATMAP_MAX: usize = 400;

/// A heatmap's grid: `z[r][c]`, the row names and the column names.
type Grid = (Vec<Vec<Option<f64>>>, Vec<String>, Vec<String>);

fn index_names(n: usize) -> Vec<String> {
    (1..=n).map(|i| i.to_string()).collect()
}

/// The number columns are the heat columns; a first column that is not numbers names the rows.
fn heatmap_from_columns(cols: &[Column]) -> Grid {
    let named = cols.len() >= 2 && cols[0].ty != FrameColType::Number;
    let data: Vec<&Column> = cols[usize::from(named)..].iter().filter(|c| c.ty == FrameColType::Number).collect();
    let n_rows = data.iter().map(|c| c.values.len()).max().unwrap_or(0);
    let z = (0..n_rows).map(|r| data.iter().map(|col| col.values.get(r).and_then(finite)).collect()).collect();
    let mut rows: Vec<String> =
        if named { col_strings(cols.first()).into_iter().take(n_rows).collect() } else { index_names(n_rows) };
    rows.resize(n_rows, String::new());
    (z, rows, data.iter().map(|c| c.name.clone()).collect())
}

/// A plain table plots as it stands, rows and columns numbered; a list is one row.
fn heatmap_from_table(t: &[V]) -> Grid {
    let rows: Vec<Vec<V>> = if !t.is_empty() && t.iter().all(|r| matches!(r, V::List(_))) {
        t.iter().map(|r| if let V::List(r) = r { r.to_vec() } else { Vec::new() }).collect()
    } else {
        vec![t.to_vec()]
    };
    let n_cols = rows.iter().map(Vec::len).max().unwrap_or(0);
    let z = rows.iter().map(|r| (0..n_cols).map(|c| r.get(c).and_then(finite)).collect()).collect();
    (z, index_names(rows.len()), index_names(n_cols))
}

fn clip_heatmap((z, rows, cols): Grid) -> Json {
    let (n_r, n_c) = (z.len(), cols.len());
    let cut = n_r > HEATMAP_MAX || n_c > HEATMAP_MAX;
    let z: Vec<Json> = if cut {
        z.iter().take(HEATMAP_MAX).map(|r| opt_nums(&r[..r.len().min(HEATMAP_MAX)])).collect()
    } else {
        z.iter().map(|r| opt_nums(r)).collect()
    };
    let mut p = Obj::new();
    p.insert("kind".into(), json!("heatmap"));
    p.insert("z".into(), Json::Array(z));
    p.insert("rows".into(), strs(&rows[..rows.len().min(HEATMAP_MAX)]));
    p.insert("cols".into(), strs(&cols[..n_c.min(HEATMAP_MAX)]));
    if n_r > HEATMAP_MAX {
        p.insert("totalRows".into(), jn(n_r as f64));
    }
    if n_c > HEATMAP_MAX {
        p.insert("totalCols".into(), jn(n_c as f64));
    }
    Json::Object(p)
}

fn heatmap(c: &mut Call) -> Answer {
    let grid = match first(c, "values") {
        V::List(t) => heatmap_from_table(&t),
        V::Cube(cube) => heatmap_from_columns(&flat_cube(&cube).columns),
        v => heatmap_from_columns(frame_columns(&v)),
    };
    let opts = read_options(c)?;
    figure(c, "heatmap", Json::Null, clip_heatmap(grid), opts, "Heatmap")
}

/// A table of heights with its axes: the coordinates per column, per row, and the heights.
type Axes = (Vec<f64>, Vec<f64>, Vec<Vec<Option<f64>>>);

/// A table of heights with a coordinate per column and per row, 1, 2, 3… where unwired; `None` for a
/// table with no cells, a blank axis, or an axis that doesn't fit it.
fn grid_axes(z: &V, xs: Option<&V>, ys: Option<&V>) -> Option<Axes> {
    let V::List(z) = z else { return None };
    let cols = z.iter().map(|r| if let V::List(r) = r { r.len() } else { 0 }).max()?;
    if cols == 0 {
        return None;
    }
    let zg = z
        .iter()
        .map(|r| (0..cols).map(|j| if let V::List(r) = r { r.get(j).and_then(finite) } else { None }).collect())
        .collect();
    let axis = |raw: Option<&V>, n: usize| -> Option<Vec<f64>> {
        let items = match raw {
            None => return Some((1..=n).map(|i| i as f64).collect()),
            Some(V::Null) => return None,
            Some(V::List(l)) => l.to_vec(),
            Some(v) => vec![v.clone()],
        };
        if items.len() != n {
            return None;
        }
        items.iter().map(finite).collect()
    };
    Some((axis(xs, cols)?, axis(ys, z.len())?, zg))
}

/// `Number(v)` as `Math.round` reads its argument.
fn to_number(v: &V) -> f64 {
    match v {
        V::List(_) => string_to_number(&js_string_of(v)),
        v => super::kit::num(v),
    }
}

fn surface(c: &mut Call) -> Answer {
    let opts = read_options(c)?;
    let axis_in = |k: &str| {
        c.wired(k).map(|w| match w.first() {
            None | Some(V::Undef) => V::Null,
            Some(v) => v.clone(),
        })
    };
    let (xs_raw, ys_raw) = (axis_in("xs"), axis_in("ys"));
    let (xs, ys, z) = grid_axes(&first(c, "z"), xs_raw.as_ref(), ys_raw.as_ref()).unwrap_or_default();
    let nums = |v: &[f64]| Json::Array(v.iter().map(|n| jn(*n)).collect());
    let z = Json::Array(z.iter().map(|r| opt_nums(r)).collect());
    if c.field_str("op", "surface") == "contour" {
        let levels = match c.read_input("levels", literal_or(c, "levels", V::Num(8.0))) {
            V::Null => 0.0,
            v => math_round(to_number(&v)).clamp(2.0, 24.0),
        };
        let payload = json!({ "kind": "contour", "xs": nums(&xs), "ys": nums(&ys), "z": z, "levels": jn(levels) });
        return figure(c, "contour", Json::Null, payload, opts, "Contour");
    }
    let yaw = jv(&literal_or(c, "yaw", V::Num(45.0)));
    let pitch = jv(&literal_or(c, "pitch", V::Num(45.0)));
    let payload = json!({ "kind": "surface", "xs": nums(&xs), "ys": nums(&ys), "z": z, "yaw": yaw, "pitch": pitch });
    figure(c, "surface", Json::Null, payload, opts, "Surface")
}

fn waterfall(c: &mut Call) -> Answer {
    let frame = first(c, "frame");
    let cols = frame_columns(&frame);
    let names = col_strings(cols.first());
    let values = col_numbers(cols.get(1));
    let opts = read_options(c)?;
    let payload = json!({ "kind": "waterfall", "names": strs(&names), "values": opt_nums(&values), "total": true });
    figure(c, "waterfall", known(&values), payload, opts, "Waterfall")
}

/// The `p` quantile of sorted numbers, interpolated linearly.
fn quantile_sorted(sorted: &[f64], p: f64) -> f64 {
    let idx = (sorted.len() - 1) as f64 * p;
    let (lo, hi) = (idx.floor() as usize, idx.ceil() as usize);
    sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo as f64)
}

/// The quartiles, the whiskers at the farthest values inside 1.5 IQR, and the outliers past them.
fn boxplot_stats(sample: &[Option<f64>]) -> Option<Obj> {
    let mut nums: Vec<f64> = sample.iter().flatten().copied().filter(|v| v.is_finite()).collect();
    if nums.is_empty() {
        return None;
    }
    nums.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let (q1, med, q3) = (quantile_sorted(&nums, 0.25), quantile_sorted(&nums, 0.5), quantile_sorted(&nums, 0.75));
    let iqr = q3 - q1;
    let (lo_fence, hi_fence) = (q1 - 1.5 * iqr, q3 + 1.5 * iqr);
    let inliers: Vec<f64> = nums.iter().copied().filter(|v| *v >= lo_fence && *v <= hi_fence).collect();
    let mut o = Obj::new();
    o.insert("lo".into(), jn(*inliers.first().unwrap_or(&nums[0])));
    o.insert("q1".into(), jn(q1));
    o.insert("med".into(), jn(med));
    o.insert("q3".into(), jn(q3));
    o.insert("hi".into(), jn(*inliers.last().unwrap_or(&nums[nums.len() - 1])));
    o.insert(
        "outliers".into(),
        Json::Array(nums.iter().filter(|v| **v < lo_fence || **v > hi_fence).map(|v| jn(*v)).collect()),
    );
    Some(o)
}

fn boxplot(c: &mut Call) -> Answer {
    let mut boxes: Vec<Json> = Vec::new();
    let mut add = |name: &str, sample: Vec<Option<f64>>| {
        if let Some(mut s) = boxplot_stats(&sample) {
            s.insert("name".into(), Json::String(name.into()));
            boxes.push(Json::Object(s));
        }
    };
    match first(c, "values") {
        V::Frame(f) => {
            for col in f.columns.iter().filter(|c| c.ty == FrameColType::Number) {
                add(&col.name, col.values.iter().map(finite).collect());
            }
        }
        V::List(items) => add("", items.iter().map(|v| if let V::Num(n) = v { Some(*n) } else { None }).collect()),
        _ => {}
    }
    let opts = read_options(c)?;
    figure(c, "boxplot", Json::Null, json!({ "kind": "boxplot", "boxes": boxes }), opts, "Boxplot")
}

fn calendar_heatmap(c: &mut Call) -> Answer {
    let frame = first(c, "frame");
    let cols = frame_columns(&frame);
    let raw = |i: usize| cols.get(i).map_or_else(Vec::new, |col| col.values.iter().map(finite).collect::<Vec<_>>());
    let (serials, vals) = (raw(0), raw(1));
    let (mut days, mut values) = (Vec::new(), Vec::new());
    for (i, d) in serials.iter().enumerate() {
        let (Some(d), Some(Some(v))) = (d, vals.get(i)) else { continue };
        days.push(jn(d.floor()));
        values.push(jn(*v));
    }
    let opts = read_options(c)?;
    let payload = json!({ "kind": "calheat", "days": days, "values": values });
    figure(c, "calheat", Json::Array(values), payload, opts, "Calendar")
}

fn quiver(c: &mut Call) -> Answer {
    let opts = read_options(c)?;
    let norm = |m: V| -> Json {
        let V::List(rows) = m else { return json!([]) };
        Json::Array(
            rows.iter()
                .map(|r| match r {
                    V::List(r) => Json::Array(r.iter().map(|x| jopt(finite(x))).collect()),
                    r => json!([jopt(finite(r))]),
                })
                .collect(),
        )
    };
    let payload = json!({ "kind": "quiver", "u": norm(first(c, "u")), "v": norm(first(c, "v")) });
    figure(c, "quiver", Json::Null, payload, opts, "Vector Field")
}

// ─── Chart Builder ──────────────────────────────────────────────────────────────

const CB_STR_KEYS: [&str; 43] = [
    "title",
    "xlabel",
    "ylabel",
    "color",
    "grid",
    "marker",
    "pielabels",
    "radarscale",
    "zoom",
    "layout",
    "tiers",
    "fit",
    "critical",
    "baseline",
    "arrows",
    "today",
    "weekends",
    "labels",
    "histogram",
    "minutes",
    "window",
    "columns",
    "collapse",
    "week",
    "fiscal_start",
    "status",
    "group_by",
    "cardsize",
    "clamp",
    "x",
    "y",
    "s",
    "c",
    "annotate",
    "by",
    "linestyle",
    "aspect",
    "yscale",
    "cmap",
    "annot",
    "fmt",
    "cbar",
    "origin",
];
const CB_NUM_KEYS: [&str; 8] = ["linewidth", "markersize", "alpha", "fontsize", "vmin", "vmax", "center", "maxgap"];

/// The chart options over the card's fields: each one given a value, as `key=value` joined by semicolons.
fn chart_builder(c: &mut Call) -> Answer {
    let text = |k: &str| match c.read_input(k, c.string_literal(k)) {
        V::Null | V::Undef => None,
        v => Some(v),
    };
    let num = |k: &str| match c.read_input(k, c.literal(k)) {
        V::Num(n) if n.is_finite() => Some(n),
        _ => None,
    };
    let mut parts: Vec<String> = Vec::new();
    for k in CB_STR_KEYS {
        match text(k) {
            None => {}
            Some(V::Str(s)) => {
                if !js_trim(&s).is_empty() {
                    parts.push(format!("{k}={}", js_trim(&s)));
                }
            }
            Some(_) => return Err(crashed("v.trim is not a function")),
        }
    }
    let shown = |n: Option<f64>| n.map(number_to_string).unwrap_or_default();
    for axis in ["x", "y"] {
        let (lo, hi) = (num(&format!("{axis}min")), num(&format!("{axis}max")));
        if lo.is_some() || hi.is_some() {
            parts.push(format!("{axis}lim={},{}", shown(lo), shown(hi)));
        }
    }
    for k in CB_NUM_KEYS {
        if let Some(n) = num(k) {
            parts.push(format!("{k}={}", number_to_string(n)));
        }
    }
    let out = V::str(&parts.join(";"));
    c.show("cachedString", out.clone());
    Ok(vec![("result".into(), out)])
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The walk before the indices: every flow that would close a loop, in order, from string sets.
    fn by_names((sources, targets, values): Flows) -> (Flows, usize) {
        let mut adj: HashMap<String, Vec<String>> = HashMap::new();
        let reaches = |adj: &HashMap<String, Vec<String>>, from: &str, to: &str| {
            let mut seen = std::collections::HashSet::new();
            let mut stack = vec![from.to_string()];
            while let Some(n) = stack.pop() {
                if n == to {
                    return true;
                }
                if seen.insert(n.clone()) {
                    stack.extend(adj.get(&n).into_iter().flatten().cloned());
                }
            }
            false
        };
        let (mut s, mut t, mut v, mut dropped) = (Vec::new(), Vec::new(), Vec::new(), 0);
        for ((src, tgt), val) in sources.into_iter().zip(targets).zip(values) {
            let plain = src.is_empty() || tgt.is_empty() || src == tgt || val.is_nan() || val <= 0.0;
            if !plain && reaches(&adj, &tgt, &src) {
                dropped += 1;
                continue;
            }
            if !plain {
                let out = adj.entry(src.clone()).or_default();
                if !out.contains(&tgt) {
                    out.push(tgt.clone());
                }
            }
            s.push(src);
            t.push(tgt);
            v.push(val);
        }
        ((s, t, v), dropped)
    }

    #[test]
    fn acyclic_flows_drops_what_the_name_walk_dropped() {
        let mut seed = 7u64;
        let mut next = |m: u64| {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (seed >> 33) % m
        };
        let mut drops = 0;
        for _ in 0..300 {
            let nodes = 2 + next(9);
            let flows = 1 + next(40);
            let mut f: Flows = (Vec::new(), Vec::new(), Vec::new());
            for _ in 0..flows {
                let name = |k: u64| if k == nodes { String::new() } else { format!("n{k}") };
                f.0.push(name(next(nodes + 1)));
                f.1.push(name(next(nodes + 1)));
                f.2.push([1.0, 2.0, 0.0, -1.0, f64::NAN][next(5) as usize]);
            }
            let (got, want) = (acyclic_flows(f.clone()), by_names(f));
            assert_eq!(format!("{got:?}"), format!("{want:?}"));
            drops += got.1;
        }
        assert!(drops > 100, "{drops}");
    }
}
