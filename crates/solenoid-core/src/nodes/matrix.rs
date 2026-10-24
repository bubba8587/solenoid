//! [[C58]] tableInputRawText, [[C48]] appendLadder, [[B11]] maximalMerge, [[B14]] oneDesignSystem, [[C50]]
//! lambdaBindsByName. The linear-algebra cards and the LAMBDA helpers over a
//! table.

use super::kit::{core_call, num};
use super::list::{frame_cell_of, js_number, nullish, slot};
use super::logic::pick_slot;
use super::scalar::{read_role, Role};
use super::units::{from_unit, tag};
use super::{err, list, Answer, Call};
use crate::error_value::{sol_error, ErrorCode, SolError};
use crate::eval::{variables, Env, Eval, LambdaV};
use crate::excel_formula::{parse_formula, Ast};
use crate::excel_functions::js_string_of;
use crate::excel_functions::V;
use crate::frame::FrameCell;
use crate::jsnum::{js_trim, math_round, number_to_string};
use crate::unit_catalog::fc_unit_to_unit;
use crate::unit_dims::{dim_equal, is_dimensionless, Dim};
use crate::unit_expression::display_magnitude_of;
use crate::unit_fold::{fold_units_over, FoldKind};
use crate::value_kinds::guard_finite as guard_cells;
use serde_json::Value as Json;
use std::rc::Rc;

const MAX_GENERATED: f64 = 1_000_000.0;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "MatDetNode" => mat_det(c),
        "TableMultNode" => table_mult(c),
        "TableUnitNode" => table_unit(c),
        "TableDiagNode" => table_diag(c),
        "TableOuterNode" => table_outer(c),
        "MatSolveNode" => mat_solve(c),
        "MatEigenNode" => mat_eigen(c),
        "MapTableNode" => map_table(c),
        "ByAxisNode" => by_axis(c),
        "ReduceLambdaNode" => reduce_lambda(c),
        "MakeArrayNode" => make_array(c),
        "TableInputNode" => table_input(c),
        "TableTransposeNode" => table_transpose(c),
        "StackNode" => stack(c),
        "TableReshapeNode" => table_reshape(c),
        "TableSelectNode" => table_select(c),
        "TakeDropNode" => take_drop(c),
        "ExpandNode" => expand(c),
        "SetCellNode" => set_cell(c),
        _ => return None,
    })
}

/// `inputs[key]?.[0] ?? null`, null where it is blank.
fn first(c: &Call, key: &str) -> Option<V> {
    let v = slot(c, key);
    (!nullish(&v)).then_some(v)
}

fn rows_of(m: &V) -> Vec<V> {
    if let V::List(r) = m {
        r.as_ref().clone()
    } else {
        Vec::new()
    }
}

/// `matCols`: the first row's width.
fn width(m: &V) -> usize {
    match m {
        V::List(r) => match r.first() {
            Some(V::List(cells)) => cells.len(),
            Some(V::Str(s)) => s.encode_utf16().count(),
            _ => 0,
        },
        _ => 0,
    }
}

/// Every cell a finite number, or the error naming the first that isn't.
fn numeric(m: &V) -> Result<V, V> {
    for row in rows_of(m) {
        for cell in rows_of(&row) {
            match cell {
                V::Null | V::Undef => {
                    return Err(err(ErrorCode::Value, "This matrix operation needs complete data. A cell is missing"))
                }
                V::Str(s) if s.is_empty() => {
                    return Err(err(ErrorCode::Value, "This matrix operation needs complete data. A cell is missing"))
                }
                V::Num(n) if n.is_finite() => {}
                _ => return Err(err(ErrorCode::Type, "This matrix operation needs numbers, but got text")),
            }
        }
    }
    Ok(m.clone())
}

/// `#OVERFLOW!` past the element limit.
fn cell_cap(f: &str, rows: f64, cols: f64) -> Option<V> {
    let js_max1 = |x: f64| if x.is_nan() { f64::NAN } else { x.max(1.0) };
    (js_max1(rows) * js_max1(cols) > MAX_GENERATED).then(|| {
        err(
            ErrorCode::Overflow,
            format!(
                "{f} would build {}×{} cells, past the {} element limit",
                number_to_string(rows),
                number_to_string(cols),
                number_to_string(MAX_GENERATED)
            ),
        )
    })
}

fn grid(rows: impl Iterator<Item = Vec<V>>) -> V {
    list(rows.map(list).collect())
}

fn mat_det(c: &mut Call) -> Answer {
    let op = c.field_str("op", "mdeterm").to_string();
    let scalar = op != "minverse";
    let done = |c: &mut Call, r: V| {
        c.show("cachedScalar", if scalar { r.clone() } else { V::Null });
        c.show("cachedMatrix", if scalar { V::Null } else { r.clone() });
        Ok(vec![("result".into(), r)])
    };
    let Some(raw) = first(c, "matrix") else {
        c.show("cachedScalar", V::Null);
        c.show("cachedMatrix", V::Null);
        return Ok(vec![("result".into(), V::Null)]);
    };
    let m = match numeric(&raw) {
        Ok(m) => m,
        Err(e) => return done(c, e),
    };
    let sized = op != "rank" && op != "norm";
    let n = rows_of(&m).len();
    if sized && n != width(&m) {
        return done(c, err(ErrorCode::Shape, "Matrix must be square"));
    }
    let r = if sized && n == 0 {
        match op.as_str() {
            "mdeterm" => V::Num(1.0),
            "minverse" => list(Vec::new()),
            _ => V::Num(0.0),
        }
    } else {
        let name = match op.as_str() {
            "minverse" => "MINVERSE",
            "trace" => "TRACE",
            "rank" => "MATRIXRANK",
            "norm" => "NORM",
            _ => "MDETERM",
        };
        core_call(name, &[m])
    };
    done(c, r)
}

fn table_mult(c: &mut Call) -> Answer {
    let (Some(ra), Some(rb)) = (first(c, "a"), first(c, "b")) else {
        c.show("cachedResult", V::Null);
        return Ok(vec![("result".into(), V::Null)]);
    };
    let r = match (numeric(&ra), numeric(&rb)) {
        (Err(e), _) | (_, Err(e)) => e,
        (Ok(a), Ok(b)) => core_call("MMULT", &[a, b]),
    };
    c.show("cachedResult", r.clone());
    Ok(vec![("result".into(), r)])
}

/// `matUnit` / `matDiag`'s square: `diag(i)` on the diagonal, `off` elsewhere.
fn square(n: usize, diag: impl Fn(usize) -> V, off: &V) -> V {
    grid((0..n).map(|i| (0..n).map(|j| if i == j { diag(i) } else { off.clone() }).collect()))
}

fn off_diag(c: &Call) -> (bool, V) {
    let blank = c.field_str("offDiag", "zero") == "blank";
    (!blank, if blank { V::Null } else { V::Num(0.0) })
}

fn table_unit(c: &mut Call) -> Answer {
    let n = read_role(c, "n", &Role::Required);
    let (zero, off) = off_diag(c);
    let r = if n.is_sol_error() {
        n
    } else if zero && matches!(n, V::Num(_)) {
        core_call("MUNIT", &[n])
    } else {
        let k = math_round(num(&n));
        if k < 1.0 {
            list(Vec::new())
        } else if let Some(cap) = cell_cap("MUNIT", k, k) {
            cap
        } else if k.is_nan() {
            list(Vec::new())
        } else {
            square(k as usize, |_| V::Num(1.0), &off)
        }
    };
    c.show("cachedResult", r.clone());
    Ok(vec![("result".into(), r)])
}

fn table_diag(c: &mut Call) -> Answer {
    let values = first(c, "diag").map(|v| rows_of(&v)).unwrap_or_default();
    let r = if values.is_empty() {
        V::Null
    } else {
        let (zero, off) = off_diag(c);
        if zero && values.iter().all(|v| matches!(v, V::Null | V::Num(_))) {
            core_call("DIAGONAL", &[list(values)])
        } else {
            let n = values.len();
            cell_cap("DIAGONAL", n as f64, n as f64).unwrap_or_else(|| square(n, |i| values[i].clone(), &off))
        }
    };
    c.show("cachedResult", r.clone());
    Ok(vec![("result".into(), r)])
}

fn table_outer(c: &mut Call) -> Answer {
    let a = first(c, "a").map(|v| rows_of(&v)).unwrap_or_default();
    let b = first(c, "b").map(|v| rows_of(&v)).unwrap_or_default();
    let numeric_or_null = |v: &V| matches!(v, V::Null | V::Num(_));
    let r = if a.is_empty() || b.is_empty() {
        V::Null
    } else if a.iter().all(numeric_or_null) && b.iter().all(numeric_or_null) {
        core_call("OUTER", &[list(a), list(b)])
    } else {
        cell_cap("OUTER", a.len() as f64, b.len() as f64).unwrap_or_else(|| {
            grid(a.iter().map(|x| {
                b.iter().map(|y| if nullish(x) || nullish(y) { V::Null } else { V::Num(num(x) * num(y)) }).collect()
            }))
        })
    };
    c.show("cachedResult", r.clone());
    Ok(vec![("result".into(), r)])
}

fn mat_solve(c: &mut Call) -> Answer {
    let done = |c: &mut Call, r: V| {
        c.show("cachedResult", r.clone());
        Ok(vec![("result".into(), r)])
    };
    let (Some(raw), Some(b)) = (first(c, "matrix"), first(c, "b")) else { return done(c, V::Null) };
    let m = match numeric(&raw) {
        Ok(m) => m,
        Err(e) => return done(c, e),
    };
    let bs = rows_of(&b);
    if bs.iter().any(|v| !matches!(v, V::Num(_))) {
        return done(c, V::Null);
    }
    let n = rows_of(&m).len();
    if n != width(&m) || bs.len() != n {
        return done(c, err(ErrorCode::Shape, "A must be square with one b per row"));
    }
    let r = if n == 0 {
        err(ErrorCode::DivZero, "A is singular, so the system has no unique solution")
    } else {
        core_call("SOLVE", &[m, b])
    };
    done(c, r)
}

fn mat_eigen(c: &mut Call) -> Answer {
    let done = |c: &mut Call, values: V, vectors: V| {
        c.show("cachedValues", values.clone());
        c.show("cachedVectors", vectors.clone());
        Ok(vec![("values".into(), values), ("vectors".into(), vectors)])
    };
    let Some(raw) = first(c, "matrix") else { return done(c, V::Null, V::Null) };
    let m = match numeric(&raw) {
        Ok(m) => m,
        Err(e) => return done(c, e.clone(), e),
    };
    let values = core_call("EIGENVALUES", std::slice::from_ref(&m));
    if let V::Err(e) = &values {
        let e = if e.code == ErrorCode::Shape {
            err(ErrorCode::Shape, "Eigen needs a square, symmetric matrix")
        } else {
            values.clone()
        };
        return done(c, e.clone(), e);
    }
    let vectors = core_call("EIGENVECTORS", &[m]);
    done(c, values, vectors)
}

// ─── MAP, BYROW / BYCOL, REDUCE, MAKEARRAY ───────────────────────────────────────────────────────────────────────

/// `toAnyMatrix`: a list is one row, a lone value one cell, and a later item that isn't a row a one-cell row.
pub(crate) fn any_matrix(v: &V) -> Option<Vec<Vec<V>>> {
    match v {
        V::Null | V::Undef => None,
        V::List(items) if items.is_empty() => Some(Vec::new()),
        V::List(items) if !matches!(items[0], V::List(_)) => Some(vec![items.as_ref().clone()]),
        V::List(items) => Some(
            items
                .iter()
                .map(|r| if let V::List(cells) = r { cells.as_ref().clone() } else { vec![r.clone()] })
                .collect(),
        ),
        other => Some(vec![vec![other.clone()]]),
    }
}

pub(crate) fn matrix_v(m: &[Vec<V>]) -> V {
    grid(m.iter().cloned())
}

/// `formulaSyntaxHint`: what is wrong with a formula that doesn't parse, where a common slip says.
pub(crate) fn syntax_hint(expr: &str) -> Option<String> {
    let mut quoted = String::new();
    let mut chars = expr.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '"' {
            while let Some(&n) = chars.peek() {
                chars.next();
                if n == '"' {
                    break;
                }
            }
            quoted.push_str("\"\"");
        } else {
            quoted.push(ch);
        }
    }
    let s = js_trim(&quoted).to_string();
    let count = |t: &str, ch: char| t.chars().filter(|&c| c == ch).count();
    if s.contains(['{', '}']) {
        return Some("Braces { } aren't formula syntax. Remove them: array literals aren't supported, so wire a List or Table input instead".into());
    }
    if s.starts_with('=') {
        return Some("Drop the leading =, and type just the formula body".into());
    }
    if s.contains(';') {
        return Some("Separate arguments with commas, not semicolons".into());
    }
    if count(&s, '[') != count(&s, ']') {
        return Some("Unclosed [. A whole column is [Name], and this row's cell is @[Name]".into());
    }
    let cs: Vec<char> = s.chars().collect();
    let mut bare = String::new();
    let mut i = 0;
    let close_at = |from: usize| (from..cs.len()).find(|&k| cs[k] == ']');
    while i < cs.len() {
        if cs[i] == '[' {
            if cs.get(i + 1) == Some(&'@') && cs.get(i + 2) == Some(&'[') {
                if let Some(k) = close_at(i + 3).filter(|&k| cs.get(k + 1) == Some(&']')) {
                    bare.push_str("[]");
                    i = k + 2;
                    continue;
                }
            }
            if let Some(k) = close_at(i + 1) {
                bare.push_str("[]");
                i = k + 1;
                continue;
            }
        }
        bare.push(cs[i]);
        i += 1;
    }
    let (open, close) = (count(&bare, '('), count(&bare, ')'));
    let plural = |n: usize| if n == 1 { "" } else { "es" };
    if open > close {
        return Some(format!("Missing {} closing parenthesis{}", open - close, plural(open - close)));
    }
    if close > open {
        return Some(format!("{} extra closing parenthesis{}", close - open, plural(close - open)));
    }
    let mut depth = 0i64;
    for ch in bare.chars() {
        depth += match ch {
            '(' => 1,
            ')' => -1,
            _ => 0,
        };
        if depth < 0 {
            return Some("A ) comes before the ( it would close".into());
        }
    }
    if s.ends_with(['+', '-', '*', '/', '^', '&', ',', '<', '>', '=']) {
        return Some("The formula ends mid-expression (trailing operator)".into());
    }
    None
}

/// A card's formula: a wired LAMBDA with its parameters matched to the card's variables by name, or the typed formula
/// over them.
pub(crate) enum Body {
    Lambda(Rc<LambdaV>, Vec<Option<usize>>),
    Inline(Ast, Vec<String>),
}

/// `resolveFn`: the body, or the message the card shows and the code its error carries.
pub(crate) fn resolve(c: &Call, fallback: &str, vars: &[&str]) -> Result<Body, SolError> {
    if let V::Lambda(lam) = slot(c, "lambda") {
        let unknown: Vec<&str> = lam.params.iter().map(String::as_str).filter(|p| !vars.contains(p)).collect();
        if !unknown.is_empty() {
            return Err(sol_error(
                ErrorCode::Value,
                format!("Lambda param {} isn't one of this node's variables ({})", unknown.join(", "), vars.join(", ")),
            ));
        }
        let order = lam.params.iter().map(|p| vars.iter().position(|v| v == p)).collect();
        return Ok(Body::Lambda(lam, order));
    }
    let inline = match c.string_literal("formula") {
        V::Str(s) if !js_trim(&s).is_empty() => s.to_string(),
        _ => fallback.to_string(),
    };
    let Some(ast) = parse_formula(&inline) else {
        return Err(sol_error(ErrorCode::Syntax, syntax_hint(&inline).unwrap_or_else(|| "Syntax error".into())));
    };
    let unknown: Vec<String> = variables(&ast).into_iter().filter(|v| !vars.contains(&v.as_str())).collect();
    if !unknown.is_empty() {
        return Err(sol_error(
            ErrorCode::Name,
            format!(
                "Unknown name {} — this formula sees only ({}). To use an outside value, put the formula in a LAMBDA node (extra names become inputs) and wire it into the Lambda socket",
                unknown.join(", "),
                vars.join(", ")
            ),
        ));
    }
    let names = vars.iter().map(|v| v.to_string()).collect();
    Ok(Body::Inline(ast, names))
}

impl Body {
    /// The fold's unit wrapper (`unit_fold.rs`) over a table holding a unit cell; None where it has no reading.
    pub(crate) fn fold(&self, kind: FoldKind, m: &[Vec<V>], initial: &V) -> Option<V> {
        match self {
            Body::Inline(ast, _) => fold_units_over(kind, ast, &Env::default(), &matrix_v(m), initial),
            Body::Lambda(lam, _) => lam
                .body
                .as_ref()
                .filter(|_| lam.eta.is_none())
                .and_then(|b| fold_units_over(kind, b, &lam.env, &matrix_v(m), initial)),
        }
    }

    /// `fn(...args)`, its answer as `compileEvaluator` hands it back.
    pub(crate) fn call(&self, ev: &Eval, args: &[V]) -> V {
        let r = match self {
            Body::Lambda(lam, order) => {
                let argv: Vec<V> =
                    order.iter().map(|i| i.and_then(|i| args.get(i).cloned()).unwrap_or(V::Undef)).collect();
                ev.call_lambda(lam, &argv)
            }
            Body::Inline(ast, names) => {
                let env: Env =
                    names.iter().cloned().zip(args.iter().cloned().chain(std::iter::repeat(V::Undef))).collect();
                return ev.run(ast, &Rc::new(env));
            }
        };
        match r {
            V::Lambda(_) => {
                err(ErrorCode::Value, "LAMBDA needs arguments. Use it inside MAP, REDUCE, BYROW, SCAN or MAKEARRAY")
            }
            V::Fx(code) => V::err(crate::excel_functions::fx_error_to_sol(code)),
            other => other,
        }
    }
}

/// `cell`: what a result cell may hold, a non-finite number through the guard, anything else blank.
pub(crate) fn result_cell(v: &V) -> V {
    match v {
        V::Err(_) | V::Str(_) | V::Bool(_) => v.clone(),
        V::Num(n) => match guard_cells(*n, &[*n]) {
            FrameCell::Num(x) => V::Num(x),
            FrameCell::Err(e) => V::Err(e),
            _ => V::Null,
        },
        _ => V::Null,
    }
}

/// The card's answer and the two fields its component shows.
pub(crate) fn lambda_done(c: &mut Call, result: V, error: Option<String>) -> Answer {
    c.show("cachedResult", if result.is_sol_error() && error.is_some() { V::Null } else { result.clone() });
    c.show("cachedError", error.map_or(V::Null, |e| V::str(&e)));
    Ok(vec![("result".into(), result)])
}

pub(crate) fn fn_error(c: &mut Call, e: SolError) -> Answer {
    let msg = e.message.clone();
    lambda_done(c, V::err(e), Some(msg))
}

pub(crate) fn holds_unit_cell(m: &[Vec<V>]) -> bool {
    m.iter().flatten().any(|v| matches!(v, V::Unit(_)))
}

fn map_table(c: &mut Call) -> Answer {
    let m = any_matrix(&slot(c, "table"));
    let body = match resolve(c, "value^2", &["value", "value2", "value3", "row", "col"]) {
        Ok(b) => b,
        Err(e) => return fn_error(c, e),
    };
    let Some(m) = m else { return lambda_done(c, V::Null, None) };
    let extras = [any_matrix(&slot(c, "table2")), any_matrix(&slot(c, "table3"))];
    let w = |m: &[Vec<V>]| m.first().map_or(0, Vec::len);
    for e in extras.iter().flatten() {
        let one = e.len() == 1 && w(e) == 1;
        if !one && (e.len() != m.len() || w(e) != w(&m)) {
            let msg = format!("Shape mismatch: {}×{} vs {}×{}", e.len(), w(e), m.len(), w(&m));
            return fn_error(c, sol_error(ErrorCode::Shape, msg));
        }
    }
    let pick = |e: &Option<Vec<Vec<V>>>, i: usize, j: usize| match e {
        None => V::Num(f64::NAN),
        Some(e) if e.len() == 1 && e[0].len() == 1 => e[0][0].clone(),
        Some(e) => e.get(i).and_then(|r| r.get(j)).cloned().unwrap_or(V::Undef),
    };
    let ev = Eval::default();
    let out: Vec<Vec<V>> = m
        .iter()
        .enumerate()
        .map(|(i, row)| {
            row.iter()
                .enumerate()
                .map(|(j, x)| {
                    result_cell(&body.call(
                        &ev,
                        &[
                            x.clone(),
                            pick(&extras[0], i, j),
                            pick(&extras[1], i, j),
                            V::Num((i + 1) as f64),
                            V::Num((j + 1) as f64),
                        ],
                    ))
                })
                .collect()
        })
        .collect();
    lambda_done(c, matrix_v(&out), None)
}

fn by_axis(c: &mut Call) -> Answer {
    let by_row = c.field_str("op", "row") == "row";
    let m = any_matrix(&slot(c, "table"));
    let body = match resolve(c, "SUM(values)", &["values"]) {
        Ok(b) => b,
        Err(e) => return fn_error(c, e),
    };
    let Some(m) = m.filter(|m| !m.is_empty()) else { return lambda_done(c, V::Null, None) };
    if holds_unit_cell(&m) {
        let kind = if by_row { FoldKind::ByRow } else { FoldKind::ByCol };
        if let Some(r) = body.fold(kind, &m, &V::Null) {
            return lambda_done(c, r, None);
        }
        return Err(err(ErrorCode::Value, "This fold over units has no reading on the core"));
    }
    let vectors: Vec<Vec<V>> = if by_row {
        m.clone()
    } else {
        (0..m[0].len()).map(|j| m.iter().map(|r| r.get(j).cloned().unwrap_or(V::Undef)).collect()).collect()
    };
    let ev = Eval::default();
    let out: Vec<V> = vectors.into_iter().map(|vec| result_cell(&body.call(&ev, &[list(vec)]))).collect();
    let shaped = if by_row { list(out.into_iter().map(|x| list(vec![x])).collect()) } else { list(out) };
    lambda_done(c, shaped, None)
}

fn reduce_lambda(c: &mut Call) -> Answer {
    let initial = c.read_num("initial", 0.0);
    let m = any_matrix(&slot(c, "table"));
    let body = match resolve(c, "acc + value", &["acc", "value", "step"]) {
        Ok(b) => b,
        Err(e) => return fn_error(c, e),
    };
    let Some(m) = m else { return lambda_done(c, V::Null, None) };
    if matches!(initial, V::Unit(_)) || holds_unit_cell(&m) {
        if let Some(r) = body.fold(FoldKind::Reduce, &m, &initial) {
            return lambda_done(c, r, None);
        }
        return Err(err(ErrorCode::Value, "This fold over units has no reading on the core"));
    }
    let ev = Eval::default();
    let mut acc = initial;
    let mut i = 0.0;
    for x in m.iter().flatten() {
        i += 1.0;
        acc = body.call(&ev, &[acc, x.clone(), V::Num(i)]);
    }
    lambda_done(c, result_cell(&acc), None)
}

fn make_array(c: &mut Call) -> Answer {
    let count = |v: V| if matches!(v, V::Null) { 0.0 } else { num(&v).floor() };
    let rows = count(c.read_num("rows", 0.0));
    let cols = count(c.read_num("cols", 0.0));
    let body = match resolve(c, "row * col", &["row", "col"]) {
        Ok(b) => b,
        Err(e) => return fn_error(c, e),
    };
    if rows < 1.0 || cols < 1.0 {
        return lambda_done(c, V::Null, None);
    }
    if rows * cols > MAX_GENERATED {
        let msg = format!(
            "MAKEARRAY count {} exceeds the {} element limit",
            number_to_string(rows * cols),
            number_to_string(MAX_GENERATED)
        );
        return fn_error(c, sol_error(ErrorCode::Overflow, msg));
    }
    let ev = Eval::default();
    let (r, k) = (if rows.is_nan() { 0 } else { rows as usize }, if cols.is_nan() { 0 } else { cols as usize });
    let out: Vec<Vec<V>> = (1..=r)
        .map(|i| (1..=k).map(|j| result_cell(&body.call(&ev, &[V::Num(i as f64), V::Num(j as f64)]))).collect())
        .collect();
    lambda_done(c, matrix_v(&out), None)
}

// ─── The table cards that keep a table's unit (`matrixUnitOf`) ───────────────────────────────────────────────────────

/// A number as JSON writes it: an integer without a fraction, as the frozen units hold their exponents.
fn json_num(x: f64) -> Json {
    if x.fract() == 0.0 && x.abs() < 9_007_199_254_740_992.0 && !(x == 0.0 && x.is_sign_negative()) {
        Json::from(x as i64)
    } else {
        serde_json::Number::from_f64(x).map(Json::Number).unwrap_or(Json::Null)
    }
}

/// A `ColumnUnit` as `jsonEnc` writes it, an undefined display tagged.
fn unit_json(dim: &Dim, display: Option<&str>) -> Json {
    let dim: serde_json::Map<String, Json> = dim.iter().map(|(k, v)| (k.clone(), json_num(*v))).collect();
    let display = display.map_or_else(|| serde_json::json!({ "__undef": 1 }), Json::from);
    serde_json::json!({ "dim": dim, "display": display })
}

fn unit_dim(u: &Json) -> Dim {
    u.get("dim")
        .and_then(Json::as_object)
        .map(|o| o.iter().map(|(k, v)| (k.clone(), v.as_f64().unwrap_or(0.0))).collect())
        .unwrap_or_default()
}

fn unit_display(u: &Json) -> &str {
    u.get("display").and_then(Json::as_str).unwrap_or("")
}

/// `sameColumnUnit`.
fn same_unit(a: Option<&Json>, b: Option<&Json>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => dim_equal(&unit_dim(a), &unit_dim(b)) && unit_display(a) == unit_display(b),
        (a, b) => a.is_none() && b.is_none(),
    }
}

/// `withMatrixUnit(out, unit)`: a table's unit, kept only where it has a dimension.
fn put_unit(c: &mut Call, key: &str, out: &V, unit: Option<Json>) {
    if let (V::List(_), Some(u)) = (out, unit) {
        if !is_dimensionless(&unit_dim(&u)) {
            c.set_matrix_unit(key, u);
        }
    }
}

/// `matrixUnitOf(toAnyMatrix(inputs[key]?.[0]))`: the input's unit where the reading is the input's own table.
fn table_unit_of(c: &Call, key: &str) -> Option<Json> {
    match slot(c, key) {
        V::List(rows) if !rows.is_empty() && rows.iter().all(|r| matches!(r, V::List(_))) => {
            c.matrix_unit(key).cloned()
        }
        _ => None,
    }
}

fn result(c: &mut Call, r: V, unit: Option<Json>) -> Answer {
    c.show("cachedResult", r.clone());
    put_unit(c, "result", &r, unit);
    Ok(vec![("result".into(), r)])
}

/// The typed rows, each cell trimmed, every row as wide as the widest, a trailing blank column dropped.
fn table_raw_cells(text: &str) -> Vec<Vec<String>> {
    let raw = super::list::csv_rows(text);
    let mut cols = raw.iter().map(Vec::len).max().unwrap_or(0);
    while cols > 1 && raw.iter().all(|r| r.get(cols - 1).is_none_or(|x| js_trim(x).is_empty())) {
        cols -= 1;
    }
    raw.iter().map(|r| (0..cols).map(|j| js_trim(r.get(j).map_or("", String::as_str)).to_string()).collect()).collect()
}

fn table_input(c: &mut Call) -> Answer {
    let ty = c.field_str("dataType", "number").to_string();
    let unit = c.field_str("unit", "none").to_string();
    let cells = table_raw_cells(c.field_str("tableText", "1, 0\n0, 1"));
    let m = if cells.is_empty() {
        V::Null
    } else {
        grid(cells.iter().map(|r| r.iter().map(|x| frame_cell_of(&ty, x)).collect()))
    };
    let mut tag = None;
    if ty == "number" && !cells.is_empty() {
        // `applyFcUnit` on a table: its unit where the first filled cell is a number.
        let rows = rows_of(&m);
        let first_cell = rows.iter().flat_map(rows_of).find(|x| !nullish(x) && !matches!(x, V::Str(s) if s.is_empty()));
        if let (Some(u), Some(V::Num(_))) = (fc_unit_to_unit(&unit), first_cell) {
            tag = Some(unit_json(&u.dim, Some(&unit)));
        }
    }
    c.show("cachedResult", m.clone());
    put_unit(c, "table", &m, tag);
    Ok(vec![("table".into(), m)])
}

fn table_transpose(c: &mut Call) -> Answer {
    let Some(m) = any_matrix(&slot(c, "matrix")) else {
        return result(c, V::Null, None);
    };
    let unit = table_unit_of(c, "matrix");
    result(c, core_call("TRANSPOSE", &[matrix_v(&m)]), unit)
}

/// `matrixCellsFromList`: each unit cell as its display magnitude, and the one unit they share.
fn cells_from_list(cells: &[V]) -> (Vec<V>, Option<Json>) {
    let mags =
        cells.iter().map(|x| if let V::Unit(u) = x { V::Num(display_magnitude_of(u)) } else { x.clone() }).collect();
    let mut unit: Option<Json> = None;
    for x in cells {
        let V::Unit(u) = x else { continue };
        let cu = unit_json(&u.dim, u.display.as_deref());
        match &unit {
            None => unit = Some(cu),
            Some(held) if !same_unit(Some(held), Some(&cu)) => return (mags, None),
            _ => {}
        }
    }
    (mags, unit)
}

fn stack(c: &mut Call) -> Answer {
    let keys: Vec<String> = c.sockets.iter().map(|s| s.key.clone()).filter(|k| k.starts_with('t')).collect();
    let mut mats = Vec::new();
    for k in &keys {
        let Some(m) = any_matrix(&slot(c, k)) else { continue };
        if m.is_empty() {
            continue;
        }
        // `demoteUnitCells`: a row of unit cells becomes bare magnitudes under one table unit.
        if m.iter().any(|r| r.iter().any(|x| matches!(x, V::Unit(_)))) {
            let flat: Vec<V> = m.iter().flatten().cloned().collect();
            let (mags, unit) = cells_from_list(&flat);
            let mut i = 0;
            let bare = m.iter().map(|r| {
                let row = mags[i..i + r.len()].to_vec();
                i += r.len();
                row
            });
            mats.push((grid(bare), unit));
        } else {
            mats.push((matrix_v(&m), table_unit_of(c, k)));
        }
    }
    if mats.is_empty() {
        return result(c, V::Null, None);
    }
    let shared = mats[0].1.clone().filter(|u| mats[1..].iter().all(|(_, o)| same_unit(Some(u), o.as_ref())));
    let name = if c.field_str("op", "vstack") == "vstack" { "VSTACK" } else { "HSTACK" };
    let out = core_call(name, &mats.into_iter().map(|(m, _)| m).collect::<Vec<_>>());
    result(c, out, shared)
}

/// `tagFrameCellUnit`: a finite number in the table's display unit as a cell with that unit.
fn tag_cell(v: &V, unit: &Json) -> V {
    let V::Num(n) = v else { return v.clone() };
    if !n.is_finite() {
        return v.clone();
    }
    let display = unit_display(unit);
    match (!display.is_empty()).then(|| fc_unit_to_unit(display)).flatten() {
        Some(u) => from_unit(*n, &u, Some(display)),
        None => tag(*n, unit_dim(unit), None),
    }
}

fn table_reshape(c: &mut Call) -> Answer {
    let op = c.field_str("op", "wraprows").to_string();
    let skip = ["none", "blanks", "errors", "both"]
        .iter()
        .position(|s| *s == c.field_str("skipCells", "none"))
        .map_or(-1.0, |i| i as f64);
    let by_col = c.field_str("scanBy", "row") == "col";
    let done = |c: &mut Call, l: V, m: V, r: V, unit: Option<Json>| {
        c.show("cachedList", l);
        c.show("cachedMatrix", m);
        put_unit(c, "result", &r, unit);
        Ok(vec![("result".into(), r)])
    };
    if op == "wraprows" || op == "wrapcols" {
        let raw = any_matrix(&slot(c, "list")).map(|m| m.into_iter().flatten().collect::<Vec<_>>());
        let w = read_role(c, "wrapCount", &Role::Required);
        if w.is_sol_error() {
            return done(c, V::Null, V::Null, w, None);
        }
        let Some(raw) = raw else { return done(c, V::Null, V::Null, V::Null, None) };
        let (mags, unit) = cells_from_list(&raw);
        let w = if nullish(&w) { V::Num(0.0) } else { w };
        let fill = or_null(slot(c, "fill"));
        let mat = core_call(if op == "wraprows" { "WRAPROWS" } else { "WRAPCOLS" }, &[list(mags), w, fill]);
        if mat.is_sol_error() {
            return done(c, V::Null, V::Null, mat, None);
        }
        return done(c, V::Null, mat.clone(), mat, unit);
    }
    let Some(m) = any_matrix(&slot(c, "matrix")) else { return done(c, V::Null, V::Null, V::Null, None) };
    let unit = table_unit_of(c, "matrix");
    let args = [matrix_v(&m), V::Num(skip), V::Bool(by_col)];
    if op == "tocol" {
        let col = core_call("TOCOL", &args);
        return done(c, V::Null, col.clone(), col, unit);
    }
    let row = core_call("TOROW", &args);
    let tagged = match (&row, &unit) {
        (V::List(cells), Some(u)) => list(cells.iter().map(|x| tag_cell(x, u)).collect()),
        _ => row,
    };
    done(c, tagged.clone(), V::Null, tagged, None)
}

fn or_null(v: V) -> V {
    if matches!(v, V::Undef) {
        V::Null
    } else {
        v
    }
}

/// `readRole` for required picks: a blank position dropped, a blank inside a table of positions `#SYNTAX!`, none left
/// the picks left out, which is `#SYNTAX!`.
fn required_picks(c: &Call, key: &str) -> V {
    let label = c.label(key);
    let literal = match c.literal(key) {
        V::Undef | V::Null => c.string_literal(key),
        v => v,
    };
    let v = match c.wired(key) {
        None | Some([]) => literal,
        Some([first, ..]) => first.clone(),
    };
    if v.is_sol_error() {
        return v;
    }
    let no_default = || err(ErrorCode::Syntax, format!("{label} is blank, and it has no default"));
    let blank =
        |x: &V| if nullish(x) { err(ErrorCode::Syntax, format!("A position in {label} is blank")) } else { x.clone() };
    match &v {
        V::List(rows) if matches!(rows.first(), Some(V::List(_))) => list(
            rows.iter()
                .map(|r| if let V::List(cells) = r { list(cells.iter().map(blank).collect()) } else { blank(r) })
                .collect(),
        ),
        V::List(items) => {
            let kept: Vec<V> = items.iter().filter(|x| !nullish(x)).cloned().collect();
            if kept.is_empty() {
                no_default()
            } else {
                list(kept)
            }
        }
        x if nullish(x) => no_default(),
        _ => v,
    }
}

/// Positions read as JS reads them.
fn choose_axis(m: &[Vec<V>], indices: &[V], by_row: bool) -> V {
    let size = if by_row { m.len() } else { m.first().map_or(0, Vec::len) } as f64;
    let (label, kind) = if by_row { ("CHOOSEROWS", "row") } else { ("CHOOSECOLS", "column") };
    let mut resolved = Vec::with_capacity(indices.len());
    for i in indices {
        let n = js_number(i);
        let p = if n < 0.0 { size + n.trunc() } else { n.trunc() - 1.0 };
        if !(p >= 0.0 && p < size) {
            let (i, size) = (js_string_of(i), number_to_string(size));
            return err(
                ErrorCode::Value,
                format!("{label}: {kind} index {i} is out of range for a table with {size} {kind}s"),
            );
        }
        resolved.push(p as usize);
    }
    if by_row {
        grid(resolved.iter().map(|&r| m[r].clone()))
    } else {
        grid(m.iter().map(|row| resolved.iter().map(|&k| row.get(k).cloned().unwrap_or(V::Undef)).collect()))
    }
}

fn table_select(c: &mut Call) -> Answer {
    let Some(m) = any_matrix(&slot(c, "matrix")) else {
        return result(c, V::Null, None);
    };
    let idx = required_picks(c, "indices");
    if idx.is_sol_error() {
        return result(c, idx, None);
    }
    let picks = match &idx {
        V::List(items) => items.as_ref().clone(),
        other => vec![other.clone()],
    };
    let by_row = c.field_str("op", "chooserows") == "chooserows";
    let picked = if !m.is_empty() && picks.iter().all(|i| matches!(i, V::Num(_))) {
        core_call(if by_row { "CHOOSEROWS" } else { "CHOOSECOLS" }, &[matrix_v(&m), list(picks)])
    } else {
        choose_axis(&m, &picks, by_row)
    };
    let unit = if picked.is_sol_error() { None } else { table_unit_of(c, "matrix") };
    result(c, picked, unit)
}

/// `Math.round(readRole(…) ?? 0)` for a setting left out by default.
fn rounded_setting(c: &Call, key: &str) -> f64 {
    match read_role(c, key, &Role::Setting(V::Undef)) {
        V::Undef => 0.0,
        v => math_round(js_number(&v)),
    }
}

fn take_drop(c: &mut Call) -> Answer {
    let raw = slot(c, "data");
    if nullish(&raw) {
        return result(c, V::Null, None);
    }
    let (rows, cols) = (rounded_setting(c, "rows"), rounded_setting(c, "cols"));
    let take = c.field_str("op", "take") == "take";
    let count = |n: f64| if take && n == 0.0 { V::Null } else { V::Num(n) };
    let is_table = matches!(&raw, V::List(r) if matches!(r.first(), Some(V::List(_))));
    let unit = if is_table { c.matrix_unit("data").cloned() } else { None };
    let cut = core_call(if take { "TAKE" } else { "DROP" }, &[raw, count(rows), count(cols)]);
    result(c, cut, unit)
}

fn expand(c: &mut Call) -> Answer {
    let Some(m) = any_matrix(&slot(c, "matrix")).filter(|m| !m.is_empty()) else { return result(c, V::Null, None) };
    let (rows, cols) = (rounded_setting(c, "rows"), rounded_setting(c, "cols"));
    let fill = or_null(slot(c, "fill"));
    let r = core_call("EXPAND", &[matrix_v(&m), V::Num(rows), V::Num(cols), fill]);
    let unit = if r.is_sol_error() { None } else { table_unit_of(c, "matrix") };
    result(c, r, unit)
}

/// Each value written over the table at its 1-based row and column, a list or a table as a block.
fn set_cells(m: &[Vec<V>], writes: &[(V, V, V)]) -> Result<V, V> {
    let rows = m.len();
    let cols = m.first().map_or(0, Vec::len);
    let mut out: Vec<Vec<V>> =
        m.iter().map(|r| (0..cols).map(|j| r.get(j).cloned().unwrap_or(V::Null)).collect()).collect();
    let ref_err = |n: f64, max: usize, what: &str| {
        Ok(err(ErrorCode::Ref, format!("{what} {} is outside 1…{max}", number_to_string(n))))
    };
    for (r, k, v) in writes {
        let (r, k) = (math_round(js_number(r)), math_round(js_number(k)));
        if !r.is_finite() {
            return Ok(err(ErrorCode::Value, "Row must be a number"));
        }
        if !k.is_finite() {
            return Ok(err(ErrorCode::Value, "Column must be a number"));
        }
        let block: Vec<V> = match v {
            V::List(items) if items.is_empty() => Vec::new(),
            V::List(items) if matches!(items[0], V::List(_)) => items.as_ref().clone(),
            V::List(_) => vec![v.clone()],
            other => vec![list(vec![other.clone()])],
        };
        // A row is read as JS indexes it: a list by its items, text by its UTF-16 units; a blank row throws.
        if let Some(x) = block.iter().find(|x| nullish(x)) {
            let what = if matches!(x, V::Undef) { "undefined" } else { "null" };
            return Err(err(
                ErrorCode::Error,
                format!("This node failed to compute: Cannot read properties of {what} (reading 'length')"),
            ));
        }
        let block: Vec<Option<Vec<V>>> = block
            .iter()
            .map(|x| match x {
                V::List(cells) => Some(cells.as_ref().clone()),
                V::Str(s) => Some(s.encode_utf16().map(|u| V::str(&String::from_utf16_lossy(&[u]))).collect()),
                _ => None,
            })
            .collect();
        let h = block.len() as f64;
        // `Math.max` over the rows' lengths: a row without one is NaN.
        let wdt = block.iter().fold(0.0, |w: f64, x| match x {
            Some(cells) if !w.is_nan() => w.max(cells.len() as f64),
            _ => f64::NAN,
        });
        if r < 1.0 || r > rows as f64 {
            return ref_err(r, rows, "Row");
        }
        if k < 1.0 || k > cols as f64 {
            return ref_err(k, cols, "Column");
        }
        if r + h - 1.0 > rows as f64 {
            return ref_err(r + h - 1.0, rows, "Row");
        }
        if k + wdt - 1.0 > cols as f64 {
            return ref_err(k + wdt - 1.0, cols, "Column");
        }
        for (i, row) in block.iter().enumerate() {
            for (j, x) in row.iter().flatten().enumerate() {
                // Past the row's end JS grows the row, leaving holes.
                let line = &mut out[r as usize - 1 + i];
                let at = k as usize - 1 + j;
                if line.len() <= at {
                    line.resize(at + 1, V::Undef);
                }
                line[at] = x.clone();
            }
        }
    }
    Ok(matrix_v(&out))
}

fn set_cell(c: &mut Call) -> Answer {
    let Some(m) = any_matrix(&slot(c, "matrix")).filter(|m| !m.is_empty()) else { return result(c, V::Null, None) };
    let ids: Vec<String> = c.sockets.iter().filter_map(|s| s.key.strip_prefix("value").map(String::from)).collect();
    let mut writes = Vec::new();
    for id in ids {
        let (rk, ck) = (format!("row{id}"), format!("col{id}"));
        let at = |k: &str| c.read_input(k, or_null(c.literal(k)));
        let (r, k) = (at(&rk), at(&ck));
        if matches!(r, V::Null) || matches!(k, V::Null) {
            return result(c, V::Null, None);
        }
        writes.push((r, k, pick_slot(c, &format!("value{id}"))));
    }
    let r = set_cells(&m, &writes)?;
    let unit = if r.is_sol_error() { None } else { table_unit_of(c, "matrix") };
    result(c, r, unit)
}
