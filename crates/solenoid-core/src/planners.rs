// [[C130]] rustCore, [[D99]] rustIsSpec
//! Port of the planner and model cards' computations: the Payoff Planner (`payoffFrame` over `payoffOps.ts`), Group
//! Cost Settle's totals and ledger (`settleFrame`, `settleLedgerCube` over `settleOps.ts`), the amortization schedule (`financeOps.ts`), and K-Means,
//! PCA and logistic regression (`mlOps.ts`) with the frames their cards make.

use crate::date_serial::{date_utc, parts_of_ms, serial_to_ms, MS_PER_DAY};
use crate::decision::sort_by_num;
use crate::error_value::{sol_error, SolError};
use crate::fdlibm;
use crate::frame::{frame_row_count, FrameCell, FrameColType, FrameColumn, FrameValue};
use crate::jsnum::{is_js_space, js_lower, js_string, js_trim, math_max, math_min, math_round, string_to_number};

type Res<T> = Result<T, SolError>;

fn round2(x: f64) -> f64 {
    math_round(x * 100.0) / 100.0
}

fn num_col(name: impl Into<String>, xs: impl IntoIterator<Item = f64>) -> FrameColumn {
    FrameColumn::new(name, FrameColType::Number, xs.into_iter().map(FrameCell::Num).collect())
}

fn text_col(name: impl Into<String>, xs: impl IntoIterator<Item = String>) -> FrameColumn {
    FrameColumn::new(name, FrameColType::String, xs.into_iter().map(|s| FrameCell::str(&s)).collect())
}

/// The first column whose trimmed, lowercased name is one of `names`.
fn by_name(f: &FrameValue, names: &[&str]) -> Option<usize> {
    f.columns.iter().position(|c| names.contains(&js_lower(js_trim(&c.name)).as_ref()))
}

fn number_columns(f: &FrameValue) -> Vec<usize> {
    (0..f.columns.len()).filter(|&i| f.columns[i].ty == FrameColType::Number).collect()
}

fn is_finite_num(v: &FrameCell) -> Option<f64> {
    match v {
        FrameCell::Num(n) if n.is_finite() => Some(*n),
        _ => None,
    }
}

// ─── Payoff Planner ─────────────────────────────────────────────────────────────

struct Debt {
    name: String,
    balance: f64,
    apr: f64,
    min: f64,
}

fn monthly_rate(apr: f64) -> f64 {
    let a = if apr.is_finite() && apr >= 0.0 { apr } else { 0.0 };
    (if a >= 1.0 { a / 100.0 } else { a }) / 12.0
}

struct Plan {
    schedule: Vec<Vec<f64>>,
    per_debt: Vec<(f64, f64)>,
}

/// `payoffPlan`: Err with the message the card prefixes when the payments never clear a debt.
fn payoff_plan(debts: &[Debt], extra: f64, order: &str) -> Result<Plan, String> {
    let n = debts.len();
    let rates: Vec<f64> = debts.iter().map(|d| monthly_rate(d.apr)).collect();
    let mut balances: Vec<f64> = debts.iter().map(|d| math_max(0.0, if d.balance.is_finite() { d.balance } else { 0.0 })).collect();
    let mins: Vec<f64> = debts.iter().map(|d| math_max(0.0, if d.min.is_finite() { d.min } else { 0.0 })).collect();
    let mut interest = vec![0.0; n];
    let mut cleared: Vec<i64> = balances.iter().map(|&b| if b <= 0.0 { 0 } else { -1 }).collect();
    let was_open: Vec<bool> = balances.iter().map(|&b| b > 0.005).collect();
    let mut rank: Vec<usize> = (0..n).collect();
    if order == "snowball" {
        sort_by_num(&mut rank, |&a, &b| {
            let d = debts[a].balance - debts[b].balance;
            if d != 0.0 && !d.is_nan() { d } else { a as f64 - b as f64 }
        });
    } else {
        sort_by_num(&mut rank, |&a, &b| {
            let d = monthly_rate(debts[b].apr) - monthly_rate(debts[a].apr);
            if d != 0.0 && !d.is_nan() { d } else { a as f64 - b as f64 }
        });
    }
    let mut schedule = vec![balances.iter().map(|&b| round2(b)).collect::<Vec<_>>()];
    let pot = math_max(0.0, if extra.is_finite() { extra } else { 0.0 });
    let mut month = 0usize;
    while balances.iter().any(|&b| b > 0.005) {
        month += 1;
        if month > 600 {
            let worst = rank.iter().copied().find(|&i| balances[i] > 0.005).unwrap_or(0);
            return Err(format!("the payments never clear \"{}\". Raise a minimum or the extra", debts[worst].name));
        }
        let mut freed = pot;
        for i in 0..n {
            if balances[i] <= 0.005 {
                if was_open[i] {
                    freed += mins[i];
                }
                continue;
            }
            let acc = balances[i] * rates[i];
            interest[i] += acc;
            balances[i] += acc;
            let pay = math_min(mins[i], balances[i]);
            balances[i] -= pay;
            freed += mins[i] - pay;
        }
        for &i in &rank {
            if freed <= 0.005 {
                break;
            }
            if balances[i] <= 0.005 {
                continue;
            }
            let pay = math_min(freed, balances[i]);
            balances[i] -= pay;
            freed -= pay;
        }
        for i in 0..n {
            if balances[i] <= 0.005 && cleared[i] < 0 {
                balances[i] = 0.0;
                cleared[i] = month as i64;
            }
        }
        schedule.push(balances.iter().map(|&b| round2(b)).collect());
    }
    let per_debt = (0..n).map(|i| (if cleared[i] < 0 { month as f64 } else { cleared[i] as f64 }, round2(interest[i]))).collect();
    Ok(Plan { schedule, per_debt })
}

/// The Payoff Planner's `addMonthsSerial`: as EDATE, a day past the target month's end lands on its last day.
fn add_months_serial(start: f64, months: f64) -> f64 {
    let Some(ms) = serial_to_ms(start) else { return f64::NAN };
    let p = parts_of_ms(ms);
    let (y, mo) = (p.year as f64, (p.month as f64 - 1.0) + months);
    let last = date_utc(y, mo + 1.0, 0.0).map_or(f64::NAN, |ms| parts_of_ms(ms).day as f64);
    date_utc(y, mo, math_min(p.day as f64, last)).map_or(f64::NAN, |ms| (ms / MS_PER_DAY + 25569.0).floor())
}

/// `payoffFrame`: the summary or the month-by-month schedule. The caller carries Balance's unit and format over.
pub fn payoff_frame(f: &FrameValue, extra: f64, order: &str, view: &str, start: Option<f64>) -> Res<FrameValue> {
    let name_col = f.columns.iter().position(|c| c.ty == FrameColType::String);
    let nums = number_columns(f);
    let bal = by_name(f, &["balance", "owed", "principal"]).or(nums.first().copied());
    let apr = by_name(f, &["apr", "rate", "interest"]).or(nums.iter().copied().find(|&c| Some(c) != bal));
    let min = by_name(f, &["min", "minimum", "min payment", "payment"]).or(nums.iter().copied().find(|&c| Some(c) != bal && Some(c) != apr));
    let (Some(bal), Some(apr), Some(min)) = (bal, apr, min) else {
        return Err(sol_error("#VALUE!", "Payoff Planner needs Balance, APR and Min payment number columns"));
    };
    let num = |col: usize, i: usize, what: &str| -> Res<f64> {
        match f.columns[col].cell_at(i) {
            FrameCell::Err(e) => Err((**e).clone()),
            FrameCell::Null => Ok(0.0),
            v => is_finite_num(v).ok_or_else(|| sol_error("#VALUE!", format!("Payoff Planner: every {what} must be a number"))),
        }
    };
    let mut debts = Vec::new();
    for i in 0..frame_row_count(f) {
        let name = match name_col.map(|c| f.columns[c].cell_at(i)) {
            None | Some(FrameCell::Null) => format!("Debt {}", i + 1),
            Some(v) => js_string(v).into_owned(),
        };
        debts.push(Debt { name, balance: num(bal, i, "balance")?, apr: num(apr, i, "APR")?, min: num(min, i, "minimum payment")? });
    }
    let plan = payoff_plan(&debts, extra, order).map_err(|m| sol_error("#VALUE!", format!("Payoff Planner: {m}")))?;
    if view == "schedule" {
        let mut cols = vec![num_col("Month", (0..plan.schedule.len()).map(|m| m as f64))];
        cols.extend(debts.iter().enumerate().map(|(j, d)| num_col(d.name.clone(), plan.schedule.iter().map(|row| row[j]))));
        return Ok(FrameValue { columns: cols });
    }
    Ok(FrameValue {
        columns: vec![
            text_col(name_col.map_or("Debt".to_string(), |c| f.columns[c].name.clone()), debts.iter().map(|d| d.name.clone())),
            num_col("Months", plan.per_debt.iter().map(|d| d.0)),
            num_col("Interest", plan.per_debt.iter().map(|d| d.1)),
            FrameColumn::new(
                "Payoff date",
                FrameColType::Date,
                plan.per_debt.iter().map(|d| start.map_or(FrameCell::Null, |s| FrameCell::Num(add_months_serial(s, d.0)))).collect(),
            ),
        ],
    })
}

// ─── Group Cost Settle (totals) ─────────────────────────────────────────────────

struct Transfer {
    from: String,
    to: String,
    amount: f64,
}

/// `minTransfers`: the fewest transfers that settle every balance, largest first.
fn min_transfers(balances_in: &[(String, f64)]) -> Vec<Transfer> {
    let mut balances: Vec<(String, f64)> = Vec::new();
    for (name, net) in balances_in {
        match balances.iter_mut().find(|b| &b.0 == name) {
            Some(b) => b.1 += net,
            None => balances.push((name.clone(), *net)),
        }
    }
    let side = |sign: f64| {
        let mut xs: Vec<(String, f64)> = balances.iter().map(|b| (b.0.clone(), round2(sign * b.1))).filter(|x| x.1 > 0.005).collect();
        sort_by_num(&mut xs, |a, b| b.1 - a.1);
        xs
    };
    let (mut creditors, mut debtors) = (side(1.0), side(-1.0));
    let mut out = Vec::new();
    let (mut ci, mut di) = (0, 0);
    while ci < creditors.len() && di < debtors.len() {
        let amount = round2(math_min(creditors[ci].1, debtors[di].1));
        if amount > 0.0 {
            out.push(Transfer { from: debtors[di].0.clone(), to: creditors[ci].0.clone(), amount });
        }
        creditors[ci].1 = round2(creditors[ci].1 - amount);
        debtors[di].1 = round2(debtors[di].1 - amount);
        if creditors[ci].1 <= 0.005 {
            ci += 1;
        }
        if debtors[di].1 <= 0.005 {
            di += 1;
        }
    }
    out
}

/// `settleFrame`: the transfers (From, To, Amount) and then the net table (person, Paid, Owes, Owed, Net), side by side.
/// The caller splits them and carries Paid's unit and format over.
pub fn settle_frame(f: &FrameValue, split: &str) -> Res<FrameValue> {
    let name_col = f.columns.iter().position(|c| c.ty == FrameColType::String);
    let nums = number_columns(f);
    let share_col = by_name(f, &["share", "weight", "shares"]);
    let Some(paid_col) = by_name(f, &["paid", "amount", "spent"]).or(nums.iter().copied().find(|&c| Some(c) != share_col)) else {
        return Err(sol_error("#VALUE!", "Group Cost Settle needs a Paid number column"));
    };
    let mut people: Vec<(String, f64, Option<f64>)> = Vec::new();
    let mut keys: Vec<String> = Vec::new();
    for i in 0..frame_row_count(f) {
        let paid = f.columns[paid_col].cell_at(i);
        if let FrameCell::Err(e) = paid {
            return Err((**e).clone());
        }
        let share = share_col.and_then(|c| is_finite_num(f.columns[c].cell_at(i)));
        let fallback = || format!("Person {}", i + 1);
        let raw = match name_col.map(|c| f.columns[c].cell_at(i)) {
            None | Some(FrameCell::Null) => fallback(),
            Some(v) => js_trim(&js_string(v)).to_string(),
        };
        let raw = if raw.is_empty() { fallback() } else { raw };
        let p = is_finite_num(paid).unwrap_or(0.0);
        let key = js_lower(&raw).into_owned();
        match keys.iter().position(|k| k == &key) {
            None => {
                keys.push(key);
                people.push((raw, p, share));
            }
            Some(j) => {
                people[j].1 += p;
                if let Some(s) = share {
                    people[j].2 = Some(people[j].2.unwrap_or(0.0) + s);
                }
            }
        }
    }
    // settleGroup
    let weighted = split == "weighted" && share_col.is_some();
    let n = people.len();
    let paid: Vec<f64> = people.iter().map(|p| if p.1.is_finite() { p.1 } else { 0.0 }).collect();
    let total = paid.iter().fold(0.0, |s, p| s + p);
    let weights: Vec<f64> = people.iter().map(|p| p.2.filter(|&s| weighted && s.is_finite() && s >= 0.0).unwrap_or(1.0)).collect();
    let wsum = match weights.iter().fold(0.0, |a, b| a + b) {
        w if w == 0.0 || w.is_nan() => n as f64,
        w => w,
    };
    let shares: Vec<f64> = weights.iter().map(|w| if n > 0 { (total * w) / wsum } else { 0.0 }).collect();
    let transfers = min_transfers(&people.iter().enumerate().map(|(i, p)| (p.0.clone(), paid[i] - shares[i])).collect::<Vec<_>>());
    // settleNetFrame
    let paid_r: Vec<f64> = people.iter().map(|p| round2(p.1)).collect();
    let net: Vec<f64> = shares.iter().map(|&s| round2(round2(s))).collect();
    let diff: Vec<f64> = net.iter().zip(&paid_r).map(|(n, p)| round2(n - p)).collect();
    Ok(FrameValue {
        columns: vec![
            text_col("From", transfers.iter().map(|t| t.from.clone())),
            text_col("To", transfers.iter().map(|t| t.to.clone())),
            num_col("Amount", transfers.iter().map(|t| t.amount)),
            text_col(name_col.map_or("Person".to_string(), |c| f.columns[c].name.clone()), people.iter().map(|p| p.0.clone())),
            num_col("Paid", paid_r),
            num_col("Owes", diff.iter().map(|&d| if d > 0.0 { d } else { 0.0 })),
            num_col("Owed", diff.iter().map(|&d| if d < 0.0 { d } else { 0.0 })),
            num_col("Net", net),
        ],
    })
}

// ─── Group Cost Settle (transactions) ───────────────────────────────────────────

/// `settleLedgerCube` over a ledger's scalar cells: the transfers and the net table side by side, as `settle_frame`
/// answers. A column in `unit_cols` held unit cells: its numbers are amounts and never name anyone.
pub fn settle_ledger(f: &FrameValue, unit_cols: &[String]) -> Res<FrameValue> {
    let amount_col = by_name(f, &["amount", "cost", "total", "price", "spend"]);
    let payer_col = by_name(f, &["paid by", "paidby", "payer", "paid", "by", "who paid", "from"]);
    let for_col = by_name(f, &["for", "split", "split between", "participants", "shared", "shared by", "shared with", "with", "beneficiaries", "owed by"]);
    let Some(amount_col) = amount_col else {
        return Err(sol_error("#VALUE!", "Group Cost Settle (Transactions) needs an Amount column"));
    };
    let Some(payer_col) = payer_col else {
        return Err(sol_error("#VALUE!", "Group Cost Settle (Transactions) needs a Paid by column"));
    };
    let unit = |c: usize| unit_cols.iter().any(|n| n == &f.columns[c].name);
    let mut canon: Vec<(String, String)> = Vec::new();
    let mut names_of = |c: usize, i: usize| -> Vec<String> {
        let cell = f.columns[c].cell_at(i);
        if matches!(cell, FrameCell::Null) || unit(c) {
            return Vec::new();
        }
        js_string(cell)
            .split(',')
            .map(js_trim)
            .filter(|s| !s.is_empty())
            .map(|raw| {
                let k = js_lower(raw).into_owned();
                match canon.iter().find(|x| x.0 == k) {
                    Some(x) => x.1.clone(),
                    None => {
                        canon.push((k, raw.to_string()));
                        raw.to_string()
                    }
                }
            })
            .collect()
    };
    let amount_of = |i: usize| -> f64 {
        let n = match f.columns[amount_col].cell_at(i) {
            FrameCell::Num(n) => *n,
            FrameCell::Str(s) => {
                let kept: String = s.chars().filter(|&ch| !matches!(ch, ',' | '$' | '£' | '€') && !is_js_space(ch)).collect();
                string_to_number(&kept)
            }
            _ => 0.0,
        };
        if n.is_finite() { n } else { 0.0 }
    };
    let mut expenses: Vec<(f64, Vec<String>, Option<Vec<String>>)> = Vec::new();
    for i in 0..frame_row_count(f) {
        let amount = amount_of(i);
        let payers = names_of(payer_col, i);
        if payers.is_empty() {
            continue;
        }
        let named = for_col.map_or_else(Vec::new, |c| names_of(c, i));
        expenses.push((amount, payers, if named.is_empty() { None } else { Some(named) }));
    }
    // settleLedger
    let mut order: Vec<String> = Vec::new();
    let see = |order: &mut Vec<String>, name: &str| -> usize {
        order.iter().position(|n| n == name).unwrap_or_else(|| {
            order.push(name.to_string());
            order.len() - 1
        })
    };
    for e in &expenses {
        for p in e.1.iter().chain(e.2.iter().flatten()) {
            see(&mut order, p);
        }
    }
    let uniq = |xs: &[String]| {
        let mut out: Vec<String> = Vec::new();
        for x in xs {
            if !out.contains(x) {
                out.push(x.clone());
            }
        }
        out
    };
    let mut paid = vec![0.0; order.len()];
    let mut shares = vec![0.0; order.len()];
    for e in &expenses {
        let payers = uniq(&e.1);
        let bens = uniq(e.2.as_deref().unwrap_or(&order));
        if payers.is_empty() || bens.is_empty() {
            continue;
        }
        for p in &payers {
            paid[see(&mut order, p)] += e.0 / payers.len() as f64;
        }
        for b in &bens {
            shares[see(&mut order, b)] += e.0 / bens.len() as f64;
        }
    }
    let transfers = min_transfers(&order.iter().enumerate().map(|(i, n)| (n.clone(), paid[i] - shares[i])).collect::<Vec<_>>());
    // settleNetFrame
    let paid_r: Vec<f64> = paid.iter().map(|&p| round2(round2(p))).collect();
    let net: Vec<f64> = shares.iter().map(|&s| round2(round2(s))).collect();
    let diff: Vec<f64> = net.iter().zip(&paid_r).map(|(n, p)| round2(n - p)).collect();
    Ok(FrameValue {
        columns: vec![
            text_col("From", transfers.iter().map(|t| t.from.clone())),
            text_col("To", transfers.iter().map(|t| t.to.clone())),
            num_col("Amount", transfers.iter().map(|t| t.amount)),
            text_col("Person", order),
            num_col("Paid", paid_r),
            num_col("Owes", diff.iter().map(|&d| if d > 0.0 { d } else { 0.0 })),
            num_col("Owed", diff.iter().map(|&d| if d < 0.0 { d } else { 0.0 })),
            num_col("Net", net),
        ],
    })
}

// ─── Amortization ───────────────────────────────────────────────────────────────

/// `amortizationSchedule` as the Amortization card's frame; None where it has no rows.
pub fn amortization_frame(rate: f64, nper: f64, pv: f64, fv: f64, ty: f64) -> Option<FrameValue> {
    let n = nper.floor();
    if !rate.is_finite() || !pv.is_finite() || !fv.is_finite() || n.is_nan() || n < 1.0 {
        return None;
    }
    let pmt = if rate.abs() < 1e-12 {
        -(pv + fv) / n
    } else {
        let rn = fdlibm::pow(1.0 + rate, n);
        -(pv * rn + fv) * rate / ((1.0 + rate * ty) * (rn - 1.0))
    };
    let rbl = |k: f64| {
        if rate.abs() < 1e-12 {
            -(pv + pmt * (k - 1.0))
        } else {
            -(pv * fdlibm::pow(1.0 + rate, k - 1.0) + pmt * (1.0 + rate * ty) * (fdlibm::pow(1.0 + rate, k - 1.0) - 1.0) / rate)
        }
    };
    let mut rows: [Vec<f64>; 5] = Default::default();
    let mut balance = pv;
    let mut k = 1.0;
    while k <= n {
        let interest = if ty == 1.0 { if k == 1.0 { 0.0 } else { (rbl(k) * rate) / (1.0 + rate) } } else { rbl(k) * rate };
        let principal = pmt - interest;
        balance += principal;
        if balance.abs() < 1e-9 {
            balance = 0.0;
        }
        for (col, v) in rows.iter_mut().zip([k, pmt, interest, principal, balance]) {
            col.push(v);
        }
        k += 1.0;
    }
    let [period, payment, interest, principal, balance] = rows;
    Some(FrameValue {
        columns: vec![num_col("Period", period), num_col("Payment", payment), num_col("Interest", interest), num_col("Principal", principal), num_col("Balance", balance)],
    })
}

// ─── K-Means, PCA, logistic regression ──────────────────────────────────────────

/// `numericRows`: the number columns' names, the rows whose every feature is a finite number, and which rows those are.
fn numeric_rows(f: &FrameValue, cols: &[usize]) -> (Vec<Vec<f64>>, Vec<usize>, usize) {
    let total = frame_row_count(f);
    let (mut rows, mut kept) = (Vec::new(), Vec::new());
    for r in 0..total {
        let row: Option<Vec<f64>> = cols.iter().map(|&c| is_finite_num(f.columns[c].cell_at(r))).collect();
        if let Some(row) = row {
            rows.push(row);
            kept.push(r);
        }
    }
    (rows, kept, total)
}

/// `monteCarlo.ts`' `mulberry32`.
fn mulberry32(seed: u32) -> impl FnMut() -> f64 {
    let mut a = seed;
    move || {
        a = a.wrapping_add(0x6d2b_79f5);
        let mut t = (a ^ (a >> 15)).wrapping_mul(1 | a);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        f64::from(t ^ (t >> 14)) / 4_294_967_296.0
    }
}

fn sq_dist(a: &[f64], b: &[f64]) -> f64 {
    let mut s = 0.0;
    for i in 0..a.len() {
        s += fdlibm::pow(a[i] - b[i], 2.0);
    }
    s
}

struct KMeans {
    labels: Vec<usize>,
    /// None where a cluster ended with no member: the TS leaves a hole there.
    centers: Vec<Option<Vec<f64>>>,
}

/// `kmeans` with its default seed, 10 starts and 300 iterations: deterministic, as `mulberry32` seeds it.
fn kmeans(points: &[Vec<f64>], k: f64) -> Option<KMeans> {
    let n = points.len();
    let kk = math_round(k);
    if n == 0 || kk < 1.0 || kk > n as f64 {
        return None;
    }
    let kk = kk as usize;
    let d = points[0].len();
    let mut rng = mulberry32(0x5eed);
    let pick_point = |r: f64| points[(r * n as f64).floor() as usize].clone();
    let mut best: Option<(Vec<usize>, Vec<Vec<f64>>, f64)> = None;
    for _ in 0..10 {
        let mut centers = vec![pick_point(rng())];
        let mut dist = vec![f64::INFINITY; n];
        while centers.len() < kk {
            let last = centers.last().unwrap().clone();
            let mut total = 0.0;
            for i in 0..n {
                dist[i] = math_min(dist[i], sq_dist(&points[i], &last));
                total += dist[i];
            }
            let mut r = rng() * total;
            let mut pick = n - 1;
            for (i, di) in dist.iter().enumerate() {
                r -= di;
                if r <= 0.0 {
                    pick = i;
                    break;
                }
            }
            centers.push(points[pick].clone());
        }
        let mut labels = vec![0usize; n];
        let mut iter = 0;
        while iter < 300 {
            let mut moved = false;
            for i in 0..n {
                let (mut bi, mut bd) = (0, f64::INFINITY);
                for (c, center) in centers.iter().enumerate() {
                    let dd = sq_dist(&points[i], center);
                    if dd < bd {
                        bd = dd;
                        bi = c;
                    }
                }
                if labels[i] != bi {
                    labels[i] = bi;
                    moved = true;
                }
            }
            if !moved && iter > 0 {
                break;
            }
            let mut sums = vec![vec![0.0; d]; kk];
            let mut counts = vec![0usize; kk];
            for i in 0..n {
                counts[labels[i]] += 1;
                for j in 0..d {
                    sums[labels[i]][j] += points[i][j];
                }
            }
            for c in 0..kk {
                if counts[c] == 0 {
                    centers[c] = pick_point(rng());
                    continue;
                }
                centers[c] = sums[c].iter().map(|s| s / counts[c] as f64).collect();
            }
            iter += 1;
        }
        let mut inertia = 0.0;
        for i in 0..n {
            inertia += sq_dist(&points[i], &centers[labels[i]]);
        }
        if best.as_ref().is_none_or(|b| inertia < b.2) {
            best = Some((labels, centers, inertia));
        }
    }
    let (labels, centers, _) = best?;
    // Clusters renumbered in order of first appearance.
    let mut seen: Vec<usize> = Vec::new();
    let remap: Vec<usize> = labels
        .iter()
        .map(|&l| match seen.iter().position(|&s| s == l) {
            Some(p) => p + 1,
            None => {
                seen.push(l);
                seen.len()
            }
        })
        .collect();
    let mut out = vec![None; centers.len()];
    for (new, &old) in seen.iter().enumerate() {
        out[new] = Some(centers[old].clone());
    }
    Some(KMeans { labels: remap, centers: out })
}

/// The K-Means card's outputs side by side: each row's cluster (blank where skipped), then Centers (Cluster, a column
/// per feature, Count). Null where there's nothing to cluster.
pub fn kmeans_frame(f: &FrameValue, k: f64) -> Option<FrameValue> {
    let cols = number_columns(f);
    let (rows, kept, total) = numeric_rows(f, &cols);
    let r = kmeans(&rows, k)?;
    let mut labels = vec![FrameCell::Null; total];
    for (i, &row) in kept.iter().enumerate() {
        labels[row] = FrameCell::Num(r.labels[i] as f64);
    }
    let cell = |c: usize, x: f64| if r.centers[c].is_some() { FrameCell::Num(x) } else { FrameCell::Null };
    let k = r.centers.len();
    let mut out = vec![
        FrameColumn::new("Labels", FrameColType::Number, labels),
        FrameColumn::new("Cluster", FrameColType::Number, (0..k).map(|c| cell(c, (c + 1) as f64)).collect()),
    ];
    for (j, &col) in cols.iter().enumerate() {
        out.push(FrameColumn::new(f.columns[col].name.clone(), FrameColType::Number, (0..k).map(|c| r.centers[c].as_ref().map_or(FrameCell::Null, |v| FrameCell::Num(v[j]))).collect()));
    }
    out.push(FrameColumn::new("Count", FrameColType::Number, (0..k).map(|c| cell(c, r.labels.iter().filter(|&&l| l == c + 1).count() as f64)).collect()));
    Some(FrameValue { columns: out })
}

/// The PCA card's outputs side by side: Scores (PC1…, blank where skipped), Loadings (Feature, PC1…), then Explained.
pub fn pca_frame(f: &FrameValue, standardize: bool) -> Option<FrameValue> {
    let cols = number_columns(f);
    let (points, kept, total) = numeric_rows(f, &cols);
    let n = points.len();
    if n < 2 {
        return None;
    }
    let d = points[0].len();
    let nf = n as f64;
    let means: Vec<f64> = (0..d).map(|j| points.iter().fold(0.0, |s, p| s + p[j]) / nf).collect();
    let scales: Vec<f64> = (0..d)
        .map(|j| {
            if !standardize {
                return 1.0;
            }
            let v = points.iter().fold(0.0, |s, p| s + fdlibm::pow(p[j] - means[j], 2.0)) / (nf - 1.0);
            if v > 0.0 { v.sqrt() } else { 1.0 }
        })
        .collect();
    let z: Vec<Vec<f64>> = points.iter().map(|p| p.iter().enumerate().map(|(j, v)| (v - means[j]) / scales[j]).collect()).collect();
    let cov: Vec<Vec<f64>> = (0..d).map(|i| (0..d).map(|j| z.iter().fold(0.0, |s, r| s + r[i] * r[j]) / (nf - 1.0)).collect()).collect();
    let (values, vectors) = crate::fns_matrix::mat_eigh(&cov, 1e-12)?;
    let variance: Vec<f64> = values.iter().map(|&v| math_max(0.0, v)).collect();
    let total_var = variance.iter().fold(0.0, |a, b| a + b);
    let scores: Vec<Vec<f64>> = z.iter().map(|r| (0..vectors[0].len()).map(|c| r.iter().enumerate().fold(0.0, |s, (j, v)| s + v * vectors[j][c])).collect()).collect();
    let pc = |c: usize| format!("PC{}", c + 1);
    let mut out: Vec<FrameColumn> = (0..d)
        .map(|c| {
            let mut values = vec![FrameCell::Null; total];
            for (i, &row) in kept.iter().enumerate() {
                values[row] = FrameCell::Num(scores[i][c]);
            }
            FrameColumn::new(pc(c), FrameColType::Number, values)
        })
        .collect();
    out.push(text_col("Feature", cols.iter().map(|&c| f.columns[c].name.clone())));
    out.extend((0..d).map(|c| num_col(pc(c), (0..d).map(|j| vectors[j][c]))));
    out.push(num_col("Explained", variance.iter().map(|&v| if total_var > 0.0 { v / total_var } else { 0.0 })));
    Some(FrameValue { columns: out })
}

fn sigmoid(t: f64) -> f64 {
    1.0 / (1.0 + fdlibm::exp(-t))
}

fn weighted_cross(d: &[Vec<f64>], w: &[f64], p: usize) -> Vec<Vec<f64>> {
    (0..p).map(|a| (0..p).map(|b| d.iter().enumerate().fold(0.0, |s, (i, row)| s + w[i] * row[a] * row[b])).collect()).collect()
}

/// The Logistic card's outputs side by side: Coefficients (Term, Coefficient, Std Error, z, p), then each row's fitted
/// probability (blank where skipped). Null where the fit has no answer; None where the target or features are missing.
pub fn logistic_frame(f: &FrameValue, target: &str) -> Option<Option<FrameValue>> {
    let t = f.columns.iter().position(|c| c.name == target)?;
    let features: Vec<usize> = (0..f.columns.len()).filter(|&i| i != t && f.columns[i].ty == FrameColType::Number).collect();
    if features.is_empty() {
        return None;
    }
    let total = frame_row_count(f);
    let (mut x, mut y, mut kept) = (Vec::new(), Vec::new(), Vec::new());
    for r in 0..total {
        let yv = match f.columns[t].cell_at(r) {
            FrameCell::Bool(b) => Some(f64::from(u8::from(*b))),
            FrameCell::Num(n) if *n == 0.0 || *n == 1.0 => Some(*n),
            _ => None,
        };
        let row: Option<Vec<f64>> = features.iter().map(|&c| is_finite_num(f.columns[c].cell_at(r))).collect();
        if let (Some(yv), Some(row)) = (yv, row) {
            x.push(row);
            y.push(yv);
            kept.push(r);
        }
    }
    let Some(fit) = logistic_fit(&x, &y) else { return Some(None) };
    let mut probs = vec![FrameCell::Null; total];
    for (i, &row) in kept.iter().enumerate() {
        probs[row] = FrameCell::Num(fit.1[i]);
    }
    let (beta, se) = (&fit.0, &fit.2);
    let z: Vec<f64> = beta.iter().zip(se).map(|(b, s)| b / s).collect();
    let mut terms = vec!["(Intercept)".to_string()];
    terms.extend(features.iter().map(|&c| f.columns[c].name.clone()));
    Some(Some(FrameValue {
        columns: vec![
            text_col("Term", terms),
            num_col("Coefficient", beta.iter().copied()),
            num_col("Std Error", se.iter().copied()),
            num_col("z", z.iter().copied()),
            num_col("p", z.iter().map(|v| 2.0 * (1.0 - crate::dists::std_norm_cdf(v.abs())))),
            FrameColumn::new("Probabilities", FrameColType::Number, probs),
        ],
    }))
}

/// `logisticFit`'s coefficients, fitted probabilities and standard errors.
fn logistic_fit(x: &[Vec<f64>], y: &[f64]) -> Option<(Vec<f64>, Vec<f64>, Vec<f64>)> {
    let n = x.len();
    if n == 0 || y.len() != n {
        return None;
    }
    let p = x[0].len() + 1;
    if n <= p || y.iter().all(|&v| v == y[0]) {
        return None;
    }
    let d: Vec<Vec<f64>> = x.iter().map(|row| std::iter::once(1.0).chain(row.iter().copied()).collect()).collect();
    let mut beta = vec![0.0; p];
    let eta_of = |beta: &[f64]| -> Vec<f64> { d.iter().map(|row| row.iter().enumerate().fold(0.0, |s, (j, v)| s + v * beta[j])).collect() };
    let weights = |mu: &[f64]| -> Vec<f64> { mu.iter().map(|m| math_max(m * (1.0 - m), 1e-12)).collect() };
    for _ in 0..100 {
        let eta = eta_of(&beta);
        let mu: Vec<f64> = eta.iter().map(|&e| sigmoid(e)).collect();
        let w = weights(&mu);
        let z: Vec<f64> = eta.iter().enumerate().map(|(i, e)| e + (y[i] - mu[i]) / w[i]).collect();
        let h = weighted_cross(&d, &w, p);
        let g: Vec<f64> = (0..p).map(|a| d.iter().enumerate().fold(0.0, |s, (i, row)| s + w[i] * row[a] * z[i])).collect();
        let next = crate::fns_lists::mat_solve(&h, &g)?;
        let delta = next.iter().zip(&beta).fold(f64::NEG_INFINITY, |m, (v, b)| math_max(m, (v - b).abs()));
        beta = next;
        if delta < 1e-10 {
            break;
        }
    }
    let mu: Vec<f64> = eta_of(&beta).iter().map(|&e| sigmoid(e)).collect();
    let h = weighted_cross(&d, &weights(&mu), p);
    let se = (0..p)
        .map(|j| {
            let mut e = vec![0.0; p];
            e[j] = 1.0;
            crate::fns_lists::mat_solve(&h, &e).map_or(f64::NAN, |col| math_max(0.0, col[j]).sqrt())
        })
        .collect();
    Some((beta, mu, se))
}
