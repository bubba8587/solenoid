//! [[C130]] rustCore, [[B11]] maximalMerge, [[C17]] shareImpl, [[C24]] arraySemantics.
//! The text cards' bodies, each sharing its kernel with the formula of its name and broadcast item by item over a list,
//! and Cast, which reads a value as each of the five targets.

use super::kit::{broadcast_err, core_call};
use super::Cv;
use super::{err, list, Answer, Call};
use crate::error_value::ErrorCode;
use crate::excel_functions::{num_blank_zero, value_text, V};
use crate::jsnum::trim_space;

/// An input's raw value: unwired, the typed literal (a number's, else a text's); wired, the first cable's.
pub(crate) fn role_value(c: &Call, key: &str) -> V {
    let lit = c.unwired(key);
    let v = match c.wired(key) {
        None | Some([]) => lit,
        Some([first, ..]) => first.clone(),
    };
    if matches!(v, V::Undef) {
        V::Null
    } else {
        v
    }
}

/// A `setting` input ([[D86]] blankRoles): a blank reads as `blank`, item by item in a list.
pub(crate) fn setting(c: &Call, key: &str, blank: V) -> V {
    fn fill(v: &V, blank: &V) -> V {
        match v {
            V::List(l) => list(l.iter().map(|x| fill(x, blank)).collect()),
            V::Null | V::Undef => blank.clone(),
            other => other.clone(),
        }
    }
    let v = role_value(c, key);
    if v.is_sol_error() {
        v
    } else {
        fill(&v, &blank)
    }
}

/// A `required` input: a blank is `#SYNTAX!`, item by item in a list.
pub(crate) fn required(c: &Call, key: &str) -> V {
    fn need(v: &V, label: &str) -> V {
        match v {
            V::Err(_) => v.clone(),
            V::List(l) => list(l.iter().map(|x| need(x, label)).collect()),
            V::Null | V::Undef => err(ErrorCode::Syntax, format!("{label} is blank, and it has no default")),
            other => other.clone(),
        }
    }
    need(&role_value(c, key), &c.label(key))
}

/// A setting left out takes the card's default, whole or item by item.
pub(crate) fn left_out_as(v: V, dflt: f64) -> V {
    match v {
        V::Undef => V::Num(dflt),
        V::List(l) => list(l.iter().map(|x| if matches!(x, V::Undef) { V::Num(dflt) } else { x.clone() }).collect()),
        other => other,
    }
}

/// Unwired, the typed text, else `dflt`; wired, the first cable's value.
fn str_input(c: &Call, key: &str, dflt: &str) -> V {
    let lit = match c.unwired(key) {
        V::Undef | V::Null => V::str(dflt),
        v => v,
    };
    c.read_input(key, lit)
}

fn str_val(c: &Call, key: &str) -> V {
    str_input(c, key, "")
}

/// `Math.floor(x)` on whatever JS hands it.
pub(crate) fn js_floor(v: &V) -> f64 {
    num_blank_zero(v).floor()
}

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "UuidNode" => uuid(c),
        "PromoNode" => promo(c),
        "TextTransformNode" => {
            let name = match c.field_str("op", "upper") {
                "lower" => "LOWER",
                "trim" => "TRIM",
                "proper" => "PROPER",
                "clean" => "CLEAN",
                "unaccent" => "UNACCENT",
                "slugify" => "SLUGIFY",
                "linkname" => "LINKNAME",
                "linkpath" => "LINKPATH",
                _ => "UPPER",
            };
            each_text(c, "cachedText", name)
        }
        "PadTextNode" => pad_text(c),
        "TruncateTextNode" => truncate_text(c),
        "WrapTextNode" => wrap_text(c),
        "TextLenNode" => each_text(c, "cachedResult", "LEN"),
        "ConcatNode" => concat(c),
        "TextSliceNode" => text_slice(c),
        "TextFindNode" => text_find(c),
        "SubstituteNode" => substitute(c),
        "TextReplaceNode" => text_replace(c),
        "ReptNode" => rept(c),
        "CharCodeNode" => char_code(c),
        "TextJoinNode" => text_join(c),
        "TextSplitNode" => text_split(c),
        "TextAfterBeforeNode" => text_after_before(c),
        "RegexNode" => regex(c),
        "CastNode" => cast(c),
        "ExactNode" => {
            let r = broadcast_err(&[str_val(c, "a"), str_val(c, "b")], |o| {
                core_call("EXACT", &[o[0].clone(), o[1].clone()])
            });
            done(c, "cachedResult", r)
        }
        "UrlEncodeNode" => {
            let name = match c.field_str("op", "encode") {
                "decode" => "DECODEURL",
                "base64" => "ENCODEBASE64",
                "unbase64" => "DECODEBASE64",
                _ => "ENCODEURL",
            };
            each_text(c, "cachedText", name)
        }
        "HashNode" => {
            let algorithm = V::str(c.field_str("algorithm", "sha256"));
            let r = broadcast_err(&[str_val(c, "text")], |o| core_call("HASH", &[o[0].clone(), algorithm.clone()]));
            done(c, "cachedText", r)
        }
        "RomanArabicNode" => roman_arabic(c),
        "FixedNode" => {
            let no_commas = V::Bool(c.field_str("noCommas", "commas") == "no_commas");
            let args = [c.read("number"), left_out_as(setting(c, "decimals", V::Undef), 2.0)];
            let r = broadcast_err(&args, |o| core_call("FIXED", &[o[0].clone(), o[1].clone(), no_commas.clone()]));
            done(c, "cachedText", r)
        }
        "FormatDollarNode" => {
            let args = [c.read("number"), left_out_as(setting(c, "decimals", V::Undef), 2.0)];
            let r = broadcast_err(&args, |o| core_call("DOLLAR", &[o[0].clone(), o[1].clone()]));
            done(c, "cachedText", r)
        }
        "ReverseTextNode" => each_text(c, "cachedText", "REVERSETEXT"),
        "SpellNumberNode" => {
            let value = match c.wired("value") {
                None | Some([]) => c.unwired("value"),
                Some([first, ..]) => {
                    if matches!(first, V::Undef) {
                        V::Null
                    } else {
                        first.clone()
                    }
                }
            };
            let name = if c.field_str("mode", "words") == "ordinal" { "ORDINAL" } else { "SPELLNUMBER" };
            let r = broadcast_err(&[value], |o| core_call(name, &[o[0].clone()]));
            done(c, "cachedText", r)
        }
        "FuzzyMatchNode" => fuzzy_match(c),
        "TextSimilarityNode" => {
            let method = V::str(c.field_str("method", "ratio"));
            let r = broadcast_err(&[str_val(c, "a"), str_val(c, "b")], |o| {
                core_call("SIMILARITY", &[o[0].clone(), o[1].clone(), method.clone()])
            });
            done(c, "cachedResult", r)
        }
        _ => return None,
    })
}

fn done(c: &mut Call, field: &str, result: V) -> Answer {
    c.show(field, result.clone());
    Ok(vec![("result".into(), Cv::from(result))])
}

/// A one-text formula over the `text` input, item by item.
fn each_text(c: &mut Call, field: &str, name: &str) -> Answer {
    let r = broadcast_err(&[str_val(c, "text")], |o| core_call(name, &[o[0].clone()]));
    done(c, field, r)
}

fn pad_text(c: &mut Call) -> Answer {
    let w = required(c, "width");
    let fill = setting(c, "fill", V::str(""));
    if w.is_sol_error() {
        return done(c, "cachedText", w);
    }
    let side = V::str(c.field_str("side", "right"));
    let r = broadcast_err(&[str_val(c, "text")], |o| {
        core_call("PADTEXT", &[o[0].clone(), w.clone(), side.clone(), fill.clone()])
    });
    done(c, "cachedText", r)
}

fn truncate_text(c: &mut Call) -> Answer {
    let w = required(c, "width");
    let e = setting(c, "ellipsis", V::str("…"));
    if w.is_sol_error() {
        return done(c, "cachedText", w);
    }
    let r = broadcast_err(&[str_val(c, "text")], |o| core_call("TRUNCATETEXT", &[o[0].clone(), w.clone(), e.clone()]));
    done(c, "cachedText", r)
}

fn wrap_text(c: &mut Call) -> Answer {
    let text = str_val(c, "text");
    let w = required(c, "width");
    if w.is_sol_error() {
        c.show("cachedResult", V::Null);
        return Ok(vec![("result".into(), Cv::from(w))]);
    }
    if matches!(text, V::Null) {
        return done(c, "cachedResult", V::Null);
    }
    if num_blank_zero(&w) < 1.0 {
        return done(c, "cachedResult", err(ErrorCode::Domain, "Width must be at least 1"));
    }
    let r = core_call("WRAPTEXT", &[text, w]);
    done(c, "cachedResult", r)
}

fn concat(c: &mut Call) -> Answer {
    let keys: Vec<String> = c.sockets.iter().map(|s| s.key.clone()).collect();
    let values: Vec<V> = keys
        .iter()
        .map(|k| match str_val(c, k) {
            V::Null => V::str(""),
            v => v,
        })
        .collect();
    let r = core_call("CONCAT", &values);
    done(c, "cachedText", r)
}

fn text_slice(c: &mut Call) -> Answer {
    let text = str_val(c, "text");
    let r = if c.field_str("op", "left") == "mid" {
        let args = [text, required(c, "start"), required(c, "len")];
        broadcast_err(&args, |o| core_call("MID", &[o[0].clone(), o[1].clone(), o[2].clone()]))
    } else {
        let name = if c.field_str("op", "left") == "left" { "LEFT" } else { "RIGHT" };
        let args = [text, setting(c, "n", V::Num(1.0))];
        broadcast_err(&args, |o| core_call(name, &[o[0].clone(), o[1].clone()]))
    };
    done(c, "cachedText", r)
}

fn text_find(c: &mut Call) -> Answer {
    let name = if c.field_str("op", "find") == "find" { "FIND" } else { "SEARCH" };
    let args = [str_val(c, "needle"), str_val(c, "haystack"), setting(c, "start", V::Num(1.0))];
    let r = broadcast_err(&args, |o| core_call(name, &[o[0].clone(), o[1].clone(), o[2].clone()]));
    done(c, "cachedResult", r)
}

fn substitute(c: &mut Call) -> Answer {
    let args =
        [str_val(c, "text"), str_val(c, "old_text"), str_val(c, "new_text"), setting(c, "instance", V::Num(0.0))];
    let r = broadcast_err(&args, |o| {
        let n = js_floor(o[3]);
        let mut a = vec![o[0].clone(), o[1].clone(), o[2].clone()];
        if n >= 1.0 {
            a.push(V::Num(n));
        }
        core_call("SUBSTITUTE", &a)
    });
    done(c, "cachedText", r)
}

fn text_replace(c: &mut Call) -> Answer {
    let args = [str_val(c, "text"), required(c, "start"), required(c, "num_chars"), str_val(c, "new_text")];
    // The numbers go as given: REPLACE truncates them and refuses a start below 1 or a negative count, as Excel does.
    let r = broadcast_err(&args, |o| core_call("REPLACE", &[o[0].clone(), o[1].clone(), o[2].clone(), o[3].clone()]));
    done(c, "cachedText", r)
}

fn rept(c: &mut Call) -> Answer {
    let args = [str_val(c, "text"), required(c, "times")];
    let r = broadcast_err(&args, |o| core_call("REPT", &[o[0].clone(), o[1].clone()]));
    done(c, "cachedText", r)
}

fn char_code(c: &mut Call) -> Answer {
    let r = if c.field_str("op", "char") == "char" {
        broadcast_err(&[c.read("code")], |o| core_call("CHAR", &[o[0].clone()]))
    } else {
        broadcast_err(&[str_val(c, "text")], |o| core_call("CODE", &[o[0].clone()]))
    };
    done(c, "cachedResult", r)
}

fn text_join(c: &mut Call) -> Answer {
    let strings: Vec<V> = match c.wired("strings").and_then(|w| w.first()) {
        Some(V::List(l)) => l.to_vec(),
        _ => Vec::new(),
    };
    let delimiter = setting(c, "delimiter", V::str(""));
    let result = match strings.iter().find(|s| s.is_sol_error()) {
        Some(e) => e.clone(),
        None => {
            let present: Vec<V> = strings.into_iter().filter(|s| !matches!(s, V::Null | V::Undef)).collect();
            let ignore = V::Bool(c.field_str("ignoreEmpty", "ignore") == "ignore");
            core_call("TEXTJOIN", &[delimiter, ignore, list(present)])
        }
    };
    c.show("cachedText", if result.is_sol_error() { V::Null } else { result.clone() });
    Ok(vec![("result".into(), Cv::from(result))])
}

fn text_split(c: &mut Call) -> Answer {
    let text = str_val(c, "text");
    let delimiter = required(c, "delimiter");
    if delimiter.is_sol_error() {
        c.show("cachedResult", V::Null);
        return Ok(vec![("result".into(), Cv::from(delimiter))]);
    }
    if matches!(text, V::Null) {
        return done(c, "cachedResult", V::Null);
    }
    let r = core_call("TEXTSPLIT", &[text, delimiter]);
    done(c, "cachedResult", r)
}

fn roman_arabic(c: &mut Call) -> Answer {
    let r = if c.field_str("op", "roman") == "roman" {
        broadcast_err(&[c.read("number")], |o| core_call("ROMAN", &[o[0].clone()]))
    } else {
        broadcast_err(&[str_val(c, "text")], |o| core_call("ARABIC", &[o[0].clone()]))
    };
    done(c, "cachedResult", r)
}

/// The candidate scoring highest at or above the threshold, the first on a tie.
fn fuzzy_best(needle: &V, cands: &[V], method: &V, threshold: f64) -> Result<Option<(V, f64)>, V> {
    let mut best: Option<(V, f64)> = None;
    for cand in cands {
        // `text_similarity` spreads its text into code points; anything else isn't iterable.
        if !matches!(needle, V::Str(_)) {
            return Err(err(ErrorCode::Type, "The text to match takes text"));
        }
        let score = super::list::js_number(&core_call("SIMILARITY", &[needle.clone(), cand.clone(), method.clone()]));
        if score >= threshold && best.as_ref().is_none_or(|(_, b)| score > *b) {
            best = Some((cand.clone(), score));
        }
    }
    Ok(best)
}

fn fuzzy_match(c: &mut Call) -> Answer {
    let needle = str_val(c, "needle");
    let cands: Vec<V> = match super::list::slot(c, "candidates") {
        V::List(items) => items.iter().filter(|v| matches!(v, V::Str(_))).cloned().collect(),
        V::Null | V::Undef => Vec::new(),
        _ => {
            return Err(err(ErrorCode::Type, "The candidates take a list of text"));
        }
    };
    let threshold = match setting(c, "threshold", V::Undef) {
        V::Undef | V::Null => 0.6,
        v => super::list::js_number(&v),
    };
    if matches!(needle, V::Null) {
        c.show("cachedMatch", V::Null);
        c.show("cachedScore", V::Null);
        return Ok(vec![("match".into(), Cv::from(V::Null)), ("score".into(), Cv::from(V::Null))]);
    }
    let method = V::str(match c.field_str("method", "ratio") {
        "levenshtein" => "ratio",
        m => m,
    });
    let na = || err(ErrorCode::NotAvailable, "No candidate is similar enough");
    let pick = |n: &V| -> Result<(V, V), V> {
        Ok(match fuzzy_best(n, &cands, &method, threshold)? {
            Some((t, s)) => (t, V::Num(s)),
            None => (na(), na()),
        })
    };
    let (m, s) = match &needle {
        V::List(items) => {
            let picked = items.iter().map(pick).collect::<Result<Vec<_>, V>>()?;
            let (m, s): (Vec<V>, Vec<V>) = picked.into_iter().unzip();
            (list(m), list(s))
        }
        n => pick(n)?,
    };
    c.show("cachedMatch", m.clone());
    c.show("cachedScore", s.clone());
    Ok(vec![("match".into(), Cv::from(m)), ("score".into(), Cv::from(s))])
}

fn text_after_before(c: &mut Call) -> Answer {
    let instance = setting(c, "instance", V::Undef);
    if instance.is_sol_error() {
        return done(c, "cachedText", instance);
    }
    let if_not_found = setting(c, "if_not_found", V::Undef);
    if if_not_found.is_sol_error() {
        return done(c, "cachedText", if_not_found);
    }
    let name = if c.field_str("op", "after") == "after" { "TEXTAFTER" } else { "TEXTBEFORE" };
    let instance = if matches!(instance, V::Undef) { V::Num(1.0) } else { instance };
    let mode =
        V::Num(if c.field("matchCase").and_then(serde_json::Value::as_bool).unwrap_or(true) { 0.0 } else { 1.0 });
    let end = V::Num(if c.field("matchEnd").and_then(serde_json::Value::as_bool).unwrap_or(false) { 1.0 } else { 0.0 });
    let fallback = !matches!(&if_not_found, V::Undef) && !matches!(&if_not_found, V::Str(s) if s.is_empty());
    let r = broadcast_err(&[str_val(c, "text"), str_val(c, "delimiter")], |o| {
        match core_call(name, &[o[0].clone(), o[1].clone(), instance.clone(), mode.clone(), end.clone()]) {
            V::Null if fallback => if_not_found.clone(),
            r => r,
        }
    });
    done(c, "cachedText", r)
}

// ─── Regex ──────────────────────────────────────────────────────────────────────

/// Blank is 0 (every match), a fraction truncates, a negative counts from the end; None when
/// non-finite.
fn regex_occurrence(raw: &V) -> Option<f64> {
    if matches!(raw, V::Null | V::Undef) || matches!(raw, V::Str(s) if s.is_empty()) {
        return Some(0.0);
    }
    let n = super::list::js_number(raw).trunc();
    n.is_finite().then_some(n + 0.0)
}

/// A pattern compiled with the card's flags.
/// A regex op on one text, as the REGEX functions answer it ([[C17]] shareImpl): no match is #N/A for the extracts.
fn regex_apply(op: &str, re: &fancy_regex::Regex, t: &str, replacement: &str, occurrence: f64) -> Result<V, String> {
    use crate::excel_regex as rx;
    let none = || err(ErrorCode::NotAvailable, "No match");
    Ok(match op {
        "test" => V::Bool(rx::test(re, t)?),
        "extract" => rx::first(re, t)?.map_or_else(none, |m| V::str(&t[m.range])),
        "extract_all" => {
            let all = rx::all(re, t)?;
            if all.is_empty() {
                none()
            } else {
                list(all.into_iter().map(|m| V::str(&t[m.range])).collect())
            }
        }
        "extract_groups" => match rx::first(re, t)? {
            Some(m) => list(m.groups.iter().map(|g| V::str(g.as_ref().map_or("", |r| &t[r.clone()]))).collect()),
            None => none(),
        },
        _ => V::str(&rx::replace(re, t, replacement, occurrence)?),
    })
}

fn regex(c: &mut Call) -> Answer {
    let op = c.field_str("op", "test").to_string();
    let replace = op == "replace";
    let pattern = str_val(c, "pattern");
    // Read only under the replace op, so a wired blank here never blanks a test or extract.
    let replacement = if replace { str_val(c, "replacement") } else { V::str("") };
    let occurrence = if replace { setting(c, "occurrence", V::Num(0.0)) } else { V::Num(0.0) };
    let blank = |c: &mut Call| done(c, "cachedResult", V::Null);
    if [&pattern, &replacement, &occurrence].iter().any(|v| matches!(v, V::Null)) {
        return blank(c);
    }
    let Some(occ) = regex_occurrence(&occurrence) else { return blank(c) };
    let pattern_text = value_text(&pattern);
    if pattern_text.is_empty() {
        return blank(c);
    }
    let match_case = c.field("matchCase").and_then(serde_json::Value::as_bool).unwrap_or(true);
    let re = match crate::excel_regex::compile(&pattern_text, !match_case) {
        Ok(re) => re,
        Err(m) => return done(c, "cachedResult", err(ErrorCode::Value, m)),
    };
    if replace && !matches!(replacement, V::Str(_)) {
        return done(c, "cachedResult", err(ErrorCode::Type, "The replacement takes text"));
    }
    let raw = match c.wired("text") {
        None => V::str(""),
        Some(w) => match w.first() {
            None | Some(V::Undef) => V::Null,
            Some(v) => v.clone(),
        },
    };
    let replacement_text = value_text(&replacement);
    let apply = |cell: &V| -> V {
        if matches!(cell, V::Null | V::Undef) || cell.is_sol_error() {
            return if cell.is_sol_error() { cell.clone() } else { V::Null };
        }
        regex_apply(&op, &re, &value_text(cell), &replacement_text, occ).unwrap_or_else(|m| err(ErrorCode::Value, m))
    };
    let result = match &raw {
        V::Null => V::Null,
        _ if op == "extract_all" || op == "extract_groups" => match &raw {
            V::List(items) => apply(items.first().unwrap_or(&V::Undef)),
            other => apply(other),
        },
        V::List(items) => list(items.iter().map(apply).collect()),
        other => apply(other),
    };
    done(c, "cachedResult", result)
}

// ─── Cast ───────────────────────────────────────────────────────────────────────

/// A number as text through Excel's format codes, as TEXT writes it ([[C17]] shareImpl); a blank format is the
/// number at Excel's 15 digits ("General").
fn format_number_pattern(v: f64, format: &V) -> Result<String, V> {
    let s = match format {
        V::Str(s) => s.to_string(),
        _ => return Err(err(ErrorCode::Type, "The format takes text")),
    };
    if s.is_empty() {
        return Ok(crate::excel_functions::number_to_text(v));
    }
    crate::excel_format::format_number(v, &s).map_err(|m| err(ErrorCode::Value, m))
}

/// A value in an FC unit reads with the FC's label, `$5` or `5 km`; any other unit by its dimension.
fn unit_cell_text(
    cell: &crate::unit_dims::UnitCell,
    labels: &[(String, String, bool, Option<crate::unit_dims::Dim>)],
    format: &V,
) -> Result<String, V> {
    let found = cell.display.as_deref().and_then(|d| labels.iter().find(|(id, ..)| id == d));
    match found {
        Some((_, label, prefix, Some(dim))) if crate::unit_dims::dim_equal(dim, &cell.dim) => {
            let mag = format_number_pattern(crate::unit_expression::display_magnitude_of(cell), format)?;
            Ok(if *prefix { format!("{label}{mag}") } else { format!("{mag}{label}") })
        }
        _ => {
            let mag = format_number_pattern(cell.value, format)?;
            if cell.ratio {
                return Ok(format!("{mag}:1"));
            }
            let sym = crate::unit_lists::format_dim(&cell.dim);
            Ok(if sym.is_empty() { mag } else { format!("{mag} {sym}") })
        }
    }
}

/// The FC's unit labels the card carries (`unitLabels`): id, label, whether it leads, dimension.
fn unit_labels(c: &Call) -> Vec<(String, String, bool, Option<crate::unit_dims::Dim>)> {
    let rows = c.field("unitLabels").and_then(serde_json::Value::as_array).cloned().unwrap_or_default();
    rows.iter()
        .filter_map(|r| {
            let r = r.as_array()?;
            let dim = r
                .get(3)
                .and_then(serde_json::Value::as_object)
                .map(|o| o.iter().map(|(k, v)| (k.clone(), v.as_f64().unwrap_or(0.0))).collect());
            Some((r.first()?.as_str()?.to_string(), r.get(1)?.as_str()?.to_string(), r.get(2)?.as_bool()?, dim))
        })
        .collect()
}

/// A separator as `parse_value_text` takes it: its first character, or the default where blank.
fn separator(v: &V) -> String {
    match v {
        V::Str(s) => s.encode_utf16().next().map(|u| String::from_utf16_lossy(&[u])).unwrap_or_default(),
        V::List(l) => match l.first() {
            Some(V::Str(s)) => s.to_string(),
            _ => String::new(),
        },
        _ => String::new(),
    }
}

/// VALUE's reading with the separators a caller names (blank: the US form, with no group when the
/// decimal is `,`), `$`, `(5)` for negatives and trailing `%`.
fn parse_value_text(text: &str, decimal: &str, group: &str) -> f64 {
    let d = if decimal.is_empty() { "." } else { decimal };
    let g = if !group.is_empty() {
        Some(group)
    } else if d == "," {
        None
    } else {
        Some(",")
    };
    if g == Some(d) {
        return f64::NAN;
    }
    let mut t = trim_space(text).to_string();
    let mut pct = 0;
    while let Some(rest) = t.strip_suffix('%') {
        pct += 1;
        t = trim_space(rest).to_string();
    }
    // `/^\(.*\)$/`: `.` stops at a line terminator.
    let mut neg = false;
    if t.len() >= 2
        && t.starts_with('(')
        && t.ends_with(')')
        && !t[1..t.len() - 1].contains(['\n', '\r', '\u{2028}', '\u{2029}'])
    {
        neg = true;
        t = trim_space(&t[1..t.len() - 1]).to_string();
    }
    let sign_len = usize::from(t.starts_with(['+', '-']));
    if t[sign_len..].starts_with('$') {
        t.replace_range(sign_len..sign_len + 1, "");
    }
    let (int_part, frac) = match t.find(d) {
        Some(di) => (&t[..di], Some(&t[di + d.len()..])),
        None => (t.as_str(), None),
    };
    if frac.is_some_and(|f| g.is_some_and(|g| f.contains(g)) || f.contains(d)) {
        return f64::NAN;
    }
    let whole = match g {
        Some(g) => int_part.split(g).collect::<String>(),
        None => int_part.to_string(),
    };
    let n = crate::value_kinds::decimal_from_text(&match frac {
        Some(f) => format!("{whole}.{f}"),
        None => whole,
    });
    if n.is_nan() {
        f64::NAN
    } else {
        (if neg { -n } else { n }) / libm::pow(100.0, f64::from(pct))
    }
}

/// `a`, `bi`, `a+bi`, `a-bi`, `i` and `-i`, with j for i, spaces anywhere; else NaN parts.
fn parse_cx(s: &str) -> (f64, f64) {
    let t: String = trim_space(s).chars().filter(|&c| !crate::jsnum::is_space_char(c)).collect();
    let nan = (f64::NAN, f64::NAN);
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    // `\d+(?:\.\d*)?|\.\d+`
    let unsigned = |s: &str| match s.split_once('.') {
        Some((a, b)) => (digits(a) && (b.is_empty() || digits(b))) || (a.is_empty() && digits(b)),
        None => digits(s),
    };
    // NUM: `[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`
    let num = |s: &str| {
        let s = s.strip_prefix(['+', '-']).unwrap_or(s);
        match s.find(['e', 'E']) {
            Some(k) => unsigned(&s[..k]) && digits(s[k + 1..].strip_prefix(['+', '-']).unwrap_or(&s[k + 1..])),
            None => unsigned(s),
        }
    };
    let n = crate::value_kinds::decimal_from_text;
    if t.is_empty() {
        return nan;
    }
    if num(&t) {
        return (n(&t), 0.0);
    }
    let Some(body) = t.strip_suffix(['i', 'j']) else { return nan };
    let im = |m: &str| match m {
        "" | "+" => 1.0,
        "-" => -1.0,
        m => n(m),
    };
    let rest = body.strip_prefix(['+', '-']).unwrap_or(body);
    if rest.is_empty() || unsigned(rest) {
        return (0.0, im(body));
    }
    for (k, ch) in body.char_indices().skip(1) {
        if matches!(ch, '+' | '-') && num(&body[..k]) {
            let m = &body[k..];
            if m.len() == 1 || unsigned(&m[1..]) {
                return (n(&body[..k]), im(m));
            }
        }
    }
    nan
}

/// A scalar, `None` for a blank, or NaN parts where it can't convert.
fn cast_one(
    x: &V,
    target: &str,
    format: &V,
    seps: (&str, &str),
    labels: &[(String, String, bool, Option<crate::unit_dims::Dim>)],
    order: crate::excel_criteria::DateOrder,
) -> Result<V, V> {
    if matches!(x, V::Null | V::Undef) {
        return Ok(V::Null);
    }
    Ok(match target {
        "number" => match x {
            V::Cx(re, _) => V::Num(*re),
            // Cast is the one place a date becomes its serial ([[C137]] datesNeverSerials).
            V::Num(n) | V::Date(n) => V::Num(*n),
            V::Bool(b) => V::Num(f64::from(u8::from(*b))),
            V::Str(s) => V::Num(parse_value_text(s, seps.0, seps.1)),
            _ => V::Num(f64::NAN),
        },
        "text" => match x {
            V::Unit(u) => V::str(&unit_cell_text(u, labels, format)?),
            V::Cx(re, im) => V::str(&crate::eval::format_cx(*re, *im)),
            V::Str(_) => x.clone(),
            V::Date(n) => {
                let pattern = match format {
                    V::Str(s) if s.is_empty() => return Ok(V::str(&crate::date_values::date_text(*n))),
                    V::Str(s) => s.to_string(),
                    other => value_text(other),
                };
                V::str(&crate::excel_format::format_number(*n, &pattern).map_err(|m| err(ErrorCode::Value, m))?)
            }
            V::Num(n) => V::str(&format_number_pattern(*n, format)?),
            V::Bool(b) => V::str(if *b { "TRUE" } else { "FALSE" }),
            other => V::str(&value_text(other)),
        },
        "date" => match x {
            V::Num(n) | V::Date(n) => V::Date(*n),
            V::Str(s) => {
                use crate::excel_criteria::{read_date_text, DateReading};
                match read_date_text(s, order) {
                    DateReading::Serial(d) => V::Date(d),
                    DateReading::Ambiguous(e) => V::err(e),
                    DateReading::NotADate => V::Num(f64::NAN),
                }
            }
            _ => V::Num(f64::NAN),
        },
        "complex" => match x {
            V::Cx(..) => x.clone(),
            V::Num(n) => V::Cx(*n, 0.0),
            V::Str(s) => {
                let (re, im) = parse_cx(s);
                V::Cx(re, im)
            }
            _ => V::Cx(f64::NAN, f64::NAN),
        },
        _ => {
            use crate::frame::FrameCell;
            use crate::value_kinds::{coerce_logical, Logical};
            let cell = match x {
                V::Num(n) => FrameCell::Num(*n),
                V::Bool(b) => FrameCell::Bool(*b),
                V::Str(s) => FrameCell::Str(s.clone()),
                _ => FrameCell::Num(f64::NAN),
            };
            match coerce_logical(&cell) {
                Logical::Bool(b) => V::Bool(b),
                _ => V::Num(f64::NAN),
            }
        }
    })
}

fn cast_failed(v: &V) -> bool {
    match v {
        V::Cx(re, im) => re.is_nan() || im.is_nan(),
        V::Num(n) | V::Date(n) => n.is_nan(),
        _ => false,
    }
}

/// What the card shows, a complex value as its text.
fn cast_display(v: &V, target: &str) -> V {
    match (v, target) {
        (V::Cx(re, im), "complex") => V::str(&crate::eval::format_cx(*re, *im)),
        _ => v.clone(),
    }
}

/// An InlineCast ([[D113]] inlineCast): Cast's conversion to `target` over a card's result, cell by cell at any depth,
/// with Cast's defaults (no format, the default separators); a cell that won't convert is `#VALUE!`, a blank stays blank.
pub(crate) fn inline_cast(v: &V, target: &str) -> V {
    let v = if target == "text" { v.clone() } else { super::list::strip_unit_cells(v) };
    let format = V::str("");
    fn walk(v: &V, one: &dyn Fn(&V) -> V) -> V {
        match v {
            V::List(items) => list(items.iter().map(|x| walk(x, one)).collect()),
            V::Err(_) => v.clone(),
            x => one(x),
        }
    }
    let one = |x: &V| match cast_one(x, target, &format, ("", ""), &[], crate::excel_criteria::DateOrder::Auto) {
        Ok(r) if cast_failed(&r) => err(ErrorCode::Value, format!("Could not convert the value to {target}")),
        Ok(r) => r,
        Err(e) => e,
    };
    walk(&v, &one)
}

fn cast(c: &mut Call) -> Answer {
    let target = c.field_str("op", "text").to_string();
    let first = match c.wired("value").and_then(|w| w.first()) {
        None | Some(V::Undef) => V::Undef,
        Some(v) => v.clone(),
    };
    let raw = if target == "text" { first } else { super::list::strip_unit_cells(&first) };
    let has = |k: &str| c.sockets.iter().any(|s| s.key == k);
    let arg = |k: &str| if has(k) { str_val(c, k) } else { V::str("") };
    let (format, decimal, group) = (arg("format"), arg("decimal_sep"), arg("group_sep"));
    if [&format, &decimal, &group].iter().any(|v| matches!(v, V::Null)) {
        return done(c, "cachedResult", V::Null);
    }
    let labels = unit_labels(c);
    let (decimal, group) = (separator(&decimal), separator(&group));
    let failed = || err(ErrorCode::Value, format!("Could not convert the value to {target}"));
    let order = crate::excel_criteria::DateOrder::parse(c.field_str("dateOrder", "")).unwrap_or_default();
    let one = |x: &V| cast_one(x, &target, &format, (&decimal, &group), &labels, order);
    if let V::List(items) = &raw {
        let out: Vec<V> = items
            .iter()
            .map(|x| one(x).map(|v| if cast_failed(&v) { failed() } else { v }))
            .collect::<Result<_, _>>()?;
        let shown = out
            .iter()
            .map(|v| match (v, target.as_str()) {
                (V::Null, _) | (_, "number" | "date" | "logical") => v.clone(),
                (V::Err(e), _) => V::str(e.code.as_str()),
                (v, t) => cast_display(v, t),
            })
            .collect();
        c.show("cachedResult", list(shown));
        return Ok(vec![("result".into(), Cv::from(list(out)))]);
    }
    let scalar = one(&raw)?;
    if cast_failed(&scalar) {
        return done(c, "cachedResult", failed());
    }
    c.show("cachedResult", cast_display(&scalar, &target));
    Ok(vec![("result".into(), Cv::from(scalar))])
}

// ─── UUID and Promo, each a draw held until the generation advances ([[C23]] calcModes) ─

fn uuid(c: &mut Call) -> Answer {
    let generated = V::str(&c.drawn_text("generated", crate::fns_random::uuid_v4));
    c.show("cachedText", generated.clone());
    Ok(vec![("result".into(), Cv::from(generated))])
}

const PROMO_LINES: [&str; 7] = [
    "Solenoid: wire it, don't write it. ⚡",
    "Spreadsheets, but the formulas have shapes now.",
    "No more =SUM(A1:A8). Just plug it in.",
    "Every cell wishes it were a node.",
    "Built with Excel envy and React. 🔌",
    "If you can chart it, you can wire it.",
    "Ctrl+Z is a love language.",
];

fn promo(c: &mut Call) -> Answer {
    let roll = c.rolls("roll", 1, false)[0];
    let at = (roll * PROMO_LINES.len() as f64).floor();
    let line = if at >= 0.0 && at < PROMO_LINES.len() as f64 { V::str(PROMO_LINES[at as usize]) } else { V::Undef };
    c.show("cachedText", line.clone());
    Ok(vec![("value".into(), Cv::from(line))])
}
