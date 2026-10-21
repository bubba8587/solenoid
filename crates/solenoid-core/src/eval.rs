// [[C130]] rustCore, [[D99]] rustIsSpec, [[C15]] matricesInFormulas
//! The array-aware evaluator (`excelFormula.ts`' `evalAst`): a formula over named values, the Expression card's
//! core. A value is a JS value: a list is an array, a matrix an array of arrays, a LAMBDA a `V::Lambda`.

use std::rc::Rc;

use crate::error_value::sol_error;
use crate::excel_formula::{apply_op, call_caught, constant_value, guard, lowered, CallTable, CallTraits, Role};
use crate::excel_functions::{fx_error_to_sol, is_ported, V};
use crate::fxhash::FxHashMap;
use crate::excel_formula::Ast;

pub type Env = FxHashMap<String, V>;

/// A LAMBDA value: its parameters, body and the names it closed over; or a function named bare (`eta`).
#[derive(Debug)]
pub struct LambdaV {
    pub params: Vec<String>,
    pub body: Option<Rc<Ast>>,
    pub env: Rc<Env>,
    pub eta: Option<String>,
}

const MAX_GENERATED: f64 = 1_000_000.0;

fn is_arr(v: &V) -> bool {
    matches!(v, V::List(_))
}

fn is_matrix(v: &V) -> bool {
    matches!(v, V::List(l) if matches!(l.first(), Some(V::List(_))))
}

fn rank_of(v: &V) -> u8 {
    if is_matrix(v) {
        2
    } else if is_arr(v) {
        1
    } else {
        0
    }
}

fn is_missing(v: &V) -> bool {
    matches!(v, V::Null)
}

fn contains_cx(a: &V) -> bool {
    match a {
        V::Cx(..) => true,
        V::List(l) => l.iter().any(|v| match v {
            V::List(r) => r.iter().any(|x| matches!(x, V::Cx(..))),
            other => matches!(other, V::Cx(..)),
        }),
        _ => false,
    }
}

fn too_deep(v: &V) -> bool {
    match v {
        V::List(rows) if is_matrix(v) => rows.iter().any(|r| matches!(r, V::List(cells) if cells.iter().any(is_arr))),
        _ => false,
    }
}

fn collapse_singleton_rank(v: &V) -> V {
    match v {
        V::List(rows) if is_matrix(v) => match (rows.len(), &rows[0]) {
            (1, V::List(r)) if r.len() == 1 => r[0].clone(),
            _ => v.clone(),
        },
        V::List(l) if l.len() == 1 && !is_arr(&l[0]) => l[0].clone(),
        other => other.clone(),
    }
}

/// The length a JS row reports: a non-array row has none, which no index is below.
fn row_len(r: &V) -> Option<usize> {
    if let V::List(cells) = r { Some(cells.len()) } else { None }
}

/// `mapCells`: the function over each cell of its arguments, by the broadcast-rules table.
pub fn map_cells(argv: &[V], cell: &mut dyn FnMut(&[V]) -> V) -> V {
    if argv.iter().any(too_deep) {
        return V::err(sol_error("#SHAPE!", "A value nested deeper than a 2-D matrix isn't a thing formulas compute on"));
    }
    let args: Vec<V> = argv.iter().map(collapse_singleton_rank).collect();
    let rank = args.iter().map(rank_of).max().unwrap_or(0);
    if rank == 0 {
        return cell(&args);
    }
    if rank == 1 {
        let len = args.iter().filter_map(|a| if let V::List(l) = a { Some(l.len()) } else { None }).max().unwrap_or(0);
        let mut out = Vec::with_capacity(len);
        let mut ops = Vec::with_capacity(args.len());
        for i in 0..len {
            if args.iter().any(|a| matches!(a, V::List(l) if i >= l.len())) {
                out.push(V::Null);
                continue;
            }
            ops.clear();
            ops.extend(args.iter().map(|a| if let V::List(l) = a { l[i].clone() } else { a.clone() }));
            out.push(cell(&ops));
        }
        return V::List(Rc::new(out));
    }
    let rows = args.iter().filter(|a| is_matrix(a)).filter_map(|m| if let V::List(r) = m { Some(r.len()) } else { None }).max().unwrap_or(0);
    let col_singleton: Vec<bool> = args
        .iter()
        .map(|a| is_matrix(a) && matches!(a, V::List(rs) if rs.iter().all(|r| row_len(r) == Some(1))))
        .collect();
    // `Math.max` over a row with no length is NaN, which no column index is below.
    let mut cols: Option<usize> = Some(1);
    for (k, a) in args.iter().enumerate() {
        let w = match a {
            V::List(rs) if is_matrix(a) => {
                if col_singleton[k] {
                    Some(1)
                } else {
                    rs.iter().try_fold(0usize, |n, r| row_len(r).map(|l| n.max(l)))
                }
            }
            V::List(l) => Some(l.len()),
            _ => Some(1),
        };
        cols = match (cols, w) {
            (Some(c), Some(w)) => Some(c.max(w)),
            _ => None,
        };
    }
    let cols = cols.unwrap_or(0);
    let cell_at = |k: usize, i: usize, j: usize| -> Option<V> {
        let a = &args[k];
        match a {
            V::List(rs) if is_matrix(a) => {
                let ri = if rs.len() == 1 { 0 } else { i };
                let row = rs.get(ri)?;
                let cj = if col_singleton[k] { 0 } else { j };
                if let V::List(cells) = row { cells.get(cj).cloned() } else { None }
            }
            V::List(l) => l.get(j).cloned(),
            other => Some(other.clone()),
        }
    };
    let mut out = Vec::with_capacity(rows);
    for i in 0..rows {
        let mut row = Vec::with_capacity(cols);
        for j in 0..cols {
            let ops: Option<Vec<V>> = (0..args.len()).map(|k| cell_at(k, i, j)).collect();
            row.push(match ops {
                Some(ops) => cell(&ops),
                None => V::Null,
            });
        }
        out.push(V::List(Rc::new(row)));
    }
    V::List(Rc::new(out))
}

/// `formatCx` at four digits.
fn format_cx(re: f64, im: f64) -> String {
    let fmt = |n: f64| {
        if n.fract() == 0.0 && n.is_finite() {
            crate::jsnum::number_to_string(n)
        } else {
            let s = crate::jsnum::to_fixed(n, 4.0).unwrap_or_default();
            // `.replace(/\.?0+$/, "")`
            let t = s.trim_end_matches('0');
            if t.len() < s.len() { t.strip_suffix('.').unwrap_or(t).to_string() } else { s }
        }
    };
    if re.is_nan() || im.is_nan() {
        return "NaN".into();
    }
    let r = fmt(re);
    let ia = im.abs();
    let i = if ia == 1.0 { "i".to_string() } else { format!("{}i", fmt(ia)) };
    if im == 0.0 {
        return r;
    }
    if re == 0.0 {
        return if im < 0.0 { format!("-{i}") } else { i };
    }
    if im < 0.0 { format!("{r} - {i}") } else { format!("{r} + {i}") }
}

fn apply_cx_op(op: &str, a: &V, b: &V) -> V {
    match op {
        "&" => {
            let s = |v: &V| match v {
                V::Cx(re, im) => format_cx(*re, *im),
                V::Bool(b) => (if *b { "TRUE" } else { "FALSE" }).to_string(),
                V::Num(n) => crate::excel_formula::number_to_text(*n),
                other => crate::excel_functions::js_string_of(other),
            };
            V::Str(Rc::from(s(a) + &s(b)))
        }
        "=" | "<>" => {
            let eq = matches!((a, b), (V::Cx(ar, ai), V::Cx(br, bi)) if ar == br && ai == bi);
            V::Bool(if op == "=" { eq } else { !eq })
        }
        "<" | ">" | "<=" | ">=" => V::err(sol_error("#TYPE!", "Complex numbers have no order. Compare their IMABS values instead")),
        _ => V::err(sol_error("#TYPE!", "Operators don't work on complex numbers. Use IMSUM, IMSUB, IMPRODUCT or IMDIV")),
    }
}

/// `applyOp`, with complex and LAMBDA operands caught first.
fn op2(op: &str, a: &V, b: &V) -> V {
    if a.is_err() {
        return a.clone();
    }
    if b.is_err() {
        return b.clone();
    }
    if is_missing(a) || is_missing(b) {
        return V::Null;
    }
    if matches!(a, V::Cx(..)) || matches!(b, V::Cx(..)) {
        return apply_cx_op(op, a, b);
    }
    if matches!(a, V::Lambda(_)) || matches!(b, V::Lambda(_)) {
        return V::err(sol_error("#TYPE!", "A LAMBDA isn't a value. Call it with (…) or pass it to MAP, REDUCE and the other helpers"));
    }
    apply_op(op, a, b)
}

/// `-x`, `+x`: JavaScript's unary coercion.
fn js_unary(v: &V) -> f64 {
    match v {
        V::Num(n) => *n,
        V::Bool(b) => f64::from(u8::from(*b)),
        V::Str(s) => crate::jsnum::string_to_number(s),
        V::List(_) => crate::jsnum::string_to_number(&crate::excel_functions::js_string_of(v)),
        _ => f64::NAN,
    }
}

const ETA_HOSTS: [&str; 6] = ["MAP", "BYROW", "BYCOL", "REDUCE", "SCAN", "GROUPBY"];
const LAMBDA_HOSTS: [&str; 7] = ["MAP", "BYROW", "BYCOL", "REDUCE", "SCAN", "MAKEARRAY", "GROUPBY"];

pub struct Eval<'a> {
    pub table: &'a CallTable,
}

impl Eval<'_> {
    /// `compileEvaluator`'s answer: a LAMBDA left uncalled is an error, a Formula.js error reads as Solenoid's.
    pub fn run(&self, ast: &Ast, env: &Rc<Env>) -> V {
        match self.eval(ast, env) {
            V::Lambda(_) => V::err(sol_error("#VALUE!", "LAMBDA needs arguments. Use it inside MAP, REDUCE, BYROW, SCAN or MAKEARRAY")),
            V::Fx(code) => V::err(fx_error_to_sol(code)),
            other => other,
        }
    }

    fn eta_or_eval(&self, a: &Ast, env: &Rc<Env>) -> V {
        if let Ast::Name(name) = a {
            if !env.contains_key(name) && constant_value(name).is_none() {
                let up = name.to_uppercase();
                if self.table.get(&up).is_some_and(|t| t.resolves) {
                    return V::Lambda(Rc::new(LambdaV { params: Vec::new(), body: None, env: env.clone(), eta: Some(up) }));
                }
            }
        }
        self.eval(a, env)
    }

    pub fn eval(&self, n: &Ast, env: &Rc<Env>) -> V {
        match n {
            Ast::Num(_, v) => V::Num(*v),
            Ast::Str(s) => V::Str(s.clone()),
            Ast::Bool(b) => V::Bool(*b),
            Ast::Blank => V::Null,
            Ast::AtCol(_) => V::err(sol_error("#REF!", "@ reads the current row, so it only works inside a computed column")),
            Ast::WholeCol(_) => V::err(sol_error("#REF!", "[column] reads a whole table column, so it only works inside a computed column")),
            Ast::Name(name) => constant_value(name).map_or_else(|| env.get(name).cloned().unwrap_or(V::Undef), V::Num),
            Ast::Unary { op, arg } => {
                let a = self.eval(arg, env);
                let neg = *op == '-';
                let f = |x: &V| match x {
                    V::Err(_) => x.clone(),
                    V::Null => V::Null,
                    V::Cx(..) => V::err(sol_error("#TYPE!", "Operators don't work on complex numbers. Use IMSUB(0, z) to negate")),
                    other => V::Num(if neg { -js_unary(other) } else { js_unary(other) }),
                };
                if is_arr(&a) {
                    map_cells(&[a], &mut |x| f(&x[0]))
                } else if a.is_err() {
                    a
                } else {
                    f(&a)
                }
            }
            Ast::Percent(arg) => {
                let a = self.eval(arg, env);
                let f = |x: &V| match x {
                    V::Err(_) => x.clone(),
                    V::Null => V::Null,
                    V::Cx(..) => V::err(sol_error("#TYPE!", "Operators don't work on complex numbers. Use IMDIV(z, COMPLEX(100, 0))")),
                    other => V::Num(js_unary(other) / 100.0),
                };
                if is_arr(&a) {
                    map_cells(&[a], &mut |x| f(&x[0]))
                } else if a.is_err() {
                    a
                } else {
                    f(&a)
                }
            }
            Ast::Bin { op, l, r } => {
                let (l, r) = (self.eval(l, env), self.eval(r, env));
                if is_arr(&l) || is_arr(&r) {
                    return map_cells(&[l, r], &mut |x| op2(op, &x[0], &x[1]));
                }
                op2(op, &l, &r)
            }
            Ast::Apply { func, args } => {
                let f = self.eval(func, env);
                if f.is_err() {
                    return f;
                }
                let V::Lambda(lam) = f else {
                    return V::err(sol_error("#VALUE!", "Only a LAMBDA can be called like a function"));
                };
                let argv: Vec<V> = args.iter().map(|a| self.eta_or_eval(a, env)).collect();
                if let Some(e) = argv.iter().find(|v| v.is_sol_error()) {
                    return e.clone();
                }
                let p = lam.params.len();
                if p > 0 && argv.len() != p {
                    return V::err(sol_error("#VALUE!", format!("This LAMBDA takes {p} argument{}, not {}", if p == 1 { "" } else { "s" }, argv.len())));
                }
                self.call_lambda(&lam, &argv)
            }
            Ast::Call { name: raw, args } => self.call(raw, args, env),
        }
    }

    /// `lam.fn(...args)`.
    pub fn call_lambda(&self, lam: &LambdaV, args: &[V]) -> V {
        if let Some(name) = &lam.eta {
            return match self.dispatch(name, args) {
                V::Num(r) => guard(r, args),
                r => r,
            };
        }
        let mut inner: Env = (*lam.env).clone();
        for (i, p) in lam.params.iter().enumerate() {
            inner.insert(p.clone(), args.get(i).cloned().unwrap_or(V::Undef));
        }
        let body = lam.body.as_ref().expect("a LAMBDA has a body");
        self.eval(body, &Rc::new(inner))
    }

    fn call(&self, raw: &str, args: &[Ast], env: &Rc<Env>) -> V {
        let name = raw.to_uppercase();
        if let Some(V::Lambda(bound)) = env.get(raw) {
            let bound = bound.clone();
            let argv: Vec<V> = args.iter().map(|a| self.eval(a, env)).collect();
            if let Some(e) = argv.iter().find(|v| v.is_sol_error()) {
                return e.clone();
            }
            let p = bound.params.len();
            if p > 0 && argv.len() != p {
                return V::err(sol_error("#VALUE!", format!("{raw} takes {p} argument{}, not {}", if p == 1 { "" } else { "s" }, argv.len())));
            }
            return self.call_lambda(&bound, &argv);
        }
        if name == "LAMBDA" {
            let Some((body, ps)) = args.split_last() else {
                return V::err(sol_error("#VALUE!", "LAMBDA needs a body: LAMBDA(param…, body)"));
            };
            let mut params: Vec<String> = Vec::with_capacity(ps.len());
            for a in ps {
                let Ast::Name(p) = a else {
                    return V::err(sol_error("#VALUE!", "LAMBDA parameters must be plain names"));
                };
                if params.contains(p) {
                    return V::err(sol_error("#NAME?", format!("LAMBDA parameter {p} appears twice")));
                }
                // [[D77]] constantsAlwaysWin
                if constant_value(p).is_some() {
                    return V::err(sol_error("#NAME?", format!("{p} is a constant, so it can't name a LAMBDA parameter")));
                }
                params.push(p.clone());
            }
            return V::Lambda(Rc::new(LambdaV { params, body: Some(Rc::new(body.clone())), env: env.clone(), eta: None }));
        }
        let Some(t) = self.table.get(&name) else { return crate::excel_functions::bail() };
        if let Some(r) = &t.refusal {
            return V::err(sol_error(&r.code, r.message.as_str()));
        }
        let mut argv: Vec<V> = if ETA_HOSTS.contains(&name.as_str()) {
            args.iter().map(|a| self.eta_or_eval(a, env)).collect()
        } else {
            args.iter().map(|a| self.eval(a, env)).collect()
        };
        let empty: Vec<bool> = args.iter().map(|a| matches!(a, Ast::Blank)).collect();
        let settled = apply_arg_roles(&name, t, &empty, &mut argv);
        for (i, a) in args.iter().enumerate() {
            if matches!(a, Ast::Blank) {
                if let Some(v) = t.blanks.get(&i.to_string()) {
                    argv[i] = lowered(v);
                }
            }
        }
        if t.kind == "handler" {
            return apply_error_handler(&name, &argv);
        }
        if let Some(e) = argv.iter().find(|v| v.is_sol_error()) {
            return e.clone();
        }
        let lifted: Vec<usize> = t.scalar.iter().copied().filter(|&i| argv.get(i).is_some_and(is_arr)).collect();
        if lifted.is_empty() {
            return self.route_call(&name, t, argv, &settled);
        }
        let cols: Vec<V> = lifted.iter().map(|&i| argv[i].clone()).collect();
        map_cells(&cols, &mut |cells| {
            if let Some(bad) = cells.iter().find(|v| v.is_err()) {
                return bad.clone();
            }
            if cells.iter().any(is_missing) {
                return V::Null;
            }
            let mut one = argv.clone();
            for (k, &i) in lifted.iter().enumerate() {
                one[i] = cells[k].clone();
            }
            self.route_call(&name, t, one, &settled)
        })
    }

    /// Steps 9 to 11 of the dispatch ladder (`routeCall`).
    fn route_call(&self, name: &str, t: &CallTraits, mut argv: Vec<V>, settled: &[bool]) -> V {
        let mut column = false;
        if t.free {
            if let Some((read, col)) = read_vectors(&argv) {
                argv = read;
                column = col;
            }
        }
        if !t.matrix_args && argv.iter().any(is_matrix) {
            if t.prep == "positional" {
                return V::err(sol_error("#SHAPE!", format!("{name} over a matrix isn't supported yet. Wire the matrix through its node")));
            }
            if t.kind == "range" {
                argv = argv.into_iter().map(|a| if is_matrix(&a) { flat1(&a) } else { a }).collect();
            } else if t.kind == "whole" || !t.known {
                return V::err(sol_error("#SHAPE!", format!("{name} works on values and 1-D lists, not a 2-D matrix")));
            }
        }
        if t.checks_cx && argv.iter().any(contains_cx) {
            return V::err(sol_error("#TYPE!", format!("{name} doesn't compute on complex numbers. Use the IM* family")));
        }
        match t.kind.as_str() {
            "whole" => {
                if !t.nullable_ok && argv.iter().enumerate().any(|(i, a)| is_missing(a) && !settled.get(i).copied().unwrap_or(false)) {
                    return V::Null;
                }
                let r = self.dispatch(name, &argv);
                if column { as_column(r) } else { r }
            }
            "range" => {
                let args = match prep_range_args(&t.prep, argv) {
                    Ok(a) => a,
                    Err(e) => return e,
                };
                let flat: Vec<V> = args.iter().flat_map(|a| if let V::List(l) = a { l.as_ref().clone() } else { vec![a.clone()] }).collect();
                // A value nested past a matrix reaches the body as a list among its numbers, a shape no ported body reads yet.
                if flat.iter().any(is_arr) {
                    return crate::excel_functions::bail();
                }
                // The ported range bodies read their lists flat, but for those that read each list in place.
                match self.dispatch(name, if crate::excel_functions::reads_lists(name) { &args } else { &flat }) {
                    V::Num(r) if !r.is_finite() => guard(r, &flat),
                    r => r,
                }
            }
            _ => self.broadcast_call(name, t, &argv, settled),
        }
    }

    fn broadcast_call(&self, name: &str, t: &CallTraits, argv: &[V], blank_slots: &[bool]) -> V {
        let whole_at = match name {
            "WORKDAY" | "NETWORKDAYS" => Some(2),
            "WORKDAY.INTL" | "NETWORKDAYS.INTL" => Some(3),
            _ => None,
        };
        if let Some(w) = whole_at {
            if let Some(list @ V::List(_)) = argv.get(w) {
                let V::List(items) = flat1(list) else { unreachable!() };
                if let Some(e) = items.iter().find(|v| v.is_sol_error()) {
                    return e.clone();
                }
                let whole = V::List(Rc::new(items.iter().filter(|v| !matches!(v, V::Null | V::Undef)).cloned().collect()));
                let rest: Vec<V> = argv.iter().enumerate().filter(|&(i, _)| i != w).map(|(_, v)| v.clone()).collect();
                let blanks: Vec<bool> = (0..argv.len()).filter(|&i| i != w).map(|i| blank_slots.get(i).copied().unwrap_or(false)).collect();
                return self.broadcast_with(&rest, &blanks, t.inspects_null, &|args: &[V]| {
                    let mut full: Vec<V> = args[..w.min(args.len())].to_vec();
                    full.push(whole.clone());
                    full.extend_from_slice(&args[w.min(args.len())..]);
                    self.dispatch(name, &full)
                });
            }
        }
        self.broadcast_with(argv, blank_slots, t.inspects_null, &|args: &[V]| self.dispatch(name, args))
    }

    fn broadcast_with(&self, argv: &[V], blank_slots: &[bool], inspects_null: bool, f: &dyn Fn(&[V]) -> V) -> V {
        let call = |args: &[V]| match f(args) {
            V::Num(r) => guard(r, args),
            r => r,
        };
        if !argv.iter().any(is_arr) {
            let blank = argv.iter().enumerate().any(|(i, v)| is_missing(v) && !blank_slots.get(i).copied().unwrap_or(false));
            return if !inspects_null && blank { V::Null } else { call(argv) };
        }
        let len = argv.iter().filter_map(|a| if let V::List(l) = a { Some(l.len()) } else { None }).max().unwrap_or(0);
        if len == 0 {
            return V::List(Rc::new(Vec::new()));
        }
        map_cells(argv, &mut |ops| {
            if let Some(e) = ops.iter().find(|v| v.is_sol_error()) {
                return e.clone();
            }
            if !inspects_null && ops.iter().any(is_missing) {
                return V::Null;
            }
            call(ops)
        })
    }

    /// `dispatch`: the body itself, its JavaScript failure read as #VALUE!. A body the core doesn't carry yet bails.
    fn dispatch(&self, name: &str, argv: &[V]) -> V {
        if LAMBDA_HOSTS.contains(&name) {
            return self.host(name, argv);
        }
        if !is_ported(name) || (argv.iter().any(is_matrix) && !crate::excel_functions::reads_matrices(name)) {
            return crate::excel_functions::bail();
        }
        call_caught(name, argv)
    }

    /// MAP, BYROW, BYCOL, REDUCE, SCAN and MAKEARRAY (excelFunctions.ts), which call their LAMBDA back.
    fn host(&self, name: &str, a: &[V]) -> V {
        let arg = |i: usize| a.get(i).cloned().unwrap_or(V::Undef);
        let last = if name == "MAP" { a.last().cloned().unwrap_or(V::Undef) } else { arg(if name == "MAKEARRAY" || name == "REDUCE" || name == "SCAN" { 2 } else { 1 }) };
        let V::Lambda(lam) = last else {
            return V::err(sol_error("#VALUE!", format!("{name} needs a LAMBDA as its last argument")));
        };
        // `etaFn`: a function named bare gets only the arguments that mean something to it.
        let call = |args: &[V], meaningful: usize| -> V {
            if lam.eta.is_some() { self.call_lambda(&lam, &args[..meaningful.min(args.len())]) } else { self.call_lambda(&lam, args) }
        };
        let absent = |v: &V| matches!(v, V::Null | V::Undef);
        match name {
            "MAP" => {
                let arrays = &a[..a.len() - 1];
                if arrays.is_empty() || arrays.len() > 3 {
                    return V::err(sol_error("#VALUE!", "MAP takes 1–3 arrays and a LAMBDA"));
                }
                if arrays.iter().any(absent) {
                    return V::Null;
                }
                let shaped: Vec<Vec<Vec<V>>> = arrays.iter().map(|v| as_rows(v).unwrap_or_default()).collect();
                let rows = shaped.iter().map(Vec::len).max().unwrap_or(0);
                let cols = shaped.iter().flatten().map(Vec::len).max().unwrap_or(0);
                let cell_at = |k: usize, i: usize, j: usize| shaped.get(k).and_then(|m| m.get(i)).and_then(|r| r.get(j)).cloned().unwrap_or(V::Null);
                let out: Vec<Vec<V>> = (0..rows)
                    .map(|i| {
                        (0..cols)
                            .map(|j| call(&[cell_at(0, i, j), cell_at(1, i, j), cell_at(2, i, j), V::Num((i + 1) as f64), V::Num((j + 1) as f64)], arrays.len()))
                            .collect()
                    })
                    .collect();
                like_input(&arrays[0], out)
            }
            "BYROW" => match as_rows(&arg(0)) {
                None => V::Null,
                Some(m) => list(m.into_iter().map(|row| list(vec![call(&[list(row)], 1)])).collect()),
            },
            "BYCOL" => match as_rows(&arg(0)) {
                None => V::Null,
                Some(m) => {
                    let cols = m.iter().map(Vec::len).max().unwrap_or(0);
                    list((0..cols).map(|j| call(&[list(m.iter().map(|r| r.get(j).cloned().unwrap_or(V::Null)).collect())], 1)).collect())
                }
            },
            "REDUCE" => {
                let Some(m) = as_rows(&arg(1)) else { return V::Null };
                let mut acc = if absent(&arg(0)) { V::Null } else { arg(0) };
                let mut step = 0.0;
                for cell in m.into_iter().flatten() {
                    if cell.is_sol_error() {
                        return cell;
                    }
                    step += 1.0;
                    acc = call(&[acc, cell, V::Num(step)], 2);
                    if acc.is_sol_error() {
                        return acc;
                    }
                }
                acc
            }
            "SCAN" => {
                let v = arg(1);
                let Some(m) = as_rows(&v) else { return V::Null };
                let mut acc = if absent(&arg(0)) { V::Null } else { arg(0) };
                let mut step = 0.0;
                let mut poisoned: Option<V> = None;
                let out: Vec<Vec<V>> = m
                    .into_iter()
                    .map(|row| {
                        row.into_iter()
                            .map(|cell| {
                                if let Some(p) = &poisoned {
                                    return p.clone();
                                }
                                if cell.is_sol_error() {
                                    poisoned = Some(cell.clone());
                                    return cell;
                                }
                                step += 1.0;
                                acc = call(&[acc.clone(), cell, V::Num(step)], 2);
                                if acc.is_sol_error() {
                                    poisoned = Some(acc.clone());
                                }
                                acc.clone()
                            })
                            .collect()
                    })
                    .collect();
                like_input(&v, out)
            }
            "MAKEARRAY" => {
                if absent(&arg(0)) || absent(&arg(1)) {
                    return V::Null;
                }
                let count = |v: &V| {
                    let n = js_unary(v).floor().max(0.0);
                    if n.is_nan() { 0.0 } else { n }
                };
                let (r, c) = (count(&arg(0)), count(&arg(1)));
                if r * c > MAX_GENERATED {
                    return V::err(sol_error("#OVERFLOW!", format!("MAKEARRAY count {} exceeds the 1000000 element limit", crate::jsnum::number_to_string(r * c))));
                }
                list((0..r as usize).map(|i| list((0..c as usize).map(|j| self.call_lambda(&lam, &[V::Num((i + 1) as f64), V::Num((j + 1) as f64)])).collect())).collect())
            }
            _ => crate::excel_functions::bail(),
        }
    }
}

fn list(items: Vec<V>) -> V {
    V::List(Rc::new(items))
}

/// `asRows`: a matrix's rows, a list as one row, a value as a one-cell grid.
fn as_rows(v: &V) -> Option<Vec<Vec<V>>> {
    match v {
        V::Null | V::Undef => None,
        V::List(rs) if is_matrix(v) => Some(rs.iter().map(|r| if let V::List(c) = r { c.as_ref().clone() } else { Vec::new() }).collect()),
        V::List(l) => Some(vec![l.as_ref().clone()]),
        other => Some(vec![vec![other.clone()]]),
    }
}

/// `likeInput`: a matrix in answers a matrix; a list in answers its one row.
fn like_input(v: &V, mut rows: Vec<Vec<V>>) -> V {
    if !is_matrix(v) && rows.len() == 1 {
        return list(rows.pop().unwrap_or_default());
    }
    list(rows.into_iter().map(list).collect())
}

/// `Array.prototype.flat()`, one level.
fn flat1(v: &V) -> V {
    match v {
        V::List(l) => list(l.iter().flat_map(|x| if let V::List(inner) = x { inner.as_ref().clone() } else { vec![x.clone()] }).collect()),
        other => other.clone(),
    }
}

/// `readVectors` ([[D85]] columnsStayColumns): a one-column or one-row table reads as its items.
fn read_vectors(argv: &[V]) -> Option<(Vec<V>, bool)> {
    let mut first: Option<bool> = None;
    let mut changed = false;
    let out: Vec<V> = argv
        .iter()
        .map(|a| {
            if !is_matrix(a) {
                if first.is_none() && is_arr(a) {
                    first = Some(false);
                }
                return a.clone();
            }
            let V::List(rows) = a else { unreachable!() };
            if rows.len() > 1 && rows.iter().all(|r| row_len(r) == Some(1)) {
                first.get_or_insert(true);
                changed = true;
                return list(rows.iter().map(|r| if let V::List(c) = r { c[0].clone() } else { V::Undef }).collect());
            }
            if rows.len() == 1 {
                first.get_or_insert(false);
                changed = true;
                return rows[0].clone();
            }
            a.clone()
        })
        .collect();
    changed.then_some((out, first == Some(true)))
}

/// `asColumn`: a list answer back as the column its input came in as.
fn as_column(r: V) -> V {
    match &r {
        V::List(l) if !l.iter().any(is_arr) => list(l.iter().map(|x| list(vec![x.clone()])).collect()),
        _ => r,
    }
}

/// `prepRangeArgs`: a list's first error answers, and its blanks drop (or read 0, or drop pairwise).
fn prep_range_args(prep: &str, argv: Vec<V>) -> Result<Vec<V>, V> {
    if prep == "raw" || prep == "positional" {
        return Ok(argv);
    }
    for a in &argv {
        if let V::List(l) = a {
            for v in l.iter() {
                match v {
                    V::Err(_) => return Err(v.clone()),
                    V::Fx(code) => return Err(V::err(fx_error_to_sol(code))),
                    _ => {}
                }
            }
        }
    }
    match prep {
        "zero" => Ok(argv.into_iter().map(|a| match a {
            V::List(l) => list(l.iter().map(|v| if is_missing(v) { V::Num(0.0) } else { v.clone() }).collect()),
            other => other,
        }).collect()),
        "paired" => {
            let lens: Vec<usize> = argv.iter().filter_map(|a| if let V::List(l) = a { Some(l.len()) } else { None }).collect();
            let Some(&n) = lens.iter().min() else { return Ok(argv) };
            let keep: Vec<usize> = (0..n).filter(|&i| !argv.iter().any(|a| matches!(a, V::List(l) if is_missing(&l[i])))).collect();
            if keep.len() == n {
                return Ok(argv);
            }
            Ok(argv.into_iter().map(|a| match a {
                V::List(l) => list(keep.iter().map(|&i| l[i].clone()).collect()),
                other => other,
            }).collect())
        }
        _ => Ok(argv.into_iter().map(|a| match a {
            V::List(l) => list(l.iter().filter(|v| !is_missing(v)).cloned().collect()),
            other => other,
        }).collect()),
    }
}

/// `applyArgRoles`: each argument read by its role; the answer is which slots the null rule must not blank on.
fn apply_arg_roles(name: &str, t: &CallTraits, empty: &[bool], argv: &mut [V]) -> Vec<bool> {
    let mut settled = empty.to_vec();
    if t.roles.iter().all(Option::is_none) {
        return settled;
    }
    let label = |i: usize| format!("{name}: argument {}", i + 1);
    for (i, v) in argv.iter_mut().enumerate() {
        let Some(Some(role)) = t.roles.get(i) else { continue };
        settled[i] = true;
        *v = apply_role(role, v, &label(i), true);
    }
    let group: Vec<usize> = (0..argv.len()).filter(|&i| matches!(t.roles.get(i), Some(Some(Role::Picks { required: true })))).collect();
    if !group.is_empty() && group.iter().all(|&i| matches!(argv[i], V::Undef)) {
        argv[group[0]] = V::err(sol_error("#SYNTAX!", format!("{name}: no positions given, and they have no default")));
    }
    settled
}

/// `applyRole`; a picks role is read with `required` off, as `applyArgRoles` reads it.
fn apply_role(role: &Role, v: &V, label: &str, picks_optional: bool) -> V {
    if v.is_sol_error() {
        return v.clone();
    }
    fn fill(v: &V, blank: &V) -> V {
        match v {
            V::List(l) => list(l.iter().map(|x| fill(x, blank)).collect()),
            V::Null | V::Undef => blank.clone(),
            other => other.clone(),
        }
    }
    let no_default = || V::err(sol_error("#SYNTAX!", format!("{label} is blank, and it has no default")));
    match role {
        Role::Setting { blank } => fill(v, &lowered(blank)),
        Role::Required => match v {
            V::List(l) => list(l.iter().map(|x| apply_role(role, x, label, picks_optional)).collect()),
            V::Null | V::Undef => no_default(),
            other => other.clone(),
        },
        Role::Picks { required } => {
            let out = match v {
                V::List(rows) if is_matrix(v) => list(
                    rows.iter()
                        .map(|r| match r {
                            V::List(cells) => list(cells.iter().map(|x| if matches!(x, V::Null | V::Undef) {
                                V::err(sol_error("#SYNTAX!", format!("A position in {label} is blank")))
                            } else {
                                x.clone()
                            }).collect()),
                            other => other.clone(),
                        })
                        .collect(),
                ),
                V::List(l) => {
                    let kept: Vec<V> = l.iter().filter(|x| !matches!(x, V::Null | V::Undef)).cloned().collect();
                    if kept.is_empty() { V::Undef } else { list(kept) }
                }
                V::Null | V::Undef => V::Undef,
                other => other.clone(),
            };
            if matches!(out, V::Undef) && *required && !picks_optional { no_default() } else { out }
        }
    }
}

/// The IFERROR family (`applyErrorHandler`).
fn apply_error_handler(name: &str, argv: &[V]) -> V {
    let as_sol = |v: &V| match v {
        V::Err(e) => Some(e.code.clone()),
        V::Fx(code) => Some(fx_error_to_sol(code).code),
        _ => None,
    };
    let caught = |v: &V| match as_sol(v) {
        None => false,
        Some(code) => match name {
            "IFNA" | "ISNA" => code == "#N/A",
            "ISERR" => code != "#N/A",
            _ => true,
        },
    };
    let value = argv.first().cloned().unwrap_or(V::Undef);
    match name {
        "IFERROR" | "IFNA" => {
            let fallback = argv.get(1).cloned().unwrap_or(V::Null);
            if !is_arr(&value) && !is_arr(&fallback) {
                return if caught(&value) { fallback } else { value };
            }
            map_cells(&[value, fallback], &mut |x| if caught(&x[0]) { x[1].clone() } else { x[0].clone() })
        }
        "ERROR.TYPE" => {
            fn walk(v: &V, as_sol: &dyn Fn(&V) -> Option<String>) -> V {
                match v {
                    V::List(l) => list(l.iter().map(|x| walk(x, as_sol)).collect()),
                    other => match as_sol(other) {
                        Some(code) => V::Num(match code.as_str() {
                            "#DIV/0!" => 2.0,
                            "#VALUE!" => 3.0,
                            "#REF!" => 4.0,
                            "#NAME?" => 5.0,
                            "#N/A" => 7.0,
                            "#DOMAIN!" | "#OVERFLOW!" | "#CONV!" | "#NUM!" => 6.0,
                            _ => 3.0,
                        }),
                        None => V::err(sol_error("#N/A", "ERROR.TYPE: the value is not an error")),
                    },
                }
            }
            walk(&value, &as_sol)
        }
        _ => {
            fn walk(v: &V, caught: &dyn Fn(&V) -> bool) -> V {
                match v {
                    V::List(l) => list(l.iter().map(|x| walk(x, caught)).collect()),
                    other => V::Bool(caught(other)),
                }
            }
            walk(&value, &caught)
        }
    }
}
