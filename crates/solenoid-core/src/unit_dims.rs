// [[C25]] firstClassUnits, [[D47]] noMixCurrencies, [[D99]] rustIsSpec
//! Port of `dimEval` (`src/graph/unitDimExpr.ts`): the dimension a formula's result carries, never its value.

use std::collections::BTreeMap;

use crate::error_value::SolError;
use crate::excel_formula::Ast;
use crate::unit_value::{unit_error, READINGS_ADD, READINGS_FOLD, READINGS_SCALE};

/// Exponents over the axes; an absent axis is 0 and a zero is never stored.
pub type Dim = BTreeMap<String, f64>;

#[derive(Clone, Debug)]
pub enum DimResult {
    Dim(Dim),
    Err(SolError),
    /// Indeterminate: the caller drops the unit.
    Null,
}

#[derive(Clone, Debug)]
pub struct Op {
    pub dim: Dim,
    pub code: Option<String>,
}

pub type OpResult = Result<Option<Op>, SolError>;

pub type Codes = BTreeMap<String, String>;

fn combine(a: &Dim, b: &Dim, f: impl Fn(f64, f64) -> f64) -> Dim {
    let mut out = Dim::new();
    for k in a.keys().chain(b.keys()) {
        let v = f(a.get(k).copied().unwrap_or(0.0), b.get(k).copied().unwrap_or(0.0));
        if v != 0.0 {
            out.insert(k.clone(), v);
        }
    }
    out
}

pub fn dim_mul(a: &Dim, b: &Dim) -> Dim {
    combine(a, b, |x, y| x + y)
}

pub fn dim_div(a: &Dim, b: &Dim) -> Dim {
    combine(a, b, |x, y| x - y)
}

pub fn dim_pow(a: &Dim, n: f64) -> Dim {
    a.iter().filter_map(|(k, v)| { let p = v * n; (p != 0.0).then(|| (k.clone(), p)) }).collect()
}

pub fn dim_equal(a: &Dim, b: &Dim) -> bool {
    a.keys().chain(b.keys()).all(|k| a.get(k).copied().unwrap_or(0.0) == b.get(k).copied().unwrap_or(0.0))
}

pub fn is_dimensionless(a: &Dim) -> bool {
    a.values().all(|&v| v == 0.0)
}

const DIMENSIONLESS_FNS: &[&str] = &[
    "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN", "ATAN2", "SINH", "COSH", "TANH", "ASINH", "ACOSH", "ATANH", "CSC", "SEC", "COT",
    "ACOT", "EXP", "LN", "LOG", "LOG10",
];

const RESULT_DIMLESS_FNS: &[&str] = &[
    "COUNT", "COUNTA", "COUNTBLANK", "COUNTIF", "COUNTIFS", "ISNUMBER", "ISBLANK", "ISERROR", "ISERR", "ISNA", "ISTEXT",
    "ISNONTEXT", "ISLOGICAL", "ISEVEN", "ISODD", "SIGN", "LEN", "EXACT", "TEXT", "FIXED", "DOLLAR", "CONCAT", "CONCATENATE",
    "TEXTJOIN", "AND", "OR", "NOT", "XOR", "ROWS", "COLUMNS", "MATCH", "XMATCH", "RANK", "RANK.EQ", "RANK.AVG", "TYPE", "SKEW",
    "SKEW.P", "KURT", "CORREL", "PEARSON",
];

const PRESERVE_FNS: &[&str] = &[
    "ABS", "MIN", "MAX", "MEDIAN", "SUM", "AVERAGE", "AVG", "ROUND", "ROUNDUP", "ROUNDDOWN", "MROUND", "CEILING", "FLOOR", "INT",
    "TRUNC", "MOD", "GEOMEAN", "HARMEAN", "STDEV", "STDEV.S", "STDEV.P", "AVEDEV",
];

const SQUARE_FNS: &[&str] = &["VAR", "VAR.S", "VAR.P", "DEVSQ", "SUMSQ"];

const PICK_FNS: &[&str] = &[
    "LARGE", "SMALL", "PERCENTILE", "PERCENTILE.INC", "PERCENTILE.EXC", "QUARTILE", "QUARTILE.INC", "QUARTILE.EXC", "MODE",
    "MODE.SNGL", "INDEX", "SORT", "UNIQUE", "TAKE", "DROP", "FILTER", "TRANSPOSE", "CHOOSEROWS", "CHOOSECOLS",
];

fn criteria_value_arg(fn_: &str, argc: usize) -> Option<usize> {
    match fn_ {
        "AVERAGEIF" => Some(if argc > 2 { 2 } else { 0 }),
        "SUMIFS" | "AVERAGEIFS" | "MAXIFS" | "MINIFS" => Some(0),
        "XLOOKUP" => Some(2),
        _ => None,
    }
}

fn branch_args(fn_: &str, argc: usize) -> Option<Vec<usize>> {
    match fn_ {
        "IF" => Some(if argc > 2 { vec![1, 2] } else { vec![1] }),
        "IFERROR" | "IFNA" => Some(vec![0, 1]),
        "CHOOSE" => Some((1..argc.max(1)).collect()),
        "IFS" => Some((0..argc / 2).map(|i| 2 * i + 1).collect()),
        "SWITCH" => {
            let mut out: Vec<usize> = (2..argc).step_by(2).collect();
            if argc > 1 && argc % 2 == 0 {
                out.push(argc - 1);
            }
            Some(out)
        }
        _ => None,
    }
}

fn resolves(fn_: &str) -> bool {
    crate::eval::traits(fn_).is_some_and(|t| t.resolves) || crate::eval::is_external(fn_)
}

/// A retired spelling (`STDEVP`): it answers its #NAME?, united input or not.
fn eliminated(fn_: &str) -> bool {
    crate::eval::traits(fn_).is_some_and(|t| t.resolves && t.refusal.as_ref().is_some_and(|r| r.code == "#NAME?"))
}

fn dimless() -> Dim {
    Dim::new()
}

/// A left-out argument is dimensionless; an indeterminate one stays indeterminate.
fn arg_or_dimless(args: &[DimResult], i: usize) -> DimResult {
    args.get(i).cloned().unwrap_or_else(|| DimResult::Dim(dimless()))
}

fn require_same(args: &[DimResult], what: &str) -> DimResult {
    let mut acc: Option<&Dim> = None;
    for a in args {
        match a {
            DimResult::Null => return DimResult::Null,
            DimResult::Err(e) => return DimResult::Err(e.clone()),
            DimResult::Dim(d) if is_dimensionless(d) => {}
            DimResult::Dim(d) => match acc {
                None => acc = Some(d),
                Some(x) if !dim_equal(x, d) => return DimResult::Err(unit_error(&format!("{what} needs matching units."))),
                _ => {}
            },
        }
    }
    DimResult::Dim(acc.cloned().unwrap_or_default())
}

fn call_dim(name: &str, args: &[DimResult]) -> DimResult {
    let fn_ = name.to_uppercase();
    let f = fn_.as_str();
    if eliminated(f) {
        return DimResult::Null;
    }
    let first_err = || args.iter().find_map(|a| if let DimResult::Err(e) = a { Some(DimResult::Err(e.clone())) } else { None });
    if RESULT_DIMLESS_FNS.contains(&f) {
        return first_err().unwrap_or(DimResult::Dim(dimless()));
    }
    if DIMENSIONLESS_FNS.contains(&f) {
        let trig = matches!(f, "SIN" | "COS" | "TAN" | "CSC" | "SEC" | "COT");
        for a in args {
            match a {
                DimResult::Null => continue,
                DimResult::Err(e) => return DimResult::Err(e.clone()),
                DimResult::Dim(d) => {
                    let angle = dim_equal(d, &Dim::from([("angle".to_string(), 1.0)]));
                    let ok = is_dimensionless(d) || (trig && angle);
                    if !ok {
                        return DimResult::Err(unit_error(&format!("{f} needs a dimensionless argument.")));
                    }
                }
            }
        }
        return DimResult::Dim(dimless());
    }
    if PRESERVE_FNS.contains(&f) {
        return require_same(args, f);
    }
    if SQUARE_FNS.contains(&f) {
        return match require_same(args, f) {
            DimResult::Dim(d) => DimResult::Dim(dim_pow(&d, 2.0)),
            r => r,
        };
    }
    if f == "PRODUCT" || f == "SUMPRODUCT" {
        let mut acc = dimless();
        for a in args {
            match a {
                DimResult::Null => return DimResult::Null,
                DimResult::Err(e) => return DimResult::Err(e.clone()),
                DimResult::Dim(d) => acc = dim_mul(&acc, d),
            }
        }
        return DimResult::Dim(acc);
    }
    if f == "SQRT" {
        return match arg_or_dimless(args, 0) {
            DimResult::Dim(d) => DimResult::Dim(dim_pow(&d, 0.5)),
            r => r,
        };
    }
    if f == "POWER" {
        return match arg_or_dimless(args, 0) {
            DimResult::Dim(d) => if is_dimensionless(&d) { DimResult::Dim(dimless()) } else { DimResult::Null },
            r => r,
        };
    }
    if let Some(branches) = branch_args(f, args.len()) {
        let mut acc: Option<Dim> = None;
        for i in branches {
            match arg_or_dimless(args, i) {
                DimResult::Err(e) => return DimResult::Err(e),
                DimResult::Dim(d) if is_dimensionless(&d) => {}
                DimResult::Dim(d) => match &acc {
                    None => acc = Some(d),
                    Some(x) if !dim_equal(x, &d) => return DimResult::Null,
                    _ => {}
                },
                DimResult::Null => return DimResult::Null,
            }
        }
        return DimResult::Dim(acc.unwrap_or_default());
    }
    if PICK_FNS.contains(&f) {
        if let Some(e) = first_err() {
            return e;
        }
        if args.iter().skip(1).any(|a| matches!(a, DimResult::Dim(d) if !is_dimensionless(d))) {
            return DimResult::Err(unit_error(&format!("{f} needs a plain number beside its values.")));
        }
        return arg_or_dimless(args, 0);
    }
    if let Some(i) = criteria_value_arg(f, args.len()) {
        if let Some(e) = first_err() {
            return e;
        }
        return arg_or_dimless(args, i);
    }
    if f == "LAMBDA" || !resolves(f) {
        return DimResult::Null;
    }
    let mut indeterminate = false;
    for a in args {
        match a {
            DimResult::Null => indeterminate = true,
            DimResult::Err(e) => return DimResult::Err(e.clone()),
            DimResult::Dim(d) if !is_dimensionless(d) => return DimResult::Err(unit_error(&format!("{f} doesn't carry units."))),
            DimResult::Dim(_) => {}
        }
    }
    if indeterminate { DimResult::Null } else { DimResult::Dim(dimless()) }
}

fn const_num(node: &Ast) -> Option<f64> {
    match node {
        Ast::Num(_, v) => Some(*v),
        Ast::Unary { op, arg } => const_num(arg).map(|v| if *op == '-' { -v } else { v }),
        Ast::Bin { op, l, r } => {
            let (l, r) = (const_num(l)?, const_num(r)?);
            match op.as_str() {
                "+" => Some(l + r),
                "-" => Some(l - r),
                "*" => Some(l * r),
                "/" => (r != 0.0).then(|| l / r),
                "^" => Some(crate::excel_functions::js_pow(l, r)),
                _ => None,
            }
        }
        _ => None,
    }
}

struct Lam {
    params: Vec<String>,
    body: Ast,
}

/// Which argument each parameter of a host's lambda reads, and whether it takes the whole argument (None: a plain
/// index).
struct Host {
    lam_arg: usize,
    params: Vec<Option<(usize, bool)>>,
    fold: bool,
}

fn host_of(fn_: &str, argc: usize) -> Option<Host> {
    match fn_ {
        "REDUCE" | "SCAN" if argc == 3 => Some(Host { lam_arg: 2, params: vec![Some((0, false)), Some((1, false))], fold: true }),
        "BYROW" | "BYCOL" if argc == 2 => Some(Host { lam_arg: 1, params: vec![Some((0, true))], fold: false }),
        "MAP" if argc >= 2 => Some(Host { lam_arg: argc - 1, params: (0..argc - 1).map(|i| Some((i, false))).collect(), fold: false }),
        "MAKEARRAY" if argc == 3 => Some(Host { lam_arg: 2, params: vec![None, None], fold: false }),
        _ => None,
    }
}

fn lambda_of(n: Option<&Ast>, arity: usize, is_var: &dyn Fn(&str) -> bool) -> Option<Lam> {
    match n? {
        Ast::Call { name, args } if name.to_uppercase() == "LAMBDA" && !args.is_empty() => {
            let ps = &args[..args.len() - 1];
            let params: Vec<String> = ps.iter().filter_map(|p| if let Ast::Name(n) = p { Some(n.clone()) } else { None }).collect();
            (params.len() == ps.len()).then(|| Lam { params, body: args[args.len() - 1].clone() })
        }
        Ast::Name(name) if !is_var(name) && resolves(&name.to_uppercase()) => {
            let params: Vec<String> = (0..arity).map(|i| format!("#{i}")).collect();
            let body = Ast::Call { name: name.clone(), args: params.iter().map(|p| Ast::Name(p.clone())).collect() };
            Some(Lam { params, body })
        }
        _ => None,
    }
}

type Dim2 = BTreeMap<String, Dim>;

fn clash(l: &Op, r: &Op) -> Option<SolError> {
    match (&l.code, &r.code) {
        (Some(a), Some(b)) if a != b => Some(unit_error(&format!(
            "Can't combine {a} and {b}: they are different currencies with no exchange rate. Convert one side first."
        ))),
        _ => None,
    }
}

fn plain(dim: Dim) -> OpResult {
    Ok(Some(Op { dim, code: None }))
}

fn op_eval(node: &Ast, env: &Dim2, codes: &Codes) -> OpResult {
    match node {
        Ast::Num(..) | Ast::Bool(_) | Ast::Str(_) | Ast::Blank | Ast::AtCol(_) | Ast::WholeCol(_) => plain(dimless()),
        Ast::Name(n) => Ok(Some(Op { dim: env.get(n).cloned().unwrap_or_default(), code: codes.get(n).cloned() })),
        Ast::Unary { arg, .. } | Ast::Percent(arg) => op_eval(arg, env, codes),
        Ast::Apply { func, args } => match lambda_of(Some(func), args.len(), &|n| env.contains_key(n)) {
            Some(lam) => {
                let vals: Vec<OpResult> = args.iter().map(|a| op_eval(a, env, codes)).collect();
                apply_dim(&lam, &vals, env, codes)
            }
            None => Ok(None),
        },
        Ast::Call { name, args } => {
            let up = name.to_uppercase();
            if let Some(host) = host_of(&up, args.len()) {
                if let Some(lam) = lambda_of(args.get(host.lam_arg), host.params.len(), &|n| env.contains_key(n)) {
                    return host_dim(args, &host, &lam, env, codes);
                }
            }
            let dims: Vec<DimResult> = args
                .iter()
                .map(|a| match op_eval(a, env, codes) {
                    Ok(Some(o)) => DimResult::Dim(o.dim),
                    Ok(None) => DimResult::Null,
                    Err(e) => DimResult::Err(e),
                })
                .collect();
            match call_dim(name, &dims) {
                DimResult::Dim(d) => plain(d),
                DimResult::Null => Ok(None),
                DimResult::Err(e) => Err(e),
            }
        }
        Ast::Bin { op, l, r } => {
            let l = op_eval(l, env, codes);
            let rv = op_eval(r, env, codes);
            let l = l?;
            let rv = rv?;
            match op.as_str() {
                "*" | "/" => {
                    let (Some(l), Some(r)) = (l, rv) else { return Ok(None) };
                    if let Some(e) = clash(&l, &r) {
                        return Err(e);
                    }
                    let rd = if op == "*" { dim_mul(&l.dim, &r.dim) } else { dim_div(&l.dim, &r.dim) };
                    let truthy = |c: &Option<String>| c.as_ref().filter(|c| !c.is_empty()).cloned();
                    let code = match (truthy(&l.code), truthy(&r.code)) {
                        (Some(c), _) if dim_equal(&rd, &l.dim) => Some(c),
                        (_, Some(c)) if dim_equal(&rd, &r.dim) => Some(c),
                        _ => None,
                    };
                    Ok(Some(Op { dim: rd, code }))
                }
                "+" | "-" => {
                    let (Some(l), Some(r)) = (l, rv) else { return Ok(None) };
                    if let Some(e) = clash(&l, &r) {
                        return Err(e);
                    }
                    if dim_equal(&l.dim, &r.dim) {
                        let code = l.code.or(r.code);
                        return Ok(Some(Op { dim: l.dim, code }));
                    }
                    if is_dimensionless(&l.dim) {
                        return Ok(Some(r));
                    }
                    if is_dimensionless(&r.dim) {
                        return Ok(Some(l));
                    }
                    Err(unit_error(&format!("Can't {} values with different units.", if op == "+" { "add" } else { "subtract" })))
                }
                "^" => {
                    let Some(l) = l else { return Ok(None) };
                    if let Some(k) = const_num(r) {
                        return plain(dim_pow(&l.dim, k));
                    }
                    if is_dimensionless(&l.dim) { plain(dimless()) } else { Ok(None) }
                }
                "&" => plain(dimless()),
                _ => {
                    let (Some(l), Some(r)) = (l, rv) else { return plain(dimless()) };
                    if let Some(e) = clash(&l, &r) {
                        return Err(e);
                    }
                    if !dim_equal(&l.dim, &r.dim) && !is_dimensionless(&l.dim) && !is_dimensionless(&r.dim) {
                        return Err(unit_error("Can't compare values with different units."));
                    }
                    plain(dimless())
                }
            }
        }
    }
}

fn apply_dim(lam: &Lam, args: &[OpResult], env: &Dim2, codes: &Codes) -> OpResult {
    let mut inner = env.clone();
    let mut inner_codes = codes.clone();
    for (i, p) in lam.params.iter().enumerate() {
        let a = match args.get(i) {
            None => Op { dim: dimless(), code: None },
            Some(Ok(Some(o))) => o.clone(),
            Some(other) => return other.clone(),
        };
        inner.insert(p.clone(), a.dim);
        match a.code {
            Some(c) => inner_codes.insert(p.clone(), c),
            None => inner_codes.remove(p),
        };
    }
    op_eval(&lam.body, &inner, &inner_codes)
}

fn host_dim(args: &[Ast], host: &Host, lam: &Lam, env: &Dim2, codes: &Codes) -> OpResult {
    let mut vals = Vec::with_capacity(args.len());
    for (i, a) in args.iter().enumerate() {
        if i == host.lam_arg {
            vals.push(Op { dim: dimless(), code: None });
            continue;
        }
        match op_eval(a, env, codes)? {
            Some(o) => vals.push(o),
            None => return Ok(None),
        }
    }
    let bound: Vec<Op> = host.params.iter().map(|p| p.map_or(Op { dim: dimless(), code: None }, |(i, _)| vals[i].clone())).collect();
    if host.fold {
        let (acc, elem) = (&bound[0], &bound[1]);
        let start = if is_dimensionless(&acc.dim) { elem.clone() } else { acc.clone() };
        let Some(step) = apply_dim(lam, &[Ok(Some(start.clone())), Ok(Some(elem.clone()))], env, codes)? else { return Ok(None) };
        return Ok(dim_equal(&step.dim, &start.dim).then_some(step));
    }
    apply_dim(lam, &bound.into_iter().map(|o| Ok(Some(o))).collect::<Vec<_>>(), env, codes)
}

/// `dimEvalWithCode`: the result's dimension and currency code, a conflict, or None where it is indeterminate.
pub fn dim_eval_with_code(node: &Ast, env: &BTreeMap<String, Dim>, codes: &Codes) -> OpResult {
    op_eval(node, env, codes)
}

// ─── Affine units (°C, °F): `affineWeight` ───────────────────────────────────────

#[derive(Clone, Copy, Debug)]
struct Aff {
    w: f64,
    list: bool,
    konst: Option<f64>,
    scaled: bool,
    bare: bool,
}

const ZERO: Aff = Aff { w: 0.0, list: false, konst: None, scaled: false, bare: false };

fn aff(w: f64, list: bool) -> Aff {
    Aff { w, list, ..ZERO }
}

const AFF_SELECT: &[&str] = &["MIN", "MAX", "MEDIAN", "AVERAGE", "AVG"];
const AFF_FIRST: &[&str] = &["ABS", "ROUND", "ROUNDUP", "ROUNDDOWN", "MROUND", "CEILING", "FLOOR", "INT", "TRUNC"];
/// The spreads and the squared spreads: their arguments must agree, and they answer a difference.
const AFF_SPREADS: &[&str] = &["STDEV", "STDEV.S", "STDEV.P", "AVEDEV", "VAR", "VAR.S", "VAR.P", "DEVSQ"];
const PICK_SCALAR_FNS: &[&str] =
    &["LARGE", "SMALL", "PERCENTILE", "PERCENTILE.INC", "PERCENTILE.EXC", "QUARTILE", "QUARTILE.INC", "QUARTILE.EXC", "MODE", "MODE.SNGL", "INDEX"];

fn aff_err() -> SolError {
    unit_error(READINGS_SCALE)
}

fn sum_err() -> SolError {
    unit_error(READINGS_ADD)
}

fn is_literal(n: Option<&Ast>) -> bool {
    match n {
        None | Some(Ast::Str(_) | Ast::Bool(_) | Ast::Blank) => true,
        Some(n) => const_num(n).is_some(),
    }
}

pub type NamedLambdas = BTreeMap<String, (Vec<String>, Ast)>;

/// The readings, the names spread over a list, the wired plain numbers, the named lambdas and a lambda's locals.
#[derive(Clone)]
pub struct AffScope<'a> {
    points: &'a [String],
    lists: &'a [String],
    bare: &'a [String],
    fns: &'a NamedLambdas,
    locals: BTreeMap<String, Aff>,
}

impl<'a> AffScope<'a> {
    pub fn new(points: &'a [String], lists: &'a [String], bare: &'a [String], fns: &'a NamedLambdas) -> Self {
        AffScope { points, lists, bare, fns, locals: BTreeMap::new() }
    }
    fn has(xs: &[String], n: &str) -> bool {
        xs.iter().any(|x| x == n)
    }
    fn is_var(&self, n: &str) -> bool {
        self.locals.contains_key(n) || Self::has(self.points, n) || Self::has(self.lists, n)
    }
    fn point(&self, n: &str) -> f64 {
        if Self::has(self.points, n) { 1.0 } else { 0.0 }
    }
}

fn aff_apply(params: &[String], body: &Ast, args: &[Aff], scope: &AffScope) -> Result<Aff, SolError> {
    let mut inner = scope.clone();
    for (i, p) in params.iter().enumerate() {
        inner.locals.insert(p.clone(), args.get(i).copied().unwrap_or(ZERO));
    }
    aff_eval(body, &inner)
}

/// A fold must answer the accumulator's kind each step; a literal seed beside readings is a reading.
fn aff_host(fn_: &str, args: &[Ast], host: &Host, lam: &Lam, scope: &AffScope) -> Result<Aff, SolError> {
    let mut vals = Vec::with_capacity(args.len());
    for (i, a) in args.iter().enumerate() {
        vals.push(if i == host.lam_arg { ZERO } else { aff_eval(a, scope)? });
    }
    let bound: Vec<Aff> = host.params.iter().map(|p| p.map_or(ZERO, |(i, whole)| aff(vals[i].w, whole && vals[i].list))).collect();
    if !host.fold {
        let body = aff_apply(&lam.params, &lam.body, &bound, scope)?;
        return Ok(aff(body.w, true));
    }
    let (acc, elem) = (bound[0], bound[1]);
    let start = aff(if is_literal(args.first()) && elem.w != 0.0 { elem.w } else { acc.w }, false);
    let step = aff_apply(&lam.params, &lam.body, &[start, elem], scope)?;
    if (step.w - start.w).abs() > 1e-12 {
        return Err(if step.w > 1.0 { sum_err() } else { unit_error(READINGS_FOLD) });
    }
    Ok(aff(start.w, fn_ == "SCAN"))
}

/// `ws.some((w) => w !== ws[0])` is false.
fn agree(ws: &[f64]) -> bool {
    ws.first().is_none_or(|w0| ws.iter().all(|w| w == w0))
}

fn aff_eval(node: &Ast, scope: &AffScope) -> Result<Aff, SolError> {
    match node {
        Ast::Num(_, v) => Ok(Aff { konst: Some(*v), ..ZERO }),
        Ast::Name(n) => Ok(scope.locals.get(n).copied().unwrap_or(Aff {
            w: scope.point(n),
            list: AffScope::has(scope.lists, n),
            bare: AffScope::has(scope.bare, n),
            ..ZERO
        })),
        Ast::AtCol(n) => Ok(aff(scope.point(n), false)),
        Ast::WholeCol(n) => Ok(aff(scope.point(n), true)),
        Ast::Unary { op, arg } => {
            let a = aff_eval(arg, scope)?;
            Ok(if *op == '-' { Aff { w: -a.w, konst: a.konst.map(|k| -k), ..a } } else { a })
        }
        Ast::Percent(arg) => {
            let a = aff_eval(arg, scope)?;
            Ok(Aff { w: a.w / 100.0, list: a.list, konst: a.konst.map(|k| k / 100.0), scaled: a.scaled || a.w != 0.0, bare: false })
        }
        Ast::Bin { op, l, r } => {
            let l = aff_eval(l, scope);
            let r = aff_eval(r, scope);
            let (l, r) = (l?, r?);
            let list = l.list || r.list;
            let both = |f: fn(f64, f64) -> f64| match (l.konst, r.konst) {
                (Some(a), Some(b)) => Some(f(a, b)),
                _ => None,
            };
            Ok(match op.as_str() {
                "+" => Aff { w: l.w + r.w, list, konst: both(|a, b| a + b), scaled: l.scaled || r.scaled, bare: false },
                "-" => Aff { w: l.w - r.w, list, konst: both(|a, b| a - b), scaled: l.scaled || r.scaled, bare: false },
                "*" => {
                    if l.w != 0.0 && r.w != 0.0 {
                        return Err(aff_err());
                    }
                    if l.w != 0.0 {
                        let Some(k) = r.konst else { return Err(aff_err()) };
                        Aff { w: l.w * k, list, konst: None, scaled: true, bare: false }
                    } else if r.w != 0.0 {
                        let Some(k) = l.konst else { return Err(aff_err()) };
                        Aff { w: r.w * k, list, konst: None, scaled: true, bare: false }
                    } else {
                        Aff { list, konst: both(|a, b| a * b), ..ZERO }
                    }
                }
                "/" => {
                    if r.w != 0.0 {
                        return Err(aff_err());
                    }
                    if l.w != 0.0 {
                        match r.konst {
                            Some(k) if k != 0.0 => Aff { w: l.w / k, list, konst: None, scaled: true, bare: false },
                            _ => return Err(aff_err()),
                        }
                    } else {
                        let k = match (l.konst, r.konst) {
                            (Some(a), Some(b)) if b != 0.0 && !b.is_nan() => Some(a / b),
                            _ => None,
                        };
                        Aff { list, konst: k, ..ZERO }
                    }
                }
                "^" => {
                    if l.w != 0.0 || r.w != 0.0 {
                        return Err(aff_err());
                    }
                    aff(0.0, list)
                }
                _ => ZERO,
            })
        }
        Ast::Call { name, args: nodes } => {
            let fn_ = name.to_uppercase();
            let f = fn_.as_str();
            if let Some(host) = host_of(f, nodes.len()) {
                if let Some(lam) = lambda_of(nodes.get(host.lam_arg), host.params.len(), &|n| scope.is_var(n)) {
                    return aff_host(f, nodes, &host, &lam, scope);
                }
            }
            let mut args = Vec::with_capacity(nodes.len());
            for a in nodes {
                args.push(aff_eval(a, scope)?);
            }
            if !scope.locals.contains_key(name) {
                if let Some((params, body)) = scope.fns.get(name) {
                    return aff_apply(params, body, &args, scope);
                }
            }
            if RESULT_DIMLESS_FNS.contains(&f) {
                return Ok(ZERO);
            }
            if AFF_SELECT.contains(&f) {
                let ws: Vec<f64> = args.iter().filter(|a| a.konst.is_none() && !a.bare).map(|a| a.w).collect();
                if !agree(&ws) {
                    return Err(aff_err());
                }
                return Ok(aff(ws.first().copied().unwrap_or(0.0), false));
            }
            if AFF_SPREADS.contains(&f) {
                let ws: Vec<f64> = args.iter().filter(|a| a.konst.is_none()).map(|a| a.w).collect();
                return if agree(&ws) { Ok(ZERO) } else { Err(aff_err()) };
            }
            if f == "SUM" {
                if args.iter().any(|a| a.list && a.w != 0.0) {
                    return Err(sum_err());
                }
                return Ok(aff(args.iter().fold(0.0, |s, a| s + a.w), false));
            }
            if AFF_FIRST.contains(&f) || PICK_FNS.contains(&f) {
                if args.iter().skip(1).any(|a| a.w != 0.0) {
                    return Err(aff_err());
                }
                let pick_scalar = PICK_SCALAR_FNS.contains(&f);
                return Ok(aff(args.first().map_or(0.0, |a| a.w), !pick_scalar && args.first().is_some_and(|a| a.list)));
            }
            if let Some(i) = criteria_value_arg(f, args.len()) {
                let v = args.get(i).copied().unwrap_or(ZERO);
                if f == "SUMIFS" {
                    return if v.w != 0.0 { Err(sum_err()) } else { Ok(ZERO) };
                }
                return Ok(aff(v.w, false));
            }
            if let Some(branches) = branch_args(f, args.len()) {
                let list = branches.iter().any(|&i| args.get(i).is_some_and(|b| b.list));
                let ws: Vec<f64> = branches
                    .iter()
                    .filter(|&&i| !is_literal(nodes.get(i)) && !args.get(i).is_some_and(|a| a.bare))
                    .map(|&i| args.get(i).map_or(0.0, |a| a.w))
                    .collect();
                if !agree(&ws) {
                    return Err(aff_err());
                }
                return Ok(aff(ws.first().copied().unwrap_or(0.0), list));
            }
            if args.iter().any(|a| a.w != 0.0) { Err(aff_err()) } else { Ok(ZERO) }
        }
        Ast::Apply { func, args: nodes } => {
            if let Some(lam) = lambda_of(Some(func), nodes.len(), &|n| scope.is_var(n)) {
                let mut args = Vec::with_capacity(nodes.len());
                for a in nodes {
                    args.push(aff_eval(a, scope)?);
                }
                return aff_apply(&lam.params, &lam.body, &args, scope);
            }
            for a in nodes {
                if aff_eval(a, scope)?.w != 0.0 {
                    return Err(aff_err());
                }
            }
            Ok(ZERO)
        }
        Ast::Str(_) | Ast::Bool(_) | Ast::Blank => Ok(ZERO),
    }
}

/// `affineWeight`: 1 is a reading, 0 a difference or a plain number, else #UNIT!.
pub fn affine_weight(node: &Ast, scope: &AffScope) -> Result<u8, SolError> {
    let r = aff_eval(node, scope)?;
    if (r.w - 1.0).abs() < 1e-12 {
        Ok(1)
    } else if r.w.abs() < 1e-12 {
        Ok(0)
    } else if r.w > 1.0 && !r.scaled {
        Err(sum_err())
    } else {
        Err(aff_err())
    }
}

// ─── Values with a unit ─────────────────────────────────────────────────────────

/// A `UnitCell` as it crosses: its base-SI value, dimension, display id and ratio brand, and the display unit's scale
/// and offset as the TS resolves them (`displayScale`, `displayOffset`), present only beside a display id.
#[derive(Clone, Debug, PartialEq)]
pub struct UnitCell {
    pub value: f64,
    pub dim: Dim,
    pub display: Option<String>,
    pub ratio: bool,
    pub scale: Option<f64>,
    pub offset: Option<f64>,
}

/// The bodies that take a value with a unit: the ones that move values without reading them, and those
/// `unit_lists.rs` reads them for. Any other call holding one stays on the TS.
pub const UNIT_READY: &[&str] = &["REVERSE", "SLICE", "NTHELEMENT", "INTERLEAVE", "CONCATLISTS", "PADLEFT", "PADRIGHT", "RUNNING"];

pub fn holds_unit(v: &crate::excel_functions::V) -> bool {
    use crate::excel_functions::V;
    match v {
        V::Unit(_) => true,
        V::List(items) => items.iter().any(holds_unit),
        V::Lambda(l) => l.env.values().any(holds_unit),
        _ => false,
    }
}
