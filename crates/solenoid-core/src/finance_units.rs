// [[C25]] firstClassUnits, [[D99]] rustIsSpec
//! Which finance arguments are money, and the
//! dimension a finance call answers.

use crate::error_value::SolError;
use crate::unit_dims::{dim_equal, is_dimensionless, Dim, Op, OpResult};
use crate::unit_lists::format_dim;
use crate::unit_value::unit_error;

/// Which arguments (0-based) are money, and whether the answer is money rather than a rate or a count.
pub struct MoneySignature {
    money: fn(usize) -> bool,
    money_out: bool,
}

/// The finance functions whose arguments include money.
pub fn finance_money(name: &str) -> Option<MoneySignature> {
    let money = |money: fn(usize) -> bool| Some(MoneySignature { money, money_out: true });
    let plain = |money: fn(usize) -> bool| Some(MoneySignature { money, money_out: false });
    match name {
        "PV" | "FV" | "PMT" => money(|i| i == 2 || i == 3),
        "IPMT" | "PPMT" => money(|i| i == 3 || i == 4),
        "CUMIPMT" | "CUMPRINC" | "RECEIVED" => money(|i| i == 2),
        "ISPMT" | "ACCRINTM" => money(|i| i == 3),
        "NPV" => money(|i| i >= 1),
        "XNPV" => money(|i| i == 1),
        "FVSCHEDULE" => money(|i| i == 0),
        "SLN" | "SYD" | "DB" | "DDB" | "VDB" => money(|i| i <= 1),
        "ACCRINT" => money(|i| i == 4),
        "NPER" | "RATE" => plain(|i| (1..=3).contains(&i)),
        "IRR" | "XIRR" | "MIRR" => plain(|i| i == 0),
        "RRI" | "PDURATION" => plain(|i| i == 1 || i == 2),
        "INTRATE" => plain(|i| i == 2 || i == 3),
        _ => None,
    }
}

fn currency() -> Dim {
    Dim::from([("currency".to_string(), 1.0)])
}

pub fn currency_clash(a: &str, b: &str) -> SolError {
    unit_error(&format!(
        "Can't combine {a} and {b}: they are different currencies with no exchange rate. Convert one side first."
    ))
}

/// Money in the money arguments' one currency, or a plain number; None where a money argument is
/// indeterminate.
pub fn finance_dim(fn_: &str, sig: &MoneySignature, args: &[OpResult]) -> OpResult {
    let mut code: Option<String> = None;
    let mut money = false;
    let mut unknown = false;
    for (i, a) in args.iter().enumerate() {
        let a = match a {
            Ok(None) => {
                if (sig.money)(i) {
                    unknown = true;
                }
                continue;
            }
            Err(e) => return Err(e.clone()),
            Ok(Some(a)) => a,
        };
        if is_dimensionless(&a.dim) {
            continue;
        }
        if !(sig.money)(i) {
            return Err(unit_error(&format!(
                "{fn_}'s argument {} is a plain number, not {}. A rate or a count of periods carries no unit.",
                i + 1,
                format_dim(&a.dim)
            )));
        }
        if !dim_equal(&a.dim, &currency()) {
            return Err(unit_error(&format!("{fn_}'s money arguments take a currency, not {}.", format_dim(&a.dim))));
        }
        if let Some(c) = &a.code {
            if let Some(prev) = &code {
                if prev != c {
                    return Err(currency_clash(prev, c));
                }
            }
            code = Some(c.clone());
        }
        money = true;
    }
    if !sig.money_out {
        return Ok(Some(Op { dim: Dim::new(), code: None }));
    }
    if unknown {
        return Ok(None);
    }
    Ok(Some(if money { Op { dim: currency(), code } } else { Op { dim: Dim::new(), code: None } }))
}
