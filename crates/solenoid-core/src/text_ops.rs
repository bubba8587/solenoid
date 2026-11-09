// [[C130]] rustCore, [[D99]] rustIsSpec
//! The URL, spelling, accent and template helpers.

use crate::jsnum::lower_text;

fn utf16(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

/// Text stays well formed: a slice that halves a surrogate pair reads the half as U+FFFD (`rust-core.md`).
fn from_utf16(units: &[u16]) -> String {
    String::from_utf16_lossy(units)
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

/// `Err` carries the #DOMAIN! message.
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
    // The first 6 digits after the point of the number at Excel's 15 digits, written out in full; trailing zeros
    // say nothing.
    let t = crate::excel_functions::number_to_text(abs);
    let s = t.parse::<f64>().map_or(t, |x| format!("{x}"));
    if let Some((_, frac)) = s.split_once('.') {
        let frac: String = frac.chars().take(6).collect::<String>().trim_end_matches('0').to_string();
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

/// `String.prototype.normalize("NFD")`.
pub fn nfd(t: &str) -> Vec<char> {
    use unicode_normalization::UnicodeNormalization;
    t.nfd().collect()
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

/// The note a link names, as Obsidian reads one: `[[Folder/Note#Heading|Alias]]`, an embed `![[…]]` and a markdown
/// link `[alias](Folder/Note.md)` all name `Folder/Note`. Text that is no link names itself, so a column that mixes
/// links and plain names reads through.
pub fn link_path(t: &str) -> String {
    let s = crate::jsnum::trim_space(t);
    let s = s.strip_prefix('!').unwrap_or(s);
    let target = if let Some(inner) = s.strip_prefix("[[").and_then(|r| r.strip_suffix("]]")) {
        inner.split('|').next().unwrap_or(inner)
    } else if let Some(inner) = s.strip_prefix('[').and_then(|r| r.strip_suffix(')')).and_then(|r| r.split_once("](")) {
        inner.1.trim_start_matches('<').trim_end_matches('>')
    } else {
        return t.to_string();
    };
    let target = target.split('#').next().unwrap_or(target);
    let target = crate::jsnum::trim_space(target);
    let target = target.strip_suffix(".md").unwrap_or(target);
    target.replace("%20", " ")
}

/// The name of the note a link names: its path's last part.
pub fn link_name(t: &str) -> String {
    let path = link_path(t);
    match path.rsplit_once('/') {
        Some((_, name)) if path != t => name.to_string(),
        _ => path,
    }
}

/// `slugify`.
pub fn slugify(t: &str, sep: &str) -> String {
    let lower = utf16(&lower_text(&unaccent(t)));
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

const TEMPLATE_TOKEN: &str = r"\{\{|\}\}|\{\s*([A-Za-z_][A-Za-z0-9_ .-]*?|\d+)\s*(?::([^{}]*))?\}";

/// A template token: `{{`, `}}`, or a placeholder's name and format spec.
pub enum Token {
    Open,
    Close,
    Placeholder(String, Option<String>),
}

/// `TEMPLATE_TOKEN`'s matches, with the text between them.
pub fn template_tokens(template: &str) -> Vec<(String, Option<Token>)> {
    let re = crate::excel_regex::compile(TEMPLATE_TOKEN, false).expect("TEMPLATE_TOKEN compiles");
    let mut out = Vec::new();
    let mut next = 0;
    for m in crate::excel_regex::all(&re, template).unwrap_or_default() {
        let tok = &template[m.range.clone()];
        let token = match tok {
            "{{" => Token::Open,
            "}}" => Token::Close,
            _ => {
                let cap = |i: usize| m.groups[i].clone().map(|r| template[r].to_string());
                Token::Placeholder(cap(0).unwrap_or_default(), cap(1))
            }
        };
        out.push((template[next..m.range.start].to_string(), Some(token)));
        next = m.range.end;
    }
    out.push((template[next..].to_string(), None));
    out
}
