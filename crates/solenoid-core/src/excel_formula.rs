// [[C16]] polarsEngine, [[C22]] rowFormulaRefs, [[C80]] blankArgIsExcelBlank
//! Port of `src/graph/excelFormula.ts`: the tokenizer and parser whole, and the evaluator for a row formula over
//! scalars (a computed column's `@price * @qty`). The table-driven facts a call needs (argument roles, an empty
//! slot's reading, the null rule, range or broadcast) come lowered from the TS (`formulaCallTable`), as unit scales
//! do for the frame verbs, so the Rust carries only the function bodies (`excel_functions.rs`). A formula outside
//! the ported surface answers `Unsupported`, and the TS evaluates it.

use std::collections::HashMap;
use std::rc::Rc;

use serde::Deserialize;
use serde_json::{json, Value as Json};

use crate::error_value::{sol_error, SolError};
use crate::excel_functions::{call_function, is_ported, to_f64_js, V};
use crate::frame::{FrameCell, FrameColumn, FrameValue};
use crate::fxhash::{FxHashMap, FxHashSet};
use crate::jsnum::{js_trim, string_to_number};
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
    match name.to_lowercase().as_str() {
        "pi" => Some(std::f64::consts::PI),
        "tau" => Some(2.0 * std::f64::consts::PI),
        "e" => Some(std::f64::consts::E),
        "phi" => Some((1.0 + 5f64.sqrt()) / 2.0),
        _ => None,
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
}

#[derive(Deserialize, Clone, Debug)]
pub struct CallTraits {
    /// "handler" (the IFERROR family), "whole", "range" or "broadcast": the step of the dispatch ladder it takes.
    pub kind: String,
    #[serde(rename = "inspectsNull", default)]
    pub inspects_null: bool,
    #[serde(rename = "nullableOk", default)]
    pub nullable_ok: bool,
    #[serde(default)]
    pub prep: String,
    /// By argument index; null where the argument has no role.
    #[serde(default)]
    pub roles: Vec<Option<Role>>,
    /// An empty slot's reading by argument index, where the blank-slot pass sets one.
    #[serde(default)]
    pub blanks: HashMap<String, Json>,
    /// The argument indexes a list would lift in, which runs on the TS.
    #[serde(default)]
    pub scalar: Vec<usize>,
}

pub type CallTable = FxHashMap<String, CallTraits>;

/// A lowered value: JSON scalars, `{"__undef": 1}` for JS `undefined` (a left-out default).
fn lowered(v: &Json) -> V {
    match v {
        Json::Null => V::Null,
        Json::Bool(b) => V::Bool(*b),
        Json::Number(n) => V::Num(n.as_f64().unwrap_or(f64::NAN)),
        Json::String(s) => V::Str(Rc::from(s.as_str())),
        _ => V::Undef,
    }
}

// ─── Support check ──────────────────────────────────────────────────────────────

/// A whole column (a bare column name or `[name]`) is supported only as a direct argument of a range function
/// whose prep this port carries, `list_ok`; anywhere else it would broadcast, which runs on the TS.
fn supported(n: &Ast, columns: &FxHashMap<&str, &FrameColumn>, sides: &FxHashMap<String, V>, table: &CallTable) -> bool {
    supported_at(n, columns, sides, table, false)
}

fn whole_column<'a>(n: &Ast, columns: &FxHashMap<&str, &'a FrameColumn>, sides: &FxHashMap<String, V>) -> Option<&'a FrameColumn> {
    match n {
        Ast::Name(name) if constant_value(name).is_none() && !sides.contains_key(name) => columns.get(name.as_str()).copied(),
        Ast::WholeCol(name) => columns.get(name.as_str()).copied(),
        _ => None,
    }
}

fn supported_at(n: &Ast, columns: &FxHashMap<&str, &FrameColumn>, sides: &FxHashMap<String, V>, table: &CallTable, list_ok: bool) -> bool {
    let ok = |a: &Ast| supported_at(a, columns, sides, table, false);
    if whole_column(n, columns, sides).is_some() {
        return list_ok;
    }
    match n {
        Ast::Num(..) | Ast::Str(_) | Ast::Bool(_) | Ast::Blank => true,
        Ast::Name(name) => constant_value(name).is_some() || sides.contains_key(name),
        Ast::AtCol(name) => columns.contains_key(name.as_str()) || sides.contains_key(name),
        Ast::WholeCol(_) | Ast::Apply { .. } => false,
        Ast::Unary { arg, .. } | Ast::Percent(arg) => ok(arg),
        Ast::Bin { l, r, .. } => ok(l) && ok(r),
        Ast::Call { name, args } => {
            let up = name.to_uppercase();
            let roles_ok = table.get(&up).is_some_and(|t| {
                matches!(t.kind.as_str(), "handler" | "whole" | "range" | "broadcast") && t.roles.len() >= args.len()
            });
            let lists = table.get(&up).is_some_and(|t| {
                (t.kind == "range" && matches!(t.prep.as_str(), "raw" | "default" | "positional" | "paired"))
                    || (t.kind == "whole" && crate::excel_functions::takes_whole_lists(&up))
            });
            // A list where one value goes lifts, and a lookup over a list spills: either answers a list, which only
            // the TS's broadcast reads.
            let lifts = |i: usize| table.get(&up).is_some_and(|t| t.scalar.contains(&i)) || (i == 0 && matches!(up.as_str(), "XLOOKUP" | "XMATCH"));
            is_ported(&up) && roles_ok && args.iter().enumerate().all(|(i, a)| supported_at(a, columns, sides, table, lists && !lifts(i)))
        }
    }
}

// ─── Evaluator ──────────────────────────────────────────────────────────────────

struct Row<'a> {
    /// Each whole column once, as the TS's `wholeCol` caches it.
    lists: FxHashMap<&'a str, Rc<Vec<V>>>,
    /// A call whose subtree reads no `@` cell answers the same every row (`rangeMemo`'s hit), so once.
    memo: std::cell::RefCell<FxHashMap<*const Ast, V>>,
    /// The calls whose subtree reads an `@` cell, found once.
    row_calls: FxHashSet<*const Ast>,
    columns: &'a FxHashMap<&'a str, &'a FrameColumn>,
    /// The side values a name that isn't a column reads: one scalar for every row.
    sides: &'a FxHashMap<String, V>,
    table: &'a CallTable,
    cursor: usize,
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

fn guard(result: f64, inputs: &[V]) -> V {
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

fn apply_op(op: &str, a: &V, b: &V) -> V {
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
    let (x, y) = (to_f64_js(&na), to_f64_js(&nb));
    match op {
        "+" => fin(x + y),
        "-" => fin(x - y),
        "*" => fin(x * y),
        "/" => {
            if matches!(nb, V::Num(n) if n == 0.0) && matches!(na, V::Num(_)) {
                V::err(sol_error("#DIV/0!", "Division by zero"))
            } else {
                fin(x / y)
            }
        }
        "^" => {
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
            let mut joined = String::new();
            push(&mut joined, a);
            push(&mut joined, b);
            V::Str(Rc::from(joined))
        }
        "=" | "<>" => {
            let eq = match (a, b) {
                (V::Str(x), V::Str(y)) => x.to_lowercase() == y.to_lowercase(),
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

/// `-x`, `+x` and `x / 100` with JavaScript's coercion.
fn js_number(v: &V) -> f64 {
    match v {
        V::Num(n) => *n,
        V::Bool(b) => f64::from(u8::from(*b)),
        V::Str(s) => string_to_number(s),
        _ => f64::NAN,
    }
}

fn reads_row(n: &Ast) -> bool {
    match n {
        Ast::AtCol(_) => true,
        Ast::Call { args, .. } | Ast::Apply { args, .. } => args.iter().any(reads_row),
        Ast::Unary { arg, .. } | Ast::Percent(arg) => reads_row(arg),
        Ast::Bin { l, r, .. } => reads_row(l) || reads_row(r),
        _ => false,
    }
}

impl Row<'_> {
    fn eval(&self, n: &Ast) -> V {
        if let Some(c) = whole_column(n, self.columns, self.sides) {
            return V::List(self.lists.get(c.name.as_str()).cloned().unwrap_or_default());
        }
        match n {
            Ast::Num(_, n) => V::Num(*n),
            Ast::Str(v) => V::Str(v.clone()),
            Ast::Bool(b) => V::Bool(*b),
            Ast::Blank => V::Null,
            Ast::AtCol(name) => match self.columns.get(name.as_str()) {
                Some(c) => cell_to_v(c.cell_at(self.cursor)),
                None => self.sides.get(name).cloned().unwrap_or(V::Undef),
            },
            Ast::Name(name) => constant_value(name).map_or_else(|| self.sides.get(name).cloned().unwrap_or(V::Undef), V::Num),
            Ast::WholeCol(_) | Ast::Apply { .. } => V::Undef,
            Ast::Unary { op, arg } => {
                let a = self.eval(arg);
                match a {
                    V::Err(_) | V::Fx(_) => a,
                    V::Null => V::Null,
                    other => V::Num(if *op == '-' { -js_number(&other) } else { js_number(&other) }),
                }
            }
            Ast::Percent(arg) => {
                let a = self.eval(arg);
                match a {
                    V::Err(_) | V::Fx(_) => a,
                    V::Null => V::Null,
                    other => V::Num(js_number(&other) / 100.0),
                }
            }
            Ast::Bin { op, l, r } => {
                let (l, r) = (self.eval(l), self.eval(r));
                apply_op(op, &l, &r)
            }
            Ast::Call { name, args } => {
                if self.row_calls.contains(&(n as *const Ast)) {
                    return self.call(name, args);
                }
                let key = n as *const Ast;
                if let Some(v) = self.memo.borrow().get(&key) {
                    return v.clone();
                }
                let v = self.call(name, args);
                if crate::excel_functions::thrown_pending() {
                    return v;
                }
                self.memo.borrow_mut().insert(key, v.clone());
                v
            }
        }
    }

    /// `name` arrives uppercased (`upper_calls`), as `callPlan` reads it.
    fn call(&self, name: &str, args: &[Ast]) -> V {
        let Some(t) = self.table.get(name) else { return V::Undef };
        let mut argv: Vec<V> = args.iter().map(|a| self.eval(a)).collect();
        let mut settled: Vec<bool> = args.iter().map(|a| matches!(a, Ast::Blank)).collect();
        for (i, v) in argv.iter_mut().enumerate() {
            let Some(Some(role)) = t.roles.get(i) else { continue };
            settled[i] = true;
            if v.is_sol_error() {
                continue;
            }
            match role {
                Role::Setting { blank } => {
                    if matches!(v, V::Null | V::Undef) {
                        *v = lowered(blank);
                    }
                }
                Role::Required => {
                    if matches!(v, V::Null | V::Undef) {
                        *v = V::err(sol_error("#SYNTAX!", format!("{name}: argument {} is blank, and it has no default", i + 1)));
                    }
                }
            }
        }
        for (i, a) in args.iter().enumerate() {
            if matches!(a, Ast::Blank) {
                if let Some(v) = t.blanks.get(&i.to_string()) {
                    argv[i] = lowered(v);
                }
            }
        }
        if t.kind == "handler" {
            return call_function(name, &argv);
        }
        if let Some(e) = argv.iter().find(|v| v.is_sol_error()) {
            return e.clone();
        }
        match t.kind.as_str() {
            "whole" => {
                if !t.nullable_ok && argv.iter().enumerate().any(|(i, v)| matches!(v, V::Null) && !settled[i]) {
                    return V::Null;
                }
                call_function(name, &argv)
            }
            "range" => {
                // prepRangeArgs: a list's first error answers, and its blanks drop, unless the function reads them raw.
                let mut prepped: Vec<V> = Vec::with_capacity(argv.len());
                let mut flat: Vec<V> = Vec::with_capacity(argv.len());
                for v in &argv {
                    match v {
                        V::List(items) => {
                            let kept: Vec<V> = if !matches!(t.prep.as_str(), "raw" | "positional") {
                                if let Some(e) = items.iter().find(|x| x.is_err()) {
                                    return match e {
                                        V::Fx(code) => V::err(crate::excel_functions::fx_error_to_sol(code)),
                                        other => other.clone(),
                                    };
                                }
                                if t.prep == "paired" {
                                    items.as_ref().clone()
                                } else {
                                    items.iter().filter(|x| !matches!(x, V::Null)).cloned().collect()
                                }
                            } else {
                                items.as_ref().clone()
                            };
                            flat.extend(kept.iter().cloned());
                            prepped.push(V::List(Rc::new(kept)));
                        }
                        other => {
                            flat.push(other.clone());
                            prepped.push(other.clone());
                        }
                    }
                }
                // RANGE_PAIRED: a row blank in any list drops from all of them.
                if t.prep == "paired" {
                    let lists: Vec<&Rc<Vec<V>>> = prepped.iter().filter_map(|v| if let V::List(l) = v { Some(l) } else { None }).collect();
                    if let Some(n) = lists.iter().map(|l| l.len()).min() {
                        let keep: Vec<usize> = (0..n).filter(|&i| !lists.iter().any(|l| matches!(l[i], V::Null))).collect();
                        if keep.len() != n {
                            prepped = prepped
                                .into_iter()
                                .map(|v| match v {
                                    V::List(l) => V::List(Rc::new(keep.iter().map(|&i| l[i].clone()).collect())),
                                    other => other,
                                })
                                .collect();
                            flat = prepped.iter().flat_map(|v| match v {
                                V::List(l) => l.as_ref().clone(),
                                other => vec![other.clone()],
                            }).collect();
                        }
                    }
                }
                // SUM adds a list as its own subtotal, and the positional bodies read their lists in place; every other
                // ported range function reads its lists flat.
                match call_function(name, if crate::excel_functions::reads_lists(name) { &prepped } else { &flat }) {
                    V::Num(r) if !r.is_finite() => guard(r, &flat),
                    r => r,
                }
            }
            _ => {
                if !t.inspects_null && argv.iter().enumerate().any(|(i, v)| matches!(v, V::Null) && !settled[i]) {
                    return V::Null;
                }
                match call_function(name, &argv) {
                    V::Num(r) => guard(r, &argv),
                    r => r,
                }
            }
        }
    }
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
    }
}

fn survey<'a>(
    n: &Ast,
    columns: &FxHashMap<&str, &'a FrameColumn>,
    sides: &FxHashMap<String, V>,
    wholes: &mut Vec<&'a FrameColumn>,
    row_calls: &mut FxHashSet<*const Ast>,
) {
    if let Some(c) = whole_column(n, columns, sides) {
        if !wholes.iter().any(|w| std::ptr::eq(*w, c)) {
            wholes.push(c);
        }
        return;
    }
    match n {
        Ast::Call { args, .. } | Ast::Apply { args, .. } => {
            if matches!(n, Ast::Call { .. }) && reads_row(n) {
                row_calls.insert(n as *const Ast);
            }
            if let Ast::Apply { func, .. } = n {
                survey(func, columns, sides, wholes, row_calls);
            }
            for a in args {
                survey(a, columns, sides, wholes, row_calls);
            }
        }
        Ast::Unary { arg, .. } | Ast::Percent(arg) => survey(arg, columns, sides, wholes, row_calls),
        Ast::Bin { l, r, .. } => {
            survey(l, columns, sides, wholes, row_calls);
            survey(r, columns, sides, wholes, row_calls);
        }
        _ => {}
    }
}

/// The tree with every call's name uppercased once, not per row.
fn upper_calls(n: Ast) -> Ast {
    let all = |args: Vec<Ast>| args.into_iter().map(upper_calls).collect();
    match n {
        Ast::Call { name, args } => Ast::Call { name: name.to_uppercase(), args: all(args) },
        Ast::Apply { func, args } => Ast::Apply { func: Box::new(upper_calls(*func)), args: all(args) },
        Ast::Unary { op, arg } => Ast::Unary { op, arg: Box::new(upper_calls(*arg)) },
        Ast::Percent(a) => Ast::Percent(Box::new(upper_calls(*a))),
        Ast::Bin { op, l, r } => Ast::Bin { op, l: Box::new(upper_calls(*l)), r: Box::new(upper_calls(*r)) },
        other => other,
    }
}

pub enum ColumnOutcome {
    Unsupported,
    Cells(Vec<FrameCell>),
}

/// A computed column's cells, `computeColumnCells` with an `expr` spec whose every name is a `@column` of `f`.
pub fn formula_column(f: &FrameValue, expr: &str, table: &CallTable, sides: &HashMap<String, FrameCell>, rows: usize) -> Result<ColumnOutcome, SolError> {
    let Some(ast) = parse_formula(expr) else { return Ok(ColumnOutcome::Unsupported) };
    let columns: FxHashMap<&str, &FrameColumn> = f.columns.iter().map(|c| (c.name.as_str(), c)).collect();
    let sides: FxHashMap<String, V> = sides.iter().map(|(k, v)| (k.clone(), cell_to_v(v))).collect();
    if !supported(&ast, &columns, &sides, table) {
        return Ok(ColumnOutcome::Unsupported);
    }
    let ast = upper_calls(ast);
    // Once, not per row: the whole columns the formula reads, and the calls that read an `@` cell.
    let mut wholes: Vec<&FrameColumn> = Vec::new();
    let mut row_calls: FxHashSet<*const Ast> = FxHashSet::default();
    survey(&ast, &columns, &sides, &mut wholes, &mut row_calls);
    let lists = wholes.iter().map(|c| (c.name.as_str(), Rc::new(c.values.iter().map(cell_to_v).collect::<Vec<_>>()))).collect();
    let mut row = Row { lists, memo: Default::default(), row_calls, columns: &columns, sides: &sides, table, cursor: 0 };
    let mut cells = Vec::with_capacity(rows);
    crate::excel_functions::take_bailed();
    for i in 0..rows {
        row.cursor = i;
        let v = row.eval(&ast);
        if crate::excel_functions::take_bailed() {
            crate::excel_functions::take_thrown();
            return Ok(ColumnOutcome::Unsupported);
        }
        cells.push(match crate::excel_functions::take_thrown() {
            Some(e) => FrameCell::err(e),
            None => tag_computed_cell(v),
        });
    }
    Ok(ColumnOutcome::Cells(cells))
}
