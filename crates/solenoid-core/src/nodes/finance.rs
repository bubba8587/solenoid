//! [[D102]] graphOnCore, [[B11]] maximalMerge, [[D101]] financeCarriesMoney. `nodes/finance.ts`'s card bodies:
//! depreciation, cash flows, securities, coupons, bonds, payments and returns. A card reads its money as its formula
//! does, and a money answer carries that currency.

use crate::error_value::ErrorCode;
use super::kit::{core_call, guard_finite};
use super::stats::{finite_num, first, js_num, nullish, or, read_role, Role};
use super::{err, list, Answer, Call};
use crate::excel_functions::{js_pow, V};
use crate::finance_ops::{self as f, Cell, CouponOp, Fin, SecurityDiscOp};
use crate::finance_units::currency_clash;
use crate::unit_dims::{dim_equal, is_dimensionless, Dim, UnitCell};
use crate::unit_lists::format_dim;
use crate::unit_value::unit_error;
use std::rc::Rc;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "BitwiseNode" => bitwise(c),
        "DepreciationNode" => {
            let op = c.field_str("op", "sln").to_string();
            money_card(c, &op.to_uppercase(), &["cost", "salvage"], true, |c| depreciation(c, &op))
        }
        "NPVNode" => {
            let dated = c.field_str("op", "periods") == "dates";
            money_card(c, if dated { "XNPV" } else { "NPV" }, &["list"], true, |c| npv(c, dated))
        }
        "IRRNode" => {
            let dated = c.field_str("op", "periods") == "dates";
            money_card(c, if dated { "XIRR" } else { "IRR" }, &["list"], false, |c| irr(c, dated))
        }
        "MirrNode" => money_card(c, "MIRR", &["list"], false, mirr),
        "FvScheduleNode" => money_card(c, "FVSCHEDULE", &["pv"], true, fv_schedule),
        "IspmtNode" => money_card(c, "ISPMT", &["pv"], true, ispmt),
        "DollarNode" => dollar(c),
        "DiscountSecurityNode" => {
            let op = c.field_str("op", "tbillprice").to_string();
            let money: &[&str] = match op.as_str() {
                "intrate" => &["investment", "redemption"],
                "received" => &["investment"],
                _ => &[],
            };
            money_card(c, &op.to_uppercase(), money, op == "received", |c| discount_security(c, &op))
        }
        "CouponNode" => coupon(c),
        "AccruedInterestNode" => {
            let periodic = c.field_str("op", "periodic") != "maturity";
            money_card(c, if periodic { "ACCRINT" } else { "ACCRINTM" }, &["par"], true, |c| accrued_interest(c, periodic))
        }
        "PaymentBreakdownNode" => {
            let op = c.field_str("op", "ipmt").to_string();
            money_card(c, &op.to_uppercase(), &["pv", "fv"], true, |c| payment_breakdown(c, &op))
        }
        "DurationNode" => duration(c),
        "BondPricingNode" => bond_pricing(c),
        "ReturnsNode" => returns(c),
        _ => return None,
    })
}

fn answer(c: &mut Call, result: V) -> Answer {
    c.show("cachedResult", result.clone());
    Ok(vec![("result".into(), result)])
}

fn fin(r: Fin) -> V {
    match r {
        Fin::Num(n) => V::Num(n),
        Fin::Err(e) => V::err(e),
        Fin::Null => V::Null,
        Fin::Throw(m) => err(ErrorCode::Value, m),
    }
}

fn cells(v: &V) -> Vec<Cell> {
    super::stats::items(v)
        .iter()
        .map(|x| match x {
            V::Num(n) => Cell::Num(*n),
            V::Err(e) => Cell::Err(e.as_ref().clone()),
            _ => Cell::Other,
        })
        .collect()
}

/// `cashPrep`: the first error, else each cell as a number, anything else 0.
fn cash_prep(v: &V) -> Result<Vec<V>, V> {
    f::cash_prep(&cells(v)).map(|ns| ns.into_iter().map(V::Num).collect()).map_err(V::err)
}

/// `datedPrep`: the values' first error, then the dates', then `None` for a blank date.
type Dated = Option<(Vec<V>, Vec<V>)>;

fn dated_prep(values: &V, dates: &V) -> Result<Dated, V> {
    let values = cash_prep(values)?;
    let dates = super::stats::items(dates);
    if let Some(e) = dates.iter().find(|d| d.is_sol_error()) {
        return Err(e.clone());
    }
    if dates.iter().any(nullish) {
        return Ok(None);
    }
    Ok(Some((values, dates.to_vec())))
}

fn currency() -> Dim {
    Dim::from([("currency".to_string(), 1.0)])
}

/// `readMoneyInputs` then `moneyCard`: the `money` inputs read in one currency and every other input as a plain
/// number, the body run on what they show, and a money answer tagged with that currency. A unit anywhere else, or two
/// currencies, is #UNIT!.
fn money_card(c: &mut Call, name: &str, money: &[&str], money_out: bool, body: impl FnOnce(&mut Call) -> V) -> Answer {
    let mut code: Option<String> = None;
    let mut seen = false;
    let mut fail: Option<V> = None;
    fn read(v: &V, name: &str, key: &str, is_money: bool, code: &mut Option<String>, seen: &mut bool, fail: &mut Option<V>) -> V {
        if fail.is_some() {
            return v.clone();
        }
        match v {
            V::List(l) => list(l.iter().map(|x| read(x, name, key, is_money, code, seen, fail)).collect()),
            V::Unit(u) if is_dimensionless(&u.dim) => V::Num(u.value),
            V::Unit(u) => {
                if !is_money {
                    *fail = Some(V::err(unit_error(&format!(
                        "{name}'s {key} is a plain number, not {}. A rate or a count of periods carries no unit.",
                        format_dim(&u.dim)
                    ))));
                    return v.clone();
                }
                if !dim_equal(&u.dim, &currency()) {
                    *fail = Some(V::err(unit_error(&format!("{name}'s money arguments take a currency, not {}.", format_dim(&u.dim)))));
                    return v.clone();
                }
                if let Some(d) = &u.display {
                    if let Some(prev) = code.as_ref().filter(|p| *p != d) {
                        *fail = Some(V::err(currency_clash(prev, d)));
                        return v.clone();
                    }
                    *code = Some(d.clone());
                }
                *seen = true;
                V::Num(u.value)
            }
            other => other.clone(),
        }
    }
    let mut inputs = std::mem::take(&mut c.inputs);
    for (key, vals) in inputs.iter_mut() {
        let is_money = money.contains(&key.as_str());
        for v in vals.iter_mut() {
            *v = read(v, name, key, is_money, &mut code, &mut seen, &mut fail);
        }
    }
    c.inputs = inputs;
    if let Some(e) = fail {
        return answer(c, e);
    }
    let result = body(c);
    c.show("cachedResult", result.clone());
    let display = code.filter(|d| !d.is_empty());
    fn tag(v: V, display: &Option<String>) -> V {
        match v {
            V::Num(n) => V::Unit(Rc::new(UnitCell {
                value: n,
                dim: currency(),
                display: display.clone(),
                ratio: false,
                scale: None,
                offset: None,
                unit_dim: None,
            })),
            V::List(l) => list(l.iter().cloned().map(|x| tag(x, display)).collect()),
            other => other,
        }
    }
    let result = if money_out && seen { tag(result, &display) } else { result };
    Ok(vec![("result".into(), result)])
}

/// JS `ToInt32`.
fn to_int32(x: f64) -> i32 {
    if !x.is_finite() {
        return 0;
    }
    let m = x.trunc().rem_euclid(4294967296.0);
    (m as u32) as i32
}

fn bitwise(c: &mut Call) -> Answer {
    let op = c.field_str("op", "bitand").to_string();
    let (a_raw, b_raw) = (c.read_num("a", 0.0), c.read_num("b", 0.0));
    if matches!(a_raw, V::Null) || matches!(b_raw, V::Null) {
        return answer(c, V::Null);
    }
    let (a, b) = (js_num(&a_raw).trunc(), js_num(&b_raw).trunc());
    let (ia, ib) = (to_int32(a), to_int32(b));
    let shift = (0.0..32.0).contains(&b);
    let result = match op.as_str() {
        "bitand" => V::Num(f64::from(ia & ib)),
        "bitor" => V::Num(f64::from(ia | ib)),
        "bitxor" => V::Num(f64::from(ia ^ ib)),
        "bitlshift" if shift => V::Num(f64::from(ia.wrapping_shl((ib as u32) & 31))),
        "bitrshift" if shift => V::Num(f64::from((ia as u32) >> ((ib as u32) & 31))),
        _ => V::Null,
    };
    answer(c, result)
}

fn depreciation(c: &mut Call, op: &str) -> V {
    let lit = |c: &Call, k: &str| or(c.literal(k), V::Null);
    let cost = c.read_input("cost", lit(c, "cost"));
    let salvage = c.read_input("salvage", lit(c, "salvage"));
    let life = c.read_input("life", lit(c, "life"));
    let blank = |vs: &[&V]| vs.iter().any(|v| matches!(v, V::Null));
    let mut result = V::Null;
    if op == "vdb" {
        let start = c.read_num("start", 0.0);
        let end = c.read_num("end", 0.0);
        let factor = or(read_role(c, "factor", Role::Setting(V::Undef)), V::Num(2.0));
        if !blank(&[&cost, &salvage, &life, &start, &end, &factor]) {
            result = core_call("VDB", &[cost, salvage, life, start, end, factor]);
        }
    } else {
        let per = c.read_input("per", lit(c, "per"));
        let factor = or(read_role(c, "factor", Role::Setting(V::Undef)), V::Num(2.0));
        if !blank(&[&cost, &salvage, &life]) {
            if op == "sln" {
                result = core_call("SLN", &[cost, salvage, life]);
            } else if !matches!(per, V::Null) {
                match op {
                    "syd" => result = core_call("SYD", &[cost, salvage, life, per]),
                    "ddb" => result = core_call("DDB", &[cost, salvage, life, per, factor]),
                    "db" => {
                        let month = c.read_num("month", 12.0);
                        if !matches!(month, V::Null) {
                            result = core_call("DB", &[cost, salvage, life, per, month]);
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    match result {
        V::Num(n) if !n.is_finite() => V::Null,
        other => other,
    }
}

fn npv(c: &mut Call, dated: bool) -> V {
    let rate = c.read_num("rate", 0.1);
    if dated {
        if matches!(rate, V::Null) {
            return V::Null;
        }
        return match dated_prep(&first(c, "list"), &first(c, "dates")) {
            Err(e) => e,
            Ok(Some((values, dates))) if !values.is_empty() && !dates.is_empty() => core_call("XNPV", &[rate, list(values), list(dates)]),
            Ok(_) => V::Null,
        };
    }
    let flows = match cash_prep(&first(c, "list")) {
        Ok(f) => f,
        Err(e) => return e,
    };
    if matches!(rate, V::Null) || flows.is_empty() {
        return V::Null;
    }
    let mut args = vec![rate];
    args.extend(flows);
    match core_call("NPV", &args) {
        V::Num(n) if n.is_finite() => V::Num(n),
        _ => V::Null,
    }
}

fn irr(c: &mut Call, dated: bool) -> V {
    if dated {
        return match dated_prep(&first(c, "list"), &first(c, "dates")) {
            Err(e) => e,
            Ok(None) => V::Null,
            Ok(Some((values, dates))) => core_call("XIRR", &[list(values), list(dates)]),
        };
    }
    match cash_prep(&first(c, "list")) {
        Err(e) => e,
        Ok(flows) if flows.len() <= 1 => V::Null,
        Ok(flows) => core_call("IRR", &[list(flows)]),
    }
}

fn mirr(c: &mut Call) -> V {
    let flows = cash_prep(&first(c, "list"));
    let fin_rate = c.read_num("finrate", 0.1);
    let rein_rate = c.read_num("reinrate", 0.12);
    let flows = match flows {
        Ok(f) => f,
        Err(e) => return e,
    };
    if matches!(fin_rate, V::Null) || matches!(rein_rate, V::Null) || flows.len() <= 1 {
        return V::Null;
    }
    core_call("MIRR", &[list(flows), fin_rate, rein_rate])
}

fn fv_schedule(c: &mut Call) -> V {
    let pv = c.read_num("pv", 1000.0);
    let rates = match cash_prep(&first(c, "schedule")) {
        Ok(r) => r,
        Err(e) => return e,
    };
    if matches!(pv, V::Null) {
        return V::Null;
    }
    match core_call("FVSCHEDULE", &[pv.clone(), list(rates.clone())]) {
        V::Num(n) => {
            let mut ins: Vec<&V> = vec![&pv];
            ins.extend(rates.iter());
            guard_finite(n, &ins)
        }
        other => other,
    }
}

fn ispmt(c: &mut Call) -> V {
    let vals = [c.read_num("rate", 0.0), c.read_num("per", 1.0), c.read_num("nper", 0.0), c.read_num("pv", 0.0)];
    if vals.iter().any(|v| matches!(v, V::Null)) {
        return V::Null;
    }
    let [rate, per, nper, pv] = vals.map(|v| js_num(&v));
    if nper > 0.0 {
        let r = pv * rate * (per / nper - 1.0);
        if r.is_finite() {
            return V::Num(r);
        }
    }
    V::Null
}

fn dollar(c: &mut Call) -> Answer {
    let de = c.field_str("op", "dollarde") == "dollarde";
    let dollar = c.read_num("dollar", 0.0);
    let fraction_raw = c.read_num("fraction", 32.0);
    if matches!(dollar, V::Null) || matches!(fraction_raw, V::Null) {
        return answer(c, V::Null);
    }
    let fraction = js_num(&fraction_raw).floor();
    let mut result = V::Null;
    if fraction > 0.0 {
        let d = js_num(&dollar);
        let int_part = d.trunc();
        let dec_part = d - int_part;
        let digits = if fraction == 1.0 { 0.0 } else { crate::fdlibm::log10(fraction).ceil() };
        let mult = js_pow(10.0, digits);
        let r = if de { int_part + (dec_part * mult) / fraction } else { int_part + (dec_part * fraction) / mult };
        if r.is_finite() {
            result = V::Num(r);
        }
    }
    answer(c, result)
}

/// A date input's value as `Number.isFinite` gates it.
fn serial(v: &V) -> f64 {
    super::stats::strict_num(v)
}

fn discount_security(c: &mut Call, op: &str) -> V {
    let s = super::stats::first_raw(c, "settle");
    let m = super::stats::first_raw(c, "maturity");
    if nullish(&s) || nullish(&m) {
        return V::Null;
    }
    let read = |c: &Call, k: &str| c.read_input(k, or(c.literal(k), V::Num(0.0)));
    let any_null = |vs: &[&V]| vs.iter().any(|v| matches!(v, V::Null));
    match op {
        "tbilleq" | "tbillprice" | "tbillyield" => {
            let x = read(c, if op == "tbillyield" { "pr" } else { "discount" });
            if matches!(x, V::Null) {
                return V::Null;
            }
            core_call(&op.to_uppercase(), &[s, m, x])
        }
        "disc" | "intrate" | "received" => {
            let a = read(c, if op == "disc" { "pr" } else { "investment" });
            let b = read(c, if op == "received" { "discount" } else { "redemption" });
            let basis = read(c, "basis");
            if any_null(&[&a, &b, &basis]) {
                return V::Null;
            }
            if op == "disc" {
                fin(f::security_disc(SecurityDiscOp::Disc, serial(&s), serial(&m), js_num(&a), js_num(&b), js_num(&basis)))
            } else {
                core_call(&op.to_uppercase(), &[s, m, a, b, basis])
            }
        }
        "pricedisc" | "yielddisc" => {
            let rate_or_price = read(c, if op == "pricedisc" { "discount" } else { "pr" });
            let redemption = read(c, "redemption");
            let basis = read(c, "basis");
            if any_null(&[&rate_or_price, &redemption, &basis]) {
                return V::Null;
            }
            if op == "pricedisc" {
                fin(f::price_disc(true, serial(&s), serial(&m), js_num(&rate_or_price), js_num(&redemption), js_num(&basis)))
            } else {
                core_call("YIELDDISC", &[s, m, rate_or_price, redemption, basis])
            }
        }
        _ => {
            let issue = super::stats::first_raw(c, "issue");
            if nullish(&issue) {
                return V::Null;
            }
            let rate = read(c, "rate");
            let yp = read(c, if op == "pricemat" { "yld" } else { "pr" });
            let basis = read(c, "basis");
            if any_null(&[&rate, &yp, &basis]) {
                return V::Null;
            }
            core_call(&op.to_uppercase(), &[s, m, issue, rate, yp, basis])
        }
    }
}

fn coupon(c: &mut Call) -> Answer {
    let op = c.field_str("op", "coupdaybs").to_string();
    let s = super::stats::first_raw(c, "settle");
    let m = super::stats::first_raw(c, "maturity");
    if nullish(&s) || nullish(&m) {
        return answer(c, V::Null);
    }
    let freq = read_role(c, "frequency", Role::Setting(V::Num(2.0)));
    let basis = read_role(c, "basis", Role::Setting(V::Num(0.0)));
    let result = if op == "coupdays" {
        fin(f::coupon_value(CouponOp::Coupdays, serial(&s), serial(&m), js_num(&freq), js_num(&basis)))
    } else {
        core_call(&op.to_uppercase(), &[s, m, freq, basis])
    };
    answer(c, result)
}

fn accrued_interest(c: &mut Call, periodic: bool) -> V {
    let is = super::stats::first_raw(c, "issue");
    let ss = super::stats::first_raw(c, "settle");
    if nullish(&is) || nullish(&ss) {
        return V::Null;
    }
    let rate = c.read_num("rate", 0.06);
    let par = c.read_num("par", 1000.0);
    let basis = read_role(c, "basis", Role::Setting(V::Num(0.0)));
    if matches!(rate, V::Null) || matches!(par, V::Null) {
        return V::Null;
    }
    if periodic {
        let freq = read_role(c, "frequency", Role::Setting(V::Num(2.0)));
        fin(f::accrint(serial(&is), serial(&ss), js_num(&rate), js_num(&par), js_num(&freq), js_num(&basis)))
    } else {
        core_call("ACCRINTM", &[is, ss, rate, par, basis])
    }
}

fn payment_breakdown(c: &mut Call, op: &str) -> V {
    let ty = if c.field_str("paymentTiming", "end") == "beg" { 1.0 } else { 0.0 };
    if op == "ipmt" || op == "ppmt" {
        let vals = [c.read_num("rate", 0.0), c.read_num("per", 1.0), c.read_num("nper", 0.0), c.read_num("pv", 0.0), c.read_num("fv", 0.0)];
        if vals.iter().any(|v| matches!(v, V::Null)) {
            return V::Null;
        }
        let [rate, per, nper, pv, fv] = vals.map(|v| js_num(&v));
        let pmt = if rate.abs() < 1e-12 {
            if nper != 0.0 { -(pv + fv) / nper } else { 0.0 }
        } else {
            let r_n = js_pow(1.0 + rate, nper);
            -(pv * r_n + fv) * rate / ((1.0 + rate * ty) * (r_n - 1.0))
        };
        if !pmt.is_finite() {
            return V::Null;
        }
        let ipmt = if rate.abs() < 1e-12 {
            0.0
        } else {
            match core_call("IPMT", &[V::Num(rate), V::Num(per), V::Num(nper), V::Num(pv), V::Num(fv), V::Num(ty)]) {
                V::Num(n) => n,
                _ => f64::NAN,
            }
        };
        if !ipmt.is_finite() {
            return V::Null;
        }
        let r = if op == "ipmt" { ipmt } else { pmt - ipmt };
        return if r.is_finite() { V::Num(r) } else { V::Null };
    }
    let vals = [c.read_num("rate", 0.0), c.read_num("nper", 0.0), c.read_num("pv", 0.0), c.read_num("start", 1.0), c.read_num("end", 1.0)];
    if vals.iter().any(|v| matches!(v, V::Null)) {
        return V::Null;
    }
    let mut args = vals.to_vec();
    args.push(V::Num(ty));
    core_call(if op == "cumipmt" { "CUMIPMT" } else { "CUMPRINC" }, &args)
}

fn duration(c: &mut Call) -> Answer {
    let op = c.field_str("op", "duration").to_uppercase();
    let s = super::stats::first_raw(c, "settle");
    let m = super::stats::first_raw(c, "maturity");
    if nullish(&s) || nullish(&m) {
        return answer(c, V::Null);
    }
    let coupon = c.read_num("coupon", 0.08);
    let yld = c.read_num("yld", 0.09);
    let freq = read_role(c, "frequency", Role::Setting(V::Num(2.0)));
    let basis = read_role(c, "basis", Role::Setting(V::Num(0.0)));
    if matches!(coupon, V::Null) || matches!(yld, V::Null) {
        return answer(c, V::Null);
    }
    let r = core_call(&op, &[s, m, coupon, yld, freq, basis]);
    answer(c, r)
}

fn bond_pricing(c: &mut Call) -> Answer {
    let op = c.field_str("op", "price").to_string();
    let s = super::stats::first_raw(c, "settle");
    let m = super::stats::first_raw(c, "maturity");
    if nullish(&s) || nullish(&m) {
        return answer(c, V::Null);
    }
    let rate = c.read_num("rate", 0.065);
    let redemption = c.read_num("redemption", 100.0);
    let freq = read_role(c, "frequency", Role::Setting(V::Num(2.0)));
    if matches!(rate, V::Null) || matches!(redemption, V::Null) {
        return answer(c, V::Null);
    }
    let is_price = matches!(op.as_str(), "price" | "oddfprice" | "oddlprice");
    let yp = if is_price { c.read_num("yld", 0.07) } else { c.read_num("pr", 97.5) };
    if matches!(yp, V::Null) {
        return answer(c, V::Null);
    }
    let odd_first = matches!(op.as_str(), "oddfprice" | "oddfyield");
    let odd_last = matches!(op.as_str(), "oddlprice" | "oddlyield");
    let result = if odd_first || odd_last {
        let fl = super::stats::first_raw(c, if odd_first { "firstcoupon" } else { "lastinterest" });
        if nullish(&fl) {
            return answer(c, V::Null);
        }
        let issue = if odd_first { c.read_input("issue", s.clone()) } else { s.clone() };
        if matches!(issue, V::Null) {
            return answer(c, V::Null);
        }
        let args = if odd_first { vec![s, m, issue, fl, rate, yp, redemption, freq] } else { vec![s, m, fl, rate, yp, redemption, freq] };
        core_call(&op.to_uppercase(), &args)
    } else {
        core_call(&op.to_uppercase(), &[s, m, rate, yp, redemption, freq])
    };
    answer(c, result)
}

/// `periodReturns`: `b / a − 1` per period, the first blank, an error kept where it stands.
fn simple_returns(prices: &V) -> V {
    let ps = super::stats::items(prices);
    list(
        (0..ps.len())
            .map(|i| {
                let b = &ps[i];
                if b.is_sol_error() {
                    return b.clone();
                }
                match (i.checked_sub(1).and_then(|j| finite_num(&ps[j])), finite_num(b)) {
                    (Some(a), Some(b)) if a != 0.0 => V::Num(b / a - 1.0),
                    _ => V::Null,
                }
            })
            .collect(),
    )
}

fn returns(c: &mut Call) -> Answer {
    let op = c.field_str("op", "log").to_string();
    let arr = first(c, "list");
    let rf = c.read_num("rf", 0.0);
    let periods = c.read_num("periods", 1.0);
    if [&arr, &rf, &periods].iter().any(|v| matches!(v, V::Null)) {
        return answer(c, V::Null);
    }
    let result = match op.as_str() {
        "simple" => simple_returns(&arr),
        "log" => core_call("LOGRETURNS", &[arr]),
        "cumulative" => core_call("CUMRETURNS", &[arr]),
        "drawdown" => core_call("DRAWDOWN", &[arr]),
        "maxdrawdown" => core_call("MAXDRAWDOWN", &[arr]),
        "cagr" => core_call("CAGR", &[arr, periods]),
        "volatility" => core_call("VOLATILITY", &[arr, periods]),
        "sharpe" => core_call("SHARPE", &[arr, rf, periods]),
        _ => core_call("SORTINO", &[arr, rf, periods]),
    };
    answer(c, result)
}
