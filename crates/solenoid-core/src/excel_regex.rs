// [[B27]] computeAnswersToExcel, [[C130]] rustCore
//! Regular expressions as Excel's REGEXTEST, REGEXEXTRACT and REGEXREPLACE read them: PCRE2's syntax (lookaround,
//! backreferences, atomic groups, possessive quantifiers, inline `(?i)`, `(?m)`, `(?s)`, `(?x)`), run on fancy-regex
//! over the text as Rust holds it. The Regex card, Data Validation's pattern check and TEMPLATE's tokens use it too.

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
        let r = RegexBuilder::new(&pcre2_dollar(pattern))
            .case_insensitive(icase)
            .backtrack_limit(BACKTRACK_LIMIT)
            .build()
            .map(Rc::new)
            .map_err(|e| format!("The pattern isn't valid: {e}"));
        let mut c = c.borrow_mut();
        if c.len() > 256 {
            c.clear();
        }
        c.insert(key, r.clone());
        r
    })
}

/// PCRE2's `$` (without the m flag) matches at the end and also just before a newline that ends the text; Rust's only
/// at the end. Each `$` outside a class and not escaped takes that newline too; under `(?m)` the line end it already
/// matches covers it.
/// A class's own syntax is copied as it stands: a `]` first in it (after `[` or `[^`) is a literal, and a POSIX class
/// (`[:alpha:]`) inside it doesn't end it.
fn pcre2_dollar(pattern: &str) -> String {
    let mut out = String::with_capacity(pattern.len() + 8);
    let mut chars = pattern.chars().peekable();
    let mut class = false;
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                out.push(c);
                if let Some(n) = chars.next() {
                    out.push(n);
                }
            }
            '[' if !class => {
                class = true;
                out.push(c);
                if chars.peek() == Some(&'^') {
                    out.extend(chars.next());
                }
                if chars.peek() == Some(&']') {
                    out.extend(chars.next());
                }
            }
            '[' if chars.peek() == Some(&':') => {
                out.push(c);
                let mut prev = '[';
                for n in chars.by_ref() {
                    out.push(n);
                    if prev == ':' && n == ']' {
                        break;
                    }
                    prev = n;
                }
            }
            ']' if class => {
                class = false;
                out.push(c);
            }
            '$' if !class => out.push_str("(?:$|(?=\\n\\z))"),
            _ => out.push(c),
        }
    }
    out
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

/// A replacement for one match, as Excel's REGEXREPLACE reads it (the author's Excel, 2026-11-01): `$$` is a dollar;
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
        assert_eq!(replace(&re("o"), "foo boo", "0", 2.0).unwrap(), "fo0 boo");
        assert_eq!(replace(&re("o"), "foo boo", "0", -1.0).unwrap(), "foo bo0");
        assert_eq!(replace(&re("x*"), "ab", "-", 0.0).unwrap(), "-a-b-");
    }
}
