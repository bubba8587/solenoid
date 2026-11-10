//! [[B11]] maximalMerge, [[C48]] appendLadder, [[C49]] filterOneJob. The list cards, most of them
//! one call to the list function they share their kernel with.

use super::kit::core_call;
use super::scalar::{read_role, Role};
use super::text::role_value;
use super::units::tag;
use super::Cv;
use super::{err, list, Answer, Call, Column, Frame};
use crate::error_value::ErrorCode;
use crate::excel_criteria::DateReading;
use crate::excel_functions::{value_text, MatchMode, Matcher, V};
use crate::frame::{FrameCell, FrameColType};
use crate::frame_verbs::FilterOp;
use crate::jsnum::{number_to_string, round_half_up, trim_space};
use crate::unit_dims::{dim_equal, dim_pow, is_dimensionless, Dim, UnitCell};
use crate::unit_value::{point_error, READINGS_ADD};
use crate::value_kinds::MAX_GENERATED;
use crate::value_kinds::{guard_finite as guard_cells, Logical};
use std::rc::Rc;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "SeriesNode" => series(c),
        "ShuffleNode" => shuffle(c),
        "ListLengthNode" => list_length(c),
        "SortNode" => sort(c),
        "ReverseNode" => reverse(c),
        "ShiftNode" => shift(c),
        "BinNode" => bin(c),
        "CombinationsNode" => combinations(c),
        "EwmaNode" => ewma(c),
        "ConvolveNode" => convolve(c),
        "CrossNode" => two_lists(c, "CROSSPRODUCT"),
        "PolyfitNode" => polyfit(c),
        "TrapzNode" => trapz(c),
        "RleNode" => rle(c),
        "SliceNode" => slice(c),
        "UniqueNode" => unique(c),
        "SetsNode" => sets(c),
        "ConcatListsNode" => concat_lists(c),
        "RunningNode" => running(c),
        "DiffNode" => diff(c),
        "ArgMinMaxNode" => arg_min_max(c),
        "ContainsNode" => contains(c),
        "NormalizeNode" => normalize(c),
        "NthElementNode" => nth_element(c),
        "InterleaveNode" => interleave(c),
        "PadNode" => pad(c),
        "WeightedNode" => weighted(c),
        "FillNode" => fill(c),
        "SpectrumNode" => spectrum(c),
        "ConnectedRegionsNode" => connected_regions(c),
        "SmoothNode" => smooth(c),
        "ListInputNode" => list_input(c),
        "FilterNode" => filter(c),
        "IsInNode" => is_in(c),
        "AggregateNode" => aggregate(c),
        "XMatchNode" => xmatch(c),
        "OutliersNode" => outliers(c),
        "TallyNode" => tally(c),
        "GroupListsNode" => group_lists(c),
        "FindPeaksNode" => find_peaks(c),
        "ListIndexNode" => list_index(c),
        "RandArrayNode" => rand_array(c),
        _ => return None,
    })
}

/// `inputs[key]?.[0]`: the first cable's value, `undefined` with none.
pub(crate) fn slot(c: &Call, key: &str) -> V {
    c.value_of(key, &c.raw_card(key))
}

pub(crate) fn nullish(v: &V) -> bool {
    matches!(v, V::Undef | V::Null)
}

/// `v ?? dflt`.
pub(crate) fn or(v: V, dflt: V) -> V {
    if nullish(&v) {
        dflt
    } else {
        v
    }
}

fn empty() -> V {
    list(Vec::new())
}

/// `inputs[key]?.[0] ?? []`.
fn list_in(c: &Call, key: &str) -> V {
    or(slot(c, key), empty())
}

/// A list's length; anything else is no list.
fn length(v: &V) -> Option<usize> {
    match v {
        V::List(l) => Some(l.len()),
        _ => None,
    }
}

fn setting(c: &Call, key: &str) -> V {
    read_role(c, key, &Role::Setting(V::Undef))
}

fn required(c: &Call, key: &str) -> V {
    read_role(c, key, &Role::Required)
}

/// A number rounded half up, a logical as 1 or 0.
fn rounded(v: &V) -> f64 {
    round_half_up(super::kit::num(v))
}

/// A finite number, no coercion.
fn finite(v: &V) -> bool {
    matches!(v, V::Num(n) if n.is_finite())
}

fn over_limit(what: &str, n: f64) -> V {
    err(
        ErrorCode::Overflow,
        format!("{what} {} exceeds the {} element limit", number_to_string(n), number_to_string(MAX_GENERATED)),
    )
}

fn shown(c: &mut Call, field: &str, out: &str, v: impl Into<Cv>) -> Answer {
    let v = v.into();
    c.show(field, v.clone());
    Ok(vec![(out.into(), v)])
}

fn series(c: &mut Call) -> Answer {
    let op = c.field_str("op", "range").to_string();
    let first_error = |vs: &[&V]| vs.iter().find(|v| v.is_sol_error()).map(|v| (*v).clone());
    let result = match op.as_str() {
        "range" => {
            let start = required(c, "start");
            let stop = c.read("stop");
            let step = or(setting(c, "step"), V::Num(1.0));
            if start.is_sol_error() {
                start
            } else if matches!(stop, V::Null) {
                V::Null
            } else {
                let n = if matches!(stop, V::Undef) {
                    0.0
                } else {
                    let (s0, s1, st) = (super::kit::num(&start), super::kit::num(&stop), super::kit::num(&step));
                    if st == 0.0 {
                        if crate::excel_functions::strict_equals(&start, &stop) {
                            1.0
                        } else {
                            f64::INFINITY
                        }
                    } else {
                        let n = ((s1 - s0) / st + 1e-9).floor() + 1.0;
                        if n > 0.0 {
                            n
                        } else {
                            0.0
                        }
                    }
                };
                if !n.is_finite() {
                    err(ErrorCode::Domain, "Step is 0 (or signed away from Stop), so the range never ends")
                } else if n > MAX_GENERATED {
                    err(
                        ErrorCode::Overflow,
                        format!(
                            "Range of {} elements exceeds the {} element limit",
                            number_to_string(round_half_up(n)),
                            number_to_string(MAX_GENERATED)
                        ),
                    )
                } else {
                    core_call("RANGE", &[start, stop, step])
                }
            }
        }
        "sequence" => {
            let rows = required(c, "count");
            let cols = or(setting(c, "cols"), V::Num(1.0));
            let start = or(setting(c, "start"), V::Num(1.0));
            let step = or(setting(c, "step"), V::Num(1.0));
            if rows.is_sol_error() {
                rows
            } else {
                core_call("SEQUENCE", &[rows, cols, start, step])
            }
        }
        "linspace" | "geometric" => {
            let start = required(c, "start");
            let (key, name, fname) =
                if op == "linspace" { ("end", "Linspace", "LINSPACE") } else { ("ratio", "Geometric", "GEOMETRIC") };
            let other = c.read(key);
            let n = required(c, "count");
            if let Some(e) = first_error(&[&start, &n]) {
                e
            } else if matches!(other, V::Null) {
                V::Null
            } else if rounded(&n) > MAX_GENERATED {
                over_limit(&format!("{name} count"), rounded(&n))
            } else if finite(&n) {
                core_call(fname, &[start, other, n])
            } else {
                empty()
            }
        }
        "fibonacci" => {
            let n = required(c, "count");
            if n.is_sol_error() {
                n
            } else {
                core_call("FIBONACCI", &[n])
            }
        }
        _ => {
            let v = c.read("value");
            let n = required(c, "count");
            if n.is_sol_error() {
                n
            } else if matches!(v, V::Null) {
                V::Null
            } else if rounded(&n) > MAX_GENERATED {
                over_limit("Repeat count", rounded(&n))
            } else if finite(&n) {
                core_call("REPEAT", &[v, n])
            } else {
                empty()
            }
        }
    };
    c.show("cachedList", result.clone());
    // The rank the output socket follows; an error, a blank or an empty list says nothing about shape.
    if let V::List(items) = &result
        && let Some(first) = items.first()
    {
        c.show("lastRank", V::Num(if matches!(first, V::List(_)) { 2.0 } else { 1.0 }));
    }
    Ok(vec![("list".into(), Cv::from(result))])
}

fn list_length(c: &mut Call) -> Answer {
    let arr = slot(c, "list");
    // A single value is one item, as Excel's ROWS counts it; a blank or empty text is none.
    let result = match &arr {
        V::List(l) => V::Num(l.len() as f64),
        v if nullish(v) || matches!(v, V::Str(s) if s.is_empty()) => V::Null,
        _ => V::Num(1.0),
    };
    shown(c, "cachedResult", "result", result)
}

fn sort(c: &mut Call) -> Answer {
    let raw = slot(c, "list");
    if nullish(&raw) {
        return shown(c, "cachedList", "result", V::Null);
    }
    let key_slots: Vec<String> = c.sockets.iter().map(|s| s.key.clone()).filter(|k| k.starts_with("key")).collect();
    let order = c.field("keyOrder").cloned();
    let mut args = vec![raw.clone()];
    for k in &key_slots {
        let Some([key, ..]) = c.wired(k) else { continue };
        if nullish(key) {
            return shown(c, "cachedList", "result", V::Null);
        }
        let desc = order.as_ref().and_then(|o| o.get(&k[3..])).and_then(|v| v.as_str()) == Some("desc");
        args.push(key.clone());
        args.push(V::Num(if desc { -1.0 } else { 1.0 }));
    }
    let result = if key_slots.is_empty() {
        let index = or(setting(c, "index"), V::Num(1.0));
        let desc = c.field_str("order", "asc") == "desc";
        let by_col = c.field("byCol").and_then(|v| v.as_bool()).unwrap_or(false);
        core_call("SORT", &[raw, index, V::Num(if desc { -1.0 } else { 1.0 }), V::Bool(by_col)])
    } else {
        core_call("SORTBY", &args)
    };
    shown(c, "cachedList", "result", result)
}

fn reverse(c: &mut Call) -> Answer {
    let r = if c.field_str("mode", "list") == "grid" {
        let across = c.field("byCol").and_then(|v| v.as_bool()).unwrap_or(false);
        core_call("REVERSE", &[list_in(c, "grid"), V::Bool(across)])
    } else {
        core_call("REVERSE", &[list_in(c, "list")])
    };
    shown(c, "cachedList", "result", r)
}

fn shift(c: &mut Call) -> Answer {
    let by = or(setting(c, "by"), V::Num(1.0));
    let wrap = c.field_str("wrap", "blank") == "wrap";
    let r = core_call("SHIFT", &[list_in(c, "list"), by, V::Bool(wrap)]);
    shown(c, "cachedList", "result", r)
}

fn bin(c: &mut Call) -> Answer {
    let arr = list_in(c, "list");
    let r = if c.field_str("mode", "breaks") == "quantiles" {
        match c.read("n") {
            V::Null => empty(),
            n => core_call("NTILE", &[arr, n]),
        }
    } else {
        core_call("BIN", &[arr, list_in(c, "breaks")])
    };
    shown(c, "cachedList", "result", r)
}

fn combinations(c: &mut Call) -> Answer {
    let arr = list_in(c, "list");
    let k = required(c, "k");
    let r = if k.is_sol_error() {
        k
    } else if length(&arr) == Some(0) {
        V::Null
    } else {
        core_call(
            if c.field_str("mode", "combinations") == "permutations" { "PERMUTATIONS" } else { "COMBINATIONS" },
            &[arr, k],
        )
    };
    shown(c, "cachedResult", "result", r)
}

fn ewma(c: &mut Call) -> Answer {
    let arr = list_in(c, "list");
    let alpha = required(c, "alpha");
    let r = if alpha.is_sol_error() { alpha } else { core_call("EWMA", &[arr, alpha]) };
    shown(c, "cachedList", "result", r)
}

fn two_lists(c: &mut Call, name: &str) -> Answer {
    let r = core_call(name, &[list_in(c, "a"), list_in(c, "b")]);
    shown(c, "cachedList", "result", r)
}

fn polyfit(c: &mut Call) -> Answer {
    let degree = required(c, "degree");
    let r =
        if degree.is_sol_error() { degree } else { core_call("POLYFIT", &[list_in(c, "x"), list_in(c, "y"), degree]) };
    shown(c, "cachedList", "result", r)
}

fn trapz(c: &mut Call) -> Answer {
    let dx = or(setting(c, "dx"), V::Num(1.0));
    let r = if c.field_str("mode", "list") == "grid" {
        let dy = or(setting(c, "dy"), V::Num(1.0));
        core_call("TRAPZ", &[list_in(c, "grid"), dx, dy])
    } else {
        core_call("TRAPZ", &[list_in(c, "list"), dx])
    };
    shown(c, "cachedResult", "result", r)
}

fn rle(c: &mut Call) -> Answer {
    let arr = list_in(c, "list");
    let r = if length(&arr) == Some(0) { V::Null } else { core_call("RLE", &[arr]) };
    shown(c, "cachedResult", "result", r)
}

fn slice(c: &mut Call) -> Answer {
    let arr = list_in(c, "list");
    let start = required(c, "start");
    let end = setting(c, "end");
    if start.is_sol_error() {
        c.show("cachedList", V::Null);
        return Ok(vec![("result".into(), Cv::from(start))]);
    }
    let r = core_call("SLICE", &[arr, start, end]);
    shown(c, "cachedList", "result", r)
}

fn unique(c: &mut Call) -> Answer {
    let raw = slot(c, "list");
    if nullish(&raw) {
        return shown(c, "cachedList", "result", V::Null);
    }
    let flag = |k: &str| V::Bool(c.field(k).and_then(|v| v.as_bool()).unwrap_or(false));
    let r = core_call("UNIQUE", &[raw, flag("byCol"), flag("exactlyOnce")]);
    shown(c, "cachedList", "result", r)
}

/// Each unit cell as the magnitude it reads in its display unit.
pub(crate) fn strip_unit_cells(v: &V) -> V {
    match v {
        V::Unit(u) => V::Num(crate::unit_expression::display_magnitude_of(u)),
        V::List(items) => list(items.iter().map(strip_unit_cells).collect()),
        other => other.clone(),
    }
}

fn sets(c: &mut Call) -> Answer {
    let op = c.field_str("op", "difference").to_string();
    let fx = match op.as_str() {
        "union" => "SETUNION",
        "intersect" => "SETINTERSECT",
        "symdiff" => "SETSYMDIFF",
        "equal" => "SETEQUAL",
        "subset" => "SETSUBSET",
        "superset" => "SETSUPERSET",
        "disjoint" => "SETDISJOINT",
        _ => "SETDIFFERENCE",
    };
    if matches!(op.as_str(), "equal" | "subset" | "superset" | "disjoint") {
        let (a, b) = (slot(c, "a"), slot(c, "b"));
        if matches!(a, V::Undef) && matches!(b, V::Undef) {
            return shown(c, "cachedRelation", "result", V::Null);
        }
        let r = core_call(fx, &[or(a, empty()), or(b, empty())]);
        return shown(c, "cachedRelation", "result", r);
    }
    if let Some(other) = c.mixes_dates(&["a", "b"]) {
        return shown(c, "cachedList", "result", crate::date_values::mixed(other));
    }
    let a = strip_unit_cells(&list_in(c, "a"));
    let b = strip_unit_cells(&list_in(c, "b"));
    let r = core_call(fx, &[a, b]);
    shown(c, "cachedList", "result", r)
}

fn concat_lists(c: &mut Call) -> Answer {
    let keys: Vec<String> = c.sockets.iter().filter(|s| s.key.starts_with('l')).map(|s| s.key.clone()).collect();
    if let Some(other) = c.mixes_dates(&keys.iter().map(String::as_str).collect::<Vec<_>>()) {
        return shown(c, "cachedList", "result", crate::date_values::mixed(other));
    }
    let args: Vec<V> =
        c.sockets.iter().filter(|s| s.key.starts_with('l')).map(|s| or(slot(c, &s.key), V::Null)).collect();
    let r = core_call("CONCATLISTS", &args);
    shown(c, "cachedList", "result", r)
}

fn running(c: &mut Call) -> Answer {
    let arr = list_in(c, "list");
    let w = or(setting(c, "window"), V::Num(0.0));
    if !matches!(w, V::Num(n) if n.is_finite() && n >= 0.0) {
        c.show("cachedList", empty());
        return Ok(vec![(
            "result".into(),
            Cv::V(err(ErrorCode::Domain, "Window must be 0 (cumulative) or a positive count")),
        )]);
    }
    let label = match c.field_str("agg", "sum") {
        "avg" => "AVERAGE",
        "min" => "MIN",
        "max" => "MAX",
        "median" => "MEDIAN",
        "product" => "PRODUCT",
        "stdev" => "STDEV",
        _ => "SUM",
    };
    let r = core_call("RUNNING", &[V::Str(label.into()), arr, w]);
    c.show("cachedList", if r.is_sol_error() { empty() } else { r.clone() });
    Ok(vec![("result".into(), Cv::from(r))])
}

fn diff(c: &mut Call) -> Answer {
    let name = match c.field_str("op", "delta") {
        "percent" => "PCTCHANGE",
        "gradient" => "GRADIENT",
        "laplacian" => "LAPLACIAN",
        _ => "DIFF",
    };
    let r = if name == "LAPLACIAN" {
        let grid = c.field_str("mode", "list") == "grid";
        let r = core_call(name, &[list_in(c, if grid { "grid" } else { "list" })]);
        if grid
            && matches!(r, V::List(_))
            && let Some(u) = c.matrix_unit("grid").cloned()
        {
            c.set_matrix_unit("result", u);
        }
        r
    } else if c.field_str("mode", "list") == "grid" {
        let across = c.field("byCol").and_then(|v| v.as_bool()).unwrap_or(false);
        let r = core_call(name, &[list_in(c, "grid"), V::Bool(across)]);
        // A change or a slope is in the grid's unit; a percent change is a plain ratio.
        if name != "PCTCHANGE"
            && matches!(r, V::List(_))
            && let Some(u) = c.matrix_unit("grid").cloned()
        {
            c.set_matrix_unit("result", u);
        }
        r
    } else {
        core_call(name, &[list_in(c, "list")])
    };
    shown(c, "cachedList", "result", r)
}

fn arg_min_max(c: &mut Call) -> Answer {
    let arr = slot(c, "list");
    let op = c.field_str("op", "argmax").to_string();
    let r = if nullish(&arr) {
        V::Null
    } else if op == "argsort" || op == "argsort_desc" {
        core_call("ARGSORT", &[arr, V::Bool(op == "argsort_desc")])
    } else {
        core_call(&op.to_uppercase(), &[arr])
    };
    shown(c, "cachedResult", "result", r)
}

fn contains(c: &mut Call) -> Answer {
    let arr = slot(c, "list");
    let v = c.read("value");
    let r = if nullish(&arr) || nullish(&v) { V::Null } else { core_call("CONTAINS", &[arr, v]) };
    shown(c, "cachedResult", "result", r)
}

fn normalize(c: &mut Call) -> Answer {
    let name = if c.field_str("mode", "minmax") == "zscore" { "ZSCORE" } else { "NORMALIZE" };
    let r = core_call(name, &[list_in(c, "list")]);
    shown(c, "cachedList", "result", r)
}

fn nth_element(c: &mut Call) -> Answer {
    let arr = list_in(c, "list");
    let n = required(c, "n");
    if n.is_sol_error() {
        c.show("cachedList", V::Null);
        return Ok(vec![("result".into(), Cv::from(n))]);
    }
    let r = core_call("NTHELEMENT", &[arr, n]);
    shown(c, "cachedList", "result", r)
}

fn interleave(c: &mut Call) -> Answer {
    if let Some(other) = c.mixes_dates(&["a", "b"]) {
        return shown(c, "cachedList", "result", crate::date_values::mixed(other));
    }
    let r = core_call("INTERLEAVE", &[list_in(c, "a"), list_in(c, "b")]);
    shown(c, "cachedList", "result", r)
}

fn pad(c: &mut Call) -> Answer {
    let arr = list_in(c, "list");
    let n = required(c, "n");
    let fill = c.read("fill");
    if n.is_sol_error() {
        c.show("cachedList", V::Null);
        return Ok(vec![("result".into(), Cv::from(n))]);
    }
    if matches!(fill, V::Null) {
        return shown(c, "cachedList", "result", V::Null);
    }
    let name = if c.field_str("op", "right") == "left" { "PADLEFT" } else { "PADRIGHT" };
    let r = if rounded(&n) > MAX_GENERATED {
        over_limit("Pad length", rounded(&n))
    } else {
        core_call(name, &[arr, n, fill])
    };
    shown(c, "cachedList", "result", r)
}

/// Whether anything is wired or typed: not blank, nor empty text. A zero or a FALSE is a value.
pub(crate) fn present(v: &V) -> bool {
    !super::stats::blank(v)
}

fn weighted(c: &mut Call) -> Answer {
    let (values, weights) = (slot(c, "values"), slot(c, "weights"));
    let name = match c.field_str("op", "wavg") {
        "wvar" => "WVAR",
        "wstdev" => "WSTDEV",
        _ => "WAVG",
    };
    let r = if present(&values) && present(&weights) { core_call(name, &[values, weights]) } else { V::Null };
    shown(c, "cachedResult", "result", r)
}

fn fill(c: &mut Call) -> Answer {
    let arr = slot(c, "list");
    if !present(&arr) {
        return shown(c, "cachedList", "result", empty());
    }
    let constant = c.read("value");
    let is_else = |k: &str| k.len() > 1 && k.starts_with('e') && k[1..].bytes().all(|b| b.is_ascii_digit());
    let fallbacks: Vec<V> = c
        .sockets
        .iter()
        .map(|s| s.key.as_str())
        .filter(|k| is_else(k))
        .map(|k| match slot(c, k) {
            w @ V::List(_) => w,
            _ if c.wired(k).is_some() => V::Null,
            _ => match c.unwired(k) {
                n @ V::Num(_) => n,
                _ => V::Null,
            },
        })
        .collect();
    let op = c.field_str("op", "constant").to_string();
    let fx = match op.as_str() {
        "ffill" => "FILLFORWARD",
        "bfill" => "FILLBACKWARD",
        "mean" => "FILLMEAN",
        "median" => "FILLMEDIAN",
        "mode" => "FILLMODE",
        "interpolate" => "FILLINTERPOLATE",
        "drop" => "FILLDROP",
        "coalesce" => "COALESCE",
        _ => "FILLVALUE",
    };
    let args = match op.as_str() {
        "constant" => vec![arr, constant],
        "coalesce" => std::iter::once(arr).chain(fallbacks).collect(),
        _ => vec![arr],
    };
    let r = core_call(fx, &args);
    shown(c, "cachedList", "result", r)
}

fn spectrum(c: &mut Call) -> Answer {
    let arr = list_in(c, "list");
    let rate = read_role(c, "rate", &Role::Setting(V::Num(1.0)));
    let r = if length(&arr) == Some(0) { V::Null } else { core_call("SPECTRUM", &[arr, rate]) };
    shown(c, "cachedResult", "result", r)
}

fn connected_regions(c: &mut Call) -> Answer {
    let grid = slot(c, "grid");
    let diagonal = c.field("diagonal").and_then(serde_json::Value::as_bool).unwrap_or(false);
    let r = if nullish(&grid) { V::Null } else { core_call("CONNECTEDREGIONS", &[grid, V::Bool(diagonal)]) };
    shown(c, "cachedResult", "result", r)
}

/// A list's one unit, and its items as base magnitudes: `None` for a list with no unit, `Err` where its items don't
/// share a dimension (or mix a unit with plain numbers).
fn uniform_unit(arr: &V) -> Result<Option<(V, Dim, UnitCell)>, V> {
    let V::List(items) = arr else { return Ok(None) };
    let Some(first) = items.iter().find_map(|v| if let V::Unit(u) = v { Some((**u).clone()) } else { None }) else {
        return Ok(None);
    };
    let mut mags = Vec::with_capacity(items.len());
    for v in items.iter() {
        match v {
            V::Unit(u) if dim_equal(&u.dim, &first.dim) => mags.push(V::Num(u.value)),
            V::Null | V::Undef => mags.push(V::Null),
            e if e.is_sol_error() => mags.push(e.clone()),
            _ => return Err(err(ErrorCode::Unit, "Smooth needs every item of the list in one kind of unit")),
        }
    }
    Ok(Some((list(mags), first.dim.clone(), first)))
}

fn smooth(c: &mut Call) -> Answer {
    let grid = c.field_str("mode", "list") == "grid";
    let mut arr = slot(c, if grid { "grid" } else { "list" });
    let op = c.field_str("op", "savgol").to_string();
    // A list carries its unit on each item ([[unit-flow#One idea, a carrier per rank]]): every op is a weighted
    // average with weights summing to 1, so it smooths the base magnitudes and the answer wears the list's unit.
    let unit = if grid {
        None
    } else {
        match uniform_unit(&arr) {
            Ok(u) => u,
            Err(e) => {
                c.show("cachedList", empty());
                return Ok(vec![("result".into(), Cv::from(e))]);
            }
        }
    };
    if let Some((mags, _, _)) = &unit {
        arr = mags.clone();
    }
    let out = if nullish(&arr) {
        V::Null
    } else if grid && (op == "savgol" || op == "lowess") {
        err(ErrorCode::Value, "Savitzky–Golay and LOWESS smooth a list; a grid takes Gaussian, Mean or Median")
    } else if op == "savgol" {
        let (w, o) = (or(setting(c, "window"), V::Num(5.0)), or(setting(c, "order"), V::Num(2.0)));
        core_call("SAVGOL", &[arr, w, o])
    } else if op == "lowess" {
        let f = or(setting(c, "frac"), V::Num(0.67));
        core_call("LOWESS", &[arr, f])
    } else if op == "mean" || op == "median" {
        let size = or(setting(c, "size"), V::Num(3.0));
        core_call(if op == "mean" { "MEANSMOOTH" } else { "MEDIANSMOOTH" }, &[arr, size])
    } else {
        let s = or(setting(c, "sigma"), V::Num(1.0));
        core_call("GAUSSIANSMOOTH", &[arr, s])
    };
    if out.is_sol_error() && op != "lowess" {
        c.show("cachedList", empty());
        return Ok(vec![("result".into(), Cv::from(out))]);
    }
    let out = match (&unit, out) {
        (Some((_, dim, first)), V::List(items)) => list(
            items
                .iter()
                .map(|v| if let V::Num(n) = v { tag(*n, dim.clone(), Some(first)) } else { v.clone() })
                .collect(),
        ),
        (_, out) => out,
    };
    // A smoothed grid is in the grid's unit, as Interpolate's filled one is.
    if grid
        && matches!(out, V::List(_))
        && let Some(u) = c.matrix_unit("grid").cloned()
    {
        c.set_matrix_unit("result", u);
    }
    c.show("cachedList", or(out.clone(), empty()));
    Ok(vec![("result".into(), Cv::from(out))])
}

fn convolve(c: &mut Call) -> Answer {
    let shape = V::str(c.field_str("form", "full"));
    let r = core_call("CONVOLVE", &[list_in(c, "a"), list_in(c, "b"), shape]);
    shown(c, "cachedList", "result", r)
}

/// A typed row's items, trimmed, the empty ones dropped.
pub(crate) fn literal_items(csv: &str) -> Vec<String> {
    csv_line(csv).into_iter().map(|s| trim_space(&s).to_string()).filter(|s| !s.is_empty()).collect()
}

/// A List Input row's items, trimmed: a gap between commas is a blank item that holds its place ([[C24]]
/// arraySemantics), and a trailing comma adds nothing.
fn list_row_items(csv: &str) -> Vec<String> {
    let mut items: Vec<String> = csv_line(csv).into_iter().map(|s| trim_space(&s).to_string()).collect();
    while items.last().is_some_and(String::is_empty) {
        items.pop();
    }
    items
}

/// The first CSV row of the text (comma-delimited, blank rows skipped), or one empty
/// field.
fn csv_line(text: &str) -> Vec<String> {
    crate::csv::parse_rows(text, crate::csv::CsvOptions::default())
        .into_iter()
        .next()
        .unwrap_or_else(|| vec![String::new()])
}

/// Every CSV row of the text, blank lines kept.
pub(crate) fn csv_rows(text: &str) -> Vec<Vec<String>> {
    crate::csv::parse_rows(text, crate::csv::CsvOptions { detect_delimiter: false, keep_blank_lines: true })
}

/// A logical reading as a cell: a boolean, blank, or NaN.
fn logical_cell(v: &FrameCell) -> V {
    match crate::value_kinds::coerce_logical(v) {
        Logical::Bool(b) => V::Bool(b),
        Logical::Blank => V::Null,
        Logical::Unreadable => V::Num(f64::NAN),
    }
}

/// Typed text read as a cell of the list's type ([[C58]] tableInputRawText).
pub(crate) fn frame_cell_of(ty: &str, raw: &str) -> V {
    frame_cell_ordered(ty, raw, crate::excel_criteria::DateOrder::Auto)
}

/// A cell's text read as `ty`, a date under `order` (which number is the month in `1/2/26`).
pub(crate) fn frame_cell_ordered(ty: &str, raw: &str, order: crate::excel_criteria::DateOrder) -> V {
    if ty == "string" {
        return if raw.is_empty() { V::Null } else { V::str(raw) };
    }
    let s = trim_space(raw);
    if s.is_empty() {
        return V::Null;
    }
    if ty == "logical" {
        return logical_cell(&FrameCell::str(s));
    }
    let n = crate::value_kinds::decimal_from_text(s);
    if n.is_finite() {
        return V::Num(n);
    }
    if ty == "date" {
        return match crate::excel_criteria::read_date_text(s, order) {
            DateReading::Serial(r) if r.is_finite() => V::Num(r),
            DateReading::Ambiguous(e) => V::err(e),
            _ => V::Num(f64::NAN),
        };
    }
    V::Num(f64::NAN)
}

/// Keyed text read as a value of the kind its slot shows: blank is `undefined`, a date its day, and text the kind
/// can't read `#TYPE!` naming it, never a guess at another kind ([[C10]] socketLattice).
pub fn keyed_value(kind: &str, text: &str) -> V {
    match frame_cell_of(kind, text) {
        V::Null => V::Undef,
        V::Num(n) if n.is_nan() => {
            let name = match kind {
                "date" => "date",
                "logical" => "logical",
                _ => "number",
            };
            V::err(crate::error_value::sol_error(
                crate::error_value::ErrorCode::Type,
                format!("\"{text}\" doesn't read as a {name}. Key in a {name}, or switch the slot's kind"),
            ))
        }
        V::Num(n) if kind == "date" => V::Date(n),
        v => v,
    }
}

/// A wired item read as the list's type; converts, never filters.
pub(crate) fn list_item_of(ty: &str, v: &V) -> V {
    if let V::Str(s) = v
        && ty != "string"
    {
        return frame_cell_of(ty, s);
    }
    match ty {
        "number" => match v {
            V::Num(n) if n.is_finite() => v.clone(),
            V::Bool(b) => V::Num(if *b { 1.0 } else { 0.0 }),
            _ => V::Null,
        },
        "date" => match v {
            V::Num(n) | V::Date(n) if n.is_finite() => V::Date(*n),
            _ => V::Null,
        },
        "string" => match v {
            V::Str(_) => v.clone(),
            V::Num(_) | V::Bool(_) => V::str(&value_text(v)),
            _ => V::Null,
        },
        _ => match v {
            V::Undef | V::Null => V::Null,
            V::Bool(_) => v.clone(),
            V::Num(n) if n.is_finite() => V::Bool(*n != 0.0),
            _ => V::Num(f64::NAN),
        },
    }
}

fn list_input(c: &mut Call) -> Answer {
    let ty = c.field_str("dataType", "number").to_string();
    let (mut items, mut source) = (Vec::new(), Vec::new());
    let keys: Vec<String> = c.sockets.iter().map(|s| s.key.clone()).collect();
    for key in &keys {
        match c.wired(key) {
            Some([first, ..]) => {
                let arr = match first {
                    V::List(l) => l.as_ref().clone(),
                    V::Undef => vec![V::Null],
                    other => vec![other.clone()],
                };
                for v in arr {
                    items.push(if matches!(v, V::Null) || v.is_sol_error() { v } else { list_item_of(&ty, &v) });
                    source.push(V::Null);
                }
            }
            _ => {
                let text = c.csv_text(key).unwrap_or("").to_string();
                for t in list_row_items(&text) {
                    let item = frame_cell_of(&ty, &t);
                    // A date list's items are dates ([[D114]] dateIsAKind).
                    items.push(match item {
                        V::Num(n) if ty == "date" && n.is_finite() => V::Date(n),
                        other => other,
                    });
                    source.push(V::str(&t));
                }
            }
        }
    }
    let result = list(items);
    c.show("cachedList", result.clone());
    c.show("cachedSource", list(source));
    Ok(vec![("list".into(), Cv::from(result))])
}

/// The type of the first item that has one.
fn elem_col_type(arr: &[V]) -> FrameColType {
    for v in arr {
        match v {
            V::Date(_) => return FrameColType::Date,
            V::Str(_) => return FrameColType::String,
            V::Bool(_) => return FrameColType::Logical,
            V::Num(_) => return FrameColType::Number,
            _ => {}
        }
    }
    FrameColType::Number
}

/// A value as the filter's predicates read a cell.
fn as_cell(v: &V) -> FrameCell {
    FrameCell::of_scalar(v).unwrap_or_else(|| FrameCell::str(&value_text(v)))
}

/// A wired value as text (an error as its code), a blank as no condition.
fn condition_value(c: &Call, key: &str) -> FrameCell {
    let raw = match c.wired(key) {
        None | Some([]) => match c.unwired(key) {
            V::Undef | V::Null => V::str(""),
            v => v,
        },
        Some([first, ..]) => first.clone(),
    };
    crate::frame_verbs::filter_cell(&raw)
}

/// What a wired value says of the sockets a card shows for it: a JavaScript array of rows, an array of anything else,
/// or no array at all; a blank, an error or an empty list says nothing.
#[derive(PartialEq)]
enum Arrives {
    Rows,
    Flat,
    NoList,
}

fn arrives(v: &Cv) -> Option<Arrives> {
    let first_is = |rows: bool| Some(if rows { Arrives::Rows } else { Arrives::Flat });
    match v {
        Cv::V(V::Undef | V::Null | V::Err(_)) => None,
        Cv::V(V::List(items)) => first_is(matches!(items.first()?, V::List(_))),
        Cv::Cells(items) => first_is(matches!(items.first()?, Cv::V(V::List(_)))),
        Cv::Json(j) => match j.as_ref() {
            serde_json::Value::Array(a) => first_is(a.first()?.is_array()),
            _ => Some(Arrives::NoList),
        },
        _ => Some(Arrives::NoList),
    }
}

fn filter(c: &mut Call) -> Answer {
    // The Column socket shows while a table is wired; `columnMove` says which way it goes, for `coreWatched`.
    let has_column = c.sockets.iter().any(|s| s.key == "column");
    match arrives(&c.raw_card("list")).map(|a| a == Arrives::Rows) {
        Some(true) if !has_column => c.show("columnMove", V::str("add")),
        Some(false) if has_column => c.show("columnMove", V::str("drop")),
        _ => c.show("columnMove", V::Null),
    }
    let raw = slot(c, "list");
    let done = |c: &mut Call, result: V, dropped: V| {
        c.show("cachedResult", result.clone());
        c.show("cachedDropped", dropped.clone());
        Ok(vec![("result".into(), Cv::from(result)), ("dropped".into(), Cv::from(dropped))])
    };
    if nullish(&raw) {
        return done(c, V::Null, V::Null);
    }
    let (m, is_list) = match &raw {
        V::List(rows) if matches!(rows.first(), Some(V::List(_))) => (rows.as_ref().clone(), false),
        V::List(_) => (vec![raw.clone()], true),
        other => (vec![list(vec![other.clone()])], true),
    };
    let row_cells = |r: &V| if let V::List(cells) = r { cells.as_ref().clone() } else { Vec::new() };
    let arr: Vec<V> = if is_list {
        row_cells(&m[0])
    } else {
        let col = if c.sockets.iter().any(|s| s.key == "column") {
            read_role(c, "column", &Role::Setting(V::Num(1.0)))
        } else {
            V::Num(1.0)
        };
        let width = length(&m[0]).unwrap_or(0);
        match col {
            V::Num(n) if n.fract() == 0.0 && n >= 1.0 && n <= width as f64 => {
                let j = n as usize - 1;
                m.iter()
                    .map(|r| if let V::List(cells) = r { cells.get(j).cloned().unwrap_or(V::Undef) } else { V::Undef })
                    .collect()
            }
            other => {
                let e = err(
                    ErrorCode::Value,
                    format!("Column {} is outside the table's {width} columns", value_text(&other)),
                );
                return done(c, e, V::Null);
            }
        }
    };
    let mags: Vec<V> = arr.iter().map(strip_unit_cells).collect();
    let ty = elem_col_type(&mags);
    let config = c.field("condConfig").cloned();
    let mut conds: Vec<(FilterOp, FrameCell, bool)> = Vec::new();
    for key in c.sockets.iter().map(|s| &s.key).filter(|k| k.starts_with("value")) {
        let cfg = config.as_ref().and_then(|o| o.get(&key[5..]));
        let spelled = cfg.and_then(|o| o.get("op")).and_then(|v| v.as_str()).unwrap_or("gt");
        let op: FilterOp =
            spelled.parse().map_err(|_| err(ErrorCode::Value, format!("Unknown filter condition \"{spelled}\"")))?;
        let value = condition_value(c, key);
        let blank = match &value {
            FrameCell::Null => true,
            FrameCell::Str(s) => trim_space(s).is_empty(),
            _ => false,
        };
        if !op.is_valueless() && blank {
            continue;
        }
        let match_case = cfg.and_then(|o| o.get("matchCase")).and_then(|v| v.as_bool()).unwrap_or(false);
        conds.push((op, value, match_case));
    }
    if conds.is_empty() {
        let kept = if is_list { list(arr) } else { list(m.iter().map(|r| list(row_cells(r))).collect()) };
        return done(c, kept, V::Null);
    }
    if !mags.iter().any(|v| matches!(v, V::Str(_))) {
        let other = mags.iter().find(|v| !nullish(v) && !v.is_sol_error() && !matches!(v, V::Str(_)));
        let gate = match other {
            None => FrameColType::String,
            Some(v) => elem_col_type(std::slice::from_ref(v)),
        };
        if let Some(label) =
            conds.iter().find_map(|(op, _, _)| op.text_label()).filter(|_| gate != FrameColType::String)
        {
            return Err(err(
                ErrorCode::Type,
                format!("{label} reads text — this is a {} list. Cast it to Text first", gate.as_str()),
            ));
        }
    }
    let first_text = conds.iter().find_map(|(op, _, _)| op.text_label());
    let values: Vec<FrameCell> = conds.iter().map(|(_, v, _)| v.clone()).collect();
    let mut preds = Vec::with_capacity(conds.len());
    for (k, (op, _, match_case)) in conds.iter().enumerate() {
        preds.push(crate::frame_verbs::compile_filter(*op, &values[k], ty, *match_case).map_err(V::err)?);
    }
    let any = c.field_str("combine", "and") != "and";
    let (mut kept, mut dropped) = (Vec::new(), Vec::new());
    for (i, mag) in mags.iter().enumerate() {
        if let Some(label) = first_text
            && !nullish(mag)
            && !mag.is_sol_error()
            && !matches!(mag, V::Str(_))
        {
            let what = elem_col_type(std::slice::from_ref(mag)).as_str();
            kept.push(err(
                ErrorCode::Type,
                format!("{label} reads text; this item is a {what}. Cast it to Text first"),
            ));
            continue;
        }
        let cell = as_cell(mag);
        let mut pass = !any;
        for p in preds.iter_mut() {
            if p(&cell).map_err(V::err)? == any {
                pass = any;
                break;
            }
        }
        let item = if is_list { arr[i].clone() } else { list(row_cells(&m[i])) };
        if pass {
            kept.push(item)
        } else {
            dropped.push(item)
        }
    }
    done(c, list(kept), list(dropped))
}

/// A unit cell keys by its base magnitude and dimension, anything else as itself.
#[derive(Hash, PartialEq, Eq)]
enum MemberKey {
    Plain(crate::fns_matrix::Key),
    Unit(String),
}

fn member_key(v: &V) -> MemberKey {
    match v {
        V::Unit(u) => MemberKey::Unit(crate::unit_lists::unit_set_key(u)),
        other => MemberKey::Plain(crate::fns_matrix::set_key(other)),
    }
}

fn items(v: &V) -> Vec<V> {
    match v {
        V::List(l) => l.as_ref().clone(),
        _ => Vec::new(),
    }
}

fn is_in(c: &mut Call) -> Answer {
    let (a, b) = (items(&list_in(c, "a")), items(&list_in(c, "b")));
    let members: std::collections::HashSet<MemberKey> =
        b.iter().filter(|v| !matches!(v, V::Null) && !v.is_sol_error()).map(member_key).collect();
    let r = list(
        a.iter()
            .map(|v| match v {
                V::Null => V::Null,
                e if e.is_sol_error() => e.clone(),
                v => V::Bool(members.contains(&member_key(v))),
            })
            .collect(),
    );
    shown(c, "cachedList", "result", r)
}

/// The dimension an op's answer has over values of `dim`.
fn aggregate_dim(op: &str, dim: &Dim, n: usize) -> Dim {
    if is_dimensionless(dim) {
        return Dim::new();
    }
    match op {
        "sum" | "avg" | "min" | "max" | "median" | "geomean" | "harmean" | "stdev" | "stdev_p" | "avedev" | "ptp"
        | "iqr" | "mad" | "sem" | "rms" => dim.clone(),
        "var_s" | "var_p" | "devsq" | "sumsq" => dim_pow(dim, 2.0),
        "product" => dim_pow(dim, n as f64),
        _ => Dim::new(),
    }
}

/// `excel_functions::aggregate` for the ops whose formula reads a list differently.
fn aggregate_plain(op: &str, arr: &[f64]) -> V {
    let cell = |c: FrameCell| match c {
        FrameCell::Num(n) => V::Num(n),
        FrameCell::Err(e) => V::Err(e),
        _ => V::Null,
    };
    let counting = op == "count" || op == "countdistinct";
    if !counting && arr.iter().any(|v| v.is_nan()) {
        return cell(guard_cells(f64::NAN, arr));
    }
    let r = if arr.is_empty() {
        match op {
            "sum" | "count" => 0.0,
            "product" => 1.0,
            _ => return V::Null,
        }
    } else {
        match op {
            "sum" => arr.iter().fold(0.0, |a, b| a + b),
            "min" => arr.iter().fold(f64::INFINITY, |m, &v| if v < m { v } else { m }),
            "max" => arr.iter().fold(f64::NEG_INFINITY, |m, &v| if v > m { v } else { m }),
            "count" => arr.len() as f64,
            "countdistinct" => {
                let mut seen = std::collections::HashSet::new();
                for v in arr {
                    seen.insert(if v.is_nan() { f64::NAN.to_bits() } else { (v + 0.0).to_bits() });
                }
                seen.len() as f64
            }
            "product" => arr.iter().fold(1.0, |a, b| a * b),
            "sumsq" => arr.iter().fold(0.0, |a, b| a + b * b),
            _ => return V::Null,
        }
    };
    cell(guard_cells(r, arr))
}

/// The formula an Aggregate op is ([[C17]] shareImpl), where it is one of the functions that read text their own way:
/// those that refuse it ([[D109]] aggregatesRefuseText) and COUNT, which leaves it out.
pub(crate) fn aggregate_formula(op: &str) -> Option<&'static str> {
    let name = match op {
        "sum" => "SUM",
        "avg" => "AVERAGE",
        "min" => "MIN",
        "max" => "MAX",
        "median" => "MEDIAN",
        "product" => "PRODUCT",
        "stdev" => "STDEV.S",
        "stdev_p" => "STDEV.P",
        "var_s" => "VAR.S",
        "var_p" => "VAR.P",
        "geomean" => "GEOMEAN",
        "harmean" => "HARMEAN",
        "sumsq" => "SUMSQ",
        "devsq" => "DEVSQ",
        "avedev" => "AVEDEV",
        "skew" => "SKEW",
        "skew_p" => "SKEW.P",
        "kurt" => "KURT",
        "ptp" => "PTP",
        "iqr" => "IQR",
        "mad" => "MAD",
        "sem" => "SEM",
        "cv" => "CV",
        "rms" => "RMS",
        "count" => "COUNT",
        _ => return None,
    };
    (name == "COUNT" || crate::excel_functions::refuses_text_in(name)).then_some(name)
}

/// Text that is not empty (empty text waits on the blank rulings, [[C134]] functionsFollowAlgebra).
pub(crate) fn is_text(v: &V) -> bool {
    matches!(v, V::Str(s) if !s.is_empty())
}

fn aggregate(c: &mut Call) -> Answer {
    let op = c.field_str("op", "sum").to_string();
    let mut values = items(&list_in(c, "list"));
    if op == "countblank" {
        let n = values.iter().filter(|v| matches!(v, V::Null)).count();
        return shown(c, "cachedResult", "result", V::Num(n as f64));
    }
    if let Some(e) = values.iter().find(|v| v.is_sol_error()) {
        return shown(c, "cachedResult", "result", e.clone());
    }
    // Text answers as the op's formula answers it, after any error: its error, or left out by COUNT.
    if let Some(name) = aggregate_formula(&op).filter(|_| values.iter().any(is_text)) {
        if name == "COUNT" {
            values.retain(|v| !is_text(v));
        } else if let Some(e) = crate::excel_functions::text_refusal(name, &[list(values.clone())]) {
            return shown(c, "cachedResult", "result", e);
        }
    }
    // Text or logicals among the items: distinct by value and kind, as COUNTA(UNIQUE(range)) counts them.
    if op == "countdistinct" && values.iter().any(|v| matches!(v, V::Str(_) | V::Bool(_))) {
        let mut seen = std::collections::HashSet::new();
        for v in values.iter().filter(|v| !matches!(v, V::Null)) {
            seen.insert(match v {
                V::Num(n) => format!("n{}", (n + 0.0).to_bits()),
                V::Str(s) => format!("s{s}"),
                V::Bool(b) => format!("b{b}"),
                other => format!("o{}", crate::excel_functions::value_text(other)),
            });
        }
        return shown(c, "cachedResult", "result", V::Num(seen.len() as f64));
    }
    let refs: Vec<&V> = values.iter().collect();
    let prep = match crate::unit_lists::for_aggregate_units(&refs, op != "sum") {
        Ok(p) => p,
        Err(e) => return shown(c, "cachedResult", "result", V::err(e)),
    };
    let is_affine =
        |u: &UnitCell| u.display.as_deref().is_some_and(|d| !d.is_empty()) && u.offset.is_some_and(|o| o != 0.0);
    let affine = prep.display.as_deref().is_some_and(is_affine);
    if affine && op == "sum" && values.iter().filter(|v| matches!(v, V::Unit(u) if is_affine(u))).count() > 1 {
        return shown(c, "cachedResult", "result", V::err(point_error(READINGS_ADD)));
    }
    let nums = || list(prep.nums.iter().map(|&n| V::Num(n)).collect());
    let result = match op.as_str() {
        "avg" => core_call("AVERAGE", &[nums()]),
        "stdev" => core_call("STDEV.S", &[nums()]),
        "stdev_p" => core_call("STDEV.P", &[nums()]),
        "var_s" => core_call("VAR.S", &[nums()]),
        "var_p" => core_call("VAR.P", &[nums()]),
        "skew_p" => core_call("SKEW.P", &[nums()]),
        "avedev" | "median" | "geomean" | "harmean" | "devsq" | "skew" | "kurt" | "ptp" | "iqr" | "mad" | "sem"
        | "cv" | "rms" => core_call(&op.to_uppercase(), &[nums()]),
        _ => aggregate_plain(&op, &prep.nums),
    };
    let tagged = match result {
        V::Num(r) if !is_dimensionless(&prep.dim) => {
            let rd = aggregate_dim(&op, &prep.dim, prep.nums.len());
            let delta = affine && matches!(op.as_str(), "stdev" | "stdev_p" | "avedev" | "ptp" | "iqr" | "mad" | "sem");
            let from = if dim_equal(&rd, &prep.dim) && !delta { prep.display.as_deref() } else { None };
            tag(r, rd, from)
        }
        other => other,
    };
    shown(c, "cachedResult", "result", tagged)
}

fn xmatch(c: &mut Call) -> Answer {
    let val = match c.wired("value") {
        Some([first, ..]) => first.clone(),
        _ => or(c.unwired("value"), V::Null),
    };
    if matches!(val, V::Null) {
        return shown(c, "cachedResult", "result", V::Null);
    }
    let keys = slot(c, "array");
    let wired = !nullish(&keys);
    // As XMATCH reads them, a date as its day on both sides ([[D114]] dateIsAKind).
    let (val, keys) = (crate::date_values::unwrap(&val), crate::date_values::unwrap(&keys));
    let ks = items(&keys);
    let mm = match c.field_str("matchMode", "exact") {
        "next_larger" => MatchMode::NextLarger,
        "next_smaller" => MatchMode::NextSmaller,
        _ => MatchMode::Exact,
    };
    let last = c.field_str("searchMode", "first") == "last";
    let lookups = if let V::List(vs) = &val { vs.len() } else { 1 };
    let m = Matcher::new(&ks[..], mm, last, lookups);
    let pick = |l: &V| match m.find(l) {
        Err(e) => e,
        Ok(Some(i)) => V::Num((i + 1) as f64),
        Ok(None) if wired => err(ErrorCode::NotAvailable, "No match found in the array"),
        Ok(None) => V::Null,
    };
    let r = match &val {
        V::List(vs) => list(vs.iter().map(pick).collect()),
        v => pick(v),
    };
    shown(c, "cachedResult", "result", r)
}

/// Null, undefined or whitespace text.
fn blank(v: &V) -> bool {
    match v {
        V::Null | V::Undef => true,
        V::Str(s) => trim_space(s).is_empty(),
        _ => false,
    }
}

/// A number the cell reads as, or none.
fn cell_number(v: &V) -> Option<f64> {
    match v {
        V::Num(n) => n.is_finite().then_some(*n),
        V::Unit(u) => Some(crate::unit_expression::display_magnitude_of(u)).filter(|m| m.is_finite()),
        V::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        V::Str(s) => Some(crate::value_kinds::decimal_from_text(s)).filter(|n| n.is_finite()),
        _ => None,
    }
}

/// ISO date text as its serial.
fn date_serial(v: &V) -> Option<f64> {
    let V::Str(s) = v else { return None };
    crate::csv::date_text_serial(s)
}

pub(crate) fn infer_column(name: &str, cells: &[V]) -> Column {
    let (mut column, raw) = infer_cells(name, cells);
    column.raw = Some(serde_json::Value::Array(raw.iter().map(|t| serde_json::Value::String(t.to_string())).collect()));
    column
}

/// `infer_column` with each cell's trimmed text (an error's code, blank as empty) beside the column, not in it.
pub(crate) fn infer_cells(name: &str, cells: &[V]) -> (Column, Vec<Rc<str>>) {
    // Dates make a Date column, their days packed as numbers; beside another kind, each date is #TYPE!
    // ([[D114]] dateIsAKind, [[C137]] datesNeverSerials).
    let census =
        cells.iter().fold(crate::value_kinds::Census::default(), |c, v| c.join(crate::value_kinds::Census::of(v)));
    if census.dates {
        if census.only_dates() {
            let (mut column, raw) =
                infer_cells(name, &cells.iter().map(crate::date_values::unwrap).collect::<Vec<_>>());
            column.ty = FrameColType::Date;
            return (column, raw);
        }
        let mixed = crate::date_values::column_mixed();
        let refused: Vec<V> =
            cells.iter().map(|c| if matches!(c, V::Date(_)) { mixed.clone() } else { c.clone() }).collect();
        return infer_cells(name, &refused);
    }
    let mut unit: Option<serde_json::Value> = None;
    let mags: Vec<V>;
    let cells: &[V] = if cells.iter().any(|c| matches!(c, V::Unit(_))) {
        let mut first: Option<&UnitCell> = None;
        let mut same = true;
        for c in cells {
            let V::Unit(u) = c else { continue };
            match first {
                None => first = Some(u),
                Some(f) => {
                    same &= dim_equal(&f.dim, &u.dim)
                        && f.display.as_deref().unwrap_or("") == u.display.as_deref().unwrap_or("")
                }
            }
        }
        unit = first.filter(|_| same).map(|u| {
            let dim: serde_json::Map<String, serde_json::Value> =
                u.dim.iter().map(|(k, v)| (k.clone(), serde_json::json!(v))).collect();
            let mut o = serde_json::Map::new();
            o.insert("dim".into(), serde_json::Value::Object(dim));
            if let Some(d) = &u.display {
                o.insert("display".into(), serde_json::Value::String(d.clone()));
            }
            serde_json::Value::Object(o)
        });
        mags =
            cells
                .iter()
                .map(|c| {
                    if let V::Unit(u) = c {
                        V::Num(crate::unit_expression::display_magnitude_of(u))
                    } else {
                        c.clone()
                    }
                })
                .collect();
        &mags
    } else {
        cells
    };
    let empty: Rc<str> = Rc::from("");
    let raw: Vec<Rc<str>> = cells
        .iter()
        .map(|c| match c {
            V::Err(e) => Rc::from(e.code.as_str()),
            V::Null | V::Undef => empty.clone(),
            V::Str(s) => {
                let t = trim_space(s);
                if t.is_empty() {
                    empty.clone()
                } else if t.len() == s.len() {
                    s.clone()
                } else {
                    Rc::from(t)
                }
            }
            c => Rc::from(trim_space(&value_text(c))),
        })
        .collect();
    let filled = || cells.iter().filter(|c| !blank(c) && !c.is_sol_error());
    let any_filled = filled().next().is_some();
    let read = |f: &dyn Fn(usize, &V) -> V| -> Vec<V> {
        cells
            .iter()
            .enumerate()
            .map(|(i, c)| {
                if c.is_sol_error() {
                    c.clone()
                } else if blank(c) {
                    V::Null
                } else {
                    f(i, c)
                }
            })
            .collect()
    };
    let read_all = |f: &dyn Fn(&V) -> Option<f64>| -> Option<Vec<V>> {
        if !any_filled {
            return None;
        }
        cells
            .iter()
            .map(|c| {
                if c.is_sol_error() {
                    Some(c.clone())
                } else if blank(c) {
                    Some(V::Null)
                } else {
                    f(c).map(V::Num)
                }
            })
            .collect()
    };
    let column = |ty: FrameColType, values: Vec<V>, unit: Option<serde_json::Value>| Column {
        name: name.to_string(),
        ty,
        values,
        unit,
        format: None,
        raw: None,
    };
    let typed = if any_filled && filled().all(|c| matches!(c, V::Bool(_))) {
        column(FrameColType::Logical, read(&|_, c| c.clone()), None)
    } else if let Some(values) = read_all(&cell_number) {
        column(FrameColType::Number, values, unit)
    } else if any_filled
        && filled().all(|c| match c {
            V::Bool(_) => true,
            V::Str(s) => matches!(crate::jsnum::lower_text(trim_space(s)).as_ref(), "true" | "false"),
            _ => false,
        })
    {
        column(
            FrameColType::Logical,
            read(&|i, c| {
                if let V::Bool(_) = c {
                    c.clone()
                } else {
                    V::Bool(crate::jsnum::lower_text(&raw[i]) == "true")
                }
            }),
            None,
        )
    } else if let Some(values) = read_all(&date_serial) {
        column(FrameColType::Date, values, None)
    } else {
        column(FrameColType::String, read(&|i, _| V::Str(raw[i].clone())), None)
    };
    (typed, raw)
}

fn frame_of(columns: Vec<Column>) -> Cv {
    Cv::Frame(std::rc::Rc::new(Frame { columns, total_rows: None, approx: None, source: None, layout: None }))
}

fn number_column(name: &str, values: Vec<V>) -> Column {
    Column { name: name.to_string(), ty: FrameColType::Number, values, unit: None, format: None, raw: None }
}

fn outliers(c: &mut Call) -> Answer {
    let method = c.field_str("method", "z").to_string();
    let arr = slot(c, "list");
    let t = match c.read("threshold") {
        V::Undef => V::Num(match method.as_str() {
            "iqr" => 1.5,
            "mad" => 3.5,
            _ => 3.0,
        }),
        t => t,
    };
    if nullish(&arr) || matches!(t, V::Null) {
        return shown(c, "cachedResult", "result", V::Null);
    }
    let flags = core_call("ISOUTLIER", &[arr.clone(), V::str(&method), t]);
    let flag_items = items(&flags);
    let clean: Vec<V> = items(&arr)
        .into_iter()
        .enumerate()
        .map(|(i, v)| if matches!(flag_items.get(i), Some(V::Bool(true))) { V::Null } else { v })
        .collect();
    let outlier = Column {
        name: "Outlier".into(),
        ty: FrameColType::Logical,
        values: flag_items,
        unit: None,
        format: None,
        raw: None,
    };
    let frame = frame_of(vec![infer_column("Value", &clean), outlier]);
    shown(c, "cachedResult", "result", frame)
}

fn tally(c: &mut Call) -> Answer {
    let values = items(&list_in(c, "list"));
    let mut index: std::collections::HashMap<MemberKey, usize> = std::collections::HashMap::new();
    let mut seen: Vec<(V, f64)> = Vec::new();
    for v in &values {
        if matches!(v, V::Null) || v.is_sol_error() {
            continue;
        }
        match index.get(&member_key(v)) {
            Some(&i) => seen[i].1 += 1.0,
            None => {
                index.insert(member_key(v), seen.len());
                seen.push((v.clone(), 1.0));
            }
        }
    }
    let r = if values.is_empty() && seen.is_empty() {
        Cv::NULL
    } else {
        let keys: Vec<V> = seen.iter().map(|(v, _)| v.clone()).collect();
        frame_of(vec![
            infer_column("Value", &keys),
            number_column("Count", seen.iter().map(|(_, n)| V::Num(*n)).collect()),
        ])
    };
    c.show("cachedResult", r.clone());
    Ok(vec![("frame".into(), r)])
}

/// `Number(v)`.
pub(crate) fn js_number(v: &V) -> f64 {
    match v {
        V::Num(n) => *n,
        V::Null => 0.0,
        V::Bool(b) => f64::from(u8::from(*b)),
        V::Str(s) => crate::value_kinds::decimal_from_text(s),
        V::List(_) => crate::value_kinds::decimal_from_text(&value_text(v)),
        _ => f64::NAN,
    }
}

fn group_lists(c: &mut Call) -> Answer {
    let keys = slot(c, "keys");
    if nullish(&keys) {
        return shown(c, "cachedResult", "result", V::Null);
    }
    let V::List(raw_keys) = strip_unit_cells(&keys) else {
        return shown(c, "cachedResult", "result", V::Null);
    };
    let raw_vals = items(&list_in(c, "values"));
    let n = raw_keys.len().min(raw_vals.len());
    let mut order: Vec<V> = Vec::new();
    let mut buckets: std::collections::HashMap<String, Vec<f64>> = std::collections::HashMap::new();
    for i in 0..n {
        let k = &raw_keys[i];
        let key = value_text(k);
        if !buckets.contains_key(&key) {
            buckets.insert(key.clone(), Vec::new());
            order.push(k.clone());
        }
        let v = js_number(&raw_vals[i]);
        if v.is_finite() {
            buckets.entry(key).or_default().push(v);
        }
    }
    // A group holding text answers its formula's error, as `GROUPBY(keys, values, SUM)` does ([[C17]] shareImpl,
    // [[D109]] aggregatesRefuseText); COUNT leaves the text out.
    let name = aggregate_formula(c.field_str("agg", "sum")).filter(|&n| n != "COUNT");
    let mut refused: std::collections::HashMap<String, V> = std::collections::HashMap::new();
    if let Some(name) = name.filter(|_| raw_vals[..n].iter().any(is_text)) {
        let mut groups: std::collections::HashMap<String, Vec<V>> = std::collections::HashMap::new();
        for i in 0..n {
            groups.entry(value_text(&raw_keys[i])).or_default().push(raw_vals[i].clone());
        }
        // A group holding an error keeps the card's answer: the card skips errors, where the formula answers them.
        for (key, vals) in groups.into_iter().filter(|(_, vals)| !vals.iter().any(V::is_sol_error)) {
            if let Some(e) = crate::excel_functions::text_refusal(name, &[list(vals)]) {
                refused.insert(key, e);
            }
        }
    }
    let agg: fn(&[f64], f64) -> f64 = match c.field_str("agg", "sum") {
        "avg" => |vals, sum| sum / vals.len() as f64,
        "min" => |vals, _| vals.iter().fold(f64::INFINITY, |m, &v| if v < m { v } else { m }),
        "max" => |vals, _| vals.iter().fold(f64::NEG_INFINITY, |m, &v| if v > m { v } else { m }),
        "count" => |vals, _| vals.len() as f64,
        _ => |_, sum| sum,
    };
    let values: Vec<V> = order
        .iter()
        .map(|k| {
            let key = value_text(k);
            if let Some(e) = refused.get(&key) {
                return e.clone();
            }
            let vals = &buckets[&key];
            V::Num(if vals.is_empty() { 0.0 } else { agg(vals, vals.iter().fold(0.0, |a, b| a + b)) })
        })
        .collect();
    let frame = frame_of(vec![infer_column("Key", &order), number_column("Value", values)]);
    shown(c, "cachedResult", "result", frame)
}

/// FINDPEAKS's positions, beside each peak's own cell.
fn find_peaks(c: &mut Call) -> Answer {
    if c.field_str("mode", "list") == "grid" {
        return find_peaks_2d(c);
    }
    let arr = slot(c, "list");
    if nullish(&arr) {
        return shown(c, "cachedResult", "result", V::Null);
    }
    let opt = |v: V| match v {
        V::Num(n) if n.is_nan() => V::Undef,
        v => v,
    };
    use super::text::setting as setting_or;
    let (height, distance, prominence) =
        (setting_or(c, "height", V::Undef), setting_or(c, "distance", V::Undef), setting_or(c, "prominence", V::Undef));
    let args = [arr.clone(), opt(height), opt(distance), opt(prominence)];
    let positions = match core_call("FINDPEAKS", &args) {
        V::List(p) => p,
        e if e.is_sol_error() => return Err(e),
        _ => return Err(err(ErrorCode::Value, "Find Peaks needs a list of numbers")),
    };
    let height = positions
        .iter()
        .map(|p| match (&arr, p) {
            (V::List(items), V::Num(n)) if *n >= 1.0 && n.fract() == 0.0 => {
                items.get(*n as usize - 1).cloned().unwrap_or(V::Undef)
            }
            _ => V::Undef,
        })
        .collect();
    let columns = vec![number_column("Position", positions.as_ref().clone()), number_column("Height", height)];
    let frame =
        Cv::Frame(std::rc::Rc::new(Frame { columns, total_rows: None, approx: None, source: None, layout: None }));
    shown(c, "cachedResult", "result", frame)
}

/// Find Peaks' Grid mode: FINDPEAKS's `[row, column]` pairs, with each peak's height beside them.
fn find_peaks_2d(c: &mut Call) -> Answer {
    let grid = slot(c, "grid");
    if nullish(&grid) {
        return shown(c, "cachedResult", "result", V::Null);
    }
    let height = match super::text::setting(c, "height", V::Undef) {
        V::Num(n) if n.is_nan() => V::Undef,
        v => v,
    };
    let pairs = match core_call("FINDPEAKS", &[grid.clone(), height]) {
        V::List(p) => p,
        e if e.is_sol_error() => return Err(e),
        _ => return Err(err(ErrorCode::Value, "Find Peaks needs a grid of numbers")),
    };
    let cell = |p: &V, k: usize| match p {
        V::List(rc) => rc.get(k).cloned().unwrap_or(V::Undef),
        _ => V::Undef,
    };
    let at = |p: &V| match (&grid, cell(p, 0), cell(p, 1)) {
        (V::List(rows), V::Num(r), V::Num(k)) => match rows.get(r as usize - 1) {
            Some(V::List(row)) => row.get(k as usize - 1).cloned().unwrap_or(V::Undef),
            _ => V::Undef,
        },
        _ => V::Undef,
    };
    let columns = vec![
        number_column("Row", pairs.iter().map(|p| cell(p, 0)).collect()),
        number_column("Column", pairs.iter().map(|p| cell(p, 1)).collect()),
        number_column("Height", pairs.iter().map(at).collect()),
    ];
    let frame =
        Cv::Frame(std::rc::Rc::new(Frame { columns, total_rows: None, approx: None, source: None, layout: None }));
    shown(c, "cachedResult", "result", frame)
}

// ─── INDEX ──────────────────────────────────────────────────────────────────────

/// A list takes one Position and anything else a Row and a Column ([[D85]] columnsStayColumns); the class swaps the
/// sockets, and until it has, the sockets on the card say what the numbers mean.
fn list_index(c: &mut Call) -> Answer {
    let v = match c.raw_card("list") {
        Cv::V(V::Undef) => Cv::NULL,
        v => v,
    };
    // [[D85]] columnsStayColumns: a list takes one Position, anything else a Row and a Column; `axesMove` names the
    // axes the sockets move to, for `coreWatched`.
    let want = arrives(&v).map(|a| if a == Arrives::Flat { "position" } else { "rowcol" });
    match want {
        Some(w) if w != c.field_str("indexAxes", "rowcol") => c.show("axesMove", V::str(w)),
        _ => c.show("axesMove", V::Null),
    }
    let has = |c: &Call, k: &str| c.sockets.iter().any(|s| s.key == k);
    let row = picks(
        &c.label(if has(c, "position") { "position" } else { "index" }),
        if has(c, "position") { role_value(c, "position") } else { role_value(c, "index") },
    );
    let col = if has(c, "column") { picks(&c.label("column"), role_value(c, "column")) } else { V::Undef };
    let unit = c.matrix_unit("list").cloned();
    let result = index_container(&v, &row, &col, unit.as_ref());
    // Columns of different kinds picked together, a date among them, would hand on one list of both ([[C137]]).
    let picked_date = match &v {
        Cv::Frame(f) => picked_types(&col, &f.columns.iter().map(|k| Some(k.ty)).collect::<Vec<_>>()),
        Cv::Cube(q) => picked_types(&col, &q.columns.iter().map(super::frames::cube_column_family).collect::<Vec<_>>()),
        _ => Vec::new(),
    };
    if !matches!(result, Cv::Frame(_) | Cv::Cube(_))
        && picked_date.contains(&Some(FrameColType::Date))
        && picked_date.iter().any(|t| *t != Some(FrameColType::Date))
    {
        let e = Cv::V(crate::date_values::mixed("other kinds"));
        c.show("cachedResult", e.clone());
        return Ok(vec![("result".into(), e)]);
    }
    if let (Some(u), Cv::V(V::List(a)), Cv::V(V::List(b))) = (&unit, &v, &result)
        && std::rc::Rc::ptr_eq(a, b)
    {
        c.set_matrix_unit("result", u.clone());
    }
    c.show("cachedResult", result.clone());
    Ok(vec![("result".into(), result)])
}

/// The type of each picked column, 1-based positions as INDEX reads them; none for a blank or 0 Column.
fn picked_types(col: &V, types: &[Option<FrameColType>]) -> Vec<Option<FrameColType>> {
    let positions: Vec<f64> = match col {
        V::Num(_) => vec![trunc_of(col)],
        V::List(items) => items.iter().map(trunc_of).collect(),
        _ => return Vec::new(),
    };
    positions.into_iter().map(|p| (p >= 1.0).then(|| types.get(p as usize - 1).copied().flatten()).flatten()).collect()
}

/// A `picks` input ([[D86]] blankRoles): a blank position in a list dropped, none left (or a blank) the
/// positions left out; a blank inside a table of positions `#SYNTAX!`.
fn picks(label: &str, v: V) -> V {
    let blank =
        |x: &V| if nullish(x) { err(ErrorCode::Syntax, format!("A position in {label} is blank")) } else { x.clone() };
    match &v {
        V::Err(_) => v,
        V::List(rows) if matches!(rows.first(), Some(V::List(_))) => list(
            rows.iter()
                .map(|r| if let V::List(cells) = r { list(cells.iter().map(blank).collect()) } else { blank(r) })
                .collect(),
        ),
        V::List(items) => {
            let kept: Vec<V> = items.iter().filter(|x| !nullish(x)).cloned().collect();
            if kept.is_empty() {
                V::Undef
            } else {
                list(kept)
            }
        }
        x if nullish(x) => V::Undef,
        _ => v,
    }
}

fn index_ref_error(n: f64, max: usize, what: &str) -> V {
    err(ErrorCode::Ref, format!("{what} {} is outside 1…{max}", number_to_string(n)))
}

/// `Math.trunc` of a position as JS reads it.
fn trunc_of(v: &V) -> f64 {
    super::kit::num(v).trunc()
}

/// `None` where a position is blank; else whether each axis is whole, and the 0-based positions.
fn resolve_axes(row: &V, col: &V) -> Option<(bool, bool, f64, f64)> {
    if matches!(row, V::Null) || matches!(col, V::Null) {
        return None;
    }
    let row_all = matches!(row, V::Undef) || trunc_of(row) == 0.0;
    let col_all = matches!(col, V::Undef) || trunc_of(col) == 0.0;
    Some((
        row_all,
        col_all,
        if row_all { -1.0 } else { trunc_of(row) - 1.0 },
        if col_all { -1.0 } else { trunc_of(col) - 1.0 },
    ))
}

/// `xs[i]` at a position that may be NaN or out of range.
/// A Cube column's cell at `i`, blank past its end.
fn cube_cell_at(cells: &[Cv], i: f64) -> Cv {
    match (i >= 0.0).then(|| cells.get(i as usize)).flatten() {
        None | Some(Cv::V(V::Undef)) => Cv::NULL,
        Some(c) => c.clone(),
    }
}

fn at_pos(xs: &[V], i: f64) -> Option<&V> {
    if i >= 0.0 && i < xs.len() as f64 {
        xs.get(i as usize)
    } else {
        None
    }
}

fn outside(i: f64, len: usize) -> bool {
    i < 0.0 || i >= len as f64
}

/// `x ?? null`.
fn or_null(x: Option<&V>) -> V {
    match x {
        None | Some(V::Undef) => V::Null,
        Some(x) => x.clone(),
    }
}

/// A frame or a cube sliced here, anything else as the INDEX formula reads it, a table's
/// cells in its unit.
fn index_container(v: &Cv, row: &V, col: &V, unit: Option<&serde_json::Value>) -> Cv {
    use super::frames::{cube_from_columns, cube_row_count, tag_cell_unit};
    if v.is_nullish() {
        return Cv::NULL;
    }
    if let Cv::V(v) = v {
        return Cv::V(index_into(v, row, col, unit));
    }
    if !v.is_table() {
        return Cv::NULL;
    }
    if matches!(row, V::List(_)) || matches!(col, V::List(_)) {
        return Cv::V(err(ErrorCode::Value, "INDEX takes one row and one column of a Frame or Cube at a time"));
    }
    let Some((row_all, col_all, r, ci)) = resolve_axes(row, col) else { return Cv::NULL };
    if let Cv::Cube(cube) = v {
        if row_all && col_all {
            return v.clone();
        }
        let rows = cube_row_count(cube);
        if !row_all && outside(r, rows) {
            return Cv::V(index_ref_error(r + 1.0, rows, "Row"));
        }
        if !col_all && outside(ci, cube.columns.len()) {
            return Cv::V(index_ref_error(ci + 1.0, cube.columns.len(), "Column"));
        }
        if row_all {
            return cube_from_columns(vec![cube.columns[ci as usize].clone()]);
        }
        if col_all {
            return cube_from_columns(
                cube.columns
                    .iter()
                    .map(|col| super::CubeColumn { cells: vec![cube_cell_at(&col.cells, r)], ..col.clone() })
                    .collect(),
            );
        }
        let column = &cube.columns[ci as usize];
        return match cube_cell_at(&column.cells, r) {
            Cv::V(cell) if super::frames::cube_column_family(column) == Some(FrameColType::Date) => {
                Cv::V(crate::date_values::wrap(&cell))
            }
            cell => cell,
        };
    }
    let Cv::Frame(frame) = v else { return Cv::NULL };
    if row_all && col_all {
        return v.clone();
    }
    let rows = frame.columns.iter().map(|col| col.values.len()).max().unwrap_or(0);
    if !row_all && outside(r, rows) {
        return Cv::V(index_ref_error(r + 1.0, rows, "Row"));
    }
    if !col_all && outside(ci, frame.columns.len()) {
        return Cv::V(index_ref_error(ci + 1.0, frame.columns.len(), "Column"));
    }
    // A Date column's cells leave as dates; the column packs its days as numbers ([[D114]] dateIsAKind).
    let dated = |col: &Column, v: V| if col.ty == FrameColType::Date { crate::date_values::wrap(&v) } else { v };
    if row_all {
        let col = &frame.columns[ci as usize];
        return Cv::V(dated(
            col,
            list(match &col.unit {
                Some(u) => {
                    let tag = super::frames::UnitTag::new(u);
                    col.values.iter().map(|x| tag.tag(x)).collect()
                }
                None => col.values.clone(),
            }),
        ));
    }
    if col_all {
        let columns = frame
            .columns
            .iter()
            .map(|col| Column {
                values: vec![or_null(at_pos(&col.values, r))],
                raw: col.raw.as_ref().and_then(|raw| raw.as_array()).map(|raw| {
                    serde_json::Value::Array(vec![raw
                        .get(r as usize)
                        .filter(|x| !x.is_null())
                        .cloned()
                        .unwrap_or_else(|| serde_json::Value::String(String::new()))])
                }),
                ..col.clone()
            })
            .collect();
        return Cv::Frame(std::rc::Rc::new(Frame {
            columns,
            total_rows: None,
            approx: None,
            source: None,
            layout: None,
        }));
    }
    let col = &frame.columns[ci as usize];
    let cell = or_null(at_pos(&col.values, r));
    match &col.unit {
        Some(u) => Cv::V(tag_cell_unit(&cell, u)),
        None => Cv::V(dated(col, cell)),
    }
}

/// INDEX with the frame cell's unit tagged back on: an empty list of positions is the positions left out
/// ([[D86]] blankRoles).
fn index_into(v: &V, row: &V, col: &V, unit: Option<&serde_json::Value>) -> V {
    if matches!(v, V::Null | V::Undef) {
        return V::Null;
    }
    let unlist = |x: &V| match x {
        V::List(l) if l.is_empty() => V::Undef,
        x => x.clone(),
    };
    let (row, col) = (unlist(row), unlist(col));
    if matches!(row, V::List(_)) || matches!(col, V::List(_)) {
        return index_many(v, &row, &col, unit);
    }
    let Some((row_all, col_all, r, ci)) = resolve_axes(&row, &col) else { return V::Null };
    let V::List(items) = v else {
        let ok = (row_all || r == 0.0) && (col_all || ci == 0.0);
        return if ok {
            v.clone()
        } else {
            err(ErrorCode::Ref, "Index is outside a single value. Only index 1 exists")
        };
    };
    if matches!(items.first(), Some(V::List(_))) {
        let grid = items;
        let tag = |x: V| match unit {
            Some(u) => super::frames::tag_cell_unit(&x, u),
            None => x,
        };
        if row_all && col_all {
            return v.clone();
        }
        let width = || grid.iter().map(|row| if let V::List(r) = row { r.len() } else { 1 }).max().unwrap_or(0);
        // One position on a one-row or one-column table walks along it, as Excel's INDEX does.
        if matches!(col, V::Undef) && !row_all {
            if grid.len() == 1
                && let V::List(only) = &grid[0]
            {
                return if outside(r, only.len()) {
                    index_ref_error(r + 1.0, only.len(), "Column")
                } else {
                    tag(or_null(at_pos(only, r)))
                };
            }
            if width() == 1 {
                if outside(r, grid.len()) {
                    return index_ref_error(r + 1.0, grid.len(), "Row");
                }
                return tag(match at_pos(grid, r) {
                    Some(V::List(row)) => or_null(row.first()),
                    Some(x) => x.clone(),
                    None => V::Undef,
                });
            }
        }
        if !row_all && outside(r, grid.len()) {
            return index_ref_error(r + 1.0, grid.len(), "Row");
        }
        if row_all {
            let w = width();
            if outside(ci, w) {
                return index_ref_error(ci + 1.0, w, "Column");
            }
            return list(
                grid.iter()
                    .map(|row| {
                        tag(match row {
                            V::List(cells) => or_null(at_pos(cells, ci)),
                            other => {
                                if ci == 0.0 {
                                    other.clone()
                                } else {
                                    V::Null
                                }
                            }
                        })
                    })
                    .collect(),
            );
        }
        let row_arr: Vec<V> = match at_pos(grid, r) {
            Some(V::List(cells)) => cells.to_vec(),
            Some(other) => vec![other.clone()],
            None => vec![V::Undef],
        };
        if col_all {
            return list(row_arr.into_iter().map(tag).collect());
        }
        return if outside(ci, row_arr.len()) {
            index_ref_error(ci + 1.0, row_arr.len(), "Column")
        } else {
            tag(or_null(at_pos(&row_arr, ci)))
        };
    }
    // A list is one row: one index walks along it; with two, the row must be 1 and the column picks the item.
    let item = |i: f64, what: &str| {
        if outside(i, items.len()) {
            index_ref_error(i + 1.0, items.len(), what)
        } else {
            at_pos(items, i).cloned().unwrap_or(V::Undef)
        }
    };
    if matches!(col, V::Undef) {
        return if row_all { list(items.to_vec()) } else { item(r, "Item") };
    }
    if !row_all && r != 0.0 {
        return index_ref_error(r + 1.0, 1, "Row");
    }
    if col_all {
        list(items.to_vec())
    } else {
        item(ci, "Column")
    }
}

fn is_grid(x: &V) -> bool {
    matches!(x, V::List(l) if matches!(l.first(), Some(V::List(_))))
}

/// Blank, an error as it is, a number, or #VALUE!.
fn position_of(x: &V) -> V {
    let n = match x {
        V::Null | V::Undef => return V::Null,
        V::Err(_) => return x.clone(),
        V::Num(n) => *n,
        V::Bool(b) => f64::from(u8::from(*b)),
        V::Str(s) if !trim_space(s).is_empty() => crate::value_kinds::decimal_from_text(s),
        _ => f64::NAN,
    };
    if n.is_nan() {
        err(ErrorCode::Value, "INDEX position must be a number")
    } else {
        V::Num(n)
    }
}

/// On a table whose other axis is whole, a list of rows or columns picks those, as CHOOSEROWS and
/// CHOOSECOLS do; otherwise the two axes pair up as Excel's array arguments do, one value per pair.
fn index_many(v: &V, row: &V, col: &V, unit: Option<&serde_json::Value>) -> V {
    let (row_many, col_many) = (matches!(row, V::List(_)), matches!(col, V::List(_)));
    if let (true, V::List(grid)) = (is_grid(v) && row_many != col_many, v) {
        let picks = if row_many { row } else { col };
        let other = if row_many { col } else { row };
        let walks = matches!(col, V::Undef)
            && (grid.len() == 1 || grid.iter().all(|r| !matches!(r, V::List(l) if l.len() > 1)));
        let whole = matches!(other, V::Undef) || matches!(other, V::Num(n) if n.trunc() == 0.0);
        if !walks && whole && !is_grid(picks) {
            let V::List(picks) = picks else { return V::Null };
            let slices: Vec<V> = picks
                .iter()
                .map(|p| match position_of(p) {
                    at @ (V::Null | V::Err(_)) => at,
                    at if row_many => index_into(v, &at, other, unit),
                    at => index_into(v, other, &at, unit),
                })
                .collect();
            if let Some(bad) = slices.iter().find(|x| !matches!(x, V::List(_)) || x.is_sol_error()) {
                return bad.clone();
            }
            if row_many {
                return list(slices);
            }
            let lists: Vec<&[V]> =
                slices.iter().map(|s| if let V::List(l) = s { l.as_slice() } else { &[][..] }).collect();
            return list(
                (0..lists[0].len()).map(|i| list(lists.iter().map(|c| or_null(c.get(i))).collect())).collect(),
            );
        }
    }
    let as_grid = |x: &V| -> Vec<V> {
        match x {
            V::List(l) if is_grid(x) => l.to_vec(),
            V::List(_) => vec![x.clone()],
            _ => vec![list(vec![x.clone()])],
        }
    };
    let rg = (!matches!(row, V::Undef)).then(|| as_grid(row));
    let cg = (!matches!(col, V::Undef)).then(|| as_grid(col));
    let len0 = |g: &Option<Vec<V>>| {
        g.as_ref().and_then(|g| g.first()).map(|r| if let V::List(l) = r { l.len() } else { 1 }).unwrap_or(1)
    };
    let h = rg.as_ref().map_or(1, Vec::len).max(cg.as_ref().map_or(1, Vec::len));
    let w = len0(&rg).max(len0(&cg));
    let at = |g: &Option<Vec<V>>, i: usize, j: usize| -> V {
        let Some(g) = g else { return V::Undef };
        let gi = if g.len() == 1 { 0 } else { i };
        let Some(line) = g.get(gi) else { return err(ErrorCode::NotAvailable, "The positions are different sizes") };
        let V::List(line) = line else { return position_of(line) };
        let gj = if (if let Some(V::List(f)) = g.first() { f.len() } else { 1 }) == 1 { 0 } else { j };
        match line.get(gj) {
            None => err(ErrorCode::NotAvailable, "The positions are different sizes"),
            Some(x) => position_of(x),
        }
    };
    let out: Vec<V> = (0..h)
        .map(|i| {
            list(
                (0..w)
                    .map(|j| {
                        let (r, cc) = (at(&rg, i, j), at(&cg, i, j));
                        if r.is_sol_error() {
                            return r;
                        }
                        if cc.is_sol_error() {
                            return cc;
                        }
                        match index_into(v, &r, &cc, unit) {
                            V::List(_) => err(ErrorCode::Value, "Each pair of positions must pick one value"),
                            x => x,
                        }
                    })
                    .collect(),
            )
        })
        .collect();
    if h == 1 {
        out.into_iter().next().unwrap_or(V::Null)
    } else {
        list(out)
    }
}

// ─── Shuffle, over the keys its shell drew ([[C23]] calcModes) ──────

/// An exponential draw's key, so a heavier weight tends to land earlier.
fn weighted_shuffle_key(u: f64, weight: f64) -> f64 {
    if !(weight > 0.0) || !weight.is_finite() {
        return f64::INFINITY;
    }
    let uu = if u <= 0.0 {
        f64::EPSILON
    } else if u >= 1.0 {
        1.0 - f64::EPSILON
    } else {
        u
    };
    -libm::log(uu) / weight
}

fn shuffle(c: &mut Call) -> Answer {
    let arr: Vec<V> = match c.wired("list").and_then(|w| w.first()) {
        Some(V::List(items)) => items.as_ref().clone(),
        Some(V::Str(s)) => s.chars().map(|ch| V::str(&ch.to_string())).collect(),
        _ => Vec::new(),
    };
    if c.field_str("op", "shuffle") == "sample" {
        return sample(c, arr);
    }
    // Per-slot uniforms, not a fixed permutation, so live values flow through while the order holds until the
    // generation advances; a new length draws them all anew.
    let held = c.rolls("keys", arr.len(), true);
    let weights = match c.wired("weights").and_then(|w| w.first()) {
        Some(V::List(w)) => Some(w.clone()),
        _ => None,
    };
    let refuse = |c: &mut Call, e: V| {
        c.show("cachedList", list(Vec::new()));
        Ok(vec![("result".into(), Cv::from(e))])
    };
    let key_at = |i: usize| held.get(i).copied().unwrap_or(f64::NAN);
    let keys: Vec<f64> = match &weights {
        Some(w) => {
            if w.len() < arr.len() {
                return refuse(
                    c,
                    err(
                        ErrorCode::Shape,
                        format!("The weights list has {} values but the list has {}", w.len(), arr.len()),
                    ),
                );
            }
            if !(0..arr.len()).any(|i| matches!(w.get(i), Some(V::Num(x)) if *x > 0.0)) {
                return refuse(c, err(ErrorCode::Value, "The weights are all zero, so nothing can be drawn"));
            }
            (0..held.len())
                .map(|i| weighted_shuffle_key(key_at(i), if let Some(V::Num(x)) = w.get(i) { *x } else { 0.0 }))
                .collect()
        }
        None => held.clone(),
    };
    let mut pairs: Vec<(V, f64)> =
        arr.into_iter().enumerate().map(|(i, v)| (v, keys.get(i).copied().unwrap_or(f64::NAN))).collect();
    crate::decision::sort_by_num(&mut pairs, |a, b| a.1 - b.1);
    let order = list(pairs.into_iter().map(|p| p.0).collect());
    c.show("cachedList", order.clone());
    Ok(vec![("result".into(), Cv::from(order))])
}

/// Shuffle's Sample op, RANDSAMPLE: Count draws with replacement (blank: the list's length), uniform or by Weights.
/// The rolls hold until the generation advances, so changed values flow through the same picks.
fn sample(c: &mut Call, arr: Vec<V>) -> Answer {
    let count = read_role(c, "count", &Role::Setting(V::Undef));
    let weights = match c.wired("weights").and_then(|w| w.first()) {
        Some(V::List(w)) => Some(w.as_ref().clone()),
        _ => None,
    };
    let drawn = match count {
        e @ V::Err(_) => Err(e),
        n => crate::fns_random::sample_count(&n, arr.len()).and_then(|n| {
            let rolls = c.rolls("draws", n, false);
            crate::fns_random::sample_with(&arr, weights.as_deref(), &rolls)
        }),
    };
    let out = drawn.map_or_else(|e| e, list);
    c.show("cachedList", if out.is_sol_error() { list(Vec::new()) } else { out.clone() });
    Ok(vec![("result".into(), Cv::from(out))])
}

/// The RANDARRAY card: as many rolls as the count, held until the generation advances, scaled into Min and Max, so
/// new bounds rescale the same draws. An error in Count, Min or Max is the answer, the first in that order.
fn rand_array(c: &mut Call) -> Answer {
    // A blank count, rows, columns, min or max is Excel's omitted reading: one value, from 0 to 1.
    let grid = c.field_str("mode", "list") == "grid";
    let out_key = if grid { "table" } else { "list" };
    let count_raw = or(read_role(c, if grid { "rows" } else { "count" }, &Role::Setting(V::Undef)), V::Num(1.0));
    let cols_raw = if grid { or(read_role(c, "cols", &Role::Setting(V::Undef)), V::Num(1.0)) } else { V::Num(1.0) };
    let lo = or(read_role(c, "min", &Role::Setting(V::Undef)), V::Num(0.0));
    let hi = or(read_role(c, "max", &Role::Setting(V::Undef)), V::Num(1.0));
    let whole = c.field("integer").and_then(serde_json::Value::as_bool).unwrap_or(false);
    let read = crate::fns_random::array_count(js_number(&count_raw))
        .and_then(|rows| crate::fns_random::array_count(js_number(&cols_raw)).map(|cols| rows * cols));
    let cols = crate::fns_random::array_count(js_number(&cols_raw)).unwrap_or(1.0) as usize;
    let count = *read.as_ref().unwrap_or(&0.0);
    let passed = [&count_raw, &cols_raw, &lo, &hi].into_iter().find(|v| matches!(v, V::Err(_))).cloned();
    // Min and Max are numbers (a logical as 1 or 0); text is never one ([[C10]] socketLattice).
    let (a, b) = (crate::excel_functions::to_num(&lo), crate::excel_functions::to_num(&hi));
    let bad = match read {
        _ if passed.is_some() => passed,
        Err(e) => Some(e),
        Ok(n) if n > MAX_GENERATED => Some(err(
            ErrorCode::Overflow,
            format!(
                "RANDARRAY count {} exceeds the {} element limit",
                number_to_string(n),
                number_to_string(MAX_GENERATED)
            ),
        )),
        Ok(_) if a.is_nan() || b.is_nan() => Some(err(ErrorCode::Value, "RANDARRAY's Min and Max must be numbers")),
        Ok(_) if a > b => Some(err(ErrorCode::Value, "RANDARRAY's Min is above its Max")),
        Ok(_) if whole && a.ceil() > b.floor() => {
            Some(err(ErrorCode::Value, "RANDARRAY's Min and Max hold no whole number"))
        }
        Ok(_) => None,
    };
    if let Some(e) = bad {
        c.show("cachedList", e.clone());
        return Ok(vec![(out_key.into(), Cv::from(e))]);
    }
    let rolls = c.rolls("rolls", count as usize, false);
    let cells: Vec<V> = rolls
        .iter()
        .map(|&r| {
            if whole {
                V::Num(a.ceil() + (r * (b.floor() - a.ceil() + 1.0)).floor())
            } else {
                V::Num(a + r * (b - a))
            }
        })
        .collect();
    let drawn = if grid && cols > 0 {
        list(cells.chunks(cols).map(|row| list(row.to_vec())).collect())
    } else if grid {
        list(Vec::new())
    } else {
        list(cells)
    };
    c.show("cachedList", drawn.clone());
    Ok(vec![(out_key.into(), Cv::from(drawn))])
}

#[cfg(test)]
mod tests {
    use super::keyed_value;
    use crate::excel_functions::V;

    #[test]
    fn keyed_text_reads_as_its_slots_kind_never_a_guess() {
        assert!(matches!(keyed_value("number", "12"), V::Num(n) if n == 12.0));
        assert!(matches!(keyed_value("string", "12"), V::Str(s) if &*s == "12"));
        assert!(matches!(keyed_value("date", "01-Feb-1992"), V::Date(_)));
        assert!(matches!(keyed_value("logical", "true"), V::Bool(true)));
        assert!(matches!(keyed_value("number", ""), V::Undef));
        for (kind, text) in [("number", "12abc"), ("date", "Feb"), ("logical", "maybe")] {
            assert!(matches!(keyed_value(kind, text), V::Err(e) if e.code.to_string() == "#TYPE!"), "{kind} {text}");
        }
    }
}
