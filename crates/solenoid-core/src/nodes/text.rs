//! [[D102]] graphOnCore, [[B11]] maximalMerge. `nodes/text.ts`'s card bodies: each shares its kernel with the formula
//! of its name ([[C17]] shareImpl), broadcast item by item over a list ([[C24]] arraySemantics); and `nodes/cast.ts`'s
//! Cast, which reads a value as each of the five targets.

use super::kit::{broadcast_err, core_call};
use super::{err, list, Answer, Call};
use crate::error_value::sol_error;
use crate::excel_functions::{js_string_of, to_f64_js, V};
use crate::jsnum::js_trim;

/// `readAsRole`'s raw value: unwired, the typed literal (a number's, else a text's); wired, the first cable's.
pub(crate) fn role_value(c: &Call, key: &str) -> V {
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
        "TextAfterBeforeNode" => text_after_before(c),
        "RegexNode" => regex(c),
        "CastNode" => cast(c),
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
    let mode = V::Num(if c.field("matchCase").and_then(serde_json::Value::as_bool).unwrap_or(true) { 0.0 } else { 1.0 });
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

/// What `!x` reads as false.
fn js_falsy(v: &V) -> bool {
    match v {
        V::Null | V::Undef => true,
        V::Str(s) => s.is_empty(),
        V::Num(n) => *n == 0.0 || n.is_nan(),
        V::Bool(b) => !b,
        _ => false,
    }
}

/// `regexOccurrence`: blank is 0 (every match), a fraction truncates, a negative counts from the end; None when
/// non-finite.
fn regex_occurrence(raw: &V) -> Option<f64> {
    if matches!(raw, V::Null | V::Undef) || matches!(raw, V::Str(s) if s.is_empty()) {
        return Some(0.0);
    }
    let n = super::list::js_number(raw).trunc();
    n.is_finite().then_some(n + 0.0)
}

/// A pattern compiled with the card's flags, as `regexApply` runs it on one text.
struct Pattern {
    re: std::rc::Rc<regress::Regex>,
    global: bool,
    sticky: bool,
    unicode: bool,
}

impl Pattern {
    fn all(&self, t: &[u16]) -> Vec<regress::Match> {
        crate::text_ops::matches_with(&self.re, t, self.sticky, self.unicode)
    }

    fn first(&self, t: &[u16]) -> Option<regress::Match> {
        crate::text_ops::exec_from(&self.re, t, 0, self.sticky, self.unicode)
    }
}

fn utf16(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

fn text_of(t: &[u16]) -> V {
    V::str(&String::from_utf16_lossy(t))
}

/// `regexApply` on one text: `match` with g answers every match, so the groups of a global pattern are the matches
/// after the first, as in JS.
fn regex_apply(op: &str, p: &Pattern, text: &[u16], replacement: &[u16]) -> V {
    match op {
        "test" => V::Num(if p.first(text).is_some() { 1.0 } else { 0.0 }),
        "extract" => p.first(text).map_or_else(|| V::str(""), |m| text_of(&text[m.range])),
        "extract_all" => list(p.all(text).into_iter().map(|m| text_of(&text[m.range])).collect()),
        "extract_groups" if p.global => list(p.all(text).into_iter().skip(1).map(|m| text_of(&text[m.range])).collect()),
        "extract_groups" => list(match p.first(text) {
            Some(m) => m.captures.iter().map(|g| g.clone().map_or_else(|| V::str(""), |r| text_of(&text[r]))).collect(),
            None => Vec::new(),
        }),
        _ => text_of(&crate::text_ops::replace_matches(&p.all(text), text, replacement)),
    }
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
    let flags = match c.string_literal("flags") {
        V::Str(s) => s.to_string(),
        _ => String::new(),
    };
    let Some(occ) = regex_occurrence(&occurrence) else { return blank(c) };
    if js_falsy(&pattern) {
        return blank(c);
    }
    let Some((jf, global, sticky)) = crate::js_regex::parse_flags(&flags) else { return blank(c) };
    let re = match crate::js_regex::compile_with(&utf16(&js_string_of(&pattern)), jf) {
        crate::js_regex::Compiled::Ok(re) => re,
        crate::js_regex::Compiled::Invalid => return blank(c),
        crate::js_regex::Compiled::Unsure => return done(c, "cachedResult", err("#VALUE!", "This pattern uses a feature the engine can't run yet")),
    };
    let p = Pattern { re, global, sticky, unicode: jf.unicode || jf.unicode_sets };
    let raw = match c.wired("text") {
        None => V::str(""),
        Some(w) => match w.first() {
            None | Some(V::Undef) => V::Null,
            Some(v) => v.clone(),
        },
    };
    let replacement_text = utf16(&js_string_of(&replacement));
    let apply = |cell: &V| -> Result<V, V> {
        if matches!(cell, V::Null | V::Undef) || cell.is_sol_error() {
            return Ok(if cell.is_sol_error() { cell.clone() } else { V::Null });
        }
        let t = utf16(&js_string_of(cell));
        if replace && occ != 0.0 {
            let all = p.all(&t);
            let target = if occ < 0.0 { all.len() as f64 + occ + 1.0 } else { occ };
            // `expandReplacement` calls the replacement's own `replace`, which only text has.
            if target >= 1.0 && target <= all.len() as f64 && !matches!(replacement, V::Str(_)) {
                return Err(super::frames::thrown("replacement.replace is not a function"));
            }
            return Ok(text_of(&crate::text_ops::replace_nth_of(&all, &t, &replacement_text, occ)));
        }
        Ok(regex_apply(&op, &p, &t, &replacement_text))
    };
    let result = match &raw {
        V::Null => V::Null,
        _ if op == "extract_all" || op == "extract_groups" => match &raw {
            V::List(items) => apply(items.first().unwrap_or(&V::Undef))?,
            other => apply(other)?,
        },
        V::List(items) => list(items.iter().map(apply).collect::<Result<Vec<_>, _>>()?),
        other => apply(other)?,
    };
    done(c, "cachedResult", result)
}

// ─── Cast (cast.ts) ─────────────────────────────────────────────────────────────

/// `formatNumberPattern`: TEXT's few formats a cast takes, `0.00` and `0.0%`; anything else the number as JS writes it.
fn format_number_pattern(v: f64, format: &V) -> Result<String, V> {
    let s = match format {
        V::Str(s) => s.to_string(),
        // `format` is a list here, whose `split` and `endsWith` aren't functions.
        other => {
            let s = js_string_of(other);
            let zeros = s.strip_prefix('0').is_some_and(|r| r.is_empty() || r.strip_prefix('.').is_some_and(|z| !z.is_empty() && z.bytes().all(|b| b == b'0')));
            return Err(super::frames::thrown(if zeros { "format.split is not a function" } else { "format.endsWith is not a function" }));
        }
    };
    let decimals = |f: &str| f.split('.').nth(1).map_or(0, |d| d.encode_utf16().count()) as f64;
    let fixed = |x: f64, d: f64| crate::jsnum::to_fixed(x, d).ok_or_else(|| super::frames::thrown("toFixed() digits argument must be between 0 and 100"));
    if s.is_empty() || s == "general" {
        return Ok(crate::jsnum::number_to_string(v));
    }
    if s.strip_prefix('0').is_some_and(|r| r.is_empty() || r.strip_prefix('.').is_some_and(|z| !z.is_empty() && z.bytes().all(|b| b == b'0'))) {
        return fixed(v, decimals(&s));
    }
    if let Some(inner) = s.strip_suffix('%') {
        return Ok(fixed(v * 100.0, decimals(inner))? + "%");
    }
    Ok(crate::jsnum::number_to_string(v))
}

/// `unitCellText`: a value in an FC unit reads with the FC's label, `$5` or `5 km`; any other unit by its dimension.
fn unit_cell_text(cell: &crate::unit_dims::UnitCell, labels: &[(String, String, bool, Option<crate::unit_dims::Dim>)], format: &V) -> Result<String, V> {
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
            let dim = r.get(3).and_then(serde_json::Value::as_object).map(|o| o.iter().map(|(k, v)| (k.clone(), v.as_f64().unwrap_or(0.0))).collect());
            Some((r.first()?.as_str()?.to_string(), r.get(1)?.as_str()?.to_string(), r.get(2)?.as_bool()?, dim))
        })
        .collect()
}

/// A separator as `parseValueText` takes it: its first character, or the default where blank.
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

/// `parseValueText`: VALUE's reading with the separators a caller names (blank: the US form, with no group when the
/// decimal is `,`), `$`, `(5)` for negatives and trailing `%`.
fn parse_value_text(text: &str, decimal: &str, group: &str) -> f64 {
    let d = if decimal.is_empty() { "." } else { decimal };
    let g = if !group.is_empty() { Some(group) } else if d == "," { None } else { Some(",") };
    if g == Some(d) {
        return f64::NAN;
    }
    let mut t = js_trim(text).to_string();
    let mut pct = 0;
    while let Some(rest) = t.strip_suffix('%') {
        pct += 1;
        t = js_trim(rest).to_string();
    }
    // `/^\(.*\)$/`: `.` stops at a line terminator.
    let mut neg = false;
    if t.len() >= 2 && t.starts_with('(') && t.ends_with(')') && !t[1..t.len() - 1].contains(['\n', '\r', '\u{2028}', '\u{2029}']) {
        neg = true;
        t = js_trim(&t[1..t.len() - 1]).to_string();
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
    if n.is_nan() { f64::NAN } else { (if neg { -n } else { n }) / crate::excel_functions::js_pow(100.0, f64::from(pct)) }
}

/// `parseCx` (cast.ts): `a`, `bi`, `a+bi`, `a-bi`, `i` and `-i`, with j for i, spaces anywhere; else NaN parts.
fn parse_cx(s: &str) -> (f64, f64) {
    let t: String = js_trim(s).chars().filter(|&c| !crate::jsnum::is_js_space(c)).collect();
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
    let n = crate::jsnum::string_to_number;
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

/// What `castOne` answers for one value: a scalar, `None` for a blank, or NaN parts where it can't convert.
fn cast_one(x: &V, target: &str, format: &V, dateish: bool, seps: (&str, &str), labels: &[(String, String, bool, Option<crate::unit_dims::Dim>)]) -> Result<V, V> {
    if matches!(x, V::Null | V::Undef) {
        return Ok(V::Null);
    }
    Ok(match target {
        "number" => match x {
            V::Cx(re, _) => V::Num(*re),
            V::Num(n) => V::Num(*n),
            V::Bool(b) => V::Num(f64::from(u8::from(*b))),
            V::Str(s) => V::Num(parse_value_text(s, seps.0, seps.1)),
            _ => V::Num(f64::NAN),
        },
        "text" => match x {
            V::Unit(u) => V::str(&unit_cell_text(u, labels, format)?),
            V::Cx(re, im) => V::str(&crate::eval::format_cx(*re, *im)),
            V::Str(_) => x.clone(),
            V::Num(n) if dateish => {
                let pattern = match format {
                    V::Str(s) if s.is_empty() => "DD-MMM-YYYY".to_string(),
                    V::Str(s) => s.to_string(),
                    other => js_string_of(other),
                };
                V::str(&crate::date_serial::format_date_serial(*n, &pattern))
            }
            V::Num(n) => V::str(&format_number_pattern(*n, format)?),
            V::Bool(b) => V::str(if *b { "TRUE" } else { "FALSE" }),
            other => V::str(&js_string_of(other)),
        },
        "date" => match x {
            V::Num(n) => V::Num(*n),
            V::Str(s) => {
                use crate::excel_criteria::{parse_date, DateReading};
                match parse_date(s) {
                    DateReading::Serial(d) => V::Num(d),
                    DateReading::Bail => return Err(super::frames::thrown("Cast left a reading to the TS")),
                    _ => V::Num(f64::NAN),
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
        V::Num(n) => n.is_nan(),
        _ => false,
    }
}

/// `displayScalar`: what the card shows, a complex value as its text.
fn cast_display(v: &V, target: &str) -> V {
    match (v, target) {
        (V::Cx(re, im), "complex") => V::str(&crate::eval::format_cx(*re, *im)),
        _ => v.clone(),
    }
}

fn cast(c: &mut Call) -> Answer {
    let target = c.field_str("target", "text").to_string();
    let first = match c.wired("value").and_then(|w| w.first()) {
        None | Some(V::Undef) => V::Undef,
        Some(v) => v.clone(),
    };
    let raw = if target == "text" { first } else { super::list::strip_unit_cells(&first) };
    let has = |k: &str| c.sockets.iter().any(|(s, _, _)| s == k);
    let arg = |k: &str| if has(k) { str_val(c, k) } else { V::str("") };
    let (format, decimal, group) = (arg("format"), arg("decimal_sep"), arg("group_sep"));
    if [&format, &decimal, &group].iter().any(|v| matches!(v, V::Null)) {
        return done(c, "cachedResult", V::Null);
    }
    let dateish = matches!(c.field("sourceType").and_then(serde_json::Value::as_str), Some("date" | "datelist" | "datecombo" | "datetable"));
    let labels = unit_labels(c);
    let (decimal, group) = (separator(&decimal), separator(&group));
    let failed = || err("#VALUE!", format!("Could not convert the value to {target}"));
    let one = |x: &V| cast_one(x, &target, &format, dateish, (&decimal, &group), &labels);
    if let V::List(items) = &raw {
        let out: Vec<V> = items.iter().map(|x| one(x).map(|v| if cast_failed(&v) { failed() } else { v })).collect::<Result<_, _>>()?;
        let shown = out
            .iter()
            .map(|v| match (v, target.as_str()) {
                (V::Null, _) | (_, "number" | "date" | "logical") => v.clone(),
                (V::Err(e), _) => V::str(&e.code),
                (v, t) => cast_display(v, t),
            })
            .collect();
        c.show("cachedResult", list(shown));
        return Ok(vec![("result".into(), list(out))]);
    }
    let scalar = one(&raw)?;
    if cast_failed(&scalar) {
        return done(c, "cachedResult", failed());
    }
    c.show("cachedResult", cast_display(&scalar, &target));
    Ok(vec![("result".into(), scalar)])
}
