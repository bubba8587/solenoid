//! [[D102]] graphOnCore. `nodes/text.ts`'s card bodies: each shares its kernel with the formula of its name
//! ([[C17]] shareImpl), broadcast item by item over a list ([[C24]] arraySemantics).

use super::kit::{broadcast_err, core_call};
use super::{err, list, Answer, Call};
use crate::error_value::sol_error;
use crate::excel_functions::{to_f64_js, V};

/// `readAsRole`'s raw value: unwired, the typed literal (a number's, else a text's); wired, the first cable's.
fn role_value(c: &Call, key: &str) -> V {
    let lit = match c.literal(key) {
        V::Undef | V::Null => c.string_literal(key),
        v => v,
    };
    let v = match c.wired(key) {
        None | Some([]) => lit,
        Some([first, ..]) => first.clone(),
    };
    if matches!(v, V::Undef) { V::Null } else { v }
}

/// `readRole` of a `setting` role ([[D86]] blankRoles): a blank reads as `blank`, item by item in a list.
pub(crate) fn setting(c: &Call, key: &str, blank: V) -> V {
    fn fill(v: &V, blank: &V) -> V {
        match v {
            V::List(l) => list(l.iter().map(|x| fill(x, blank)).collect()),
            V::Null | V::Undef => blank.clone(),
            other => other.clone(),
        }
    }
    let v = role_value(c, key);
    if v.is_sol_error() { v } else { fill(&v, &blank) }
}

/// `readRole` of the `required` role: a blank is `#SYNTAX!`, item by item in a list.
pub(crate) fn required(c: &Call, key: &str) -> V {
    fn need(v: &V, label: &str) -> V {
        match v {
            V::Err(_) => v.clone(),
            V::List(l) => list(l.iter().map(|x| need(x, label)).collect()),
            V::Null | V::Undef => err("#SYNTAX!", format!("{label} is blank, and it has no default")),
            other => other.clone(),
        }
    }
    need(&role_value(c, key), &c.label(key))
}

/// `leftOutAs`: a setting left out takes the card's default, whole or item by item.
pub(crate) fn left_out_as(v: V, dflt: f64) -> V {
    match v {
        V::Undef => V::Num(dflt),
        V::List(l) => list(l.iter().map(|x| if matches!(x, V::Undef) { V::Num(dflt) } else { x.clone() }).collect()),
        other => other,
    }
}

/// `readInput(inputs[key], this.stringLiterals[key] ?? dflt)`.
fn str_input(c: &Call, key: &str, dflt: &str) -> V {
    let lit = match c.string_literal(key) {
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
    to_f64_js(v).floor()
}

/// `Math.max(a, b)`: NaN wins, and +0 beats -0.
pub(crate) fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a == b {
        if a.is_sign_positive() { a } else { b }
    } else {
        a.max(b)
    }
}

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "TextTransformNode" => {
            let name = match c.field_str("op", "upper") {
                "lower" => "LOWER",
                "trim" => "TRIM",
                "proper" => "PROPER",
                "clean" => "CLEAN",
                "unaccent" => "UNACCENT",
                "slugify" => "SLUGIFY",
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
        "ExactNode" => {
            let r = broadcast_err(&[str_val(c, "a"), str_val(c, "b")], |o| core_call("EXACT", &[o[0].clone(), o[1].clone()]));
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
            let args = [c.read_num("number", 0.0), left_out_as(setting(c, "decimals", V::Undef), 2.0)];
            let r = broadcast_err(&args, |o| core_call("FIXED", &[o[0].clone(), o[1].clone(), no_commas.clone()]));
            done(c, "cachedText", r)
        }
        "FormatDollarNode" => {
            let args = [c.read_num("number", 0.0), left_out_as(setting(c, "decimals", V::Undef), 2.0)];
            let r = broadcast_err(&args, |o| core_call("DOLLAR", &[o[0].clone(), o[1].clone()]));
            done(c, "cachedText", r)
        }
        "ReverseTextNode" => each_text(c, "cachedText", "REVERSETEXT"),
        "SpellNumberNode" => {
            let value = match c.wired("value") {
                None | Some([]) => c.literal("value"),
                Some([first, ..]) => if matches!(first, V::Undef) { V::Null } else { first.clone() },
            };
            let name = if c.field_str("mode", "words") == "ordinal" { "ORDINAL" } else { "SPELLNUMBER" };
            let r = broadcast_err(&[value], |o| core_call(name, &[o[0].clone()]));
            done(c, "cachedText", r)
        }
        "FuzzyMatchNode" => fuzzy_match(c),
        "TextSimilarityNode" => {
            let method = V::str(c.field_str("method", "ratio"));
            let r = broadcast_err(&[str_val(c, "a"), str_val(c, "b")], |o| core_call("SIMILARITY", &[o[0].clone(), o[1].clone(), method.clone()]));
            done(c, "cachedResult", r)
        }
        _ => return None,
    })
}

fn done(c: &mut Call, field: &str, result: V) -> Answer {
    c.show(field, result.clone());
    Ok(vec![("result".into(), result)])
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
    let r = broadcast_err(&[str_val(c, "text")], |o| core_call("PADTEXT", &[o[0].clone(), w.clone(), side.clone(), fill.clone()]));
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
        return Ok(vec![("result".into(), w)]);
    }
    if matches!(text, V::Null) {
        return done(c, "cachedResult", V::Null);
    }
    if to_f64_js(&w) < 1.0 {
        return done(c, "cachedResult", err("#DOMAIN!", "Width must be at least 1"));
    }
    let r = core_call("WRAPTEXT", &[text, w]);
    done(c, "cachedResult", r)
}

fn concat(c: &mut Call) -> Answer {
    let keys: Vec<String> = c.sockets.iter().map(|(k, _, _)| k.clone()).collect();
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
    let args = [str_val(c, "text"), str_val(c, "old_text"), str_val(c, "new_text"), setting(c, "instance", V::Num(0.0))];
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
    let r = broadcast_err(&args, |o| {
        let s = js_max(1.0, js_floor(o[1]));
        let n = js_max(0.0, js_floor(o[2]));
        core_call("REPLACE", &[o[0].clone(), V::Num(s), V::Num(n), o[3].clone()])
    });
    done(c, "cachedText", r)
}

fn rept(c: &mut Call) -> Answer {
    let args = [str_val(c, "text"), required(c, "times")];
    let r = broadcast_err(&args, |o| core_call("REPT", &[o[0].clone(), V::Num(js_max(0.0, js_floor(o[1])))]));
    done(c, "cachedText", r)
}

fn char_code(c: &mut Call) -> Answer {
    let r = if c.field_str("op", "char") == "char" {
        broadcast_err(&[c.read_num("code", 65.0)], |o| core_call("CHAR", &[o[0].clone()]))
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
    Ok(vec![("result".into(), result)])
}

fn text_split(c: &mut Call) -> Answer {
    let text = str_val(c, "text");
    let delimiter = required(c, "delimiter");
    if delimiter.is_sol_error() {
        c.show("cachedResult", V::Null);
        return Ok(vec![("result".into(), delimiter)]);
    }
    if matches!(text, V::Null) {
        return done(c, "cachedResult", V::Null);
    }
    let r = core_call("TEXTSPLIT", &[text, delimiter]);
    done(c, "cachedResult", r)
}

const ROMAN: [(f64, &str); 13] = [
    (1000.0, "M"), (900.0, "CM"), (500.0, "D"), (400.0, "CD"), (100.0, "C"), (90.0, "XC"), (50.0, "L"),
    (40.0, "XL"), (10.0, "X"), (9.0, "IX"), (5.0, "V"), (4.0, "IV"), (1.0, "I"),
];

fn roman(raw: &V) -> V {
    let n = js_floor(raw);
    if n < 1.0 || n > 3999.0 {
        return err("#VALUE!", "ROMAN is defined only for 1–3999");
    }
    let mut out = String::new();
    let mut rem = n;
    for (v, s) in ROMAN {
        while rem >= v {
            out.push_str(s);
            rem -= v;
        }
    }
    V::str(&out)
}

/// The Arabic reading, from the right.
fn arabic(raw: &V) -> V {
    let V::Str(s) = raw else {
        return V::err(sol_error("#VALUE!", "ARABIC needs text"));
    };
    let upper = s.to_uppercase();
    let text = crate::jsnum::js_trim(&upper);
    if text.is_empty() {
        return V::Null;
    }
    let (mut out, mut prev) = (0.0, 0.0);
    for ch in text.chars().rev() {
        let v = match ch {
            'M' => 1000.0,
            'D' => 500.0,
            'C' => 100.0,
            'L' => 50.0,
            'X' => 10.0,
            'V' => 5.0,
            'I' => 1.0,
            _ => return err("#VALUE!", format!("\"{text}\" is not a valid Roman numeral")),
        };
        if v < prev {
            out -= v;
        } else {
            out += v;
            prev = v;
        }
    }
    V::Num(out)
}

fn roman_arabic(c: &mut Call) -> Answer {
    let r = if c.field_str("op", "roman") == "roman" {
        broadcast_err(&[c.read_num("number", 1.0)], |o| roman(o[0]))
    } else {
        broadcast_err(&[str_val(c, "text")], |o| arabic(o[0]))
    };
    done(c, "cachedResult", r)
}

/// `fuzzyBest`: the candidate scoring highest at or above the threshold, the first on a tie.
fn fuzzy_best(needle: &V, cands: &[V], method: &V, threshold: f64) -> Result<Option<(V, f64)>, V> {
    let mut best: Option<(V, f64)> = None;
    for cand in cands {
        // `textSimilarity` spreads its text into code points; anything else isn't iterable.
        if !matches!(needle, V::Str(_)) {
            return Err(err("#ERROR!", "This node failed to compute: a is not iterable"));
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
        _ => return Err(err("#ERROR!", "This node failed to compute: ((intermediate value) ?? []).filter is not a function")),
    };
    let threshold = match setting(c, "threshold", V::Undef) {
        V::Undef | V::Null => 0.6,
        v => super::list::js_number(&v),
    };
    if matches!(needle, V::Null) {
        c.show("cachedMatch", V::Null);
        c.show("cachedScore", V::Null);
        return Ok(vec![("match".into(), V::Null), ("score".into(), V::Null)]);
    }
    let method = V::str(match c.field_str("method", "ratio") {
        "levenshtein" => "ratio",
        m => m,
    });
    let na = || err("#N/A", "No candidate is similar enough");
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
    Ok(vec![("match".into(), m), ("score".into(), s)])
}
