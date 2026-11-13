//! [[C50]] lambdaBindsByName, [[C22]] rowFormulaRefs, [[C25]] firstClassUnits.
//! The LAMBDA card: a body over its parameters that captures every other name it reads, crossing back as its text and
//! captures (`values::serialize_lambda`) for the card's TS to compile.

use super::list::strip_unit_cells;
use super::Cv;
use super::{err, Answer, Call};
use crate::error_value::ErrorCode;
use crate::eval::{variables, Env, LambdaV};
use crate::excel_formula::{bind_bracket_params, constant_value, parse_formula, Ast};
use crate::excel_functions::V;
use crate::jsnum::trim_space;
use std::rc::Rc;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "LambdaNode" => lambda(c),
        _ => return None,
    })
}

fn is_ident(s: &str) -> bool {
    let mut chars = s.chars();
    chars.next().is_some_and(|f| f.is_ascii_alphabetic() || f == '_')
        && chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
}

/// The names written `@name`, in order, once each.
fn at_col_names(ast: &Ast, out: &mut Vec<String>) {
    match ast {
        Ast::AtCol(name) if is_ident(name) && !out.contains(name) => out.push(name.clone()),
        Ast::Call { args, .. } => args.iter().for_each(|a| at_col_names(a, out)),
        Ast::Apply { func, args } => {
            at_col_names(func, out);
            args.iter().for_each(|a| at_col_names(a, out));
        }
        Ast::Unary { arg, .. } | Ast::Percent(arg) => at_col_names(arg, out),
        Ast::Bin { l, r, .. } => {
            at_col_names(l, out);
            at_col_names(r, out);
        }
        _ => {}
    }
}

/// A parameter as written: `[Unit Price]` names a column with a space, as in a computed column; the rest are plain names.
fn param_name(p: &str) -> Option<String> {
    match p.strip_prefix('[').and_then(|q| q.strip_suffix(']')).map(trim_space) {
        Some(inner) if !inner.is_empty() && !inner.contains(['[', ']']) => Some(inner.to_string()),
        Some(_) => None,
        None => is_ident(p).then(|| p.to_string()),
    }
}

fn lambda(c: &mut Call) -> Answer {
    let written: Vec<String> =
        c.field_str("params", "").split(',').map(trim_space).filter(|p| !p.is_empty()).map(String::from).collect();
    let named: Vec<Option<String>> = written.iter().map(|p| param_name(p)).collect();
    let expr = c.field_str("expr", "").to_string();
    let refuse = |c: &mut Call, shown: Option<String>, result: V| {
        c.show("cachedValue", V::Null);
        c.show("cachedError", shown.map_or(V::Null, |s| V::str(&s)));
        Ok(vec![("result".to_string(), Cv::V(result))])
    };
    if named.iter().any(Option::is_none) {
        return refuse(
            c,
            Some("Bad parameter name".into()),
            err(ErrorCode::Name, "A lambda parameter is a plain name, or a name in brackets: [Unit Price]"),
        );
    }
    let params: Vec<String> = named.into_iter().flatten().collect();
    if params.iter().enumerate().any(|(i, p)| params[..i].contains(p)) {
        return refuse(
            c,
            Some("A parameter appears twice".into()),
            err(ErrorCode::Name, "A lambda parameter name appears twice"),
        );
    }
    if let Some(k) = params.iter().find(|p| constant_value(p).is_some()) {
        let shown = format!("{k} is a constant");
        return refuse(
            c,
            Some(shown),
            err(ErrorCode::Name, format!("{k} is a constant, so it can't name a lambda parameter")),
        );
    }
    let Some(ast) = parse_formula(&expr) else {
        if trim_space(&expr).is_empty() {
            return refuse(c, None, V::Null);
        }
        let hint = super::matrix::syntax_hint(&expr);
        let message = hint.clone().unwrap_or_else(|| "The lambda body has a syntax error".into());
        return refuse(c, Some(hint.unwrap_or_else(|| "Syntax error".into())), err(ErrorCode::Syntax, message));
    };
    let ast = bind_bracket_params(ast, &params);
    let mut names = variables(&ast);
    at_col_names(&ast, &mut names);
    let captured: Vec<String> = names.into_iter().filter(|n| !params.contains(n)).collect();
    let units: Vec<V> = captured.iter().map(|v| c.read_variable(v)).collect();
    let empty: Vec<String> = captured
        .iter()
        .filter(|v| c.wired(v).is_none_or(<[V]>::is_empty) && matches!(c.unwired(v), V::Undef | V::Null))
        .cloned()
        .collect();
    // The body reads its captures unit-blind; a computed column reads their units ([[C25]] firstClassUnits).
    let env: Env = captured.iter().cloned().zip(units.iter().map(strip_unit_cells)).collect();
    let descriptions =
        c.field("varDescriptions").filter(|d| d.as_object().is_some_and(|o| !o.is_empty())).map(|d| Rc::new(d.clone()));
    let lam = V::Lambda(Rc::new(LambdaV {
        params,
        body: Some(Rc::new(ast)),
        env: Rc::new(env),
        eta: None,
        captured: Some(captured),
        src: Some(expr),
        units,
        descriptions,
        empty,
    }));
    c.show("cachedValue", lam.clone());
    c.show("cachedError", V::Null);
    Ok(vec![("result".into(), Cv::from(lam))])
}
