// [[B12]] losslessSaves, [[D102]] graphOnCore
//! JSON as JavaScript reads and writes it, for the saves the app writes from JavaScript objects: an object keeps its
//! keys in JavaScript's order (array-index keys first, ascending, then the rest as first set), a number is a double
//! written as `String(n)` writes it, and `stringify` matches `JSON.stringify`, with or without its two-space indent.

use solenoid_core::jsnum::number_to_string;

#[derive(Clone, Debug, PartialEq)]
pub enum Js {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Js>),
    Obj(Obj),
}

/// An object's own keys in JavaScript's property order.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Obj(Vec<(String, Js)>);

/// A key JavaScript orders as an array index: a canonical integer below 2³² − 1.
fn index_of(key: &str) -> Option<u32> {
    let n: u32 = key.parse().ok()?;
    (n != u32::MAX && n.to_string() == key).then_some(n)
}

impl Obj {
    pub fn new() -> Obj {
        Obj(Vec::new())
    }

    pub fn get(&self, key: &str) -> Option<&Js> {
        self.0.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    pub fn has(&self, key: &str) -> bool {
        self.get(key).is_some()
    }

    /// Sets `key`: a key already there keeps its place, a new one takes JavaScript's.
    pub fn set(&mut self, key: &str, value: Js) {
        if let Some(slot) = self.0.iter_mut().find(|(k, _)| k == key) {
            slot.1 = value;
            return;
        }
        let at = match index_of(key) {
            Some(n) => self
                .0
                .iter()
                .position(|(k, _)| index_of(k).is_none_or(|m| m > n))
                .unwrap_or(self.0.len()),
            None => self.0.len(),
        };
        self.0.insert(at, (key.to_string(), value));
    }

    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.0.iter().map(|(k, _)| k.as_str())
    }

    pub fn iter(&self) -> impl Iterator<Item = (&str, &Js)> {
        self.0.iter().map(|(k, v)| (k.as_str(), v))
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl Js {
    pub fn obj(&self) -> Option<&Obj> {
        match self {
            Js::Obj(o) => Some(o),
            _ => None,
        }
    }

    pub fn arr(&self) -> Option<&[Js]> {
        match self {
            Js::Arr(a) => Some(a),
            _ => None,
        }
    }

    pub fn str(&self) -> Option<&str> {
        match self {
            Js::Str(s) => Some(s),
            _ => None,
        }
    }

    /// `v.key`: the field of an object, nothing for anything else.
    pub fn field(&self, key: &str) -> Option<&Js> {
        self.obj().and_then(|o| o.get(key))
    }

    /// JavaScript's truthiness.
    pub fn truthy(&self) -> bool {
        match self {
            Js::Null => false,
            Js::Bool(b) => *b,
            Js::Num(n) => *n != 0.0 && !n.is_nan(),
            Js::Str(s) => !s.is_empty(),
            Js::Arr(_) | Js::Obj(_) => true,
        }
    }

    /// `typeof v === "object"` for a value that isn't null: an array or an object.
    pub fn is_object(&self) -> bool {
        matches!(self, Js::Arr(_) | Js::Obj(_))
    }
}

/// `JSON.parse`; the error names where the text stops being JSON.
pub fn parse(text: &str) -> Result<Js, String> {
    let mut p = Parser {
        s: text.as_bytes(),
        i: 0,
        text,
    };
    p.ws();
    let v = p.value()?;
    p.ws();
    if p.i != p.s.len() {
        return Err(p.err());
    }
    Ok(v)
}

struct Parser<'a> {
    s: &'a [u8],
    i: usize,
    text: &'a str,
}

impl Parser<'_> {
    fn err(&self) -> String {
        match self.text.get(self.i..).and_then(|r| r.chars().next()) {
            Some(c) => format!("Unexpected '{c}' at position {} in JSON", self.i),
            None => "Unexpected end of JSON input".into(),
        }
    }

    fn ws(&mut self) {
        while matches!(self.s.get(self.i), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.i += 1;
        }
    }

    fn eat(&mut self, lit: &str) -> bool {
        let ok = self.s[self.i..].starts_with(lit.as_bytes());
        if ok {
            self.i += lit.len();
        }
        ok
    }

    fn value(&mut self) -> Result<Js, String> {
        match self.s.get(self.i) {
            Some(b'{') => {
                self.i += 1;
                let mut o = Obj::new();
                self.ws();
                if self.eat("}") {
                    return Ok(Js::Obj(o));
                }
                loop {
                    self.ws();
                    if self.s.get(self.i) != Some(&b'"') {
                        return Err(self.err());
                    }
                    let k = self.string()?;
                    self.ws();
                    if !self.eat(":") {
                        return Err(self.err());
                    }
                    self.ws();
                    let v = self.value()?;
                    o.set(&k, v);
                    self.ws();
                    if self.eat("}") {
                        return Ok(Js::Obj(o));
                    }
                    if !self.eat(",") {
                        return Err(self.err());
                    }
                }
            }
            Some(b'[') => {
                self.i += 1;
                let mut a = Vec::new();
                self.ws();
                if self.eat("]") {
                    return Ok(Js::Arr(a));
                }
                loop {
                    self.ws();
                    a.push(self.value()?);
                    self.ws();
                    if self.eat("]") {
                        return Ok(Js::Arr(a));
                    }
                    if !self.eat(",") {
                        return Err(self.err());
                    }
                }
            }
            Some(b'"') => self.string().map(Js::Str),
            Some(b't') if self.eat("true") => Ok(Js::Bool(true)),
            Some(b'f') if self.eat("false") => Ok(Js::Bool(false)),
            Some(b'n') if self.eat("null") => Ok(Js::Null),
            Some(b'-' | b'0'..=b'9') => self.number(),
            _ => Err(self.err()),
        }
    }

    fn number(&mut self) -> Result<Js, String> {
        let start = self.i;
        self.eat("-");
        let digits = |p: &mut Self| {
            let from = p.i;
            while matches!(p.s.get(p.i), Some(b'0'..=b'9')) {
                p.i += 1;
            }
            p.i - from
        };
        match self.s.get(self.i) {
            Some(b'0') => self.i += 1,
            Some(b'1'..=b'9') => {
                digits(self);
            }
            _ => return Err(self.err()),
        }
        if self.eat(".") && digits(self) == 0 {
            return Err(self.err());
        }
        if matches!(self.s.get(self.i), Some(b'e' | b'E')) {
            self.i += 1;
            if matches!(self.s.get(self.i), Some(b'+' | b'-')) {
                self.i += 1;
            }
            if digits(self) == 0 {
                return Err(self.err());
            }
        }
        Ok(Js::Num(
            self.text[start..self.i].parse().map_err(|_| self.err())?,
        ))
    }

    fn hex4(&mut self) -> Result<u32, String> {
        let h = self
            .s
            .get(self.i..self.i + 4)
            .filter(|b| b.iter().all(u8::is_ascii_hexdigit))
            .and_then(|b| u32::from_str_radix(std::str::from_utf8(b).ok()?, 16).ok())
            .ok_or_else(|| self.err())?;
        self.i += 4;
        Ok(h)
    }

    /// A string; a lone surrogate, which Rust text can't hold, reads as U+FFFD.
    fn string(&mut self) -> Result<String, String> {
        self.i += 1;
        let mut out = String::new();
        loop {
            let start = self.i;
            while matches!(self.s.get(self.i), Some(c) if *c != b'"' && *c != b'\\' && *c >= 0x20) {
                self.i += 1;
            }
            out.push_str(&self.text[start..self.i]);
            match self.s.get(self.i) {
                Some(b'"') => {
                    self.i += 1;
                    return Ok(out);
                }
                Some(b'\\') => {
                    self.i += 1;
                    let c = *self.s.get(self.i).ok_or_else(|| self.err())?;
                    self.i += 1;
                    match c {
                        b'"' => out.push('"'),
                        b'\\' => out.push('\\'),
                        b'/' => out.push('/'),
                        b'b' => out.push('\u{8}'),
                        b'f' => out.push('\u{c}'),
                        b'n' => out.push('\n'),
                        b'r' => out.push('\r'),
                        b't' => out.push('\t'),
                        b'u' => {
                            let hi = self.hex4()?;
                            let code = if (0xD800..0xDC00).contains(&hi)
                                && self.s[self.i..].starts_with(b"\\u")
                            {
                                let at = self.i;
                                self.i += 2;
                                let lo = self.hex4()?;
                                if (0xDC00..0xE000).contains(&lo) {
                                    0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00)
                                } else {
                                    self.i = at;
                                    hi
                                }
                            } else {
                                hi
                            };
                            out.push(char::from_u32(code).unwrap_or('\u{FFFD}'));
                        }
                        _ => {
                            self.i -= 1;
                            return Err(self.err());
                        }
                    }
                }
                _ => return Err(self.err()),
            }
        }
    }
}

/// A string as `JSON.stringify` quotes it.
pub fn quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// `JSON.stringify(v)`.
pub fn stringify(v: &Js) -> String {
    let mut out = String::new();
    write(v, None, "", &mut out);
    out
}

/// `JSON.stringify(v, null, 2)`.
pub fn stringify_pretty(v: &Js) -> String {
    let mut out = String::new();
    write(v, Some("  "), "", &mut out);
    out
}

fn write(v: &Js, indent: Option<&str>, at: &str, out: &mut String) {
    match v {
        Js::Null => out.push_str("null"),
        Js::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Js::Num(n) if n.is_finite() => out.push_str(&number_to_string(*n)),
        Js::Num(_) => out.push_str("null"),
        Js::Str(s) => out.push_str(&quote(s)),
        Js::Arr(a) if a.is_empty() => out.push_str("[]"),
        Js::Obj(o) if o.is_empty() => out.push_str("{}"),
        Js::Arr(a) => items(a.iter().map(|x| (None, x)), ('[', ']'), indent, at, out),
        Js::Obj(o) => items(
            o.iter().map(|(k, x)| (Some(k), x)),
            ('{', '}'),
            indent,
            at,
            out,
        ),
    }
}

fn items<'a>(
    xs: impl Iterator<Item = (Option<&'a str>, &'a Js)>,
    (open, close): (char, char),
    indent: Option<&str>,
    at: &str,
    out: &mut String,
) {
    let inner = indent.map(|i| format!("{at}{i}"));
    out.push(open);
    for (n, (k, x)) in xs.enumerate() {
        if n > 0 {
            out.push(',');
        }
        if let Some(inner) = &inner {
            out.push('\n');
            out.push_str(inner);
        }
        if let Some(k) = k {
            out.push_str(&quote(k));
            out.push(':');
            if indent.is_some() {
                out.push(' ');
            }
        }
        write(x, indent, inner.as_deref().unwrap_or(""), out);
    }
    if indent.is_some() {
        out.push('\n');
        out.push_str(at);
    }
    out.push(close);
}
