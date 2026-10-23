//! [[C50]] lambdaBindsByName, [[C22]] rowFormulaRefs, [[C25]] firstClassUnits, [[D77]] constantsAlwaysWin.
//! `nodes/lambda.ts`: the LAMBDA card, a body over its parameters that captures every other name it reads, wired or
//! typed. Its value crosses back as its text and its captures (`values::serialize_lambda`), which the card's TS
//! compiles into a callable LAMBDA.

use super::list::strip_unit_cells;
use super::{err, Answer, Call};
use crate::error_value::ErrorCode;
use crate::eval::{variables, Env, LambdaV};
use crate::excel_formula::{constant_value, parse_formula, Ast};
use crate::excel_functions::V;
use crate::jsnum::js_trim;
use std::rc::Rc;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "LambdaNode" => lambda(c),
        _ => return None,
    })
}

fn is_ident(s: &str) -> bool {
    let mut chars = s.chars();
    chars.next().is_some_and(|f| f.is_ascii_alphabetic() || f == '_') && chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
}

/// `atColNames`: the names written `@name`, in order, once each.
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

fn lambda(c: &mut Call) -> Answer {
    let params: Vec<String> = c.field_str("params", "x").split(',').map(js_trim).filter(|p| !p.is_empty()).map(String::from).collect();
    let expr = c.field_str("expr", "").to_string();
    let refuse = |c: &mut Call, shown: Option<String>, result: V| {
        c.show("cachedValue", V::Null);
        c.show("cachedError", shown.map_or(V::Null, |s| V::str(&s)));
        Ok(vec![("result".to_string(), result)])
    };
    if !params.iter().all(|p| is_ident(p)) {
        return refuse(c, Some("Bad parameter name".into()), err(ErrorCode::Name, "A lambda parameter name isn't a valid identifier"));
    }
    if params.iter().enumerate().any(|(i, p)| params[..i].contains(p)) {
        return refuse(c, Some("A parameter appears twice".into()), err(ErrorCode::Name, "A lambda parameter name appears twice"));
    }
    if let Some(k) = params.iter().find(|p| constant_value(p).is_some()) {
        let shown = format!("{k} is a constant");
        return refuse(c, Some(shown), err(ErrorCode::Name, format!("{k} is a constant, so it can't name a lambda parameter")));
    }
    let Some(ast) = parse_formula(&expr) else {
        if js_trim(&expr).is_empty() {
            return refuse(c, None, V::Null);
        }
        let hint = super::matrix::syntax_hint(&expr);
        let message = hint.clone().unwrap_or_else(|| "The lambda body has a syntax error".into());
        return refuse(c, Some(hint.unwrap_or_else(|| "Syntax error".into())), err(ErrorCode::Syntax, message));
    };
    let mut names = variables(&ast);
    at_col_names(&ast, &mut names);
    let captured: Vec<String> = names.into_iter().filter(|n| !params.contains(n)).collect();
    let units: Vec<V> = captured.iter().map(|v| c.read_num(v, 0.0)).collect();
    // The body reads its captures unit-blind; a computed column reads their units ([[D100]] computedColumnInfersUnit).
    let env: Env = captured.iter().cloned().zip(units.iter().map(strip_unit_cells)).collect();
    let descriptions = c.field("varDescriptions").filter(|d| d.as_object().is_some_and(|o| !o.is_empty())).map(|d| Rc::new(d.clone()));
    let lam = V::Lambda(Rc::new(LambdaV {
        params,
        body: Some(Rc::new(ast)),
        env: Rc::new(env),
        eta: None,
        captured: Some(captured),
        src: Some(expr),
        units,
        descriptions,
    }));
    c.show("cachedValue", lam.clone());
    c.show("cachedError", V::Null);
    Ok(vec![("result".into(), lam)])
}
