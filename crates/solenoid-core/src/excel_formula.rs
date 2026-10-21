// [[C130]] rustCore, [[D98]] wholeColumnFallback, [[C22]] rowFormulaRefs, [[C80]] blankArgIsExcelBlank
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
    /// Positions (INDEX's): a blank one is left out.
    #[serde(rename = "picks")]
    Picks { required: bool },
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
    /// Whether a broadcast call maps over a whole column cell by cell.
    #[serde(rename = "mapsColumns", default)]
    pub maps_columns: bool,
    /// The error a blocked, node-only or unknown name answers before its arguments are read (`callRefusal`).
    #[serde(default)]
    pub refusal: Option<Refusal>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct Refusal {
    pub code: String,
    pub message: String,
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
fn supported(n: &Ast, columns: &FxHashMap<&str, &FrameColumn>, sides: &FxHashMap<String, V>, table: &CallTable, lambdas: &Lambdas) -> bool {
    supported_at(n, &Cx { columns, sides, table, lambdas, env: None }, false)
}

/// What the support check reads: the frame's columns, the side values, the call table, the wired LAMBDAs, and the
/// LAMBDA whose body is being checked, if any.
struct Cx<'c, 'a> {
    columns: &'c FxHashMap<&'a str, &'a FrameColumn>,
    sides: &'c FxHashMap<String, V>,
    table: &'c CallTable,
    lambdas: &'c Lambdas,
    env: Option<&'c Lambda>,
}

/// A wired LAMBDA lowered from the TS: `compilePositional(expr, [...params, ...captured])`. A captured name that is
/// a column of the table reads that whole column, as a column outranks a capture.
pub struct Lambda {
    pub params: Vec<String>,
    pub body: Ast,
    pub captured: Vec<(String, V)>,
}

pub type Lambdas = FxHashMap<String, Lambda>;

impl Lambda {
    fn binds(&self, name: &str) -> bool {
        self.params.iter().any(|p| p == name) || self.captured.iter().any(|(c, _)| c == name)
    }

    /// A captured name that reads a whole column.
    fn captured_column<'a>(&self, name: &str, columns: &FxHashMap<&str, &'a FrameColumn>) -> Option<&'a FrameColumn> {
        if self.params.iter().any(|p| p == name) {
            return None;
        }
        self.captured.iter().any(|(c, _)| c == name).then(|| columns.get(name).copied()).flatten()
    }
}

fn whole_column<'a>(n: &Ast, columns: &FxHashMap<&str, &'a FrameColumn>, sides: &FxHashMap<String, V>) -> Option<&'a FrameColumn> {
    match n {
        Ast::Name(name) if constant_value(name).is_none() && !sides.contains_key(name) => columns.get(name.as_str()).copied(),
        Ast::WholeCol(name) => columns.get(name.as_str()).copied(),
        _ => None,
    }
}

use crate::shapers::is_shaper;

fn supported_at(n: &Ast, cx: &Cx, list_ok: bool) -> bool {
    let (columns, table) = (cx.columns, cx.table);
    // Inside a LAMBDA body a bare name is only a parameter or a capture (`compilePositional`'s env).
    let whole = match (cx.env, n) {
        (Some(lam), Ast::Name(name)) => constant_value(name).is_none() && lam.captured_column(name, columns).is_some(),
        (Some(_), Ast::WholeCol(name)) => columns.contains_key(name.as_str()),
        (Some(_), _) => false,
        (None, _) => whole_column(n, columns, cx.sides).is_some(),
    };
    if whole {
        return list_ok;
    }
    match n {
        Ast::Num(..) | Ast::Str(_) | Ast::Bool(_) | Ast::Blank => true,
        Ast::Name(name) => match cx.env {
            Some(lam) => constant_value(name).is_some() || lam.binds(name),
            None => constant_value(name).is_some() || cx.sides.contains_key(name),
        },
        Ast::AtCol(name) => columns.contains_key(name.as_str()) || cx.env.is_some_and(|l| l.binds(name)) || cx.sides.contains_key(name),
        Ast::WholeCol(_) | Ast::Apply { .. } => false,
        // An operator maps over a list cell by cell (`mapCells`): where a list may go, its operands may be lists too.
        Ast::Unary { arg, .. } | Ast::Percent(arg) => supported_at(arg, cx, list_ok),
        Ast::Bin { l, r, .. } => supported_at(l, cx, list_ok) && supported_at(r, cx, list_ok),
        // A wired LAMBDA: its arguments one value each, its body in its own scope; a LAMBDA inside a body reads only
        // that body's env, which carries no LAMBDAs here.
        Ast::Call { name, args } if cx.lambdas.contains_key(name.as_str()) => {
            let lam = &cx.lambdas[name.as_str()];
            cx.env.is_none()
                && args.iter().all(|a| supported_at(a, cx, false))
                && supported_at(&lam.body, &Cx { env: Some(lam), ..*cx }, false)
        }
        Ast::Call { name, args } => {
            let up = name.to_uppercase();
            if table.get(&up).is_some_and(|t| t.refusal.is_some()) {
                return true;
            }
            let roles_ok = table.get(&up).is_some_and(|t| {
                matches!(t.kind.as_str(), "handler" | "whole" | "range" | "broadcast")
                    && t.roles.len() >= args.len()
                    && !t.roles.iter().any(|r| matches!(r, Some(Role::Picks { required: true })))
            });
            let picks = |i: usize| table.get(&up).is_some_and(|t| matches!(t.roles.get(i), Some(Some(Role::Picks { .. }))));
            let lists = table.get(&up).is_some_and(|t| {
                (t.kind == "range" && matches!(t.prep.as_str(), "raw" | "default" | "positional" | "paired" | "zero"))
                    || (t.kind == "whole" && crate::excel_functions::takes_whole_lists(&up))
            });
            // A list where one value goes lifts, and a lookup over a list spills: either answers a list, which only
            // the TS's broadcast reads.
            let lifts = |i: usize| table.get(&up).is_some_and(|t| t.scalar.contains(&i)) || (i == 0 && matches!(up.as_str(), "XLOOKUP" | "XMATCH"));
            // A broadcast or error-handling call over a list answers a list (`broadcastCall`, `mapCells`): its arguments
            // may be lists only where that list may go. A holiday list goes whole wherever the call is.
            let kind = table.get(&up).map_or("", |t| t.kind.as_str());
            let list_at = |i: usize| match kind {
                "broadcast" => (list_ok && table.get(&up).is_some_and(|t| t.maps_columns)) || whole_list_arg(&up) == Some(i),
                "handler" => list_ok,
                _ => lists && !lifts(i),
            };
            // A shaper's list goes only where a range function flattens it, or into another shaper as its data: an
            // operator over it would pair lists of two lengths, and a lookup reads its table's shape.
            let shaper_slot = |i: usize| cx.env.is_none() && kind == "range" && t_prep(table, &up) != "positional" && list_at(i) && !picks(i);
            // A list of positions picks many (`indexMany`), which stays on the TS.
            !is_shaper(&up)
                && is_ported(&up)
                && roles_ok
                && args.iter().enumerate().all(|(i, a)| match a {
                    Ast::Call { name: an, args: aa } if is_shaper(&an.to_uppercase()) => shaper_slot(i) && shaper_supported(an, aa, cx),
                    _ => supported_at(a, cx, list_at(i) && !picks(i)),
                })
        }
    }
}

fn t_prep<'a>(table: &'a CallTable, name: &str) -> &'a str {
    table.get(name).map_or("", |t| t.prep.as_str())
}

/// A FILTER, UNIQUE, SORT, SORTBY, TAKE or DROP in a list slot: its data and its full-length lines (FILTER's include,
/// SORTBY's keys) may be lists, every other argument one value.
fn shaper_supported(name: &str, args: &[Ast], cx: &Cx) -> bool {
    let up = name.to_uppercase();
    let line = |i: usize| match up.as_str() {
        "FILTER" => i == 1,
        "SORTBY" => i % 2 == 1,
        _ => false,
    };
    // DROP's columns can empty every row and leave rows of nothing, a shape a list can't carry.
    !(up == "DROP" && args.len() > 2)
        && cx.table.get(&up).is_some_and(|t| t.kind == "whole" && t.roles.len() >= args.len())
        && args.iter().enumerate().all(|(i, a)| match a {
            Ast::Call { name: an, args: aa } if i == 0 && is_shaper(&an.to_uppercase()) => shaper_supported(an, aa, cx),
            _ => supported_at(a, cx, i == 0 || line(i)),
        })
}

// ─── Evaluator ──────────────────────────────────────────────────────────────────

/// `dispatch`: a body's JavaScript failure answers #VALUE! at its call, so IFERROR reads it; a bail still ends the row.
fn call_caught(name: &str, argv: &[V]) -> V {
    let v = call_function(name, argv);
    if crate::excel_functions::thrown_pending() && !crate::excel_functions::bail_pending() {
        crate::excel_functions::take_thrown();
        return V::err(sol_error("#VALUE!", format!("{name} can't compute with these arguments")));
    }
    v
}

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
    lambdas: &'a Lambdas,
    /// The env of the LAMBDA body being evaluated: its parameters and captures.
    scope: std::cell::RefCell<Vec<Rc<FxHashMap<String, V>>>>,
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

/// `-x`, `+x` and `x / 100` with JavaScript's coercion.
fn js_number(v: &V) -> f64 {
    match v {
        V::Num(n) => *n,
        V::Bool(b) => f64::from(u8::from(*b)),
        V::Str(s) => string_to_number(s),
        _ => f64::NAN,
    }
}

/// `WHOLE_LIST_ARG`: the argument a function reads as one whole list (the holidays).
fn whole_list_arg(name: &str) -> Option<usize> {
    match name {
        "WORKDAY" | "NETWORKDAYS" => Some(2),
        "WORKDAY.INTL" | "NETWORKDAYS.INTL" => Some(3),
        _ => None,
    }
}

/// `broadcastWith`: the function over each cell of its list arguments; a cell's error answers, and a blank answers
/// blank unless the function inspects blanks.
fn broadcast_with(argv: &[V], blank_slots: &[bool], inspects_null: bool, f: impl Fn(&[V]) -> V) -> V {
    let call = |args: &[V]| match f(args) {
        V::Num(r) => guard(r, args),
        r => r,
    };
    if !argv.iter().any(|v| matches!(v, V::List(_))) {
        let blank = argv.iter().enumerate().any(|(i, v)| matches!(v, V::Null) && !blank_slots.get(i).copied().unwrap_or(false));
        return if !inspects_null && blank { V::Null } else { call(argv) };
    }
    let len = argv.iter().filter_map(|v| if let V::List(l) = v { Some(l.len()) } else { None }).max().unwrap_or(0);
    if len == 0 {
        return V::List(Rc::new(Vec::new()));
    }
    map_cells(argv, |ops| {
        if let Some(e) = ops.iter().find(|v| v.is_sol_error()) {
            return e.clone();
        }
        if !inspects_null && ops.iter().any(|v| matches!(v, V::Null)) {
            return V::Null;
        }
        call(ops)
    })
}

/// `mapCells` over values and 1-D lists: a one-item list reads as its item, and a cell past a shorter list's end is
/// blank.
pub fn map_cells_pub(argv: &[V], cell: impl Fn(&[V]) -> V) -> V {
    map_cells(argv, cell)
}

fn map_cells(argv: &[V], cell: impl Fn(&[V]) -> V) -> V {
    let args: Vec<V> = argv
        .iter()
        .map(|a| match a {
            V::List(items) if items.len() == 1 && !matches!(items[0], V::List(_)) => items[0].clone(),
            other => other.clone(),
        })
        .collect();
    let len = args.iter().filter_map(|a| if let V::List(l) = a { Some(l.len()) } else { None }).max();
    let Some(len) = len else { return cell(&args) };
    let mut out = Vec::with_capacity(len);
    let mut ops: Vec<V> = Vec::with_capacity(args.len());
    for i in 0..len {
        ops.clear();
        let mut short = false;
        for a in &args {
            match a {
                V::List(l) => match l.get(i) {
                    Some(v) => ops.push(v.clone()),
                    None => short = true,
                },
                other => ops.push(other.clone()),
            }
        }
        out.push(if short { V::Null } else { cell(&ops) });
    }
    V::List(Rc::new(out))
}

/// A wired LAMBDA's body may read the row, so a call to one reads it.
fn reads_row_in(n: &Ast, lambdas: &Lambdas) -> bool {
    match n {
        Ast::AtCol(_) => true,
        // ROW() is the row's own number.
        Ast::Call { name, .. } if name.eq_ignore_ascii_case("ROW") => true,
        Ast::Call { name, .. } if lambdas.contains_key(name.as_str()) => true,
        Ast::Call { args, .. } | Ast::Apply { args, .. } => args.iter().any(|a| reads_row_in(a, lambdas)),
        Ast::Unary { arg, .. } | Ast::Percent(arg) => reads_row_in(arg, lambdas),
        Ast::Bin { l, r, .. } => reads_row_in(l, lambdas) || reads_row_in(r, lambdas),
        _ => false,
    }
}

impl Row<'_> {
    fn eval(&self, n: &Ast) -> V {
        let env = self.scope.borrow().last().cloned();
        if let Some(env) = &env {
            // `compilePositional`: a name is the env's, and `@x` falls back to it when x isn't a column.
            match n {
                Ast::Name(name) => return constant_value(name).map_or_else(|| env.get(name).cloned().unwrap_or(V::Undef), V::Num),
                Ast::AtCol(name) => {
                    return match self.columns.get(name.as_str()) {
                        Some(c) => cell_to_v(c.cell_at(self.cursor)),
                        None => env.get(name).or_else(|| self.sides.get(name)).cloned().unwrap_or(V::Undef),
                    }
                }
                Ast::WholeCol(name) => {
                    return self.lists.get(name.as_str()).cloned().map_or(V::Undef, V::List);
                }
                _ => {}
            }
        } else if let Some(c) = whole_column(n, self.columns, self.sides) {
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
                if let V::List(_) = a {
                    let neg = *op == '-';
                    return map_cells(&[a], |x| match &x[0] {
                        e @ V::Err(_) => e.clone(),
                        V::Null => V::Null,
                        other => V::Num(if neg { -js_number(other) } else { js_number(other) }),
                    });
                }
                match a {
                    V::Err(_) | V::Fx(_) => a,
                    V::Null => V::Null,
                    other => V::Num(if *op == '-' { -js_number(&other) } else { js_number(&other) }),
                }
            }
            Ast::Percent(arg) => {
                let a = self.eval(arg);
                if let V::List(_) = a {
                    return map_cells(&[a], |x| match &x[0] {
                        e @ V::Err(_) => e.clone(),
                        V::Null => V::Null,
                        other => V::Num(js_number(other) / 100.0),
                    });
                }
                match a {
                    V::Err(_) | V::Fx(_) => a,
                    V::Null => V::Null,
                    other => V::Num(js_number(&other) / 100.0),
                }
            }
            Ast::Bin { op, l, r } => {
                let (l, r) = (self.eval(l), self.eval(r));
                if matches!(l, V::List(_)) || matches!(r, V::List(_)) {
                    return map_cells(&[l, r], |x| apply_op(op, &x[0], &x[1]));
                }
                apply_op(op, &l, &r)
            }
            Ast::Call { name, args } if env.is_none() && self.lambdas.contains_key(name.as_str()) => {
                let argv: Vec<V> = args.iter().map(|a| self.eval(a)).collect();
                if let Some(e) = argv.iter().find(|v| v.is_sol_error()) {
                    return e.clone();
                }
                let lam = &self.lambdas[name.as_str()];
                if !lam.params.is_empty() && argv.len() != lam.params.len() {
                    let n = lam.params.len();
                    return V::err(sol_error("#VALUE!", format!("{name} takes {n} argument{}, not {}", if n == 1 { "" } else { "s" }, argv.len())));
                }
                self.call_lambda(lam, argv)
            }
            Ast::Call { name, args } => {
                if env.is_some() || self.row_calls.contains(&(n as *const Ast)) {
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

    /// `lam.fn(...argv)`: the body over its parameters and captures, its Formula.js error read as Solenoid's
    /// (`compileEvaluator`'s `normalizeFxResult`).
    fn call_lambda(&self, lam: &Lambda, mut argv: Vec<V>) -> V {
        argv.resize(lam.params.len().max(argv.len()), V::Undef);
        let mut env: FxHashMap<String, V> = FxHashMap::default();
        for (p, v) in lam.params.iter().zip(argv) {
            env.insert(p.clone(), v);
        }
        for (c, v) in &lam.captured {
            let read = match lam.captured_column(c, self.columns) {
                Some(col) => self.lists.get(col.name.as_str()).cloned().map_or(V::Undef, V::List),
                None => v.clone(),
            };
            env.insert(c.clone(), read);
        }
        self.scope.borrow_mut().push(Rc::new(env));
        let v = self.eval(&lam.body);
        self.scope.borrow_mut().pop();
        match v {
            V::Fx(code) => V::err(crate::excel_functions::fx_error_to_sol(code)),
            other => other,
        }
    }

    /// `name` arrives uppercased (`upper_calls`), as `callPlan` reads it.
    fn call(&self, name: &str, args: &[Ast]) -> V {
        let Some(t) = self.table.get(name) else { return V::Undef };
        if let Some(r) = &t.refusal {
            return V::err(sol_error(&r.code, r.message.as_str()));
        }
        let mut argv: Vec<V> = args.iter().map(|a| self.eval(a)).collect();
        let mut settled: Vec<bool> = args.iter().map(|a| matches!(a, Ast::Blank)).collect();
        for (i, v) in argv.iter_mut().enumerate() {
            let Some(Some(role)) = t.roles.get(i) else { continue };
            settled[i] = true;
            if v.is_sol_error() {
                continue;
            }
            // `applyRole` reads a list item by item: a blank setting fills, a blank required item is its own error.
            fn each(v: &V, f: &dyn Fn(&V) -> V) -> V {
                match v {
                    V::List(items) => V::List(Rc::new(items.iter().map(|x| if x.is_sol_error() { x.clone() } else { each(x, f) }).collect())),
                    other => f(other),
                }
            }
            if let V::List(_) = v {
                match role {
                    Role::Setting { blank } => *v = each(v, &|x| if matches!(x, V::Null | V::Undef) { lowered(blank) } else { x.clone() }),
                    Role::Required => {
                        let err = V::err(sol_error("#SYNTAX!", format!("{name}: argument {} is blank, and it has no default", i + 1)));
                        *v = each(v, &|x| if matches!(x, V::Null | V::Undef) { err.clone() } else { x.clone() });
                    }
                    Role::Picks { .. } => {}
                }
                continue;
            }
            match role {
                Role::Setting { blank } => {
                    if matches!(v, V::Null | V::Undef) {
                        *v = lowered(blank);
                    }
                }
                // `applyRole` with `required` off, as `applyArgRoles` reads a picks role; only a variadic required group
                // (CHOOSEROWS) errors, and the support check keeps that on the TS.
                Role::Picks { .. } => {
                    if matches!(v, V::Null | V::Undef) {
                        *v = V::Undef;
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
            return call_caught(name, &argv);
        }
        if let Some(e) = argv.iter().find(|v| v.is_sol_error()) {
            return e.clone();
        }
        match t.kind.as_str() {
            "whole" => {
                if !t.nullable_ok && argv.iter().enumerate().any(|(i, v)| matches!(v, V::Null) && !settled[i]) {
                    return V::Null;
                }
                call_caught(name, &argv)
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
                                } else if t.prep == "zero" {
                                    items.iter().map(|x| if matches!(x, V::Null) { V::Num(0.0) } else { x.clone() }).collect()
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
                match call_caught(name, if crate::excel_functions::reads_lists(name) { &prepped } else { &flat }) {
                    V::Num(r) if !r.is_finite() => guard(r, &flat),
                    r => r,
                }
            }
            _ => {
                // `broadcastCall`: a whole-list argument goes in whole, its errors answering and its blanks dropped.
                if let Some(w) = whole_list_arg(name) {
                    if let Some(V::List(items)) = argv.get(w) {
                        let items: Vec<V> = items.iter().flat_map(|v| match v {
                            V::List(inner) => inner.as_ref().clone(),
                            other => vec![other.clone()],
                        }).collect();
                        if let Some(e) = items.iter().find(|v| v.is_sol_error()) {
                            return e.clone();
                        }
                        let whole = V::List(Rc::new(items.into_iter().filter(|v| !matches!(v, V::Null | V::Undef)).collect()));
                        let rest: Vec<V> = argv.iter().enumerate().filter(|&(i, _)| i != w).map(|(_, v)| v.clone()).collect();
                        let blanks: Vec<bool> = settled.iter().enumerate().filter(|&(i, _)| i != w).map(|(_, b)| *b).collect();
                        return broadcast_with(&rest, &blanks, t.inspects_null, |args| {
                            let mut full = args.to_vec();
                            full.insert(w.min(full.len()), whole.clone());
                            call_caught(name, &full)
                        });
                    }
                }
                broadcast_with(&argv, &settled, t.inspects_null, |args| call_caught(name, args))
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
        V::Cx(..) => FrameCell::err(sol_error("#VALUE!", "Each row of a computed column must be a number, text, TRUE/FALSE or blank.")),
    }
}

struct Survey<'s, 'a> {
    columns: &'s FxHashMap<&'s str, &'a FrameColumn>,
    sides: &'s FxHashMap<String, V>,
    lambdas: &'s Lambdas,
    wholes: Vec<&'a FrameColumn>,
    row_calls: FxHashSet<*const Ast>,
}

impl<'a> Survey<'_, 'a> {
    fn whole(&mut self, c: &'a FrameColumn) {
        if !self.wholes.iter().any(|w| std::ptr::eq(*w, c)) {
            self.wholes.push(c);
        }
    }

    /// The whole columns the formula reads and the calls that read the row; `env` is the LAMBDA whose body this is.
    fn walk(&mut self, n: &Ast, env: Option<&Lambda>) {
        let whole = match (env, n) {
            (Some(lam), Ast::Name(name)) => lam.captured_column(name, self.columns),
            (Some(_), Ast::WholeCol(name)) => self.columns.get(name.as_str()).copied(),
            (Some(_), _) => None,
            (None, _) => whole_column(n, self.columns, self.sides),
        };
        if let Some(c) = whole {
            self.whole(c);
            return;
        }
        match n {
            Ast::Call { name, args } if env.is_none() && self.lambdas.contains_key(name.as_str()) => {
                let lam = &self.lambdas[name.as_str()];
                for (c, _) in &lam.captured {
                    if let Some(col) = lam.captured_column(c, self.columns) {
                        self.whole(col);
                    }
                }
                self.walk(&lam.body, Some(lam));
                for a in args {
                    self.walk(a, None);
                }
            }
            Ast::Call { args, .. } | Ast::Apply { args, .. } => {
                if matches!(n, Ast::Call { .. }) && reads_row_in(n, self.lambdas) {
                    self.row_calls.insert(n as *const Ast);
                }
                if let Ast::Apply { func, .. } = n {
                    self.walk(func, env);
                }
                for a in args {
                    self.walk(a, env);
                }
            }
            Ast::Unary { arg, .. } | Ast::Percent(arg) => self.walk(arg, env),
            Ast::Bin { l, r, .. } => {
                self.walk(l, env);
                self.walk(r, env);
            }
            _ => {}
        }
    }
}

/// The tree with every call's name uppercased once, not per row; a wired LAMBDA keeps its name, which the env
/// matches exactly.
fn upper_calls(n: Ast, lambdas: &FxHashSet<String>) -> Ast {
    let all = |args: Vec<Ast>| args.into_iter().map(|a| upper_calls(a, lambdas)).collect();
    match n {
        Ast::Call { name, args } if lambdas.contains(&name) => Ast::Call { name, args: all(args) },
        Ast::Call { name, args } => Ast::Call { name: name.to_uppercase(), args: all(args) },
        Ast::Apply { func, args } => Ast::Apply { func: Box::new(upper_calls(*func, lambdas)), args: all(args) },
        Ast::Unary { op, arg } => Ast::Unary { op, arg: Box::new(upper_calls(*arg, lambdas)) },
        Ast::Percent(a) => Ast::Percent(Box::new(upper_calls(*a, lambdas))),
        Ast::Bin { op, l, r } => Ast::Bin { op, l: Box::new(upper_calls(*l, lambdas)), r: Box::new(upper_calls(*r, lambdas)) },
        other => other,
    }
}

pub enum ColumnOutcome {
    Unsupported,
    Cells(Vec<FrameCell>),
}

/// A wired LAMBDA as the TS lowers it: its parameters, body text and captured values.
#[derive(Deserialize)]
pub struct LambdaWire {
    pub params: Vec<String>,
    pub expr: String,
    #[serde(default)]
    pub captured: Vec<CapturedWire>,
}

#[derive(Deserialize)]
pub struct CapturedWire {
    pub name: String,
    #[serde(default)]
    pub value: Json,
}

/// A bare LAMBDA column's parameter: a column of the table, read cell by cell, or a side value.
#[derive(Deserialize)]
pub struct BareParam {
    #[serde(default)]
    pub column: Option<String>,
    #[serde(default)]
    pub value: Json,
}

/// What a computed column computes: a formula, or a bare wired LAMBDA called with its parameters' cells.
pub enum ColumnSpec<'a> {
    Expr(&'a str),
    Bare { lambda: &'a str, params: &'a [BareParam] },
}

/// A computed column's cells: `computeColumnCells` with an `expr` spec, or a `lambda` spec when the column is a bare
/// wired LAMBDA.
pub fn formula_column(
    f: &FrameValue,
    spec: ColumnSpec,
    table: &CallTable,
    sides: &HashMap<String, FrameCell>,
    lambdas: &HashMap<String, LambdaWire>,
    rows: usize,
) -> Result<ColumnOutcome, SolError> {
    let columns: FxHashMap<&str, &FrameColumn> = f.columns.iter().map(|c| (c.name.as_str(), c)).collect();
    let sides: FxHashMap<String, V> = sides.iter().map(|(k, v)| (k.clone(), cell_to_v(v))).collect();
    let names: FxHashSet<String> = lambdas.keys().cloned().collect();
    let mut lams: Lambdas = FxHashMap::default();
    for (name, w) in lambdas {
        let Some(body) = parse_formula(&w.expr) else { return Ok(ColumnOutcome::Unsupported) };
        let captured = w.captured.iter().map(|c| (c.name.clone(), cell_to_v(&crate::wire::decode_cell(&c.value)))).collect();
        lams.insert(name.clone(), Lambda { params: w.params.clone(), body, captured });
    }
    // The bare column calls its LAMBDA through a call node of its own, so one evaluator serves both.
    let (expr, bare) = match spec {
        ColumnSpec::Expr(e) => (e.to_string(), None),
        ColumnSpec::Bare { lambda, params } => (String::new(), Some((lambda, params))),
    };
    let ast = match bare {
        Some((lambda, params)) => Ast::Call { name: lambda.to_string(), args: params.iter().map(|_| Ast::Blank).collect() },
        None => match parse_formula(&expr) {
            Some(a) => a,
            None => return Ok(ColumnOutcome::Unsupported),
        },
    };
    if let Some((lambda, params)) = bare {
        let Some(lam) = lams.get(lambda) else { return Ok(ColumnOutcome::Unsupported) };
        let ok = params.iter().all(|p| p.column.as_deref().is_none_or(|c| columns.contains_key(c)))
            && supported_at(&lam.body, &Cx { columns: &columns, sides: &sides, table, lambdas: &lams, env: Some(lam) }, false);
        if !ok {
            return Ok(ColumnOutcome::Unsupported);
        }
    } else if !supported(&ast, &columns, &sides, table, &lams) {
        return Ok(ColumnOutcome::Unsupported);
    }
    let ast = upper_calls(ast, &names);
    for lam in lams.values_mut() {
        lam.body = upper_calls(std::mem::replace(&mut lam.body, Ast::Blank), &FxHashSet::default());
    }
    // Once, not per row: the whole columns the formula reads, and the calls that read an `@` cell.
    let mut survey = Survey { columns: &columns, sides: &sides, lambdas: &lams, wholes: Vec::new(), row_calls: FxHashSet::default() };
    survey.walk(&ast, None);
    let (wholes, row_calls) = (survey.wholes, survey.row_calls);
    let lists = wholes.iter().map(|c| (c.name.as_str(), Rc::new(c.values.iter().map(cell_to_v).collect::<Vec<_>>()))).collect();
    let mut row = Row {
        lists,
        memo: Default::default(),
        row_calls,
        columns: &columns,
        sides: &sides,
        table,
        lambdas: &lams,
        scope: Default::default(),
        cursor: 0,
    };
    let mut cells = Vec::with_capacity(rows);
    crate::excel_functions::take_bailed();
    for i in 0..rows {
        row.cursor = i;
        crate::excel_functions::set_row_number(Some(i as f64 + 1.0));
        let v = match bare {
            // `runColumn`'s lambda spec: a parameter's error cell answers the row before the body runs.
            Some((lambda, params)) => {
                let argv: Vec<V> = params
                    .iter()
                    .map(|p| match &p.column {
                        Some(c) => cell_to_v(columns[c.as_str()].cell_at(i)),
                        None => cell_to_v(&crate::wire::decode_cell(&p.value)),
                    })
                    .collect();
                let err = params.iter().zip(&argv).find(|(p, v)| p.column.is_some() && v.is_sol_error()).map(|(_, v)| v.clone());
                match err {
                    Some(e) => e,
                    None => row.call_lambda(&lams[lambda], argv),
                }
            }
            None => row.eval(&ast),
        };
        if crate::excel_functions::take_bailed() {
            crate::excel_functions::take_thrown();
            crate::excel_functions::set_row_number(None);
            return Ok(ColumnOutcome::Unsupported);
        }
        cells.push(match crate::excel_functions::take_thrown() {
            Some(e) => FrameCell::err(e),
            None => tag_computed_cell(v),
        });
    }
    crate::excel_functions::set_row_number(None);
    Ok(ColumnOutcome::Cells(cells))
}
