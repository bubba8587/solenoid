// [[C130]] rustCore, [[D99]] rustIsSpec
//! `new RegExp(pattern, icase ? "i" : "")` as V8 reads it without the u flag (Annex B): which patterns it refuses,
//! and for the rest a pattern regress reads the same way. Every literal, escape and class lowers to an explicit set
//! of code units, so neither regress's escape leniencies nor its Unicode case folding ever apply; a caseless match
//! folds by the non-Unicode Canonicalize (simple uppercase, never non-ASCII to ASCII).

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::OnceLock;

use regress::{Flags, Regex};

#[derive(Clone)]
pub enum Compiled {
    /// V8 throws: the TS answers null.
    Invalid,
    /// V8 takes it but the lowering can't promise regress agrees.
    Unsure,
    Ok(Rc<Regex>),
}

/// Quantifier bounds past this stay with the TS (V8 clamps them; regress may not).
const MAX_BOUND: u64 = 100_000;

type Cache = HashMap<(Vec<u16>, bool), Compiled>;

thread_local! {
    static COMPILED: RefCell<Cache> = RefCell::new(HashMap::new());
}

pub fn compile(pattern: &[u16], icase: bool) -> Compiled {
    COMPILED.with(|c| {
        let key = (pattern.to_vec(), icase);
        if let Some(r) = c.borrow().get(&key) {
            return r.clone();
        }
        let r = lower(pattern, icase);
        let mut c = c.borrow_mut();
        if c.len() > 256 {
            c.clear();
        }
        c.insert(key, r.clone());
        r
    })
}

fn lower(pattern: &[u16], icase: bool) -> Compiled {
    let names = match prescan(pattern) {
        Ok(n) => n,
        Err(e) => return e.into(),
    };
    let mut p = Parser { p: pattern, i: 0, names, icase, out: Vec::new() };
    if let Err(e) = p.pattern() {
        return e.into();
    }
    Regex::from_unicode(p.out.iter().copied(), Flags::default()).map_or(Compiled::Unsure, |r| Compiled::Ok(Rc::new(r)))
}

enum Fail {
    Invalid,
    Unsure,
}

impl From<Fail> for Compiled {
    fn from(f: Fail) -> Self {
        match f {
            Fail::Invalid => Compiled::Invalid,
            Fail::Unsure => Compiled::Unsure,
        }
    }
}

type R<T> = Result<T, Fail>;

/// The capture count, and each group name with its group number.
type Names = (usize, Vec<(Vec<u32>, usize)>);

// ─── Code-unit sets ─────────────────────────────────────────────────────────────

#[derive(Clone)]
struct Set(Vec<u64>);

impl Set {
    fn new() -> Self {
        Set(vec![0; 1024])
    }
    fn of(ranges: &[(u16, u16)]) -> Self {
        let mut s = Set::new();
        for &(a, b) in ranges {
            s.add_range(a, b);
        }
        s
    }
    fn has(&self, u: u16) -> bool {
        self.0[usize::from(u) >> 6] & (1 << (u & 63)) != 0
    }
    fn add(&mut self, u: u16) {
        self.0[usize::from(u) >> 6] |= 1 << (u & 63);
    }
    fn add_range(&mut self, a: u16, b: u16) {
        for u in a..=b {
            self.add(u);
        }
    }
    fn union(&mut self, o: &Set) {
        for (w, x) in self.0.iter_mut().zip(&o.0) {
            *w |= x;
        }
    }
    fn inverted(mut self) -> Self {
        for w in &mut self.0 {
            *w = !*w;
        }
        self
    }
    fn ranges(&self) -> Vec<(u16, u16)> {
        let mut out: Vec<(u16, u16)> = Vec::new();
        for u in 0..=u16::MAX {
            if self.0[usize::from(u) >> 6] == 0 {
                continue;
            }
            if self.has(u) {
                match out.last_mut() {
                    Some(r) if u32::from(r.1) + 1 == u32::from(u) => r.1 = u,
                    _ => out.push((u, u)),
                }
            }
        }
        out
    }
}

const DIGITS: &[(u16, u16)] = &[(0x30, 0x39)];
const WORD: &[(u16, u16)] = &[(0x30, 0x39), (0x41, 0x5a), (0x5f, 0x5f), (0x61, 0x7a)];
const SPACE: &[(u16, u16)] = &[(0x09, 0x0d), (0x20, 0x20), (0xa0, 0xa0), (0x1680, 0x1680), (0x2000, 0x200a),
    (0x2028, 0x2029), (0x202f, 0x202f), (0x205f, 0x205f), (0x3000, 0x3000), (0xfeff, 0xfeff)];
const LINE_TERMINATORS: &[(u16, u16)] = &[(0x0a, 0x0a), (0x0d, 0x0d), (0x2028, 0x2029)];

fn class_escape(d: u16) -> Option<Set> {
    let (ranges, invert) = match d {
        0x64 => (DIGITS, false),
        0x44 => (DIGITS, true),
        0x73 => (SPACE, false),
        0x53 => (SPACE, true),
        0x77 => (WORD, false),
        0x57 => (WORD, true),
        _ => return None,
    };
    let s = Set::of(ranges);
    Some(if invert { s.inverted() } else { s })
}

/// Canonicalize without the u flag: the simple uppercase when it's one code unit and doesn't take a non-ASCII unit
/// to ASCII.
fn canon(u: u16) -> u16 {
    static TABLE: OnceLock<Vec<u16>> = OnceLock::new();
    TABLE.get_or_init(|| {
        (0..=u16::MAX)
            .map(|u| {
                let Some(c) = char::from_u32(u32::from(u)) else { return u };
                let mut up = c.to_uppercase();
                match (up.next(), up.next()) {
                    (Some(x), None) if (x as u32) <= 0xffff && !(u >= 0x80 && (x as u32) < 0x80) => x as u16,
                    _ => u,
                }
            })
            .collect()
    })[usize::from(u)]
}

/// Every unit a caseless match takes for a member of `s`.
fn fold(s: &Set) -> Set {
    let mut canons = Set::new();
    for u in 0..=u16::MAX {
        if s.has(u) {
            canons.add(canon(u));
        }
    }
    let mut out = Set::new();
    for u in 0..=u16::MAX {
        if canons.has(canon(u)) {
            out.add(u);
        }
    }
    out
}

// ─── Parsing ────────────────────────────────────────────────────────────────────

fn is(p: &[u16], i: usize, c: u8) -> bool {
    p.get(i) == Some(&u16::from(c))
}

fn digit_at(p: &[u16], i: usize) -> Option<u32> {
    p.get(i).and_then(|&u| char::from_u32(u32::from(u))).and_then(|c| c.to_digit(10))
}

fn hex(p: &[u16], i: usize, n: usize) -> Option<u32> {
    let s = p.get(i..i + n)?;
    s.iter().try_fold(0u32, |a, &u| char::from_u32(u32::from(u)).and_then(|c| c.to_digit(16)).map(|d| a * 16 + d))
}

fn is_lead(u: u32) -> bool {
    (0xd800..0xdc00).contains(&u)
}

fn is_trail(u: u32) -> bool {
    (0xdc00..0xe000).contains(&u)
}

/// One code point of a group name at i (raw, or `\uXXXX`, `\u{…}`, a surrogate pair joined): it and the next index.
fn name_char(p: &[u16], i: usize) -> Option<(u32, usize)> {
    let pair = |lead: u32, trail: u32| 0x10000 + ((lead - 0xd800) << 10) + (trail - 0xdc00);
    if is(p, i, b'\\') {
        if !is(p, i + 1, b'u') {
            return None;
        }
        if is(p, i + 2, b'{') {
            let end = (i + 3..p.len()).find(|&j| is(p, j, b'}'))?;
            let v = if end > i + 3 && end - (i + 3) <= 8 { hex(p, i + 3, end - (i + 3))? } else { return None };
            return (v <= 0x10ffff).then_some((v, end + 1));
        }
        let v = hex(p, i + 2, 4)?;
        if is_lead(v) && is(p, i + 6, b'\\') && is(p, i + 7, b'u') {
            if let Some(t) = hex(p, i + 8, 4).filter(|&t| is_trail(t)) {
                return Some((pair(v, t), i + 12));
            }
        }
        return Some((v, i + 6));
    }
    let u = u32::from(*p.get(i)?);
    match p.get(i + 1).map(|&t| u32::from(t)) {
        Some(t) if is_lead(u) && is_trail(t) => Some((pair(u, t), i + 2)),
        _ => Some((u, i + 1)),
    }
}

/// A group name starting at i (after `<`): the name and the index after its `>`.
fn group_name(p: &[u16], i: usize) -> R<(Vec<u32>, usize)> {
    let mut name = Vec::new();
    let mut j = i;
    loop {
        if is(p, j, b'>') && !name.is_empty() {
            return Ok((name, j + 1));
        }
        let (c, next) = name_char(p, j).ok_or(Fail::Invalid)?;
        let ok = if name.is_empty() {
            regress::is_id_start(c) || c == 0x24 || c == 0x5f
        } else {
            regress::is_id_continue(c) || matches!(c, 0x24 | 0x5f | 0x200c | 0x200d)
        };
        if !ok {
            return Err(Fail::Invalid);
        }
        name.push(c);
        j = next;
    }
}

/// The capture count and names, as V8 scans them before parsing.
fn prescan(p: &[u16]) -> R<Names> {
    let (mut count, mut names) = (0, Vec::<(Vec<u32>, usize)>::new());
    let mut i = 0;
    while i < p.len() {
        if is(p, i, b'\\') {
            i += 2;
        } else if is(p, i, b'[') {
            i += 1;
            while i < p.len() && !is(p, i, b']') {
                i += if is(p, i, b'\\') { 2 } else { 1 };
            }
            i += 1;
        } else if is(p, i, b'(') {
            if !is(p, i + 1, b'?') {
                count += 1;
            } else if is(p, i + 2, b'<') && !is(p, i + 3, b'=') && !is(p, i + 3, b'!') {
                count += 1;
                let (name, end) = group_name(p, i + 3)?;
                if names.iter().any(|(n, _)| *n == name) {
                    return Err(Fail::Invalid);
                }
                names.push((name, count));
                i = end;
                continue;
            }
            i += 1;
        } else {
            i += 1;
        }
    }
    Ok((count, names))
}

#[derive(PartialEq)]
enum Kind {
    Atom,
    Assertion,
    Lookahead,
}

enum ClassAtom {
    Unit(u16),
    Set(Set),
}

struct Parser<'a> {
    p: &'a [u16],
    i: usize,
    names: Names,
    icase: bool,
    out: Vec<u32>,
}

impl Parser<'_> {
    fn at(&self, c: u8) -> bool {
        is(self.p, self.i, c)
    }

    fn push(&mut self, s: &str) {
        self.out.extend(s.chars().map(|c| c as u32));
    }

    fn pattern(&mut self) -> R<()> {
        self.disjunction()?;
        if self.i < self.p.len() {
            return Err(Fail::Invalid);
        }
        Ok(())
    }

    fn disjunction(&mut self) -> R<()> {
        loop {
            while self.i < self.p.len() && !self.at(b'|') && !self.at(b')') {
                self.term()?;
            }
            if !self.at(b'|') {
                return Ok(());
            }
            self.push("|");
            self.i += 1;
        }
    }

    /// `{n}`, `{n,}`, `{n,m}`, `*`, `+` or `?` at i: (min, max, length).
    fn quantifier(&self) -> Option<(u64, Option<u64>, usize)> {
        let p = self.p;
        let i = self.i;
        match p.get(i).copied()? {
            0x2a => return Some((0, None, 1)),
            0x2b => return Some((1, None, 1)),
            0x3f => return Some((0, Some(1), 1)),
            0x7b => {}
            _ => return None,
        }
        let number = |mut j: usize| -> Option<(u64, usize)> {
            let start = j;
            let mut v: u64 = 0;
            while let Some(d) = digit_at(p, j) {
                v = v.saturating_mul(10).saturating_add(u64::from(d));
                j += 1;
            }
            (j > start).then_some((v, j))
        };
        let (min, mut j) = number(i + 1)?;
        let mut max = Some(min);
        if is(p, j, b',') {
            match number(j + 1) {
                Some((m, k)) => (max, j) = (Some(m), k),
                None => (max, j) = (None, j + 1),
            }
        }
        is(p, j, b'}').then_some((min, max, j + 1 - i))
    }

    fn term(&mut self) -> R<()> {
        let start = self.out.len();
        let c = self.p[self.i];
        let kind = match c {
            0x5e | 0x24 => {
                self.out.push(u32::from(c));
                self.i += 1;
                Kind::Assertion
            }
            0x5c if is(self.p, self.i + 1, b'b') || is(self.p, self.i + 1, b'B') => {
                self.out.extend([0x5c, u32::from(self.p[self.i + 1])]);
                self.i += 2;
                Kind::Assertion
            }
            0x5c => {
                self.atom_escape()?;
                Kind::Atom
            }
            0x28 => self.group()?,
            0x2e => {
                self.emit_set(Set::of(LINE_TERMINATORS).inverted(), true);
                self.i += 1;
                Kind::Atom
            }
            0x5b => {
                self.class()?;
                Kind::Atom
            }
            0x2a | 0x2b | 0x3f => return Err(Fail::Invalid),
            0x7b if self.quantifier().is_some() => return Err(Fail::Invalid),
            _ => {
                self.emit_unit(c);
                self.i += 1;
                Kind::Atom
            }
        };
        let Some((min, max, len)) = self.quantifier() else { return Ok(()) };
        if kind == Kind::Assertion || max.is_some_and(|m| m < min) {
            return Err(Fail::Invalid);
        }
        if min > MAX_BOUND || max.is_some_and(|m| m > MAX_BOUND) {
            return Err(Fail::Unsure);
        }
        self.i += len;
        if kind == Kind::Lookahead {
            self.out.splice(start..start, "(?:".chars().map(|c| c as u32));
            self.push(")");
        }
        let q = match max {
            Some(m) => format!("{{{min},{m}}}"),
            None => format!("{{{min},}}"),
        };
        self.push(&q);
        if self.at(b'?') {
            self.push("?");
            self.i += 1;
        }
        Ok(())
    }

    fn group(&mut self) -> R<Kind> {
        let (p, i) = (self.p, self.i);
        let kind = if !is(p, i + 1, b'?') {
            self.push("(");
            self.i += 1;
            Kind::Atom
        } else if is(p, i + 2, b':') {
            self.push("(?:");
            self.i += 3;
            Kind::Atom
        } else if is(p, i + 2, b'=') || is(p, i + 2, b'!') {
            self.out.extend([0x28, 0x3f, u32::from(p[i + 2])]);
            self.i += 3;
            Kind::Lookahead
        } else if is(p, i + 2, b'<') && (is(p, i + 3, b'=') || is(p, i + 3, b'!')) {
            self.out.extend([0x28, 0x3f, 0x3c, u32::from(p[i + 3])]);
            self.i += 4;
            Kind::Assertion
        } else if is(p, i + 2, b'<') {
            let (name, end) = group_name(p, i + 3)?;
            self.push("(?<");
            self.out.extend(name);
            self.push(">");
            self.i = end;
            Kind::Atom
        } else {
            return Err(Fail::Invalid);
        };
        self.disjunction()?;
        if !self.at(b')') {
            return Err(Fail::Invalid);
        }
        self.push(")");
        self.i += 1;
        Ok(kind)
    }

    /// A caseless backreference compares by regress's own non-Unicode fold, which is Canonicalize.
    fn backreference(&mut self, n: usize) {
        let open = if self.icase { "(?i:" } else { "(?:" };
        self.push(&format!("{open}\\{n})"));
    }

    /// A legacy octal escape whose first digit is at i: its value and length.
    fn octal(&self, i: usize) -> (u16, usize) {
        let oct = |j: usize| digit_at(self.p, j).filter(|&d| d < 8);
        let first = oct(i).unwrap_or(0);
        let mut v = first;
        let mut len = 1;
        if let Some(d) = oct(i + 1) {
            v = v * 8 + d;
            len = 2;
            if first <= 3 {
                if let Some(d) = oct(i + 2) {
                    v = v * 8 + d;
                    len = 3;
                }
            }
        }
        (v as u16, len)
    }

    /// The character escapes classes and atoms share (`\x41`, `A`, `\n`, …, identity): the unit and length
    /// after the backslash.
    fn char_escape(&self) -> (u16, usize) {
        let (p, i) = (self.p, self.i);
        let d = p[i + 1];
        match d {
            0x78 => hex(p, i + 2, 2).map_or((d, 1), |v| (v as u16, 3)),
            0x75 => hex(p, i + 2, 4).map_or((d, 1), |v| (v as u16, 5)),
            0x66 => (0x0c, 1),
            0x6e => (0x0a, 1),
            0x72 => (0x0d, 1),
            0x74 => (0x09, 1),
            0x76 => (0x0b, 1),
            _ => (d, 1),
        }
    }

    fn atom_escape(&mut self) -> R<()> {
        let (p, i) = (self.p, self.i);
        let Some(&d) = p.get(i + 1) else { return Err(Fail::Invalid) };
        if let Some(s) = class_escape(d) {
            self.emit_set(s, true);
            self.i += 2;
            return Ok(());
        }
        match d {
            0x31..=0x39 => {
                let mut j = i + 1;
                let mut n: usize = 0;
                while let Some(v) = digit_at(p, j) {
                    n = n.saturating_mul(10).saturating_add(v as usize);
                    j += 1;
                }
                if n <= self.names.0 {
                    self.backreference(n);
                    self.i = j;
                } else if d >= 0x38 {
                    self.emit_unit(d);
                    self.i += 2;
                } else {
                    let (v, len) = self.octal(i + 1);
                    self.emit_unit(v);
                    self.i += 1 + len;
                }
            }
            0x30 => {
                let (v, len) = self.octal(i + 1);
                self.emit_unit(v);
                self.i += 1 + len;
            }
            0x6b if !self.names.1.is_empty() => {
                if !is(p, i + 2, b'<') {
                    return Err(Fail::Invalid);
                }
                let (name, end) = group_name(p, i + 3)?;
                let n = self.names.1.iter().find(|(m, _)| *m == name).map(|(_, n)| *n).ok_or(Fail::Invalid)?;
                self.backreference(n);
                self.i = end;
            }
            0x63 => match p.get(i + 2) {
                Some(&l) if (l < 0x80) && (l as u8).is_ascii_alphabetic() => {
                    self.emit_unit(l % 32);
                    self.i += 3;
                }
                _ => {
                    self.emit_unit(0x5c);
                    self.i += 1;
                }
            },
            _ => {
                let (u, len) = self.char_escape();
                self.emit_unit(u);
                self.i += 1 + len;
            }
        }
        Ok(())
    }

    fn class_atom(&mut self) -> R<ClassAtom> {
        let (p, i) = (self.p, self.i);
        let c = p[i];
        if c != 0x5c {
            self.i += 1;
            return Ok(ClassAtom::Unit(c));
        }
        let Some(&d) = p.get(i + 1) else { return Err(Fail::Invalid) };
        if let Some(s) = class_escape(d) {
            self.i += 2;
            return Ok(ClassAtom::Set(s));
        }
        let (u, len) = match d {
            0x62 => (0x08, 1),
            0x30..=0x37 => self.octal(i + 1),
            0x63 => match p.get(i + 2) {
                Some(&l) if l < 0x80 && ((l as u8).is_ascii_alphanumeric() || l == 0x5f) => (l % 32, 2),
                _ => (0x5c, 0),
            },
            0x6b if !self.names.1.is_empty() => return Err(Fail::Invalid),
            _ => self.char_escape(),
        };
        self.i += 1 + len;
        Ok(ClassAtom::Unit(u))
    }

    fn class(&mut self) -> R<()> {
        self.i += 1;
        let negate = self.at(b'^');
        if negate {
            self.i += 1;
        }
        let mut set = Set::new();
        let add = |set: &mut Set, a: ClassAtom| match a {
            ClassAtom::Unit(u) => set.add(u),
            ClassAtom::Set(s) => set.union(&s),
        };
        loop {
            if self.i >= self.p.len() {
                return Err(Fail::Invalid);
            }
            if self.at(b']') {
                self.i += 1;
                break;
            }
            let a = self.class_atom()?;
            if self.at(b'-') && self.i + 1 < self.p.len() && !is(self.p, self.i + 1, b']') {
                self.i += 1;
                let b = self.class_atom()?;
                match (a, b) {
                    (ClassAtom::Unit(x), ClassAtom::Unit(y)) => {
                        if x > y {
                            return Err(Fail::Invalid);
                        }
                        set.add_range(x, y);
                    }
                    (a, b) => {
                        add(&mut set, a);
                        set.add(0x2d);
                        add(&mut set, b);
                    }
                }
            } else {
                add(&mut set, a);
            }
        }
        if self.icase {
            set = fold(&set);
        }
        self.emit_set(if negate { set.inverted() } else { set }, false);
        Ok(())
    }

    fn emit_unit(&mut self, u: u16) {
        if self.icase {
            let mut s = Set::new();
            s.add(u);
            self.emit_set(s, true);
        } else if u < 0x80 && b"^$\\.*+?()[]{}|/".contains(&(u as u8)) {
            self.out.extend([0x5c, u32::from(u)]);
        } else {
            self.out.push(u32::from(u));
        }
    }

    /// A set as one atom, folded first when `fold_case`. Lead and trail surrogates sit in classes of their own, so
    /// regress never reads a lead and trail side by side as one code point.
    fn emit_set(&mut self, set: Set, fold_case: bool) {
        let set = if fold_case && self.icase { fold(&set) } else { set };
        let mut parts: [Vec<(u16, u16)>; 3] = Default::default();
        for (a, b) in set.ranges() {
            for (k, lo, hi) in [(0, 0, 0xd7ff), (1, 0xd800, 0xdbff), (2, 0xdc00, 0xdfff), (0, 0xe000, 0xffff)] {
                let (x, y) = (a.max(lo), b.min(hi));
                if x <= y {
                    parts[k].push((x, y));
                }
            }
        }
        let parts: Vec<&Vec<(u16, u16)>> = parts.iter().filter(|p| !p.is_empty()).collect();
        let class = |out: &mut Vec<u32>, rs: &[(u16, u16)]| {
            let unit = |out: &mut Vec<u32>, u: u16| {
                if b"\\]-[^".contains(&(u as u8)) && u < 0x80 {
                    out.push(0x5c);
                }
                out.push(u32::from(u));
            };
            out.push(0x5b);
            for &(a, b) in rs {
                unit(out, a);
                if b > a {
                    out.push(0x2d);
                    unit(out, b);
                }
            }
            out.push(0x5d);
        };
        match parts.as_slice() {
            [] => self.push("[]"),
            [one] => class(&mut self.out, one),
            many => {
                self.push("(?:");
                for (k, rs) in many.iter().enumerate() {
                    if k > 0 {
                        self.push("|");
                    }
                    class(&mut self.out, rs);
                }
                self.push(")");
            }
        }
    }
}
