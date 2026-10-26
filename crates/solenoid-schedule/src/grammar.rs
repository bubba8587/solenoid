// [[C70]] oneScheduleRule
//! The predecessor grammar a plan's import border reads: `3FS+2d, 5SS-1w`.

use crate::num::{is_js_space, js_trim, math_round};
use crate::{Dependency, LinkType};

struct Tail {
    ty: LinkType,
    lag: f64,
    elapsed: bool,
}

fn ws(s: &str) -> &str {
    s.trim_start_matches(is_js_space)
}

fn link_type(s: &str) -> Option<(LinkType, &str)> {
    let head = s.get(..2)?;
    LinkType::parse(&head.to_ascii_uppercase()).map(|t| (t, &s[2..]))
}

/// `±n` with an optional unit: `d` (working days), `w` or `wk` (5 days), `h` (8 per day) or `ed` (elapsed days).
fn lag(s: &str) -> Option<(f64, bool, &str)> {
    let sign = match s.chars().next()? {
        '+' => 1.0,
        '-' => -1.0,
        _ => return None,
    };
    let r = ws(&s[1..]);
    let int = r.bytes().take_while(u8::is_ascii_digit).count();
    if int == 0 {
        return None;
    }
    let frac = match r[int..].strip_prefix('.') {
        Some(f) if f.starts_with(|c: char| c.is_ascii_digit()) => 1 + f.bytes().take_while(u8::is_ascii_digit).count(),
        _ => 0,
    };
    let n: f64 = sign * r[..int + frac].parse::<f64>().ok()?;
    let r = &r[int + frac..];
    let after = ws(r);
    let lower = after.get(..2).map(str::to_ascii_lowercase);
    let (n, elapsed, rest) = match (lower.as_deref(), after.get(..1).map(str::to_ascii_lowercase).as_deref()) {
        (Some("ed"), _) => (n, true, &after[2..]),
        (Some("wk"), _) => (n * 5.0, false, &after[2..]),
        (_, Some("d")) => (n, false, &after[1..]),
        (_, Some("w")) => (n * 5.0, false, &after[1..]),
        (_, Some("h")) => (n / 8.0, false, &after[1..]),
        _ => (n, false, r),
    };
    Some((n, elapsed, rest))
}

/// What follows a reference: an optional type, an optional lag, nothing else. A name's type is set off by a space,
/// so a name ending in `ss` stays whole.
fn tail(s: &str, glued: bool) -> Option<Tail> {
    let mut r = s;
    let mut ty = LinkType::FS;
    if glued || r.starts_with(is_js_space) {
        if let Some((t, rest)) = link_type(ws(r)) {
            if rest.is_empty() || rest.starts_with(|c: char| is_js_space(c) || c == '+' || c == '-') {
                ty = t;
                r = rest;
            }
        }
    }
    let r = ws(r);
    let (lag, elapsed, r) = match lag(r) {
        Some(l) => l,
        None => (0.0, false, r),
    };
    ws(r).is_empty().then(|| Tail { ty, lag: math_round(lag * 1000.0) / 1000.0, elapsed })
}

/// Splits a cell at commas and semicolons. A row number resolves through the 1-based `names`, any other reference
/// is taken as a name, and a token that reads as neither comes back as an error.
pub fn parse_predecessor_text(text: &str, names: &[String]) -> (Vec<Dependency>, Vec<String>) {
    let mut deps = Vec::new();
    let mut errors = Vec::new();
    for raw in text.split([',', ';']) {
        let token = js_trim(raw);
        if token.is_empty() {
            continue;
        }
        let digits = token.bytes().take_while(u8::is_ascii_digit).count();
        let by_row = (digits > 0).then(|| tail(&token[digits..], true)).flatten();
        let (task, t) = match by_row {
            Some(t) => {
                let row: usize = token[..digits].parse().unwrap_or(0);
                match row.checked_sub(1).and_then(|i| names.get(i)).filter(|n| !n.is_empty()) {
                    Some(name) => (name.clone(), t),
                    None => {
                        errors.push(token.to_string());
                        continue;
                    }
                }
            }
            None => {
                let split =
                    token.char_indices().skip(1).map(|(i, _)| i).find_map(|i| tail(&token[i..], false).map(|t| (i, t)));
                match split {
                    Some((i, t)) => (js_trim(&token[..i]).to_string(), t),
                    None => (token.to_string(), Tail { ty: LinkType::FS, lag: 0.0, elapsed: false }),
                }
            }
        };
        deps.push(Dependency { task, ty: t.ty, lag: t.lag, elapsed: t.elapsed.then_some(true) });
    }
    (deps, errors)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Task, type, lag and elapsed.
    type Link = (String, &'static str, f64, bool);

    fn read(text: &str, names: &[&str]) -> (Vec<Link>, Vec<String>) {
        let names: Vec<String> = names.iter().map(|n| n.to_string()).collect();
        let (deps, errors) = parse_predecessor_text(text, &names);
        (deps.into_iter().map(|d| (d.task, d.ty.as_str(), d.lag, d.elapsed == Some(true))).collect(), errors)
    }

    #[test]
    fn rows_types_lags_and_units() {
        let (deps, errors) = read("1FS+2d, 2SS; 2 SF +3w, 1+4h, 2-2ed, 9", &["A", "B"]);
        assert_eq!(
            deps,
            [
                ("A".into(), "FS", 2.0, false),
                ("B".into(), "SS", 0.0, false),
                ("B".into(), "SF", 15.0, false),
                ("A".into(), "FS", 0.5, false),
                ("B".into(), "FS", -2.0, true)
            ]
        );
        assert_eq!(errors, ["9"]);
    }

    /// A name is the reference up to a spaced type or a lag, so a name that ends like a unit or a type stays whole.
    #[test]
    fn names_stay_whole() {
        let (deps, _) = read("Build, Class, Pour FS+1wk, Wire and plumb SS", &[]);
        assert_eq!(
            deps,
            [
                ("Build".into(), "FS", 0.0, false),
                ("Class".into(), "FS", 0.0, false),
                ("Pour".into(), "FS", 5.0, false),
                ("Wire and plumb".into(), "SS", 0.0, false)
            ]
        );
    }
}
