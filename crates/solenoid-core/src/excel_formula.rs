// [[C130]] rustCore, [[D98]] wholeColumnFallback, [[C22]] rowFormulaRefs, [[C80]] blankArgIsExcelBlank
//! Port of `src/graph/excelFormula.ts`: the tokenizer and parser whole, and the evaluator for a row formula over
//! scalars (a computed column's `@price * @qty`). The table-driven facts a call needs (argument roles, an empty
//! slot's reading, the null rule, range or broadcast) come lowered from the TS (`formulaCallTable`), as unit scales
//! do for the frame verbs, so the Rust carries only the function bodies (`excel_functions.rs`). A formula outside
//! the ported surface answers `Unsupported`, and the TS evaluates it.

use std::rc::Rc;

use serde::Deserialize;
use serde_json::{json, Value as Json};

use crate::error_value::sol_error;
use crate::excel_functions::{call_function, to_f64_js, V};
use crate::frame::FrameCell;
use crate::jsnum::js_trim;
use crate::string_order::compare_strings;
use crate::value_kinds::guard_finite;

// ─── AST ────────────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq)]
pub enum Ast {
    /// The literal's text, and the number it reads as, parsed once.
    Num(String, f64),
    Str(Rc<str>),
    Bool(bool),
    Name(String),
    Call { name: String, args: Vec<Ast> },
    Apply { func: Box<Ast>, args: Vec<Ast> },
    Unary { op: char, arg: Box<Ast> },
    Percent(Box<Ast>),
    Bin { op: String, l: Box<Ast>, r: Box<Ast> },
    Blank,
    AtCol(String),
    WholeCol(String),
}

impl Ast {
    /// The TS `Ast` object, field for field.
    pub fn to_json(&self) -> Json {
        match self {
            Ast::Num(v, _) => json!({ "t": "num", "v": v }),
            Ast::Str(v) => json!({ "t": "str", "v": v.as_ref() }),
            Ast::Bool(v) => json!({ "t": "bool", "v": v }),
            Ast::Name(n) => json!({ "t": "name", "name": n }),
            Ast::Call { name, args } => json!({ "t": "call", "name": name, "args": args.iter().map(Ast::to_json).collect::<Vec<_>>() }),
            Ast::Apply { func, args } => json!({ "t": "apply", "fn": func.to_json(), "args": args.iter().map(Ast::to_json).collect::<Vec<_>>() }),
            Ast::Unary { op, arg } => json!({ "t": "unary", "op": op.to_string(), "arg": arg.to_json() }),
            Ast::Percent(a) => json!({ "t": "percent", "arg": a.to_json() }),
            Ast::Bin { op, l, r } => json!({ "t": "bin", "op": op, "l": l.to_json(), "r": r.to_json() }),
            Ast::Blank => json!({ "t": "blank" }),
            Ast::AtCol(n) => json!({ "t": "atcol", "name": n }),
            Ast::WholeCol(n) => json!({ "t": "wholecol", "name": n }),
        }
    }
}

// ─── Tokenizer ──────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Debug)]
enum K {
    Num,
    Str,
    Name,
    Op,
    Paren,
    Comma,
    ColRef,
    RowRef,
}

#[derive(Clone, Debug)]
struct Tok {
    k: K,
    v: String,
}

fn digit(c: Option<char>) -> bool {
    matches!(c, Some('0'..='9'))
}

fn id_start(c: char) -> bool {
    c.is_ascii_alphabetic() || c == '_' || c == 'λ'
}

fn id_char(c: Option<char>) -> bool {
    matches!(c, Some(c) if c.is_ascii_alphanumeric() || c == '_' || c == 'λ')
}

/// `^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$`
fn is_number_literal(v: &str) -> bool {
    let all = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    let (mant, exp) = match v.find(['e', 'E']) {
        Some(i) => (&v[..i], Some(&v[i + 1..])),
        None => (v, None),
    };
    let mant_ok = match mant.split_once('.') {
        None => all(mant),
        Some((a, f)) => (all(a) && (f.is_empty() || all(f))) || (a.is_empty() && all(f)),
    };
    mant_ok && exp.is_none_or(|e| all(e.strip_prefix(['+', '-']).unwrap_or(e)))
}

fn tokenize(src: &str) -> Option<Vec<Tok>> {
    let s: Vec<char> = src.chars().collect();
    let at = |i: usize| s.get(i).copied();
    let slice = |a: usize, b: usize| s[a..b].iter().collect::<String>();
    let mut toks = Vec::new();
    let mut i = 0;
    while i < s.len() {
        let c = s[i];
        if matches!(c, ' ' | '\t' | '\n' | '\r') {
            i += 1;
            continue;
        }
        if digit(Some(c)) || (c == '.' && digit(at(i + 1))) {
            let mut j = i + 1;
            while matches!(at(j), Some('0'..='9' | '.')) {
                j += 1;
            }
            if matches!(at(j), Some('e' | 'E')) {
                j += 1;
                if matches!(at(j), Some('+' | '-')) {
                    j += 1;
                }
                while digit(at(j)) {
                    j += 1;
                }
            }
            let v = slice(i, j);
            if !is_number_literal(&v) {
                return None;
            }
            toks.push(Tok { k: K::Num, v });
            i = j;
            continue;
        }
        if c == '"' {
            let mut j = i + 1;
            while j < s.len() && s[j] != '"' {
                j += 1;
            }
            if j >= s.len() {
                return None;
            }
            toks.push(Tok { k: K::Str, v: slice(i + 1, j) });
            i = j + 1;
            continue;
        }
        if id_start(c) {
            let mut j = i + 1;
            while j < s.len() && (id_char(at(j)) || (s[j] == '.' && id_char(at(j + 1)))) {
                j += 1;
            }
            toks.push(Tok { k: K::Name, v: slice(i, j) });
            i = j;
            continue;
        }
        if i + 1 < s.len() {
            let two: String = s[i..i + 2].iter().collect();
            if two == "<>" || two == "<=" || two == ">=" {
                toks.push(Tok { k: K::Op, v: two });
                i += 2;
                continue;
            }
        }
        if "+-*/^%&=<>@".contains(c) {
            toks.push(Tok { k: K::Op, v: c.to_string() });
            i += 1;
            continue;
        }
        if c == '(' || c == ')' {
            toks.push(Tok { k: K::Paren, v: c.to_string() });
            i += 1;
            continue;
        }
        if c == ',' {
            toks.push(Tok { k: K::Comma, v: ",".into() });
            i += 1;
            continue;
        }
        if c == '[' {
            let mut j = i + 1;
            let mut row = false;
            if at(j) == Some('@') {
                row = true;
                j += 1;
            }
            let name;
            if row && at(j) == Some('[') {
                let mut e = j + 1;
                while e < s.len() && s[e] != ']' {
                    e += 1;
                }
                if e >= s.len() || at(e + 1) != Some(']') {
                    return None;
                }
                name = slice(j + 1, e);
                j = e + 2;
            } else {
                let mut e = j;
                while e < s.len() && s[e] != ']' {
                    e += 1;
                }
                if e >= s.len() {
                    return None;
                }
                name = slice(j, e);
                j = e + 1;
            }
            let name = js_trim(&name).to_string();
            if name.is_empty() {
                return None;
            }
            toks.push(Tok { k: if row { K::RowRef } else { K::ColRef }, v: name });
            i = j;
            continue;
        }
        return None;
    }
    Some(toks)
}

// ─── Parser (Excel precedence) ──────────────────────────────────────────────────

struct Parser {
    toks: Vec<Tok>,
    p: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.p)
    }

    fn eat(&mut self) -> Tok {
        self.p += 1;
        self.toks[self.p - 1].clone()
    }

    fn peek_v(&self, v: &str) -> bool {
        self.peek().is_some_and(|t| t.v == v)
    }

    fn peek_k(&self, k: K, v: &str) -> bool {
        self.peek().is_some_and(|t| t.k == k && t.v == v)
    }

    fn is_op(&self, vs: &[&str]) -> bool {
        self.peek().is_some_and(|t| t.k == K::Op && vs.contains(&t.v.as_str()))
    }

    fn bin(op: String, l: Ast, r: Ast) -> Ast {
        Ast::Bin { op, l: Box::new(l), r: Box::new(r) }
    }

    fn comparison(&mut self) -> Option<Ast> {
        let mut l = self.concat()?;
        while self.is_op(&["=", "<>", "<", ">", "<=", ">="]) {
            let op = self.eat().v;
            let r = self.concat()?;
            l = Self::bin(op, l, r);
        }
        Some(l)
    }

    fn concat(&mut self) -> Option<Ast> {
        let mut l = self.add()?;
        while self.is_op(&["&"]) {
            self.eat();
            let r = self.add()?;
            l = Self::bin("&".into(), l, r);
        }
        Some(l)
    }

    fn add(&mut self) -> Option<Ast> {
        let mut l = self.mul()?;
        while self.is_op(&["+", "-"]) {
            let op = self.eat().v;
            let r = self.mul()?;
            l = Self::bin(op, l, r);
        }
        Some(l)
    }

    fn mul(&mut self) -> Option<Ast> {
        let mut l = self.exp()?;
        while self.is_op(&["*", "/"]) {
            let op = self.eat().v;
            let r = self.exp()?;
            l = Self::bin(op, l, r);
        }
        Some(l)
    }

    // Left-associative, as in Excel: 2^3^2 is 64.
    fn exp(&mut self) -> Option<Ast> {
        let mut l = self.percent()?;
        while self.is_op(&["^"]) {
            self.eat();
            let r = self.percent()?;
            l = Self::bin("^".into(), l, r);
        }
        Some(l)
    }

    fn percent(&mut self) -> Option<Ast> {
        let mut a = self.unary()?;
        while self.is_op(&["%"]) {
            self.eat();
            a = Ast::Percent(Box::new(a));
        }
        Some(a)
    }

    fn unary(&mut self) -> Option<Ast> {
        if self.is_op(&["-", "+"]) {
            let op = self.eat().v.chars().next().unwrap();
            let arg = self.unary()?;
            return Some(Ast::Unary { op, arg: Box::new(arg) });
        }
        self.primary()
    }

    /// Starts at the open paren. Like the TS, the closing test reads only a token's text.
    fn arg_list(&mut self) -> Option<Vec<Ast>> {
        self.eat();
        let mut args = Vec::new();
        if !self.peek_v(")") {
            loop {
                if self.peek().is_some_and(|t| t.k == K::Comma) || self.peek_k(K::Paren, ")") {
                    args.push(Ast::Blank);
                } else {
                    args.push(self.comparison()?);
                }
                if self.peek().is_some_and(|t| t.k == K::Comma) {
                    self.eat();
                    continue;
                }
                break;
            }
        }
        if !self.peek_v(")") {
            return None;
        }
        self.eat();
        Some(args)
    }

    fn primary(&mut self) -> Option<Ast> {
        let mut node = self.primary_no_apply()?;
        while self.peek_k(K::Paren, "(") {
            let args = self.arg_list()?;
            node = Ast::Apply { func: Box::new(node), args };
        }
        Some(node)
    }

    fn primary_no_apply(&mut self) -> Option<Ast> {
        let t = self.peek()?.clone();
        if t.k == K::Op && t.v == "@" {
            self.eat();
            let n = self.peek()?.clone();
            if n.k != K::Name && n.k != K::ColRef {
                return None;
            }
            self.eat();
            return Some(Ast::AtCol(n.v));
        }
        match t.k {
            K::ColRef => {
                self.eat();
                Some(Ast::WholeCol(t.v))
            }
            K::RowRef => {
                self.eat();
                Some(Ast::AtCol(t.v))
            }
            K::Num => {
                self.eat();
                let n = t.v.parse::<f64>().unwrap_or(f64::NAN);
                Some(Ast::Num(t.v, n))
            }
            K::Str => {
                self.eat();
                Some(Ast::Str(Rc::from(t.v)))
            }
            K::Paren if t.v == "(" => {
                self.eat();
                let e = self.comparison()?;
                if !self.peek_v(")") {
                    return None;
                }
                self.eat();
                Some(e)
            }
            K::Name => {
                self.eat();
                if self.peek_k(K::Paren, "(") {
                    let args = self.arg_list()?;
                    return Some(Ast::Call { name: t.v, args });
                }
                let up = t.v.to_uppercase();
                if up == "TRUE" {
                    return Some(Ast::Bool(true));
                }
                if up == "FALSE" {
                    return Some(Ast::Bool(false));
                }
                Some(Ast::Name(t.v))
            }
            _ => None,
        }
    }
}

pub fn parse_formula(expr: &str) -> Option<Ast> {
    if js_trim(expr).is_empty() {
        return None;
    }
    let toks = tokenize(expr)?;
    let mut p = Parser { toks, p: 0 };
    let node = p.comparison()?;
    if p.p != p.toks.len() {
        return None;
    }
    Some(node)
}

pub fn constant_value(name: &str) -> Option<f64> {
    // No non-ASCII letter lowercases to an ASCII p, i, t, a, u, e or h, so a non-ASCII name is never a constant.
    if name.len() > 3 || !name.is_ascii() {
        return None;
    }
    let is = |c: &str| name.eq_ignore_ascii_case(c);
    if is("pi") {
        Some(std::f64::consts::PI)
    } else if is("tau") {
        Some(2.0 * std::f64::consts::PI)
    } else if is("e") {
        Some(std::f64::consts::E)
    } else if is("phi") {
        Some((1.0 + 5f64.sqrt()) / 2.0)
    } else {
        None
    }
}

// ─── The lowered call table ─────────────────────────────────────────────────────

#[derive(Deserialize, Clone, Debug)]
#[serde(tag = "kind")]
pub enum Role {
    #[serde(rename = "setting")]
    Setting { blank: Json },
    #[serde(rename = "required")]
    Required,
    /// Positions (INDEX's): a blank one is left out.
    #[serde(rename = "picks")]
    Picks { required: bool },
}

#[derive(Deserialize, Clone, Debug)]
pub struct Refusal {
    pub code: String,
    pub message: String,
}


/// A lowered value: JSON scalars, `{"__undef": 1}` for JS `undefined` (a left-out default).
pub(crate) fn lowered(v: &Json) -> V {
    match v {
        Json::Null => V::Null,
        Json::Bool(b) => V::Bool(*b),
        Json::Number(n) => V::Num(n.as_f64().unwrap_or(f64::NAN)),
        Json::String(s) => V::Str(Rc::from(s.as_str())),
        _ => V::Undef,
    }
}

// ─── Evaluator ──────────────────────────────────────────────────────────────────

/// `dispatch`: a body's JavaScript failure answers #VALUE! at its call, so IFERROR reads it; a bail still ends the row.
pub(crate) fn call_caught(name: &str, argv: &[V]) -> V {
    let v = call_function(name, argv);
    if crate::excel_functions::thrown_pending() && !crate::excel_functions::bail_pending() {
        crate::excel_functions::take_thrown();
        return V::err(sol_error("#VALUE!", format!("{name} can't compute with these arguments")));
    }
    v
}

fn cell_to_v(c: &FrameCell) -> V {
    match c {
        FrameCell::Null => V::Null,
        FrameCell::Num(n) => V::Num(*n),
        FrameCell::Str(s) => V::Str(s.clone()),
        FrameCell::Bool(b) => V::Bool(*b),
        FrameCell::Err(e) => V::Err(e.clone()),
    }
}

pub fn cell_to_v_pub(c: &FrameCell) -> V {
    cell_to_v(c)
}

pub(crate) fn guard(result: f64, inputs: &[V]) -> V {
    if result.is_finite() {
        return V::Num(result);
    }
    match guard_finite(result, &inputs.iter().filter_map(|v| if let V::Num(n) = v { Some(*n) } else { None }).collect::<Vec<_>>()) {
        FrameCell::Num(n) => V::Num(n),
        FrameCell::Err(e) => V::Err(e),
        _ => V::Null,
    }
}

fn num_of(v: &V) -> V {
    match v {
        V::Bool(b) => V::Num(f64::from(u8::from(*b))),
        other => other.clone(),
    }
}

/// `numberToText` in excelFunctions.ts.
pub fn number_to_text(x: f64) -> String {
    crate::excel_functions::number_to_text(x)
}

pub(crate) fn apply_op(op: &str, a: &V, b: &V) -> V {
    if a.is_err() {
        return a.clone();
    }
    if b.is_err() {
        return b.clone();
    }
    if matches!(a, V::Null) || matches!(b, V::Null) {
        return V::Null;
    }
    let (na, nb) = (num_of(a), num_of(b));
    let fin = |r: f64| if r.is_finite() { V::Num(r) } else { guard(r, &[na.clone(), nb.clone()]) };
    if matches!(op, "+" | "-" | "*" | "/" | "^") && (matches!(na, V::Str(_)) || matches!(nb, V::Str(_))) {
        return V::err(sol_error("#VALUE!", "Arithmetic needs numbers. Join text with &, or read a number from text with NUMBERVALUE"));
    }
    let xy = || (to_f64_js(&na), to_f64_js(&nb));
    match op {
        "+" => {
            let (x, y) = xy();
            fin(x + y)
        }
        "-" => {
            let (x, y) = xy();
            fin(x - y)
        }
        "*" => {
            let (x, y) = xy();
            fin(x * y)
        }
        "/" => {
            let (x, y) = xy();
            if matches!(nb, V::Num(n) if n == 0.0) && matches!(na, V::Num(_)) {
                V::err(sol_error("#DIV/0!", "Division by zero"))
            } else {
                fin(x / y)
            }
        }
        "^" => {
            let (x, y) = xy();
            if x == 0.0 && y < 0.0 {
                V::err(sol_error("#DIV/0!", "Zero to a negative power divides by zero"))
            } else {
                fin(crate::excel_functions::js_pow(x, y))
            }
        }
        "&" => {
            let push = |out: &mut String, v: &V| match v {
                V::Str(s) => out.push_str(s),
                V::Bool(b) => out.push_str(if *b { "TRUE" } else { "FALSE" }),
                V::Num(n) => out.push_str(&number_to_text(*n)),
                other => out.push_str(&crate::excel_functions::js_string_of(other)),
            };
            let mut joined = String::with_capacity(32);
            push(&mut joined, a);
            push(&mut joined, b);
            V::Str(Rc::from(joined))
        }
        "=" | "<>" => {
            let eq = match (a, b) {
                // Lowercasing allocates, so equal or all-ASCII text skips it; non-ASCII can lowercase into ASCII (K, the Kelvin sign).
                (V::Str(x), V::Str(y)) => x == y || if x.is_ascii() && y.is_ascii() { x.eq_ignore_ascii_case(y) } else { x.to_lowercase() == y.to_lowercase() },
                _ => match (&na, &nb) {
                    (V::Num(x), V::Num(y)) => x == y,
                    (V::Str(x), V::Str(y)) => x == y,
                    (V::Undef, V::Undef) => true,
                    _ => false,
                },
            };
            V::Bool(if op == "=" { eq } else { !eq })
        }
        "<" | ">" | "<=" | ">=" => {
            let cmp = match (&na, &nb) {
                (V::Num(x), V::Num(y)) => {
                    if x < y {
                        -1
                    } else if x > y {
                        1
                    } else {
                        0
                    }
                }
                (V::Str(x), V::Str(y)) => compare_strings(x, y) as i32,
                _ => return V::err(sol_error("#TYPE!", "Cannot order values of different types; Cast one side first")),
            };
            V::Bool(match op {
                "<" => cmp < 0,
                ">" => cmp > 0,
                "<=" => cmp <= 0,
                _ => cmp >= 0,
            })
        }
        _ => V::Num(f64::NAN),
    }
}


pub fn tag_computed_cell_pub(v: V) -> FrameCell {
    tag_computed_cell(v)
}

/// `tagComputedCell` after `normalizeFxResult`.
fn tag_computed_cell(v: V) -> FrameCell {
    match v {
        V::Num(n) if n.is_nan() => FrameCell::err(sol_error("#DOMAIN!", "The result is undefined: not a number")),
        V::Num(n) => FrameCell::Num(n),
        V::Str(s) => FrameCell::Str(s),
        V::Bool(b) => FrameCell::Bool(b),
        V::Null | V::Undef => FrameCell::Null,
        V::Err(e) => FrameCell::Err(e),
        V::Fx(code) => FrameCell::err(crate::excel_functions::fx_error_to_sol(code)),
        V::List(_) => FrameCell::err(sol_error("#SHAPE!", "A computed column needs one value per row. Use @name to read this row's cell.")),
        V::Cx(..) | V::Lambda(_) => FrameCell::err(sol_error("#VALUE!", "Each row of a computed column must be a number, text, TRUE/FALSE or blank.")),
    }
}
