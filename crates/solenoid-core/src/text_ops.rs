// [[C130]] rustCore, [[D99]] rustIsSpec
//! Port of `src/graph/nodes/textOps.ts`'s regex, URL, spelling, accent and template helpers. A JS string is UTF-16
//! and `new RegExp(p, "")` reads it by code unit, so the patterns (lowered by `js_regex`) run on `regress` in its
//! non-Unicode mode over the text's code units.

use crate::jsnum::{js_lower, number_to_string};
use regress::{Match, Regex};

fn utf16(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

/// Text stays well formed: a slice that halves a surrogate pair reads the half as U+FFFD (`rust-core.md`).
fn from_utf16(units: &[u16]) -> String {
    String::from_utf16_lossy(units)
}

// ─── Regex ──────────────────────────────────────────────────────────────────────

/// `RegExp.prototype.exec` from `last_index`, as a global regex runs it.
fn exec_at(re: &Regex, text: &[u16], last_index: usize) -> Option<Match> {
    exec_from(re, text, last_index, false, false)
}

/// `RegExp.prototype.exec` from `last_index`; a sticky regex matches only there, and under the u or v flag the text
/// reads by code point.
pub fn exec_from(re: &Regex, text: &[u16], last_index: usize, sticky: bool, unicode: bool) -> Option<Match> {
    if last_index > text.len() {
        return None;
    }
    let m =
        if unicode { re.find_from_utf16(text, last_index).next() } else { re.find_from_ucs2(text, last_index).next() };
    m.filter(|m| !sticky || m.range.start == last_index)
}

/// Every match a global regex finds (`matchAll`, `replace`): an empty match moves on by one code unit.
pub fn match_all(re: &Regex, text: &[u16]) -> Vec<Match> {
    matches_with(re, text, false, false)
}

/// Every match a global regex finds, sticky or not: an empty match moves on by one code unit, or under the u or v
/// flag by one code point (AdvanceStringIndex).
pub fn matches_with(re: &Regex, text: &[u16], sticky: bool, unicode: bool) -> Vec<Match> {
    let mut out = Vec::new();
    let mut last = 0;
    while let Some(m) = exec_from(re, text, last, sticky, unicode) {
        last = if !m.range.is_empty() {
            m.range.end
        } else if unicode
            && text.get(m.range.end).is_some_and(|u| (0xd800..0xdc00).contains(u))
            && text.get(m.range.end + 1).is_some_and(|u| (0xdc00..0xe000).contains(u))
        {
            m.range.end + 2
        } else {
            m.range.end + 1
        };
        out.push(m);
    }
    out
}

pub fn regex_test(re: &Regex, text: &[u16]) -> bool {
    exec_at(re, text, 0).is_some()
}

/// `text.match(re)?.[0] ?? ""`.
pub fn regex_extract(re: &Regex, text: &[u16]) -> Vec<u16> {
    exec_at(re, text, 0).map_or_else(Vec::new, |m| text[m.range].to_vec())
}

fn has_named(m: &Match) -> bool {
    m.named_groups().next().is_some()
}

fn named_capture(m: &Match, name: &[u16]) -> Option<std::ops::Range<usize>> {
    let name = String::from_utf16(name).ok()?;
    m.named_groups().find(|(n, _)| *n == name).and_then(|(_, r)| r)
}

/// GetSubstitution, how `text.replace(re, replacement)` reads `$$`, `$&`, `` $` ``, `$'`, `$n`, `$nn` and `$<name>`.
fn get_substitution(replacement: &[u16], m: &Match, text: &[u16]) -> Vec<u16> {
    let (pos, end) = (m.range.start, m.range.end);
    let caps = m.captures.len();
    let capture = |i: usize, out: &mut Vec<u16>| {
        if let Some(r) = &m.captures[i - 1] {
            out.extend_from_slice(&text[r.clone()]);
        }
    };
    let mut out = Vec::with_capacity(replacement.len());
    let mut i = 0;
    let digit = |u: u16| u < 0x80 && (u as u8).is_ascii_digit();
    while i < replacement.len() {
        let c = replacement[i];
        if c != u16::from(b'$') || i + 1 >= replacement.len() {
            out.push(c);
            i += 1;
            continue;
        }
        let p = replacement[i + 1];
        match p {
            0x24 => {
                out.push(0x24);
                i += 2;
            }
            0x26 => {
                out.extend_from_slice(&text[pos..end]);
                i += 2;
            }
            0x60 => {
                out.extend_from_slice(&text[..pos]);
                i += 2;
            }
            0x27 => {
                out.extend_from_slice(&text[end.min(text.len())..]);
                i += 2;
            }
            _ if digit(p) => {
                let mut index = usize::from(p - u16::from(b'0'));
                let mut advance = 1;
                if let Some(&q) = replacement.get(i + 2) {
                    if digit(q) {
                        let two = index * 10 + usize::from(q - u16::from(b'0'));
                        if two <= caps {
                            index = two;
                            advance = 2;
                        }
                    }
                }
                if index == 0 || index > caps {
                    out.push(0x24);
                    i += 1;
                } else {
                    capture(index, &mut out);
                    i += 1 + advance;
                }
            }
            0x3c => {
                let close = replacement[i + 2..].iter().position(|&u| u == u16::from(b'>'));
                match close {
                    Some(k) if has_named(m) => {
                        if let Some(r) = named_capture(m, &replacement[i + 2..i + 2 + k]) {
                            out.extend_from_slice(&text[r]);
                        }
                        i += 3 + k;
                    }
                    _ => {
                        out.push(0x24);
                        i += 1;
                    }
                }
            }
            _ => {
                out.push(0x24);
                i += 1;
            }
        }
    }
    out
}

/// `text.replace(globalRe, replacement)`.
pub fn regex_replace_all(re: &Regex, text: &[u16], replacement: &[u16]) -> Vec<u16> {
    replace_matches(&match_all(re, text), text, replacement)
}

/// `text.replace(globalRe, replacement)` over the matches the regex found.
pub fn replace_matches(matches: &[Match], text: &[u16], replacement: &[u16]) -> Vec<u16> {
    let mut out = Vec::with_capacity(text.len());
    let mut next = 0;
    for m in matches {
        if m.range.start >= next {
            out.extend_from_slice(&text[next..m.range.start]);
            out.extend(get_substitution(replacement, m, text));
            next = m.range.end;
        }
    }
    out.extend_from_slice(&text[next.min(text.len())..]);
    out
}

/// `expandReplacement`: the `/\$(\$|&|`|'|<([^>]*)>|(\d\d?))/g` reading of a replacement, for one match.
fn expand_replacement(replacement: &[u16], m: &Match, text: &[u16]) -> Vec<u16> {
    let (offset, end) = (m.range.start, m.range.end);
    let groups = m.captures.len();
    let named = has_named(m);
    let group = |i: usize, out: &mut Vec<u16>| {
        if let Some(r) = &m.captures[i - 1] {
            out.extend_from_slice(&text[r.clone()]);
        }
    };
    let digit = |u: u16| u < 0x80 && (u as u8).is_ascii_digit();
    let mut out = Vec::with_capacity(replacement.len());
    let mut i = 0;
    while i < replacement.len() {
        let c = replacement[i];
        let p = replacement.get(i + 1).copied();
        if c != 0x24 || p.is_none() {
            out.push(c);
            i += 1;
            continue;
        }
        let p = p.unwrap_or(0);
        match p {
            0x24 => {
                out.push(0x24);
                i += 2;
            }
            0x26 => {
                out.extend_from_slice(&text[offset..end]);
                i += 2;
            }
            0x60 => {
                out.extend_from_slice(&text[..offset]);
                i += 2;
            }
            0x27 => {
                out.extend_from_slice(&text[end..]);
                i += 2;
            }
            0x3c => match replacement[i + 2..].iter().position(|&u| u == u16::from(b'>')) {
                Some(k) => {
                    let token = &replacement[i..i + 3 + k];
                    if named {
                        if let Some(r) = named_capture(m, &replacement[i + 2..i + 2 + k]) {
                            out.extend_from_slice(&text[r]);
                        }
                    } else {
                        out.extend_from_slice(token);
                    }
                    i += 3 + k;
                }
                None => {
                    out.push(c);
                    i += 1;
                }
            },
            _ if digit(p) => {
                let two_digits = replacement.get(i + 2).is_some_and(|&q| digit(q));
                let len = if two_digits { 2 } else { 1 };
                let digits = &replacement[i + 1..i + 1 + len];
                let value = digits.iter().fold(0usize, |a, &d| a * 10 + usize::from(d - u16::from(b'0')));
                let one = usize::from(digits[0] - u16::from(b'0'));
                if (1..=groups).contains(&value) {
                    group(value, &mut out);
                } else if len == 2 && (1..=groups).contains(&one) {
                    group(one, &mut out);
                    out.push(digits[1]);
                } else {
                    out.extend_from_slice(&replacement[i..i + 1 + len]);
                }
                i += 1 + len;
            }
            _ => {
                out.push(c);
                i += 1;
            }
        }
    }
    out
}

/// `replaceNth`: only the nth match (1-based; negative counts from the end) is replaced.
pub fn replace_nth(re: &Regex, text: &[u16], replacement: &[u16], n: f64) -> Vec<u16> {
    replace_nth_of(&match_all(re, text), text, replacement, n)
}

/// `replaceNth` over the matches the regex found.
pub fn replace_nth_of(all: &[Match], text: &[u16], replacement: &[u16], n: f64) -> Vec<u16> {
    let target = if n < 0.0 { all.len() as f64 + n + 1.0 } else { n };
    if target < 1.0 {
        return text.to_vec();
    }
    match all.get(target as usize - 1).filter(|_| target <= all.len() as f64) {
        Some(m) => {
            let mut out = text[..m.range.start].to_vec();
            out.extend(expand_replacement(replacement, m, text));
            out.extend_from_slice(&text[m.range.end..]);
            out
        }
        None => text.to_vec(),
    }
}

// ─── URLs ───────────────────────────────────────────────────────────────────────

/// `encodeURIComponent`, for well-formed text.
pub fn encode_uri_component(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for b in text.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// `decodeURIComponent`; `None` where it throws a URIError.
pub fn decode_uri_component(text: &str) -> Option<String> {
    let b = text.as_bytes();
    let hex = |k: usize| -> Option<u8> {
        let h = std::str::from_utf8(b.get(k..k + 2)?).ok()?;
        if h.bytes().all(|c| c.is_ascii_hexdigit()) {
            u8::from_str_radix(h, 16).ok()
        } else {
            None
        }
    };
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut k = 0;
    while k < b.len() {
        if b[k] != b'%' {
            out.push(b[k]);
            k += 1;
            continue;
        }
        let first = hex(k + 1)?;
        k += 3;
        let n = first.leading_ones() as usize;
        if n == 0 {
            out.push(first);
            continue;
        }
        if n == 1 || n > 4 {
            return None;
        }
        let mut octets = vec![first];
        for _ in 1..n {
            if b.get(k) != Some(&b'%') {
                return None;
            }
            let o = hex(k + 1)?;
            if o & 0xc0 != 0x80 {
                return None;
            }
            octets.push(o);
            k += 3;
        }
        out.extend_from_slice(std::str::from_utf8(&octets).ok()?.as_bytes());
    }
    String::from_utf8(out).ok()
}

// ─── Spelling ───────────────────────────────────────────────────────────────────

const SPELL_ONES: [&str; 20] = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
];
const SPELL_TENS: [&str; 10] = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SPELL_SCALES: [&str; 5] = ["", " thousand", " million", " billion", " trillion"];

fn spell_under_1000(mut n: u64) -> String {
    let mut parts: Vec<String> = Vec::new();
    if n >= 100 {
        parts.push(format!("{} hundred", SPELL_ONES[(n / 100) as usize]));
        n %= 100;
    }
    if n >= 20 {
        let tens = SPELL_TENS[(n / 10) as usize];
        parts.push(if !n.is_multiple_of(10) {
            format!("{tens}-{}", SPELL_ONES[(n % 10) as usize])
        } else {
            tens.to_string()
        });
    } else if n > 0 {
        parts.push(SPELL_ONES[n as usize].to_string());
    }
    parts.join(" ")
}

/// `spellNumber`; `Err` carries the #DOMAIN! message.
pub fn spell_number(n: f64) -> Result<String, &'static str> {
    if !n.is_finite() {
        return Err("Not a finite number");
    }
    if n.abs() >= 1e15 {
        return Err("Spell Number goes up to the trillions");
    }
    let neg = n < 0.0;
    let abs = n.abs();
    let int = abs.floor() as u64;
    let mut words = if int == 0 {
        "zero".to_string()
    } else {
        let mut groups: Vec<String> = Vec::new();
        let (mut rest, mut scale) = (int, 0);
        while rest > 0 {
            let g = rest % 1000;
            if g > 0 {
                groups.insert(0, spell_under_1000(g) + SPELL_SCALES[scale]);
            }
            rest /= 1000;
            scale += 1;
        }
        groups.join(" ")
    };
    // The digits after the point of `String(abs)`, at most 6; in exponent form an "e" or "-" reads as nothing.
    let s = number_to_string(abs);
    if let Some((_, frac)) = s.split_once('.') {
        let frac: String = frac.chars().take(6).collect();
        if !frac.is_empty() {
            let spelled: Vec<&str> =
                frac.chars().map(|d| d.to_digit(10).map_or("", |d| SPELL_ONES[d as usize])).collect();
            words.push_str(" point ");
            words.push_str(&spelled.join(" "));
        }
    }
    Ok(if neg { format!("negative {words}") } else { words })
}

// ─── Accents and slugs ──────────────────────────────────────────────────────────

fn translit(c: char) -> Option<&'static str> {
    Some(match c {
        'ß' => "ss",
        'æ' => "ae",
        'Æ' => "AE",
        'ø' => "o",
        'Ø' => "O",
        'œ' => "oe",
        'Œ' => "OE",
        'đ' => "d",
        'Đ' => "D",
        'ł' => "l",
        'Ł' => "L",
        'ð' => "d",
        'Ð' => "D",
        'þ' => "th",
        'Þ' => "TH",
        'ı' => "i",
        'ŋ' => "ng",
        'Ŋ' => "NG",
        _ => return None,
    })
}

/// `String.prototype.normalize("NFD")`, from `nfd_table.rs`: each code point decomposed, Hangul syllables by
/// arithmetic, then each run of non-starters sorted stably by combining class.
pub fn nfd(t: &str) -> Vec<char> {
    use crate::nfd_table::{CCC_KEYS, CCC_RANKS, NFD_CHARS, NFD_INDEX, NFD_KEYS};
    const S_BASE: u32 = 0xac00;
    let mut out: Vec<char> = Vec::with_capacity(t.len());
    for c in t.chars() {
        let u = c as u32;
        if u < 0x80 {
            out.push(c);
        } else if (S_BASE..=0xd7a3).contains(&u) {
            let s = u - S_BASE;
            out.push(char::from_u32(0x1100 + s / 588).unwrap_or(c));
            out.push(char::from_u32(0x1161 + (s % 588) / 28).unwrap_or(c));
            if !s.is_multiple_of(28) {
                out.push(char::from_u32(0x11a7 + s % 28).unwrap_or(c));
            }
        } else if let Ok(i) = NFD_KEYS.binary_search(&u) {
            let span = usize::from(NFD_INDEX[i])..usize::from(NFD_INDEX[i + 1]);
            out.extend(NFD_CHARS[span].iter().filter_map(|&d| char::from_u32(d)));
        } else {
            out.push(c);
        }
    }
    let ccc = |c: char| CCC_KEYS.binary_search(&(c as u32)).map_or(0, |i| CCC_RANKS[i]);
    let mut i = 0;
    while i < out.len() {
        if ccc(out[i]) == 0 {
            i += 1;
            continue;
        }
        let start = i;
        while i < out.len() && ccc(out[i]) != 0 {
            i += 1;
        }
        out[start..i].sort_by_key(|&c| ccc(c));
    }
    out
}

/// `unaccent`: NFD, the combining diacritics (U+0300–U+036F) dropped, then the letters NFD keeps whole spelled out.
pub fn unaccent(t: &str) -> String {
    let mut out = String::with_capacity(t.len());
    for c in nfd(t) {
        if !('\u{300}'..='\u{36f}').contains(&c) {
            match translit(c) {
                Some(s) => out.push_str(s),
                None => out.push(c),
            }
        }
    }
    out
}

/// `slugify`.
pub fn slugify(t: &str, sep: &str) -> String {
    let lower = utf16(&js_lower(&unaccent(t)));
    let sep16 = utf16(sep);
    let keep = |u: u16| u < 0x80 && matches!(u as u8, b'a'..=b'z' | b'0'..=b'9');
    // `.replace(/[^a-z0-9]+/g, sep)`: the separator is a replacement pattern, read with no groups.
    let mut body: Vec<u16> = Vec::with_capacity(lower.len());
    let mut i = 0;
    while i < lower.len() {
        if keep(lower[i]) {
            body.push(lower[i]);
            i += 1;
            continue;
        }
        let start = i;
        while i < lower.len() && !keep(lower[i]) {
            i += 1;
        }
        body.extend(plain_substitution(&sep16, &lower, start, i));
    }
    if sep16.is_empty() {
        return from_utf16(&body);
    }
    // `^(?:sep)+|(?:sep)+$`, globally: the leading run of separators, then the first place from which only
    // separators follow.
    let n = sep16.len();
    let mut lead = 0;
    while body[lead..].starts_with(&sep16) {
        lead += n;
    }
    let tiled = |p: usize| {
        p < body.len() && (body.len() - p).is_multiple_of(n) && body[p..].chunks(n).all(|c| c == sep16.as_slice())
    };
    let tail = (lead..body.len()).find(|&p| tiled(p)).unwrap_or(body.len());
    from_utf16(&body[lead..tail])
}

/// GetSubstitution for a regex without groups.
fn plain_substitution(replacement: &[u16], text: &[u16], pos: usize, end: usize) -> Vec<u16> {
    let mut out = Vec::with_capacity(replacement.len());
    let mut i = 0;
    while i < replacement.len() {
        let c = replacement[i];
        match (c, replacement.get(i + 1)) {
            (0x24, Some(0x24)) => out.push(0x24),
            (0x24, Some(0x26)) => out.extend_from_slice(&text[pos..end]),
            (0x24, Some(0x60)) => out.extend_from_slice(&text[..pos]),
            (0x24, Some(0x27)) => out.extend_from_slice(&text[end..]),
            _ => {
                out.push(c);
                i += 1;
                continue;
            }
        }
        i += 2;
    }
    out
}

// ─── Templates ──────────────────────────────────────────────────────────────────

const TEMPLATE_TOKEN: &str = r"\{\{|\}\}|\{\s*([A-Za-z_][\w .-]*?|\d+)\s*(?::([^{}]*))?\}";

/// A template token: `{{`, `}}`, or a placeholder's name and format spec.
pub enum Token {
    Open,
    Close,
    Placeholder(String, Option<String>),
}

/// `TEMPLATE_TOKEN`'s matches, with the text between them.
pub fn template_tokens(template: &str) -> Vec<(String, Option<Token>)> {
    let crate::js_regex::Compiled::Ok(re) = crate::js_regex::compile(&utf16(TEMPLATE_TOKEN), false) else {
        unreachable!("TEMPLATE_TOKEN compiles")
    };
    let t = utf16(template);
    let mut out = Vec::new();
    let mut next = 0;
    for m in match_all(&re, &t) {
        let tok = &t[m.range.clone()];
        let token = if tok == utf16("{{").as_slice() {
            Token::Open
        } else if tok == utf16("}}").as_slice() {
            Token::Close
        } else {
            let cap = |i: usize| m.captures[i].clone().map(|r| from_utf16(&t[r]));
            Token::Placeholder(cap(0).unwrap_or_default(), cap(1))
        };
        out.push((from_utf16(&t[next..m.range.start]), Some(token)));
        next = m.range.end;
    }
    out.push((from_utf16(&t[next..]), None));
    out
}
