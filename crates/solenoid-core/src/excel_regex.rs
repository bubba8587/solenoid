// [[B27]] computeAnswersToExcel, [[C130]] rustCore
//! Regular expressions as Excel's REGEX functions read them (PCRE2's syntax) on fancy-regex, for formulas, the Regex
//! card, Data Validation and TEMPLATE (`tree/specs/computation/formula-language.md` § Text kernels).

use std::cell::RefCell;
use std::collections::HashMap;
use std::ops::Range;
use std::rc::Rc;

use fancy_regex::{Captures, Regex, RegexBuilder};

/// How long one match may backtrack before it is refused, as PCRE2's match limit refuses a runaway pattern.
const BACKTRACK_LIMIT: usize = 1_000_000;

type Cache = HashMap<(String, bool), Result<Rc<Regex>, String>>;

thread_local! {
    static COMPILED: RefCell<Cache> = RefCell::new(HashMap::new());
}

/// A pattern compiled, case-insensitive when `icase`; the reason in plain words when it isn't a valid pattern.
pub fn compile(pattern: &str, icase: bool) -> Result<Rc<Regex>, String> {
    COMPILED.with(|c| {
        let key = (pattern.to_string(), icase);
        if let Some(r) = c.borrow().get(&key) {
            return r.clone();
        }
        let r = pcre2_lower(pattern).map_err(|m| format!("This pattern can't run: {m}")).and_then(|p| {
            RegexBuilder::new(&p).case_insensitive(icase).backtrack_limit(BACKTRACK_LIMIT).build().map(Rc::new).map_err(
                |e| {
                    let e = e.to_string();
                    // A position counts in the rewritten pattern, so it is named only when nothing was rewritten.
                    format!("The pattern isn't valid: {}", if p == pattern { e } else { without_position(&e) })
                },
            )
        });
        let mut c = c.borrow_mut();
        if c.len() > 256 {
            c.clear();
        }
        c.insert(key, r.clone());
        r
    })
}

/// PCRE2's horizontal space (`\h`): tab, space, no-break space and the Unicode spaces, as class members.
const HSPACE: &str = r"\t\x{20}\x{A0}\x{1680}\x{180E}\x{2000}-\x{200A}\x{202F}\x{205F}\x{3000}";

/// A character as the engine reads it whatever surrounds it: a letter or digit as itself, anything else by its code.
fn literal(c: char, out: &mut String) {
    if c.is_ascii_alphanumeric() {
        out.push(c);
    } else {
        out.push_str(&format!("\\x{{{:X}}}", c as u32));
    }
}

/// How many capturing groups the pattern opens: `(` not followed by `?`, and the named forms.
fn group_count(cs: &[char]) -> usize {
    let (mut n, mut i, mut class) = (0, 0, false);
    while i < cs.len() {
        match cs[i] {
            '\\' => i += 1,
            '[' if !class => class = true,
            ']' if class => class = false,
            '(' if !class => {
                let rest: String = cs[i + 1..cs.len().min(i + 4)].iter().collect();
                if !rest.starts_with('?')
                    || rest.starts_with("?P<")
                    || rest.starts_with("?'")
                    || (rest.starts_with("?<") && !rest.starts_with("?<=") && !rest.starts_with("?<!"))
                {
                    n += 1;
                }
            }
            _ => {}
        }
        i += 1;
    }
    n
}

/// PCRE2's syntax where Rust's reads it otherwise or not at all, rewritten for the engine:
/// - `$` (without the m flag) matches at the end and also just before a newline that ends the text; Rust's only at the
///   end. Each `$` outside a class takes that newline too; under `(?m)` the line end it already matches covers it.
/// - `\h` and `\H` are horizontal space and its opposite; `\Q…\E` quotes; `\0dd`, and `\ddd` past the pattern's group
///   count or inside a class, are octal.
/// - A class's own syntax is copied as it stands: a `]` first in it (after `[` or `[^`) is a literal, and a POSIX
///   class (`[:alpha:]`) inside it doesn't end it.
///
/// Recursion and branch-reset groups have no rewrite, so they are refused by name.
fn pcre2_lower(pattern: &str) -> Result<String, String> {
    let cs: Vec<char> = pattern.chars().collect();
    let groups = group_count(&cs);
    let mut out = String::with_capacity(pattern.len() + 8);
    let mut class = false;
    let mut i = 0;
    let octal = |i: usize, max: usize| cs[i..].iter().take(max).take_while(|c| ('0'..='7').contains(c)).count();
    let push_octal = |digits: &[char], out: &mut String| {
        let v = digits.iter().fold(0u32, |a, d| a * 8 + d.to_digit(8).unwrap_or(0));
        literal(char::from_u32(v).unwrap_or('\u{FFFD}'), out);
    };
    while i < cs.len() {
        let c = cs[i];
        match c {
            '\\' if i + 1 < cs.len() => {
                let n = cs[i + 1];
                match n {
                    'Q' => {
                        i += 2;
                        while i < cs.len() && !(cs[i] == '\\' && cs.get(i + 1) == Some(&'E')) {
                            literal(cs[i], &mut out);
                            i += 1;
                        }
                        i += 2;
                        continue;
                    }
                    'E' => {}
                    'h' if class => out.push_str(HSPACE),
                    'h' => out.push_str(&format!("[{HSPACE}]")),
                    'H' if !class => out.push_str(&format!("[^{HSPACE}]")),
                    '0' => {
                        let k = octal(i + 2, 2);
                        push_octal(&cs[i + 1..i + 2 + k], &mut out);
                        i += 2 + k;
                        continue;
                    }
                    '1'..='9' => {
                        let d = cs[i + 1..].iter().take_while(|c| c.is_ascii_digit()).count();
                        let value: usize =
                            cs[i + 1..i + 1 + d].iter().collect::<String>().parse().unwrap_or(usize::MAX);
                        let k = octal(i + 1, 3);
                        if (class || (value >= 10 && value > groups)) && k > 0 {
                            push_octal(&cs[i + 1..i + 1 + k], &mut out);
                            i += 1 + k;
                        } else {
                            out.extend(&cs[i..i + 1 + d]);
                            i += 1 + d;
                        }
                        continue;
                    }
                    _ => {
                        out.push(c);
                        out.push(n);
                    }
                }
                i += 2;
                continue;
            }
            '[' if !class => {
                class = true;
                out.push(c);
                if cs.get(i + 1) == Some(&'^') {
                    out.push('^');
                    i += 1;
                }
                if cs.get(i + 1) == Some(&']') {
                    out.push(']');
                    i += 1;
                }
            }
            '[' if cs.get(i + 1) == Some(&':') => {
                let close = (i + 2..cs.len()).find(|&k| cs[k] == ']' && cs[k - 1] == ':').unwrap_or(cs.len() - 1);
                out.extend(&cs[i..=close]);
                i = close;
            }
            ']' if class => {
                class = false;
                out.push(c);
            }
            '(' if !class && cs.get(i + 1) == Some(&'?') => {
                let rest: String = cs[i + 2..cs.len().min(i + 5)].iter().collect();
                let first = rest.chars().next();
                if rest.starts_with('|') {
                    return Err("Branch-reset groups (?|…) aren't supported yet".into());
                }
                if rest.starts_with('R')
                    || rest.starts_with('&')
                    || rest.starts_with("P>")
                    || first.is_some_and(|f| f.is_ascii_digit())
                    || ((first == Some('+') || first == Some('-'))
                        && rest.chars().nth(1).is_some_and(|d| d.is_ascii_digit()))
                {
                    return Err("Recursion ((?R), (?1), (?&name)) isn't supported yet".into());
                }
                out.push(c);
            }
            '$' if !class => out.push_str("(?:$|(?=\\n\\z))"),
            _ => out.push(c),
        }
        i += 1;
    }
    Ok(out)
}

/// The parser's message without its " at position N".
fn without_position(e: &str) -> String {
    match e.find(" at position ") {
        Some(k) => {
            let rest = &e[k + " at position ".len()..];
            format!("{}{}", &e[..k], rest.trim_start_matches(|c: char| c.is_ascii_digit()))
        }
        None => e.to_string(),
    }
}

/// A group as a replacement token names it: None where the pattern has no such group, Some(None) where it took no part.
type Group<'a> = Option<Option<&'a Range<usize>>>;

/// One match: its range in the text, each group's (None for a group that took no part), and the group names.
pub struct Found {
    pub range: Range<usize>,
    pub groups: Vec<Option<Range<usize>>>,
    names: Rc<Vec<Option<String>>>,
}

impl Found {
    fn of(caps: &Captures<'_, str>, names: &Rc<Vec<Option<String>>>) -> Self {
        let whole = caps.get(0).map_or(0..0, |m| m.range());
        Found {
            range: whole,
            groups: (1..caps.len()).map(|i| caps.get(i).map(|m| m.range())).collect(),
            names: names.clone(),
        }
    }

    fn group(&self, i: usize) -> Option<Option<&Range<usize>>> {
        if i == 0 {
            return Some(Some(&self.range));
        }
        self.groups.get(i - 1).map(Option::as_ref)
    }

    fn named(&self, name: &str) -> Option<Option<&Range<usize>>> {
        let i = self.names.iter().position(|n| n.as_deref() == Some(name))?;
        self.group(i)
    }
}

/// Why a match run failed: the pattern backtracked past the limit.
pub fn run_error(e: &fancy_regex::Error) -> String {
    format!("The pattern took too long on this text: {e}")
}

fn names_of(re: &Regex) -> Rc<Vec<Option<String>>> {
    Rc::new(re.capture_names().map(|n| n.map(str::to_string)).collect())
}

/// Every match, left to right, none overlapping; an empty match moves on by one character.
pub fn all(re: &Regex, text: &str) -> Result<Vec<Found>, String> {
    let names = names_of(re);
    re.captures_iter(text).map(|c| c.map(|c| Found::of(&c, &names)).map_err(|e| run_error(&e))).collect()
}

/// The first match.
pub fn first(re: &Regex, text: &str) -> Result<Option<Found>, String> {
    let names = names_of(re);
    re.captures(text).map(|c| c.map(|c| Found::of(&c, &names))).map_err(|e| run_error(&e))
}

pub fn test(re: &Regex, text: &str) -> Result<bool, String> {
    re.is_match(text).map_err(|e| run_error(&e))
}

/// A replacement for one match, as Excel's REGEXREPLACE reads it: `$$` is a dollar;
/// `$n`, `${n}` and `\n` a group by number, `$0` and `$&` the whole match; `${name}` and `$name` a group by name. A
/// group that took no part is empty; a number or name the pattern has no group for is an error. Any other `$` or `\`
/// stays as written.
pub fn expand(replacement: &str, m: &Found, text: &str) -> Result<String, String> {
    let r = replacement.as_bytes();
    let mut out = String::with_capacity(replacement.len());
    let missing = |what: &str| Err(format!("The replacement refers to group {what}, which the pattern doesn't have"));
    let mut i = 0;
    let mut plain = 0;
    while i < r.len() {
        let (c, next) = (r[i], r.get(i + 1).copied());
        if !(c == b'$' || c == b'\\') || next.is_none() {
            i += 1;
            continue;
        }
        let next = next.unwrap_or(0);
        // What the token names, and where it ends; None leaves it as written.
        let (group, end): (Option<(String, Group)>, usize) = if c == b'\\' {
            if next.is_ascii_digit() {
                let e = i + 1 + r[i + 1..].iter().take_while(|b| b.is_ascii_digit()).count();
                let key = &replacement[i + 1..e];
                (Some((key.to_string(), key.parse::<usize>().ok().and_then(|n| m.group(n)))), e)
            } else {
                (None, i + 1)
            }
        } else if next == b'$' {
            out.push_str(&replacement[plain..i]);
            out.push('$');
            i += 2;
            plain = i;
            continue;
        } else if next == b'&' {
            (Some(("0".into(), m.group(0))), i + 2)
        } else if next.is_ascii_digit() {
            let e = i + 1 + r[i + 1..].iter().take_while(|b| b.is_ascii_digit()).count();
            let key = &replacement[i + 1..e];
            (Some((key.to_string(), key.parse::<usize>().ok().and_then(|n| m.group(n)))), e)
        } else if next == b'{' {
            match r[i + 2..].iter().position(|&b| b == b'}') {
                Some(k) => {
                    let key = &replacement[i + 2..i + 2 + k];
                    let g = match key.parse::<usize>() {
                        Ok(n) => m.group(n),
                        Err(_) => m.named(key),
                    };
                    (Some((key.to_string(), g)), i + 3 + k)
                }
                None => (None, i + 1),
            }
        } else if next == b'_' || next.is_ascii_alphabetic() {
            let e = i + 1 + r[i + 1..].iter().take_while(|b| b.is_ascii_alphanumeric() || **b == b'_').count();
            let key = &replacement[i + 1..e];
            (Some((key.to_string(), m.named(key))), e)
        } else {
            (None, i + 1)
        };
        match group {
            Some((_, Some(g))) => {
                out.push_str(&replacement[plain..i]);
                if let Some(range) = g {
                    out.push_str(&text[range.clone()]);
                }
                i = end;
                plain = i;
            }
            Some((key, None)) => return missing(&key),
            None => i = end,
        }
    }
    out.push_str(&replacement[plain..]);
    Ok(out)
}

/// The text with every match replaced (`occurrence` 0), or only the nth (1-based; negative counts from the end).
pub fn replace(re: &Regex, text: &str, replacement: &str, occurrence: f64) -> Result<String, String> {
    let found = all(re, text)?;
    let pick = |i: usize| {
        if occurrence == 0.0 {
            return true;
        }
        let target = if occurrence < 0.0 { found.len() as f64 + occurrence + 1.0 } else { occurrence };
        target >= 1.0 && i + 1 == target as usize
    };
    let mut out = String::with_capacity(text.len());
    let mut next = 0;
    for (i, m) in found.iter().enumerate() {
        if !pick(i) {
            continue;
        }
        out.push_str(&text[next..m.range.start]);
        out.push_str(&expand(replacement, m, text)?);
        next = m.range.end;
    }
    out.push_str(&text[next..]);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn re(p: &str) -> Rc<Regex> {
        compile(p, false).unwrap()
    }

    #[test]
    fn pcre2_features() {
        assert!(test(&re(r"(?<=a)b"), "ab").unwrap());
        assert!(test(&re(r"(a)\1"), "aa").unwrap());
        assert!(test(&re(r"^a++$"), "aaa").unwrap());
        assert!(test(&re(r"(?>ab|a)c"), "abc").unwrap());
        assert!(test(&compile("ABC", true).unwrap(), "abc").unwrap());
        assert!(test(&re("(?i)abc"), "ABC").unwrap());
        assert!(compile("(", false).is_err());
    }

    #[test]
    fn replacements() {
        let r = re(r"(\w+) (?<last>\w+)");
        assert_eq!(replace(&r, "Ada Lovelace", "$2, $1", 0.0).unwrap(), "Lovelace, Ada");
        assert_eq!(replace(&r, "Ada Lovelace", "${last} $$1", 0.0).unwrap(), "Lovelace $1");
        assert_eq!(replace(&r, "Ada Lovelace", "$last!", 0.0).unwrap(), "Lovelace!");
        // The author's Excel, 2026-11-01.
        assert_eq!(replace(&re("(b)"), "abc", "[$&]", 0.0).unwrap(), "a[b]c");
        assert_eq!(replace(&re("(b)"), "abc", "[\\1]", 0.0).unwrap(), "a[b]c");
        assert!(replace(&re("(b)"), "abc", "[$2]", 0.0).is_err());
        assert!(replace(&re("(b)"), "abc", "[$10]", 0.0).is_err());
        assert!(test(&re("a$"), "a\n").unwrap());
        assert!(!test(&re("a$"), "a\n\n").unwrap());
        assert!(test(&re("[$]"), "$").unwrap());
        // The author's Excel, 2026-11-01: a `]` first in a class and a POSIX class inside one keep the class whole.
        assert!(!test(&re("[]$]"), "?").unwrap());
        assert!(test(&re("[]$]"), "$").unwrap());
        assert!(!test(&re("[^]a]"), "a").unwrap());
        assert!(!test(&re("[[:alpha:]$]"), "|").unwrap());
        assert!(test(&re("[[:alpha:]$]"), "$").unwrap());
        assert!(test(&re("[[:alpha:]]"), "a1").unwrap());
        // The author's Excel, 2026-11-01: \h, \Q…\E and octal escapes.
        assert!(test(&re(r"a\hb"), "a b").unwrap());
        assert!(test(&re(r"a\hb"), "a\u{A0}b").unwrap());
        assert!(!test(&re(r"a\Hb"), "a b").unwrap());
        assert!(test(&re(r"a[\h]b"), "a\tb").unwrap());
        assert!(!test(&re(r"a\Q.\Eb"), "axb").unwrap());
        assert!(test(&re(r"a\Q.\Eb"), "a.b").unwrap());
        assert!(test(&re(r"\Q(a+\E"), "x(a+").unwrap());
        assert!(test(&re(r"\101"), "A").unwrap());
        assert!(test(&re(r"\0101"), "\u{8}1").unwrap());
        assert!(test(&re(r"[\101]"), "A").unwrap());
        assert!(test(&re(r"(a)\1"), "aa").unwrap());
        assert!(test(&re(r"(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)\10"), "abcdefghijj").unwrap());
        assert!(compile(r"^(\((?1)*\))$", false).unwrap_err().contains("Recursion"));
        assert!(compile(r"(?|(a)|(b))", false).unwrap_err().contains("Branch-reset"));
        assert!(test(&re(r"(?<n>a)(?=b)(?<!c)"), "ab").unwrap());
        assert!(compile("(", false).unwrap_err().contains("position"));
        assert!(!compile("$(", false).unwrap_err().contains("position"));
        assert_eq!(replace(&re("o"), "foo boo", "0", 2.0).unwrap(), "fo0 boo");
        assert_eq!(replace(&re("o"), "foo boo", "0", -1.0).unwrap(), "foo bo0");
        assert_eq!(replace(&re("x*"), "ab", "-", 0.0).unwrap(), "-a-b-");
    }
}
